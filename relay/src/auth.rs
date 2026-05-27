//! Community-password hashing.
//!
//! New hashes are argon2id (PHC-string format). For backward
//! compatibility with rows created by the Node relay's scrypt
//! implementation, `verify_password` also accepts the legacy
//! `salt:derivedKey` (both hex) format and reports whether the row
//! needs to be re-hashed forward to argon2id.
//!
//! The relay never sees the plaintext password except inside this
//! module. Callers receive a boolean verification result + a "should
//! rehash" hint they can act on (storing the new hash so the next
//! login is faster, and the row gradually migrates to argon2id
//! without any user-visible step).

use argon2::password_hash::{rand_core::OsRng, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, PasswordHash};
use constant_time_eq::constant_time_eq;
use scrypt::scrypt;

pub const MIN_LEN: usize = 4;
pub const MAX_LEN: usize = 128;

const LEGACY_SALT_BYTES: usize = 16;
const LEGACY_KEY_BYTES: usize = 64;

/// Result of verifying a candidate password against a stored hash.
/// `valid` is the timing-safe match; `needs_rehash` flags legacy
/// scrypt rows so the caller can store a fresh argon2id hash on the
/// next successful verify (gradual format migration without a flag
/// day).
#[derive(Debug, Clone, Copy)]
pub struct VerifyOutcome {
    pub valid: bool,
    pub needs_rehash: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum PasswordError {
    #[error("password too short")]
    TooShort,
    #[error("password too long")]
    TooLong,
    #[error("hash error: {0}")]
    HashError(String),
}

/// Hash a fresh password as argon2id. Uses the argon2 crate's
/// defaults (m=19456, t=2, p=1) which match OWASP's 2026 recommendation
/// for interactive logins. Returns a PHC string ready for storage.
pub fn hash_password(password: &str) -> Result<String, PasswordError> {
    if password.len() < MIN_LEN {
        return Err(PasswordError::TooShort);
    }
    if password.len() > MAX_LEN {
        return Err(PasswordError::TooLong);
    }
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| PasswordError::HashError(e.to_string()))
}

/// Verify a candidate password against a stored hash. Detects format
/// (argon2id PHC string vs. legacy `salt:hex` scrypt) and dispatches.
///
/// Returns `(valid, needs_rehash)`. When `needs_rehash` is true the
/// caller should re-hash with `hash_password` and replace the stored
/// value on next opportunity (typically the same request).
pub fn verify_password(candidate: &str, stored: &str) -> VerifyOutcome {
    // Argon2id PHC strings start with "$argon2id$" (or other argon2
    // variants we'd accept the same way). Anything else falls through
    // to the legacy scrypt path.
    if stored.starts_with("$argon2") {
        return verify_argon2(candidate, stored);
    }
    if let Some(outcome) = verify_legacy_scrypt(candidate, stored) {
        return outcome;
    }
    // Unrecognized format. Don't reveal whether it's bad-format or
    // wrong-password to the caller — both look like "no" from outside.
    VerifyOutcome {
        valid: false,
        needs_rehash: false,
    }
}

fn verify_argon2(candidate: &str, stored: &str) -> VerifyOutcome {
    let Ok(parsed) = PasswordHash::new(stored) else {
        return VerifyOutcome {
            valid: false,
            needs_rehash: false,
        };
    };
    let valid = Argon2::default()
        .verify_password(candidate.as_bytes(), &parsed)
        .is_ok();
    // Already on argon2; no migration needed.
    VerifyOutcome {
        valid,
        needs_rehash: false,
    }
}

/// Legacy Node-era format: `<salt_hex>:<derived_hex>` using scrypt
/// with Node's defaults (N=16384, r=8, p=1). Returns None if the
/// format doesn't parse — caller will fall through to "invalid."
fn verify_legacy_scrypt(candidate: &str, stored: &str) -> Option<VerifyOutcome> {
    let (salt_hex, key_hex) = stored.split_once(':')?;
    let salt = hex_decode(salt_hex)?;
    let expected = hex_decode(key_hex)?;
    if salt.len() != LEGACY_SALT_BYTES || expected.len() != LEGACY_KEY_BYTES {
        return None;
    }
    // Node's `crypto.scrypt(password, salt, 64)` uses N=16384, r=8, p=1.
    // log2(16384) = 14.
    let params = scrypt::Params::new(14, 8, 1, LEGACY_KEY_BYTES).ok()?;
    let mut derived = vec![0u8; LEGACY_KEY_BYTES];
    if scrypt(candidate.as_bytes(), &salt, &params, &mut derived).is_err() {
        return Some(VerifyOutcome {
            valid: false,
            needs_rehash: false,
        });
    }
    let valid = constant_time_eq(&derived, &expected);
    Some(VerifyOutcome {
        valid,
        // Force migration to argon2id on next successful login. Even
        // if this verify fails we don't rehash (nothing to compare
        // against), but successful matches do.
        needs_rehash: valid,
    })
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    for i in (0..s.len()).step_by(2) {
        let byte = u8::from_str_radix(&s[i..i + 2], 16).ok()?;
        out.push(byte);
    }
    Some(out)
}
