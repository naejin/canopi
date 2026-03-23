mod commands;
mod db;
mod design;
mod logging;
mod platform;

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::species::search_species,
            commands::design::save_design,
            commands::design::load_design,
            commands::content::list_learning_topics,
        ])
        .setup(|app| {
            // Logging
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            logging::init(&log_dir);
            tracing::info!("Canopi starting");

            // User DB (writable, in app data dir)
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let user_db_path = data_dir.join("user.db");
            let user_conn = Connection::open(&user_db_path)
                .map_err(|e| format!("Failed to open user DB: {e}"))?;
            db::user_db::init(&user_conn)
                .map_err(|e| format!("Failed to init user DB: {e}"))?;
            app.manage(db::UserDb(Mutex::new(user_conn)));

            tracing::info!("User DB initialized at {}", user_db_path.display());

            // Note: db_ready event is not emitted here because the frontend
            // JS listener hasn't registered yet during setup. The DB is ready
            // synchronously before any IPC command can be invoked.

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running canopi");
}
