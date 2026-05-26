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

    let torrc = format!(
        "DataDirectory {data}\n\
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

// ---------------- Tauri commands ----------------

#[tauri::command]
pub fn tor_status(state: tauri::State<'_, TorState>) -> TorStatus {
    state.status.lock().expect("tor status mutex poisoned").clone()
}

#[tauri::command]
pub fn tor_onion(state: tauri::State<'_, TorState>) -> Option<String> {
    state.status.lock().expect("tor status mutex poisoned").hostname.clone()
}
