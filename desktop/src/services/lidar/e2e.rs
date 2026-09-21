//! End-to-end vertical-slice validation against the real IGN 0446_6807 MNT
//! fixture and the system GDAL engine.
//!
//! Ignored by default: it requires the GDAL command-line tools and the
//! fixture under `~/Downloads`. Run on a development OS with:
//! `cargo test -p canopi-desktop lidar::e2e -- --ignored --nocapture`

use super::*;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

fn assert_png_has_visible_pixels(engine: &engine::GdalEngine, path: &std::path::Path) {
    assert!(path.is_file(), "PNG is missing: {}", path.display());
    let output = engine
        .run(
            engine::GdalProgram::Info,
            &[
                "-json".to_string(),
                "-stats".to_string(),
                path.display().to_string(),
            ],
            None,
        )
        .expect("PNG opens through GDAL");
    let info: serde_json::Value = serde_json::from_str(&output.stdout).expect("PNG info is JSON");
    let alpha = info["bands"]
        .as_array()
        .and_then(|bands| {
            bands
                .iter()
                .find(|band| band["colorInterpretation"].as_str() == Some("Alpha"))
        })
        .expect("PNG has an alpha band");
    let maximum = alpha["metadata"][""]["STATISTICS_MAXIMUM"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .or_else(|| alpha["maximum"].as_f64())
        .expect("alpha statistics include a maximum");
    assert!(
        maximum > 0.0,
        "PNG is fully transparent: {}",
        path.display()
    );
}

fn assert_tileset_has_visible_pixels(
    engine: &engine::GdalEngine,
    tileset: &common_types::lidar::LidarTileset,
) {
    let template = match &tileset.source {
        common_types::lidar::LidarTileSource::LegacyAsset { path_template } => {
            path_template.clone()
        }
        common_types::lidar::LidarTileSource::NativeGeneration { .. } => {
            panic!("a published dense generation keeps its asset pyramid")
        }
    };
    let directory = std::path::Path::new(&template)
        .parent()
        .expect("tileset template has a parent");
    let mut pngs = std::fs::read_dir(directory)
        .expect("tileset directory exists")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("png"))
        .collect::<Vec<_>>();
    assert!(!pngs.is_empty(), "tileset directory contains PNG files");
    pngs.sort_by_key(|path| {
        std::fs::metadata(path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
    });
    assert_png_has_visible_pixels(engine, pngs.last().expect("largest tile exists"));
}

fn assert_known_slope(engine: &engine::GdalEngine, root: &std::path::Path, cancel: &AtomicBool) {
    let raw_path = root.join("known-slope.raw");
    let source_path = root.join("known-slope.tif");
    let result_path = root.join("known-slope-result.tif");
    let values = (0..5)
        .flat_map(|_| (0..5).map(|x| x as f32))
        .collect::<Vec<_>>();
    import::write_f32_raw(&raw_path, &values).expect("known plane raw writes");
    import::raw_to_tif(
        engine,
        cancel,
        &raw_path,
        &source_path,
        &grid::RasterGrid {
            width: 5,
            height: 5,
            geotransform: [0.0, 1.0, 0.0, 5.0, 0.0, -1.0],
        },
        "EPSG:3857",
        -9999.0,
    )
    .expect("known plane converts to GeoTIFF");
    engine
        .run(
            engine::GdalProgram::Dem,
            &[
                "slope".to_string(),
                "-s".to_string(),
                "1".to_string(),
                "-q".to_string(),
                source_path.display().to_string(),
                result_path.display().to_string(),
            ],
            Some(cancel),
        )
        .expect("known slope computes");
    let raw =
        import::raw_f32_bytes(engine, &result_path, 5, 5, cancel).expect("known slope reads back");
    let center = f32::from_le_bytes(raw[48..52].try_into().unwrap());
    assert!(
        (center - 45.0).abs() < 0.01,
        "one metre rise per horizontal metre must produce 45°, got {center}"
    );
}

/// Select the real ground-elevation fixture, explicitly rather than by discovery.
///
/// `CANOPI_LIDAR_E2E_FIXTURE` names the file to use, which keeps this test
/// runnable on a host whose available IGN tile is not the default one without
/// silently substituting a different tile. When the variable is unset the
/// documented `0446_6807` tile under `~/Downloads` is used, and a missing fixture
/// is reported rather than replaced. The test's expected scientific values are
/// tile-independent, so the selection changes only which real raster is read.
fn fixture_mnt() -> Result<PathBuf, String> {
    if let Some(explicit) = std::env::var_os("CANOPI_LIDAR_E2E_FIXTURE") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "CANOPI_LIDAR_E2E_FIXTURE points at a missing file: {}",
            path.display()
        ));
    }
    let downloads = dirs_home().join("Downloads");
    let dir = downloads.join("LHD_FXX_0446_6807_MNT_O_0M50_LAMB93_IGN69");
    let file = dir.join("LHD_FXX_0446_6807_MNT_O_0M50_LAMB93_IGN69");
    if file.is_file() {
        return Ok(file);
    }
    Err(format!(
        "IGN MNT fixture is missing; set CANOPI_LIDAR_E2E_FIXTURE to an explicit \
         ground-elevation GeoTIFF (looked for {})",
        file.display()
    ))
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

#[test]
#[ignore = "requires system GDAL and an IGN MNT fixture; see CANOPI_LIDAR_E2E_FIXTURE"]
fn e2e_import_publish_slope_restart_reuse() {
    let engine = engine::GdalEngine::new();
    let tools = engine.discover().expect("GDAL engine must be available");

    let fixture = match fixture_mnt() {
        Ok(path) => path,
        Err(reason) => panic!("{reason}"),
    };
    let work = std::env::temp_dir().join(format!("canopi-lidar-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).unwrap();
    let cancel = AtomicBool::new(false);
    assert_known_slope(&engine, &work, &cancel);

    // Open the library (slice 1: catalogue + assets under app data root).
    let library = LidarLibrary::open(&work).expect("library opens");

    // 1. Create one named ground layer.
    let layer_id = library
        .create_layer(
            "IGN ground POC",
            common_types::lidar::LidarMeasurementKind::GroundElevation,
        )
        .expect("layer created");

    // 2. Stage the real TIFF: probe, valid mask, classification, previews.
    let job_id = library.record_import_job(&layer_id).expect("job recorded");
    let output = import::stage_import(
        &library,
        &job_id,
        &layer_id,
        std::slice::from_ref(&fixture),
        &cancel,
    )
    .expect("staging succeeds");
    let review = &output.review;
    assert!(
        review.compatible,
        "fixture should be compatible: {:?}",
        review.issues
    );
    assert!(
        review.uncovered_cells > 3_000_000,
        "1km² at 0.5m ≈ 4M cells, got {}",
        review.uncovered_cells
    );
    assert!(
        review.before_preview_path.is_none(),
        "empty layer has no before preview"
    );
    assert!(
        review.after_preview_path.is_some(),
        "after preview rendered"
    );
    assert_png_has_visible_pixels(
        &engine,
        std::path::Path::new(review.after_preview_path.as_deref().unwrap()),
    );
    println!(
        "staged: uncovered={} overlap={} invalid={}",
        review.uncovered_cells, review.overlap_cells, review.invalid_cells
    );

    // 3. Apply the accepted import: publishes a generation + display tiles.
    library.finish_staging(
        &job_id,
        Ok(import::StagingOutput {
            review: review.clone(),
        }),
    );
    let staging: import::StagedImport = {
        let json =
            std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
                .unwrap();
        serde_json::from_str(&json).unwrap()
    };
    library
        .prepare_apply(&job_id)
        .expect("review commit accepted");
    let outcome =
        import::apply_import(&library, &staging, true, false, &cancel).expect("apply publishes");
    assert!(outcome.changed);
    let completed_job = library
        .get_import_job(&job_id)
        .unwrap()
        .expect("completed import job remains queryable");
    assert_eq!(
        completed_job.state,
        common_types::lidar::LidarImportJobState::Complete
    );
    assert_eq!(
        completed_job.progress,
        Some(common_types::lidar::LidarImportProgress {
            phase: common_types::lidar::LidarImportProgressPhase::Finalizing,
            percent: 100,
        })
    );
    println!("published: {}", outcome.summary());

    // Snapshot shows the layer with an elevation tileset.
    let snapshot = library.library_snapshot().expect("snapshot");
    assert_eq!(snapshot.layers.len(), 1);
    let layer = &snapshot.layers[0];
    assert_eq!(layer.id, layer_id);
    assert!(layer.coverage_cells > 3_000_000);
    assert!(
        layer
            .tilesets
            .iter()
            .any(|t| t.style == "elevation" && t.max_zoom >= t.min_zoom)
    );
    assert!(!layer.tilesets.is_empty(), "display pyramid registered");
    assert_tileset_has_visible_pixels(&engine, &layer.tilesets[0]);

    // 4. One persisted slope result via the analysis pipeline.
    let receipt = library
        .create_analysis(
            &layer_id,
            common_types::lidar::LidarAnalysisKind::Slope,
            common_types::lidar::LidarAnalysisParameters {
                slope_unit: Some(common_types::lidar::LidarSlopeUnit::Degrees),
            },
        )
        .expect("analysis created");
    // Run the enqueued job synchronously for the test.
    let job_state: String = {
        let connection = library.catalogue().unwrap();
        connection
            .query_row(
                "SELECT state FROM lidar_analysis_jobs WHERE id = ?1",
                [&receipt.job_id],
                |row| row.get(0),
            )
            .unwrap()
    };
    assert_eq!(job_state, "preparing");
    let parameters = analysis::parse_parameters(&{
        let connection = library.catalogue().unwrap();
        connection
            .query_row(
                "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                [&receipt.definition_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap()
    })
    .unwrap();
    let analysis_outcome = analysis::run_slope_job(
        &library,
        &receipt.job_id,
        &receipt.definition_id,
        &parameters,
        &{
            let connection = library.catalogue().unwrap();
            let source_generation: String = connection
                .query_row(
                    "SELECT source_generation_id FROM lidar_analysis_jobs WHERE id = ?1",
                    [&receipt.job_id],
                    |row| row.get(0),
                )
                .unwrap();
            source_generation
        },
        &cancel,
    )
    .expect("slope job runs");
    assert!(analysis_outcome.published, "slope result published");

    let snapshot = library.library_snapshot().expect("snapshot after analysis");
    assert_eq!(snapshot.analyses.len(), 1);
    let analysis = &snapshot.analyses[0];
    assert_eq!(analysis.state, common_types::lidar::LidarResultState::Ready);
    assert!(
        analysis.tilesets.iter().any(|t| t.style == "slope"),
        "slope tileset registered"
    );
    assert_tileset_has_visible_pixels(&engine, &analysis.tilesets[0]);
    println!("analysis ready: {:?}", analysis.value_range);

    // 5. Restart reuse: reopen the library; layers, results, tilesets and
    // immutable originals all survive without recomputation.
    drop(library);
    let reopened = LidarLibrary::open(&work).expect("library reopens");
    let snapshot = reopened.library_snapshot().expect("snapshot after restart");
    assert_eq!(snapshot.layers.len(), 1);
    assert_eq!(snapshot.analyses.len(), 1);
    assert_eq!(
        snapshot.analyses[0].state,
        common_types::lidar::LidarResultState::Ready
    );
    assert!(
        !snapshot.analyses[0].tilesets.is_empty(),
        "tilesets survive restart"
    );
    assert_tileset_has_visible_pixels(&engine, &snapshot.layers[0].tilesets[0]);
    assert_tileset_has_visible_pixels(&engine, &snapshot.analyses[0].tilesets[0]);
    let engine_status = reopened.engine_status();
    assert!(engine_status.available);
    assert_eq!(
        engine_status.version.as_deref(),
        Some(tools.version.as_str())
    );

    // Rename preserves identity and results.
    reopened
        .rename_layer(&layer_id, "IGN ground renamed")
        .expect("rename");
    let snapshot = reopened.library_snapshot().expect("snapshot after rename");
    assert_eq!(snapshot.layers[0].name, "IGN ground renamed");
    assert_eq!(snapshot.analyses[0].source_layer_id, layer_id);

    // Reimport the identical source as overlap-only replacement. The
    // decision preview must match those choices and use readable images.
    let replacement_job = reopened
        .record_import_job(&layer_id)
        .expect("replacement job");
    let replacement = import::stage_import(
        &reopened,
        &replacement_job,
        &layer_id,
        std::slice::from_ref(&fixture),
        &cancel,
    )
    .expect("replacement staging succeeds");
    assert_eq!(replacement.review.uncovered_cells, 0);
    assert!(replacement.review.overlap_cells > 3_000_000);
    reopened.finish_staging(
        &replacement_job,
        Ok(import::StagingOutput {
            review: replacement.review.clone(),
        }),
    );
    let staged_replacement: import::StagedImport = serde_json::from_str(
        &std::fs::read_to_string(
            reopened
                .inner
                .paths
                .job_dir(&replacement_job)
                .join("staging.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let decision = reopened
        .preview_import_decision(&replacement_job, false, true)
        .expect("overlap-only decision preview renders");
    assert!(!decision.add_uncovered);
    assert!(decision.replace_overlap);
    assert_png_has_visible_pixels(
        &engine,
        std::path::Path::new(decision.before_preview_path.as_deref().unwrap()),
    );
    assert_png_has_visible_pixels(&engine, std::path::Path::new(&decision.after_preview_path));
    reopened
        .prepare_apply(&replacement_job)
        .expect("replacement review accepted");
    let replacement_outcome =
        import::apply_import(&reopened, &staged_replacement, false, true, &cancel)
            .expect("same-file replacement publishes");
    assert!(replacement_outcome.changed);
    let replacement_head = {
        let connection = reopened.catalogue().unwrap();
        catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .unwrap()
    };
    let members = {
        let connection = reopened.catalogue().unwrap();
        catalogue::generation_members(&connection, &replacement_head.id).unwrap()
    };
    assert_eq!(members.len(), 2);
    assert_eq!(members[0].2.as_deref(), Some(job_id.as_str()));
    assert_eq!(members[1].2.as_deref(), Some(replacement_job.as_str()));

    // Undo removes the selected replacement occurrence and keeps the first
    // identical import, including its spatial footprint and visible tiles.
    let undo = import::undo_import(&reopened, &replacement_job, &cancel)
        .expect("replacement undo publishes");
    assert!(undo.changed);
    let after_undo = reopened.library_snapshot().expect("snapshot after undo");
    assert!(after_undo.layers[0].coverage_cells > 3_000_000);
    assert_tileset_has_visible_pixels(&engine, &after_undo.layers[0].tilesets[0]);
    let undo_head = {
        let connection = reopened.catalogue().unwrap();
        catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .unwrap()
    };
    let remaining = {
        let connection = reopened.catalogue().unwrap();
        catalogue::generation_members(&connection, &undo_head.id).unwrap()
    };
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].2.as_deref(), Some(job_id.as_str()));

    reopened
        .delete_layer(&layer_id)
        .expect("complete layer graph deletes");
    let deleted = reopened.library_snapshot().expect("snapshot after delete");
    assert!(deleted.layers.is_empty());
    assert!(deleted.analyses.is_empty());

    let _ = std::fs::remove_dir_all(&work);
}
