//! Fixed reusable library items (GeoLibre adoption S2).
//!
//! A published item's content is fixed: importing more data creates another
//! item, analyses create separate results, and nothing refreshes itself. These
//! tests cross the real `LidarLibrary` owner and a temporary library.

use super::*;
use common_types::lidar::{
    LidarDisplayRequest, LidarDisplayState, LidarMeasurementKind, LidarSampleEntityKind,
};
use std::path::Path;

fn scratch(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(catalogue::new_id(&format!("canopi-fixed-{label}")));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn seed_result(
    connection: &Connection,
    layer_id: &str,
    definition_id: &str,
    source_generation: &str,
) {
    connection
        .execute(
            "INSERT INTO lidar_analysis_definitions
             (id, layer_id, kind, version, parameters_json, created_at)
             VALUES (?1, ?2, 'slope', 1, '{}', '0')",
            rusqlite::params![definition_id, layer_id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO lidar_analysis_generations
             (id, definition_id, source_generation_id, engine_version, state, result_path,
              quality_mask_path, manifest_json, coverage_cells, min_value, max_value,
              bounds_3857, published_at)
             VALUES (?1, ?2, ?3, 'test', 'complete', '', NULL, '{}', 1, 0, 1, '[0,0,1,1]', '0')",
            rusqlite::params![
                format!("agen-{definition_id}"),
                definition_id,
                source_generation
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO lidar_analysis_heads(definition_id, generation_id) VALUES (?1, ?2)",
            rusqlite::params![definition_id, format!("agen-{definition_id}")],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO lidar_dependencies(definition_id, layer_id, kind) VALUES (?1, ?2, 'source')",
            rusqlite::params![definition_id, layer_id],
        )
        .unwrap();
}

fn count(library: &LidarLibrary, sql: &str) -> i64 {
    library
        .catalogue()
        .unwrap()
        .query_row(sql, [], |row| row.get(0))
        .unwrap()
}

/// A source with a saved result cannot be deleted: the result keeps meaning
/// only while its input exists. Deleting the result first leaves the source,
/// and then the source can go.
#[test]
fn deleting_a_source_with_a_saved_result_is_refused_until_the_result_is_deleted() {
    let root = scratch("delete-guard");
    let library = LidarLibrary::open(&root).unwrap();
    let (layer_id, _) = library
        .record_import_item(
            "Orchard",
            LidarMeasurementKind::GroundElevation,
            None,
            false,
            &[root.join("a.tif")],
        )
        .unwrap();
    seed_result(
        &library.catalogue().unwrap(),
        &layer_id,
        "adef-kept",
        "gen-input",
    );

    let refused = library.delete_layer(&layer_id).unwrap_err();
    assert!(refused.contains("1 saved result"), "{refused}");
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_source_layers"),
        1
    );
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_analysis_definitions"),
        1
    );
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_analysis_heads"),
        1
    );

    let impact = library.delete_impact(&layer_id).unwrap();
    assert_eq!(impact.analysis_ids, ["adef-kept"]);

    library.delete_analysis("adef-kept").unwrap();
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_source_layers"),
        1
    );
    library.delete_layer(&layer_id).unwrap();
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_source_layers"),
        0
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// One import is one item: it exists as an unpublished operation, is never
/// presented as a ready empty dataset, keeps its identity and saved request
/// across Retry, and Dismiss removes only that unpublished operation.
#[test]
fn an_import_is_one_unpublished_item_with_a_retryable_saved_request() {
    let root = scratch("import-item");
    let library = LidarLibrary::open(&root).unwrap();
    let first = root.join("north.tif");
    let second = root.join("south.tif");
    let (layer_id, job_id) = library
        .record_import_item(
            "  Orchard survey ",
            LidarMeasurementKind::GroundElevation,
            None,
            false,
            &[first.clone(), second.clone()],
        )
        .unwrap();

    let snapshot = library.library_snapshot().unwrap();
    let item = snapshot
        .layers
        .iter()
        .find(|layer| layer.id == layer_id)
        .unwrap();
    assert_eq!(item.name, "Orchard survey");
    assert_eq!(item.generation_id, None);
    assert_eq!(item.state, LidarResultState::Preparing);
    assert_eq!(
        item.import_job.as_ref().map(|job| job.job_id.as_str()),
        Some(job_id.as_str())
    );

    library
        .catalogue()
        .unwrap()
        .execute(
            "UPDATE lidar_import_jobs SET state = 'failed', message = 'south.tif is not tiled' WHERE id = ?1",
            [&job_id],
        )
        .unwrap();
    let failed = library.library_snapshot().unwrap();
    let item = failed
        .layers
        .iter()
        .find(|layer| layer.id == layer_id)
        .unwrap();
    assert_eq!(item.state, LidarResultState::Failed);
    assert_eq!(item.generation_id, None);

    let (retry_layer, retry_job, paths) = library.record_import_retry(&layer_id).unwrap();
    assert_eq!(retry_layer, layer_id);
    assert_ne!(retry_job, job_id);
    assert_eq!(
        paths,
        [first, second],
        "Retry keeps the saved selection order"
    );
    assert!(
        library.record_import_retry(&layer_id).is_err(),
        "a running operation cannot be retried twice"
    );

    let refused = library.dismiss_import(&layer_id).unwrap_err();
    assert!(refused.contains("running"), "{refused}");
    library.cancel_job(&retry_job);
    library.dismiss_import(&layer_id).unwrap();
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_source_layers"),
        0
    );
    assert_eq!(count(&library, "SELECT COUNT(*) FROM lidar_import_jobs"), 0);
    let _ = std::fs::remove_dir_all(&root);
}

/// An empty selection or a blank name creates nothing.
#[test]
fn an_import_without_files_or_name_creates_nothing() {
    let root = scratch("import-refused");
    let library = LidarLibrary::open(&root).unwrap();
    assert!(
        library
            .record_import_item(
                "Orchard",
                LidarMeasurementKind::GroundElevation,
                None,
                false,
                &[]
            )
            .is_err()
    );
    assert!(
        library
            .record_import_item(
                "  ",
                LidarMeasurementKind::GroundElevation,
                None,
                false,
                &[root.join("a.tif")]
            )
            .is_err()
    );
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_source_layers"),
        0
    );
    assert_eq!(count(&library, "SELECT COUNT(*) FROM lidar_import_jobs"), 0);
    let _ = std::fs::remove_dir_all(&root);
}

fn plane(library: &LidarLibrary, root: &Path, name: &str, origin_x: f64) -> PathBuf {
    let cancel = AtomicBool::new(false);
    let (width, height) = (64u32, 48u32);
    let values: Vec<f32> = (0..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .map(|(x, _)| x as f32)
        .collect();
    let raw = root.join(format!("{name}.raw"));
    import::write_f32_raw(&raw, &values).unwrap();
    let source = root.join(format!("{name}.tif"));
    import::raw_to_tif(
        &library.inner.engine,
        &cancel,
        &raw,
        &source,
        &grid::RasterGrid {
            width,
            height,
            geotransform: [origin_x, 1.0, 0.0, 6_806_000.0, 0.0, -1.0],
        },
        "EPSG:2154",
        -9999.0,
    )
    .unwrap();
    source
}

fn await_import(library: &LidarLibrary, job_id: &str) -> LidarImportJobState {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        let job = library.get_import_job(job_id).unwrap().unwrap();
        if matches!(
            job.state,
            LidarImportJobState::Complete
                | LidarImportJobState::Failed
                | LidarImportJobState::Cancelled
        ) && !library
            .inner
            .cancel_flags
            .lock()
            .unwrap()
            .contains_key(job_id)
        {
            return job.state;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "import {job_id} did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// Through the real command state: an import publishes one item whose display
/// derivatives already exist, a published item refuses more sources, and
/// neither import nor reopening enqueues any analysis.
#[test]
#[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
fn an_import_publishes_one_fixed_item_with_display_ready_and_nothing_refreshes() {
    let root = scratch("import-publish");
    let library = LidarLibrary::open(&root).unwrap();
    let executor = crate::native_operation::NativeOperationExecutor::production();
    library.attach_executor(executor.clone());
    let west = plane(&library, &root, "west", 445_000.0);
    let east = plane(&library, &root, "east", 445_064.0);

    let receipt = library
        .import_item(
            "Pair",
            LidarMeasurementKind::GroundElevation,
            None,
            false,
            vec![west.clone(), east],
        )
        .unwrap();
    assert_eq!(
        await_import(&library, &receipt.job_id),
        LidarImportJobState::Complete
    );
    let snapshot = library.library_snapshot().unwrap();
    let item = snapshot
        .layers
        .iter()
        .find(|layer| layer.id == receipt.layer_id)
        .unwrap();
    assert_eq!(item.state, LidarResultState::Ready);
    let generation = item.generation_id.clone().expect("published head");

    // Display derivatives were staged by the import job itself.
    let descriptor = library
        .display_descriptor(&LidarDisplayRequest {
            kind: LidarSampleEntityKind::Source,
            entity_id: receipt.layer_id.clone(),
            expected_generation_id: Some(generation.clone()),
            retry: false,
        })
        .unwrap();
    assert_eq!(descriptor.state, LidarDisplayState::Ready, "{descriptor:?}");
    assert_eq!(descriptor.assets.len(), 2);

    // A published item's content is fixed, even for a stale caller.
    let refused = library
        .begin_import_sources("imp-stale", &receipt.layer_id, vec![west])
        .unwrap_err();
    assert!(refused.contains("published"), "{refused}");
    let head = catalogue::head_generation(&library.catalogue().unwrap(), &receipt.layer_id)
        .unwrap()
        .unwrap();
    assert_eq!(head.id, generation);

    // A saved result whose input is not the head is still a fixed result:
    // reopening the library and attaching the executor enqueue nothing.
    seed_result(
        &library.catalogue().unwrap(),
        &receipt.layer_id,
        "adef-old",
        "gen-earlier",
    );
    drop(library);
    let reopened = LidarLibrary::open(&root).unwrap();
    reopened.attach_executor(executor);
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(
        count(&reopened, "SELECT COUNT(*) FROM lidar_analysis_jobs"),
        0
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Renaming a result is metadata: its values, input and identity stay, and
/// nothing is enqueued.
#[test]
fn renaming_a_result_changes_only_its_name() {
    let root = scratch("rename-result");
    let library = LidarLibrary::open(&root).unwrap();
    let (layer_id, _) = library
        .record_import_item(
            "Orchard",
            LidarMeasurementKind::GroundElevation,
            None,
            false,
            &[root.join("a.tif")],
        )
        .unwrap();
    seed_result(
        &library.catalogue().unwrap(),
        &layer_id,
        "adef-named",
        "gen-input",
    );
    library
        .rename_analysis("adef-named", "  North slope ")
        .unwrap();
    let snapshot = library.library_snapshot().unwrap();
    let result = snapshot
        .analyses
        .iter()
        .find(|analysis| analysis.id == "adef-named")
        .unwrap();
    assert_eq!(result.name.as_deref(), Some("North slope"));
    assert_eq!(result.input_generation_id.as_deref(), Some("gen-input"));
    assert_eq!(result.generation_id.as_deref(), Some("agen-adef-named"));
    assert!(library.rename_analysis("adef-named", "   ").is_err());
    assert!(library.rename_analysis("adef-missing", "Name").is_err());
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_analysis_jobs"),
        0
    );
    let _ = std::fs::remove_dir_all(&root);
}

fn seed_head(connection: &Connection, layer_id: &str, generation_id: &str) {
    connection
        .execute(
            "INSERT INTO lidar_layer_generations
             (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
              coverage_cells, min_value, max_value, bounds_3857)
             VALUES (?1, ?2, '0', '', '', '{}', 1, 0, 1, '[0,0,1,1]')",
            rusqlite::params![generation_id, layer_id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES (?1, ?2)
             ON CONFLICT(layer_id) DO UPDATE SET generation_id = excluded.generation_id",
            rusqlite::params![layer_id, generation_id],
        )
        .unwrap();
}

/// A definition whose operation failed, optionally with a job pinned to an input.
fn seed_failed(
    connection: &Connection,
    layer_id: &str,
    definition_id: &str,
    version: i64,
    pinned: Option<&str>,
) {
    connection
        .execute(
            "INSERT INTO lidar_analysis_definitions
             (id, layer_id, kind, version, parameters_json, created_at)
             VALUES (?1, ?2, 'slope', ?3, '{\"slope_unit\":\"Percent\",\"name\":\"North\"}', '0')",
            rusqlite::params![definition_id, layer_id, version],
        )
        .unwrap();
    if let Some(input) = pinned {
        connection
            .execute(
                "INSERT INTO lidar_analysis_jobs
                 (id, definition_id, source_generation_id, state, message, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'failed', 'engine stopped', '1', '1')",
                rusqlite::params![format!("job-{definition_id}"), definition_id, input],
            )
            .unwrap();
    }
}

fn source_item(library: &LidarLibrary, root: &Path) -> String {
    library
        .record_import_item(
            "Orchard",
            LidarMeasurementKind::GroundElevation,
            None,
            false,
            &[root.join("a.tif")],
        )
        .unwrap()
        .0
}

/// The stored recipe version decides the method: a version this build does not
/// know fails by name before any work, and the saved result stays as it is.
#[test]
fn an_unknown_recipe_version_fails_explicitly_and_keeps_the_result() {
    let root = scratch("unknown-recipe");
    let library = LidarLibrary::open(&root).unwrap();
    let layer_id = source_item(&library, &root);
    {
        let connection = library.catalogue().unwrap();
        seed_head(&connection, &layer_id, "gen-1");
        seed_result(&connection, &layer_id, "adef-future", "gen-1");
        connection
            .execute("UPDATE lidar_analysis_definitions SET version = 7", [])
            .unwrap();
    }
    let error = analysis::run_slope_job(
        &library,
        "job-future",
        "adef-future",
        &analysis::AnalysisParameters {
            slope_unit: None,
            name: None,
        },
        "gen-1",
        &AtomicBool::new(false),
    )
    .expect_err("an unknown recipe does not run");
    assert!(error.contains("recipe version 7"), "{error}");
    assert!(
        library.retry_analysis("adef-future", "gen-1").is_err(),
        "nor is it retried"
    );
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_analysis_heads"),
        1
    );
    let snapshot = library.library_snapshot().unwrap();
    assert_eq!(snapshot.analyses[0].method, None);
    let _ = std::fs::remove_dir_all(&root);
}

/// Retry reruns a failed operation with its saved definition against the input
/// it was pinned to. A complete result, an operation without a recorded input
/// and an input that is gone or not the expected one are refused by name.
#[test]
fn retry_reruns_only_a_failed_operation_with_its_pinned_input() {
    let root = scratch("retry-rules");
    let library = LidarLibrary::open(&root).unwrap();
    let layer_id = source_item(&library, &root);
    {
        let connection = library.catalogue().unwrap();
        seed_head(&connection, &layer_id, "gen-1");
        seed_result(&connection, &layer_id, "adef-done", "gen-1");
        seed_failed(&connection, &layer_id, "adef-orphan", 2, None);
        seed_failed(&connection, &layer_id, "adef-old", 2, Some("gen-0"));
        seed_failed(&connection, &layer_id, "adef-failed", 2, Some("gen-1"));
    }
    let complete = library.retry_analysis("adef-done", "gen-1").unwrap_err();
    assert!(complete.contains("new slope"), "{complete}");
    let orphan = library.retry_analysis("adef-orphan", "gen-1").unwrap_err();
    assert!(orphan.contains("no recorded input"), "{orphan}");
    let gone = library.retry_analysis("adef-old", "gen-0").unwrap_err();
    assert!(gone.contains("no longer available"), "{gone}");
    let retargeted = library.retry_analysis("adef-old", "gen-1").unwrap_err();
    assert!(retargeted.contains("not the one expected"), "{retargeted}");
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_analysis_jobs"),
        2
    );

    let receipt = library.retry_analysis("adef-failed", "gen-1").unwrap();
    assert_eq!(receipt.definition_id, "adef-failed");
    let (input, version): (String, i64) = library
        .catalogue()
        .unwrap()
        .query_row(
            "SELECT j.source_generation_id, d.version FROM lidar_analysis_jobs j
             JOIN lidar_analysis_definitions d ON d.id = j.definition_id WHERE j.id = ?1",
            [&receipt.job_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        (input.as_str(), version),
        ("gen-1", 2),
        "same input, same recipe"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Without the GeoLibre engine new slope results are unavailable by name and
/// nothing is created; there is no fallback to the legacy Horn recipe.
#[test]
fn creating_a_slope_without_the_geolibre_engine_is_refused_by_name() {
    let root = scratch("no-geolibre");
    let library = LidarLibrary::open(&root).unwrap();
    library
        .inner
        .geolibre
        .preset(Err("the GeoLibre slope engine is not installed".to_string()));
    let layer_id = source_item(&library, &root);
    seed_head(&library.catalogue().unwrap(), &layer_id, "gen-1");
    let error = library
        .create_analysis(
            &layer_id,
            common_types::lidar::LidarAnalysisKind::Slope,
            common_types::lidar::LidarAnalysisParameters {
                slope_unit: None,
                name: None,
            },
            None,
        )
        .unwrap_err();
    assert!(error.contains("not installed"), "{error}");
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_analysis_definitions"),
        0
    );
    let snapshot = library.library_snapshot().unwrap();
    assert!(!snapshot.slope_engine.available);
    assert!(
        snapshot
            .slope_engine
            .detail
            .unwrap()
            .contains("not installed")
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// The read model names each definition's method from its recipe, and a failed
/// operation reports the input it was pinned to, which is what Retry reruns.
#[test]
fn the_snapshot_reports_method_and_the_pinned_input_of_a_failed_operation() {
    let root = scratch("method-read-model");
    let library = LidarLibrary::open(&root).unwrap();
    let layer_id = source_item(&library, &root);
    {
        let connection = library.catalogue().unwrap();
        seed_head(&connection, &layer_id, "gen-1");
        seed_result(&connection, &layer_id, "adef-horn", "gen-1");
        seed_failed(&connection, &layer_id, "adef-new", 2, Some("gen-1"));
    }
    let snapshot = library.library_snapshot().unwrap();
    let find = |id: &str| snapshot.analyses.iter().find(|a| a.id == id).unwrap();
    assert_eq!(
        find("adef-horn").method,
        Some(common_types::lidar::LidarAnalysisMethod::GdalHornV1)
    );
    let failed = find("adef-new");
    assert_eq!(
        failed.method,
        Some(common_types::lidar::LidarAnalysisMethod::GeolibreProjectedSlopeV1)
    );
    assert_eq!(failed.state, common_types::lidar::LidarResultState::Failed);
    assert_eq!(failed.input_generation_id.as_deref(), Some("gen-1"));
    assert_eq!(failed.generation_id, None);
    assert_eq!(
        failed.slope_unit,
        Some(common_types::lidar::LidarSlopeUnit::Percent)
    );
    // An operation without a result is shown under the name its author gave it.
    assert_eq!(failed.name.as_deref(), Some("North"));
    let _ = std::fs::remove_dir_all(&root);
}
