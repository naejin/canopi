//! Registry, definitions, runs, publication, refresh and freshness.
//!
//! The first half needs no engine: catalogue rows stand in for raster data.
//! The second half writes analytic surfaces with the Rust raster engine; its
//! ignored tests then run the pinned GeoLibre CLI on them (the `lidar-native`
//! lane). Nothing here launches GDAL.

use super::test_support::{record, run_slope, seed_published_slope, slope_request};
use super::*;
use crate::services::lidar::import::{self, read_generation_manifest};
use crate::services::lidar::{acceptance_hooks, generation, paths};
use common_types::library::{
    AnalysisInputBinding, LibraryItemRole, LibraryItemSummary, ParamValue,
};
use common_types::lidar::{
    LidarResultState, LidarSamplePointsRequest, LidarSampleSeries, LidarSampleTarget,
    LidarSampleUnavailableReason,
};
use std::path::PathBuf;

fn scratch_root(label: &str) -> crate::test_scratch::TestScratch {
    crate::test_scratch::TestScratch::new(&format!("analyses-{label}"))
}

fn count(library: &LidarLibrary, sql: &str) -> i64 {
    library
        .catalogue()
        .unwrap()
        .query_row(sql, [], |row| row.get(0))
        .unwrap()
}

/// A source item with a published head row and no raster data.
fn source_with_head(
    library: &LidarLibrary,
    name: &str,
    quantity: RasterQuantity,
    crs_class: &str,
) -> (String, String) {
    let layer_id = library.create_layer(name, quantity, None, false).unwrap();
    let generation_id = new_id("gen");
    let connection = library.catalogue().unwrap();
    connection
        .execute(
            "INSERT INTO lidar_layer_generations
             (id, layer_id, created_at, manifest_json, coverage_cells, min_value, max_value,
              bounds_3857, crs_class)
             VALUES (?1, ?2, '0', '{}', 1, 0, 1, '[0,0,1,1]', ?3)",
            rusqlite::params![generation_id, layer_id, crs_class],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES (?1, ?2)",
            rusqlite::params![layer_id, generation_id],
        )
        .unwrap();
    (layer_id, generation_id)
}

fn summary<'a>(items: &'a [LibraryItemSummary], id: &str) -> &'a LibraryItemSummary {
    items
        .iter()
        .find(|item| item.id == id)
        .unwrap_or_else(|| panic!("{id} is listed"))
}

fn installed(version: &str) -> Result<GeolibreTool, String> {
    Ok(GeolibreTool {
        path: PathBuf::from("/nonexistent/geolibre"),
        version: version.to_string(),
    })
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/// Every registry entry runs on exactly one executor and every executor has an
/// entry; a windowed halo fits the bounded readers.
#[test]
fn every_registry_entry_has_exactly_one_executor() {
    for analysis in ANALYSIS_REGISTRY {
        let matching = EXECUTORS
            .iter()
            .filter(|executor| executor.analysis_id() == analysis.id)
            .count();
        assert_eq!(matching, 1, "{} needs exactly one executor", analysis.id);
        let AnalysisLane::GeolibreWindowed { halo } = analysis.lane;
        assert!(
            halo <= crate::services::lidar::prepared_raster::MAX_RECIPE_HALO,
            "{} reads beyond the bounded halo",
            analysis.id
        );
    }
    for executor in EXECUTORS {
        assert!(
            definition(executor.analysis_id()).is_some(),
            "{} has no registry entry",
            executor.analysis_id()
        );
    }
}

/// The class comes from the table row of the stored reference (A7, A9).
#[test]
fn crs_classes_come_from_the_row_of_the_stored_reference() {
    assert_eq!(crs_class("EPSG:2154"), CRS_PROJECTED_METRE);
    assert_eq!(crs_class("EPSG:4471"), CRS_PROJECTED_METRE);
    assert_eq!(
        crs_class("EPSG:3857"),
        CRS_PROJECTED_OTHER,
        "Web Mercator metres are not ground metres"
    );
    assert_eq!(crs_class("EPSG:4326"), "geographic");
    assert_eq!(crs_class("EPSG:4171"), "geographic");
    assert_eq!(crs_class("EPSG:2263"), "unknown", "feet are not a row");
    assert_eq!(crs_class(""), "unknown");
    assert!(values_in_metres(" Metres "));
    assert!(!values_in_metres("ft"));
}

/// Offers name why an item cannot feed an analysis, from catalogue facts only.
#[test]
fn offers_name_why_an_item_cannot_feed_an_analysis() {
    let ground = LibraryItemType::Raster {
        quantity: RasterQuantity::GroundElevation,
    };
    let facts = |item_type, units: &str, head: Option<&str>| ItemFacts {
        item_type,
        units: units.to_string(),
        head: head.map(|class| ("gen".to_string(), class.to_string())),
    };
    let slope = |facts: &ItemFacts, engine: &Result<GeolibreTool, String>| {
        offers(facts, engine)
            .into_iter()
            .find(|offer| offer.analysis_id == "terrain.slope")
            .expect("slope is offered to every item")
            .unavailable
    };
    let engine = installed("geolibre-cli 1.5.3");
    assert_eq!(
        slope(&facts(ground, "m", Some(CRS_PROJECTED_METRE)), &engine),
        None
    );
    assert_eq!(
        slope(
            &facts(
                LibraryItemType::Raster {
                    quantity: RasterQuantity::SurfaceElevation
                },
                "m",
                Some(CRS_PROJECTED_METRE)
            ),
            &engine
        ),
        Some(AnalysisUnavailable::WrongInput {
            expected: vec![ground]
        })
    );
    assert_eq!(
        slope(&facts(ground, "m", None), &engine),
        Some(AnalysisUnavailable::NotReady)
    );
    assert_eq!(
        slope(&facts(ground, "ft", Some(CRS_PROJECTED_METRE)), &engine),
        Some(AnalysisUnavailable::ValuesNotMetres {
            units: "ft".to_string()
        })
    );
    assert_eq!(
        slope(&facts(ground, "m", Some("geographic")), &engine),
        Some(AnalysisUnavailable::GridNotProjectedMetres)
    );
    assert_eq!(
        slope(
            &facts(ground, "m", Some(CRS_PROJECTED_METRE)),
            &Err("the GeoLibre engine is not installed".to_string())
        ),
        Some(AnalysisUnavailable::EngineMissing {
            detail: "the GeoLibre engine is not installed".to_string()
        })
    );
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/// A new definition, its input, one item per output and a job pinned to the
/// input's current generation are recorded together; the units come from the
/// chosen parameter.
#[test]
fn creating_a_definition_records_items_inputs_and_a_pinned_job() {
    let root = scratch_root("create");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, generation) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    let receipt = record(
        &library,
        &slope_request(&source, "percent", Some("  North slope ")),
    );
    assert_eq!(receipt.item_ids.len(), 1);
    let connection = library.catalogue().unwrap();
    let definition = catalogue::get_definition(&connection, &receipt.definition_id)
        .unwrap()
        .unwrap();
    assert_eq!(definition.analysis_id, "terrain.slope");
    assert_eq!(
        parse_parameters(&definition.parameters_json).unwrap(),
        vec![AnalysisParamValue {
            key: "unit".to_string(),
            value: ParamValue::Choice("percent".to_string()),
        }]
    );
    assert_eq!(
        catalogue::definition_inputs(&connection, &receipt.definition_id).unwrap(),
        vec![catalogue::AnalysisInputRow {
            input_key: "dem".to_string(),
            item_id: source.clone(),
        }]
    );
    let item = catalogue::get_derived_item(&connection, &receipt.item_ids[0])
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            item.output_key.as_str(),
            item.quantity.as_str(),
            item.units.as_str(),
            item.name.as_deref()
        ),
        ("slope", "slope", "%", Some("North slope"))
    );
    let job = catalogue::get_analysis_job(&connection, &receipt.job_id)
        .unwrap()
        .unwrap();
    assert_eq!((job.state.as_str(), job.recipe_version), ("preparing", 1));
    assert_eq!(
        parse_pinned_inputs(&job.input_generations_json).unwrap(),
        vec![ProvenanceInput {
            key: "dem".to_string(),
            item_id: source,
            generation_id: generation,
        }]
    );
    drop(connection);
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

/// Invalid requests are refused by name before anything is written.
#[test]
fn invalid_requests_are_refused_by_name_and_create_nothing() {
    let root = scratch_root("refuse");
    let library = LidarLibrary::open(&root).unwrap();
    let (ground, _) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    let (surface, _) = source_with_head(
        &library,
        "Surface",
        RasterQuantity::SurfaceElevation,
        CRS_PROJECTED_METRE,
    );
    let (geographic, _) = source_with_head(
        &library,
        "Degrees",
        RasterQuantity::GroundElevation,
        "geographic",
    );
    let (mercator, _) = source_with_head(
        &library,
        "Mercator",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_OTHER,
    );
    let unpublished = library
        .create_layer("Pending", RasterQuantity::GroundElevation, None, false)
        .unwrap();
    let refuse = |request: AnalysisRequest, needle: &str| {
        let error = record_definition(&library.catalogue().unwrap(), &request, None).unwrap_err();
        assert!(error.contains(needle), "{error} should mention {needle}");
    };
    let valid = || slope_request(&ground, "degrees", None);
    refuse(
        AnalysisRequest {
            analysis_id: "terrain.aspect".to_string(),
            ..valid()
        },
        "no analysis 'terrain.aspect'",
    );
    refuse(
        slope_request(&surface, "degrees", None),
        "must be ground-elevation",
    );
    refuse(
        slope_request(&geographic, "degrees", None),
        "projected grid",
    );
    // Web Mercator is projected and in metres, but not ground metres.
    refuse(slope_request(&mercator, "degrees", None), "ground metres");
    refuse(
        slope_request(&unpublished, "degrees", None),
        "no published data",
    );
    refuse(
        slope_request("lyr-missing", "degrees", None),
        "does not exist",
    );
    refuse(
        AnalysisRequest {
            parameters: Vec::new(),
            ..valid()
        },
        "choose a value for 'unit'",
    );
    refuse(slope_request(&ground, "radians", None), "not an option");
    refuse(
        AnalysisRequest {
            inputs: Vec::new(),
            ..valid()
        },
        "choose an item for input 'dem'",
    );
    refuse(
        AnalysisRequest {
            inputs: vec![AnalysisInputBinding {
                key: "surface".to_string(),
                item_id: ground.clone(),
            }],
            ..valid()
        },
        "no input 'surface'",
    );
    refuse(
        AnalysisRequest {
            outputs: vec!["aspect".to_string()],
            ..valid()
        },
        "no output 'aspect'",
    );
    // A missing engine refuses creation too.
    library
        .inner
        .geolibre
        .preset(Err("the GeoLibre engine is not installed".to_string()));
    let error = library.create_analysis(&valid()).unwrap_err();
    assert!(error.contains("not installed"), "{error}");
    for table in [
        "lidar_analysis_definitions",
        "lidar_analysis_inputs",
        "lidar_derived_items",
        "lidar_analysis_jobs",
    ] {
        assert_eq!(
            count(&library, &format!("SELECT COUNT(*) FROM {table}")),
            0,
            "{table}"
        );
    }
    // The snapshot says why new runs are unavailable; nothing else changes.
    let snapshot = library.library_snapshot().unwrap();
    assert!(!snapshot.engines.geolibre.available);
    assert_eq!(
        summary(&snapshot.items, &ground).offers[0].unavailable,
        Some(AnalysisUnavailable::EngineMissing {
            detail: "the GeoLibre engine is not installed".to_string()
        })
    );
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

// ---------------------------------------------------------------------------
// Publication and refresh
// ---------------------------------------------------------------------------

/// Stage one output as unpublished chunk rows over a recorded asset.
fn stage_fake(library: &LidarLibrary, digest: &str) -> StagedRaster {
    let generation_id = new_id("dgen");
    let connection = library.catalogue().unwrap();
    catalogue::insert_raster_asset(
        &connection,
        &catalogue::RasterAssetRow {
            sha256: digest.to_string(),
            rel_path: format!("assets/{digest}/cog.tif"),
            bytes: 1,
            profile: "test".to_string(),
            width: 1,
            height: 1,
            geotransform: "[0,1,0,0,0,-1]".to_string(),
            crs_ref: "EPSG:32631".to_string(),
            nodata: None,
        },
    )
    .unwrap();
    catalogue::insert_unpublished_chunks(
        &connection,
        &generation_id,
        &[catalogue::GenerationChunkRow {
            role: generation::RESULT_ROLE.to_string(),
            chunk_x: 0,
            chunk_y: 0,
            asset_sha256: digest.to_string(),
            valid_cells: 4,
            min_value: 1.0,
            max_value: 3.0,
            sum_value: 8.0,
        }],
    )
    .unwrap();
    StagedRaster {
        output_key: "slope",
        generation_id,
        grid: RasterGrid {
            width: 1024,
            height: 1024,
            geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
        },
        crs_ref: "EPSG:32631".to_string(),
        crs_class: CRS_PROJECTED_METRE.to_string(),
        bounds_3857: "[0,0,1,1]".to_string(),
        coverage_cells: 4,
        value_range: Some((1.0, 3.0)),
    }
}

fn publish_fake(
    library: &LidarLibrary,
    job_id: &str,
    digest: &str,
    tool_version: &str,
) -> Result<String, String> {
    let (job, inputs) = {
        let connection = library.catalogue().unwrap();
        let job = catalogue::get_analysis_job(&connection, job_id)
            .unwrap()
            .unwrap();
        let inputs = parse_pinned_inputs(&job.input_generations_json)
            .unwrap()
            .into_iter()
            .map(|input| PinnedInput {
                key: input.key,
                item_id: input.item_id,
                generation_id: input.generation_id,
                units: "m".to_string(),
            })
            .collect::<Vec<_>>();
        (job, inputs)
    };
    let staged = stage_fake(library, digest);
    let generation_id = staged.generation_id.clone();
    let tool = installed(tool_version)
        .unwrap()
        .provenance(vec!["slope".to_string()]);
    let published = publish(
        library,
        &job,
        &inputs,
        &ExecutorOutcome {
            outputs: vec![staged],
            tool,
        },
    );
    if published.is_err() {
        catalogue::discard_unpublished_generation_chunks(
            &library.catalogue().unwrap(),
            &generation_id,
        )
        .unwrap();
    }
    published.map(|()| generation_id)
}

/// A run publishes every output's head and records the tool; a refresh keeps
/// the item ids, upserts the heads, revokes the superseded chunks and keeps
/// both runs in the processing history.
#[test]
fn a_refresh_updates_items_in_place_and_keeps_the_run_history() {
    let root = scratch_root("refresh");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, _) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    let first = record(&library, &slope_request(&source, "degrees", Some("Steep")));
    let item_id = first.item_ids[0].clone();
    let first_generation =
        publish_fake(&library, &first.job_id, "digest-a", "geolibre-cli 1.5.3").unwrap();
    {
        let connection = library.catalogue().unwrap();
        let head = catalogue::derived_head(&connection, &item_id)
            .unwrap()
            .unwrap();
        assert_eq!(head.id, first_generation);
        let job = catalogue::get_analysis_job(&connection, &first.job_id)
            .unwrap()
            .unwrap();
        assert_eq!(job.state, "complete");
        assert!(job.finished_at.is_some());
        let tool = parse_tool(job.tool_provenance.as_deref()).unwrap();
        assert_eq!(tool.tools, ["slope"]);
    }
    let snapshot = library.library_snapshot().unwrap();
    let published = summary(&snapshot.items, &item_id);
    assert_eq!(published.role, LibraryItemRole::Derived);
    assert_eq!(published.state, LidarResultState::Ready);
    assert_eq!(published.name.as_deref(), Some("Steep"));
    assert_eq!(published.units, "°");
    assert_eq!(published.value_range, Some([1.0, 3.0]));
    let provenance = published.provenance.as_ref().unwrap();
    assert_eq!(provenance.analysis_id, "terrain.slope");
    assert_eq!(provenance.recipe_version, 1);
    assert_eq!(provenance.job_id, first.job_id);
    assert_eq!(provenance.inputs[0].item_id, source);
    assert_eq!(summary(&snapshot.items, &source).dependents, 1);

    let refresh = library_rerun(&library, &first.definition_id);
    assert_eq!(refresh.definition_id, first.definition_id);
    assert_eq!(
        refresh.item_ids, first.item_ids,
        "a refresh keeps the item ids"
    );
    let refused =
        record_rerun(&library.catalogue().unwrap(), &first.definition_id, None).unwrap_err();
    assert!(refused.contains("already running"), "{refused}");
    // While the refresh runs, the published result stays Ready and the run
    // reports itself.
    let snapshot = library.library_snapshot().unwrap();
    let running = summary(&snapshot.items, &item_id);
    assert_eq!(running.state, LidarResultState::Ready);
    assert_eq!(
        running.run.as_ref().map(|run| run.state),
        Some(AnalysisJobState::Preparing)
    );
    let second_generation =
        publish_fake(&library, &refresh.job_id, "digest-b", "geolibre-cli 1.5.3").unwrap();
    {
        let connection = library.catalogue().unwrap();
        assert_eq!(
            catalogue::derived_head(&connection, &item_id)
                .unwrap()
                .unwrap()
                .id,
            second_generation
        );
    }
    assert_eq!(
        count(
            &library,
            &format!(
                "SELECT COUNT(*) FROM lidar_generation_chunks WHERE generation_id = '{first_generation}'"
            )
        ),
        0,
        "the superseded generation's chunks are revoked"
    );
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_derived_generations"),
        2,
        "the superseded generation row stays for the history"
    );
    let history = library
        .processing_history(&first.definition_id, None)
        .unwrap();
    assert_eq!(history.next_cursor, None);
    let runs: Vec<(&str, AnalysisJobState, &str)> = history
        .runs
        .iter()
        .map(|run| {
            (
                run.job_id.as_str(),
                run.state,
                run.outputs[0].generation_id.as_str(),
            )
        })
        .collect();
    assert_eq!(
        runs,
        [
            (
                refresh.job_id.as_str(),
                AnalysisJobState::Complete,
                second_generation.as_str()
            ),
            (
                first.job_id.as_str(),
                AnalysisJobState::Complete,
                first_generation.as_str()
            ),
        ]
    );
    assert_eq!(history.runs[0].outputs[0].coverage_cells, Some(4));
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

fn library_rerun(library: &LidarLibrary, definition_id: &str) -> AnalysisReceipt {
    record_rerun(&library.catalogue().unwrap(), definition_id, None).unwrap()
}

/// A cancelled run and a job a restart interrupted keep no status text: the
/// state says what happened, and the UI words it in the user's language.
/// Only a failure's own reason is stored.
#[test]
fn a_cancelled_or_interrupted_job_keeps_no_status_text() {
    let root = scratch_root("status-text");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, _) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    let cancelled = record(&library, &slope_request(&source, "degrees", None));
    library.cancel_job(&cancelled.job_id);
    let stopped = record(&library, &slope_request(&source, "percent", None));
    settle_unpublished(&library.catalogue().unwrap(), &stopped.job_id, "cancelled");
    record(
        &library,
        &slope_request(&source, "degrees", Some("Running")),
    );
    library
        .record_import_item(
            "Orchard",
            RasterQuantity::GroundElevation,
            None,
            false,
            &[root.join("orchard.tif")],
        )
        .unwrap();
    drop(library);
    let reopened = LidarLibrary::open(&root).unwrap();
    assert_eq!(
        count(
            &reopened,
            "SELECT COUNT(*) FROM lidar_analysis_jobs WHERE state IN ('cancelled', 'failed')"
        ),
        3
    );
    assert_eq!(
        count(
            &reopened,
            "SELECT COUNT(*) FROM lidar_import_jobs WHERE state = 'failed'"
        ),
        1
    );
    assert_eq!(
        count(
            &reopened,
            "SELECT (SELECT COUNT(*) FROM lidar_analysis_jobs WHERE message IS NOT NULL)
                  + (SELECT COUNT(*) FROM lidar_import_jobs WHERE message IS NOT NULL)"
        ),
        0
    );
    drop(reopened);
    let _ = std::fs::remove_dir_all(root);
}

/// A cancelled job, a moved input or a deleted item publishes nothing.
#[test]
fn publication_is_refused_when_the_run_no_longer_matches_the_library() {
    let root = scratch_root("publish-refusals");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, _) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    let cancelled = record(&library, &slope_request(&source, "degrees", None));
    library.cancel_job(&cancelled.job_id);
    assert_eq!(
        publish_fake(&library, &cancelled.job_id, "digest-c", "v").unwrap_err(),
        "cancelled"
    );

    let moved = record(&library, &slope_request(&source, "degrees", None));
    {
        let connection = library.catalogue().unwrap();
        connection
            .execute(
                "INSERT INTO lidar_layer_generations
                 (id, layer_id, created_at, manifest_json, bounds_3857, crs_class)
                 VALUES ('gen-elsewhere', ?1, '1', '{}', '[0,0,1,1]', 'projected-metre')",
                [&source],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE lidar_layer_heads SET generation_id = 'gen-elsewhere' WHERE layer_id = ?1",
                [&source],
            )
            .unwrap();
    }
    let error = publish_fake(&library, &moved.job_id, "digest-m", "v").unwrap_err();
    assert!(error.contains("changed during the calculation"), "{error}");

    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_derived_heads"),
        0
    );
    assert_eq!(
        count(
            &library,
            "SELECT COUNT(*) FROM lidar_generation_chunks WHERE state != 'published'"
        ),
        0,
        "refused runs leave no unpublished chunk rows"
    );
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

/// Rerun revalidates stored settings against the current recipe and pins the
/// inputs' current data; what can no longer run is refused by name.
#[test]
fn rerun_refuses_settings_the_recipe_no_longer_accepts_and_missing_inputs() {
    let root = scratch_root("rerun-refusals");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, _) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    seed_published_slope(
        &library.catalogue().unwrap(),
        &source,
        "gen-old",
        "adef-a",
        "item-a",
        "dgen-a",
        None,
    );
    library
        .catalogue()
        .unwrap()
        .execute(
            "UPDATE lidar_analysis_definitions
             SET parameters_json = '[{\"key\":\"unit\",\"value\":{\"Choice\":\"radians\"}}]'",
            [],
        )
        .unwrap();
    let error = library.rerun_analysis("adef-a").unwrap_err();
    assert!(error.contains("no longer valid"), "{error}");
    library
        .catalogue()
        .unwrap()
        .execute(
            "UPDATE lidar_analysis_definitions
             SET parameters_json = '[{\"key\":\"unit\",\"value\":{\"Choice\":\"degrees\"}}]'",
            [],
        )
        .unwrap();
    library
        .catalogue()
        .unwrap()
        .execute("DELETE FROM lidar_layer_heads", [])
        .unwrap();
    let error = library.rerun_analysis("adef-a").unwrap_err();
    assert!(error.contains("no published data"), "{error}");
    let error = library.rerun_analysis("adef-missing").unwrap_err();
    assert!(error.contains("does not exist"), "{error}");
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_analysis_jobs"),
        1
    );
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

/// A job pinned to a recipe version this build does not run fails by name
/// before any input is read, and the published result stays.
#[test]
fn an_unknown_recipe_version_fails_by_name_and_keeps_the_result() {
    let root = scratch_root("unknown-recipe");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, generation) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    seed_published_slope(
        &library.catalogue().unwrap(),
        &source,
        &generation,
        "adef-f",
        "item-f",
        "dgen-f",
        None,
    );
    library
        .catalogue()
        .unwrap()
        .execute(
            "INSERT INTO lidar_analysis_jobs(id, definition_id, state, recipe_version,
                 input_generations_json, created_at, updated_at)
             VALUES('anl-future', 'adef-f', 'preparing', 7, '[]', '5', '5')",
            [],
        )
        .unwrap();
    let error = run_job(&library, "anl-future", &AtomicBool::new(false)).unwrap_err();
    assert!(error.contains("recipe version 7"), "{error}");
    assert_eq!(
        catalogue::derived_head(&library.catalogue().unwrap(), "item-f")
            .unwrap()
            .unwrap()
            .id,
        "dgen-f"
    );
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

// ---------------------------------------------------------------------------
// Freshness and the read model
// ---------------------------------------------------------------------------

/// Stale reasons name what changed: an input's head, the recipe, the tool, or
/// an input that is itself stale.
#[test]
fn stale_reasons_name_what_changed() {
    let root = scratch_root("stale");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, generation) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    let connection = library.catalogue().unwrap();
    seed_published_slope(
        &connection,
        &source,
        &generation,
        "adef-c",
        "item-c",
        "dgen-c",
        None,
    );
    seed_published_slope(
        &connection,
        &source,
        "gen-before",
        "adef-i",
        "item-i",
        "dgen-i",
        None,
    );
    seed_published_slope(
        &connection,
        &source,
        &generation,
        "adef-r",
        "item-r",
        "dgen-r",
        None,
    );
    connection
        .execute(
            "UPDATE lidar_analysis_jobs SET recipe_version = 0 WHERE definition_id = 'adef-r'",
            [],
        )
        .unwrap();
    // A result calculated from a stale result (a chain), pinned to its
    // current head.
    seed_published_slope(
        &connection,
        "item-i",
        "dgen-i",
        "adef-t",
        "item-t",
        "dgen-t",
        None,
    );

    let same_tool = installed("geolibre-cli 1.5.3");
    let mut check = FreshnessCheck::new(&connection, &same_tool);
    assert_eq!(check.of("item-c").unwrap(), Freshness::Current);
    assert_eq!(check.of(&source).unwrap(), Freshness::Current);
    assert_eq!(
        check.of("item-i").unwrap(),
        Freshness::Stale {
            reasons: vec![StaleReason::InputUpdated {
                input_key: "dem".to_string(),
                item_id: source.clone(),
            }]
        }
    );
    assert_eq!(
        check.of("item-r").unwrap(),
        Freshness::Stale {
            reasons: vec![StaleReason::RecipeUpdated { from: 0, to: 1 }]
        }
    );
    assert_eq!(
        check.of("item-t").unwrap(),
        Freshness::Stale {
            reasons: vec![StaleReason::InputStale {
                input_key: "dem".to_string(),
                item_id: "item-i".to_string(),
            }]
        }
    );

    let newer = installed("geolibre-cli 1.6.0");
    let mut check = FreshnessCheck::new(&connection, &newer);
    assert_eq!(
        check.of("item-c").unwrap(),
        Freshness::Stale {
            reasons: vec![StaleReason::ToolUpdated {
                from: "geolibre-cli 1.5.3 (aac2b743978)".to_string(),
                to: "geolibre-cli 1.6.0 (aac2b743978)".to_string(),
            }]
        }
    );
    // Without an engine nothing claims the tool changed.
    let mut check = FreshnessCheck::new(&connection, &Err("missing".to_string()));
    assert_eq!(check.of("item-c").unwrap(), Freshness::Current);
    drop(connection);
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

/// A run without a result is its operation: preparing while it runs, failed
/// with its reason otherwise, described by the inputs it was pinned to.
#[test]
fn the_snapshot_describes_an_unpublished_run_by_its_pinned_inputs() {
    let root = scratch_root("read-model");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, generation) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    let receipt = record(&library, &slope_request(&source, "percent", None));
    let snapshot = library.library_snapshot().unwrap();
    let pending = summary(&snapshot.items, &receipt.item_ids[0]);
    assert_eq!(pending.state, LidarResultState::Preparing);
    assert_eq!(pending.generation_id, None);
    assert_eq!(
        pending.name, None,
        "an unnamed result is never given a name"
    );
    let provenance = pending.provenance.as_ref().unwrap();
    assert_eq!(provenance.inputs[0].generation_id, generation);
    assert_eq!(provenance.tool, None);
    assert_eq!(pending.freshness, Freshness::Current);
    assert!(pending.offers.iter().all(|offer| matches!(
        offer.unavailable,
        Some(AnalysisUnavailable::WrongInput { .. })
    )));

    settle_unpublished(
        &library.catalogue().unwrap(),
        &receipt.job_id,
        "engine stopped",
    );
    let snapshot = library.library_snapshot().unwrap();
    let failed = summary(&snapshot.items, &receipt.item_ids[0]);
    assert_eq!(failed.state, LidarResultState::Failed);
    let run = failed.run.as_ref().unwrap();
    assert_eq!(run.state, AnalysisJobState::Failed);
    assert_eq!(run.message.as_deref(), Some("engine stopped"));

    // Retry is a rerun of the same definition with the same items.
    let retry = library_rerun(&library, &receipt.definition_id);
    assert_eq!(retry.item_ids, receipt.item_ids);
    settle_unpublished(&library.catalogue().unwrap(), &retry.job_id, "cancelled");
    let snapshot = library.library_snapshot().unwrap();
    assert_eq!(
        summary(&snapshot.items, &receipt.item_ids[0])
            .run
            .as_ref()
            .map(|run| run.state),
        Some(AnalysisJobState::Cancelled)
    );
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

/// History pages are bounded, newest first, and a cursor continues exactly.
#[test]
fn processing_history_pages_newest_first() {
    let root = scratch_root("history");
    let library = LidarLibrary::open(&root).unwrap();
    let (source, generation) = source_with_head(
        &library,
        "Ground",
        RasterQuantity::GroundElevation,
        CRS_PROJECTED_METRE,
    );
    seed_published_slope(
        &library.catalogue().unwrap(),
        &source,
        &generation,
        "adef-h",
        "item-h",
        "dgen-h",
        None,
    );
    {
        let connection = library.catalogue().unwrap();
        for index in 0..55 {
            connection
                .execute(
                    "INSERT INTO lidar_analysis_jobs(id, definition_id, state, message,
                         recipe_version, input_generations_json, created_at, updated_at)
                     VALUES(?1, 'adef-h', 'failed', 'stopped', 1, '[]', ?2, ?2)",
                    rusqlite::params![format!("anl-{index:02}"), format!("{}", 100 + index)],
                )
                .unwrap();
        }
    }
    let first = library.processing_history("adef-h", None).unwrap();
    assert_eq!(first.runs.len(), 50);
    assert_eq!(first.runs[0].job_id, "anl-54");
    let cursor = first.next_cursor.clone().expect("another page");
    let second = library.processing_history("adef-h", Some(&cursor)).unwrap();
    let ids: Vec<&str> = second.runs.iter().map(|run| run.job_id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "anl-04",
            "anl-03",
            "anl-02",
            "anl-01",
            "anl-00",
            "adef-h-job"
        ]
    );
    assert_eq!(second.next_cursor, None);
    assert_eq!(second.runs[5].outputs[0].generation_id, "dgen-h");
    assert!(
        library
            .processing_history("adef-h", Some("garbage"))
            .is_err()
    );
    assert!(library.processing_history("adef-missing", None).is_err());
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

// ---------------------------------------------------------------------------
// The lidar-native lane: Rust-engine fixtures and the pinned GeoLibre CLI
// ---------------------------------------------------------------------------

/// Publish one source into `layer_id` through the real stage and apply path.
///
/// A published source never gains a generation in production; currency
/// guards are exercised by first withdrawing the head, which leaves the old
/// generation's rows in place for the guard to see.
fn publish_source(library: &LidarLibrary, layer_id: &str, source: &Path) {
    library
        .catalogue()
        .unwrap()
        .execute(
            "DELETE FROM lidar_layer_heads WHERE layer_id = ?1",
            [layer_id],
        )
        .unwrap();
    let job_id = library.record_import_job(layer_id).unwrap();
    import::stage_and_publish(
        library,
        &job_id,
        layer_id,
        std::slice::from_ref(&source.to_path_buf()),
        &AtomicBool::new(false),
    )
    .expect("the batch publishes");
}

/// A plane rising one metre per metre eastward in EPSG:32631 (a ground
/// metre grid; Web Mercator's metres are not), with a NoData
/// hole at columns 8..10, rows 6..8.
fn plane_layer(library: &LidarLibrary, root: &Path, width: u32, height: u32) -> String {
    let values: Vec<f32> = (0..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .map(|(x, y)| {
            if (8..10).contains(&x) && (6..8).contains(&y) {
                -9999.0
            } else {
                x as f32
            }
        })
        .collect();
    let source = raster(root, "plane", &values, width, height, 0.0);
    let layer_id = library
        .create_layer("slope plane", RasterQuantity::GroundElevation, None, false)
        .unwrap();
    publish_source(library, &layer_id, &source);
    layer_id
}

fn raster(
    root: &Path,
    name: &str,
    values: &[f32],
    width: u32,
    height: u32,
    origin_x: f64,
) -> PathBuf {
    let engine = crate::services::lidar::rust_engine::RustRasterEngine;
    let raw = root.join(format!("{name}.raw"));
    import::write_f32_raw(&raw, values).unwrap();
    let source = root.join(format!("{name}.tif"));
    import::raw_to_tif(
        &engine,
        &AtomicBool::new(false),
        &raw,
        &source,
        &RasterGrid {
            width,
            height,
            geotransform: [origin_x, 1.0, 0.0, f64::from(height), 0.0, -1.0],
        },
        "EPSG:32631",
        -9999.0,
    )
    .unwrap();
    let _ = std::fs::remove_file(&raw);
    source
}

fn import_layer(library: &LidarLibrary, sources: &[PathBuf]) -> String {
    let layer_id = library
        .create_layer(
            "bounded slope",
            RasterQuantity::GroundElevation,
            None,
            false,
        )
        .unwrap();
    let job_id = library.record_import_job(&layer_id).unwrap();
    import::stage_and_publish(
        library,
        &job_id,
        &layer_id,
        sources,
        &AtomicBool::new(false),
    )
    .expect("the batch publishes");
    layer_id
}

/// `z = 40 sin(2πx/90) + 16 cos(2πy/54)` on a 1 m projected lattice, with a
/// NoData hole where both `x` and `y + 600` fall in `hole`.
fn curved_member(root: &Path, width: u32, height: u32, hole: std::ops::Range<u32>) -> PathBuf {
    let values: Vec<f32> = (0..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .map(|(x, y)| {
            if hole.contains(&x) && hole.contains(&(y + 600)) {
                -9999.0
            } else {
                curved_height(f64::from(x), f64::from(y)) as f32
            }
        })
        .collect();
    raster(root, "curved", &values, width, height, 0.0)
}

fn curved_height(x: f64, y: f64) -> f64 {
    40.0 * (std::f64::consts::TAU * x / 90.0).sin()
        + 16.0 * (std::f64::consts::TAU * y / 54.0).cos()
}

/// Analytic gradient magnitude (rise over run) at a cell centre.
fn curved_gradient(x: f64, y: f64) -> f64 {
    let dx = 40.0 * std::f64::consts::TAU / 90.0 * (std::f64::consts::TAU * x / 90.0).cos();
    let dy = -16.0 * std::f64::consts::TAU / 54.0 * (std::f64::consts::TAU * y / 54.0).sin();
    dx.hypot(dy)
}

/// Read a window of a derived item's head: values, validity and quality.
fn result_window(
    library: &LidarLibrary,
    item_id: &str,
    window: generation::LatticeWindow,
) -> (Vec<f32>, Vec<u8>, Vec<u8>) {
    let connection = library.catalogue().unwrap();
    let head = catalogue::derived_head(&connection, item_id)
        .unwrap()
        .unwrap();
    let manifest = read_derived_manifest(&head.manifest_json).unwrap();
    let paths = &library.inner.paths;
    let cancel = AtomicBool::new(false);
    let values = generation::read_persisted_window(
        &generation::persisted_chunks(&connection, paths, &head.id, generation::RESULT_ROLE)
            .unwrap(),
        &manifest.grid,
        window,
        &cancel,
    )
    .unwrap();
    let quality = generation::read_quality_chunks_window(
        &generation::persisted_chunks(&connection, paths, &head.id, generation::QUALITY_ROLE)
            .unwrap(),
        &manifest.grid,
        window,
        &cancel,
    )
    .unwrap();
    (
        values.samples,
        values.valid,
        quality
            .samples
            .iter()
            .map(|value| u8::from(*value == 1.0))
            .collect(),
    )
}

/// The WGS84 point of a fixture cell centre, through the CRS authority,
/// which `rust_engine::crs` tests hold to PROJ.
fn lon_lat(easting: f64, northing: f64) -> (f64, f64) {
    use crate::services::lidar::engine::RasterEngine;
    crate::services::lidar::rust_engine::RustRasterEngine
        .transform_points(
            "EPSG:32631",
            "EPSG:4326",
            &[(easting, northing)],
            &AtomicBool::new(false),
        )
        .unwrap()[0]
        .unwrap()
}

/// One target as the frontend aims it.
fn target(kind: LibraryItemRole, entity_id: &str, generation_id: &str) -> LidarSampleTarget {
    LidarSampleTarget {
        kind,
        entity_id: entity_id.to_string(),
        expected_generation_id: generation_id.to_string(),
    }
}

/// The WGS84 point of a fixture cell centre, as the sampler takes it.
fn point(easting: f64, northing: f64) -> [f64; 2] {
    let (longitude, latitude) = lon_lat(easting, northing);
    [longitude, latitude]
}

/// Sample through the batched sampler and return each target's series.
fn sample(
    library: &LidarLibrary,
    targets: Vec<LidarSampleTarget>,
    points: Vec<[f64; 2]>,
) -> Vec<LidarSampleSeries> {
    library
        .sample_points(&LidarSamplePointsRequest { targets, points })
        .expect("the batch samples")
}

/// One target's values, or a panic naming what came back instead.
fn values(series: &LidarSampleSeries) -> Vec<Option<f64>> {
    match series {
        LidarSampleSeries::Values { values } => values.clone(),
        other => panic!("expected values, got {other:?}"),
    }
}

fn unavailable(reason: LidarSampleUnavailableReason) -> LidarSampleSeries {
    LidarSampleSeries::Unavailable { reason }
}

fn source_head(library: &LidarLibrary, layer_id: &str) -> String {
    catalogue::head_generation(&library.catalogue().unwrap(), layer_id)
        .unwrap()
        .unwrap()
        .id
}

/// A published result over `source_layer` whose chunks the caller writes.
fn chunk_result(library: &LidarLibrary, source_layer: &str, item_id: &str) -> String {
    let generation_id = format!("dgen-{item_id}");
    let source_generation = source_head(library, source_layer);
    seed_published_slope(
        &library.catalogue().unwrap(),
        source_layer,
        &source_generation,
        &format!("adef-{item_id}"),
        item_id,
        &generation_id,
        None,
    );
    generation_id
}

/// One request answers mixed targets in target order: a source and a result
/// read their own cells, a head that moved answers stale and an absent item
/// missing, and a point off a target's data reads `None` for that target only.
#[test]
fn one_batch_answers_mixed_targets_in_order() {
    let root = scratch_root("batch-mixed");
    let library = LidarLibrary::open(&root).unwrap();
    let plane = plane_layer(&library, &root, 16, 16);
    let plane_generation = source_head(&library, &plane);
    let result = chunk_result(&library, &plane, "item-chunks");
    // The result's lattice starts at (0, 0) with 1 m cells running south.
    let cells: Vec<f32> = (0..16).map(|index| 100.0 + index as f32).collect();
    generation::publish_test_chunk(&library, &result, 0, 0, 4, 4, &cells);

    let series = sample(
        &library,
        vec![
            target(LibraryItemRole::Source, &plane, &plane_generation),
            target(LibraryItemRole::Derived, "item-chunks", &result),
            target(LibraryItemRole::Source, &plane, "gen-before"),
            target(LibraryItemRole::Derived, "item-gone", "dgen-gone"),
        ],
        vec![point(5.5, 10.5), point(1.5, -2.5), point(500.5, 500.5)],
    );
    assert_eq!(series.len(), 4);
    assert_eq!(values(&series[0]), vec![Some(5.0), None, None]);
    // Cell (1, 2) of the 4 × 4 chunk.
    assert_eq!(values(&series[1]), vec![None, Some(109.0), None]);
    assert_eq!(
        series[2],
        unavailable(LidarSampleUnavailableReason::StaleGeneration)
    );
    assert_eq!(
        series[3],
        unavailable(LidarSampleUnavailableReason::MissingGeneration)
    );
}

/// A target that cannot be read answers `Unavailable` on its own row instead of
/// failing the batch: a result whose chunk file is corrupt on disk and one whose
/// CRS the engine rejects sit between healthy targets that still read values.
#[test]
fn an_unreadable_target_answers_unavailable_and_the_batch_still_reads() {
    let root = scratch_root("batch-unreadable");
    let library = LidarLibrary::open(&root).unwrap();
    let plane = plane_layer(&library, &root, 16, 16);
    let plane_generation = source_head(&library, &plane);
    let healthy = chunk_result(&library, &plane, "item-healthy");
    let cells: Vec<f32> = (0..16).map(|index| 100.0 + index as f32).collect();
    generation::publish_test_chunk(&library, &healthy, 0, 0, 4, 4, &cells);
    let corrupt = chunk_result(&library, &plane, "item-corrupt");
    // Other values than the healthy chunk's, since chunk files are content addressed.
    let other: Vec<f32> = cells.iter().map(|value| value + 1.0).collect();
    let asset = generation::publish_test_chunk(&library, &corrupt, 0, 0, 4, 4, &other);
    std::fs::write(&asset.path, b"not a tiff").unwrap();
    let foreign = chunk_result(&library, &plane, "item-foreign-crs");
    library
        .catalogue()
        .unwrap()
        .execute(
            "UPDATE lidar_derived_generations SET manifest_json = replace(manifest_json, 'EPSG:32631', 'not-a-crs') WHERE id = ?1",
            [&foreign],
        )
        .unwrap();

    let series = sample(
        &library,
        vec![
            target(LibraryItemRole::Source, &plane, &plane_generation),
            target(LibraryItemRole::Derived, "item-corrupt", &corrupt),
            target(LibraryItemRole::Derived, "item-foreign-crs", &foreign),
            target(LibraryItemRole::Derived, "item-healthy", &healthy),
        ],
        vec![point(5.5, 10.5), point(1.5, -2.5)],
    );
    assert_eq!(values(&series[0]), vec![Some(5.0), None]);
    assert_eq!(
        series[1],
        unavailable(LidarSampleUnavailableReason::UnsupportedInput)
    );
    assert_eq!(
        series[2],
        unavailable(LidarSampleUnavailableReason::TransformFailed)
    );
    assert_eq!(values(&series[3]), vec![None, Some(109.0)]);
}

/// Row values re-sample on every pointer move, so a target that stays
/// unreadable is reported once per generation, not once per request.
#[test]
fn an_unreadable_target_is_reported_once_however_often_it_is_sampled() {
    #[derive(Clone, Default)]
    struct Captured(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
    impl std::io::Write for Captured {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let root = scratch_root("batch-reported-once");
    let library = LidarLibrary::open(&root).unwrap();
    let plane = plane_layer(&library, &root, 16, 16);
    let corrupt = chunk_result(&library, &plane, "item-corrupt-once");
    let cells: Vec<f32> = (0..16).map(|index| 300.0 + index as f32).collect();
    let asset = generation::publish_test_chunk(&library, &corrupt, 0, 0, 4, 4, &cells);
    std::fs::write(&asset.path, b"not a tiff").unwrap();
    let aimed = target(LibraryItemRole::Derived, "item-corrupt-once", &corrupt);

    let log = Captured::default();
    let subscriber = tracing_subscriber::fmt()
        .with_writer({
            let log = log.clone();
            move || log.clone()
        })
        .with_ansi(false)
        .with_max_level(tracing::Level::WARN)
        .finish();
    tracing::subscriber::with_default(subscriber, || {
        for column in 0..4 {
            let series = sample(
                &library,
                vec![aimed.clone()],
                vec![point(f64::from(column) + 0.5, -1.5)],
            );
            assert_eq!(
                series[0],
                unavailable(LidarSampleUnavailableReason::UnsupportedInput)
            );
        }
    });
    let written = String::from_utf8(log.0.lock().unwrap().clone()).unwrap();
    assert_eq!(
        written
            .matches("a LiDAR sample target could not be read")
            .count(),
        1,
        "{written}"
    );
}

/// N points in one request equal N one-point requests and the analytic plane:
/// the cell's column inside the plane, `None` in its NoData hole, outside it
/// and at a point that is not a number.
#[test]
fn n_points_equal_n_single_samples_and_the_analytic_plane() {
    let root = scratch_root("batch-single");
    let library = LidarLibrary::open(&root).unwrap();
    let plane = plane_layer(&library, &root, 16, 16);
    let aimed = target(
        LibraryItemRole::Source,
        &plane,
        &source_head(&library, &plane),
    );
    let mut points = Vec::new();
    let mut expected = Vec::new();
    for row in -1..17 {
        for column in -1..17 {
            points.push(point(f64::from(column) + 0.5, 16.0 - f64::from(row) - 0.5));
            let inside = (0..16).contains(&column) && (0..16).contains(&row);
            let hole = (8..10).contains(&column) && (6..8).contains(&row);
            expected.push((inside && !hole).then_some(f64::from(column)));
        }
    }
    points.push([f64::NAN, 0.0]);
    expected.push(None);

    let batch = values(&sample(&library, vec![aimed.clone()], points.clone())[0]);
    assert_eq!(batch, expected);
    let singles: Vec<Option<f64>> = points
        .iter()
        .map(|single| values(&sample(&library, vec![aimed.clone()], vec![*single])[0])[0])
        .collect();
    assert_eq!(singles, batch);
}

/// The backend serialises sampling (architecture review finding 3): three
/// concurrent `lidar_sample_points` calls through the real command and
/// executor take at most one of Local's two running slots, so a save on Local
/// is admitted and runs while sampling is held, and every call then answers.
#[test]
fn concurrent_samples_take_one_local_slot_and_a_save_still_runs() {
    use crate::native_operation::{NativeOperationClass, NativeOperationExecutor};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};
    use tauri::Manager;

    let root = scratch_root("sampling-turn");
    let library = LidarLibrary::open(&root).unwrap();
    let plane = plane_layer(&library, &root, 16, 16);
    let aimed = target(
        LibraryItemRole::Source,
        &plane,
        &source_head(&library, &plane),
    );
    let executor = NativeOperationExecutor::production();
    let app = tauri::test::mock_builder()
        .manage(library.clone())
        .manage(executor.clone())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();

    let running = Arc::new(AtomicUsize::new(0));
    let most = Arc::new(AtomicUsize::new(0));
    let released = Arc::new((Mutex::new(false), Condvar::new()));
    let _gate = acceptance_hooks::on_sample_work(&library, {
        let (running, most, released) = (running.clone(), most.clone(), released.clone());
        Arc::new(move || {
            let now = running.fetch_add(1, Ordering::SeqCst) + 1;
            most.fetch_max(now, Ordering::SeqCst);
            let (lock, wake) = &*released;
            let mut open = lock.lock().unwrap();
            while !*open {
                open = wake.wait(open).unwrap();
            }
            running.fetch_sub(1, Ordering::SeqCst);
        })
    });
    let calls: Vec<_> = (0..3)
        .map(|_| {
            let handle = app.handle().clone();
            let request = LidarSamplePointsRequest {
                targets: vec![aimed.clone()],
                points: vec![point(5.5, 10.5)],
            };
            std::thread::spawn(move || {
                tauri::async_runtime::block_on(crate::commands::lidar::lidar_sample_points(
                    handle.state(),
                    handle.state(),
                    request,
                ))
            })
        })
        .collect();
    let deadline = Instant::now() + Duration::from_secs(10);
    while running.load(Ordering::SeqCst) == 0 {
        assert!(Instant::now() < deadline, "no sampling work started");
        std::thread::sleep(Duration::from_millis(5));
    }
    // Give a second sampler every chance to start beside the first.
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(running.load(Ordering::SeqCst), 1);

    let (saved, save_done) = std::sync::mpsc::channel();
    let save_executor = executor.clone();
    std::thread::spawn(move || {
        saved
            .send(tauri::async_runtime::block_on(save_executor.run(
                NativeOperationClass::Local,
                "design save",
                || Ok(7),
            )))
            .unwrap();
    });
    let save = save_done.recv_timeout(Duration::from_secs(5));

    {
        let (lock, wake) = &*released;
        *lock.lock().unwrap() = true;
        wake.notify_all();
    }
    assert_eq!(save, Ok(Ok(7)), "a save runs while sampling is held");
    for call in calls {
        let series = call.join().unwrap().expect("each sample answers");
        assert_eq!(values(&series[0]), vec![Some(5.0)]);
    }
    assert_eq!(most.load(Ordering::SeqCst), 1);
}

/// Raster work never stalls sampling (held finding 5): with a heavy job (an
/// import or an analysis) and a display plan each running on the class raster
/// work uses, a `lidar_sample_points` call through the real command and
/// executor still answers within its budget, so row values, the pin and the
/// profile keep reading while both run.
#[test]
fn sampling_answers_while_a_heavy_job_and_a_display_plan_run() {
    use crate::native_operation::NativeOperationExecutor;
    use crate::services::lidar::RASTER_WORK;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};
    use tauri::Manager;

    let root = scratch_root("sampling-beside-raster-work");
    let library = LidarLibrary::open(&root).unwrap();
    let plane = plane_layer(&library, &root, 16, 16);
    let aimed = target(
        LibraryItemRole::Source,
        &plane,
        &source_head(&library, &plane),
    );
    let executor = NativeOperationExecutor::production();
    let app = tauri::test::mock_builder()
        .manage(library.clone())
        .manage(executor.clone())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();

    let running = Arc::new(AtomicUsize::new(0));
    let released = Arc::new((Mutex::new(false), Condvar::new()));
    let held: Vec<_> = ["lidar analysis", "lidar display preparation"]
        .into_iter()
        .map(|label| {
            let (executor, running, released) =
                (executor.clone(), running.clone(), released.clone());
            std::thread::spawn(move || {
                tauri::async_runtime::block_on(executor.run(RASTER_WORK, label, move || {
                    running.fetch_add(1, Ordering::SeqCst);
                    let (lock, wake) = &*released;
                    let mut open = lock.lock().unwrap();
                    while !*open {
                        open = wake.wait(open).unwrap();
                    }
                    Ok(())
                }))
            })
        })
        .collect();
    let deadline = Instant::now() + Duration::from_secs(10);
    while running.load(Ordering::SeqCst) < 2 {
        assert!(Instant::now() < deadline, "the raster work never started");
        std::thread::sleep(Duration::from_millis(5));
    }

    let (answered, answer) = std::sync::mpsc::channel();
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let request = LidarSamplePointsRequest {
            targets: vec![aimed],
            points: vec![point(5.5, 10.5)],
        };
        // The receiver is gone once the budget ran out; the assertion below says so.
        let _ = answered.send(tauri::async_runtime::block_on(
            crate::commands::lidar::lidar_sample_points(handle.state(), handle.state(), request),
        ));
    });
    let sample = answer.recv_timeout(Duration::from_secs(2));

    {
        let (lock, wake) = &*released;
        *lock.lock().unwrap() = true;
        wake.notify_all();
    }
    for work in held {
        work.join().unwrap().unwrap();
    }
    let series = sample
        .expect("a sample answers while raster work holds its slots")
        .expect("the sample succeeds");
    assert_eq!(values(&series[0]), vec![Some(5.0)]);
}

/// A diagonal profile across a result's chunk corner reads every cell, over
/// more than one 256-cell run: chunk (0, 0) holds its column, chunk (1, 1)
/// 2000 plus its own column.
#[test]
fn a_diagonal_across_a_chunk_corner_reads_every_cell() {
    let root = scratch_root("batch-diagonal");
    let library = LidarLibrary::open(&root).unwrap();
    let plane = plane_layer(&library, &root, 16, 16);
    let result = chunk_result(&library, &plane, "item-diagonal");
    let side = generation::CHUNK_SIDE as u32;
    let near: Vec<f32> = (0..side * side)
        .map(|index| (index % side) as f32)
        .collect();
    generation::publish_test_chunk(&library, &result, 0, 0, side, side, &near);
    let far: Vec<f32> = (0..200 * 200)
        .map(|index| 2000.0 + (index % 200) as f32)
        .collect();
    generation::publish_test_chunk(&library, &result, 1, 1, 200, 200, &far);

    let steps: Vec<i64> = (900..1200).collect();
    let points = steps
        .iter()
        .map(|&cell| point(cell as f64 + 0.5, -(cell as f64) - 0.5))
        .collect();
    let read = values(
        &sample(
            &library,
            vec![target(LibraryItemRole::Derived, "item-diagonal", &result)],
            points,
        )[0],
    );
    let expected: Vec<Option<f64>> = steps
        .iter()
        .map(|&cell| {
            Some(if cell < 1024 {
                cell as f64
            } else {
                2000.0 + (cell - 1024) as f64
            })
        })
        .collect();
    assert_eq!(read, expected);
}

/// A published slope is readable through the sampler in the units it was
/// computed in. The plane rises one metre per metre, so its slope is 45° and
/// 100 % wherever it has neighbours.
#[test]
#[ignore = "requires the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
fn the_sampler_reads_a_published_slope_in_both_units() {
    let root = scratch_root("inspection");
    let library = LidarLibrary::open(&root).unwrap();
    let layer_id = plane_layer(&library, &root, 16, 16);
    let mut observed = Vec::new();
    for (unit, expected) in [("degrees", 45.0_f64), ("percent", 100.0_f64)] {
        let receipt = run_slope(&library, &layer_id, unit, None);
        let item_id = &receipt.item_ids[0];
        let generation_id = catalogue::derived_head(&library.catalogue().unwrap(), item_id)
            .unwrap()
            .unwrap()
            .id;
        let read = values(
            &sample(
                &library,
                vec![target(LibraryItemRole::Derived, item_id, &generation_id)],
                vec![point(5.5, 16.0 - 5.5)],
            )[0],
        );
        let value = read[0].unwrap_or_else(|| panic!("cell (5, 5) must hold a slope"));
        assert!((value - expected).abs() < 0.5, "{unit}: {value}");
        observed.push(value);
    }
    assert!((observed[1] - 100.0 * observed[0].to_radians().tan()).abs() < 0.5);
    drop(library);
    let _ = std::fs::remove_dir_all(root);
}

/// `terrain.slope@1` runs the pinned CLI window by window: it matches the
/// analytic surface on both sides of a 1024-cell chunk seam, keeps NoData
/// centres invalid, marks quality only where the whole 5×5 input was valid,
/// records what ran, and a second analysis is a separate result.
#[test]
#[ignore = "requires the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
fn geolibre_slope_matches_the_analytic_surface_across_a_chunk_seam() {
    let root = scratch_root("seam");
    let library = LidarLibrary::open(&root).unwrap();
    let (width, height) = (1040u32, 12u32);
    let layer_id = import_layer(&library, &[curved_member(&root, width, height, 600..603)]);
    let degrees = run_slope(&library, &layer_id, "degrees", Some("Steepness"));
    let read = |item: &str| {
        let half = width / 2;
        let left = result_window(
            &library,
            item,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: half,
                height,
            },
        );
        let right = result_window(
            &library,
            item,
            generation::LatticeWindow {
                x: i64::from(half),
                y: 0,
                width: half,
                height,
            },
        );
        let join = |l: &[u8], r: &[u8]| -> Vec<u8> {
            (0..height as usize)
                .flat_map(|row| {
                    let span = row * half as usize..(row + 1) * half as usize;
                    l[span.clone()]
                        .iter()
                        .chain(&r[span])
                        .copied()
                        .collect::<Vec<_>>()
                })
                .collect()
        };
        let values: Vec<f32> = (0..height as usize)
            .flat_map(|row| {
                let span = row * half as usize..(row + 1) * half as usize;
                left.0[span.clone()]
                    .iter()
                    .chain(&right.0[span])
                    .copied()
                    .collect::<Vec<_>>()
            })
            .collect();
        (values, join(&left.1, &right.1), join(&left.2, &right.2))
    };
    let (values, valid, quality) = read(&degrees.item_ids[0]);
    let near_hole = |x: u32, y: u32| (598..605).contains(&x) && y < 5;
    let mut compared = 0usize;
    for y in 0..height {
        for x in 0..width {
            let index = (y * width + x) as usize;
            if (600..603).contains(&x) && y < 3 {
                assert_eq!(valid[index], 0, "a NoData centre stays invalid at {x},{y}");
                continue;
            }
            assert_eq!(valid[index], 1, "a valid centre has a value at {x},{y}");
            let interior = (2..height - 2).contains(&y) && (2..width - 2).contains(&x);
            let expected_quality = interior && !near_hole(x, y);
            assert_eq!(
                quality[index],
                u8::from(expected_quality),
                "quality at {x},{y}"
            );
            if expected_quality {
                let expected = curved_gradient(f64::from(x), f64::from(y))
                    .atan()
                    .to_degrees();
                let error = (f64::from(values[index]) - expected).abs();
                assert!(error < 0.01, "{x},{y}: {} vs {expected}", values[index]);
                compared += 1;
            }
        }
    }
    assert!(
        compared > 8_000,
        "the comparison covers the surface ({compared} cells)"
    );
    for x in 1020..1028 {
        assert_eq!(
            quality[(5 * width + x) as usize],
            1,
            "the seam at {x} is interior"
        );
    }

    let snapshot = library.library_snapshot().unwrap();
    let published = summary(&snapshot.items, &degrees.item_ids[0]);
    let provenance = published.provenance.as_ref().unwrap();
    assert_eq!(
        (provenance.analysis_id.as_str(), provenance.recipe_version),
        ("terrain.slope", 1)
    );
    let tool = provenance.tool.as_ref().expect("the tool is recorded");
    assert!(tool.version.starts_with("geolibre-cli "), "{tool:?}");
    assert_eq!(
        tool.revision,
        crate::services::lidar::geolibre::GEOLIBRE_REVISION
    );
    assert_eq!(tool.tools, ["slope"]);
    assert_eq!(published.freshness, Freshness::Current);

    let percent = run_slope(&library, &layer_id, "percent", Some("Steepness"));
    assert_ne!(
        percent.item_ids, degrees.item_ids,
        "a second analysis is a separate result"
    );
    let (values, _, _) = read(&percent.item_ids[0]);
    let (x, y) = (1024u32, 6u32);
    let expected = 100.0 * curved_gradient(f64::from(x), f64::from(y));
    let got = f64::from(values[(y * width + x) as usize]);
    assert!((got - expected).abs() < 0.05, "percent {got} vs {expected}");
    let snapshot = library.library_snapshot().unwrap();
    assert_eq!(
        snapshot
            .items
            .iter()
            .filter(|item| item.role == LibraryItemRole::Derived && item.generation_id.is_some())
            .count(),
        2,
        "the first result is still there"
    );
    drop(library);
    let _ = std::fs::remove_dir_all(&root);
}

/// Processes currently running one executable, read from `/proc`.
#[cfg(target_os = "linux")]
fn running(executable: &Path) -> usize {
    let wanted = std::fs::canonicalize(executable).unwrap();
    std::fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| std::fs::read_link(entry.path().join("exe")).is_ok_and(|exe| exe == wanted))
        .count()
}

/// Cancelling while the GeoLibre child computes a window kills and reaps that
/// child, publishes nothing and leaves no scratch behind.
#[cfg(target_os = "linux")]
#[test]
#[ignore = "requires the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
fn cancelling_a_geolibre_run_kills_its_child_and_publishes_nothing() {
    let root = scratch_root("cancel-child");
    let library = LidarLibrary::open(&root).unwrap();
    let tool = library
        .inner
        .geolibre
        .discover()
        .expect("GeoLibre CLI")
        .path;
    let layer_id = import_layer(&library, &[curved_member(&root, 1024, 1024, 0..0)]);
    let receipt = record(&library, &slope_request(&layer_id, "degrees", None));
    let cancel = AtomicBool::new(false);
    // A scoped watcher cancels once the child is running; the scope joins it.
    let error = std::thread::scope(|scope| {
        scope.spawn(|| {
            let started = std::time::Instant::now();
            while running(&tool) == 0 {
                assert!(
                    started.elapsed().as_secs() < 60,
                    "the GeoLibre child never started"
                );
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        run_job(&library, &receipt.job_id, &cancel).expect_err("a cancelled run does not publish")
    });
    assert_eq!(error, "cancelled");
    assert_eq!(running(&tool), 0, "the GeoLibre child was reaped");
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_derived_heads"),
        0
    );
    assert!(
        !library
            .inner
            .paths
            .analysis_scratch_dir(&receipt.job_id)
            .exists()
    );
    drop(library);
    let _ = std::fs::remove_dir_all(&root);
}

/// A run cancelled before its first window publishes nothing and leaves no
/// scratch or unpublished rows.
#[test]
#[ignore = "requires the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
fn a_cancelled_run_publishes_nothing() {
    let root = scratch_root("cancel-early");
    let library = LidarLibrary::open(&root).unwrap();
    let layer_id = import_layer(
        &library,
        &[raster(&root, "cancel", &vec![1.0; 192], 16, 12, 0.0)],
    );
    let receipt = record(&library, &slope_request(&layer_id, "degrees", None));
    let error = run_job(&library, &receipt.job_id, &AtomicBool::new(true)).unwrap_err();
    assert_eq!(error, "cancelled");
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM lidar_derived_heads"),
        0
    );
    assert_eq!(
        count(
            &library,
            "SELECT COUNT(*) FROM lidar_generation_chunks WHERE state != 'published'"
        ),
        0
    );
    assert!(
        !library
            .inner
            .paths
            .analysis_scratch_dir(&receipt.job_id)
            .exists()
    );
    drop(library);
    let _ = std::fs::remove_dir_all(&root);
}

/// The sampler never answers from a generation the caller did not aim at, even
/// when the head moves while the values are being read.
#[test]
fn acceptance_sampling_rejects_head_changes_during_value_and_nodata_reads() {
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
            (8.5, 9.5)
        } else {
            (5.5, 10.5)
        };
        let aimed = target(LibraryItemRole::Source, &layer, &old.id);
        let request = || sample(&library, vec![aimed.clone()], vec![point(x, y)]);
        let healthy = values(&request()[0]);
        if mode == "value" {
            assert_eq!(healthy, vec![Some(5.0)]);
        } else {
            assert_eq!(healthy, vec![None]);
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
            acceptance_hooks::on_target(change)
        } else {
            acceptance_hooks::on_read(change)
        };
        let raced = request();
        assert!(reached.get(), "the fault boundary must be exercised");
        assert_eq!(
            raced,
            vec![unavailable(LidarSampleUnavailableReason::StaleGeneration)],
            "{mode}"
        );
        drop(guard);
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
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

/// A refresh that fails mid-write keeps the published result and its bytes;
/// running the job again without the fault refreshes the same item in place.
#[test]
#[ignore = "requires the pinned GeoLibre CLI; generated two-block plane, no private fixtures"]
fn acceptance_a_failed_refresh_keeps_the_published_result() {
    for fault in ["capacity", "write"] {
        let root = scratch_root(&format!("acceptance-midwrite-{fault}"));
        let library = LidarLibrary::open(&root).unwrap();
        // Two occupied chunks; the fault happens after the first has output.
        let layer = plane_layer(&library, &root, 1030, 16);
        let first = run_slope(&library, &layer, "degrees", None);
        let item_id = first.item_ids[0].clone();
        let head = catalogue::derived_head(&library.catalogue().unwrap(), &item_id)
            .unwrap()
            .unwrap();
        let mut accepted_bytes = Vec::new();
        files(&root.join("lidar/assets"), &mut accepted_bytes);
        assert!(!accepted_bytes.is_empty());

        let refresh = library_rerun(&library, &first.definition_id);
        let reached = std::rc::Rc::new(std::cell::Cell::new(false));
        let observed = reached.clone();
        let guard = acceptance_hooks::on_block(Box::new(move |scratch, has_output| {
            assert!(has_output, "the fault must follow completed output");
            observed.set(true);
            if fault == "capacity" {
                paths::capacity_probe::set(Some(0));
            } else {
                // A real filesystem create failure in the next window.
                std::fs::create_dir(scratch.join("window-1-0.raw")).unwrap();
            }
        }));
        let error = run_job(&library, &refresh.job_id, &AtomicBool::new(false))
            .expect_err("a mid-write fault aborts");
        assert!(reached.get());
        if fault == "capacity" {
            assert!(error.contains("free"), "{error}");
        } else {
            assert!(error.contains("Failed to create raw buffer"), "{error}");
        }
        drop(guard);
        let after = catalogue::derived_head(&library.catalogue().unwrap(), &item_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            after.id, head.id,
            "a failed refresh keeps the published head"
        );
        for (path, bytes) in &accepted_bytes {
            assert_eq!(&std::fs::read(path).unwrap(), bytes);
        }
        assert!(
            !library
                .inner
                .paths
                .analysis_scratch_dir(&refresh.job_id)
                .exists()
        );

        let outcome = run_job(&library, &refresh.job_id, &AtomicBool::new(false)).unwrap();
        assert!(outcome.coverage_cells > 0, "{}", outcome.summary());
        let next = catalogue::derived_head(&library.catalogue().unwrap(), &item_id)
            .unwrap()
            .unwrap();
        assert_ne!(next.id, head.id, "the refresh replaced the head in place");
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }
}

/// Through the real commands: create two results, refresh one in place, and
/// retry a failed run with its saved identity.
#[test]
#[ignore = "requires the pinned GeoLibre CLI; real published plane and Tauri-managed command state"]
fn acceptance_rerun_command_refreshes_in_place_and_retries_with_saved_identity() {
    use crate::native_operation::NativeOperationExecutor;
    use tauri::Manager;

    fn await_job(library: &LidarLibrary, job: &str) -> String {
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
            if state != "preparing" && !library.inner.cancel_flags.lock().unwrap().contains_key(job)
            {
                return state;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "job {job} did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    let root = scratch_root("acceptance-rerun-command");
    let library = LidarLibrary::open(&root).unwrap();
    let executor = NativeOperationExecutor::production();
    library.attach_executor(executor.clone());
    let app = tauri::test::mock_builder()
        .manage(library.clone())
        .manage(executor)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let layer = plane_layer(&library, &root, 16, 16);
    let create = |unit: &str, name: &str| {
        tauri::async_runtime::block_on(crate::commands::lidar::lidar_create_analysis(
            app.state(),
            app.state(),
            slope_request(&layer, unit, Some(name)),
        ))
        .unwrap()
    };
    let rerun = |definition: &str| {
        tauri::async_runtime::block_on(crate::commands::lidar::lidar_rerun_analysis(
            app.state(),
            app.state(),
            definition.to_string(),
        ))
    };
    let north = create("degrees", "North slope");
    let south = create("percent", "South slope");
    assert_eq!(await_job(&library, &north.job_id), "complete");
    assert_eq!(await_job(&library, &south.job_id), "complete");
    let head = |item: &str| {
        catalogue::derived_head(&library.catalogue().unwrap(), item)
            .unwrap()
            .unwrap()
            .id
    };
    let north_first = head(&north.item_ids[0]);
    let south_first = head(&south.item_ids[0]);
    let read = values(
        &sample(
            &library,
            vec![target(
                LibraryItemRole::Derived,
                &south.item_ids[0],
                &south_first,
            )],
            vec![point(5.5, 10.5)],
        )[0],
    );
    assert!(
        matches!(read[0], Some(value) if (value - 100.0).abs() < 0.01),
        "{read:?}"
    );

    // Refresh updates the item in place; the other result is untouched.
    let refreshed = rerun(&south.definition_id).unwrap();
    assert_eq!(refreshed.item_ids, south.item_ids);
    assert_eq!(await_job(&library, &refreshed.job_id), "complete");
    assert_ne!(head(&south.item_ids[0]), south_first);
    assert_eq!(head(&north.item_ids[0]), north_first);
    let snapshot = library.library_snapshot().unwrap();
    let south_item = summary(&snapshot.items, &south.item_ids[0]);
    assert_eq!(south_item.name.as_deref(), Some("South slope"));
    assert_eq!(south_item.units, "%");
    let history = library
        .processing_history(&south.definition_id, None)
        .unwrap();
    assert_eq!(
        history.runs.len(),
        2,
        "the earlier run stays in the history"
    );

    // A failed run retries through the same command with its saved identity.
    library
        .catalogue()
        .unwrap()
        .execute(
            "UPDATE lidar_analysis_jobs SET state = 'failed', message = 'engine stopped'
             WHERE id = ?1",
            [&north.job_id],
        )
        .unwrap();
    let retried = rerun(&north.definition_id).unwrap();
    assert_eq!(retried.item_ids, north.item_ids);
    assert_eq!(await_job(&library, &retried.job_id), "complete");
    drop(app);
    drop(library);
    std::fs::remove_dir_all(root).unwrap();
}
