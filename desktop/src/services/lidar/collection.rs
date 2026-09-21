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
    pub published_cells: u64,
    pub min_value: f64,
    pub max_value: f64,
    pub bounds_3857: [f64; 4],
}

/// Build the readable composition of a snapshot from its member rows.
///
/// The rows are the authority for membership and order; each is resolved to its
/// durable payload here. `Ok(None)` means at least one occurrence's samples are
/// gone, so the snapshot cannot be replayed without inventing coverage; callers
/// report that by name instead of publishing or displaying a shorter layer.
pub(super) fn load_reader(
    library: &LidarLibrary,
    generation_id: &str,
    manifest: &GenerationManifest,
) -> Result<Option<CollectionReader>, String> {
    let Some(members) = snapshot_members(library, generation_id)? else {
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
) -> Result<Option<Vec<SnapshotMember>>, String> {
    let rows = {
        let connection = library.catalogue()?;
        catalogue::collection_members(&connection, generation_id)?
    };
    let mut members = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(member) = resolve_row(library, &row)? else {
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
                resolved: preserved_member(library, base_id)?,
            }))
        }
        other => Err(format!("unknown collection member kind {other}")),
    }
}

/// The single indivisible bottom member exposing a pre-transition head.
pub(super) fn previous_composition_member(
    library: &LidarLibrary,
    base_id: &str,
) -> Result<SnapshotMember, String> {
    Ok(SnapshotMember {
        member_id: format!("prev-{base_id}"),
        kind: PREVIOUS_COMPOSITION_KIND,
        interpretation_id: None,
        base_generation_id: Some(base_id.to_string()),
        job_id: None,
        resolved: preserved_member(library, base_id)?,
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
) -> Result<ResolvedMember, String> {
    let row = {
        let connection = library.catalogue()?;
        catalogue::generation_row(&connection, base_id)?
    }
    .ok_or_else(|| format!("preserved generation {base_id} is missing"))?;
    let manifest = import::read_generation_manifest(&row.manifest_json)?;
    match manifest.format {
        GenerationStorageFormat::CogChunksV1 => Ok(ResolvedMember {
            ordinal: 0,
            role: MemberRole::Replace,
            grid: manifest.grid.clone(),
            nodata: Some(manifest.nodata),
            source: MemberSource::Preserved(std::sync::Arc::new(
                generation::PreservedGeneration::chunks(
                    library,
                    base_id,
                    generation::RESULT_ROLE,
                    manifest.grid.clone(),
                ),
            )),
        }),
        GenerationStorageFormat::LegacyDenseV1 => {
            let mosaic = row
                .mosaic_path
                .clone()
                .ok_or_else(|| format!("preserved generation {base_id} has no readable raster"))?;
            // A dense mosaic is not in the controlled COG profile, so the
            // library prepares one compatibility derivative and owns it. The
            // preserved generation's own coverage mask stays authoritative.
            let lease = library.compat_lease(
                base_id,
                std::path::Path::new(&mosaic),
                &manifest.grid,
                Some(manifest.nodata),
                row.coverage_mask_path.map(PathBuf::from),
                &AtomicBool::new(false),
            )?;
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

/// Measure a planned composition: valid cells, value range and display bounds.
///
/// The pass visits only the composition's occupied 1024-cell chunks, one
/// bounded window at a time, so its cost follows the stored coverage rather
/// than the empty gap inside the members' envelope. No merged raster is
/// written: the measurement is the publication's only whole-composition work.
pub(super) fn measure(
    library: &LidarLibrary,
    plan: &SnapshotPlan,
    cancel: &AtomicBool,
) -> Result<SnapshotMeasurement, String> {
    let resolved: Vec<(String, ResolvedMember)> = plan
        .members
        .iter()
        .map(|member| (member.member_id.clone(), member.resolved.clone()))
        .collect();
    let reader = CollectionReader::new(resolved, plan.lattice.clone())?;
    let chunks = reader.occupied_chunks()?;
    let side = generation::CHUNK_SIDE;
    let mut published_cells = 0u64;
    let mut min_value = f64::INFINITY;
    let mut max_value = f64::NEG_INFINITY;
    for (chunk_x, chunk_y) in &chunks {
        import::check_cancel(cancel)?;
        let window = generation::LatticeWindow {
            x: chunk_x.saturating_mul(side),
            y: chunk_y.saturating_mul(side),
            width: side as u32,
            height: side as u32,
        };
        let resolved = reader.read_window(window, cancel)?;
        for (sample, valid) in resolved.samples.iter().zip(resolved.valid.iter()) {
            if *valid == 0 {
                continue;
            }
            published_cells = published_cells.saturating_add(1);
            let value = f64::from(*sample);
            // A NaN sample is a valid cell with no numeric magnitude, exactly as
            // the dense route treats it: it counts as coverage and is excluded
            // from the reported range.
            if value.is_finite() {
                min_value = min_value.min(value);
                max_value = max_value.max(value);
            }
        }
    }
    if !min_value.is_finite() || !max_value.is_finite() {
        min_value = 0.0;
        max_value = 0.0;
    }
    let bounds_3857 = coverage_bounds(library, plan, &chunks, cancel)?;
    Ok(SnapshotMeasurement {
        published_cells,
        min_value,
        max_value,
        bounds_3857,
    })
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
    previous_generation_id: Option<&str>,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO lidar_layer_generations(id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json, coverage_cells, min_value, max_value, bounds_3857, base_generation_id, previous_generation_id)
             VALUES(?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6, ?7, ?8, NULL, ?9)",
            rusqlite::params![
                generation_id,
                layer_id,
                catalogue::now_iso(),
                manifest_json,
                measurement.published_cells as i64,
                measurement.min_value,
                measurement.max_value,
                serde_json::to_string(&measurement.bounds_3857).map_err(|e| e.to_string())?,
                previous_generation_id,
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

/// Member names, kinds and originating jobs of one snapshot.
type SnapshotNames = (Vec<String>, Vec<String>, Vec<String>);

/// One published version in a layer's history.
pub(super) struct HistoryEntry {
    pub generation_id: String,
    pub created_at: String,
    pub coverage_cells: i64,
    pub members: Vec<String>,
    pub roles: Vec<String>,
    pub job_ids: Vec<String>,
    /// User operation this version recorded, told apart from the membership
    /// delta against the version it replaced.
    pub operation: String,
    pub is_current: bool,
    /// Whether an earlier version exists for Undo to restore.
    pub restorable: bool,
}

/// A layer's publication history, newest first.
///
/// Order is `(created_at, rowid)`, so two publications in the same second keep
/// their real sequence and every version has a unique identity cue rather than
/// per-generation numbering that makes consecutive imports read alike.
pub(super) fn history(
    connection: &rusqlite::Connection,
    layer_id: &str,
) -> Result<Vec<HistoryEntry>, String> {
    let current = catalogue::head_generation(connection, layer_id)?
        .map(|row| row.id)
        .unwrap_or_default();
    let snapshot = |generation_id: &str| -> Result<SnapshotNames, String> {
        let rows = catalogue::collection_members(connection, generation_id)?;
        if !rows.is_empty() {
            return Ok((
                rows.iter()
                    .map(|row| {
                        row.interpretation_id
                            .clone()
                            .or_else(|| row.base_generation_id.clone())
                            .unwrap_or_else(|| row.member_id.clone())
                    })
                    .collect(),
                rows.iter().map(|row| row.kind.clone()).collect(),
                rows.iter().filter_map(|row| row.job_id.clone()).collect(),
            ));
        }
        let members = catalogue::generation_members(connection, generation_id)?;
        Ok((
            members
                .iter()
                .map(|(interpretation_id, _, _)| interpretation_id.clone())
                .collect(),
            members.iter().map(|(_, role, _)| role.clone()).collect(),
            members
                .iter()
                .filter_map(|(_, _, job_id)| job_id.clone())
                .collect(),
        ))
    };
    let mut statement = connection
        .prepare(
            "SELECT g.id, g.created_at, g.coverage_cells, g.previous_generation_id
             FROM lidar_layer_generations g
             WHERE g.layer_id = ?1
             ORDER BY g.created_at DESC, g.rowid DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([layer_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(statement);

    let mut entries = Vec::with_capacity(rows.len());
    for (generation_id, created_at, coverage_cells, previous) in rows {
        let (members, roles, job_ids) = snapshot(&generation_id)?;
        let operation = match previous.as_deref() {
            None => "import",
            Some(previous) => {
                let (before, _, _) = snapshot(previous)?;
                if before == members {
                    "restore"
                } else if before.len() == members.len()
                    && before.iter().all(|member| members.contains(member))
                {
                    "reorder"
                } else if members.iter().all(|member| before.contains(member)) {
                    "remove"
                } else {
                    "import"
                }
            }
        };
        let restorable = previous.is_some();
        entries.push(HistoryEntry {
            is_current: generation_id == current,
            generation_id,
            created_at,
            coverage_cells,
            members,
            roles,
            job_ids,
            operation: operation.to_string(),
            restorable,
        });
    }
    Ok(entries)
}
