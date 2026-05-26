use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Port the Tor child binds for SOCKS (used by Phase 4 outbound dialing).
/// Picked above the default 9050 to avoid colliding with a system tor.
pub const SOCKS_PORT: u16 = 19050;

/// Port the Tor child binds for the control protocol. Phase 6 switches
/// bootstrap detection from stdout parsing to control-port queries.
pub const CONTROL_PORT: u16 = 19051;

/// Virtual port the hidden service listens on. Maps to the relay's
/// localhost:3001 (HTTP + socket.io).
pub const HS_VIRT_PORT: u16 = 80;

/// What the hidden service forwards to internally.
pub const RELAY_LOCAL_PORT: u16 = 3001;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorStatus {
    /// Best-effort bootstrap percentage scraped from stdout. 0 until the
    /// first "Bootstrapped N%" line arrives.
    pub bootstrap_pct: u8,
    /// .onion hostname once the hidden service has been created. Available
    /// shortly after bootstrap reaches 100%.
    pub hostname: Option<String>,
    /// Human-readable error if the Tor child failed to start (binary
    /// missing, hidden service dir permission denied, port conflict, etc.).
    pub error: Option<String>,
}

impl TorStatus {
    fn empty() -> Self {
        Self { bootstrap_pct: 0, hostname: None, error: None }
    }
}

/// Tauri-managed state. Mutex<Option<Child>> so we can `.take()` on exit.
pub struct TorState {
    pub child: Mutex<Option<Child>>,
    pub status: Mutex<TorStatus>,
}

impl TorState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(TorStatus::empty()),
        }
    }
}

/// Write the torrc and return the path to it + the hidden-service dir.
fn write_torrc(data_dir: &Path) -> std::io::Result<(PathBuf, PathBuf)> {
    let tor_dir = data_dir.join("tor");
    let hs_dir = tor_dir.join("hs");
    fs::create_dir_all(&tor_dir)?;
    fs::create_dir_all(&hs_dir)?;

    // Tor refuses to start if HiddenServiceDir is group/world readable.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hs_dir, fs::Permissions::from_mode(0o700))?;
        fs::set_permissions(&tor_dir, fs::Permissions::from_mode(0o700))?;
    }

    let torrc_path = tor_dir.join("torrc");
    let notices_path = tor_dir.join("notices.log");

    // NOTE: `Log` lines are additive in tor — both directives fire for
    // every notice. We need stdout because the Rust watcher thread parses
    // "Bootstrapped N%" from there; the file is kept for after-the-fact
    // diagnostics. A single `Log notice file ...` would silence stdout
    // entirely (the watcher would never detect hostname readiness).
    let torrc = format!(
        "DataDirectory {data}\n\
         Log notice stdout\n\
         Log notice file {notices}\n\
         SocksPort 127.0.0.1:{socks}\n\
         ControlPort 127.0.0.1:{control}\n\
         CookieAuthentication 1\n\
         HiddenServiceDir {hs}\n\
         HiddenServiceVersion 3\n\
         HiddenServicePort {virt} 127.0.0.1:{relay}\n",
        data = tor_dir.display(),
        notices = notices_path.display(),
        socks = SOCKS_PORT,
        control = CONTROL_PORT,
        hs = hs_dir.display(),
        virt = HS_VIRT_PORT,
        relay = RELAY_LOCAL_PORT,
    );
    fs::write(&torrc_path, torrc)?;
    Ok((torrc_path, hs_dir))
}

/// Spawn Tor in the background and start a stdout watcher thread that
/// updates the shared status and emits a `tor://status` event when the
/// hidden service is reachable.
///
/// Returns immediately; the watcher thread does the rest. If the tor
/// binary is missing or refuses to start, the error is recorded in
/// `state.status.error` and surfaced to the frontend via the same event.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;

    let (torrc_path, hs_dir) =
        write_torrc(&data_dir).map_err(|e| format!("could not write torrc: {e}"))?;

    // If the hidden service has been created on a previous run, the
    // hostname file already exists. Surface it to the frontend right
    // away so the UI can show the onion address before bootstrap even
    // starts — the address is stable across restarts (it's derived from
    // hs_ed25519_secret_key), so this can't go stale.
    if let Ok(existing_hostname) = read_hostname(&hs_dir) {
        let state: tauri::State<'_, TorState> = app.state();
        let mut status = state.status.lock().expect("tor status mutex poisoned");
        status.hostname = Some(existing_hostname.clone());
        let snapshot = status.clone();
        drop(status);
        log::info!("[tor] reusing existing hidden service: {existing_hostname}");
        let _ = app.emit("tor://status", snapshot);
    }

    let mut cmd = Command::new("tor");
    cmd.arg("-f")
        .arg(&torrc_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                "tor binary not found in PATH (install: pacman -S tor / brew install tor / apt install tor)".to_string()
            } else {
                format!("failed to spawn tor: {e}")
            };
            let state: tauri::State<'_, TorState> = app.state();
            let mut status = state.status.lock().expect("tor status mutex poisoned");
            status.error = Some(msg.clone());
            let _ = app.emit("tor://status", status.clone());
            return Err(msg);
        }
    };

    let stdout = child.stdout.take().expect("piped stdout absent");
    {
        let state: tauri::State<'_, TorState> = app.state();
        *state.child.lock().expect("tor child mutex poisoned") = Some(child);
    }

    let app_for_thread = app.clone();
    thread::spawn(move || watch_stdout(app_for_thread, stdout, hs_dir));

    Ok(())
}

/// Read tor's stdout line-by-line, parse "Bootstrapped N%" notices to
/// update the shared status, and once bootstrap hits 100% read the
/// hidden-service hostname file and emit the final status.
fn watch_stdout(app: AppHandle, stdout: std::process::ChildStdout, hs_dir: PathBuf) {
    let reader = BufReader::new(stdout);
    let mut hostname_emitted = false;

    for line in reader.lines().map_while(Result::ok) {
        log::info!("[tor] {line}");

        if let Some(pct) = parse_bootstrap(&line) {
            let state: tauri::State<'_, TorState> = app.state();
            let mut status = state.status.lock().expect("tor status mutex poisoned");
            status.bootstrap_pct = pct;
            let snapshot = status.clone();
            drop(status);
            let _ = app.emit("tor://status", snapshot);

            if pct == 100 && !hostname_emitted {
                match read_hostname(&hs_dir) {
                    Ok(hostname) => {
                        let state: tauri::State<'_, TorState> = app.state();
                        let mut status = state.status.lock().expect("tor status mutex poisoned");
                        status.hostname = Some(hostname.clone());
                        let snapshot = status.clone();
                        drop(status);
                        log::info!("[tor] hidden service ready at {hostname}");
                        let _ = app.emit("tor://status", snapshot);
                        hostname_emitted = true;
                    }
                    Err(e) => log::warn!("[tor] could not read hostname file yet: {e}"),
                }
            }
        }
    }
}

fn parse_bootstrap(line: &str) -> Option<u8> {
    // Tor notices look like: "[notice] Bootstrapped 45% (requesting_descriptors): ..."
    let idx = line.find("Bootstrapped ")?;
    let rest = &line[idx + "Bootstrapped ".len()..];
    let pct_end = rest.find('%')?;
    rest[..pct_end].trim().parse::<u8>().ok()
}

fn read_hostname(hs_dir: &Path) -> std::io::Result<String> {
    let path = hs_dir.join("hostname");
    let raw = fs::read_to_string(path)?;
    Ok(raw.trim().to_string())
}

/// Send SIGTERM to the Tor child, then SIGKILL if it doesn't exit cleanly.
/// Called from the RunEvent::Exit handler so Tor doesn't outlive the app.
pub fn shutdown(state: &TorState) {
    let Some(mut child) = state.child.lock().expect("tor child mutex poisoned").take() else {
        return;
    };

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        // Polite SIGTERM via libc; Child::kill sends SIGKILL.
        unsafe {
            libc::kill(child.id() as i32, libc::SIGTERM);
        }
        // Give tor ~1.5s to flush state and exit, then SIGKILL.
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    log::info!("[tor] exited cleanly: {:?}", status.code().or_else(|| status.signal()));
                    return;
                }
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(e) => {
                    log::warn!("[tor] try_wait failed: {e}");
                    break;
                }
            }
        }
    }

    if let Err(e) = child.kill() {
        log::warn!("[tor] kill failed (already exited?): {e}");
    }
    let _ = child.wait();
}

// ---------------- Backup / restore ----------------

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorBackup {
    /// Tor's v3 hidden-service key format is exact-bytes-required, so
    /// we ship them base64-encoded to survive JSON transit.
    pub public_key_b64: String,
    pub secret_key_b64: String,
    pub hostname: String,
    /// Bump if the backup file format ever changes (e.g. we add v4 onions).
    pub format_version: u32,
}

const BACKUP_FORMAT_VERSION: u32 = 1;

fn base64_encode(bytes: &[u8]) -> String {
    // Hand-rolled to avoid pulling a base64 crate just for this. Standard
    // RFC 4648 alphabet, no line wrap.
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        out.push(ALPHABET[(b0 >> 2) as usize] as char);
        out.push(ALPHABET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn base64_decode(s: &str) -> Result<Vec<u8>, &'static str> {
    fn val(c: u8) -> Result<u8, &'static str> {
        match c {
            b'A'..=b'Z' => Ok(c - b'A'),
            b'a'..=b'z' => Ok(c - b'a' + 26),
            b'0'..=b'9' => Ok(c - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err("invalid base64 char"),
        }
    }
    let bytes: Vec<u8> = s.bytes().filter(|&b| !b.is_ascii_whitespace()).collect();
    if bytes.len() % 4 != 0 {
        return Err("base64 length not multiple of 4");
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad0 = chunk[2] == b'=';
        let pad1 = chunk[3] == b'=';
        let v0 = val(chunk[0])?;
        let v1 = val(chunk[1])?;
        out.push((v0 << 2) | (v1 >> 4));
        if !pad0 {
            let v2 = val(chunk[2])?;
            out.push((v1 << 4) | (v2 >> 2));
            if !pad1 {
                let v3 = val(chunk[3])?;
                out.push((v2 << 6) | v3);
            }
        }
    }
    Ok(out)
}

fn hs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    Ok(data_dir.join("tor").join("hs"))
}

// ---------------- Tauri commands ----------------

#[tauri::command]
pub fn tor_status(state: tauri::State<'_, TorState>) -> TorStatus {
    state.status.lock().expect("tor status mutex poisoned").clone()
}

#[tauri::command]
pub fn tor_onion(state: tauri::State<'_, TorState>) -> Option<String> {
    state.status.lock().expect("tor status mutex poisoned").hostname.clone()
}

/// Read the hidden-service key files and return them as a base64-encoded
/// backup payload. The caller is expected to wrap this in passphrase
/// encryption (via the existing Wash flow) before writing to disk — the
/// raw secret key reproduces this identity for anyone who possesses it.
#[tauri::command]
pub fn tor_backup_keys(app: AppHandle) -> Result<TorBackup, String> {
    let dir = hs_dir(&app)?;
    let public = fs::read(dir.join("hs_ed25519_public_key"))
        .map_err(|e| format!("could not read public key: {e}"))?;
    let secret = fs::read(dir.join("hs_ed25519_secret_key"))
        .map_err(|e| format!("could not read secret key: {e}"))?;
    let hostname = fs::read_to_string(dir.join("hostname"))
        .map_err(|e| format!("could not read hostname: {e}"))?
        .trim()
        .to_string();
    Ok(TorBackup {
        public_key_b64: base64_encode(&public),
        secret_key_b64: base64_encode(&secret),
        hostname,
        format_version: BACKUP_FORMAT_VERSION,
    })
}

/// Replace the local hidden-service identity with the one in `backup`.
/// Stops the running Tor process, writes the keys atomically, then
/// respawns Tor against the new identity. The .onion address surfaced
/// via `tor_status` will change to match the imported keys.
///
/// The user is responsible for understanding that this overwrites their
/// current identity — old invites pointing at the previous .onion will
/// stop resolving.
#[tauri::command]
pub fn tor_restore_keys(app: AppHandle, backup: TorBackup) -> Result<(), String> {
    if backup.format_version != BACKUP_FORMAT_VERSION {
        return Err(format!(
            "unsupported backup format version {} (this build expects {BACKUP_FORMAT_VERSION})",
            backup.format_version
        ));
    }
    let public = base64_decode(&backup.public_key_b64)
        .map_err(|e| format!("public key not valid base64: {e}"))?;
    let secret = base64_decode(&backup.secret_key_b64)
        .map_err(|e| format!("secret key not valid base64: {e}"))?;

    let dir = hs_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create hs dir: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("could not chmod hs dir: {e}"))?;
    }

    // Stop the current Tor before swapping keys. Tor reads the secret
    // key once at startup; if we replaced it while running, the
    // already-published hidden service would keep accepting connections
    // at the old descriptor until next descriptor upload.
    let state: tauri::State<'_, TorState> = app.state();
    shutdown(&state);
    // Reset the in-memory state so the UI doesn't keep showing the old
    // hostname during the brief restart window.
    {
        let mut status = state.status.lock().expect("tor status mutex poisoned");
        *status = TorStatus::empty();
    }

    write_key_file(&dir.join("hs_ed25519_public_key"), &public)?;
    write_key_file(&dir.join("hs_ed25519_secret_key"), &secret)?;
    fs::write(dir.join("hostname"), format!("{}\n", backup.hostname))
        .map_err(|e| format!("could not write hostname: {e}"))?;

    // Restart Tor with the imported identity. start() emits a fresh
    // tor://status event so the UI updates.
    start(&app).map_err(|e| format!("failed to restart tor: {e}"))?;
    Ok(())
}

fn write_key_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("could not chmod {}: {e}", path.display()))?;
    }
    Ok(())
}
