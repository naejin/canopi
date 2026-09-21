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
    // This lifecycle exercises the preserved dense route deliberately.
    let _dense = generation::chunked_publication::without_sparse();

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

/// Sparse-format vertical slice on the real IGN MNT fixture.
///
/// The same real workflow as the dense lifecycle above, but published through
/// the sparse resolved-chunk format: multi-chunk import, native display tiles
/// from the immutable lattice, slope over the chunked head with sparse result
/// and quality chunks, restart reuse, and undo. Run with:
/// `CANOPI_LIDAR_E2E_FIXTURE=<mnt> cargo test -p canopi-desktop --lib -- --ignored e2e_sparse --nocapture`
#[test]
#[ignore = "requires system GDAL and an IGN MNT fixture; see CANOPI_LIDAR_E2E_FIXTURE"]
fn e2e_sparse_generation_lifecycle() {
    let engine = engine::GdalEngine::new();
    engine.discover().expect("GDAL engine must be available");
    let fixture = match fixture_mnt() {
        Ok(path) => path,
        Err(reason) => panic!("{reason}"),
    };
    let work = std::env::temp_dir().join(format!("canopi-lidar-e2e-sparse-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).unwrap();
    let cancel = AtomicBool::new(false);

    // 1. Real import published as sparse resolved chunks.
    let library = LidarLibrary::open(&work).expect("library opens");
    let layer_id = library
        .create_layer(
            "IGN ground sparse",
            common_types::lidar::LidarMeasurementKind::GroundElevation,
        )
        .expect("layer created");
    let job_id = library.record_import_job(&layer_id).expect("job recorded");
    let output = import::stage_import(
        &library,
        &job_id,
        &layer_id,
        std::slice::from_ref(&fixture),
        &cancel,
    )
    .expect("staging succeeds");
    assert!(
        output.review.compatible,
        "fixture is compatible: {:?}",
        output.review.issues
    );
    let reviewed_cells = output.review.uncovered_cells;
    assert!(reviewed_cells > 3_000_000, "4M-cell tile: {reviewed_cells}");
    library.finish_staging(
        &job_id,
        Ok(import::StagingOutput {
            review: output.review.clone(),
        }),
    );
    let staging: import::StagedImport = serde_json::from_str(
        &std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
            .unwrap(),
    )
    .unwrap();
    library.prepare_apply(&job_id).expect("review accepted");
    let applied = import::apply_import(&library, &staging, true, false, &cancel).expect("apply");
    assert!(applied.changed);

    let head = {
        let connection = library.catalogue().unwrap();
        catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .expect("head published")
    };
    let manifest = import::read_generation_manifest(&head.manifest_json).unwrap();
    assert_eq!(
        manifest.format,
        import::GenerationStorageFormat::CogChunksV1,
        "the sparse route publishes resolved chunks"
    );
    assert!(head.mosaic_path.is_none(), "a sparse head owns no mosaic");
    assert!(head.coverage_cells > 3_000_000, "{}", head.coverage_cells);
    let chunks = {
        let connection = library.catalogue().unwrap();
        catalogue::generation_chunk_assets(&connection, &head.id, "result").unwrap()
    };
    // A 2000x2000 lattice is exactly four 1024-cell chunks.
    assert_eq!(chunks.len(), 4, "only occupied chunks are stored");
    println!(
        "sparse import: {} cells in {} chunks, value range {:?}..{:?}",
        head.coverage_cells,
        chunks.len(),
        head.min_value,
        head.max_value
    );

    // 2. The layer presents an on-demand tileset and renders real pixels.
    let snapshot = library.library_snapshot().expect("snapshot");
    let tileset = snapshot.layers[0]
        .tilesets
        .iter()
        .find(|tileset| tileset.style == "elevation")
        .expect("a sparse layer is displayable");
    let generation_id = match &tileset.source {
        common_types::lidar::LidarTileSource::NativeGeneration { generation_id } => {
            generation_id.clone()
        }
        _ => panic!("a sparse generation has no asset template"),
    };
    let mut tile_bytes = None;
    let mut tile_coordinates = None;
    'outer: for z in (0..=tileset.max_zoom).rev() {
        let span = 40_075_016.685_578_49 / f64::from(1u32 << z);
        let half = 20_037_508.342_789_244;
        let bounds = {
            let connection = library.catalogue().unwrap();
            let raw: String = connection
                .query_row(
                    "SELECT bounds_3857 FROM lidar_layer_generations WHERE id = ?1",
                    [&generation_id],
                    |row| row.get(0),
                )
                .unwrap();
            serde_json::from_str::<Vec<f64>>(&raw).unwrap()
        };
        let centre_x = (bounds[0] + bounds[2]) / 2.0;
        let centre_y = (bounds[1] + bounds[3]) / 2.0;
        let x = ((centre_x + half) / span).floor() as u32;
        let y = ((half - centre_y) / span).floor() as u32;
        let bytes = library
            .render_tile(
                "source",
                &layer_id,
                &generation_id,
                "elevation",
                z,
                x,
                y,
                &cancel,
            )
            .expect("tile renders");
        // An empty tile is the shared transparent 1x1 PNG; a drawn tile is a
        // full 256x256 image.
        let drawn = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .map(|image| image.width() == 256 && image.height() == 256)
            .unwrap_or(false);
        if drawn {
            tile_bytes = Some(bytes);
            tile_coordinates = Some((z, x, y));
            break 'outer;
        }
    }
    let (z, x, y) = tile_coordinates.expect("a rendered tile at some zoom");
    let bytes = tile_bytes.unwrap();
    println!("native tile {z}/{x}/{y}: {} bytes", bytes.len());
    assert!(bytes.len() > 100, "a drawn tile is a real PNG");

    // A second request is served from the bounded cache.
    let (hits_before, _) = library.tile_cache().unwrap().counters();
    let again = library
        .render_tile(
            "source",
            &layer_id,
            &generation_id,
            "elevation",
            z,
            x,
            y,
            &cancel,
        )
        .expect("tile renders again");
    let (hits_after, _) = library.tile_cache().unwrap().counters();
    assert_eq!(again, bytes, "the cached tile is the drawn tile");
    assert!(hits_after > hits_before, "the repeat is a cache hit");

    // 3. Slope over the chunked head publishes sparse result and quality.
    let receipt = library
        .create_analysis(
            &layer_id,
            common_types::lidar::LidarAnalysisKind::Slope,
            common_types::lidar::LidarAnalysisParameters {
                slope_unit: Some(common_types::lidar::LidarSlopeUnit::Degrees),
            },
        )
        .expect("analysis created");
    let (parameters, source_generation) = {
        let connection = library.catalogue().unwrap();
        let parameters: String = connection
            .query_row(
                "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                [&receipt.definition_id],
                |row| row.get(0),
            )
            .unwrap();
        let source_generation: String = connection
            .query_row(
                "SELECT source_generation_id FROM lidar_analysis_jobs WHERE id = ?1",
                [&receipt.job_id],
                |row| row.get(0),
            )
            .unwrap();
        (parameters, source_generation)
    };
    let outcome = analysis::run_slope_job(
        &library,
        &receipt.job_id,
        &receipt.definition_id,
        &analysis::parse_parameters(&parameters).unwrap(),
        &source_generation,
        &cancel,
    )
    .expect("slope job runs");
    assert!(
        outcome.published,
        "slope result published: {}",
        outcome.summary()
    );
    let analysis_head = {
        let connection = library.catalogue().unwrap();
        catalogue::head_analysis_generation(&connection, &receipt.definition_id)
            .unwrap()
            .expect("analysis head")
    };
    let analysis_manifest: analysis::ResultManifest =
        serde_json::from_str(&analysis_head.manifest_json).unwrap();
    assert_eq!(
        analysis_manifest.format,
        import::GenerationStorageFormat::CogChunksV1,
        "the bounded slope publishes sparse chunks"
    );
    let (result_chunks, quality_chunks) = {
        let connection = library.catalogue().unwrap();
        (
            catalogue::generation_chunk_assets(&connection, &analysis_head.id, "result").unwrap(),
            catalogue::generation_chunk_assets(&connection, &analysis_head.id, "quality").unwrap(),
        )
    };
    assert!(!result_chunks.is_empty(), "result chunks published");
    assert!(!quality_chunks.is_empty(), "quality chunks published");
    println!(
        "sparse slope: {} result chunks, {} quality chunks, range {:?}..{:?}",
        result_chunks.len(),
        quality_chunks.len(),
        analysis_head.min_value,
        analysis_head.max_value
    );
    let snapshot = library.library_snapshot().expect("snapshot after analysis");
    let analysis_tileset = snapshot.analyses[0]
        .tilesets
        .iter()
        .find(|tileset| tileset.style == "slope")
        .expect("a sparse result is displayable");
    assert!(matches!(
        analysis_tileset.source,
        common_types::lidar::LidarTileSource::NativeGeneration { .. }
    ));

    // 4. Restart reuse: the sparse head, its tiles and its result survive.
    drop(library);
    let reopened = LidarLibrary::open(&work).expect("library reopens");
    let snapshot = reopened.library_snapshot().expect("snapshot after restart");
    assert_eq!(
        snapshot.layers[0].coverage_cells,
        head.coverage_cells.max(0) as u64,
        "coverage survives restart"
    );
    assert!(matches!(
        snapshot.layers[0].tilesets[0].source,
        common_types::lidar::LidarTileSource::NativeGeneration { .. }
    ));
    let rendered = reopened
        .render_tile(
            "source",
            &layer_id,
            &generation_id,
            "elevation",
            z,
            x,
            y,
            &cancel,
        )
        .expect("tile renders after restart");
    assert_eq!(
        rendered, bytes,
        "the same immutable head renders the same tile"
    );

    // 5. Undo republishes from the remaining occurrences.
    let undone = import::undo_import(&reopened, &job_id, &cancel).expect("undo publishes");
    assert!(undone.changed, "{}", undone.summary());
    let after_undo = {
        let connection = reopened.catalogue().unwrap();
        catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .expect("head after undo")
    };
    assert_eq!(after_undo.id, undone.generation_id);
    assert_eq!(
        after_undo.coverage_cells, 0,
        "undoing the only import leaves no coverage"
    );
    // The replaced generation and its chunks stay as immutable history.
    let history_chunks = {
        let connection = reopened.catalogue().unwrap();
        catalogue::generation_chunk_assets(&connection, &head.id, "result").unwrap()
    };
    assert_eq!(history_chunks.len(), 4, "history keeps its chunks");

    drop(reopened);
    let _ = std::fs::remove_dir_all(&work);
}

/// The kernel's own resident-set high-water mark for this process.
///
/// `VmHWM` is the exact peak the kernel recorded, not a sampling estimate.
/// Short-lived child processes (GDAL) are not included, so their transient
/// peaks are reported separately by the run that spawns them.
fn process_peak_rss_bytes() -> u64 {
    fn value(status: &str, key: &str) -> Option<u64> {
        status
            .lines()
            .find(|line| line.starts_with(key))
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u64>().ok())
    }
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    value(&status, "VmHWM:")
        .map(|kilobytes| kilobytes * 1024)
        .unwrap_or(0)
}

/// The largest peak any currently live child of this process reports.
fn live_child_peak_rss_bytes() -> u64 {
    let children = std::fs::read_to_string(format!(
        "/proc/{}/task/{}/children",
        std::process::id(),
        std::process::id()
    ))
    .unwrap_or_default();
    children
        .split_whitespace()
        .filter_map(|pid| std::fs::read_to_string(format!("/proc/{pid}/status")).ok())
        .filter_map(|status| {
            status
                .lines()
                .find(|line| line.starts_with("VmHWM:"))
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|value| value.parse::<u64>().ok())
        })
        .map(|kilobytes| kilobytes * 1024)
        .max()
        .unwrap_or(0)
}

/// The 12 MNH tiles of one IGN batch, enumerated rather than assumed.
fn fixture_mnh_batch() -> Result<Vec<PathBuf>, String> {
    let directory = std::env::var_os("CANOPI_LIDAR_MNH_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs_home().join("Downloads").join("la magnerie"));
    let mut files: Vec<PathBuf> = std::fs::read_dir(&directory)
        .map_err(|error| format!("MNH batch directory is unavailable: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .map(|name| name.to_string_lossy().contains("_MNH_"))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();
    if files.is_empty() {
        return Err(format!(
            "no MNH tiles found under {}; set CANOPI_LIDAR_MNH_DIR",
            directory.display()
        ));
    }
    Ok(files)
}

/// The authorized 12-tile MNH batch: a 48M-cell union imported as one batch,
/// published sparsely, displayed on demand, and reopened. MNH is height above
/// ground, so it is deliberately never used as slope input here.
#[test]
#[ignore = "requires system GDAL, the 12-tile MNH batch and a host with headroom; see CANOPI_LIDAR_MNH_DIR"]
fn e2e_mnh_batch_import_apply_display_restart() {
    let engine = engine::GdalEngine::new();
    engine.discover().expect("GDAL engine must be available");
    let files = match fixture_mnh_batch() {
        Ok(files) => files,
        Err(reason) => panic!("{reason}"),
    };
    println!("MNH batch: {} tiles", files.len());
    for file in &files {
        let (digest, bytes) =
            super::raster_assets::hash_file(file).expect("tile hashes with bounded I/O");
        println!(
            "  {} {} bytes {}",
            file.file_name().unwrap_or_default().to_string_lossy(),
            bytes,
            digest
        );
    }
    let work = std::env::temp_dir().join(format!("canopi-lidar-e2e-mnh-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).unwrap();
    let cancel = AtomicBool::new(false);
    // No admission ceiling is raised: twelve files are inside the production
    // file count, and the 48M-cell union is handled block by block rather than
    // by its envelope's area.

    let library = LidarLibrary::open(&work).expect("library opens");
    let layer_id = library
        .create_layer(
            "MNH batch",
            common_types::lidar::LidarMeasurementKind::AboveGroundHeight,
        )
        .expect("layer created");
    let job_id = library.record_import_job(&layer_id).expect("job recorded");
    let staged = import::stage_import(&library, &job_id, &layer_id, &files, &cancel)
        .expect("staging succeeds");
    let review = &staged.review;
    assert!(
        review.compatible,
        "every tile must be admitted: {:?}",
        review.issues
    );
    let staged_cells = review.uncovered_cells;
    println!(
        "staged: uncovered={} overlap={} invalid={}",
        review.uncovered_cells, review.overlap_cells, review.invalid_cells
    );
    assert_eq!(
        staged_cells, 48_000_000,
        "twelve 2000x2000 tiles aligned into an 8000x6000 union"
    );
    library.finish_staging(
        &job_id,
        Ok(import::StagingOutput {
            review: review.clone(),
        }),
    );
    let staging: import::StagedImport = serde_json::from_str(
        &std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        (staging.union_grid.width, staging.union_grid.height),
        (8000, 6000)
    );
    library.prepare_apply(&job_id).expect("review accepted");
    let applied = import::apply_import(&library, &staging, true, false, &cancel).expect("apply");
    assert!(applied.changed);

    let head = {
        let connection = library.catalogue().unwrap();
        catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .expect("head published")
    };
    let manifest = import::read_generation_manifest(&head.manifest_json).unwrap();
    assert_eq!(
        manifest.format,
        import::GenerationStorageFormat::CogChunksV1,
        "the batch publishes sparse chunks"
    );
    assert_eq!(head.coverage_cells, 48_000_000);
    let chunks = {
        let connection = library.catalogue().unwrap();
        catalogue::generation_chunk_assets(&connection, &head.id, "result").unwrap()
    };
    // 8000x6000 over 1024-cell chunks: eight columns, six rows.
    assert_eq!(chunks.len(), 48, "one chunk per occupied 1024-cell block");
    println!(
        "applied: {} cells, {} chunks, range {:?}..{:?}",
        head.coverage_cells,
        chunks.len(),
        head.min_value,
        head.max_value
    );

    // Display: the layer presents native tiles and a tile over the data draws.
    let snapshot = library.library_snapshot().expect("snapshot");
    let tileset = snapshot.layers[0]
        .tilesets
        .iter()
        .find(|tileset| tileset.style == "elevation")
        .expect("a sparse layer is displayable");
    let generation_id = match &tileset.source {
        common_types::lidar::LidarTileSource::NativeGeneration { generation_id } => {
            generation_id.clone()
        }
        _ => panic!("a sparse generation has no asset template"),
    };
    let bounds: Vec<f64> = {
        let connection = library.catalogue().unwrap();
        let raw: String = connection
            .query_row(
                "SELECT bounds_3857 FROM lidar_layer_generations WHERE id = ?1",
                [&generation_id],
                |row| row.get(0),
            )
            .unwrap();
        serde_json::from_str(&raw).unwrap()
    };
    let centre_x = (bounds[0] + bounds[2]) / 2.0;
    let centre_y = (bounds[1] + bounds[3]) / 2.0;
    let mut drawn = 0usize;
    let mut drawn_bytes = 0usize;
    for z in (tileset.min_zoom..=tileset.max_zoom).rev().take(4) {
        let span = 40_075_016.685_578_49 / f64::from(1u32 << z);
        let half = 20_037_508.342_789_244;
        let x = ((centre_x + half) / span).floor() as u32;
        let y = ((half - centre_y) / span).floor() as u32;
        let bytes = library
            .render_tile(
                "source",
                &layer_id,
                &generation_id,
                "elevation",
                z,
                x,
                y,
                &cancel,
            )
            .expect("tile renders");
        let visible = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .map(|image| image.width() == 256 && image.height() == 256)
            .unwrap_or(false);
        println!(
            "tile {z}/{x}/{y}: {} bytes{}",
            bytes.len(),
            if visible { "" } else { " (empty)" }
        );
        if visible {
            drawn += 1;
            drawn_bytes += bytes.len();
        }
    }
    assert!(drawn > 0, "a tile over the batch centre must draw");
    println!("drawn tiles: {drawn} ({drawn_bytes} bytes)");

    // Restart reuse: the head, its chunks and its tiles survive.
    drop(library);
    let reopened = LidarLibrary::open(&work).expect("library reopens");
    let snapshot = reopened.library_snapshot().expect("snapshot after restart");
    assert_eq!(snapshot.layers[0].coverage_cells, 48_000_000);
    assert!(matches!(
        snapshot.layers[0].tilesets[0].source,
        common_types::lidar::LidarTileSource::NativeGeneration { .. }
    ));
    println!("restart: {} cells", snapshot.layers[0].coverage_cells);

    // The kernel's own high-water marks: exact for this process, plus the
    // largest peak any still-live child reports.
    let peak = process_peak_rss_bytes().max(live_child_peak_rss_bytes());
    println!(
        "peak resident set (VmHWM, this process plus live children): {} MiB",
        peak / (1024 * 1024)
    );
    assert!(
        peak <= 1024 * 1024 * 1024,
        "the batch must stay inside the 1 GiB combined working-memory budget: {} MiB",
        peak / (1024 * 1024)
    );

    drop(reopened);
    let _ = std::fs::remove_dir_all(&work);
}
