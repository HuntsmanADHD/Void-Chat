//! Rust-side mirror of `src/lib/wash.ts` (passphrase mode only).
//! Used so the .onion identity backup flow can encrypt without
//! handing the secret key to the renderer first — audit pt6 H7.
//!
//! Wire format MUST match the JS implementation exactly so existing
//! `.washed` backups remain decryptable:
//!
//!     "void$wash$v1$" + base64(salt(16) || iv(12) || ciphertext)
//!
//! Parameters:
//!   - PBKDF2-HMAC-SHA256, 200,000 iterations
//!   - AES-256-GCM, 12-byte IV
//!   - 16-byte salt
//!
//! Mismatching any of these would silently make every existing backup
//! restore as garbage. There's a round-trip unit test at the bottom
//! pinning the format.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose, Engine as _};
use hmac::Hmac;
use sha2::Sha256;

pub const PREFIX: &str = "void$wash$v1$";
const SALT_BYTES: usize = 16;
const IV_BYTES: usize = 12;
const PBKDF2_ITERATIONS: u32 = 200_000;

/// Encrypt `plaintext` with the passphrase, producing a wash-format
/// string. Same shape as `wash()` in `src/lib/wash.ts`.
pub fn wash_encrypt(plaintext: &[u8], passphrase: &str) -> Result<String, String> {
    if passphrase.is_empty() {
        return Err("passphrase is required".to_string());
    }
    let mut salt = [0u8; SALT_BYTES];
    let mut iv = [0u8; IV_BYTES];
    getrandom::getrandom(&mut salt).map_err(|e| format!("OS RNG unavailable: {e}"))?;
    getrandom::getrandom(&mut iv).map_err(|e| format!("OS RNG unavailable: {e}"))?;

    let key_bytes = derive_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let nonce = Nonce::from_slice(&iv);

    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("AES-GCM encrypt failed: {e}"))?;

    let mut blob = Vec::with_capacity(salt.len() + iv.len() + ct.len());
    blob.extend_from_slice(&salt);
    blob.extend_from_slice(&iv);
    blob.extend_from_slice(&ct);

    let encoded = general_purpose::STANDARD.encode(&blob);
    Ok(format!("{PREFIX}{encoded}"))
}

/// Decrypt a wash-format string. Returns the plaintext bytes, or an
/// error if the passphrase is wrong / the blob is malformed.
pub fn wash_decrypt(washed: &str, passphrase: &str) -> Result<Vec<u8>, String> {
    let Some(body) = washed.strip_prefix(PREFIX) else {
        return Err("not a v1 wash blob (wrong prefix)".to_string());
    };
    let blob = general_purpose::STANDARD
        .decode(body)
        .map_err(|e| format!("base64 decode failed: {e}"))?;
    if blob.len() < SALT_BYTES + IV_BYTES + 1 {
        return Err("blob too short".to_string());
    }
    let salt = &blob[..SALT_BYTES];
    let iv = &blob[SALT_BYTES..SALT_BYTES + IV_BYTES];
    let ct = &blob[SALT_BYTES + IV_BYTES..];

    let key_bytes = derive_key(passphrase, salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let nonce = Nonce::from_slice(iv);

    cipher
        .decrypt(nonce, ct)
        .map_err(|_| "decrypt failed (wrong passphrase or corrupted blob)".to_string())
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2::<Hmac<Sha256>>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key)
        .map_err(|e| format!("PBKDF2 failed: {e}"))?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let pt = b"hello onion identity";
        let pass = "correct horse battery staple";
        let washed = wash_encrypt(pt, pass).unwrap();
        assert!(washed.starts_with(PREFIX));
        let pt2 = wash_decrypt(&washed, pass).unwrap();
        assert_eq!(pt2, pt);
    }

    #[test]
    fn wrong_passphrase_fails() {
        let washed = wash_encrypt(b"secret", "right").unwrap();
        assert!(wash_decrypt(&washed, "wrong").is_err());
    }

    #[test]
    fn truncated_blob_fails() {
        let washed = wash_encrypt(b"secret", "pass").unwrap();
        let truncated = &washed[..washed.len() - 10];
        assert!(wash_decrypt(truncated, "pass").is_err());
    }

    #[test]
    fn rejects_wrong_prefix() {
        assert!(wash_decrypt("void$wash$pub1$xxx", "pass").is_err());
        assert!(wash_decrypt("plain text", "pass").is_err());
    }

    /// Pinned fixture proving format compat with `src/lib/wash.ts`.
    /// This blob was produced by Node's `crypto` using the same
    /// algorithm (PBKDF2-SHA256 200k iter + AES-256-GCM with the GCM
    /// tag appended to the ciphertext — exactly what WebCrypto does).
    /// If this test ever fails, the JS Wash format diverged from
    /// what `wash_encrypt`/`wash_decrypt` implement and existing
    /// `.washed` backups will silently stop restoring.
    #[test]
    fn decrypts_js_produced_blob() {
        let washed = "void$wash$v1$iQj6pauYzgwKRes/fHffESfrKbEoAkVGtZdiPXl1Z5jyrwTChtpw2ABOn64SyduO4MImMz68dwOoJviXQwM36T0UNR7vc8LCLw==";
        let passphrase = "cross-compat-test-12chars";
        let pt = wash_decrypt(washed, passphrase).expect("decrypt JS blob");
        assert_eq!(
            std::str::from_utf8(&pt).unwrap(),
            "hello from JS, verify in Rust"
        );
    }
}
