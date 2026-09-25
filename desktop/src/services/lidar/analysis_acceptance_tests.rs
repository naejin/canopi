// Included in analysis::tests to reuse the real GDAL/import fixture.
// Hooks pause at a deterministic boundary; they do not replace read/write logic.
#[test]
#[ignore = "requires GDAL on PATH; generated small plane, no private fixtures"]
fn acceptance_inspection_rejects_head_changes_during_value_and_nodata_reads() {
    use common_types::lidar::{
        LidarSampleEntityKind, LidarSampleOutcome, LidarSampleRequest, LidarSampleUnavailableReason,
    };
    for mode in ["value", "hole", "early-nodata"] {
        let root = scratch_root(&format!("acceptance-inspect-{mode}"));
        let library = LidarLibrary::open(&root).unwrap();
        let layer = plane_layer(&library, &root, 16, 16);
        let old = catalogue::head_generation(&library.catalogue().unwrap(), &layer)
            .unwrap()
            .unwrap();
        publish_source(&library, &layer, &root.join("plane.tif"));
        let new = catalogue::head_generation(&library.catalogue().unwrap(), &layer)
            .unwrap()
            .unwrap();
        assert_ne!(old.id, new.id);
        {
            let connection = library.catalogue().unwrap();
            connection
                .execute(
                    "UPDATE lidar_layer_heads SET generation_id = ?1 WHERE layer_id = ?2",
                    rusqlite::params![old.id, layer],
                )
                .unwrap();
            if mode == "early-nodata" {
                let mut manifest = read_generation_manifest(&old.manifest_json).unwrap();
                // A finite point cannot be represented as an i64 lattice index.
                manifest.grid.geotransform[0] = 1.0e30;
                connection
                    .execute(
                        "UPDATE lidar_layer_generations SET manifest_json = ?1 WHERE id = ?2",
                        rusqlite::params![serde_json::to_string(&manifest).unwrap(), old.id],
                    )
                    .unwrap();
            }
        }
        let (x, y) = if mode == "hole" {
            (8.5_f64, 9.5_f64)
        } else {
            (5.5_f64, 10.5_f64)
        };
        let radius = 6_378_137.0;
        let request = LidarSampleRequest {
            kind: LidarSampleEntityKind::Source,
            entity_id: layer.clone(),
            expected_generation_id: old.id.clone(),
            request_id: mode.to_string(),
            longitude: (x / radius).to_degrees(),
            latitude: (2.0 * (y / radius).exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees(),
        };
        let cancel = AtomicBool::new(false);
        let healthy = library.sample(&request, &cancel).unwrap();
        if mode == "value" {
            assert!(
                matches!(healthy, LidarSampleOutcome::Value { value, .. } if (value - 5.0).abs() < 0.001),
                "{healthy:?}"
            );
        } else {
            assert!(
                matches!(healthy, LidarSampleOutcome::NoData { .. }),
                "{healthy:?}"
            );
        }
        let reached = std::rc::Rc::new(std::cell::Cell::new(false));
        let observed = reached.clone();
        let change = Box::new(move |library: &LidarLibrary| {
            observed.set(true);
            library
                .catalogue()
                .unwrap()
                .execute(
                    "UPDATE lidar_layer_heads SET generation_id = ?1 WHERE layer_id = ?2",
                    rusqlite::params![new.id, layer],
                )
                .unwrap();
        });
        let guard = if mode == "early-nodata" {
            super::super::acceptance_hooks::on_target(change)
        } else {
            super::super::acceptance_hooks::on_read(change)
        };
        let raced = library.sample(&request, &cancel).unwrap();
        assert!(reached.get(), "the fault boundary must be exercised");
        assert!(
            matches!(
                raced,
                LidarSampleOutcome::Unavailable {
                    reason: LidarSampleUnavailableReason::StaleGeneration
                }
            ),
            "{mode}: {raced:?}"
        );
        drop(guard);
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires GDAL on PATH and the pinned GeoLibre CLI; generated two-block plane, no private fixtures"]
fn acceptance_sparse_midwrite_failure_preserves_publication_and_retries() {
    fn files(path: &Path, output: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                files(&path, output);
            } else {
                output.push((path.clone(), std::fs::read(path).unwrap()));
            }
        }
    }
    for fault in ["capacity", "write"] {
        let root = scratch_root(&format!("acceptance-midwrite-{fault}"));
        let library = LidarLibrary::open(&root).unwrap();
        // Two occupied chunks; fault happens only after the first has produced output.
        let layer = plane_layer(&library, &root, 1030, 16);
        // A published result whose files must survive another calculation's
        // failure untouched.
        let (_, published) = run_first_slope_job(&library, &layer, LidarSlopeUnit::Degrees);
        let head = catalogue::head_analysis_generation(&library.catalogue().unwrap(), &published)
            .unwrap()
            .unwrap();
        let mut accepted_bytes = Vec::new();
        files(&root.join("lidar/assets"), &mut accepted_bytes);
        assert!(!accepted_bytes.is_empty());
        // A second, separate calculation with the same settings is the one
        // that fails: a published result is never recalculated in place.
        let (job, definition, encoded) = queued_slope_job(&library, &layer);
        let (parameters, source) = encoded.split_once('|').expect("encoded pair");
        let parameters = parse_parameters(parameters).unwrap();
        let source = source.to_string();
        let reached = std::rc::Rc::new(std::cell::Cell::new(false));
        let observed = reached.clone();
        let guard =
            super::super::acceptance_hooks::on_block(Box::new(move |scratch, has_output| {
                assert!(
                    has_output,
                    "fault must follow completed output, not preflight"
                );
                observed.set(true);
                if fault == "capacity" {
                    super::super::paths::capacity_probe::set(Some(0));
                } else {
                    // Actual filesystem create failure in the next chunk, not a fabricated Err.
                    std::fs::create_dir(scratch.join("slope-1-0.raw")).unwrap();
                }
            }));
        let error = run_slope_job(
            &library,
            &job,
            &definition,
            &parameters,
            &source,
            &AtomicBool::new(false),
        )
        .expect_err("mid-write fault must abort");
        assert!(reached.get());
        if fault == "capacity" {
            assert!(error.contains("free"), "{error}");
        } else {
            assert!(error.contains("Failed to create raw buffer"), "{error}");
        }
        drop(guard);
        let after = catalogue::head_analysis_generation(&library.catalogue().unwrap(), &published)
            .unwrap()
            .unwrap();
        assert_eq!(
            after.id, head.id,
            "failed publication changed the accepted head"
        );
        assert_eq!(after.manifest_json, head.manifest_json);
        assert!(
            catalogue::head_analysis_generation(&library.catalogue().unwrap(), &definition)
                .unwrap()
                .is_none(),
            "the failed calculation published nothing"
        );
        for (path, bytes) in accepted_bytes {
            assert_eq!(std::fs::read(path).unwrap(), bytes);
        }
        assert!(
            !library.inner.paths.slope_scratch_dir(&job).exists()
        );
        // Re-enter the actual worker without the fault; scheduler/IPC Retry is a separate contract.
        let retry = run_slope_job(
            &library,
            &job,
            &definition,
            &parameters,
            &source,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(retry.coverage_cells > 0, "{}", retry.summary());
        let next = catalogue::head_analysis_generation(&library.catalogue().unwrap(), &definition)
            .unwrap()
            .unwrap();
        assert_ne!(next.id, head.id);
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires GDAL on PATH and the pinned GeoLibre CLI; real published plane and Tauri-managed command state"]
/// R50 under the fixed-item contract: Retry reruns only a failed operation, with
/// its saved identity, against its pinned input, through the actual command.
fn acceptance_retry_command_preserves_saved_identity_and_publication() {
    use crate::native_operation::NativeOperationExecutor;
    use tauri::Manager;

    fn await_job(library: &LidarLibrary, job: &str) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let state: String = library
                .catalogue()
                .unwrap()
                .query_row(
                    "SELECT state FROM lidar_analysis_jobs WHERE id = ?1",
                    [job],
                    |row| row.get(0),
                )
                .unwrap();
            if state == "complete" && !library.inner.cancel_flags.lock().unwrap().contains_key(job)
            {
                return;
            }
            assert!(
                !matches!(state.as_str(), "failed" | "cancelled"),
                "job {job}: {state}"
            );
            assert!(
                std::time::Instant::now() < deadline,
                "job {job} did not settle: {state}"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    fn files(path: &Path, output: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                files(&path, output);
            } else {
                output.push((path.clone(), std::fs::read(path).unwrap()));
            }
        }
    }
    fn job_count(library: &LidarLibrary) -> i64 {
        library
            .catalogue()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM lidar_analysis_jobs", [], |row| {
                row.get(0)
            })
            .unwrap()
    }
    let root = scratch_root("acceptance-retry-command");
    let library = LidarLibrary::open(&root).unwrap();
    let executor = NativeOperationExecutor::production();
    library.attach_executor(executor.clone());
    let app = tauri::test::mock_builder()
        .manage(library.clone())
        .manage(executor)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let layer = plane_layer(&library, &root, 16, 16);
    let source = catalogue::head_generation(&library.catalogue().unwrap(), &layer)
        .unwrap()
        .unwrap();
    let mut receipts = Vec::new();
    for (name, unit) in [
        ("North slope", LidarSlopeUnit::Degrees),
        ("South slope", LidarSlopeUnit::Percent),
    ] {
        let receipt = library
            .create_analysis_unchecked(
                &layer,
                LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: unit,
                    name: None,
                },
                Some(name.to_string()),
            )
            .unwrap();
        await_job(&library, &receipt.job_id);
        receipts.push(receipt);
    }
    let alpha = &receipts[0].definition_id;
    let beta = &receipts[1].definition_id;
    let head = |id: &str| {
        catalogue::head_analysis_generation(&library.catalogue().unwrap(), id)
            .unwrap()
            .unwrap()
    };
    let first_alpha = head(alpha);
    let first_beta = head(beta);
    assert_eq!(first_beta.name.as_deref(), Some("South slope"));
    // The fixture is a real published raster, readable through normal inspection.
    let request = common_types::lidar::LidarSampleRequest {
        kind: common_types::lidar::LidarSampleEntityKind::Analysis,
        entity_id: beta.clone(),
        expected_generation_id: first_beta.id.clone(),
        request_id: "retry-control".into(),
        longitude: (5.5_f64 / 6_378_137.0).to_degrees(),
        latitude: (2.0 * (10.5_f64 / 6_378_137.0).exp().atan() - std::f64::consts::FRAC_PI_2)
            .to_degrees(),
    };
    let sample = library.sample(&request, &AtomicBool::new(false)).unwrap();
    assert!(
        matches!(sample, common_types::lidar::LidarSampleOutcome::Value { value, .. } if (value - 100.0).abs() < 0.01),
        "{sample:?}"
    );
    let retry = |definition: &str, input: &str| {
        tauri::async_runtime::block_on(crate::commands::lidar::lidar_retry_analysis(
            app.state(),
            app.state(),
            definition.to_string(),
            input.to_string(),
        ))
    };
    let mut accepted_bytes = Vec::new();
    files(&root.join("lidar/assets"), &mut accepted_bytes);
    assert!(!accepted_bytes.is_empty());

    // A complete result is never recalculated in place: the actual command
    // refuses before enqueueing anything, and every accepted byte stays.
    let refused = retry(beta, &source.id).unwrap_err();
    assert!(refused.contains("new slope"), "{refused}");
    assert_eq!(job_count(&library), 2, "refusal must not enqueue work");
    assert_eq!(head(beta).id, first_beta.id);

    // A failed operation retries through the actual command with its saved
    // recipe, parameters and name, against the input it was pinned to.
    let seed_failed = |definition: &str, name: &str, input: &str| {
        let connection = library.catalogue().unwrap();
        connection
            .execute(
                "INSERT INTO lidar_analysis_definitions (id, layer_id, kind, version, parameters_json, created_at)
                 VALUES (?1, ?2, 'slope', 2, ?3, '0')",
                rusqlite::params![
                    definition,
                    layer,
                    format!("{{\"slope_unit\":\"Percent\",\"name\":\"{name}\"}}")
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_dependencies(definition_id, layer_id, kind) VALUES (?1, ?2, 'source')",
                rusqlite::params![definition, layer],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_analysis_jobs (id, definition_id, source_generation_id, state, message, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'failed', 'engine stopped', '1', '1')",
                rusqlite::params![format!("job-{definition}"), definition, input],
            )
            .unwrap();
    };
    seed_failed("adef-west", "West slope", &source.id);
    let parameters = definition_row(&library.catalogue().unwrap(), "adef-west")
        .unwrap()
        .unwrap()
        .parameters_json;
    let receipt = retry("adef-west", &source.id).unwrap();
    assert_eq!(receipt.definition_id, "adef-west");
    await_job(&library, &receipt.job_id);
    let west = head("adef-west");
    assert_eq!(west.name.as_deref(), Some("West slope"));
    assert_eq!(west.source_generation_id, source.id);
    assert_eq!(
        definition_row(&library.catalogue().unwrap(), "adef-west")
            .unwrap()
            .unwrap()
            .parameters_json,
        parameters
    );
    assert_eq!(head(alpha).id, first_alpha.id);
    assert_eq!(head(beta).id, first_beta.id);
    assert_eq!(job_count(&library), 4);

    // Advance the real source: an operation pinned to the old input is refused
    // before enqueue instead of being retargeted, and accepted bytes stay.
    publish_source(&library, &layer, &root.join("plane.tif"));
    assert_ne!(
        catalogue::head_generation(&library.catalogue().unwrap(), &layer)
            .unwrap()
            .unwrap()
            .id,
        source.id
    );
    seed_failed("adef-east", "East slope", &source.id);
    let stale = retry("adef-east", &source.id).unwrap_err();
    assert!(stale.contains("no longer available"), "{stale}");
    assert_eq!(job_count(&library), 5, "refusal must not enqueue work");
    for (path, bytes) in accepted_bytes {
        assert_eq!(std::fs::read(&path).unwrap(), bytes, "{}", path.display());
    }
    drop(app);
    drop(library);
    std::fs::remove_dir_all(root).unwrap();
}
