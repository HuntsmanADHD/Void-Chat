//! Spawn the bundled relay sidecar (Rust port of the old Node relay).
//!
//! The binary is staged by `build.rs` into `src-tauri/binaries/` with
//! Tauri's `<name>-<target-triple>` naming, and `tauri.conf.json`
//! lists it under `bundle.externalBin` so Tauri places a copy next to
//! the app binary in dev and bundles it into the installer in prod.
//! At runtime we resolve the path via `current_exe()` and spawn it as
//! a child of this process — matches how `tor.rs` spawns the tor
//! sidecar, keeps lifecycle bound to the parent.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Manager};

/// The relay binary name without target-triple suffix. Tauri appends
/// the suffix at install time so the on-disk name in the app dir
/// becomes `voidchat-relay` (no suffix) — same convention as
/// `tor-runtime`.
const RELAY_BIN: &str = "voidchat-relay";

/// Default port — pinned to match the frontend's apiUrl() and
/// realtime socket.io URL. The relay binds 127.0.0.1 only.
const RELAY_PORT: u16 = 3001;

/// Stored handle to the relay child so the Tauri shutdown hook can
/// terminate it cleanly. `None` means "not running" (start failed or
/// not started yet).
pub struct RelayState {
    child: Mutex<Option<Child>>,
}

impl RelayState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// Spawn the relay alongside Tor at app startup. Failures are logged
/// but don't block app launch — the frontend already surfaces "can't
/// reach relay" as a connection-state banner, so the user sees a real
/// failure mode rather than a phantom hang.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let bin_path = resolve_binary(app)?;
    log::info!("[relay] spawning sidecar: {}", bin_path.display());

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app_data_dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("create app_data_dir: {e}"))?;

    let mut cmd = Command::new(&bin_path);
    cmd.env("SOCKET_PORT", RELAY_PORT.to_string())
        .env("VOIDCHAT_DATA_DIR", &data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // CORS:
    //   Release builds inherit the relay's compiled-in production
    //   default (`tauri://localhost`, `https://tauri.localhost`,
    //   `http://tauri.localhost`) — exactly the webview origins.
    //
    //   Debug builds also need vite's dev origin (`localhost:5173`)
    //   because `tauri dev` loads the webview from the vite dev
    //   server, so the renderer's Origin header is the vite URL.
    //   Without this override, every fetch from the renderer gets
    //   CORS-blocked even though the relay is responding.
    if cfg!(debug_assertions) {
        cmd.env(
            "CORS_ORIGIN",
            "http://localhost:5173,http://localhost:1420,tauri://localhost,https://tauri.localhost,http://tauri.localhost",
        );
    }

    // PR_SET_PDEATHSIG: send SIGTERM to the child when this parent
    // dies for ANY reason — clean shutdown, panic, SIGKILL, crashed
    // dev session, terminal closed. Without this, a parent that
    // doesn't get a chance to run its shutdown handler leaves the
    // relay orphaned on :3001, and the next launch fails to bind
    // because the old relay is still there. Hit this exact bug
    // during the v0.2 cutover; locking it down so it doesn't recur.
    #[cfg(target_os = "linux")]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            // PR_SET_PDEATHSIG = 1, SIGTERM = 15
            let r = libc::prctl(1, 15, 0, 0, 0);
            if r != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn relay at {}: {e}", bin_path.display()))?;

    // Drain stdout + stderr so the pipe buffer never fills (which
    // would otherwise block the relay's logger thread). Mirror to our
    // log macros so users see relay output in the Tauri console.
    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || drain("stdout", stdout));
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || drain("stderr", stderr));
    }

    let state: tauri::State<'_, RelayState> = app.state();
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }
    Ok(())
}

/// Best-effort stop. Called from the Tauri exit handler and the
/// ctrlc handler. Loses race with a relay that's already exited, which
/// is fine — `wait()` will just succeed.
pub fn shutdown(state: &RelayState) {
    let Ok(mut guard) = state.child.lock() else {
        return;
    };
    let Some(mut child) = guard.take() else {
        return;
    };
    if let Err(e) = child.kill() {
        log::warn!("[relay] kill failed: {e}");
    }
    let _ = child.wait();
}

fn resolve_binary(app: &AppHandle) -> Result<PathBuf, String> {
    // Tauri places external binaries next to the main app binary
    // (with the target-triple stripped). We could read the path from
    // current_exe() and look in its directory, which is the standard
    // sidecar lookup.
    let exe = std::env::current_exe()
        .map_err(|e| format!("current_exe failed: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "current_exe has no parent dir".to_string())?;

    let candidates = [
        dir.join(RELAY_BIN),
        dir.join(format!("{RELAY_BIN}.exe")),
    ];
    for c in &candidates {
        if c.exists() {
            return Ok(c.clone());
        }
    }

    // Dev fallback: when running via `tauri dev`, tauri-cli builds
    // the binary but does NOT stage externalBin entries next to the
    // dev exe (that staging is only done for `tauri build`). Fall
    // back to the absolute path embedded by build.rs at compile time
    // — that always points at the freshly-built sidecar under
    // src-tauri/binaries/<name>-<triple>.
    if let Some(staged) = option_env!("VOIDCHAT_RELAY_DEV_PATH") {
        let p = PathBuf::from(staged);
        if p.exists() {
            return Ok(p);
        }
    }

    // Last-ditch: search the Tauri resource dir.
    if let Ok(res_dir) = app.path().resource_dir() {
        let resource_candidates = [
            res_dir.join("binaries").join(RELAY_BIN),
            res_dir.join(RELAY_BIN),
        ];
        for c in &resource_candidates {
            if c.exists() {
                return Ok(c.clone());
            }
        }
    }

    Err(format!(
        "relay binary not found next to {} or in resource dir",
        exe.display()
    ))
}

fn drain<R: std::io::Read + Send + 'static>(label: &'static str, reader: R) {
    use std::io::{BufRead, BufReader};
    let mut br = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match br.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => log::info!("[relay/{label}] {}", line.trim_end()),
            Err(_) => break,
        }
    }
}
