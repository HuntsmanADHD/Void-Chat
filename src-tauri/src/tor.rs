use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Port the Tor child binds for SOCKS (used by Phase 4 outbound dialing).
/// Picked above the default 9050 to avoid colliding with a system tor.
pub const SOCKS_PORT: u16 = 19050;

/// Port the Tor child binds for the control protocol. Phase 6 still parses
/// stdout for bootstrap (simpler); cookie-auth control-port is wired so
/// future code can `GETINFO status/bootstrap-phase` for richer status.
pub const CONTROL_PORT: u16 = 19051;

/// Virtual port the hidden service listens on. Maps to the relay's
/// localhost:3001 (HTTP + socket.io).
pub const HS_VIRT_PORT: u16 = 80;

/// What the hidden service forwards to internally.
pub const RELAY_LOCAL_PORT: u16 = 3001;

/// Bootstrap is considered stalled if no progress arrives for this long
/// while we're still below 100%. The user gets a UI nudge to consider
/// bridges. Tor itself can stall for ~15s on fresh circuits, so 30s
/// avoids false positives while still being snappy.
const STALL_THRESHOLD: Duration = Duration::from_secs(30);

/// How long the watchdog sleeps between stall checks.
const WATCHDOG_TICK: Duration = Duration::from_secs(5);

/// Cap on automatic restarts within RESTART_WINDOW. Beyond this we give
/// up — usually it means tor's misconfigured or a port is permanently
/// taken, and infinite respawn would just spam the log.
const MAX_AUTO_RESTARTS: u32 = 5;
const RESTART_WINDOW: Duration = Duration::from_secs(60);

/// Backoff between automatic restarts. Tor's directory descriptors take
/// a few seconds to refresh even on a clean restart, so this matches
/// the lower bound of usefully retrying.
const RESTART_BACKOFF: Duration = Duration::from_secs(3);

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
    /// True when bootstrap progress hasn't advanced for STALL_THRESHOLD
    /// and we're still under 100%. The UI surfaces a "try bridges" hint
    /// when this is set. Cleared automatically when progress resumes.
    pub stalled: bool,
    /// How many times this session we've had to auto-restart Tor after
    /// an unexpected exit. Zero is the happy path; non-zero is a signal
    /// to the user that something flaky is going on.
    pub restart_count: u32,
    /// True when the torrc currently uses bridges (obfs4). UI surfaces
    /// this so the user knows whether they're in censored-network mode.
    pub bridges_enabled: bool,
}

impl TorStatus {
    fn empty() -> Self {
        Self {
            bootstrap_pct: 0,
            hostname: None,
            error: None,
            stalled: false,
            restart_count: 0,
            bridges_enabled: false,
        }
    }
}

/// Tauri-managed state.
pub struct TorState {
    /// The currently-running Tor child. `.take()` from `shutdown()` so
    /// we can SIGTERM it; refilled by `start()`.
    pub child: Mutex<Option<Child>>,
    pub status: Mutex<TorStatus>,
    /// Time of the last bootstrap-progress line. Used by the stall
    /// watchdog. None until tor has emitted at least one Bootstrapped line.
    last_progress_at: Mutex<Option<Instant>>,
    /// Set true by `shutdown()` to tell the watcher thread that any
    /// subsequent stdout EOF is intentional, NOT a crash. Reset by
    /// `start()` before launching a new child.
    shutting_down: Mutex<bool>,
    /// Generation counter — bumped by every `start()` call. Each watcher
    /// thread captures the value it was spawned for; on EOF it only
    /// triggers an auto-restart if its captured value still matches the
    /// current one. Without this, an old watcher whose process died
    /// during a user-initiated restart (set_bridges / restore_keys)
    /// could re-fire `start()` after we'd already launched a fresh
    /// child, overwriting the live Child handle with a stale one.
    generation: AtomicU64,
    /// Rolling list of recent restart timestamps. Bounded at MAX_AUTO_RESTARTS;
    /// older entries are dropped. Used to decide whether to keep retrying.
    restart_history: Mutex<Vec<Instant>>,
    /// Set once at startup so the watchdog thread isn't spawned twice
    /// (e.g. across user-triggered restarts via tor_restore_keys).
    watchdog_started: Mutex<bool>,
}

impl TorState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(TorStatus::empty()),
            last_progress_at: Mutex::new(None),
            shutting_down: Mutex::new(false),
            generation: AtomicU64::new(0),
            restart_history: Mutex::new(Vec::new()),
            watchdog_started: Mutex::new(false),
        }
    }
}

/// Path to the bridges file. One bridge line per file row; empty file =
/// bridges disabled. Lives next to torrc in the app data dir.
fn bridges_file(data_dir: &Path) -> PathBuf {
    data_dir.join("tor").join("bridges.txt")
}

fn read_bridges(data_dir: &Path) -> Vec<String> {
    let path = bridges_file(data_dir);
    let Ok(content) = fs::read_to_string(&path) else { return Vec::new() };
    content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(String::from)
        .collect()
}

/// Resolve where the bundled Tor runtime lives. Returns the runtime
/// *directory* (containing tor + libs), not the binary path. We need
/// the directory so we can both spawn `<dir>/tor` and set
/// `LD_LIBRARY_PATH=<dir>` so it loads its own bundled libevent/openssl.
///
/// Preference order:
///   1. **Tauri's resource_dir** in production. Bundled via the
///      `bundle.resources` config in tauri.conf.json — the entire
///      `binaries/tor-runtime/` directory gets copied next to the app.
///   2. **`src-tauri/binaries/tor-runtime/`** — dev location populated
///      by `scripts/fetch-tor-binaries.sh`. Same code path as prod.
///
/// Returns None if no bundled runtime is found; the caller then falls
/// back to spawning a system tor on PATH.
fn find_tor_runtime(app: &AppHandle) -> Option<PathBuf> {
    let binary_name = if cfg!(windows) { "tor.exe" } else { "tor" };

    // (1) Production: Tauri's resource directory. Tauri preserves the
    // source-relative path of `bundle.resources` entries — we ship
    // `binaries/tor-runtime`, so the bundled layout is
    // `<resource_dir>/binaries/tor-runtime/`. Also check the bare
    // `tor-runtime/` location in case a future bundling change
    // flattens the path.
    if let Ok(resource_dir) = app.path().resource_dir() {
        for sub in &["binaries/tor-runtime", "tor-runtime"] {
            let candidate = resource_dir.join(sub);
            if candidate.join(binary_name).exists() {
                return Some(candidate);
            }
        }
    }

    // (2) Dev: source-relative paths. `cargo run` cwd is src-tauri, so
    // `binaries/tor-runtime` works there. From repo root we need the
    // src-tauri prefix.
    for prefix in &["binaries/tor-runtime", "src-tauri/binaries/tor-runtime"] {
        let candidate = PathBuf::from(prefix);
        if candidate.join(binary_name).exists() {
            return Some(candidate);
        }
    }

    None
}

/// Compose the tor binary path + the env vars needed to run it. The
/// `library_path_env` value is intended for the platform-appropriate
/// dynamic-loader variable: `LD_LIBRARY_PATH` on Linux,
/// `DYLD_LIBRARY_PATH` on macOS, `PATH` on Windows.
fn resolve_tor_command(app: &AppHandle) -> (PathBuf, Option<PathBuf>) {
    if let Some(runtime) = find_tor_runtime(app) {
        let binary_name = if cfg!(windows) { "tor.exe" } else { "tor" };
        let bin = runtime.join(binary_name);
        log::info!("[tor] using bundled runtime at {}", runtime.display());

        // Defensive: ensure the binary is executable. Tauri's
        // `bundle.resources` was designed for static assets (images,
        // JSON), not executables, and per-platform behavior around
        // preserving the +x bit through .deb / AppImage / .dmg / .msi
        // packaging isn't uniformly documented. A cheap idempotent
        // chmod here means we recover if the bit got stripped.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&bin, fs::Permissions::from_mode(0o755));
            // Same for lyrebird / other pluggable transports if present.
            let pt_dir = runtime.join("pluggable_transports");
            if pt_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&pt_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
                        }
                    }
                }
            }
        }

        (bin, Some(runtime))
    } else {
        log::info!("[tor] no bundled runtime; falling back to system `tor` on PATH");
        (PathBuf::from("tor"), None)
    }
}

/// Name of the platform's dynamic-loader-path environment variable.
/// We set this on the Tor child process so it finds the bundled libs.
#[cfg(target_os = "macos")]
const LIB_PATH_ENV: &str = "DYLD_LIBRARY_PATH";
#[cfg(target_os = "windows")]
const LIB_PATH_ENV: &str = "PATH";
#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
const LIB_PATH_ENV: &str = "LD_LIBRARY_PATH";

/// Look for an obfs4 pluggable-transport binary. Returns the path Tor's
/// `ClientTransportPlugin` line should reference, or None if no
/// compatible binary is anywhere we know to check.
///
/// Order matters: the bundled `lyrebird` from our Tor Expert Bundle is
/// preferred so shipped builds work end-to-end without any system
/// install. Falls back to system locations for dev setups using a
/// system tor, or for users who skipped the fetch script.
fn find_obfs4proxy(app: &AppHandle) -> Option<PathBuf> {
    // (1) Bundled with our Tor runtime. lyrebird is the modern obfs4
    // replacement Tor Browser ships in the Expert Bundle.
    if let Some(runtime) = find_tor_runtime(app) {
        let bundled = runtime.join("pluggable_transports").join(
            if cfg!(windows) { "lyrebird.exe" } else { "lyrebird" },
        );
        if bundled.exists() {
            return Some(bundled);
        }
    }

    // (2) System install paths.
    let candidates = [
        "/usr/bin/obfs4proxy",
        "/usr/lib/obfs4proxy/obfs4proxy",
        "/usr/local/bin/obfs4proxy",
        "/opt/homebrew/bin/obfs4proxy",
        "/usr/bin/lyrebird", // newer Debian/Ubuntu name for obfs4proxy
    ];
    candidates.iter().map(PathBuf::from).find(|p| p.exists())
}

/// Write the torrc and return the path to it + the hidden-service dir.
fn write_torrc(
    app: &AppHandle,
    data_dir: &Path,
    bridges: &[String],
) -> std::io::Result<(PathBuf, PathBuf)> {
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
    let mut torrc = format!(
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

    // Bridge configuration. Only emit if the user actually has bridges
    // configured — adding `UseBridges 1` without any `Bridge` lines makes
    // tor refuse to start entirely.
    if !bridges.is_empty() {
        torrc.push_str("UseBridges 1\n");
        if let Some(obfs4) = find_obfs4proxy(app) {
            torrc.push_str(&format!(
                "ClientTransportPlugin obfs4 exec {}\n",
                obfs4.display(),
            ));
        }
        for bridge in bridges {
            torrc.push_str(&format!("Bridge {bridge}\n"));
        }
    }

    fs::write(&torrc_path, torrc)?;
    Ok((torrc_path, hs_dir))
}

/// Spawn Tor in the background and start a stdout watcher thread that
/// updates the shared status and emits a `tor://status` event when the
/// hidden service is reachable.
///
/// Safe to call after `shutdown()` — the previous child has been killed,
/// state has been reset, and a fresh process takes over. The stall
/// watchdog is started only once across the app's lifetime.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;

    let bridges = read_bridges(&data_dir);
    let bridges_enabled = !bridges.is_empty();

    let (torrc_path, hs_dir) = write_torrc(app, &data_dir, &bridges)
        .map_err(|e| format!("could not write torrc: {e}"))?;

    // Tell the watcher thread that EOF on stdout from here on means a
    // legitimate restart, not a crash to be auto-recovered. Cleared
    // explicitly below before we spawn the new child.
    {
        let state: tauri::State<'_, TorState> = app.state();
        *state.shutting_down.lock().expect("shutting_down mutex poisoned") = false;
        let mut status = state.status.lock().expect("tor status mutex poisoned");
        status.bridges_enabled = bridges_enabled;
        status.stalled = false;
        // Don't reset restart_count — the UI uses it as a session-wide
        // reliability indicator.
        let snapshot = status.clone();
        drop(status);
        let _ = app.emit("tor://status", snapshot);
    }

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

    let (tor_path, lib_dir) = resolve_tor_command(app);
    let mut cmd = Command::new(&tor_path);
    cmd.arg("-f")
        .arg(&torrc_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // When using the bundled runtime, point the dynamic loader at our
    // libs first — the Expert Bundle ships with no RPATH, and its
    // tor was built against specific libevent/openssl versions that
    // may not match what's on the host system. Without this the
    // bundled tor crashes at startup with missing-symbol errors.
    if let Some(dir) = lib_dir {
        let dir_str = dir.to_string_lossy().to_string();
        let merged = match std::env::var(LIB_PATH_ENV) {
            Ok(existing) if !existing.is_empty() => format!("{dir_str}:{existing}"),
            _ => dir_str,
        };
        cmd.env(LIB_PATH_ENV, merged);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "tor binary not found (tried bundled sidecar and PATH). \
                     Run scripts/fetch-tor-binaries.sh, or install tor: \
                     pacman -S tor / brew install tor / apt install tor"
                )
            } else {
                format!("failed to spawn tor at {}: {e}", tor_path.display())
            };
            let state: tauri::State<'_, TorState> = app.state();
            let mut status = state.status.lock().expect("tor status mutex poisoned");
            status.error = Some(msg.clone());
            let _ = app.emit("tor://status", status.clone());
            return Err(msg);
        }
    };

    let stdout = child.stdout.take().expect("piped stdout absent");
    let stderr = child.stderr.take().expect("piped stderr absent");
    // Bump generation BEFORE we publish the new Child handle. Old
    // watchers that wake up after this point will compare-and-bail.
    let my_generation = {
        let state: tauri::State<'_, TorState> = app.state();
        let g = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *state.child.lock().expect("tor child mutex poisoned") = Some(child);
        // Reset progress timestamp so the stall watchdog gives this new
        // process a full STALL_THRESHOLD before complaining.
        *state.last_progress_at.lock().expect("last_progress_at mutex poisoned") =
            Some(Instant::now());
        g
    };

    // Start the stall watchdog the first time we ever spawn tor. It
    // runs for the lifetime of the app and re-checks every WATCHDOG_TICK.
    {
        let state: tauri::State<'_, TorState> = app.state();
        let mut started = state.watchdog_started.lock().expect("watchdog_started mutex poisoned");
        if !*started {
            *started = true;
            drop(started);
            let app_for_watchdog = app.clone();
            thread::spawn(move || stall_watchdog(app_for_watchdog));
        }
    }

    // Drain stderr in its own thread. Tor's stderr is usually quiet, but
    // bridge misconfigs and obfs4proxy crashes write here; leaving the
    // pipe undrained would eventually fill its buffer and block the
    // child. Lines go to our log at warn level.
    thread::spawn(move || drain_stderr(stderr));

    let app_for_thread = app.clone();
    thread::spawn(move || watch_stdout(app_for_thread, stdout, hs_dir, my_generation));

    Ok(())
}

/// Read tor's stderr and route each line to our log. Exists purely to
/// keep the pipe buffer from filling — see the comment at the spawn
/// site for why this matters.
fn drain_stderr(stderr: std::process::ChildStderr) {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        if !line.is_empty() {
            log::warn!("[tor stderr] {line}");
        }
    }
}

/// Read tor's stdout line-by-line, parse "Bootstrapped N%" notices to
/// update the shared status, and once bootstrap hits 100% read the
/// hidden-service hostname file and emit the final status.
///
/// When the loop ends (EOF = child exited), check the `shutting_down`
/// flag and the generation counter. If shutdown was intentional, or a
/// newer generation has already started, this watcher belongs to a
/// stale process — exit silently. Otherwise kick off an auto-restart
/// with backoff, capped at MAX_AUTO_RESTARTS in RESTART_WINDOW.
fn watch_stdout(
    app: AppHandle,
    stdout: std::process::ChildStdout,
    hs_dir: PathBuf,
    my_generation: u64,
) {
    let reader = BufReader::new(stdout);
    let mut hostname_emitted = false;

    for line in reader.lines().map_while(Result::ok) {
        log::info!("[tor] {line}");

        if let Some(pct) = parse_bootstrap(&line) {
            let state: tauri::State<'_, TorState> = app.state();
            let mut status = state.status.lock().expect("tor status mutex poisoned");
            status.bootstrap_pct = pct;
            // Any forward progress clears the stall flag and bumps the
            // last-progress timestamp.
            status.stalled = false;
            let snapshot = status.clone();
            drop(status);
            *state.last_progress_at.lock().expect("last_progress_at mutex poisoned") =
                Some(Instant::now());
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

    // EOF on stdout = the child exited. Three cases:
    //   1. Another generation has already started → this watcher is a
    //      ghost of a process that was killed during a user-initiated
    //      restart (set_bridges / restore_keys). Exit silently;
    //      whoever started the new process owns the Child handle.
    //   2. Intentional shutdown (RunEvent::Exit). Exit silently.
    //   3. Otherwise: an actual crash. Trigger auto-restart.
    let state: tauri::State<'_, TorState> = app.state();
    let current_generation = state.generation.load(Ordering::SeqCst);
    if current_generation != my_generation {
        log::info!(
            "[tor] watcher (gen {my_generation}) superseded by gen {current_generation} — exiting"
        );
        return;
    }
    let was_intentional = *state.shutting_down.lock().expect("shutting_down mutex poisoned");
    if was_intentional {
        log::info!("[tor] watcher exiting: intentional shutdown");
        return;
    }

    log::warn!("[tor] watcher saw EOF: child exited unexpectedly");
    // Reap the zombie if we still hold a Child handle.
    if let Some(mut child) = state.child.lock().expect("tor child mutex poisoned").take() {
        let _ = child.wait();
    }

    // Record restart and bail if we're flapping.
    let now = Instant::now();
    let restart_count = {
        let mut history = state.restart_history.lock().expect("restart_history mutex poisoned");
        history.retain(|&t| now.duration_since(t) < RESTART_WINDOW);
        if history.len() as u32 >= MAX_AUTO_RESTARTS {
            log::error!(
                "[tor] giving up: {MAX_AUTO_RESTARTS} restarts within {}s",
                RESTART_WINDOW.as_secs()
            );
            let mut status = state.status.lock().expect("tor status mutex poisoned");
            status.error = Some(format!(
                "Tor crashed {MAX_AUTO_RESTARTS} times in a row — auto-restart disabled. Check logs."
            ));
            let _ = app.emit("tor://status", status.clone());
            return;
        }
        history.push(now);
        history.len() as u32
    };

    // Surface the restart in the status so the UI can show "Tor restarted N times".
    {
        let mut status = state.status.lock().expect("tor status mutex poisoned");
        status.restart_count = restart_count;
        status.bootstrap_pct = 0; // fresh process starts from zero
        let snapshot = status.clone();
        drop(status);
        let _ = app.emit("tor://status", snapshot);
    }

    log::info!("[tor] auto-restarting in {}s (attempt {restart_count})", RESTART_BACKOFF.as_secs());
    thread::sleep(RESTART_BACKOFF);
    if let Err(e) = start(&app) {
        log::error!("[tor] auto-restart failed: {e}");
    }
}

/// Periodically check whether bootstrap is stuck below 100% with no
/// progress for STALL_THRESHOLD. Emits a stall flag the UI can show.
fn stall_watchdog(app: AppHandle) {
    loop {
        thread::sleep(WATCHDOG_TICK);
        let state: tauri::State<'_, TorState> = app.state();
        let (bootstrap_pct, currently_stalled) = {
            let status = state.status.lock().expect("tor status mutex poisoned");
            (status.bootstrap_pct, status.stalled)
        };
        if bootstrap_pct >= 100 {
            // Already bootstrapped — nothing to detect.
            continue;
        }
        let elapsed_since_progress = {
            let guard = state.last_progress_at.lock().expect("last_progress_at mutex poisoned");
            guard.map(|t| t.elapsed())
        };
        let should_stall = matches!(elapsed_since_progress, Some(elapsed) if elapsed > STALL_THRESHOLD);
        if should_stall && !currently_stalled {
            let mut status = state.status.lock().expect("tor status mutex poisoned");
            status.stalled = true;
            let snapshot = status.clone();
            drop(status);
            log::warn!("[tor] bootstrap stalled at {bootstrap_pct}% for >{}s", STALL_THRESHOLD.as_secs());
            let _ = app.emit("tor://status", snapshot);
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
/// Called from the RunEvent::Exit handler so Tor doesn't outlive the app,
/// and from tor_restore_keys before swapping the identity files.
///
/// Sets the `shutting_down` flag so the watcher thread knows the next
/// EOF is intentional and skips the auto-restart path.
pub fn shutdown(state: &TorState) {
    *state.shutting_down.lock().expect("shutting_down mutex poisoned") = true;

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
        let deadline = Instant::now() + Duration::from_millis(1500);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    log::info!("[tor] exited cleanly: {:?}", status.code().or_else(|| status.signal()));
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    thread::sleep(Duration::from_millis(50));
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

/// Read the current bridges file as a single string (one bridge per
/// line) so the UI can show what the user previously entered. Empty
/// string means bridges aren't configured.
#[tauri::command]
pub fn tor_get_bridges(app: AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    let path = bridges_file(&data_dir);
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("could not read bridges file: {e}")),
    }
}

/// Replace the bridges file and restart Tor so the new config takes
/// effect. Empty `bridges_text` disables bridges entirely.
///
/// Bridge lines look like:
///     obfs4 ip:port fingerprint cert=... iat-mode=0
/// or just:
///     ip:port [fingerprint]
/// Tor validates the lines itself at startup; if any are malformed the
/// new tor process will fail to bootstrap and surface an error.
#[tauri::command]
pub fn tor_set_bridges(app: AppHandle, bridges_text: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    let path = bridges_file(&data_dir);
    fs::create_dir_all(path.parent().expect("bridges file has no parent"))
        .map_err(|e| format!("could not create tor dir: {e}"))?;
    fs::write(&path, bridges_text).map_err(|e| format!("could not write bridges file: {e}"))?;

    // Restart Tor so the new torrc is applied. tor_restore_keys does
    // the same dance; share the pattern.
    let state: tauri::State<'_, TorState> = app.state();
    shutdown(&state);
    {
        let mut status = state.status.lock().expect("tor status mutex poisoned");
        status.bootstrap_pct = 0;
        status.stalled = false;
    }
    start(&app).map_err(|e| format!("failed to restart tor: {e}"))
}

/// Best-effort check for an obfs4-compatible pluggable-transport binary
/// (either bundled `lyrebird` or system `obfs4proxy`). The frontend
/// uses this to warn the user when bridges that need obfs4 won't work.
#[tauri::command]
pub fn tor_has_obfs4proxy(app: AppHandle) -> bool {
    find_obfs4proxy(&app).is_some()
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
    // hostname during the brief restart window. Preserve restart_count
    // since it's a session-wide indicator.
    {
        let mut status = state.status.lock().expect("tor status mutex poisoned");
        let preserved_restarts = status.restart_count;
        *status = TorStatus::empty();
        status.restart_count = preserved_restarts;
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
