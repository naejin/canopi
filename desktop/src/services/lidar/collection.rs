//! Ordered source collections: one Data Layer's priority list of independent
//! source COGs.
//!
//! A collection is an immutable snapshot of ordered member occurrences plus a
//! current head. Its numeric value is the highest-priority valid sample at each
//! location, resolved from the retained source COGs on demand; no merged
//! elevation raster is ever materialized for a new edit. Display, review and
//! slope all read the same composition through [`generation::CollectionReader`],
//! so there is exactly one meaning of the layer's numbers.
//!
//! The catalogue owns membership and order (library data); a Design owns only
//! references and presentation. This module never touches a Design.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use super::LidarLibrary;
use super::catalogue::{self, CollectionMemberRow};
use super::generation::{self, CollectionReader, MemberRole, MemberSource, ResolvedMember};
use super::grid::{RasterGrid, union_grid};
use super::import::{self, GenerationManifest, GenerationStorageFormat};

/// Kind of an ordinary source occurrence.
pub(super) const SOURCE_KIND: &str = "source";
/// Kind of the single indivisible member exposing a preserved composition.
pub(super) const PREVIOUS_COMPOSITION_KIND: &str = "previous-composition";

/// One planned occurrence of a snapshot, top-first.
pub(super) struct SnapshotMember {
    pub member_id: String,
    pub kind: &'static str,
    pub interpretation_id: Option<String>,
    pub base_generation_id: Option<String>,
    /// Import job that added this occurrence, when one did.
    pub job_id: Option<String>,
    pub resolved: ResolvedMember,
}

impl SnapshotMember {
    fn row(&self, position: i64) -> CollectionMemberRow {
        CollectionMemberRow {
            member_id: self.member_id.clone(),
            position,
            kind: self.kind.to_string(),
            interpretation_id: self.interpretation_id.clone(),
            base_generation_id: self.base_generation_id.clone(),
            job_id: self.job_id.clone(),
        }
    }
}

/// A planned immutable snapshot, ready to publish.
pub(super) struct SnapshotPlan {
    /// Top-first priority list: index 0 is the topmost source.
    pub members: Vec<SnapshotMember>,
    pub lattice: RasterGrid,
    pub crs_wkt: String,
    pub nodata: f32,
    /// Manifest `members` list, keeping the accepted legacy convention.
    pub manifest_members: Vec<String>,
}

/// A snapshot that has been measured and is ready to commit.
pub(super) struct SnapshotMeasurement {
    /// Exact valid cells, or `None` when the composition's count is not
    /// derivable from member metadata.
    pub published_cells: Option<u64>,
    /// Exact composed range, or `None` when it is not derivable.
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    /// The range styling and legends use, which need not be the exact one: a
    /// composition published without reading its pixels has no exact range but
    /// still has a stable display domain derived from its members.
    pub display_min_value: f64,
    pub display_max_value: f64,
    pub display_basis: common_types::lidar::LidarDisplayRangeBasis,
    pub bounds_3857: [f64; 4],
}

/// Build the readable composition of a snapshot from its member rows.
///
/// The rows are the authority for membership and order; each is resolved to its
/// durable payload here. `Ok(None)` means at least one occurrence's samples are
/// gone, so the snapshot cannot be replayed without inventing coverage; callers
/// report that by name instead of publishing or displaying a shorter layer.
/// Lattice-cell rectangle a bounded read needs.
#[derive(Debug, Clone, Copy)]
pub(super) struct ReadBounds {
    pub x0: i64,
    pub y0: i64,
    pub x1: i64,
    pub y1: i64,
}

impl ReadBounds {
    fn intersects(&self, other: &Self) -> bool {
        self.x0 < other.x1 && other.x0 < self.x1 && self.y0 < other.y1 && other.y0 < self.y1
    }
}

/// Bind one snapshot's members for a read, optionally limited to a footprint.
///
/// Only occurrences whose own extent intersects the footprint are resolved: a
/// tile or a bounded window never opens a source that cannot contribute to it.
/// Membership is still read in bounded catalogue pages, and priority order is
/// preserved, so the composed value is identical to reading the whole
/// composition.
pub(super) fn load_reader_within(
    library: &LidarLibrary,
    generation_id: &str,
    manifest: &GenerationManifest,
    bounds: Option<ReadBounds>,
    cancel: &AtomicBool,
) -> Result<Option<CollectionReader>, String> {
    let Some(members) = reader_members(library, generation_id, manifest, bounds, cancel)? else {
        return Ok(None);
    };
    let readable: Vec<(String, ResolvedMember)> = members
        .into_iter()
        .map(|member| (member.member_id, member.resolved))
        .collect();
    Ok(Some(CollectionReader::new(
        readable,
        manifest.grid.clone(),
    )?))
}

/// The occurrences of one snapshot that can contribute to a read.
///
/// Membership is read in bounded catalogue pages and filtered by each
/// occurrence's own extent; only the survivors have their payload resolved. A
/// tile therefore never opens a source that cannot reach it, while the composed
/// value stays identical to reading the whole composition.
fn reader_members(
    library: &LidarLibrary,
    generation_id: &str,
    manifest: &GenerationManifest,
    bounds: Option<ReadBounds>,
    cancel: &AtomicBool,
) -> Result<Option<Vec<SnapshotMember>>, String> {
    let mut kept: Vec<CollectionMemberRow> = Vec::new();
    let mut cursor: Option<i64> = None;
    loop {
        import::check_cancel(cancel)?;
        // One short catalogue lock per page: the raster work below happens
        // without it. The cursor advances on the unfiltered page, so a page
        // whose occurrences were all filtered out cannot stall the traversal.
        let (page, returned, next) = {
            let connection = library.catalogue()?;
            let page = catalogue::collection_members_page(
                &connection,
                generation_id,
                cursor,
                catalogue::MEMBER_PAGE_MAX,
            )?;
            let returned = page.len() as i64;
            let next = page.last().map(|row| row.position);
            let mut keep = Vec::new();
            for row in page {
                match bounds.as_ref() {
                    Some(bounds) => {
                        if let Some(extent) = member_extent(&connection, &row, &manifest.grid)?
                            && bounds.intersects(&extent)
                        {
                            keep.push(row);
                        }
                    }
                    None => keep.push(row),
                }
            }
            (keep, returned, next)
        };
        kept.extend(page);
        match next {
            Some(position) => cursor = Some(position),
            None => break,
        }
        if returned < catalogue::MEMBER_PAGE_MAX {
            break;
        }
    }
    let mut members = Vec::with_capacity(kept.len());
    for row in &kept {
        let Some(member) = resolve_row(library, row, cancel)? else {
            return Ok(None);
        };
        members.push(member);
    }
    Ok(Some(members))
}

/// The lattice extent one stored member occupies, without opening its payload.
fn member_extent(
    connection: &rusqlite::Connection,
    row: &CollectionMemberRow,
    lattice: &RasterGrid,
) -> Result<Option<ReadBounds>, String> {
    let grid = match row.kind.as_str() {
        SOURCE_KIND => {
            let Some(interpretation_id) = row.interpretation_id.as_deref() else {
                return Ok(None);
            };
            let Some(interpretation) =
                catalogue::get_interpretation(connection, interpretation_id)?
            else {
                return Ok(None);
            };
            RasterGrid {
                width: u32::try_from(interpretation.width.max(0)).unwrap_or(u32::MAX),
                height: u32::try_from(interpretation.height.max(0)).unwrap_or(u32::MAX),
                geotransform: import::parse_geotransform(&interpretation.geotransform)?,
            }
        }
        PREVIOUS_COMPOSITION_KIND => {
            let Some(base_id) = row.base_generation_id.as_deref() else {
                return Ok(None);
            };
            let Some(base) = catalogue::generation_row(connection, base_id)? else {
                return Ok(None);
            };
            let manifest = import::read_generation_manifest(&base.manifest_json)?;
            match catalogue::generation_chunk_extent(connection, base_id, generation::RESULT_ROLE)?
            {
                Some((first_x, first_y, last_x, last_y)) => {
                    chunk_extent_grid(&manifest.grid, first_x, first_y, last_x, last_y)?
                }
                None => manifest.grid,
            }
        }
        _ => return Ok(None),
    };
    let offset = generation::lattice_offset(lattice, &grid)?;
    Ok(Some(ReadBounds {
        x0: offset.0,
        y0: offset.1,
        x1: offset.0.saturating_add(i64::from(grid.width)),
        y1: offset.1.saturating_add(i64::from(grid.height)),
    }))
}

pub(super) fn load_reader(
    library: &LidarLibrary,
    generation_id: &str,
    manifest: &GenerationManifest,
    cancel: &AtomicBool,
) -> Result<Option<CollectionReader>, String> {
    let Some(members) = snapshot_members(library, generation_id, cancel)? else {
        return Ok(None);
    };
    let readable: Vec<(String, ResolvedMember)> = members
        .into_iter()
        .map(|member| (member.member_id, member.resolved))
        .collect();
    Ok(Some(CollectionReader::new(
        readable,
        manifest.grid.clone(),
    )?))
}

/// Resolve one snapshot's stored rows into readable occurrences, top-first.
///
/// `Ok(None)` means at least one occurrence's durable payload is gone; callers
/// report that by name rather than publishing or displaying a shorter layer.
pub(super) fn snapshot_members(
    library: &LidarLibrary,
    generation_id: &str,
    cancel: &AtomicBool,
) -> Result<Option<Vec<SnapshotMember>>, String> {
    let rows = {
        let connection = library.catalogue()?;
        catalogue::collection_members(&connection, generation_id)?
    };
    let mut members = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(member) = resolve_row(library, &row, cancel)? else {
            return Ok(None);
        };
        members.push(member);
    }
    Ok(Some(members))
}

/// Resolve one stored member row into its readable occurrence.
fn resolve_row(
    library: &LidarLibrary,
    row: &CollectionMemberRow,
    cancel: &AtomicBool,
) -> Result<Option<SnapshotMember>, String> {
    match row.kind.as_str() {
        SOURCE_KIND => {
            let interpretation_id = row
                .interpretation_id
                .as_deref()
                .ok_or_else(|| format!("collection member {} has no source", row.member_id))?;
            let mut resolved = {
                let connection = library.catalogue()?;
                import::occurrences_for_members(
                    &connection,
                    &library.inner.paths,
                    &[(
                        interpretation_id.to_string(),
                        MemberRole::Replace.as_str().to_string(),
                        None,
                    )],
                )?
            };
            let Some(member) = resolved.as_mut().and_then(|members| members.pop()) else {
                return Ok(None);
            };
            if resolved.is_some_and(|members| !members.is_empty()) {
                return Err(format!(
                    "collection member {} resolved to more than one occurrence",
                    row.member_id
                ));
            }
            Ok(Some(SnapshotMember {
                member_id: row.member_id.clone(),
                kind: SOURCE_KIND,
                interpretation_id: Some(interpretation_id.to_string()),
                base_generation_id: None,
                job_id: row.job_id.clone(),
                resolved: member,
            }))
        }
        PREVIOUS_COMPOSITION_KIND => {
            let base_id = row
                .base_generation_id
                .as_deref()
                .ok_or_else(|| format!("collection member {} has no base", row.member_id))?;
            Ok(Some(SnapshotMember {
                member_id: row.member_id.clone(),
                kind: PREVIOUS_COMPOSITION_KIND,
                interpretation_id: None,
                base_generation_id: Some(base_id.to_string()),
                job_id: row.job_id.clone(),
                resolved: preserved_member(library, base_id, cancel)?,
            }))
        }
        other => Err(format!("unknown collection member kind {other}")),
    }
}

/// The single indivisible bottom member exposing a pre-transition head.
pub(super) fn previous_composition_member(
    library: &LidarLibrary,
    base_id: &str,
    cancel: &AtomicBool,
) -> Result<SnapshotMember, String> {
    Ok(SnapshotMember {
        member_id: format!("prev-{base_id}"),
        kind: PREVIOUS_COMPOSITION_KIND,
        interpretation_id: None,
        base_generation_id: Some(base_id.to_string()),
        job_id: None,
        resolved: preserved_member(library, base_id, cancel)?,
    })
}

/// One preserved generation as an indivisible member.
///
/// A chunked generation is read through its own published records; a dense one
/// through its mosaic and authoritative coverage mask. A collection is never
/// wrapped in another collection: snapshots copy member references instead, so
/// a base chain cannot grow.
pub(super) fn preserved_member(
    library: &LidarLibrary,
    base_id: &str,
    cancel: &AtomicBool,
) -> Result<ResolvedMember, String> {
    let (row, extent) = {
        let connection = library.catalogue()?;
        let row = catalogue::generation_row(&connection, base_id)?
            .ok_or_else(|| format!("preserved generation {base_id} is missing"))?;
        let extent =
            catalogue::generation_chunk_extent(&connection, base_id, generation::RESULT_ROLE)?;
        (row, extent)
    };
    let manifest = import::read_generation_manifest(&row.manifest_json)?;
    match manifest.format {
        GenerationStorageFormat::CogChunksV1 => {
            // The manifest rectangle is the lattice the chunks are addressed
            // in, not how far they reach. The member's own grid is the signed
            // block extent actually published, so coverage beyond the original
            // rectangle stays readable instead of being clipped away.
            let member_grid = match extent {
                Some((first_x, first_y, last_x, last_y)) => {
                    chunk_extent_grid(&manifest.grid, first_x, first_y, last_x, last_y)?
                }
                None => manifest.grid.clone(),
            };
            Ok(ResolvedMember {
                ordinal: 0,
                role: MemberRole::Replace,
                grid: member_grid.clone(),
                nodata: Some(manifest.nodata),
                source: MemberSource::Preserved(std::sync::Arc::new(
                    generation::PreservedGeneration::chunks(
                        library,
                        base_id,
                        generation::RESULT_ROLE,
                        manifest.grid.clone(),
                        &member_grid,
                    )?,
                )),
            })
        }
        GenerationStorageFormat::LegacyDenseV1 => {
            let mosaic = row
                .mosaic_path
                .clone()
                .ok_or_else(|| format!("preserved generation {base_id} has no readable raster"))?;
            // A dense mosaic is not in the controlled COG profile, so the
            // library prepares one compatibility derivative and owns it. The
            // preserved generation's own coverage mask stays authoritative.
            // The caller's own token reaches the cold conversion: a cancelled
            // import, tile or analysis must not keep preparing a legacy
            // derivative, and the check below refuses to publish on cancel.
            let lease = library.compat_lease(
                base_id,
                std::path::Path::new(&mosaic),
                &manifest.grid,
                Some(manifest.nodata),
                row.coverage_mask_path.map(PathBuf::from),
                cancel,
            )?;
            import::check_cancel(cancel)?;
            Ok(ResolvedMember {
                ordinal: 0,
                role: MemberRole::Replace,
                grid: manifest.grid.clone(),
                nodata: Some(manifest.nodata),
                source: MemberSource::LegacyHead(lease),
            })
        }
        GenerationStorageFormat::OrderedMembersV1 => Err(format!(
            "preserved generation {base_id} is itself an ordered collection; a snapshot copies \
             member references rather than wrapping another collection"
        )),
    }
}

/// The signed lattice grid a sparse generation's published records occupy.
///
/// A generation with no published record at all keeps its manifest rectangle,
/// which is the lattice origin it was anchored to; one with records reaches
/// across exactly the blocks they occupy, negative coordinates included.
pub(super) fn chunk_extent_grid(
    lattice: &RasterGrid,
    first_x: i64,
    first_y: i64,
    last_x: i64,
    last_y: i64,
) -> Result<RasterGrid, String> {
    let side = generation::CHUNK_SIDE;
    let width = last_x
        .checked_sub(first_x)
        .and_then(|span| span.checked_add(1))
        .and_then(|blocks| blocks.checked_mul(side))
        .and_then(|cells| u32::try_from(cells).ok())
        .ok_or_else(|| "preserved composition extent is too large".to_string())?;
    let height = last_y
        .checked_sub(first_y)
        .and_then(|span| span.checked_add(1))
        .and_then(|blocks| blocks.checked_mul(side))
        .and_then(|cells| u32::try_from(cells).ok())
        .ok_or_else(|| "preserved composition extent is too large".to_string())?;
    Ok(RasterGrid {
        width,
        height,
        geotransform: [
            lattice.geotransform[0] + first_x as f64 * side as f64 * lattice.geotransform[1],
            lattice.geotransform[1],
            0.0,
            lattice.geotransform[3] + first_y as f64 * side as f64 * lattice.geotransform[5],
            0.0,
            lattice.geotransform[5],
        ],
    })
}

/// Derive a planned composition's metadata **without reading its pixels**.
///
/// Publishing membership does not require knowing the composed values: the
/// composition is defined by its members, their order and their own stored
/// facts, all of which the catalogue already holds. The pass below therefore
/// opens no raster and decodes nothing; its cost follows the member list, not
/// the coverage.
///
/// Exact composed facts are what cannot be derived from member metadata, so
/// they are reported only when they really are derivable:
///
/// - an empty composition is exactly zero cells with no range;
/// - a composition of one member *is* that member, so its exact facts carry
///   over;
/// - anything else reports the exact count and range as unknown rather than
///   summing member counts, which would count overlap and occluded cells twice
///   and call an envelope an area.
///
/// The display range is always available, because it is not a statistic: it is
/// the union of the stored member ranges, including the ranges of preserved
/// compatibility members, and it is labelled by that basis.
pub(super) fn measure(
    library: &LidarLibrary,
    plan: &SnapshotPlan,
    cancel: &AtomicBool,
) -> Result<SnapshotMeasurement, String> {
    import::check_cancel(cancel)?;
    let (exact_cells, exact_min, exact_max, any_range, display_min, display_max) = {
        let connection = library.catalogue()?;
        let mut member_cells = 0u64;
        let mut display_min = f64::INFINITY;
        let mut display_max = f64::NEG_INFINITY;
        let mut any_range = false;
        for member in &plan.members {
            import::check_cancel(cancel)?;
            let (cells, min, max) = member_facts(&connection, member)?;
            member_cells = member_cells.saturating_add(cells);
            if let (Some(min), Some(max)) = (min, max)
                && min.is_finite()
                && max.is_finite()
            {
                display_min = display_min.min(min);
                display_max = display_max.max(max);
                any_range = true;
            }
        }
        // No member holds a valid cell, so the composition holds none either: this
        // is the one composed statement member facts can make soundly, and it is
        // exact because an empty union needs every member to be empty.
        let exact_cells = match plan.members.len() {
            0 => Some(0),
            1 => Some(member_cells),
            _ if member_cells == 0 => Some(0),
            _ => None,
        };
        let (exact_min, exact_max) = match (plan.members.len(), any_range) {
            (1, true) => (Some(display_min), Some(display_max)),
            // An empty or all-NoData composition has a known range of nothing.
            (_, false) if exact_cells == Some(0) => (Some(0.0), Some(0.0)),
            _ => (None, None),
        };
        (
            exact_cells,
            exact_min,
            exact_max,
            any_range,
            display_min,
            display_max,
        )
        // Catalogue facts are collected here; the guard is released before any
        // bounds transform or reader work so unrelated catalogue reads proceed.
    };
    // Display bounds are the envelope of what the members actually occupy: the
    // reader is only asked for its occupied blocks, which is arithmetic over
    // member extents and opens nothing.
    let resolved: Vec<(String, ResolvedMember)> = plan
        .members
        .iter()
        .map(|member| (member.member_id.clone(), member.resolved.clone()))
        .collect();
    let reader = CollectionReader::new(resolved, plan.lattice.clone())?;
    let chunks = reader.occupied_chunks()?;
    let bounds_3857 = coverage_bounds(library, plan, &chunks, cancel)?;
    let (display_min_value, display_max_value) = if any_range {
        (display_min, display_max)
    } else {
        // No member declares a range: a constant-domain generation renders
        // transparently, which is what the styling path already does with a
        // zero-width domain.
        (0.0, 0.0)
    };
    Ok(SnapshotMeasurement {
        published_cells: exact_cells,
        min_value: exact_min,
        max_value: exact_max,
        display_min_value,
        display_max_value,
        // A range only one member supplied is that member's own exact range; a
        // union of several is an envelope, and it is labelled as one.
        display_basis: if plan.members.len() == 1 {
            common_types::lidar::LidarDisplayRangeBasis::Exact
        } else {
            common_types::lidar::LidarDisplayRangeBasis::SourceEnvelope
        },
        bounds_3857,
    })
}

/// One member's own stored exact facts, without opening its payload.
///
/// A source occurrence reads the exact aggregate its occupied-region index
/// already stores. A preserved composition has no interpretation of its own, so
/// it reports the exact facts of the generation it replays.
fn member_facts(
    connection: &rusqlite::Connection,
    member: &SnapshotMember,
) -> Result<(u64, Option<f64>, Option<f64>), String> {
    if let Some(interpretation_id) = member.interpretation_id.as_deref() {
        let (cells, min, max) = catalogue::interpretation_coverage(connection, interpretation_id)?;
        return Ok((cells.max(0) as u64, min, max));
    }
    let Some(base_id) = member.base_generation_id.as_deref() else {
        return Ok((0, None, None));
    };
    let Some(row) = catalogue::generation_row(connection, base_id)? else {
        return Ok((0, None, None));
    };
    Ok((
        row.coverage_cells
            .map(|cells| cells.max(0) as u64)
            .unwrap_or(0),
        row.min_value,
        row.max_value,
    ))
}

/// Display bounds: the envelope of the composition's occupied chunks.
///
/// Matching the superseded sparse route keeps a layer's map footprint stable
/// across the transition; a composition with no valid cell keeps the lattice
/// bounds, as the dense route does.
fn coverage_bounds(
    library: &LidarLibrary,
    plan: &SnapshotPlan,
    chunks: &[(i64, i64)],
    cancel: &AtomicBool,
) -> Result<[f64; 4], String> {
    let engine = &library.inner.engine;
    if chunks.is_empty() {
        return import::raster_bounds_3857(engine, cancel, &plan.lattice, &plan.crs_wkt);
    }
    let mut first = (i64::MAX, i64::MAX);
    let mut last = (i64::MIN, i64::MIN);
    for (chunk_x, chunk_y) in chunks {
        first = (first.0.min(*chunk_x), first.1.min(*chunk_y));
        last = (last.0.max(*chunk_x), last.1.max(*chunk_y));
    }
    let envelope = union_grid(
        &generation::chunk_grid(&plan.lattice, first.0, first.1),
        &generation::chunk_grid(&plan.lattice, last.0, last.1),
    )?;
    import::raster_bounds_3857(engine, cancel, &envelope, &plan.crs_wkt)
}

/// The manifest of an ordered snapshot.
pub(super) fn manifest_for(
    library: &LidarLibrary,
    plan: &SnapshotPlan,
) -> Result<(String, GenerationManifest), String> {
    let manifest = GenerationManifest {
        grid: plan.lattice.clone(),
        nodata: plan.nodata,
        crs_wkt: plan.crs_wkt.clone(),
        members: plan.manifest_members.clone(),
        engine_version: import::engine_version(&library.inner.engine),
        created_at: catalogue::now_iso(),
        format: GenerationStorageFormat::OrderedMembersV1,
    };
    let json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    Ok((json, manifest))
}

/// The lineage a newly published snapshot records.
///
/// `previous_generation_id` is Undo's target and `undo_available` says whether
/// Undo is offered at all; `operation` is the user action that published it.
pub(super) struct SnapshotLineage<'a> {
    pub previous_generation_id: Option<&'a str>,
    pub undo_available: bool,
    pub operation: &'a str,
}

/// Record one snapshot's generation row and ordered members.
///
/// Called inside the caller's publication transaction: the generation row, the
/// member rows the readers select by, the promoted source references and the
/// advanced head become visible together or not at all.
pub(super) fn insert_snapshot(
    connection: &rusqlite::Connection,
    layer_id: &str,
    generation_id: &str,
    plan: &SnapshotPlan,
    measurement: &SnapshotMeasurement,
    manifest_json: &str,
    lineage: &SnapshotLineage<'_>,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO lidar_layer_generations(id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json, coverage_cells, min_value, max_value, display_min_value, display_max_value, display_basis, bounds_3857, base_generation_id, previous_generation_id, undo_available, operation)
             VALUES(?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?13, ?14)",
            rusqlite::params![
                generation_id,
                layer_id,
                catalogue::now_iso(),
                manifest_json,
                measurement
                    .published_cells
                    .map(|cells| cells as i64),
                measurement.min_value,
                measurement.max_value,
                measurement.display_min_value,
                measurement.display_max_value,
                super::display_basis_label(measurement.display_basis),
                serde_json::to_string(&measurement.bounds_3857).map_err(|e| e.to_string())?,
                lineage.previous_generation_id,
                i64::from(lineage.undo_available),
                lineage.operation,
            ],
        )
        .map_err(|e| format!("Failed to record the collection generation: {e}"))?;
    let rows: Vec<CollectionMemberRow> = plan
        .members
        .iter()
        .enumerate()
        .map(|(position, member)| member.row(position as i64))
        .collect();
    catalogue::replace_collection_members(connection, generation_id, &rows)
}

/// Encode a member cursor: the snapshot the page belongs to and the last
/// position the caller saw.
///
/// Binding the cursor to the snapshot is what makes a late page of a superseded
/// head a refused request instead of a silently mixed list.
pub(super) fn encode_member_cursor(generation_id: &str, after_position: i64) -> String {
    format!("{generation_id}:{after_position}")
}

/// Decode a member cursor, rejecting anything this caller did not produce.
pub(super) fn decode_member_cursor(cursor: &str) -> Result<(String, i64), String> {
    let (generation_id, position) = cursor
        .rsplit_once(':')
        .ok_or_else(|| "invalid source-list cursor".to_string())?;
    if generation_id.is_empty() {
        return Err("invalid source-list cursor".to_string());
    }
    let position = position
        .parse::<i64>()
        .map_err(|_| "invalid source-list cursor".to_string())?;
    Ok((generation_id.to_string(), position))
}
