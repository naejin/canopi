mod commands;
mod db;
mod design;
mod logging;
mod platform;

use std::sync::Mutex;
use rusqlite::{Connection, OpenFlags};
use tauri::Manager;
use common_types::health::{SubsystemHealth, PlantDbStatus};

pub struct AppHealth(pub Mutex<SubsystemHealth>);

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::species::search_species,
            commands::species::get_species_detail,
            commands::species::get_species_relationships,
            commands::species::get_common_names,
            commands::species::get_species_batch,
            commands::species::get_filter_options,
            commands::favorites::toggle_favorite,
            commands::favorites::get_favorites,
            commands::favorites::get_recently_viewed,
            commands::design::new_design,
            commands::design::save_design,
            commands::design::load_design,
            commands::design::get_recent_files,
            commands::design::autosave_design,
            commands::design::list_autosaves,
            commands::design::recover_autosave,
            commands::content::list_learning_topics,
            commands::export::export_file,
            commands::export::export_binary,
            commands::export::read_file_bytes,
            commands::health::get_health,
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

            // Plant DB (read-only, bundled resource)
            // In dev mode, the resource resolver may not find bundled files,
            // so fall back to the source path in the repo.
            let plant_db_path = app
                .path()
                .resolve("canopi-core.db", tauri::path::BaseDirectory::Resource)
                .ok()
                .filter(|p| p.exists())
                .or_else(|| {
                    // Dev fallback: look in desktop/resources/ relative to the manifest dir
                    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("resources")
                        .join("canopi-core.db");
                    if dev_path.exists() { Some(dev_path) } else { None }
                });

            let plant_db_status = match plant_db_path {
                Some(path) => {
                    match Connection::open_with_flags(
                        &path,
                        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                    ) {
                        Ok(plant_conn) => {
                            if let Err(e) = plant_conn.pragma_update(None, "mmap_size", 268435456_i64) {
                                tracing::warn!("Failed to set plant DB mmap_size: {e}");
                            }
                            if let Err(e) = plant_conn.pragma_update(None, "cache_size", -64000_i64) {
                                tracing::warn!("Failed to set plant DB cache_size: {e}");
                            }
                            app.manage(db::PlantDb(Mutex::new(plant_conn)));
                            tracing::info!("Plant DB opened at {}", path.display());
                            PlantDbStatus::Available
                        }
                        Err(e) => {
                            tracing::error!("Failed to open plant DB at {}: {e}. Species search unavailable.", path.display());
                            // Register an empty in-memory DB so State<PlantDb> doesn't panic
                            let fallback = Connection::open_in_memory().expect("in-memory DB");
                            app.manage(db::PlantDb(Mutex::new(fallback)));
                            PlantDbStatus::Corrupt
                        }
                    }
                }
                None => {
                    tracing::error!("Plant DB not found. Run scripts/prepare-db.py first. Species search unavailable.");
                    let fallback = Connection::open_in_memory().expect("in-memory DB");
                    app.manage(db::PlantDb(Mutex::new(fallback)));
                    PlantDbStatus::Missing
                }
            };

            app.manage(AppHealth(Mutex::new(SubsystemHealth {
                plant_db: plant_db_status,
            })));

            // Note: db_ready event is not emitted here because the frontend
            // JS listener hasn't registered yet during setup. The DB is ready
            // synchronously before any IPC command can be invoked.

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running canopi");
}
