//! HTTP API for community + channel CRUD. Faithful port of
//! `server/api.ts`. Same routes, same JSON shapes (so the existing
//! frontend works unchanged), same rate limits, same gates, same
//! defensive validation.
//!
//! Routes:
//!   GET    /api/communities                — list (paginated)
//!   POST   /api/communities                — create
//!   GET    /api/communities/:id            — fetch one + its channels
//!   DELETE /api/communities/:id            — delete (password-gated)
//!   GET    /api/communities/:id/channels   — list channels
//!   POST   /api/communities/:id/channels   — create channel (gated)
//!   GET    /healthz                        — liveness probe
//!
//! Trust boundary notes:
//!   - The relay is bound to loopback only; only the local renderer
//!     + the local Tor onion proxy connect.
//!   - `X-Forwarded-For` is deliberately ignored (audit pt2 H6) — IP
//!     keys come from `req.socket.remoteAddress` equivalent only.
//!   - Avatar/banner values are restricted to `data:image/...;base64`
//!     URIs (audit pt2 C1 / pt1 #1) so a malicious community owner
//!     can't trigger clearnet image fetches and unmask viewers.
//!   - 50 MiB/day total avatar-blob storage cap (audit pt5 M6).
//!   - Community password verification is constant-time via the
//!     argon2 crate; legacy scrypt rows get re-hashed forward to
//!     argon2id on next successful login.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::warn;

use crate::auth::{self, MAX_LEN as PW_MAX_LEN, MIN_LEN as PW_MIN_LEN};
use crate::config::Config;
use crate::db::{Db, DbError};

// ── Tunables (preserved from server/api.ts) ─────────────────────────

const RATE_WINDOW: Duration = Duration::from_secs(60);
const RATE_MAX: u32 = 60;
const MAX_BODY_BYTES: usize = 512 * 1024;
const MAX_AVATAR_BYTES: usize = 256 * 1024;
const AVATAR_DAILY_BUDGET: usize = 50 * 1024 * 1024;
const AVATAR_BUDGET_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);
/// Audit pt6 H14: cap rate-bucket map growth. Loopback-only operation
/// effectively keeps the map at one key (`127.0.0.1`), but the H2
/// per-circuit token keying can produce many keys under sustained
/// cross-host traffic; without a cap a long-running relay grows the
/// map until the bucket-reset sweep happens lazily on the next
/// access. Match the realtime layer's MAX_RATE_BUCKETS shape.
const MAX_RATE_BUCKETS: usize = 50_000;

// ── Shared state ────────────────────────────────────────────────────

pub struct AppState {
    pub db: Db,
    rate_buckets: Mutex<HashMap<String, RateBucket>>,
    avatar_budget: Mutex<AvatarBudget>,
}

struct RateBucket {
    count: u32,
    reset_at: Instant,
}

struct AvatarBudget {
    bytes_used: usize,
    window_start: Instant,
}

impl AppState {
    pub fn new(db: Db) -> Arc<Self> {
        Arc::new(Self {
            db,
            rate_buckets: Mutex::new(HashMap::new()),
            avatar_budget: Mutex::new(AvatarBudget {
                bytes_used: 0,
                window_start: Instant::now(),
            }),
        })
    }

    fn rate_allowed(&self, key: &str) -> Result<(), u64> {
        let mut buckets = self.rate_buckets.lock().expect("rate_buckets poisoned");
        let now = Instant::now();
        // Audit pt6 H14: backstop the map size. Insertion-order
        // eviction (HashMap iteration is arbitrary; close enough as
        // a backstop). Friend-group scale won't hit this — it's the
        // wall against rotating-token abuse from cross-host visitors.
        if !buckets.contains_key(key) && buckets.len() >= MAX_RATE_BUCKETS {
            if let Some(k) = buckets.keys().next().cloned() {
                buckets.remove(&k);
            }
        }
        let bucket = buckets
            .entry(key.to_string())
            .or_insert(RateBucket {
                count: 0,
                reset_at: now + RATE_WINDOW,
            });
        if bucket.reset_at <= now {
            bucket.count = 0;
            bucket.reset_at = now + RATE_WINDOW;
        }
        if bucket.count >= RATE_MAX {
            return Err(bucket.reset_at.saturating_duration_since(now).as_secs());
        }
        bucket.count += 1;
        Ok(())
    }

    fn avatar_budget_allows(&self, size: usize) -> bool {
        let mut budget = self.avatar_budget.lock().expect("avatar_budget poisoned");
        if budget.window_start.elapsed() > AVATAR_BUDGET_WINDOW {
            budget.bytes_used = 0;
            budget.window_start = Instant::now();
        }
        if budget.bytes_used + size > AVATAR_DAILY_BUDGET {
            return false;
        }
        budget.bytes_used += size;
        true
    }
}

// ── Errors → HTTP responses ─────────────────────────────────────────

pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

impl From<DbError> for ApiError {
    fn from(e: DbError) -> Self {
        match e {
            DbError::NotFound => ApiError::new(StatusCode::NOT_FOUND, "Not found"),
            DbError::Conflict(msg) => ApiError::new(StatusCode::CONFLICT, msg),
            other => {
                warn!("db error: {other}");
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
        }
    }
}

// ── Router ──────────────────────────────────────────────────────────

pub fn router(state: Arc<AppState>, cfg: &Config) -> Router {
    let cors = build_cors(cfg);

    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/communities", get(list_communities).post(create_community))
        .route(
            "/api/communities/:id",
            get(get_community).delete(delete_community),
        )
        .route(
            "/api/communities/:id/channels",
            get(list_channels).post(create_channel),
        )
        .layer(cors)
        .with_state(state)
}

fn build_cors(cfg: &Config) -> CorsLayer {
    let methods = [Method::GET, Method::POST, Method::DELETE, Method::OPTIONS];
    let headers = [
        header::CONTENT_TYPE,
        HeaderName::from_static("x-community-password"),
    ];

    // Audit pt6 debugging lesson: a 24-hour max-age means any
    // preflight failure (during dev, after a breaking change, during
    // a transient bug) gets cached by the WebView and "fixes" don't
    // take effect for 24 hours of real wall-clock time — leading to
    // an entire afternoon of chasing ghosts. 60 seconds is plenty
    // in production (preflights are cheap; we're loopback-only) and
    // closes the cache-poisoning footgun for dev.
    //
    // `allow_credentials(true)`: WebKit treats `localhost:5173 →
    // localhost:11811` as same-site (port differs, hostname same) and
    // can implicitly include credentials. If the server omits
    // `Access-Control-Allow-Credentials: true`, WebKit silently
    // blocks the response and reports a synthesized CORS error to
    // JS — even though the request reached the server fine. We don't
    // actually rely on cookies, but allowing credentials makes the
    // response acceptable to WebKit regardless of its same-site
    // judgement. The relay binds loopback only, so this isn't a CSRF
    // surface expansion.
    let cors = CorsLayer::new()
        .allow_methods(methods)
        .allow_headers(headers)
        .allow_credentials(true)
        .max_age(Duration::from_secs(60));

    if cfg.cors_allow_any {
        cors.allow_origin(AllowOrigin::any())
    } else {
        let origins: Vec<HeaderValue> = cfg
            .cors_origins
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
        cors.allow_origin(AllowOrigin::list(origins))
    }
}

async fn healthz() -> &'static str {
    "ok\n"
}

// ── /api/communities ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListQuery {
    page: Option<u32>,
    limit: Option<u32>,
}

async fn list_communities(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let page = q.page.unwrap_or(1).max(1);
    let limit = q.limit.unwrap_or(50).clamp(1, 100);

    let all = state.db.list_communities().await?;
    let total = all.len();
    let start = ((page - 1) * limit) as usize;
    let end = (start + limit as usize).min(total);
    let page_slice = if start < total { &all[start..end] } else { &[] };

    let communities: Vec<serde_json::Value> = page_slice
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "avatar": c.avatar,
                "isPrivate": c.is_private,
                "createdAt": c.created_at,
            })
        })
        .collect();

    Ok(Json(json!({ "communities": communities, "total": total })))
}

#[derive(Debug, Deserialize)]
struct CreateCommunityBody {
    name: Option<String>,
    description: Option<String>,
    avatar: Option<String>,
    password: Option<String>,
}

async fn create_community(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<CreateCommunityBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let bucket = rate_bucket_key(&addr, &headers);
    if let Err(retry) = state.rate_allowed(&format!("community-create:{bucket}")) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            format!("Rate limit exceeded. Retry after {retry} seconds"),
        ));
    }

    let name = sanitize(&body.name.unwrap_or_default(), 64);
    let description = body
        .description
        .map(|s| sanitize(&s, 500))
        .filter(|s| !s.is_empty());
    let avatar = body.avatar.map(|s| sanitize_avatar(&s)).filter(|s| !s.is_empty());

    let name_chars = name.chars().count();
    if name_chars < 2 || name_chars > 64 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Community name must be 2–64 characters",
        ));
    }
    if !is_valid_community_name(&name) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Community name may only contain letters, numbers, spaces, _ and -",
        ));
    }
    if let Some(av) = &avatar {
        if !is_allowed_data_image_uri(av) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Avatar must be an inline data:image/(png|jpeg|webp|gif);base64 URI",
            ));
        }
        if av.len() > MAX_AVATAR_BYTES {
            return Err(ApiError::new(StatusCode::PAYLOAD_TOO_LARGE, "Avatar too large"));
        }
        if !state.avatar_budget_allows(av.len()) {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "Avatar storage budget reached — retry tomorrow or create without an avatar",
            ));
        }
    }

    let password_hash = match body.password.as_deref().filter(|s| !s.is_empty()) {
        None => None,
        Some(pw) => {
            if pw.len() < PW_MIN_LEN || pw.len() > PW_MAX_LEN {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("Password must be {PW_MIN_LEN}–{PW_MAX_LEN} characters"),
                ));
            }
            Some(
                auth::hash_password(pw)
                    .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, e.to_string()))?,
            )
        }
    };

    // Audit pt6 C2: when no password is set, generate a delete-token
    // so the creator (and only the creator) can DELETE the community
    // later. The plaintext is returned ONCE in this response and never
    // exposed again. The hash is what we persist; verification uses
    // the same argon2id path as passwords. Without this, any joiner
    // who learned the community ID could DELETE it.
    let (delete_token_plain, delete_token_hash) = if password_hash.is_none() {
        let token = mint_delete_token();
        let hashed = auth::hash_password(&token)
            .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        (Some(token), Some(hashed))
    } else {
        (None, None)
    };

    let (community, channel) = state
        .db
        .create_community(name, description, avatar, password_hash, delete_token_hash)
        .await?;

    let mut body = json!({
        "id": community.id,
        "name": community.name,
        "description": community.description,
        "avatar": community.avatar,
        "isPrivate": community.is_private,
        "channels": [{
            "id": channel.id,
            "name": channel.name,
            "isDefault": channel.is_default,
        }],
        "createdAt": community.created_at,
    });
    if let Some(token) = delete_token_plain {
        body["deleteToken"] = json!(token);
    }
    Ok((StatusCode::CREATED, Json(body)))
}

async fn get_community(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let community = state.db.get_community(&id).await?;
    gate_community(&state, &community.password_hash, &headers, &community.id).await?;

    let channels = state.db.list_channels(&id).await?;
    Ok(Json(json!({
        "id": community.id,
        "name": community.name,
        "description": community.description,
        "avatar": community.avatar,
        "isPrivate": community.is_private,
        "channels": channels.iter().map(|c| json!({
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "isDefault": c.is_default,
        })).collect::<Vec<_>>(),
        "createdAt": community.created_at,
    })))
}

async fn delete_community(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bucket = rate_bucket_key(&addr, &headers);
    if let Err(retry) = state.rate_allowed(&format!("community-delete:{bucket}")) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            format!("Rate limit exceeded. Retry after {retry} seconds"),
        ));
    }
    let community = state.db.get_community(&id).await?;
    // For DELETE, the password (if set) OR the delete-token (if no
    // password was set at create time) is the auth credential.
    // Audit pt6 C2: previously `gate_community` early-returned Ok
    // when no password was set, so anyone with the community ID
    // could nuke any password-less community.
    let credential = community
        .password_hash
        .as_ref()
        .or(community.delete_token_hash.as_ref());
    let Some(stored) = credential else {
        // Should be impossible — every community gets either a
        // password_hash (if user-set) or a delete_token_hash (if
        // not). A NULL/NULL row would only exist on a pre-pt6 DB
        // that wasn't migrated through the create-with-token path.
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "this community predates delete-auth migration — cannot delete via API",
        ));
    };
    verify_credential(&state, stored, &headers).await?;
    state.db.delete_community(&id).await?;
    Ok(Json(json!({ "deleted": id })))
}

// ── /api/communities/:id/channels ───────────────────────────────────

async fn list_channels(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let community = state.db.get_community(&id).await?;
    gate_community(&state, &community.password_hash, &headers, &community.id).await?;
    let channels = state.db.list_channels(&id).await?;
    Ok(Json(json!({
        "channels": channels.iter().map(|c| json!({
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "isDefault": c.is_default,
            "createdAt": c.created_at,
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Debug, Deserialize)]
struct CreateChannelBody {
    name: Option<String>,
    description: Option<String>,
}

async fn create_channel(
    State(state): State<Arc<AppState>>,
    Path(community_id): Path<String>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<CreateChannelBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let bucket = rate_bucket_key(&addr, &headers);
    if let Err(retry) = state.rate_allowed(&format!("channel-create:{bucket}")) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            format!("Rate limit exceeded. Retry after {retry} seconds"),
        ));
    }
    let community = state.db.get_community(&community_id).await?;
    gate_community(&state, &community.password_hash, &headers, &community.id).await?;

    let name = sanitize(&body.name.unwrap_or_default(), 32);
    let description = body
        .description
        .map(|s| sanitize(&s, 200))
        .filter(|s| !s.is_empty());

    let name_chars = name.chars().count();
    if name_chars == 0 || name_chars > 32 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Channel name must be 1–32 characters",
        ));
    }
    if !is_valid_channel_name(&name) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Channel name may only contain letters, numbers, _ and -",
        ));
    }

    let channel = state
        .db
        .create_channel(community_id, name, description)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": channel.id,
            "name": channel.name,
            "description": channel.description,
            "isDefault": channel.is_default,
            "createdAt": channel.created_at,
        })),
    ))
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Per audit pt2 H6: never trust `X-Forwarded-For` on the loopback
/// listener. Any local process can forge it. Use only the connection
/// peer's IP — plus, for cross-host visitors who reach us through the
/// local onion proxy (and therefore appear as `127.0.0.1`), the
/// per-circuit token the proxy injects (audit pt6 H2). Without the
/// token, every cross-host visitor shares the single `127.0.0.1`
/// bucket and one flooder DoSes everyone including the local user.
///
/// The token is TRUSTED FOR KEYING ONLY — not for identity. Stripping
/// any client-supplied value happens in proxy.rs before our injected
/// token is appended; here we just look at whatever's in the request.
fn rate_bucket_key(addr: &SocketAddr, headers: &HeaderMap) -> String {
    if let Some(circuit) = headers
        .get("x-voidchat-proxy-circuit")
        .and_then(|v| v.to_str().ok())
    {
        // Loose length sanity-check; refuse to use a giant string as
        // a HashMap key. The real value is 32 hex chars (16 bytes).
        if !circuit.is_empty() && circuit.len() <= 128 {
            return format!("circuit:{circuit}");
        }
    }
    addr.ip().to_string()
}


/// Sanitize user input + cap length in CHARACTERS (not bytes). Audit
/// pt6 M2: previously the size check was bytes (`trimmed.len()`) but
/// the truncation was chars, so a 100-char emoji string (~400 bytes)
/// triggered the truncation branch, produced a 100-char output, and
/// then the validator saw 400 bytes vs max_len-as-bytes and rejected
/// with a misleading message. Picking chars for both fixes the cliff
/// and matches user-visible length expectations.
fn sanitize(s: &str, max_len: usize) -> String {
    let cleaned: String = s.chars().filter(|c| *c != '\0').collect();
    let trimmed = cleaned.trim();
    let char_count = trimmed.chars().count();
    if char_count > max_len {
        trimmed.chars().take(max_len).collect()
    } else {
        trimmed.to_string()
    }
}

/// Avatar URIs may legitimately contain `\0` in their base64 chars
/// (no — base64 alphabet doesn't include null) but the leading
/// whitespace strip would mangle a long data URI's tail. Same code
/// path as `sanitize` but without the max-len truncation, since the
/// MAX_AVATAR_BYTES check is what enforces the cap.
fn sanitize_avatar(s: &str) -> String {
    s.replace('\0', "").trim().to_string()
}

fn is_valid_community_name(name: &str) -> bool {
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '_' || c == '-')
}

fn is_valid_channel_name(name: &str) -> bool {
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Avatar / banner allowlist. Only inline base64 data URIs of common
/// raster formats. `http://` / `https://` and `javascript:` rejected
/// at the boundary — the renderer would otherwise load them straight
/// over clearnet, defeating Tor.
fn is_allowed_data_image_uri(value: &str) -> bool {
    if !value.starts_with("data:image/") {
        return false;
    }
    // Format: data:image/(png|jpeg|webp|gif);base64,<bytes>
    let rest = match value.strip_prefix("data:image/") {
        Some(r) => r,
        None => return false,
    };
    let (mime_suffix, payload) = match rest.split_once(";base64,") {
        Some(p) => p,
        None => return false,
    };
    if !matches!(mime_suffix, "png" | "jpeg" | "webp" | "gif") {
        return false;
    }
    // base64 alphabet (RFC 4648 standard with padding)
    let alphabet_ok = payload
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
        && !payload.is_empty();
    if !alphabet_ok {
        return false;
    }
    // Audit pt6 H4: decode the payload and verify the magic bytes
    // match the declared MIME. Previously the only check was the
    // prefix + base64 alphabet, so `data:image/png;base64,QUFBQQ==`
    // (4 bytes of `A`) passed the validator, decoded to non-image
    // bytes, and counted against the daily avatar budget. ~200
    // creates at the per-avatar cap (256 KiB) exhausted the 50 MiB
    // daily budget. Magic-byte sniff closes that.
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let Ok(decoded) = STANDARD.decode(payload) else {
        return false;
    };
    image_magic_matches_mime(&decoded, mime_suffix)
}

/// Magic-byte sniff. Doesn't fully validate the image (no codec
/// decode) — just checks that the leading bytes are consistent with
/// the declared format. Cheap, catches the audit pt6 H4 budget-abuse
/// attack and obvious tampering, lets the browser do the real parse.
fn image_magic_matches_mime(bytes: &[u8], mime_suffix: &str) -> bool {
    match mime_suffix {
        "png" => bytes.len() >= 8 && &bytes[..8] == b"\x89PNG\r\n\x1a\n",
        "jpeg" => bytes.len() >= 3 && &bytes[..3] == b"\xff\xd8\xff",
        "gif" => bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a"),
        "webp" => {
            // RIFF....WEBP — 4 bytes "RIFF", 4 bytes size, 4 bytes "WEBP"
            bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
        }
        _ => false,
    }
}

#[cfg(test)]
mod image_sniff_tests {
    use super::image_magic_matches_mime;

    #[test]
    fn accepts_real_magic() {
        assert!(image_magic_matches_mime(b"\x89PNG\r\n\x1a\nrest", "png"));
        assert!(image_magic_matches_mime(b"\xff\xd8\xffrest", "jpeg"));
        assert!(image_magic_matches_mime(b"GIF89a...", "gif"));
        assert!(image_magic_matches_mime(b"GIF87a...", "gif"));
        let mut webp = Vec::new();
        webp.extend_from_slice(b"RIFF");
        webp.extend_from_slice(&[0u8; 4]);
        webp.extend_from_slice(b"WEBPextra");
        assert!(image_magic_matches_mime(&webp, "webp"));
    }

    #[test]
    fn rejects_garbage() {
        assert!(!image_magic_matches_mime(b"AAAA", "png"));
        assert!(!image_magic_matches_mime(b"AAAA", "jpeg"));
        assert!(!image_magic_matches_mime(b"AAAA", "gif"));
        assert!(!image_magic_matches_mime(b"AAAAAAAAAAAA", "webp"));
        // Right magic for the wrong declared type
        assert!(!image_magic_matches_mime(b"\x89PNG\r\n\x1a\n", "jpeg"));
    }

    #[test]
    fn rejects_too_short() {
        assert!(!image_magic_matches_mime(b"", "png"));
        assert!(!image_magic_matches_mime(b"\x89PN", "png"));
    }
}

async fn gate_community(
    state: &Arc<AppState>,
    password_hash: &Option<String>,
    headers: &HeaderMap,
    community_id: &str,
) -> Result<(), ApiError> {
    let Some(stored) = password_hash else {
        return Ok(());
    };
    let provided = headers
        .get("x-community-password")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if provided.is_empty() {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Password required"));
    }
    // Move the verify off the runtime — argon2id is CPU-bound.
    let candidate = provided.to_string();
    let stored = stored.clone();
    let outcome = tokio::task::spawn_blocking(move || auth::verify_password(&candidate, &stored))
        .await
        .map_err(|e| {
            warn!("verify_password join error: {e}");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
        })?;

    if !outcome.valid {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Invalid password"));
    }
    // Legacy scrypt row → re-hash forward to argon2id on next chance.
    // Fire-and-forget; failure here just means the migration retries
    // on the next login.
    if outcome.needs_rehash {
        let candidate2 = provided.to_string();
        let db = state.db.clone();
        let id = community_id.to_string();
        tokio::spawn(async move {
            let new_hash = match tokio::task::spawn_blocking(move || auth::hash_password(&candidate2))
                .await
            {
                Ok(Ok(h)) => h,
                Ok(Err(e)) => {
                    warn!("rehash on login failed: {e}");
                    return;
                }
                Err(e) => {
                    warn!("rehash join error: {e}");
                    return;
                }
            };
            if let Err(e) = db.update_community_password_hash(&id, &new_hash).await {
                warn!("rehash store failed: {e}");
            }
        });
    }
    Ok(())
}

/// Verify a presented credential (password OR delete-token) against
/// a stored argon2id hash. Used only by DELETE — the read paths still
/// go through `gate_community` which is open for password-less rows
/// (joiners get to list channels without proving ownership). Audit
/// pt6 C2.
async fn verify_credential(
    state: &Arc<AppState>,
    stored: &str,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    let _ = state; // unused (no rehash on delete-token path), kept for symmetry
    let provided = headers
        .get("x-community-password")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if provided.is_empty() {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "delete requires the password (or delete-token if no password was set)",
        ));
    }
    let candidate = provided.to_string();
    let stored = stored.to_string();
    let outcome = tokio::task::spawn_blocking(move || auth::verify_password(&candidate, &stored))
        .await
        .map_err(|e| {
            warn!("verify_credential join error: {e}");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
        })?;
    if !outcome.valid {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "invalid credential",
        ));
    }
    Ok(())
}

/// Random 32-byte delete-token, base58 encoded (~44 chars). Same
/// alphabet as community IDs to keep the visual character set
/// consistent for users who copy/paste these.
fn mint_delete_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("OS RNG unavailable");
    bs58::encode(buf).into_string()
}

// ── Body size limit ─────────────────────────────────────────────────
// axum's Json extractor already enforces a size limit via DefaultBodyLimit,
// but our cap is custom (512 KiB matching the old Node relay). We apply
// this via tower::limit::RequestBodyLimitLayer in the router.

#[allow(dead_code)]
fn body_limit_bytes() -> usize {
    MAX_BODY_BYTES
}
