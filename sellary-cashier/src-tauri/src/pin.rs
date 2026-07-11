use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

/// Hash a PIN with argon2id. Returns a PHC string (algorithm + params + salt + hash).
#[tauri::command]
pub fn pin_hash(pin: String) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

/// Verify a PIN against a stored PHC string. Constant-time (provided by the argon2 crate).
#[tauri::command]
pub fn pin_verify(pin: String, phc: String) -> Result<bool, String> {
    let parsed = PasswordHash::new(&phc).map_err(|e| e.to_string())?;
    Ok(Argon2::default()
        .verify_password(pin.as_bytes(), &parsed)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify_roundtrip() {
        let phc = pin_hash("1234".to_string()).unwrap();
        assert!(phc.starts_with("$argon2id$"), "must be argon2id: {phc}");
        assert!(pin_verify("1234".to_string(), phc.clone()).unwrap());
        assert!(!pin_verify("9999".to_string(), phc).unwrap());
    }

    #[test]
    fn distinct_salts_produce_distinct_hashes() {
        let a = pin_hash("1234".to_string()).unwrap();
        let b = pin_hash("1234".to_string()).unwrap();
        assert_ne!(a, b, "each hash must embed a fresh random salt");
        assert!(pin_verify("1234".to_string(), a).unwrap());
        assert!(pin_verify("1234".to_string(), b).unwrap());
    }

    #[test]
    fn malformed_phc_is_err() {
        assert!(pin_verify("1234".to_string(), "not-a-hash".to_string()).is_err());
    }
}
