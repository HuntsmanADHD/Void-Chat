//! Void Chat relay — Rust port of `server/socket-server.ts`.
//!
//! Listens on `127.0.0.1:3001` (loopback only — bypass closes audit pt2
//! C1). Handles the HTTP API (community + channel CRUD) and the
//! socket.io WebSocket layer (announce, channel join/leave/send, DM).
//!
//! The wire format is identical to what the TypeScript relay exposed
//! so the existing frontend (and its Zod schemas) work unchanged. This
//! is a port, not a redesign.
//!
//! Status: scaffold only. Endpoints + handlers land in subsequent
//! commits per the v0.2 roadmap.

use std::net::SocketAddr;

use tracing::info;
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod db;
mod http;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Logging filter. `VOIDCHAT_RELAY_LOG=debug` for verbose runs.
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("VOIDCHAT_RELAY_LOG")
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let cfg = config::Config::from_env();
    info!(
        port = cfg.port,
        data_dir = %cfg.data_dir.display(),
        cors_origins = ?cfg.cors_origins,
        "starting voidchat-relay"
    );

    let db_path = cfg.db_path();
    info!(path = %db_path.display(), "opening database");
    let db = db::Db::open(&db_path)
        .map_err(|e| format!("failed to open database at {}: {e}", db_path.display()))?;
    info!("database ready");

    let state = http::AppState::new(db);
    let app = http::router(state, &cfg);

    // Pinned to loopback. The relay is only ever reached via either
    // the local Tauri renderer or the local onion proxy forwarding
    // through Tor; nothing legitimate connects from a non-loopback
    // address.
    let addr: SocketAddr = ([127, 0, 0, 1], cfg.port).into();
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, "listening");

    // `into_make_service_with_connect_info` exposes the peer address
    // to handlers via the `ConnectInfo<SocketAddr>` extractor, so
    // rate-limit IP keys come from the actual connection peer (not
    // a forgeable header — see audit pt2 H6).
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    info!("shutdown complete");
    Ok(())
}

async fn shutdown_signal() {
    use tokio::signal;
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        let mut term = signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        term.recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("SIGINT received"),
        _ = terminate => info!("SIGTERM received"),
    }
}
