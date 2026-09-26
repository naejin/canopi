//! Registry, definitions, runs, publication, refresh and freshness.
//!
//! The first half needs no engine: catalogue rows stand in for raster data.
//! The ignored half runs the pinned GeoLibre CLI and GDAL on generated
//! analytic surfaces (the `lidar-native` lane).

use super::test_support::{record, run_slope, seed_published_slope, slope_request};
use super::*;
use crate::services::lidar::import::{self, read_generation_manifest};
use crate::services::lidar::{acceptance_hooks, generation, paths};
use common_types::library::{
    AnalysisInputBinding, LibraryItemRole, LibraryItemSummary, ParamValue,
};
use common_types::lidar::{
    LidarResultState, LidarSampleOutcome, LidarSampleRequest, LidarSampleUnavailableReason,
};
use std::path::PathBuf;

fn scratch_root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(new_id(&format!("canopi-analyses-{label}")));
    std::fs::create_dir_all(&root).expect("scratch root");
    root
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

#[test]
fn crs_classes_are_read_from_the_stored_wkt() {
    let lambert = r#"PROJCRS["RGF93 v1 / Lambert-93",BASEGEOGCRS["RGF93 v1",ANGLEUNIT["degree",0.0174532925199433]],CS[Cartesian,2],LENGTHUNIT["metre",1]]"#;
    assert_eq!(crs_class(lambert), CRS_PROJECTED_METRE);
    assert_eq!(
        crs_class(r#"PROJCS["NAD27 / feet",UNIT["US survey foot",0.3048006]]"#),
        "projected-other"
    );
    assert_eq!(
        crs_class(r#"GEOGCRS["WGS 84",ANGLEUNIT["degree",0.0174532925199433]]"#),
        "geographic"
    );
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
            crs_wkt: "EPSG:3857".to_string(),
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
        crs_wkt: "EPSG:3857".to_string(),
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
// The lidar-native lane: GDAL and the pinned GeoLibre CLI
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

/// A plane rising one metre per metre eastward in EPSG:3857, with a NoData
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
    let engine = crate::services::lidar::engine::GdalEngine::new();
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
        "EPSG:3857",
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

/// The WGS84 point of a Web Mercator cell centre, derived independently of the
/// transform under test.
fn lon_lat(easting: f64, northing: f64) -> (f64, f64) {
    const R: f64 = 6_378_137.0;
    (
        (easting / R).to_degrees(),
        (2.0 * (northing / R).exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees(),
    )
}

/// A published slope is readable through inspection in the units it was
/// computed in. The plane rises one metre per metre, so its slope is 45° and
/// 100 % wherever it has neighbours.
#[test]
#[ignore = "requires GDAL and the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
fn inspection_reads_a_published_slope_in_both_units() {
    let root = scratch_root("inspection");
    let library = LidarLibrary::open(&root).unwrap();
    let layer_id = plane_layer(&library, &root, 16, 16);
    let (longitude, latitude) = lon_lat(5.5, 16.0 - 5.5);
    let mut observed = Vec::new();
    for (unit, expected, units) in [("degrees", 45.0_f64, "°"), ("percent", 100.0_f64, "%")] {
        let receipt = run_slope(&library, &layer_id, unit, None);
        let item_id = &receipt.item_ids[0];
        let generation_id = catalogue::derived_head(&library.catalogue().unwrap(), item_id)
            .unwrap()
            .unwrap()
            .id;
        let outcome = library
            .sample(
                &LidarSampleRequest {
                    kind: LibraryItemRole::Derived,
                    entity_id: item_id.clone(),
                    expected_generation_id: generation_id,
                    request_id: format!("test-{unit}"),
                    longitude,
                    latitude,
                },
                &AtomicBool::new(false),
            )
            .unwrap();
        let LidarSampleOutcome::Value {
            value,
            units: sampled,
            ..
        } = outcome
        else {
            panic!("cell (5, 5) must hold a slope, got {outcome:?}");
        };
        assert!((value - expected).abs() < 0.5, "{unit}: {value}");
        assert_eq!(sampled, units);
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
#[ignore = "requires GDAL and the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
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
#[ignore = "requires GDAL and the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
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

#[test]
#[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
fn the_run_rechecks_the_grid_with_gdal() {
    let root = scratch_root("grid-check");
    let library = LidarLibrary::open(&root).unwrap();
    let values = vec![1.0f32; 48];
    let projected = raster(&root, "projected", &values, 8, 6, 0.0);
    windowed::check_projected_metre_grid(&library, &AtomicBool::new(false), &projected)
        .expect("a projected metre plane is eligible");
    let geographic = root.join("geographic.tif");
    let engine = crate::services::lidar::engine::GdalEngine::new();
    let raw = root.join("geographic.raw");
    import::write_f32_raw(&raw, &values).unwrap();
    import::raw_to_tif(
        &engine,
        &AtomicBool::new(false),
        &raw,
        &geographic,
        &RasterGrid {
            width: 8,
            height: 6,
            geotransform: [2.0, 0.001, 0.0, 48.0, 0.0, -0.001],
        },
        "EPSG:4326",
        -9999.0,
    )
    .unwrap();
    let error =
        windowed::check_projected_metre_grid(&library, &AtomicBool::new(false), &geographic)
            .unwrap_err();
    assert!(error.contains("geographic"), "{error}");
    drop(library);
    let _ = std::fs::remove_dir_all(&root);
}

/// A run cancelled before its first window publishes nothing and leaves no
/// scratch or unpublished rows.
#[test]
#[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
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

/// Inspection never answers from a generation the caller did not aim at, even
/// when the head moves while the value is being read.
#[test]
#[ignore = "requires GDAL on PATH; generated small plane, no private fixtures"]
fn acceptance_inspection_rejects_head_changes_during_value_and_nodata_reads() {
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
        let (longitude, latitude) = lon_lat(x, y);
        let request = LidarSampleRequest {
            kind: LibraryItemRole::Source,
            entity_id: layer.clone(),
            expected_generation_id: old.id.clone(),
            request_id: mode.to_string(),
            longitude,
            latitude,
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
            acceptance_hooks::on_target(change)
        } else {
            acceptance_hooks::on_read(change)
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
#[ignore = "requires GDAL on PATH and the pinned GeoLibre CLI; generated two-block plane, no private fixtures"]
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
#[ignore = "requires GDAL on PATH and the pinned GeoLibre CLI; real published plane and Tauri-managed command state"]
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
    let (longitude, latitude) = lon_lat(5.5, 10.5);
    let sample = library
        .sample(
            &LidarSampleRequest {
                kind: LibraryItemRole::Derived,
                entity_id: south.item_ids[0].clone(),
                expected_generation_id: south_first.clone(),
                request_id: "rerun-control".into(),
                longitude,
                latitude,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
    assert!(
        matches!(sample, LidarSampleOutcome::Value { value, .. } if (value - 100.0).abs() < 0.01),
        "{sample:?}"
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
