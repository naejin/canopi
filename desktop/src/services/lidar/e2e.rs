//! End-to-end vertical-slice validation against the real IGN 0446_6807 MNT
//! fixture and the system GDAL engine.
//!
//! Ignored by default: it requires the GDAL command-line tools and the
//! fixture under `~/Downloads`. Run on a development OS with:
//! `cargo test -p canopi-desktop lidar::e2e -- --ignored --nocapture`

use super::*;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

fn fixture_mnt() -> Option<PathBuf> {
    let downloads = dirs_home().join("Downloads");
    let dir = downloads.join("LHD_FXX_0446_6807_MNT_O_0M50_LAMB93_IGN69");
    let file = dir.join("LHD_FXX_0446_6807_MNT_O_0M50_LAMB93_IGN69");
    file.exists().then_some(file)
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

#[test]
#[ignore = "requires system GDAL and the IGN 0446_6807 MNT fixture"]
fn e2e_import_publish_slope_restart_reuse() {
    let engine = engine::GdalEngine::new();
    let tools = engine.discover().expect("GDAL engine must be available");

    let Some(fixture) = fixture_mnt() else {
        panic!("IGN MNT fixture is missing from ~/Downloads");
    };
    let work = std::env::temp_dir().join(format!("canopi-lidar-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).unwrap();

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
    let cancel = AtomicBool::new(false);
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

    let _ = std::fs::remove_dir_all(&work);
}
