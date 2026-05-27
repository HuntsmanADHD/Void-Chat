//! Runtime configuration. All knobs come from environment variables so
//! the same binary works in dev (`yarn dev:all`) and in production
//! (spawned by the Tauri shell).

use std::path::PathBuf;

/// Default port — matches the previous Node relay so the existing
/// `apiUrl()` and socket.io URL on the frontend keep working.
pub const DEFAULT_PORT: u16 = 3001;

/// Tauri's `app_data_dir` is provided to us via this env var when
/// spawned as a sidecar. In dev we fall back to `./data/voidchat.db`
/// (project-relative) to match the historical Node behavior.
pub const ENV_DATA_DIR: &str = "VOIDCHAT_DATA_DIR";

/// Comma-separated origin allowlist. The previous Node relay used the
/// same env var; preserved to keep dev workflows unchanged.
pub const ENV_CORS_ORIGIN: &str = "CORS_ORIGIN";

/// Production default — only the Tauri webview origins. Dev workflows
/// set `CORS_ORIGIN` explicitly via `yarn socket:dev`.
const PRODUCTION_DEFAULT_CORS: &str =
    "tauri://localhost,https://tauri.localhost,http://tauri.localhost";

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub data_dir: PathBuf,
    pub cors_origins: Vec<String>,
    pub cors_allow_any: bool,
}

impl Config {
    pub fn from_env() -> Self {
        let port = std::env::var("SOCKET_PORT")
            .ok()
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);

        let data_dir = std::env::var(ENV_DATA_DIR)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));

        let cors_raw = std::env::var(ENV_CORS_ORIGIN)
            .unwrap_or_else(|_| PRODUCTION_DEFAULT_CORS.to_string());
        let cors_allow_any = cors_raw.trim() == "*";
        let cors_origins: Vec<String> = cors_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Self {
            port,
            data_dir,
            cors_origins,
            cors_allow_any,
        }
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("voidchat.db")
    }
}
