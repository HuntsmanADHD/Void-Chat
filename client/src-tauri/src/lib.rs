use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State};

// =============================================================================
// STATE
// =============================================================================

struct AppState {
    db: Mutex<Connection>,
}

// =============================================================================
// TYPES
// =============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub channel_id: Option<String>,
    pub recipient_id: Option<String>,
    pub sender_id: String,
    pub encrypted_content: String,
    pub nonce: String,
    pub timestamp: i64,
    pub is_dm: bool,
}

// =============================================================================
// DATABASE SETUP
// =============================================================================

fn init_database(db: &Connection) -> Result<(), rusqlite::Error> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            channel_id TEXT,
            recipient_id TEXT,
            sender_id TEXT NOT NULL,
            encrypted_content TEXT NOT NULL,
            nonce TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            is_dm INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(recipient_id, sender_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

        CREATE TABLE IF NOT EXISTS key_cache (
            public_id TEXT PRIMARY KEY,
            public_key TEXT NOT NULL,
            cached_at INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

// =============================================================================
// KEYRING COMMANDS
// =============================================================================

const KEYRING_SERVICE: &str = "com.voidchat.app";

/// Store a secret in the system keyring
#[tauri::command]
fn keyring_store(key: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())
}

/// Retrieve a secret from the system keyring
#[tauri::command]
fn keyring_get(key: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a secret from the system keyring
#[tauri::command]
fn keyring_delete(key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already gone
        Err(e) => Err(e.to_string()),
    }
}

// =============================================================================
// MESSAGE STORAGE COMMANDS
// =============================================================================

/// Store a message locally
#[tauri::command]
fn store_message(state: State<'_, AppState>, message: StoredMessage) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO messages (id, channel_id, recipient_id, sender_id, encrypted_content, nonce, timestamp, is_dm)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            message.id,
            message.channel_id,
            message.recipient_id,
            message.sender_id,
            message.encrypted_content,
            message.nonce,
            message.timestamp,
            message.is_dm as i32,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Get channel messages (paginated, newest first)
#[tauri::command]
fn get_channel_messages(
    state: State<'_, AppState>,
    channel_id: &str,
    limit: i64,
    before_timestamp: Option<i64>,
) -> Result<Vec<StoredMessage>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let query = if before_timestamp.is_some() {
        "SELECT id, channel_id, recipient_id, sender_id, encrypted_content, nonce, timestamp, is_dm
         FROM messages
         WHERE channel_id = ?1 AND timestamp < ?2
         ORDER BY timestamp DESC
         LIMIT ?3"
    } else {
        "SELECT id, channel_id, recipient_id, sender_id, encrypted_content, nonce, timestamp, is_dm
         FROM messages
         WHERE channel_id = ?1
         ORDER BY timestamp DESC
         LIMIT ?2"
    };

    let mut stmt = db.prepare(query).map_err(|e| e.to_string())?;

    let params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = if let Some(before) = before_timestamp {
        vec![
            Box::new(channel_id.to_string()),
            Box::new(before),
            Box::new(limit),
        ]
    } else {
        vec![Box::new(channel_id.to_string()), Box::new(limit)]
    };

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                channel_id: row.get(1)?,
                recipient_id: row.get(2)?,
                sender_id: row.get(3)?,
                encrypted_content: row.get(4)?,
                nonce: row.get(5)?,
                timestamp: row.get(6)?,
                is_dm: row.get::<_, i32>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| e.to_string())?);
    }
    Ok(messages)
}

/// Get DM messages between two users (paginated, newest first)
#[tauri::command]
fn get_dm_messages(
    state: State<'_, AppState>,
    user_id: &str,
    other_id: &str,
    limit: i64,
    before_timestamp: Option<i64>,
) -> Result<Vec<StoredMessage>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let query = if before_timestamp.is_some() {
        "SELECT id, channel_id, recipient_id, sender_id, encrypted_content, nonce, timestamp, is_dm
         FROM messages
         WHERE is_dm = 1
           AND ((sender_id = ?1 AND recipient_id = ?2) OR (sender_id = ?2 AND recipient_id = ?1))
           AND timestamp < ?3
         ORDER BY timestamp DESC
         LIMIT ?4"
    } else {
        "SELECT id, channel_id, recipient_id, sender_id, encrypted_content, nonce, timestamp, is_dm
         FROM messages
         WHERE is_dm = 1
           AND ((sender_id = ?1 AND recipient_id = ?2) OR (sender_id = ?2 AND recipient_id = ?1))
         ORDER BY timestamp DESC
         LIMIT ?3"
    };

    let mut stmt = db.prepare(query).map_err(|e| e.to_string())?;

    let params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = if let Some(before) = before_timestamp {
        vec![
            Box::new(user_id.to_string()),
            Box::new(other_id.to_string()),
            Box::new(before),
            Box::new(limit),
        ]
    } else {
        vec![
            Box::new(user_id.to_string()),
            Box::new(other_id.to_string()),
            Box::new(limit),
        ]
    };

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                channel_id: row.get(1)?,
                recipient_id: row.get(2)?,
                sender_id: row.get(3)?,
                encrypted_content: row.get(4)?,
                nonce: row.get(5)?,
                timestamp: row.get(6)?,
                is_dm: row.get::<_, i32>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| e.to_string())?);
    }
    Ok(messages)
}

/// Delete all messages older than a given timestamp
#[tauri::command]
fn delete_messages_before(state: State<'_, AppState>, before_timestamp: i64) -> Result<u64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let deleted = db
        .execute(
            "DELETE FROM messages WHERE timestamp < ?1",
            params![before_timestamp],
        )
        .map_err(|e| e.to_string())?;
    Ok(deleted as u64)
}

/// Clear all local data (messages + key cache)
#[tauri::command]
fn clear_all_local_data(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute_batch("DELETE FROM messages; DELETE FROM key_cache;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

// =============================================================================
// KEY CACHE COMMANDS
// =============================================================================

/// Cache a user's public key locally
#[tauri::command]
fn cache_public_key(
    state: State<'_, AppState>,
    public_id: &str,
    public_key: &str,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    db.execute(
        "INSERT OR REPLACE INTO key_cache (public_id, public_key, cached_at) VALUES (?1, ?2, ?3)",
        params![public_id, public_key, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Get a cached public key
#[tauri::command]
fn get_cached_key(state: State<'_, AppState>, public_id: &str) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let result = db.query_row(
        "SELECT public_key FROM key_cache WHERE public_id = ?1",
        params![public_id],
        |row| row.get(0),
    );

    match result {
        Ok(key) => Ok(Some(key)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// =============================================================================
// APP ENTRY POINT
// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Open SQLite database in the app's data directory
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Get app data directory for SQLite storage
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

            let db_path = app_dir.join("void_chat.db");
            let conn = Connection::open(&db_path).expect("failed to open database");

            // Enable WAL mode for better concurrent read performance
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
                .expect("failed to set pragmas");

            init_database(&conn).expect("failed to initialize database");

            app.manage(AppState {
                db: Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Keyring
            keyring_store,
            keyring_get,
            keyring_delete,
            // Messages
            store_message,
            get_channel_messages,
            get_dm_messages,
            delete_messages_before,
            clear_all_local_data,
            // Key cache
            cache_public_key,
            get_cached_key,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {});
}
