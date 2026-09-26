mod commands;
mod db;
mod design;
mod http;
mod image_cache;
mod logging;
#[cfg(test)]
mod native_command_policy;
mod native_operation;
mod services;

use common_types::health::SubsystemHealth;
use rusqlite::{Connection, OpenFlags};
use tauri::Manager;

pub struct AppHealth(pub SubsystemHealth);

const PLANT_DB_BUNDLED_PATHS: &[&str] = &["resources/canopi-core.db", "canopi-core.db"];

fn resolve_plant_db_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<std::path::PathBuf> {
    // Tauri resource resolution must use the same relative path syntax as
    // `tauri.conf.json > bundle > resources`. Because the config bundles
    // `resources/canopi-core.db`, packaged apps must resolve that path first.
    PLANT_DB_BUNDLED_PATHS
        .iter()
        .find_map(|resource_path| {
            app.path()
                .resolve(resource_path, tauri::path::BaseDirectory::Resource)
                .ok()
                .filter(|path| path.exists())
        })
        .or_else(dev_plant_db_path)
}

/// Debug builds run from the repository, where `scripts/prepare-db.py` leaves
/// the DB under `desktop/resources/`. A release build never looks outside its
/// bundle.
#[cfg(debug_assertions)]
fn dev_plant_db_path() -> Option<std::path::PathBuf> {
    Some(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("canopi-core.db"),
    )
    .filter(|path| path.exists())
}

#[cfg(not(debug_assertions))]
fn dev_plant_db_path() -> Option<std::path::PathBuf> {
    None
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_dialog::init());

    // Localhost only: the bridge can execute script in the webview.
    #[cfg(all(debug_assertions, feature = "mcp-bridge"))]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init_with_config(
        tauri_plugin_mcp_bridge::Config::localhost_only(),
    ));

    let result = builder
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::species::search_species,
            commands::species::supersede_species_search,
            commands::species::get_species_detail,
            commands::species::get_common_names,
            commands::species::get_species_batch,
            commands::species::get_flower_color_batch,
            commands::species::get_filter_options,
            commands::species::get_dynamic_filter_options,
            commands::species::get_species_images,
            commands::species::get_locale_common_names,
            commands::species::get_cached_image_path,
            commands::favorites::toggle_favorite,
            commands::favorites::get_favorites,
            commands::favorites::get_recently_viewed,
            commands::saved_object_stamps::get_saved_object_stamps,
            commands::saved_object_stamps::create_saved_object_stamp,
            commands::saved_object_stamps::rename_saved_object_stamp,
            commands::saved_object_stamps::delete_saved_object_stamp,
            commands::saved_object_stamps::reorder_saved_object_stamps,
            commands::saved_object_stamps::export_saved_object_stamp_canopi_file,
            commands::saved_object_stamps::load_saved_object_stamp_canopi_file,
            commands::design::new_design,
            commands::design::save_design,
            commands::design::load_design,
            commands::design::get_recent_files,
            commands::design::save_design_draft,
            commands::design::load_design_draft,
            commands::design::list_design_drafts,
            commands::design::delete_design_draft,
            commands::design_notebook::get_design_notebook,
            commands::design_notebook::create_notebook_section,
            commands::design_notebook::add_design_reference_to_notebook,
            commands::design_notebook::rename_notebook_section,
            commands::design_notebook::delete_notebook_section,
            commands::design_notebook::move_design_reference_to_section,
            commands::design_notebook::remove_design_reference,
            commands::design_notebook::reorder_notebook_sections,
            commands::design_notebook::reorder_design_references,
            commands::design_notebook::relocate_design_reference,
            commands::export::export_file,
            commands::export::read_geojson_file,
            commands::export::save_canvas_pdf,
            commands::health::get_health,
            commands::problem_report::create_problem_report,
            commands::problem_report::show_problem_report_folder,
            commands::geocoding::geocode_address,
            commands::lidar::lidar_list_library,
            commands::lidar::lidar_rename_item,
            commands::lidar::lidar_delete_impact,
            commands::lidar::lidar_delete_item,
            commands::lidar::lidar_cancel_import,
            commands::lidar::lidar_create_analysis,
            commands::lidar::lidar_rerun_analysis,
            commands::lidar::lidar_processing_history,
            commands::lidar::lidar_cancel_analysis_job,
            commands::lidar::lidar_sample_pixel,
            commands::lidar::lidar_cancel_sample_pixel,
            commands::lidar::lidar_display_descriptor,
            commands::lidar::lidar_import_item,
            commands::lidar::lidar_retry_import,
            commands::lidar::lidar_dismiss_import,
            commands::lidar::lidar_layer_collection,
        ])
        .setup(|app| {
            // Logging
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            logging::init(&log_dir);
            tracing::info!("Canopi starting");

            let native_executor = native_operation::NativeOperationExecutor::production();
            app.manage(native_executor.clone());
            tracing::info!("Native operation executor initialized");

            // User DB (writable, in app data dir)
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            design::drafts::remove_retired_autosave_store(&data_dir);
            app.manage(design::drafts::DesignDrafts::new(&data_dir));
            let user_db_path = data_dir.join("user.db");
            let user_db = match db::UserDb::open(&user_db_path) {
                Ok(user_db) => user_db,
                Err(error) => {
                    // A user database this Canopi cannot own (written by a newer
                    // version) is refused, never modified: tell the user and exit
                    // instead of panicking or showing a half-working window.
                    if let Some(message) = startup_refusal_message(&error) {
                        tracing::error!("User DB refused at startup");
                        refuse_startup(app, message);
                        return Ok(());
                    }
                    return Err(format!("Failed to initialize user DB: {error}").into());
                }
            };
            app.manage(user_db);

            tracing::info!("User DB initialized");

            // LiDAR library (dedicated catalogue, managed raster assets)
            let lidar_library = services::lidar::LidarLibrary::open(&data_dir)
                .map_err(|e| format!("Failed to initialize LiDAR library: {e}"))?;
            lidar_library.attach_executor(native_executor);
            app.manage(lidar_library);
            tracing::info!("LiDAR library initialized");

            // Image cache (disk-backed, in app data dir)
            let image_cache = match image_cache::ImageCache::new(&data_dir) {
                Ok(cache) => cache,
                Err(error) => {
                    tracing::warn!("Image cache init failed: {error}, using temp dir fallback");
                    image_cache::ImageCache::new(&std::env::temp_dir()).map_err(|fallback| {
                        format!("Failed to initialize image cache: {error}; temp dir fallback: {fallback}")
                    })?
                }
            };
            app.manage(image_cache);
            tracing::info!("Image cache initialized");

            // Plant DB (read-only, bundled resource)
            let plant_db_path = resolve_plant_db_path(app.handle());

            let plant_db = match plant_db_path {
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
                            let plant_db = db::PlantDb::available(plant_conn);
                            if plant_db.status() == common_types::health::PlantDbStatus::Available {
                                tracing::info!("Plant DB admitted at {}", path.display());
                            }
                            plant_db
                        }
                        Err(e) => {
                            tracing::error!("Failed to open plant DB at {}: {e}. Species search unavailable.", path.display());
                            db::PlantDb::corrupt()
                        }
                    }
                }
                None => {
                    tracing::error!("Plant DB not found. Run scripts/prepare-db.py first. Species search unavailable.");
                    db::PlantDb::missing()
                }
            };
            let plant_db_status = plant_db.status();
            app.manage(plant_db);
            app.manage(services::plant_browser::SpeciesSearchCancellation::default());

            app.manage(AppHealth(SubsystemHealth {
                plant_db: plant_db_status,
            }));

            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        tracing::error!("Canopi failed to run: {error}");
        eprintln!("Canopi failed to run: {error}");
        std::process::exit(1);
    }
}

/// The message for a startup failure the user can act on, or `None` when the
/// failure is an internal error.
fn startup_refusal_message(error: &db::UserDbInitError) -> Option<String> {
    match error {
        db::UserDbInitError::NewerSchemaVersion { .. } => Some(
            "Your Canopi data was saved by a newer version of Canopi. \
             Install the latest Canopi to open it; this version will not change it."
                .to_string(),
        ),
        _ => None,
    }
}

fn refuse_startup(app: &tauri::App, message: String) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
    let handle = app.handle().clone();
    app.dialog()
        .message(message)
        .title("Canopi")
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_a_newer_user_database_is_refused_with_a_message() {
        let newer = super::db::UserDbInitError::NewerSchemaVersion {
            found: 99,
            supported: 9,
        };
        let message = super::startup_refusal_message(&newer).expect("newer data is refused");
        assert!(message.contains("newer version of Canopi"));
        let older = super::db::UserDbInitError::OlderSchemaVersion {
            found: 8,
            supported: 9,
        };
        assert!(super::startup_refusal_message(&older).is_none());
    }

    #[test]
    fn global_tauri_api_and_bridge_capability_exist_only_for_the_debug_bridge() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let dev_bridge = cfg!(all(debug_assertions, feature = "mcp-bridge"));
        assert_eq!(context.config().app.with_global_tauri, dev_bridge);
        let capabilities = context
            .config()
            .app
            .security
            .capabilities
            .iter()
            .map(|capability| match capability {
                tauri::utils::config::CapabilityEntry::Reference(identifier) => identifier.clone(),
                tauri::utils::config::CapabilityEntry::Inlined(capability) => {
                    capability.identifier.clone()
                }
            })
            .collect::<Vec<_>>();
        let mut expected = vec!["main-window".to_owned()];
        if dev_bridge {
            expected.push("mcp-bridge-dev".to_owned());
        }
        assert_eq!(capabilities, expected);
    }
}
