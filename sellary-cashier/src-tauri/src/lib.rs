use sha2::{Sha256, Digest};
use tauri_plugin_sql::{Migration, MigrationKind};

mod pin;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:sellary_cashier.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "initial schema",
                            sql: include_str!("../migrations/001_init.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 2,
                            description: "local-first sales, history, device auth",
                            sql: include_str!("../migrations/002_local_first.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            let mut hasher = Sha256::new();
            hasher.update(password.as_bytes());
            hasher.finalize().to_vec()
        }).build())
        .invoke_handler(tauri::generate_handler![greet, pin::pin_hash, pin::pin_verify])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
