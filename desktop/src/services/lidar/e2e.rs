//! End-to-end vertical-slice validation against the real IGN 0446_6807 MNT
//! fixture and the system GDAL engine.
//!
//! Ignored by default: it requires the GDAL command-line tools and the
//! fixture under `~/Downloads`. Run on a development OS with:
//! `cargo test -p canopi-desktop lidar::e2e -- --ignored --nocapture`

use super::*;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

/// Total bytes under a directory tree, and how many files they are.
///
/// The resource contract separates **durable** bytes, which a published
/// generation owns and a restart must keep, from **temporary** bytes, which a
/// completed job must not leave behind. Both are measured by walking the tree
/// rather than trusting a job's own accounting.
fn tree_bytes(root: &std::path::Path) -> (u64, u64) {
    let mut total = 0u64;
    let mut files = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => stack.push(path),
                Ok(_) => {
                    if let Ok(meta) = entry.metadata() {
                        total = total.saturating_add(meta.len());
                        files = files.saturating_add(1);
                    }
                }
                Err(_) => {}
            }
        }
    }
    (total, files)
}

/// Report the durable and temporary footprint of a library root.
///
/// Staging and job scratch are the only places a completed job may leave
/// nothing, so the temporary figure is what proves the cleanup, while the
/// durable figure is what a restart must reproduce.
fn report_library_bytes(label: &str, root: &std::path::Path) -> (u64, u64, u64, u64) {
    let (durable, durable_files) = tree_bytes(root);
    // `jobs` holds per-job scratch, which a settled job must empty. The other
    // roots are durable: `sources` and `prepared` are retained inputs.
    let (temporary, temporary_files) = tree_bytes(&root.join("jobs"));
    let job_dirs: Vec<String> = std::fs::read_dir(root.join("jobs"))
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| {
                    let (bytes, files) = tree_bytes(&entry.path());
                    format!("{}({bytes}B/{files}f)", entry.file_name().to_string_lossy())
                })
                .collect()
        })
        .unwrap_or_default();
    println!(
        "{label}: durable {durable} bytes in {durable_files} files, \
         temporary {temporary} bytes in {temporary_files} files, \
         job scratch [{}]",
        job_dirs.join(", ")
    );
    (durable, durable_files, temporary, temporary_files)
}

/// The display route draws one entity: its derivatives prepare for the
/// current generation and together hold valid values. Returns that generation.
fn assert_displays(
    library: &LidarLibrary,
    kind: common_types::lidar::LidarSampleEntityKind,
    entity_id: &str,
) -> String {
    library
        .prepare_display_now(kind, entity_id)
        .expect("display derivatives prepare");
    let descriptor = library
        .display_descriptor(&common_types::lidar::LidarDisplayRequest {
            kind,
            entity_id: entity_id.to_string(),
            expected_generation_id: None,
            retry: false,
        })
        .expect("descriptor reads");
    assert_eq!(
        descriptor.state,
        common_types::lidar::LidarDisplayState::Ready,
        "{:?}",
        descriptor.message
    );
    assert!(
        !descriptor.assets.is_empty(),
        "a displayed entity has assets"
    );
    let valid = descriptor.assets.iter().any(|asset| {
        let output = library
            .inner
            .engine
            .run(
                engine::GdalProgram::Info,
                &[
                    "-json".to_string(),
                    "-stats".to_string(),
                    "--config".to_string(),
                    "GDAL_PAM_ENABLED".to_string(),
                    "NO".to_string(),
                    asset.path.clone(),
                ],
                None,
            )
            .expect("derivative opens through GDAL");
        let info: serde_json::Value = serde_json::from_str(&output.stdout).expect("info is JSON");
        info["bands"][0]["metadata"][""]["STATISTICS_VALID_PERCENT"]
            .as_str()
            .and_then(|value| value.parse::<f64>().ok())
            .is_some_and(|percent| percent > 0.0)
    });
    assert!(
        valid,
        "the display derivatives of {entity_id} hold no valid values"
    );
    descriptor
        .generation_id
        .expect("a ready descriptor names its generation")
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

/// The full dense lifecycle on the real IGN MNT fixture: import, publish,
/// display, slope, restart reuse and a same-file replacement, followed by the
/// shipped ordered route over that grandfathered dense head and its undo. Run
/// with:
/// `CANOPI_LIDAR_E2E_FIXTURE=<mnt> cargo test -p canopi-desktop --lib -- --ignored e2e_import_publish --nocapture`
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
    let dense_guard = generation::chunked_publication::without_sparse();

    // Open the library (slice 1: catalogue + assets under app data root).
    let library = LidarLibrary::open(&work).expect("library opens");

    // 1. Create one named ground layer.
    let layer_id = library
        .create_layer(
            "IGN ground POC",
            common_types::lidar::LidarMeasurementKind::GroundElevation,
            None,
            false,
        )
        .expect("layer created");

    // 2. Prepare the real TIFF: probe, valid mask, controlled COG, source facts.
    //    Preparation is the validation step now, so an unusable fixture fails
    //    here rather than at a review.
    let job_id = library.record_import_job(&layer_id).expect("job recorded");
    let staging = {
        import::stage_import(
            &library,
            &job_id,
            &layer_id,
            std::slice::from_ref(&fixture),
            &cancel,
        )
        .expect("the fixture is admitted");
        import::read_staged_import(&library, &job_id).expect("staged payload")
    };
    println!(
        "staged: {} source(s), {} valid cells",
        staging.sources.len(),
        staging.sources[0].valid_cells.unwrap_or(0)
    );

    // 3. Publish it: one generation plus display tiles.
    let outcome =
        import::apply_import(&library, &staging, true, false, &cancel).expect("apply publishes");
    library.finish_import_sources(&job_id, &layer_id, Ok(()));
    assert!(outcome.changed);
    let completed_job = library
        .get_import_job(&job_id)
        .unwrap()
        .expect("completed import job remains queryable");
    assert_eq!(
        completed_job.state,
        common_types::lidar::LidarImportJobState::Complete
    );
    // A settled job reports its outcome through its state; the phase it passed
    // through while publishing is cleared so a reader cannot mistake a stale
    // percentage for work still running.
    assert_eq!(completed_job.progress, None);
    println!("published: {}", outcome.summary());

    // Snapshot shows the layer with its display derivatives.
    let snapshot = library.library_snapshot().expect("snapshot");
    assert_eq!(snapshot.layers.len(), 1);
    let layer = &snapshot.layers[0];
    assert_eq!(layer.id, layer_id);
    assert!(
        layer
            .coverage_cells
            .expect("this fixture measured its coverage")
            > 3_000_000
    );
    assert_displays(
        &library,
        common_types::lidar::LidarSampleEntityKind::Source,
        &layer_id,
    );

    // 4. One persisted slope result via the analysis pipeline.
    let receipt = library
        .create_horn_analysis(
            &layer_id,
            common_types::lidar::LidarAnalysisKind::Slope,
            common_types::lidar::LidarAnalysisParameters {
                slope_unit: Some(common_types::lidar::LidarSlopeUnit::Degrees),
                name: None,
            },
            None,
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
    assert_displays(
        &library,
        common_types::lidar::LidarSampleEntityKind::Analysis,
        &analysis.id,
    );
    println!("analysis ready: {:?}", analysis.value_range);

    // 5. Restart reuse: reopen the library; layers, results, displays and
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
    assert_displays(
        &reopened,
        common_types::lidar::LidarSampleEntityKind::Source,
        &snapshot.layers[0].id,
    );
    assert_displays(
        &reopened,
        common_types::lidar::LidarSampleEntityKind::Analysis,
        &snapshot.analyses[0].id,
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

    // Reimport the identical source as a replacement of the same bytes. There
    // is no decision preview to render: preparation validates the batch and
    // publication replaces the head.
    let replacement_job = reopened
        .record_import_job(&layer_id)
        .expect("replacement job");
    let staged_replacement = {
        import::stage_import(
            &reopened,
            &replacement_job,
            &layer_id,
            std::slice::from_ref(&fixture),
            &cancel,
        )
        .expect("the replacement is admitted");
        import::read_staged_import(&reopened, &replacement_job).expect("staged payload")
    };
    let replacement_outcome =
        import::apply_import(&reopened, &staged_replacement, false, true, &cancel)
            .expect("same-file replacement publishes");
    reopened.finish_import_sources(&replacement_job, &layer_id, Ok(()));
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

    // A dense publication composes straight from its own mosaic and records no
    // snapshot lineage, so a dense head offers no composition Undo. That is the
    // pre-rework behaviour of this preserved route and the reason production
    // never publishes densely: the ordered publication below is what an
    // accepted import actually runs. The request is answered, not failed, and
    // the head it names stays authoritative.
    let dense_undo = import::undo_import(&reopened, &replacement_job, &cancel)
        .expect("an undo request against a dense head is answered");
    assert!(!dense_undo.changed, "{}", dense_undo.summary());
    assert_eq!(dense_undo.generation_id, replacement_head.id);
    let after_dense_undo = reopened
        .library_snapshot()
        .expect("snapshot after the refused undo");
    assert!(
        after_dense_undo.layers[0]
            .coverage_cells
            .expect("this fixture measured its coverage")
            > 3_000_000
    );
    assert_displays(
        &reopened,
        common_types::lidar::LidarSampleEntityKind::Source,
        &layer_id,
    );
    let (unchanged_head, unchanged_members) = {
        let connection = reopened.catalogue().unwrap();
        (
            catalogue::head_generation(&connection, &layer_id)
                .unwrap()
                .expect("the head survives a refused undo"),
            catalogue::generation_members(&connection, &replacement_head.id).unwrap(),
        )
    };
    assert_eq!(unchanged_head.id, replacement_head.id);
    assert_eq!(unchanged_members.len(), 2, "a refused undo removes nothing");

    // Re-enable the shipped publication route: an accepted import over the
    // grandfathered dense head wraps that head as one historical member, which
    // is what makes the composition undoable again.
    drop(dense_guard);
    let ordered_job = reopened
        .record_import_job(&layer_id)
        .expect("ordered job recorded");
    let ordered = import::stage_and_publish(
        &reopened,
        &ordered_job,
        &layer_id,
        std::slice::from_ref(&fixture),
        true,
        &cancel,
    )
    .expect("the ordered publication is admitted");
    reopened.finish_import_sources(&ordered_job, &layer_id, Ok(()));
    assert!(ordered.changed, "{}", ordered.summary());
    let ordered_head = {
        let connection = reopened.catalogue().unwrap();
        catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .expect("ordered head published")
    };
    assert_eq!(
        import::read_generation_manifest(&ordered_head.manifest_json)
            .unwrap()
            .format,
        import::GenerationStorageFormat::OrderedMembersV1
    );
    let ordered_members = {
        let connection = reopened.catalogue().unwrap();
        catalogue::collection_members_page(&connection, &ordered_head.id, None, 10).unwrap()
    };
    assert_eq!(ordered_members.len(), 2);
    assert_eq!(ordered_members[0].kind, "source");
    assert_eq!(
        ordered_members[0].job_id.as_deref(),
        Some(ordered_job.as_str())
    );
    assert_eq!(ordered_members[1].kind, "previous-composition");
    assert_eq!(
        ordered_members[1].base_generation_id.as_deref(),
        Some(replacement_head.id.as_str())
    );

    // Undo removes the accepted occurrence and republishes the wrapped dense
    // composition, whose measurement is the dense head's own.
    let undo = import::undo_import(&reopened, &ordered_job, &cancel).expect("undo publishes");
    assert!(undo.changed, "{}", undo.summary());
    let after_undo = reopened.library_snapshot().expect("snapshot after undo");
    assert_eq!(
        after_undo.layers[0].coverage_cells,
        replacement_head
            .coverage_cells
            .map(|cells| cells.max(0) as u64),
        "undo restores the dense composition's own coverage"
    );
    let displayed_generation = assert_displays(
        &reopened,
        common_types::lidar::LidarSampleEntityKind::Source,
        &layer_id,
    );
    assert_eq!(
        displayed_generation, undo.generation_id,
        "the restored head is what the map reads"
    );
    let undo_head = {
        let connection = reopened.catalogue().unwrap();
        catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .unwrap()
    };
    assert_eq!(undo_head.id, undo.generation_id);
    let (remaining, ordered_history) = {
        let connection = reopened.catalogue().unwrap();
        (
            catalogue::collection_members_page(&connection, &undo_head.id, None, 10).unwrap(),
            catalogue::collection_member_count(&connection, &ordered_head.id).unwrap(),
        )
    };
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].kind, "previous-composition");
    assert_eq!(
        remaining[0].base_generation_id.as_deref(),
        Some(replacement_head.id.as_str())
    );
    assert_eq!(ordered_history, 2, "the undone snapshot stays in history");

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

    // Sample the combined working set from an idle baseline for the whole run.
    let sampler = super::measurement::Sampler::start();
    // 1. Real import published as sparse resolved chunks.
    let library = LidarLibrary::open(&work).expect("library opens");
    let layer_id = library
        .create_layer(
            "IGN ground sparse",
            common_types::lidar::LidarMeasurementKind::GroundElevation,
            None,
            false,
        )
        .expect("layer created");
    let job_id = library.record_import_job(&layer_id).expect("job recorded");
    let staging = {
        import::stage_import(
            &library,
            &job_id,
            &layer_id,
            std::slice::from_ref(&fixture),
            &cancel,
        )
        .expect("the fixture is admitted");
        import::read_staged_import(&library, &job_id).expect("staged payload")
    };
    let staged_cells = staging.sources[0].valid_cells.unwrap_or(0);
    assert!(staged_cells > 3_000_000, "4M-cell tile: {staged_cells}");
    let applied = import::apply_import(&library, &staging, true, false, &cancel).expect("apply");
    library.finish_import_sources(&job_id, &layer_id, Ok(()));
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
        import::GenerationStorageFormat::OrderedMembersV1,
        "a source import publishes an ordered collection of source occurrences"
    );
    assert!(head.mosaic_path.is_none(), "an ordered head owns no mosaic");
    // A one-occurrence composition carries its member's exact facts without
    // reading the composed pixels.
    assert!(
        head.coverage_cells
            .expect("a one-member composition carries its member's exact count")
            > 3_000_000
    );
    let chunks = {
        let connection = library.catalogue().unwrap();
        catalogue::generation_chunk_assets(&connection, &head.id, "result").unwrap()
    };
    assert!(
        chunks.is_empty(),
        "an ordered composition materializes no resolved chunks"
    );
    println!(
        "sparse import: {} cells in {} chunks, value range {:?}..{:?}",
        head.coverage_cells
            .expect("this fixture measured its coverage"),
        chunks.len(),
        head.min_value,
        head.max_value
    );

    // 2. The layer's display derivatives prepare and hold its values.
    let generation_id = assert_displays(
        &library,
        common_types::lidar::LidarSampleEntityKind::Source,
        &layer_id,
    );

    // 3. Slope over the chunked head publishes sparse result and quality.
    let receipt = library
        .create_horn_analysis(
            &layer_id,
            common_types::lidar::LidarAnalysisKind::Slope,
            common_types::lidar::LidarAnalysisParameters {
                slope_unit: Some(common_types::lidar::LidarSlopeUnit::Degrees),
                name: None,
            },
            None,
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
    assert_displays(
        &library,
        common_types::lidar::LidarSampleEntityKind::Analysis,
        &snapshot.analyses[0].id,
    );

    // 4. Restart reuse: the sparse head, its display and its result survive.
    drop(library);
    let reopened = LidarLibrary::open(&work).expect("library reopens");
    let snapshot = reopened.library_snapshot().expect("snapshot after restart");
    assert_eq!(
        snapshot.layers[0].coverage_cells,
        Some(head.coverage_cells.unwrap_or(0).max(0) as u64),
        "coverage survives restart"
    );
    assert_eq!(
        assert_displays(
            &reopened,
            common_types::lidar::LidarSampleEntityKind::Source,
            &layer_id
        ),
        generation_id,
        "the same immutable head is displayed after restart"
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
        after_undo.coverage_cells,
        Some(0),
        "undoing the only import leaves no coverage"
    );
    // The replaced generation stays as immutable history: its ordered
    // occurrence, the retained source payload that occurrence resolves and its
    // measured facts all survive, and an ordered composition publishes no
    // resolved chunks because its members stay authoritative.
    let (history_row, history_members, history_chunks) = {
        let connection = reopened.catalogue().unwrap();
        (
            catalogue::generation_row(&connection, &head.id)
                .unwrap()
                .expect("the replaced generation stays in history"),
            catalogue::collection_member_count(&connection, &head.id).unwrap(),
            catalogue::generation_chunk_assets(&connection, &head.id, "result").unwrap(),
        )
    };
    assert_eq!(history_row.coverage_cells, head.coverage_cells);
    assert_eq!(
        import::read_generation_manifest(&history_row.manifest_json)
            .unwrap()
            .format,
        import::GenerationStorageFormat::OrderedMembersV1,
        "the replaced generation keeps the format it was published with"
    );
    assert_eq!(history_members, 1, "history keeps its ordered occurrence");
    assert!(
        history_chunks.is_empty(),
        "an ordered composition materializes no resolved chunks"
    );
    let retained = {
        let connection = reopened.catalogue().unwrap();
        generation::retained_cog(
            &connection,
            &reopened.inner.paths,
            &format!("interp-{}", staging.sources[0].interp_hash),
        )
        .unwrap()
    };
    assert!(
        retained.is_some(),
        "the occurrence's retained source payload survives the undo"
    );

    drop(reopened);
    let measurement = sampler.finish();
    let _ = super::measurement::gate_combined_budget("sparse MNT lifecycle", &measurement);
    let _ = std::fs::remove_dir_all(&work);
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
        let (digest, bytes) = super::raster_assets::hash_file(file, &AtomicBool::new(false))
            .expect("tile hashes with bounded I/O");
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
    // Twelve files and 48,000,000 processing cells are both inside the
    // production policy, so this authorized run needs no admission override:
    // it witnesses the real limits a user gets.
    assert_eq!(
        admission::limits(),
        admission::AdmissionLimits::production()
    );

    // The combined-memory sample starts from an idle baseline before any raster
    // work and keeps sampling until the workload settles.
    let sampler = super::measurement::Sampler::start();
    let library = LidarLibrary::open(&work).expect("library opens");
    let layer_id = library
        .create_layer(
            "MNH batch",
            common_types::lidar::LidarMeasurementKind::AboveGroundHeight,
            None,
            false,
        )
        .expect("layer created");
    let job_id = library.record_import_job(&layer_id).expect("job recorded");
    let staging = {
        import::stage_import(&library, &job_id, &layer_id, &files, &cancel)
            .expect("every tile is admitted");
        import::read_staged_import(&library, &job_id).expect("staged payload")
    };
    let staged_cells: u64 = staging
        .sources
        .iter()
        .map(|source| source.valid_cells.unwrap_or(0))
        .sum();
    println!(
        "staged: {staged_cells} valid cells across {} tiles",
        staging.sources.len()
    );
    assert_eq!(
        staged_cells, 48_000_000,
        "twelve 2000x2000 tiles aligned into an 8000x6000 union"
    );
    assert_eq!(
        (staging.union_grid.width, staging.union_grid.height),
        (8000, 6000)
    );
    let applied = import::apply_import(&library, &staging, true, false, &cancel).expect("apply");
    library.finish_import_sources(&job_id, &layer_id, Ok(()));
    assert!(applied.changed);

    let head = {
        let connection = library.catalogue().unwrap();
        catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .expect("head published")
    };
    let manifest = import::read_generation_manifest(&head.manifest_json).unwrap();
    // The ordered route publishes the accepted sources as one ordered
    // collection; it never materializes a resolved composition raster, so the
    // batch costs source COGs plus member metadata rather than 48M composed
    // cells.
    assert_eq!(
        manifest.format,
        import::GenerationStorageFormat::OrderedMembersV1,
        "the batch publishes as an ordered collection of source occurrences"
    );
    // Twelve occurrences cannot be composed from metadata alone, so the
    // generation claims no exact count; the batch's own member facts are the
    // diagnostic, and its display range is a labelled source envelope.
    assert_eq!(head.coverage_cells, None);
    assert_eq!(head.display_basis.as_deref(), Some("source-envelope"));
    let members = {
        let connection = library.catalogue().unwrap();
        catalogue::collection_members(&connection, &head.id).unwrap()
    };
    assert_eq!(
        members.len(),
        files.len(),
        "every selected tile is its own occurrence"
    );
    assert!(
        members.iter().all(|member| member.kind == "source"),
        "a first batch is all source occurrences: {members:?}"
    );
    // The composition itself stores no resolved result chunks: the occurrences
    // are read from their own source COGs on demand.
    let resolved_chunks = {
        let connection = library.catalogue().unwrap();
        catalogue::generation_chunk_assets(&connection, &head.id, "result").unwrap()
    };
    assert!(
        resolved_chunks.is_empty(),
        "an ordered composition materializes nothing: {} resolved chunks",
        resolved_chunks.len()
    );
    // Every source occurrence retains its own standard COG, which is what makes
    // the batch readable without a composed raster.
    let source_cogs = {
        let connection = library.catalogue().unwrap();
        members
            .iter()
            .filter(|member| {
                member.interpretation_id.as_deref().is_some_and(|id| {
                    catalogue::interpretation_cog(&connection, id)
                        .ok()
                        .flatten()
                        .is_some()
                })
            })
            .count()
    };
    assert_eq!(
        source_cogs,
        files.len(),
        "every occurrence keeps a retained source COG"
    );
    println!(
        "applied: {members_len} source occurrences, {source_cogs} retained source COGs, \
         exact range {exact:?}, display range {display:?}..{display_max:?}",
        members_len = members.len(),
        exact = head.min_value.zip(head.max_value),
        display = head.display_min_value,
        display_max = head.display_max_value,
    );

    // Display: the layer's derivatives prepare and hold its values.
    let prepared = std::time::Instant::now();
    assert_displays(
        &library,
        common_types::lidar::LidarSampleEntityKind::Source,
        &layer_id,
    );
    println!(
        "display derivatives prepared in {:.0} ms",
        prepared.elapsed().as_secs_f64() * 1000.0
    );

    // The resource contract separates durable bytes, which a restart must
    // reproduce, from temporary bytes, which a settled job must not leave behind.
    let (durable, _durable_files, temporary, temporary_files) =
        report_library_bytes("MNH batch after import and analysis", &work);
    assert_eq!(
        temporary, 0,
        "a settled job left {temporary} temporary bytes in {temporary_files} files"
    );
    assert!(
        durable > 0,
        "a settled job must have published durable bytes"
    );

    // Restart reuse: the head, its chunks and its tiles survive.
    drop(library);
    let reopened = LidarLibrary::open(&work).expect("library reopens");
    let snapshot = reopened.library_snapshot().expect("snapshot after restart");
    // The reopened layer reports the same composition and, honestly, the same
    // unknown exact coverage: a restart must not invent a count it never took.
    assert_eq!(snapshot.layers[0].coverage_cells, None);
    assert_eq!(
        snapshot.layers[0]
            .display_range
            .map(|range| range.basis)
            .map(|basis| format!("{basis:?}"))
            .as_deref(),
        Some("SourceEnvelope")
    );
    println!(
        "restart: coverage {:?}, display range {:?}",
        snapshot.layers[0].coverage_cells,
        snapshot.layers[0]
            .display_range
            .map(|range| (range.min, range.max))
    );

    // The combined working set is a sampled process-tree total: the root plus
    // every observed live descendant, summed per tick. Resident sets are
    // summed, so shared pages are double-counted (conservative), and sampling
    // can miss peaks shorter than the interval (a lower bound, never an upper
    // one). The run report states the baseline and incomplete ticks.
    let measurement = sampler.finish();
    let _ = super::measurement::gate_combined_budget("MNH batch", &measurement);

    drop(reopened);
    let _ = std::fs::remove_dir_all(&work);
}

/// The representative 400,000,000-cell analytical plane, when it is present.
///
/// `CANOPI_LIDAR_CAPACITY_PLANE` names the file to use. The plane is synthetic
/// (see `scripts/generate_capacity_plane.py`), so this test never treats it as
/// a survey and never resamples a private raster to stand in for one.
fn fixture_capacity_plane() -> Result<PathBuf, String> {
    let path = std::env::var_os("CANOPI_LIDAR_CAPACITY_PLANE")
        .map(PathBuf::from)
        .ok_or_else(|| {
            "CANOPI_LIDAR_CAPACITY_PLANE is not set; generate the plane with \
             scripts/generate_capacity_plane.py --out <path>"
                .to_string()
        })?;
    if !path.is_file() {
        return Err(format!("capacity plane is missing: {}", path.display()));
    }
    Ok(path)
}

/// The plane's analytic ground truth at a pixel centre, in metres.
///
/// `z = 0.25x + 0.5y - 100`, with x/y the pixel-centre coordinates derived from
/// the known geotransform `(700000, 0.5, 0, 6600000, 0, -0.5)`.
fn plane_expected(pixel_x: f64, pixel_y: f64) -> f64 {
    let x = 700_000.0 + (pixel_x + 0.5) * 0.5;
    let y = 6_600_000.0 - (pixel_y + 0.5) * 0.5;
    0.25 * x + 0.5 * y - 100.0
}

/// The bounded read footprint of one lattice window.
fn bounds_of(window: generation::LatticeWindow) -> collection::ReadBounds {
    collection::ReadBounds {
        x0: window.x,
        y0: window.y,
        x1: window.x + i64::from(window.width),
        y1: window.y + i64::from(window.height),
    }
}

/// The four declared NoData holes as `(y0, y1, x0, x1)`, half-open.
const PLANE_HOLES: [(i64, i64, i64, i64); 4] = [
    (5_100, 6_900, 590, 1_090),
    (9_500, 10_400, 480, 1_560),
    (15_300, 16_500, 17_890, 18_610),
    (2_170, 2_430, 1_505, 2_600),
];

/// The authorized capacity input: one 20,000x20,000 Float32 file above 1 GiB,
/// imported, reopened, displayed and read back through the production callers
/// with no admission override, bounded numerics at block seams and exact
/// NoData across its block-crossing holes.
#[test]
#[ignore = "requires system GDAL, the synthetic 400M-cell plane and disk/headroom; see CANOPI_LIDAR_CAPACITY_PLANE"]
fn e2e_capacity_plane_import_display_and_bounded_reads() {
    let engine = engine::GdalEngine::new();
    engine.discover().expect("GDAL engine must be available");
    let plane = match fixture_capacity_plane() {
        Ok(path) => path,
        Err(reason) => panic!("{reason}"),
    };
    let bytes = std::fs::metadata(&plane).expect("plane stat").len();
    println!("capacity plane: {} bytes", bytes);
    assert!(
        bytes > 1024 * 1024 * 1024,
        "the representative input must exceed 1 GiB, got {bytes}"
    );

    let work = std::env::temp_dir().join(format!("canopi-lidar-capacity-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).unwrap();
    let cancel = AtomicBool::new(false);
    // One file and 400,000,000 processing cells are both inside the production
    // policy, so this is the real admission a user gets.
    assert_eq!(
        admission::limits(),
        admission::AdmissionLimits::production()
    );

    let sampler = super::measurement::Sampler::start();
    let library = LidarLibrary::open(&work).expect("library opens");
    let layer_id = library
        .create_layer(
            "capacity plane",
            common_types::lidar::LidarMeasurementKind::GroundElevation,
            None,
            false,
        )
        .expect("layer created");
    let job_id = library.record_import_job(&layer_id).expect("job recorded");
    let staging = {
        import::stage_import(&library, &job_id, &layer_id, &[plane], &cancel)
            .expect("the plane is admitted");
        import::read_staged_import(&library, &job_id).expect("staged payload")
    };
    assert_eq!(
        (staging.union_grid.width, staging.union_grid.height),
        (20_000, 20_000),
        "the plane is its own 400M-cell union"
    );
    assert_eq!(
        staging.processing_cells, 400_000_000,
        "the batch is admitted for exactly the plane's own grid"
    );
    let applied = import::apply_import(&library, &staging, true, false, &cancel).expect("apply");
    library.finish_import_sources(&job_id, &layer_id, Ok(()));
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
        import::GenerationStorageFormat::OrderedMembersV1
    );
    // A single-source batch carries its member's exact facts, so the published
    // coverage is the source's own valid-cell count.
    let published_cells =
        head.coverage_cells
            .expect("a one-member composition carries its member's exact count") as u64;
    println!(
        "applied: {published_cells} valid cells, range {:?}..{:?}",
        head.min_value, head.max_value
    );
    // The plane is 400,000,000 cells and its four declared holes are exactly
    // 3,020,700 of them, so coverage is the grid minus the holes. Checking both
    // numbers is what proves the holes were excluded rather than counted.
    let hole_cells: u64 = PLANE_HOLES
        .iter()
        .map(|(y0, y1, x0, x1)| ((y1 - y0) * (x1 - x0)) as u64)
        .sum();
    assert_eq!(hole_cells, 3_020_700, "the declared holes' own area");
    assert_eq!(
        published_cells + hole_cells,
        400_000_000,
        "valid coverage plus the declared holes is the whole grid"
    );
    // The composed range is the plane's own analytic range: `z` rises with x and
    // falls with y, so the lowest sample is at the far south-west corner and the
    // highest at the south-east corner.
    let expected_min = plane_expected(0.0, 19_999.0);
    let expected_max = plane_expected(19_999.0, 0.0);
    let observed_min = head.min_value.expect("a composed range exists") as f64;
    let observed_max = head.max_value.expect("a composed range exists") as f64;
    assert!(
        (observed_min - expected_min).abs() < 1.0,
        "composed min {observed_min} vs analytic {expected_min}"
    );
    assert!(
        (observed_max - expected_max).abs() < 1.0,
        "composed max {observed_max} vs analytic {expected_max}"
    );

    // The resource contract separates durable bytes, which a restart must
    // reproduce, from temporary bytes, which a settled job must not leave behind.
    let (durable, _durable_files, temporary, temporary_files) =
        report_library_bytes("capacity plane after import and analysis", &work);
    assert_eq!(
        temporary, 0,
        "a settled job left {temporary} temporary bytes in {temporary_files} files"
    );
    assert!(
        durable > 0,
        "a settled job must have published durable bytes"
    );

    // Reopen: a fresh library handle sees the same head without recomputation.
    drop(library);
    let reopened = LidarLibrary::open(&work).expect("library reopens");
    let snapshot = reopened.library_snapshot().expect("snapshot after restart");
    assert_eq!(
        snapshot.layers[0].coverage_cells,
        Some(
            head.coverage_cells
                .expect("this fixture measured its coverage") as u64
        )
    );
    println!(
        "restart: {} cells",
        snapshot.layers[0].coverage_cells.unwrap_or(0)
    );

    let result_layer_id = snapshot.layers[0].id.clone();
    // Display: the plane's derivatives prepare and hold its values.
    let prepared = std::time::Instant::now();
    let generation_id = assert_displays(
        &reopened,
        common_types::lidar::LidarSampleEntityKind::Source,
        &result_layer_id,
    );
    println!(
        "display derivatives prepared in {:.0} ms",
        prepared.elapsed().as_secs_f64() * 1000.0
    );

    // Bounded numeric reads through the same resolver display and analysis use.
    //
    // The window is bounded, so this never materializes the plane: it reads a
    // 4x4 block straddling a 1024-cell processing seam and a 4x4 block inside
    // each declared hole, and compares the composed samples against the
    // analytic plane the generator wrote.
    let resolved = {
        let connection = reopened.catalogue().unwrap();
        catalogue::collection_members(&connection, &generation_id).unwrap()
    };
    assert_eq!(resolved.len(), 1, "the plane is one source occurrence");
    let plane_manifest = {
        let connection = reopened.catalogue().unwrap();
        let head = catalogue::head_generation(&connection, &result_layer_id)
            .unwrap()
            .expect("head present");
        import::read_generation_manifest(&head.manifest_json).expect("manifest parses")
    };

    let seam = 1_024i64;
    let seam_window = generation::LatticeWindow {
        x: seam - 2,
        y: seam - 2,
        width: 4,
        height: 4,
    };
    let seam_values = {
        let reader = collection::load_reader_within(
            &reopened,
            &generation_id,
            &plane_manifest,
            Some(bounds_of(seam_window)),
            &cancel,
        )
        .expect("the bounded resolver binds")
        .expect("the plane reaches its own seam");
        reader
            .read_window(seam_window, &cancel)
            .expect("a seam-straddling window resolves")
    };
    assert_eq!(seam_values.samples.len(), 16);
    for row in 0..4i64 {
        for column in 0..4i64 {
            let index = (row * 4 + column) as usize;
            assert_eq!(
                seam_values.valid[index], 1,
                "the seam block is inside the plane: ({column},{row})"
            );
            let expected = plane_expected((seam - 2 + column) as f64, (seam - 2 + row) as f64);
            let actual = f64::from(seam_values.samples[index]);
            // Float32 storage of a value near 3.47e6 m quantises to about
            // 0.25 m, half a 0.5 m pixel: far tighter than the contract's
            // 0.001 deg / 0.01 pp slope tolerances, and tight enough that a
            // wrong formula or a shifted seam cannot pass.
            assert!(
                (actual - expected).abs() <= 0.5,
                "seam sample ({column},{row}) was {actual}, expected {expected}"
            );
        }
    }
    println!("seam window: 16 samples match the analytic plane");

    // A hole interior must report NoData exactly, including where the hole
    // crosses a processing-block boundary.
    for (y0, y1, x0, x1) in PLANE_HOLES {
        let (centre_y, centre_x) = ((y0 + y1) / 2, (x0 + x1) / 2);
        let hole_window = generation::LatticeWindow {
            x: centre_x - 2,
            y: centre_y - 2,
            width: 4,
            height: 4,
        };
        let hole_values = {
            let reader = collection::load_reader_within(
                &reopened,
                &generation_id,
                &plane_manifest,
                Some(bounds_of(hole_window)),
                &cancel,
            )
            .expect("the bounded resolver binds")
            .expect("the plane reaches its own hole");
            reader
                .read_window(hole_window, &cancel)
                .expect("a hole window resolves")
        };
        assert!(
            hole_values.valid.iter().all(|flag| *flag == 0),
            "hole y[{y0},{y1}) x[{x0},{x1}) must be entirely NoData"
        );
    }
    println!(
        "holes: {} declared rectangles read as exactly NoData",
        PLANE_HOLES.len()
    );

    // Just west of the first hole's left edge the same resolver returns data,
    // so the mask is a boundary rather than a blanket refusal.
    {
        let (y0, y1, x0, _x1) = PLANE_HOLES[0];
        let outside = generation::LatticeWindow {
            x: x0 - 4,
            y: (y0 + y1) / 2,
            width: 3,
            height: 3,
        };
        let values = {
            let reader = collection::load_reader_within(
                &reopened,
                &generation_id,
                &plane_manifest,
                Some(bounds_of(outside)),
                &cancel,
            )
            .expect("the bounded resolver binds")
            .expect("the plane reaches west of its own hole");
            reader
                .read_window(outside, &cancel)
                .expect("a window outside a hole resolves")
        };
        assert!(
            values.valid.iter().all(|flag| *flag == 1),
            "pixels west of the hole are valid"
        );
    }
    println!("hole edge: pixels west of hole 0 are valid");

    let measurement = sampler.finish();
    let _ = super::measurement::gate_combined_budget("capacity plane", &measurement);

    drop(reopened);
    let _ = std::fs::remove_dir_all(&work);
}
