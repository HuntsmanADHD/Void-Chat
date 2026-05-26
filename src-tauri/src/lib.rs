mod tor;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(tor::TorState::new())
        .invoke_handler(tauri::generate_handler![tor::tor_status, tor::tor_onion])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Spawn tor in the background. Failures are recorded in TorState
            // and surfaced via `tor://status` events; we don't block startup.
            if let Err(e) = tor::start(app.handle()) {
                log::warn!("tor failed to start: {e}");
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
