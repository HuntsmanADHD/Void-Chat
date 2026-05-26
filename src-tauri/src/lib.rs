mod proxy;
mod tor;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(tor::TorState::new())
        .invoke_handler(tauri::generate_handler![
            tor::tor_status,
            tor::tor_onion,
            tor::tor_backup_keys,
            tor::tor_restore_keys,
            tor::tor_get_bridges,
            tor::tor_set_bridges,
            tor::tor_has_obfs4proxy,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Native dialog plugin — needed by tor_backup_keys /
            // tor_restore_keys to surface an OS-level confirmation
            // before exporting the .onion secret key. JS can invoke
            // the IPC, but the user sees the prompt and can decline,
            // turning any silent XSS-driven exfil into a noisy one.
            app.handle().plugin(tauri_plugin_dialog::init())?;
            // Spawn tor in the background. Failures are recorded in TorState
            // and surfaced via `tor://status` events; we don't block startup.
            if let Err(e) = tor::start(app.handle()) {
                log::warn!("tor failed to start: {e}");
            }
            // Start the localhost forward proxy that lets the frontend
            // reach remote .onion relays via SOCKS5 through Tor. Same
            // failure mode: log and continue — proxy unavailability just
            // means cross-host joins won't work this session.
            if let Err(e) = proxy::start() {
                log::warn!("onion proxy failed to start: {e}");
            }
            // Install a Ctrl-C / SIGTERM handler so terminal kills shut
            // tor down cleanly. Tauri's RunEvent::Exit fires only on
            // graceful shutdowns (window close); a SIGINT propagated
            // through the cargo dev wrapper would otherwise orphan tor
            // and leave it holding ports 19050/19051 across runs.
            let handle_for_signal = app.handle().clone();
            if let Err(e) = ctrlc::set_handler(move || {
                log::info!("[shutdown] signal received, stopping tor child");
                let state: tauri::State<'_, tor::TorState> = handle_for_signal.state();
                tor::shutdown(&state);
                std::process::exit(0);
            }) {
                log::warn!("could not install signal handler: {e}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state: tauri::State<'_, tor::TorState> = app_handle.state();
            tor::shutdown(&state);
        }
    });
}
