//! SQLite-backed directory storage. Replaces Prisma — same schema,
//! no engine binary, no migration runner. Schema is embedded as a SQL
//! constant and applied idempotently at startup; the file lives next
//! to the binary (dev: `./data/voidchat.db`, prod: app_data_dir).
//!
//! Concurrency model: single `Mutex<Connection>` wrapped in `Arc`.
//! All accessor methods take `&self` and serialize through the mutex
//! via `spawn_blocking`. For a friend-group-scale relay this is fine
//! — the DB sees a handful of queries per minute; lock contention is
//! a non-issue. If contention ever becomes real, swap to r2d2_sqlite
//! pool. Don't pre-optimize.
//!
//! ID format: 16 random bytes, base58-encoded. Replaces Prisma's cuid
//! default. IDs are opaque strings to every consumer (frontend, wire
//! protocol), so the format change is invisible. Existing cuid-format
//! IDs from old rows continue to work because everything just treats
//! them as `TEXT`.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// Schema applied at every startup. `CREATE TABLE IF NOT EXISTS` makes
/// this idempotent — first launch creates the tables, subsequent
/// launches are no-ops. Column types match Prisma's SQLite emission:
/// `TEXT` for strings, `INTEGER` for booleans (0/1), `TEXT` for
/// timestamps (ISO 8601). Foreign key with `ON DELETE CASCADE` so
/// deleting a community wipes its channels.
const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Community (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    avatar          TEXT,
    passwordHash    TEXT,
    deleteTokenHash TEXT,
    createdAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS Community_name_idx ON Community(name);

CREATE TABLE IF NOT EXISTS Channel (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    communityId  TEXT NOT NULL,
    isDefault    INTEGER NOT NULL DEFAULT 0,
    createdAt    TEXT NOT NULL,
    FOREIGN KEY (communityId) REFERENCES Community(id) ON DELETE CASCADE,
    UNIQUE (communityId, name)
);
CREATE INDEX IF NOT EXISTS Channel_communityId_idx ON Channel(communityId);
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Community {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    /// Never returned to clients in the listing response — handlers
    /// strip this before serialization. Stored here so the auth path
    /// can read it without a separate query.
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    /// Argon2id hash of the random delete-token issued at create time
    /// when the community has no password. Audit pt6 C2: without
    /// this, ANY joiner who knew the community ID could DELETE the
    /// community via the API. Never returned to clients.
    #[serde(skip_serializing)]
    pub delete_token_hash: Option<String>,
    pub created_at: String,
    /// Computed at query time. True when `password_hash` is non-NULL.
    /// Exposed to clients so the lock icon can render without leaking
    /// the hash itself.
    pub is_private: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub community_id: String,
    pub is_default: bool,
    pub created_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("not found")]
    NotFound,
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("internal: {0}")]
    Internal(String),
}

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    /// Opens (or creates) the SQLite file and applies the schema.
    /// Idempotent — safe to call on every startup.
    pub fn open(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    DbError::Internal(format!("could not create data dir: {e}"))
                })?;
            }
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        // Lightweight migration: add deleteTokenHash to Community on
        // databases that pre-date audit pt6 C2. `CREATE TABLE IF NOT
        // EXISTS` won't add columns to an existing table; this does.
        // Swallow the "duplicate column" error so the migration is
        // idempotent across boots.
        match conn.execute("ALTER TABLE Community ADD COLUMN deleteTokenHash TEXT", []) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
                if msg.contains("duplicate column name") => {}
            Err(e) => return Err(DbError::Sqlite(e)),
        }
        // Surface "legacy" rows — created before pt6, no password and
        // no delete-token. The DELETE handler refuses these (no
        // credential to verify against), so without this log the user
        // sees "delete does nothing" with no explanation. Telling
        // them to wipe the DB is the cleanest unblock; we point at
        // both the file and the exact SQL fallback.
        let legacy: Vec<(String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT id, name FROM Community
                 WHERE passwordHash IS NULL AND deleteTokenHash IS NULL",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>("id")?, row.get::<_, String>("name")?))
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            out
        };
        if !legacy.is_empty() {
            tracing::warn!(
                count = legacy.len(),
                "legacy communities (pre-pt6, no credential on file) — DELETE via API will return 403"
            );
            for (id, name) in &legacy {
                tracing::warn!(id = %id, name = %name, "legacy community");
            }
            tracing::warn!(
                db = %path.display(),
                "to wipe legacy rows: `sqlite3 <path> \"DELETE FROM Community WHERE passwordHash IS NULL AND deleteTokenHash IS NULL\"` (or just rm the file to start fresh)"
            );
        }
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Helper: run a blocking closure on the tokio blocking pool with
    /// exclusive connection access. Every public method funnels
    /// through here so axum handlers can stay async without leaking
    /// rusqlite's sync API into them.
    async fn with_conn<F, T>(&self, f: F) -> Result<T, DbError>
    where
        F: FnOnce(&Connection) -> Result<T, DbError> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let guard = conn.lock().map_err(|e| {
                DbError::Internal(format!("db mutex poisoned: {e}"))
            })?;
            f(&guard)
        })
        .await
        .map_err(|e| DbError::Internal(format!("blocking task join: {e}")))?
    }

    // ── communities ─────────────────────────────────────────────────

    pub async fn list_communities(&self) -> Result<Vec<Community>, DbError> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT id, name, description, avatar, passwordHash, deleteTokenHash, createdAt
                 FROM Community
                 ORDER BY createdAt DESC",
            )?;
            let rows = stmt.query_map([], row_to_community)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn get_community(&self, id: &str) -> Result<Community, DbError> {
        let id = id.to_string();
        self.with_conn(move |c| {
            c.query_row(
                "SELECT id, name, description, avatar, passwordHash, deleteTokenHash, createdAt
                 FROM Community WHERE id = ?1",
                params![id],
                row_to_community,
            )
            .optional()?
            .ok_or(DbError::NotFound)
        })
        .await
    }

    pub async fn create_community(
        &self,
        name: String,
        description: Option<String>,
        avatar: Option<String>,
        password_hash: Option<String>,
        delete_token_hash: Option<String>,
    ) -> Result<(Community, Channel), DbError> {
        self.with_conn(move |c| {
            let community_id = new_id();
            let channel_id = new_id();
            let now = iso_now();

            let tx = c.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO Community
                 (id, name, description, avatar, passwordHash, deleteTokenHash, createdAt)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![community_id, name, description, avatar, password_hash, delete_token_hash, now],
            )
            .map_err(|e| {
                // SQLite unique-constraint failure → user-friendly error.
                if let rusqlite::Error::SqliteFailure(err, _) = &e {
                    if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE {
                        return DbError::Conflict("community name already taken".into());
                    }
                }
                DbError::Sqlite(e)
            })?;
            tx.execute(
                "INSERT INTO Channel
                 (id, name, description, communityId, isDefault, createdAt)
                 VALUES (?1, 'general', NULL, ?2, 1, ?3)",
                params![channel_id, community_id, now],
            )?;
            tx.commit()?;

            let community = Community {
                id: community_id.clone(),
                name,
                description,
                avatar,
                is_private: password_hash.is_some(),
                password_hash,
                delete_token_hash,
                created_at: now.clone(),
            };
            let channel = Channel {
                id: channel_id,
                name: "general".to_string(),
                description: None,
                community_id: community_id,
                is_default: true,
                created_at: now,
            };
            Ok((community, channel))
        })
        .await
    }

    /// Re-hash forward: legacy scrypt rows get an argon2id replacement
    /// on next successful login. Failure is non-fatal (next login
    /// retries) so callers fire-and-forget.
    pub async fn update_community_password_hash(
        &self,
        id: &str,
        new_hash: &str,
    ) -> Result<(), DbError> {
        let id = id.to_string();
        let new_hash = new_hash.to_string();
        self.with_conn(move |c| {
            c.execute(
                "UPDATE Community SET passwordHash = ?1 WHERE id = ?2",
                params![new_hash, id],
            )?;
            Ok(())
        })
        .await
    }

    pub async fn delete_community(&self, id: &str) -> Result<(), DbError> {
        let id = id.to_string();
        self.with_conn(move |c| {
            // Foreign-key cascade handles Channel cleanup.
            let n = c.execute("DELETE FROM Community WHERE id = ?1", params![id])?;
            if n == 0 {
                Err(DbError::NotFound)
            } else {
                Ok(())
            }
        })
        .await
    }

    // ── channels ────────────────────────────────────────────────────

    pub async fn list_channels(&self, community_id: &str) -> Result<Vec<Channel>, DbError> {
        let community_id = community_id.to_string();
        self.with_conn(move |c| {
            let mut stmt = c.prepare(
                "SELECT id, name, description, communityId, isDefault, createdAt
                 FROM Channel
                 WHERE communityId = ?1
                 ORDER BY isDefault DESC, createdAt ASC",
            )?;
            let rows = stmt.query_map(params![community_id], row_to_channel)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn create_channel(
        &self,
        community_id: String,
        name: String,
        description: Option<String>,
    ) -> Result<Channel, DbError> {
        self.with_conn(move |c| {
            let id = new_id();
            let now = iso_now();
            c.execute(
                "INSERT INTO Channel
                 (id, name, description, communityId, isDefault, createdAt)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                params![id, name, description, community_id, now],
            )
            .map_err(|e| {
                if let rusqlite::Error::SqliteFailure(err, _) = &e {
                    if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE {
                        return DbError::Conflict(
                            "channel name already taken in this community".into(),
                        );
                    }
                    if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY {
                        return DbError::NotFound;
                    }
                }
                DbError::Sqlite(e)
            })?;
            Ok(Channel {
                id,
                name,
                description,
                community_id,
                is_default: false,
                created_at: now,
            })
        })
        .await
    }
}

fn row_to_community(row: &rusqlite::Row) -> rusqlite::Result<Community> {
    let password_hash: Option<String> = row.get("passwordHash")?;
    let delete_token_hash: Option<String> = row.get("deleteTokenHash")?;
    Ok(Community {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        avatar: row.get("avatar")?,
        is_private: password_hash.is_some(),
        password_hash,
        delete_token_hash,
        created_at: row.get("createdAt")?,
    })
}

fn row_to_channel(row: &rusqlite::Row) -> rusqlite::Result<Channel> {
    let is_default: i64 = row.get("isDefault")?;
    Ok(Channel {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        community_id: row.get("communityId")?,
        is_default: is_default != 0,
        created_at: row.get("createdAt")?,
    })
}

/// New random ID. 16 random bytes → base58 (~22 chars). Opaque to
/// every consumer; the format change from Prisma's cuid is invisible
/// because every consumer treats IDs as `TEXT`.
fn new_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("OS RNG unavailable");
    bs58::encode(bytes).into_string()
}

/// ISO 8601 timestamp in UTC. Matches Prisma's stored format closely
/// enough that consumers (which only ever parse-as-string or sort by
/// it lexicographically) won't notice.
fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
