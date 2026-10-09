//! Fixed reusable library items (GeoLibre adoption S2).
//!
//! A published source's content is fixed: importing more data creates another
//! item, analyses create derived items, and nothing refreshes itself. These
//! tests cross the real `LidarLibrary` owner and a temporary library.

use super::*;
use common_types::library::{LibraryItemRole, LibraryItemSummary, RasterQuantity};
use common_types::lidar::{LidarDisplayRequest, LidarDisplayState, LidarResultState};
use std::path::Path;

fn scratch(label: &str) -> crate::test_scratch::TestScratch {
    crate::test_scratch::TestScratch::new(&format!("fixed-{label}"))
}

fn seed_result(connection: &Connection, layer_id: &str, item_id: &str, source_generation: &str) {
    analyses::test_support::seed_published_slope(
        connection,
        layer_id,
        source_generation,
        &format!("adef-{item_id}"),
        item_id,
        &format!("dgen-{item_id}"),
        None,
    );
}

fn item<'a>(items: &'a [LibraryItemSummary], id: &str) -> &'a LibraryItemSummary {
    items
        .iter()
        .find(|item| item.id == id)
        .unwrap_or_else(|| panic!("{id} is listed"))
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
            RasterQuantity::GroundElevation,
            None,
            false,
            &[root.join("a.tif")],
        )
        .unwrap();
    seed_result(
        &library.catalogue().unwrap(),
        &layer_id,
        "item-kept",
        "gen-input",
    );

    let refused = library.delete_item(&layer_id).unwrap_err();
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
        count(&library, "SELECT COUNT(*) FROM lidar_derived_heads"),
        1
    );

    let impact = library.delete_impact(&layer_id).unwrap();
    assert_eq!(impact.dependent_item_ids, ["item-kept"]);
    let snapshot = library.library_snapshot().unwrap();
    assert_eq!(item(&snapshot.items, &layer_id).dependents, 1);

    library.delete_item("item-kept").unwrap();
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_source_layers"),
        1
    );
    library.delete_item(&layer_id).unwrap();
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
            RasterQuantity::GroundElevation,
            None,
            false,
            &[first.clone(), second.clone()],
        )
        .unwrap();

    let snapshot = library.library_snapshot().unwrap();
    let item = item(&snapshot.items, &layer_id);
    assert_eq!(item.name.as_deref(), Some("Orchard survey"));
    assert_eq!(item.role, LibraryItemRole::Source);
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
    let item = self::item(&failed.items, &layer_id);
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
    // Cancel deletes the item with every import it had.
    library.cancel_import(&retry_job).unwrap();
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
            .record_import_item("Orchard", RasterQuantity::GroundElevation, None, false, &[])
            .is_err()
    );
    assert!(
        library
            .record_import_item(
                "  ",
                RasterQuantity::GroundElevation,
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
        library.inner.engine.as_ref(),
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
            LidarImportJobState::Complete | LidarImportJobState::Failed
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
            RasterQuantity::GroundElevation,
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
    let item = item(&snapshot.items, &receipt.layer_id);
    assert_eq!(item.state, LidarResultState::Ready);
    let generation = item.generation_id.clone().expect("published head");

    // Display derivatives were staged by the import job itself.
    let descriptor = library
        .display_descriptor(&LidarDisplayRequest {
            kind: LibraryItemRole::Source,
            entity_id: receipt.layer_id.clone(),
            expected_generation_id: Some(generation.clone()),
            retry: false,
        })
        .unwrap();
    assert_eq!(descriptor.state, LidarDisplayState::Ready, "{descriptor:?}");
    assert_eq!(descriptor.assets.len(), 2);

    // A published item's content is fixed, even for a stale caller.
    let refused = library
        .begin_import_sources(
            HeavyJobLease::acquire(&library, "imp-stale").unwrap(),
            "imp-stale",
            &receipt.layer_id,
            vec![west],
        )
        .unwrap_err();
    assert!(refused.contains("published"), "{refused}");
    let head = catalogue::head_generation(&library.catalogue().unwrap(), &receipt.layer_id)
        .unwrap()
        .unwrap();
    assert_eq!(head.id, generation);

    // A saved result whose input is not the head is out of date, never
    // refreshed by itself: reopening the library and attaching the executor
    // enqueue nothing.
    seed_result(
        &library.catalogue().unwrap(),
        &receipt.layer_id,
        "item-old",
        "gen-earlier",
    );
    drop(library);
    let reopened = LidarLibrary::open(&root).unwrap();
    reopened.attach_executor(executor);
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(
        count(&reopened, "SELECT COUNT(*) FROM lidar_analysis_jobs"),
        1,
        "only the seeded, completed run"
    );
    assert_eq!(
        count(
            &reopened,
            "SELECT COUNT(*) FROM lidar_analysis_jobs WHERE state = 'preparing'"
        ),
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
            RasterQuantity::GroundElevation,
            None,
            false,
            &[root.join("a.tif")],
        )
        .unwrap();
    seed_result(
        &library.catalogue().unwrap(),
        &layer_id,
        "item-named",
        "gen-input",
    );
    library.rename_item("item-named", "  North slope ").unwrap();
    library.rename_item(&layer_id, "Orchard 2024").unwrap();
    let snapshot = library.library_snapshot().unwrap();
    let result = item(&snapshot.items, "item-named");
    assert_eq!(result.name.as_deref(), Some("North slope"));
    assert_eq!(
        result
            .provenance
            .as_ref()
            .map(|provenance| provenance.inputs[0].generation_id.as_str()),
        Some("gen-input")
    );
    assert_eq!(result.generation_id.as_deref(), Some("dgen-item-named"));
    assert_eq!(
        item(&snapshot.items, &layer_id).name.as_deref(),
        Some("Orchard 2024")
    );
    assert!(library.rename_item("item-named", "   ").is_err());
    assert!(library.rename_item("item-missing", "Name").is_err());
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_analysis_jobs"),
        1,
        "only the seeded run"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// A library wired like the app's, so an admitted import would start.
fn attached_library(root: &Path) -> LidarLibrary {
    let library = LidarLibrary::open(root).unwrap();
    library.attach_executor(crate::native_operation::NativeOperationExecutor::production());
    library
}

/// Asserts a refusal shown in the import dialog: it names the user's file and
/// nothing about where it lives or how the system failed, and the refused
/// import left no item and no job behind.
fn assert_refused_in_dialog(library: &LidarLibrary, root: &Path, error: &str, name: &str) {
    assert!(error.contains(name), "the refusal names {name}: {error}");
    let root = root.display().to_string();
    assert!(!error.contains(&root), "no root path in: {error}");
    assert!(!error.contains("os error"), "no system error in: {error}");
    assert_eq!(
        count(library, "SELECT COUNT(*) FROM lidar_source_layers"),
        0,
        "no item for a refused import"
    );
    assert_eq!(
        count(library, "SELECT COUNT(*) FROM lidar_import_jobs"),
        0,
        "no job for a refused import"
    );
}

/// The GeoTIFF `plane` writes, with its projected code key rewritten to
/// `code`, a code no listed coordinate system has.
fn plane_in_code(library: &LidarLibrary, root: &Path, name: &str, code: u16) -> PathBuf {
    let path = plane(library, root, name, 445_000.0);
    let mut bytes = std::fs::read(&path).unwrap();
    // ProjectedCSTypeGeoKey (3072), stored in the directory itself, one
    // value: EPSG:2154, little-endian.
    let key: Vec<u8> = [3072u16, 0, 1, 2154]
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect();
    let at: Vec<usize> = bytes
        .windows(key.len())
        .enumerate()
        .filter(|(_, window)| *window == key.as_slice())
        .map(|(index, _)| index)
        .collect();
    assert_eq!(at.len(), 1, "one projected code key in {}", path.display());
    bytes[at[0] + 6..at[0] + 8].copy_from_slice(&code.to_le_bytes());
    std::fs::write(&path, bytes).unwrap();
    path
}

/// canopi-try2: a selected file that is gone is refused when Import is
/// clicked, by name, and creates nothing.
#[test]
fn importing_a_missing_file_is_refused_by_name_and_creates_nothing() {
    let root = scratch("import-missing");
    let library = attached_library(&root);
    let error = library
        .import_item(
            "Orchard",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![root.join("gone.tif")],
        )
        .unwrap_err();
    assert!(error.contains("cannot be found"), "{error}");
    assert_refused_in_dialog(&library, &root, &error, "gone.tif");
}

/// U31: a GeoTIFF in a coordinate system Canopi cannot place is refused when
/// Import is clicked with the typed refusal naming its code, and creates
/// nothing.
#[test]
fn importing_a_geotiff_in_a_refused_code_is_refused_and_creates_nothing() {
    let root = scratch("import-refused-code");
    let library = attached_library(&root);
    let source = plane_in_code(&library, &root, "elsewhere", 65_000);
    let error = library
        .import_item(
            "Elsewhere",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![source],
        )
        .unwrap_err();
    assert!(
        error.contains("65000"),
        "the refusal names the code: {error}"
    );
    assert_refused_in_dialog(&library, &root, &error, "elsewhere.tif");
}

/// A file that is not a GeoTIFF is refused from its signature, before any
/// reader parses it whole, and creates nothing.
#[test]
fn importing_a_file_that_is_not_a_geotiff_is_refused_before_it_is_read() {
    let root = scratch("import-not-tiff");
    let library = attached_library(&root);
    let source = root.join("dem.asc");
    std::fs::write(
        &source,
        "ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\nNODATA_value -9999\n1 2\n3 4\n",
    )
    .unwrap();
    let error = library
        .import_item(
            "Grid",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![source],
        )
        .unwrap_err();
    assert!(error.contains("not a GeoTIFF"), "{error}");
    assert!(
        !error.contains("readable raster"),
        "refused before a reader parsed it: {error}"
    );
    assert_refused_in_dialog(&library, &root, &error, "dem.asc");
}

/// A chosen file that cannot be opened is refused by name, without its
/// folder or the system's error, and creates nothing.
#[cfg(unix)]
#[test]
fn importing_a_file_that_cannot_be_opened_is_refused_by_name() {
    use std::os::unix::fs::PermissionsExt as _;
    let root = scratch("import-unopenable");
    let library = attached_library(&root);
    let source = root.join("locked.tif");
    std::fs::write(&source, b"II\x2a\x00 a locked GeoTIFF").unwrap();
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o000)).unwrap();
    if std::fs::File::open(&source).is_ok() {
        // Permissions do not bind this user (root): nothing to observe.
        return;
    }
    let error = library
        .import_item(
            "Grid",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![source.clone()],
        )
        .unwrap_err();
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(error.contains("cannot be read"), "{error}");
    assert_refused_in_dialog(&library, &root, &error, "locked.tif");
}

/// The failed import Retry is offered on: its job's message is what the item's
/// row shows.
fn failed_import(library: &LidarLibrary, source: PathBuf, message: &str) -> String {
    let (layer_id, job_id) = library
        .record_import_item(
            "Orchard",
            RasterQuantity::GroundElevation,
            None,
            false,
            &[source],
        )
        .unwrap();
    library.fail_import_job(&job_id, message);
    layer_id
}

/// The message the item's row shows, once its latest import has failed.
fn row_message(library: &LidarLibrary, layer_id: &str) -> String {
    let snapshot = library.library_snapshot().unwrap();
    let job = item(&snapshot.items, layer_id)
        .import_job
        .as_ref()
        .expect("a retryable import");
    assert_eq!(job.state, LidarImportJobState::Failed);
    job.message.clone().unwrap_or_default()
}

/// A Retry whose saved file has gone is refused by name before a job is
/// recorded: the refusal replaces the failed import's message on the item's
/// row, and refusing again adds no job row.
#[test]
fn retrying_an_import_whose_file_is_gone_is_refused_on_its_item_without_a_new_job() {
    let root = scratch("retry-missing");
    let library = attached_library(&root);
    let layer_id = failed_import(&library, root.join("gone.tif"), "first failure");
    let error = library.retry_import(&layer_id).unwrap_err();
    assert!(error.contains("gone.tif cannot be found"), "{error}");
    assert!(!error.contains(&root.display().to_string()), "{error}");
    assert_eq!(row_message(&library, &layer_id), error);
    assert_eq!(library.retry_import(&layer_id).unwrap_err(), error);
    assert_eq!(count(&library, "SELECT COUNT(*) FROM lidar_import_jobs"), 1);
}

/// A refused Retry whose reason cannot be written onto its item still returns
/// the refusal itself, not the failed write.
#[test]
fn a_refused_retry_returns_its_reason_when_the_row_cannot_be_updated() {
    let root = scratch("retry-refused-write-fails");
    let library = attached_library(&root);
    let layer_id = failed_import(&library, root.join("gone.tif"), "first failure");
    library
        .catalogue()
        .unwrap()
        .execute_batch(
            "CREATE TEMP TRIGGER jobs_read_only BEFORE UPDATE ON lidar_import_jobs
             BEGIN SELECT RAISE(ABORT, 'jobs are read-only'); END;",
        )
        .unwrap();
    let error = library.retry_import(&layer_id).unwrap_err();
    assert!(error.contains("gone.tif cannot be found"), "{error}");
    assert!(!error.contains("read-only"), "{error}");
    assert_eq!(count(&library, "SELECT COUNT(*) FROM lidar_import_jobs"), 1);
}

/// A library the catalogue rebuild made: its one item, named "Orchard", is
/// rebuilt from `source`'s bytes kept as the managed original of `sha256`, which
/// was imported as `elsewhere.tif`. Returns the library and the item.
fn rebuilt_library(root: &Path, source: &Path, sha256: &str) -> (LidarLibrary, String) {
    rebuilt_item(root, &[(source, sha256, "elsewhere.tif")])
}

/// A library the catalogue rebuild made, whose one item "Orchard" has
/// `members` (source bytes, sha256, the name it was imported as) in order.
fn rebuilt_item(root: &Path, members: &[(&Path, &str, &str)]) -> (LidarLibrary, String) {
    let lidar = paths::library_root(root);
    let item = source_meta::ItemMeta {
        id: "lyr-rebuilt".to_string(),
        name: "Orchard".to_string(),
        quantity: RasterQuantity::GroundElevation.key().to_string(),
        units: "m".to_string(),
        created_at: "10".to_string(),
        members: members
            .iter()
            .map(|(_, sha256, _)| sha256.to_string())
            .collect(),
        analyses: Vec::new(),
    };
    for (source, sha256, name) in members {
        let dir = lidar.join("sources").join(sha256);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::copy(source, dir.join("original")).unwrap();
        let meta = source_meta::SourceMeta {
            version: source_meta::META_VERSION,
            sha256: sha256.to_string(),
            original_filename: name.to_string(),
            size_bytes: std::fs::metadata(source).unwrap().len(),
            imported_at: "10".to_string(),
            items: vec![item.clone()],
        };
        source_meta::write(&dir.join(source_meta::META_FILE), &meta).unwrap();
    }
    std::fs::write(lidar.join(paths::CATALOGUE_FILE), b"not a catalogue").unwrap();
    let library = attached_library(root);
    assert!(matches!(
        library.open_status(),
        recovery::LibraryOpenStatus::Recovered { items: 1, .. }
    ));
    assert_eq!(
        row_message(&library, "lyr-rebuilt"),
        recovery::RECOVERED_IMPORT_MESSAGE
    );
    (library, "lyr-rebuilt".to_string())
}

/// A rebuilt item whose Retry passes the check but whose import then refuses
/// one member (south-up, found only while preparing): the failure on the
/// item's row names that member's imported file, never "original".
#[test]
fn a_rebuilt_item_whose_import_refuses_a_member_names_the_imported_file() {
    let workbench = scratch("retry-rebuilt-south-up-tiles");
    let west = plane(&attached_library(&workbench), &workbench, "west", 445_000.0);
    // A positive pixel height is written as a negative ModelPixelScale y,
    // which reads back as a south-up grid.
    let east = workbench.join("east.tif");
    wbgeotiff::GeoTiffWriter::new(4, 4, 1)
        .geo_transform(wbgeotiff::GeoTransform::north_up(
            445_064.0,
            1.0,
            6_806_000.0,
            1.0,
        ))
        .epsg(2154)
        .no_data(-9999.0)
        .write_f32(&east, &[5.0; 16])
        .unwrap();
    let root = scratch("retry-rebuilt-south-up");
    let (library, layer_id) = rebuilt_item(
        &root,
        &[
            (west.as_path(), "sha-west", "west.tif"),
            (east.as_path(), "sha-east", "east.tif"),
        ],
    );
    let receipt = library.retry_import(&layer_id).unwrap();
    assert_eq!(
        await_import(&library, &receipt.job_id),
        LidarImportJobState::Failed
    );
    let message = row_message(&library, &layer_id);
    assert!(message.contains("east.tif"), "{message}");
    assert!(message.contains("south-up"), "{message}");
    assert!(
        !message.contains("original"),
        "no managed name in: {message}"
    );
}

/// U31 on a rebuilt item: a Retry whose managed original is in a refused code
/// is refused with the typed message, naming the file the user imported rather
/// than the managed copy, and that message replaces the rebuild's "Retry
/// prepares this item again" on the row instead of vanishing with the dialog.
#[test]
fn retrying_a_rebuilt_item_in_a_refused_code_keeps_the_refusal_on_the_item() {
    let workbench = scratch("retry-refused-code-tile");
    let tile = plane_in_code(&attached_library(&workbench), &workbench, "tile", 65_000);
    let root = scratch("retry-refused-code");
    let (library, layer_id) = rebuilt_library(&root, &tile, "sha-refused");
    let jobs = count(&library, "SELECT COUNT(*) FROM lidar_import_jobs");
    let error = library.retry_import(&layer_id).unwrap_err();
    assert!(
        error.contains("65000"),
        "the refusal names the code: {error}"
    );
    assert!(
        error.contains("elsewhere.tif"),
        "the refusal names the imported file: {error}"
    );
    assert!(!error.contains("original"), "no managed name in: {error}");
    assert!(!error.contains(&root.display().to_string()), "{error}");
    assert_eq!(row_message(&library, &layer_id), error);
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_import_jobs"),
        jobs,
        "the refusal adds no job row"
    );
    assert!(
        library.record_import_retry(&layer_id).is_ok(),
        "the item still offers Retry"
    );
}

/// A rebuilt item whose managed original has gone is refused under the name it
/// was imported with, never as "original".
#[test]
fn retrying_a_rebuilt_item_whose_original_is_gone_names_the_imported_file() {
    let workbench = scratch("retry-rebuilt-gone-tile");
    let tile = plane(&attached_library(&workbench), &workbench, "tile", 445_000.0);
    let root = scratch("retry-rebuilt-gone");
    let (library, layer_id) = rebuilt_library(&root, &tile, "sha-gone");
    std::fs::remove_file(library.inner.paths.source_original("sha-gone")).unwrap();
    let error = library.retry_import(&layer_id).unwrap_err();
    assert!(
        error.starts_with("elsewhere.tif cannot be found"),
        "{error}"
    );
    assert_eq!(row_message(&library, &layer_id), error);
}

/// While a raster job holds the heavy lease, Import and Retry are refused in
/// the dialog with nothing recorded: no item, no job, and the item's earlier
/// failure stays its message (a busy library is not the item's failure).
#[test]
fn import_and_retry_are_refused_with_nothing_recorded_while_a_raster_job_runs() {
    let root = scratch("import-busy");
    let library = attached_library(&root);
    let tile = plane(&library, &root, "terrain", 445_000.0);
    let layer_id = failed_import(&library, tile.clone(), "earlier");
    let lease = HeavyJobLease::acquire(&library, "imp-running").unwrap();

    let error = library
        .import_item(
            "Terrain",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![tile],
        )
        .unwrap_err();
    assert!(error.contains("already running"), "{error}");
    let error = library.retry_import(&layer_id).unwrap_err();
    assert!(error.contains("already running"), "{error}");

    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_source_layers"),
        1,
        "Import recorded no item"
    );
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_import_jobs"),
        1,
        "neither recorded a job"
    );
    assert_eq!(row_message(&library, &layer_id), "earlier");

    // The lease is the only obstacle: once the raster job ends, Retry runs.
    drop(lease);
    let receipt = library.retry_import(&layer_id).unwrap();
    assert_eq!(
        await_import(&library, &receipt.job_id),
        LidarImportJobState::Complete
    );
}

/// Every file under the library's sources, jobs, assets and display folders.
fn library_files(library: &LidarLibrary) -> Vec<PathBuf> {
    fn walk(dir: &Path, found: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, found);
            } else {
                found.push(path);
            }
        }
    }
    let paths = &library.inner.paths;
    let mut found = Vec::new();
    for dir in [
        paths.root().join("sources"),
        paths.root().join("assets"),
        paths.jobs_dir(),
        paths.display_cog_dir(),
    ] {
        walk(&dir, &mut found);
    }
    found
}

/// The catalogue and display rows an import writes, by table.
fn import_rows(library: &LidarLibrary) -> Vec<(&'static str, i64)> {
    let mut rows: Vec<(&'static str, i64)> = [
        "lidar_source_layers",
        "lidar_import_jobs",
        "lidar_sources",
        "lidar_interpretations",
        "lidar_raster_assets",
    ]
    .into_iter()
    .map(|table| {
        (
            table,
            count(library, &format!("SELECT COUNT(*) FROM {table}")),
        )
    })
    .collect();
    rows.push((
        "display_cogs",
        library
            .display()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM display_cogs", [], |row| row.get(0))
            .unwrap(),
    ));
    rows
}

fn no_import_rows() -> Vec<(&'static str, i64)> {
    [
        "lidar_source_layers",
        "lidar_import_jobs",
        "lidar_sources",
        "lidar_interpretations",
        "lidar_raster_assets",
        "display_cogs",
    ]
    .into_iter()
    .map(|table| (table, 0))
    .collect()
}

/// Waits until a job's own settlement has run (its cancel flag is gone).
fn await_settled(library: &LidarLibrary, job_id: &str) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while library
        .inner
        .cancel_flags
        .lock()
        .unwrap()
        .contains_key(job_id)
    {
        assert!(
            std::time::Instant::now() < deadline,
            "import {job_id} did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Cancel deletes the half-imported item at once, and the job's settlement
/// removes every file it wrote: nothing is listed, nothing stays on disk,
/// and the same file imports again under the same name (user, 2026-10-09).
#[test]
fn cancelling_an_import_deletes_its_item_and_every_file_it_wrote() {
    let root = scratch("cancel-deletes");
    let library = attached_library(&root);
    let source = plane(&library, &root, "orchard", 445_000.0);
    // Held, the display registry stops the job after preparation, when its
    // original, staged COG and staging record are all on disk.
    let display = library.display().unwrap();
    let receipt = library
        .import_item(
            "Orchard",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![source.clone()],
        )
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while library
        .get_import_job(&receipt.job_id)
        .unwrap()
        .unwrap()
        .state
        != LidarImportJobState::Applying
    {
        assert!(
            std::time::Instant::now() < deadline,
            "the import never prepared"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(!library_files(&library).is_empty(), "the job wrote files");

    library.cancel_import(&receipt.job_id).unwrap();
    assert!(
        library.library_snapshot().unwrap().items.is_empty(),
        "the item is gone at once"
    );
    drop(display);
    await_settled(&library, &receipt.job_id);

    assert_eq!(import_rows(&library), no_import_rows());
    assert_eq!(library_files(&library), Vec::<PathBuf>::new());

    let again = library
        .import_item(
            "Orchard",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![source],
        )
        .unwrap();
    assert_eq!(
        await_import(&library, &again.job_id),
        LidarImportJobState::Complete
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// A cancel that reaches an import after it published leaves the finished
/// item, never half of it.
#[test]
fn a_cancel_after_publication_keeps_the_finished_item() {
    let root = scratch("cancel-after-publish");
    let library = attached_library(&root);
    let source = plane(&library, &root, "orchard", 445_000.0);
    let receipt = library
        .import_item(
            "Orchard",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![source],
        )
        .unwrap();
    assert_eq!(
        await_import(&library, &receipt.job_id),
        LidarImportJobState::Complete
    );
    let files = library_files(&library);
    let rows = import_rows(&library);

    library.cancel_import(&receipt.job_id).unwrap();

    let snapshot = library.library_snapshot().unwrap();
    assert!(
        item(&snapshot.items, &receipt.layer_id)
            .generation_id
            .is_some()
    );
    assert_eq!(import_rows(&library), rows);
    assert_eq!(library_files(&library), files);
    let _ = std::fs::remove_dir_all(&root);
}

/// A cancel that lands just before publication commits wins: publication is
/// refused and the settlement removes the staged originals, the promoted COG
/// and the display derivatives the job prepared.
#[test]
fn a_cancel_before_the_publication_commits_leaves_nothing() {
    let root = scratch("cancel-before-commit");
    let library = attached_library(&root);
    let source = plane(&library, &root, "orchard", 445_000.0);
    let cancel = AtomicBool::new(false);
    let (layer_id, job_id) = library
        .record_import_item(
            "Orchard",
            RasterQuantity::GroundElevation,
            None,
            false,
            std::slice::from_ref(&source),
        )
        .unwrap();
    import::stage_import(&library, &job_id, &layer_id, &[source], &cancel).unwrap();
    let staging = import::read_staged_import(&library, &job_id).unwrap();
    library.prepare_staged_display(&staging, &cancel).unwrap();
    assert!(
        import_rows(&library)
            .iter()
            .any(|(table, rows)| *table == "display_cogs" && *rows > 0),
        "the job prepared its display derivative"
    );

    library.cancel_import(&job_id).unwrap();
    import::apply_import(&library, &staging, &cancel)
        .expect_err("a cancelled import never publishes");
    library.discard_import_job_files(&job_id);

    assert_eq!(import_rows(&library), no_import_rows());
    assert_eq!(library_files(&library), Vec::<PathBuf>::new());
    let _ = std::fs::remove_dir_all(&root);
}

/// A cancelled import of a file another item already published frees only
/// what it wrote itself: the published item's original, COG and display
/// derivative stay.
#[test]
fn a_cancelled_import_keeps_the_files_a_published_item_shares() {
    let root = scratch("cancel-shared");
    let library = attached_library(&root);
    let source = plane(&library, &root, "orchard", 445_000.0);
    let first = library
        .import_item(
            "Orchard",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![source.clone()],
        )
        .unwrap();
    assert_eq!(
        await_import(&library, &first.job_id),
        LidarImportJobState::Complete
    );
    let files = library_files(&library);
    let cancel = AtomicBool::new(false);
    let (layer_id, job_id) = library
        .record_import_item(
            "Orchard again",
            RasterQuantity::GroundElevation,
            None,
            false,
            std::slice::from_ref(&source),
        )
        .unwrap();
    import::stage_import(&library, &job_id, &layer_id, &[source], &cancel).unwrap();
    let staging = import::read_staged_import(&library, &job_id).unwrap();
    library.prepare_staged_display(&staging, &cancel).unwrap();

    library.cancel_import(&job_id).unwrap();
    library.discard_import_job_files(&job_id);

    assert_eq!(library_files(&library), files);
    let snapshot = library.library_snapshot().unwrap();
    assert_eq!(snapshot.items.len(), 1);
    assert!(
        item(&snapshot.items, &first.layer_id)
            .generation_id
            .is_some()
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// A failed import keeps its item for Retry, but no file: once dismissed,
/// nothing of it is left on disk or in the catalogue.
#[test]
fn dismissing_a_failed_import_leaves_no_file_behind() {
    let root = scratch("dismiss-frees");
    let library = attached_library(&root);
    let west = plane(&library, &root, "west", 445_000.0);
    // Half a cell off the first source's lattice: both originals are copied
    // and prepared before the batch is refused.
    let east = plane(&library, &root, "east", 445_064.5);
    let receipt = library
        .import_item(
            "Pair",
            RasterQuantity::GroundElevation,
            None,
            false,
            vec![west, east],
        )
        .unwrap();
    assert_eq!(
        await_import(&library, &receipt.job_id),
        LidarImportJobState::Failed
    );

    library.dismiss_import(&receipt.layer_id).unwrap();

    assert_eq!(import_rows(&library), no_import_rows());
    assert_eq!(library_files(&library), Vec::<PathBuf>::new());
    let _ = std::fs::remove_dir_all(&root);
}
