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
