mod proxy;
mod relay;
mod tor;
mod wash;

use tauri::{Emitter, Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(tor::TorState::new())
        .manage(relay::RelayState::new())
        .invoke_handler(tauri::generate_handler![
            tor::tor_status,
            tor::tor_onion,
            tor::tor_backup_keys,
            tor::tor_restore_keys,
            tor::tor_get_bridges,
            tor::tor_set_bridges,
            tor::tor_has_obfs4proxy,
            proxy::get_proxy_token,
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
            // Spawn the Rust relay sidecar before tor. Tor's hidden
            // service maps 127.0.0.1:3001 → the relay; if the relay
            // isn't listening when a client dials the onion, the
            // first connect just fails. Bringing the relay up first
            // closes that race.
            if let Err(e) = relay::start(app.handle()) {
                log::warn!("relay failed to start: {e}");
            }
            // Spawn tor in the background. Failures are recorded in TorState
            // and surfaced via `tor://status` events; we don't block startup.
            if let Err(e) = tor::start(app.handle()) {
                log::warn!("tor failed to start: {e}");
            }
            // Start the localhost forward proxy that lets the frontend
            // reach remote .onion relays via SOCKS5 through Tor. If
            // the bind fails (port collision, sandbox restriction)
            // cross-host comms won't work — surface that to the UI
            // via the `proxy://status` event so the user sees a real
            // failure mode instead of "I clicked a remote invite and
            // it just hung".
            if let Err(e) = proxy::start() {
                let msg = format!("Onion proxy failed to start: {e}. Cross-host invites will not work this session.");
                log::error!("{msg}");
                let _ = app.handle().emit(
                    "proxy://status",
                    serde_json::json!({ "ok": false, "error": msg }),
                );
            } else {
                let _ = app.handle().emit(
                    "proxy://status",
                    serde_json::json!({ "ok": true, "error": null }),
                );
            }
            // Install a Ctrl-C / SIGTERM handler so terminal kills shut
            // tor down cleanly. Tauri's RunEvent::Exit fires only on
            // graceful shutdowns (window close); a SIGINT propagated
            // through the cargo dev wrapper would otherwise orphan tor
            // and leave it holding ports 19050/19051 across runs.
            let handle_for_signal = app.handle().clone();
            if let Err(e) = ctrlc::set_handler(move || {
                log::info!("[shutdown] signal received, stopping relay + tor children");
                let relay_state: tauri::State<'_, relay::RelayState> = handle_for_signal.state();
                relay::shutdown(&relay_state);
                let tor_state: tauri::State<'_, tor::TorState> = handle_for_signal.state();
                tor::shutdown(&tor_state);
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
            let relay_state: tauri::State<'_, relay::RelayState> = app_handle.state();
            relay::shutdown(&relay_state);
            let tor_state: tauri::State<'_, tor::TorState> = app_handle.state();
            tor::shutdown(&tor_state);
        }
    });
}
