//! Bounded reads over ordered member occurrences.
//!
//! One resolver serves staged review candidates, published generations and
//! preserved legacy generations. It reads only the window a caller asks for,
//! maps signed lattice coordinates onto each member's own grid, and replays
//! occurrences in ordinal order with the accepted role semantics. No union
//! raster, no absent-coordinate walk and no whole-extent buffer is created.
//!
//! Wiring status: publication and the review/undo callers consume this
//! resolver through `import.rs`. The remaining consumers — slope (B3) and the
//! bounded display transport (B4) — are still to come, so individual items
//! keep a documented allowance until their caller lands (`canopi-jv8a.4`).

use super::catalogue;
use super::grid::RasterGrid;
use super::paths::LidarPaths;
use super::prepared_raster::{PreparedRaster, RasterWindow};
pub(super) use super::raster_assets::CogAsset;
use rusqlite::Connection;
use std::collections::BTreeSet;
use std::io::{Read as _, Seek as _, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Spatial chunk side shared by resolved generation and result storage.
pub(super) const CHUNK_SIDE: i64 = 1024;
/// Largest requested window side, matching the reader's halo allowance.
const MAX_WINDOW_SIDE: i64 = 1026;
/// Catalogue role of a generation's resolved numeric chunks.
pub(super) const RESULT_ROLE: &str = "result";
/// Catalogue role of a result's separate 0/1 quality chunks.
pub(super) const QUALITY_ROLE: &str = "quality";

/// How one occurrence participates in composition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum MemberRole {
    /// Fill cells that are currently invalid.
    Add,
    /// Paint valid incoming cells anywhere.
    Replace,
    /// Paint valid incoming cells only where coverage already exists.
    ReplaceOverlap,
}

impl MemberRole {
    // Not yet reachable from a production caller: the sparse reader now serves
    // publication, review and undo, but these items belong to the deferred
    // legacy-base overlay and the B3/B4 consumers (`canopi-jv8a.4`).
    #[allow(dead_code)]
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Replace => "replace",
            Self::ReplaceOverlap => "replace-overlap",
        }
    }

    pub(super) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "add" => Ok(Self::Add),
            "replace" => Ok(Self::Replace),
            "replace-overlap" => Ok(Self::ReplaceOverlap),
            other => Err(format!("unknown member role {other}")),
        }
    }
}

/// Where one occurrence's samples come from.
#[derive(Debug, Clone)]
pub(super) enum MemberSource {
    /// Retained standard COG for this interpretation.
    Cog(CogAsset),
    /// Preserved dense generation assets, read through the bounded adapter.
    LegacyDense { values: PathBuf, mask: PathBuf },
}

/// One ordered occurrence available for replay.
#[derive(Debug, Clone)]
pub(super) struct ResolvedMember {
    pub ordinal: i64,
    pub role: MemberRole,
    pub grid: RasterGrid,
    /// Effective validity rule for this occurrence's own samples.
    pub nodata: Option<f32>,
    pub source: MemberSource,
}

/// A half-open window in signed lattice cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct LatticeWindow {
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
}

/// Resolved values and exact validity for one window.
#[derive(Debug)]
pub(super) struct ResolvedWindow {
    // Not yet reachable from a production caller: the sparse reader now serves
    // publication, review and undo, but these items belong to the deferred
    // legacy-base overlay and the B3/B4 consumers (`canopi-jv8a.4`).
    #[allow(dead_code)]
    pub grid: RasterGrid,
    pub samples: Vec<f32>,
    pub valid: Vec<u8>,
}

impl ResolvedWindow {
    // Not yet reachable from a production caller: the sparse reader now serves
    // publication, review and undo, but these items belong to the deferred
    // legacy-base overlay and the B3/B4 consumers (`canopi-jv8a.4`).
    #[allow(dead_code)]
    pub(super) fn cells(&self) -> usize {
        self.samples.len()
    }
}

/// Resolve one window over an ordered occurrence sequence.
pub(super) fn resolve_window(
    members: &[ResolvedMember],
    lattice: &RasterGrid,
    window: LatticeWindow,
    cancel: &AtomicBool,
) -> Result<ResolvedWindow, String> {
    let cells = validate_window(window)?;
    let width = window.width as usize;
    // The ordered sequence is a precondition: reject a misordered list before
    // reading anything rather than replaying part of it.
    let mut previous: Option<i64> = None;
    for member in members {
        if let Some(previous) = previous
            && member.ordinal < previous
        {
            return Err(format!(
                "member ordinal {} is out of order after {previous}",
                member.ordinal
            ));
        }
        previous = Some(member.ordinal);
    }
    let mut samples = vec![f32::NAN; cells];
    let mut valid = vec![0u8; cells];
    for member in members {
        check_cancel(cancel)?;
        let (offset_x, offset_y) = lattice_offset(lattice, &member.grid)?;
        // Member cell that corresponds to the window's first lattice cell.
        let member_x0 = window.x - offset_x;
        let member_y0 = window.y - offset_y;
        let member_x1 = member_x0 + i64::from(window.width);
        let member_y1 = member_y0 + i64::from(window.height);
        let clip_x0 = member_x0.max(0);
        let clip_y0 = member_y0.max(0);
        let clip_x1 = member_x1.min(i64::from(member.grid.width));
        let clip_y1 = member_y1.min(i64::from(member.grid.height));
        if clip_x0 >= clip_x1 || clip_y0 >= clip_y1 {
            continue;
        }
        let member_window = RasterWindow {
            x: clip_x0 as u32,
            y: clip_y0 as u32,
            width: (clip_x1 - clip_x0) as u32,
            height: (clip_y1 - clip_y0) as u32,
        };
        let dest_x = (clip_x0 + offset_x - window.x) as usize;
        let dest_y = (clip_y0 + offset_y - window.y) as usize;
        let (member_samples, member_valid) = read_member_window(member, member_window, cancel)?;
        for row in 0..member_window.height as usize {
            for column in 0..member_window.width as usize {
                let index = row * member_window.width as usize + column;
                if member_valid[index] == 0 {
                    // Invalid incoming samples never erase existing coverage.
                    continue;
                }
                let target = (dest_y + row) * width + dest_x + column;
                let accepted = match member.role {
                    MemberRole::Add => valid[target] == 0,
                    MemberRole::Replace => true,
                    MemberRole::ReplaceOverlap => valid[target] != 0,
                };
                if accepted {
                    samples[target] = member_samples[index];
                    valid[target] = 1;
                }
            }
        }
    }
    check_cancel(cancel)?;
    Ok(ResolvedWindow {
        grid: window_grid(lattice, window)?,
        samples,
        valid,
    })
}

/// Occupied spatial chunks of an ordered sequence, in chunk coordinates.
///
/// Only the chunks each occurrence actually covers are visited; the empty gap
/// between distant occurrences contributes nothing.
pub(super) fn occupied_chunks(
    members: &[ResolvedMember],
    lattice: &RasterGrid,
) -> Result<Vec<(i64, i64)>, String> {
    let mut chunks = BTreeSet::new();
    for member in members {
        let (offset_x, offset_y) = lattice_offset(lattice, &member.grid)?;
        let x0 = offset_x;
        let y0 = offset_y;
        let x1 = offset_x + i64::from(member.grid.width);
        let y1 = offset_y + i64::from(member.grid.height);
        if x0 >= x1 || y0 >= y1 {
            continue;
        }
        for chunk_y in y0.div_euclid(CHUNK_SIDE)..=(y1 - 1).div_euclid(CHUNK_SIDE) {
            for chunk_x in x0.div_euclid(CHUNK_SIDE)..=(x1 - 1).div_euclid(CHUNK_SIDE) {
                chunks.insert((chunk_x, chunk_y));
            }
        }
    }
    Ok(chunks.into_iter().collect())
}

/// The lattice grid of one chunk, clipped to the chunk's full square.
pub(super) fn chunk_grid(lattice: &RasterGrid, chunk_x: i64, chunk_y: i64) -> RasterGrid {
    RasterGrid {
        width: CHUNK_SIDE as u32,
        height: CHUNK_SIDE as u32,
        geotransform: [
            lattice.geotransform[0] + chunk_x as f64 * CHUNK_SIDE as f64 * lattice.geotransform[1],
            lattice.geotransform[1],
            0.0,
            lattice.geotransform[3] + chunk_y as f64 * CHUNK_SIDE as f64 * lattice.geotransform[5],
            0.0,
            lattice.geotransform[5],
        ],
    }
}

/// Read one bounded window from a preserved dense generation.
///
/// Legacy values are little-endian Float32 rows and the authoritative mask is
/// one byte per cell; both are read row-wise, never whole.
pub(super) fn read_legacy_window(
    values: &Path,
    mask: &Path,
    grid: &RasterGrid,
    window: RasterWindow,
    cancel: &AtomicBool,
) -> Result<(Vec<f32>, Vec<u8>), String> {
    let cells = validate_member_window(window, grid)?;
    let expected_values = u64::from(grid.width) * u64::from(grid.height) * 4;
    let values_len = std::fs::metadata(values)
        .map_err(|e| format!("Failed to inspect legacy values {}: {e}", values.display()))?
        .len();
    if values_len != expected_values {
        return Err(format!(
            "legacy values {} has {values_len} bytes, expected {expected_values}",
            values.display()
        ));
    }
    let expected_mask = u64::from(grid.width) * u64::from(grid.height);
    let mask_len = std::fs::metadata(mask)
        .map_err(|e| format!("Failed to inspect legacy mask {}: {e}", mask.display()))?
        .len();
    if mask_len != expected_mask {
        return Err(format!(
            "legacy mask {} has {mask_len} bytes, expected {expected_mask}",
            mask.display()
        ));
    }
    let mut values_file = std::fs::File::open(values)
        .map_err(|e| format!("Failed to read legacy values {}: {e}", values.display()))?;
    let mut mask_file = std::fs::File::open(mask)
        .map_err(|e| format!("Failed to read legacy mask {}: {e}", mask.display()))?;
    let row_cells = window.width as usize;
    let mut raw_row = vec![0u8; row_cells * 4];
    let mut mask_row = vec![0u8; row_cells];
    let mut samples = vec![0f32; cells];
    let mut valid = vec![0u8; cells];
    for row in 0..window.height {
        check_cancel(cancel)?;
        let start = u64::from(window.y + row) * u64::from(grid.width) + u64::from(window.x);
        values_file
            .seek(SeekFrom::Start(start * 4))
            .and_then(|_| values_file.read_exact(&mut raw_row))
            .map_err(|e| format!("Failed to read legacy values row: {e}"))?;
        mask_file
            .seek(SeekFrom::Start(start))
            .and_then(|_| mask_file.read_exact(&mut mask_row))
            .map_err(|e| format!("Failed to read legacy mask row: {e}"))?;
        for column in 0..row_cells {
            let index = row as usize * row_cells + column;
            samples[index] = f32::from_le_bytes(
                raw_row[column * 4..column * 4 + 4]
                    .try_into()
                    .map_err(|_| "legacy values row is misaligned".to_string())?,
            );
            valid[index] = u8::from(mask_row[column] != 0);
        }
    }
    Ok((samples, valid))
}

/// Values and validity for one member window.
fn read_member_window(
    member: &ResolvedMember,
    window: RasterWindow,
    cancel: &AtomicBool,
) -> Result<(Vec<f32>, Vec<u8>), String> {
    match &member.source {
        MemberSource::Cog(cog) => {
            let mut reader = PreparedRaster::open_committed(&cog.path, &cog.grid, member.nodata)?;
            let read = reader.read_window(window, cancel)?;
            Ok((read.samples().to_vec(), read.valid().to_vec()))
        }
        MemberSource::LegacyDense { values, mask } => {
            read_legacy_window(values, mask, &member.grid, window, cancel)
        }
    }
}

/// One persisted resolved-chunk reference the reader can select.
#[derive(Debug, Clone)]
pub(super) struct PersistedChunk {
    pub chunk_x: i64,
    pub chunk_y: i64,
    pub asset: CogAsset,
    pub nodata: Option<f32>,
}

/// Read one window from persisted resolved chunks.
///
/// This is the published-generation read path: it never replays member
/// history, never opens a source COG and never touches a coordinate without a
/// chunk row. Absent chunks are invalid coverage; a corrupt asset is an error,
/// not empty coverage.
pub(super) fn read_persisted_window(
    chunks: &[PersistedChunk],
    lattice: &RasterGrid,
    window: LatticeWindow,
    cancel: &AtomicBool,
) -> Result<ResolvedWindow, String> {
    let cells = validate_window(window)?;
    let width = window.width as usize;
    let mut samples = vec![f32::NAN; cells];
    let mut valid = vec![0u8; cells];
    let first_chunk_x = window.x.div_euclid(CHUNK_SIDE);
    let last_chunk_x = (window.x + i64::from(window.width) - 1).div_euclid(CHUNK_SIDE);
    let first_chunk_y = window.y.div_euclid(CHUNK_SIDE);
    let last_chunk_y = (window.y + i64::from(window.height) - 1).div_euclid(CHUNK_SIDE);
    for chunk_y in first_chunk_y..=last_chunk_y {
        for chunk_x in first_chunk_x..=last_chunk_x {
            let Some(chunk) = chunks
                .iter()
                .find(|chunk| chunk.chunk_x == chunk_x && chunk.chunk_y == chunk_y)
            else {
                continue;
            };
            check_cancel(cancel)?;
            let chunk_origin_x = chunk_x * CHUNK_SIDE;
            let chunk_origin_y = chunk_y * CHUNK_SIDE;
            let member_x0 = window.x - chunk_origin_x;
            let member_y0 = window.y - chunk_origin_y;
            let clip_x0 = member_x0.max(0);
            let clip_y0 = member_y0.max(0);
            let clip_x1 =
                (member_x0 + i64::from(window.width)).min(i64::from(chunk.asset.grid.width));
            let clip_y1 =
                (member_y0 + i64::from(window.height)).min(i64::from(chunk.asset.grid.height));
            if clip_x0 >= clip_x1 || clip_y0 >= clip_y1 {
                continue;
            }
            let member_window = RasterWindow {
                x: clip_x0 as u32,
                y: clip_y0 as u32,
                width: (clip_x1 - clip_x0) as u32,
                height: (clip_y1 - clip_y0) as u32,
            };
            let mut reader =
                PreparedRaster::open_committed(&chunk.asset.path, &chunk.asset.grid, chunk.nodata)?;
            let read = reader.read_window(member_window, cancel)?;
            let dest_x = (clip_x0 + chunk_origin_x - window.x) as usize;
            let dest_y = (clip_y0 + chunk_origin_y - window.y) as usize;
            for row in 0..member_window.height as usize {
                for column in 0..member_window.width as usize {
                    let index = row * member_window.width as usize + column;
                    if read.valid()[index] == 0 {
                        continue;
                    }
                    let target = (dest_y + row) * width + dest_x + column;
                    samples[target] = read.samples()[index];
                    valid[target] = 1;
                }
            }
        }
    }
    check_cancel(cancel)?;
    Ok(ResolvedWindow {
        grid: window_grid(lattice, window)?,
        samples,
        valid,
    })
}

/// Read one window of a sparse 0/1 quality mask.
///
/// Absent quality chunks mean quality zero, and a present chunk must hold
/// exact 0/1 samples: a corrupt mask can never read as partial coverage. The
/// returned validity is complete, because quality zero is a value, not a gap.
// Consumed by the bounded display transport's result tiles (`canopi-jv8a.4`,
// B4); until that caller lands the allowance is deliberate.
#[allow(dead_code)]
pub(super) fn read_quality_chunks_window(
    chunks: &[PersistedChunk],
    lattice: &RasterGrid,
    window: LatticeWindow,
    cancel: &AtomicBool,
) -> Result<ResolvedWindow, String> {
    let resolved = read_persisted_window(chunks, lattice, window, cancel)?;
    let mut samples = vec![0f32; resolved.samples.len()];
    for (index, value) in resolved.samples.iter().enumerate() {
        if resolved.valid[index] == 0 {
            continue;
        }
        samples[index] = match *value {
            0.0 => 0.0,
            1.0 => 1.0,
            other => {
                return Err(format!(
                    "quality chunk holds {other} at cell {index}, expected exact 0 or 1"
                ));
            }
        };
    }
    Ok(ResolvedWindow {
        grid: resolved.grid,
        samples,
        valid: vec![1u8; resolved.valid.len()],
    })
}

/// Per-block aggregate of one interpretation's occupied coverage.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct RegionAggregate {
    pub block_x: i64,
    pub block_y: i64,
    pub valid_cells: i64,
    pub min_value: f64,
    pub max_value: f64,
    pub sum_value: f64,
}

/// A prepared, read-only lease over a legacy TIFF-only generation.
///
/// The controlled derivative is prepared once for the whole lease and removed
/// when it drops, so a caller never re-prepares per window. The preserved
/// generation's own mask stays authoritative: it is read independently and
/// overrides the derivative's validity.
#[allow(dead_code)]
pub(super) struct LegacyTiffLease {
    reader: PreparedRaster,
    mask: Option<PathBuf>,
}

// Not yet reachable from a production caller: the sparse reader now serves
// publication, review and undo, but these items belong to the deferred
// legacy-base overlay and the B3/B4 consumers (`canopi-jv8a.4`).
#[allow(dead_code)]
impl LegacyTiffLease {
    pub(super) fn open(
        engine: &super::engine::GdalEngine,
        tiff: &Path,
        grid: &RasterGrid,
        nodata: Option<f32>,
        mask: Option<PathBuf>,
        scratch: &Path,
        cancel: &AtomicBool,
    ) -> Result<Self, String> {
        let reader = PreparedRaster::open(engine, tiff, grid, nodata, 0, scratch, cancel)?;
        Ok(Self { reader, mask })
    }

    pub(super) fn grid(&self) -> &RasterGrid {
        self.reader.grid()
    }

    /// Read one window, applying the authoritative legacy mask when present.
    pub(super) fn read_window(
        &mut self,
        window: RasterWindow,
        cancel: &AtomicBool,
    ) -> Result<(Vec<f32>, Vec<u8>), String> {
        let read = self.reader.read_window(window, cancel)?;
        let samples = read.samples().to_vec();
        let mut valid = read.valid().to_vec();
        if let Some(mask) = &self.mask {
            let authority = read_legacy_mask_window(mask, self.reader.grid(), window, cancel)?;
            for (slot, byte) in valid.iter_mut().zip(authority) {
                *slot = byte;
            }
        }
        Ok((samples, valid))
    }
}

/// Read only the requested rows of a preserved dense mask file.
#[allow(dead_code)]
fn read_legacy_mask_window(
    mask: &Path,
    grid: &RasterGrid,
    window: RasterWindow,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    let cells = validate_member_window(window, grid)?;
    let expected = u64::from(grid.width) * u64::from(grid.height);
    let len = std::fs::metadata(mask)
        .map_err(|e| format!("Failed to inspect legacy mask {}: {e}", mask.display()))?
        .len();
    if len != expected {
        return Err(format!(
            "legacy mask {} has {len} bytes, expected {expected}",
            mask.display()
        ));
    }
    let mut file = std::fs::File::open(mask)
        .map_err(|e| format!("Failed to read legacy mask {}: {e}", mask.display()))?;
    let mut row = vec![0u8; window.width as usize];
    let mut valid = vec![0u8; cells];
    for y in 0..window.height {
        check_cancel(cancel)?;
        let start = u64::from(window.y + y) * u64::from(grid.width) + u64::from(window.x);
        file.seek(SeekFrom::Start(start))
            .and_then(|_| file.read_exact(&mut row))
            .map_err(|e| format!("Failed to read legacy mask row: {e}"))?;
        for (column, byte) in row.iter().enumerate() {
            valid[y as usize * window.width as usize + column] = u8::from(*byte != 0);
        }
    }
    Ok(valid)
}

/// Aggregate one member's occupied coverage into paged 1024×1024 blocks.
///
/// Blocks are visited one bounded window at a time; the member's own extent is
/// enumerated, so absent coordinates outside it are never touched.
#[allow(dead_code)]
pub(super) fn member_regions(
    reader: &mut PreparedRaster,
    lattice: &RasterGrid,
    member_grid: &RasterGrid,
    cancel: &AtomicBool,
) -> Result<Vec<RegionAggregate>, String> {
    let (offset_x, offset_y) = lattice_offset(lattice, member_grid)?;
    let member = ResolvedMember {
        ordinal: 0,
        role: MemberRole::Add,
        grid: member_grid.clone(),
        nodata: None,
        source: MemberSource::LegacyDense {
            values: PathBuf::new(),
            mask: PathBuf::new(),
        },
    };
    let mut regions = Vec::new();
    for (chunk_x, chunk_y) in occupied_chunks(std::slice::from_ref(&member), lattice)? {
        let chunk = chunk_grid(lattice, chunk_x, chunk_y);
        // Clip the chunk to the member's own extent.
        let clip_x0 = (offset_x - chunk_x * CHUNK_SIDE).max(0);
        let clip_y0 = (offset_y - chunk_y * CHUNK_SIDE).max(0);
        let clip_x1 =
            (offset_x + i64::from(member_grid.width) - chunk_x * CHUNK_SIDE).min(CHUNK_SIDE);
        let clip_y1 =
            (offset_y + i64::from(member_grid.height) - chunk_y * CHUNK_SIDE).min(CHUNK_SIDE);
        if clip_x0 >= clip_x1 || clip_y0 >= clip_y1 {
            continue;
        }
        let window = RasterWindow {
            x: clip_x0 as u32,
            y: clip_y0 as u32,
            width: (clip_x1 - clip_x0) as u32,
            height: (clip_y1 - clip_y0) as u32,
        };
        let _ = chunk;
        let read = reader.read_window(window, cancel)?;
        let mut aggregate = RegionAggregate {
            block_x: chunk_x,
            block_y: chunk_y,
            valid_cells: 0,
            min_value: f64::INFINITY,
            max_value: f64::NEG_INFINITY,
            sum_value: 0.0,
        };
        for (value, valid) in read.samples().iter().zip(read.valid().iter()) {
            if *valid == 0 {
                continue;
            }
            aggregate.valid_cells += 1;
            aggregate.min_value = aggregate.min_value.min(*value as f64);
            aggregate.max_value = aggregate.max_value.max(*value as f64);
            aggregate.sum_value += *value as f64;
        }
        if aggregate.valid_cells == 0 {
            aggregate.min_value = 0.0;
            aggregate.max_value = 0.0;
        }
        regions.push(aggregate);
    }
    Ok(regions)
}

/// One materialized resolved chunk: its asset plus its aggregate.
#[derive(Debug, Clone)]
pub(super) struct MaterializedChunk {
    pub chunk_x: i64,
    pub chunk_y: i64,
    pub asset: CogAsset,
    pub aggregate: RegionAggregate,
}

/// Materialize every occupied chunk of an ordered sequence as a standard COG.
///
/// This is the publication step: each occupied chunk is resolved once through
/// the ordered-occurrence replay, written as a resolved NaN-NoData COG, and
/// aggregated for the index. Chunks the sequence does not occupy are never
/// visited or written, and no union-sized file is produced.
#[allow(clippy::too_many_arguments)]
pub(super) fn materialize_generation_chunks(
    engine: &super::engine::GdalEngine,
    cancel: &AtomicBool,
    paths: &super::paths::LidarPaths,
    scratch: &Path,
    members: &[ResolvedMember],
    lattice: &RasterGrid,
    crs_wkt: &str,
    stem: &str,
) -> Result<Vec<MaterializedChunk>, String> {
    let mut materialized = Vec::new();
    for (chunk_x, chunk_y) in occupied_chunks(members, lattice)? {
        check_cancel(cancel)?;
        let grid = chunk_grid(lattice, chunk_x, chunk_y);
        let resolved = resolve_window(
            members,
            lattice,
            LatticeWindow {
                x: chunk_x * CHUNK_SIDE,
                y: chunk_y * CHUNK_SIDE,
                width: CHUNK_SIDE as u32,
                height: CHUNK_SIDE as u32,
            },
            cancel,
        )?;
        let mut aggregate = RegionAggregate {
            block_x: chunk_x,
            block_y: chunk_y,
            valid_cells: 0,
            min_value: f64::INFINITY,
            max_value: f64::NEG_INFINITY,
            sum_value: 0.0,
        };
        for (value, valid) in resolved.samples.iter().zip(resolved.valid.iter()) {
            if *valid == 0 {
                continue;
            }
            aggregate.valid_cells += 1;
            aggregate.min_value = aggregate.min_value.min(*value as f64);
            aggregate.max_value = aggregate.max_value.max(*value as f64);
            aggregate.sum_value += *value as f64;
        }
        if aggregate.valid_cells == 0 {
            // An all-invalid chunk has no index entry: absent means invalid.
            continue;
        }
        let asset = super::raster_assets::write_cog_asset(
            engine,
            cancel,
            paths,
            scratch,
            &format!("{stem}-{chunk_x}-{chunk_y}"),
            &grid,
            crs_wkt,
            Some(f32::NAN),
            &resolved.samples,
        )?;
        materialized.push(MaterializedChunk {
            chunk_x,
            chunk_y,
            asset,
            aggregate,
        });
    }
    Ok(materialized)
}

/// Lattice cells from the layer anchor to a member grid's first cell.
fn lattice_offset(lattice: &RasterGrid, grid: &RasterGrid) -> Result<(i64, i64), String> {
    lattice.compatible(grid)?;
    let pixel_x = lattice.geotransform[1];
    let pixel_y = lattice.geotransform[5].abs();
    if pixel_x <= 0.0 || pixel_y <= 0.0 {
        return Err("layer lattice has a degenerate pixel size".to_string());
    }
    let offset_x = (grid.geotransform[0] - lattice.geotransform[0]) / pixel_x;
    let offset_y = (lattice.geotransform[3] - grid.geotransform[3]) / pixel_y;
    if !offset_x.is_finite() || !offset_y.is_finite() {
        return Err("member grid offset is not representable".to_string());
    }
    Ok((offset_x.round() as i64, offset_y.round() as i64))
}

pub(super) fn window_grid(
    lattice: &RasterGrid,
    window: LatticeWindow,
) -> Result<RasterGrid, String> {
    let origin_x = lattice.geotransform[0] + window.x as f64 * lattice.geotransform[1];
    let origin_y = lattice.geotransform[3] + window.y as f64 * lattice.geotransform[5];
    if !origin_x.is_finite() || !origin_y.is_finite() {
        return Err("window origin is not representable".to_string());
    }
    Ok(RasterGrid {
        width: window.width,
        height: window.height,
        geotransform: [
            origin_x,
            lattice.geotransform[1],
            0.0,
            origin_y,
            0.0,
            lattice.geotransform[5],
        ],
    })
}

fn validate_window(window: LatticeWindow) -> Result<usize, String> {
    if window.width == 0 || window.height == 0 {
        return Err("lattice window must not be empty".to_string());
    }
    if i64::from(window.width) > MAX_WINDOW_SIDE || i64::from(window.height) > MAX_WINDOW_SIDE {
        return Err(format!(
            "lattice window {}x{} exceeds the {MAX_WINDOW_SIDE}x{MAX_WINDOW_SIDE} window cap",
            window.width, window.height
        ));
    }
    usize::try_from(u64::from(window.width) * u64::from(window.height))
        .map_err(|_| "lattice window is too large for this platform".to_string())
}

fn validate_member_window(window: RasterWindow, grid: &RasterGrid) -> Result<usize, String> {
    if window.width == 0 || window.height == 0 {
        return Err("raster window must not be empty".to_string());
    }
    let x_end = window
        .x
        .checked_add(window.width)
        .ok_or_else(|| "raster window x range overflows".to_string())?;
    let y_end = window
        .y
        .checked_add(window.height)
        .ok_or_else(|| "raster window y range overflows".to_string())?;
    if x_end > grid.width || y_end > grid.height {
        return Err(format!(
            "raster window {}x{}+{}+{} is outside the {}x{} grid",
            window.width, window.height, window.x, window.y, grid.width, grid.height
        ));
    }
    usize::try_from(u64::from(window.width) * u64::from(window.height))
        .map_err(|_| "raster window is too large for this platform".to_string())
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }
    Ok(())
}

/// Whether new publications may use sparse resolved chunks.
///
/// The chunked format is **not** enabled in production yet: the slope reader
/// (B3) and the bounded display transport (B4) that must consume a chunked
/// head are not migrated, so publishing one would leave a layer whose map
/// display no accepted reader can render. Caller-level tests enable it for
/// their own thread through [`chunked_publication`]; nothing in a production
/// build can turn it on, and every caller must keep working when it is off.
#[cfg(not(test))]
pub(super) const fn chunked_publication_enabled() -> bool {
    false
}

#[cfg(test)]
pub(super) fn chunked_publication_enabled() -> bool {
    chunked_publication::enabled()
}

/// Test-only seam for the storage format switch.
///
/// Mirrors `paths::capacity_probe`: the decision stays production code and
/// only the switch is overridden per thread, so a test exercises the same
/// publication path a production caller would take.
#[cfg(test)]
pub(super) mod chunked_publication {
    use std::cell::Cell;

    thread_local! {
        static ENABLED: Cell<bool> = const { Cell::new(false) };
    }

    pub(super) fn enabled() -> bool {
        ENABLED.with(Cell::get)
    }

    /// Publish in the chunked format until the guard is dropped.
    pub(crate) fn enable() -> Guard {
        ENABLED.with(|slot| slot.set(true));
        Guard
    }

    pub(crate) struct Guard;

    impl Drop for Guard {
        fn drop(&mut self) {
            ENABLED.with(|slot| slot.set(false));
        }
    }
}

/// Resolve one catalogue asset row into a readable, non-deleting COG handle.
pub(super) fn cog_from_row(
    paths: &LidarPaths,
    row: &catalogue::RasterAssetRow,
) -> Result<CogAsset, String> {
    let grid = RasterGrid {
        width: u32::try_from(row.width)
            .map_err(|_| format!("asset {} has a negative width", row.sha256))?,
        height: u32::try_from(row.height)
            .map_err(|_| format!("asset {} has a negative height", row.sha256))?,
        geotransform: super::import::parse_geotransform(&row.geotransform)?,
    };
    Ok(CogAsset {
        sha256: row.sha256.clone(),
        path: paths.root().join(&row.rel_path),
        bytes: u64::try_from(row.bytes).unwrap_or(0),
        grid,
        nodata: row.nodata.map(|value| value as f32),
    })
}

/// Record one created asset so chunk rows may reference its digest.
pub(super) fn asset_row(
    paths: &LidarPaths,
    asset: &CogAsset,
    crs_wkt: &str,
) -> Result<catalogue::RasterAssetRow, String> {
    let rel_path = asset
        .path
        .strip_prefix(paths.root())
        .map_err(|_| format!("asset {} is outside the library root", asset.path.display()))?
        .to_string_lossy()
        .into_owned();
    Ok(catalogue::RasterAssetRow {
        sha256: asset.sha256.clone(),
        rel_path,
        bytes: i64::try_from(asset.bytes).unwrap_or(i64::MAX),
        profile: super::raster_assets::COG_PROFILE.to_string(),
        width: i64::from(asset.grid.width),
        height: i64::from(asset.grid.height),
        geotransform: super::import::format_geotransform(asset.grid.geotransform),
        crs_wkt: crs_wkt.to_string(),
        nodata: asset.nodata.map(f64::from),
    })
}

/// Published resolved chunks of one generation and role, ready for the read
/// path. Absent chunks stay invalid coverage.
pub(super) fn persisted_chunks(
    connection: &Connection,
    paths: &LidarPaths,
    generation_id: &str,
    role: &str,
) -> Result<Vec<PersistedChunk>, String> {
    let rows = catalogue::generation_chunk_assets(connection, generation_id, role)?;
    let mut chunks = Vec::with_capacity(rows.len());
    for row in rows {
        let asset = cog_from_row(paths, &row.asset)?;
        chunks.push(PersistedChunk {
            chunk_x: row.chunk_x,
            chunk_y: row.chunk_y,
            nodata: asset.nodata,
            asset,
        });
    }
    Ok(chunks)
}

/// The retained standard COG of one prepared interpretation, when present.
pub(super) fn retained_cog(
    connection: &Connection,
    paths: &LidarPaths,
    interpretation_id: &str,
) -> Result<Option<(CogAsset, Option<f32>)>, String> {
    match catalogue::interpretation_cog(connection, interpretation_id)? {
        Some((row, nodata)) => Ok(Some((
            cog_from_row(paths, &row)?,
            nodata.map(|value| value as f32),
        ))),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::lidar::engine::GdalEngine;
    use crate::services::lidar::paths::LidarPaths;
    use crate::services::lidar::raster_assets::write_cog_asset;

    fn cancellation() -> AtomicBool {
        AtomicBool::new(false)
    }

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "canopi-resolver-{label}-{}-{}",
            std::process::id(),
            crate::services::lidar::catalogue::new_id("t")
        ));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn lattice() -> RasterGrid {
        RasterGrid {
            width: 1,
            height: 1,
            geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
        }
    }

    /// A member whose origin sits `x`/`y` lattice cells from the anchor; `y`
    /// grows downward, so a negative `y` places it above the anchor.
    fn member_grid(x: i64, y: i64, width: u32, height: u32) -> RasterGrid {
        RasterGrid {
            width,
            height,
            geotransform: [x as f64, 1.0, 0.0, -(y as f64), 0.0, -1.0],
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn cog_member(
        engine: &GdalEngine,
        paths: &LidarPaths,
        dir: &Path,
        name: &str,
        x: i64,
        y: i64,
        width: u32,
        height: u32,
        value: f32,
        hole: Option<(u32, u32)>,
    ) -> ResolvedMember {
        let grid = member_grid(x, y, width, height);
        let mut values = vec![value; (width * height) as usize];
        if let Some((hx, hy)) = hole {
            values[(hy * width + hx) as usize] = f32::NAN;
        }
        let asset = write_cog_asset(
            engine,
            &cancellation(),
            paths,
            dir,
            name,
            &grid,
            "EPSG:3857",
            Some(f32::NAN),
            &values,
        )
        .expect("member COG is created");
        ResolvedMember {
            ordinal: 0,
            role: MemberRole::Add,
            grid,
            nodata: Some(f32::NAN),
            source: MemberSource::Cog(asset),
        }
    }

    fn full_window(x: i64, y: i64, width: u32, height: u32) -> LatticeWindow {
        LatticeWindow {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn ordered_replay_paints_replaces_and_undoes_occurrences() {
        let engine = GdalEngine::new();
        let dir = scratch("replay");
        let paths = LidarPaths::open(&dir).unwrap();
        let lattice = lattice();
        let window = full_window(0, 0, 2, 2);

        let mut first = cog_member(&engine, &paths, &dir, "a", 0, 0, 2, 2, 5.0, None);
        first.ordinal = 0;
        let mut second = cog_member(&engine, &paths, &dir, "b", 0, 0, 2, 2, 9.0, None);
        second.ordinal = 1;
        second.role = MemberRole::Replace;

        let resolved = resolve_window(
            &[first.clone(), second.clone()],
            &lattice,
            window,
            &cancellation(),
        )
        .expect("replace wins");
        assert!(resolved.samples.iter().all(|value| *value == 9.0));
        assert!(resolved.valid.iter().all(|valid| *valid == 1));

        // Reimporting the first source with replacement paints it back.
        let mut reimport = first.clone();
        reimport.ordinal = 2;
        reimport.role = MemberRole::Replace;
        let resolved = resolve_window(
            &[first.clone(), second.clone(), reimport],
            &lattice,
            window,
            &cancellation(),
        )
        .expect("reimport wins");
        assert!(resolved.samples.iter().all(|value| *value == 5.0));

        // Undo drops that occurrence and the previous winner returns.
        let resolved =
            resolve_window(&[first, second], &lattice, window, &cancellation()).expect("undo");
        assert!(resolved.samples.iter().all(|value| *value == 9.0));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn add_only_and_incoming_holes_never_erase_prior_coverage() {
        let engine = GdalEngine::new();
        let dir = scratch("add-only");
        let paths = LidarPaths::open(&dir).unwrap();
        let lattice = lattice();
        let window = full_window(0, 0, 2, 2);

        let mut hole = cog_member(&engine, &paths, &dir, "hole", 0, 0, 2, 2, 7.0, Some((1, 1)));
        hole.ordinal = 1;
        hole.role = MemberRole::Add;
        let resolved = resolve_window(&[hole.clone()], &lattice, window, &cancellation()).unwrap();
        // The hole is invalid and was never covered.
        assert_eq!(resolved.valid, vec![1, 1, 1, 0]);
        assert_eq!(resolved.samples[0], 7.0);

        let mut fill = cog_member(&engine, &paths, &dir, "fill", 0, 0, 2, 2, 3.0, None);
        fill.ordinal = 0;
        fill.role = MemberRole::Add;
        let resolved = resolve_window(&[fill, hole], &lattice, window, &cancellation()).unwrap();
        // Add fills only the hole; the earlier value survives everywhere else.
        assert_eq!(resolved.valid, vec![1, 1, 1, 1]);
        assert_eq!(resolved.samples, vec![3.0, 3.0, 3.0, 3.0]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn replace_overlap_cannot_create_new_coverage() {
        let engine = GdalEngine::new();
        let dir = scratch("replace-overlap");
        let paths = LidarPaths::open(&dir).unwrap();
        let lattice = lattice();
        let window = full_window(0, 0, 2, 2);

        let mut overlap = cog_member(&engine, &paths, &dir, "overlap", 0, 0, 2, 2, 4.0, None);
        overlap.ordinal = 0;
        overlap.role = MemberRole::ReplaceOverlap;
        let resolved =
            resolve_window(&[overlap.clone()], &lattice, window, &cancellation()).unwrap();
        assert!(resolved.valid.iter().all(|valid| *valid == 0));

        let mut base = cog_member(&engine, &paths, &dir, "base", 0, 0, 1, 1, 2.0, None);
        base.ordinal = 0;
        base.role = MemberRole::Add;
        overlap.ordinal = 1;
        let resolved = resolve_window(&[base, overlap], &lattice, window, &cancellation()).unwrap();
        // Only the already-covered cell is repainted; nothing new is created.
        assert_eq!(resolved.valid, vec![1, 0, 0, 0]);
        assert_eq!(resolved.samples[0], 4.0);
        assert!(resolved.samples[1..].iter().all(|value| value.is_nan()));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn members_above_and_left_of_the_anchor_resolve_signed_lattice_cells() {
        let engine = GdalEngine::new();
        let dir = scratch("negative");
        let paths = LidarPaths::open(&dir).unwrap();
        let lattice = lattice();
        // Two cells up and two cells left of the anchor.
        let mut upper = cog_member(&engine, &paths, &dir, "upper", -2, -2, 2, 2, 11.0, None);
        upper.ordinal = 0;
        let window = full_window(-2, -2, 4, 4);
        let resolved = resolve_window(&[upper.clone()], &lattice, window, &cancellation()).unwrap();
        assert_eq!(resolved.grid.geotransform[0], -2.0);
        assert_eq!(resolved.grid.geotransform[3], 2.0);
        assert_eq!(
            resolved.valid,
            vec![1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
        assert_eq!(resolved.samples[0], 11.0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn occupied_chunks_skip_the_gap_between_distant_members() {
        let lattice = lattice();
        let mut first = ResolvedMember {
            ordinal: 0,
            role: MemberRole::Add,
            grid: member_grid(0, 0, 4, 3),
            nodata: None,
            source: MemberSource::LegacyDense {
                values: PathBuf::new(),
                mask: PathBuf::new(),
            },
        };
        let mut second = first.clone();
        second.ordinal = 1;
        // One million cells to the right, far outside the first member's chunk.
        second.grid = member_grid(1_000_000, 0, 4, 3);
        let adjacent = occupied_chunks(&[first.clone()], &lattice).unwrap();
        let distant = occupied_chunks(&[first.clone(), second], &lattice).unwrap();
        assert_eq!(adjacent.len(), 1);
        assert_eq!(distant.len(), 2, "only occupied chunks are enumerated");
        // A member straddling a chunk edge occupies both of its chunks.
        first.grid = member_grid(1023, 0, 4, 3);
        let straddling = occupied_chunks(&[first], &lattice).unwrap();
        assert_eq!(straddling, vec![(0, 0), (1, 0)]);
    }

    #[test]
    fn legacy_dense_windows_read_exact_rows_and_masks() {
        let dir = scratch("legacy");
        let grid = member_grid(0, 0, 4, 3);
        let values: Vec<f32> = (0..12).map(|index| index as f32 * 0.5).collect();
        let mut raw = Vec::new();
        for value in &values {
            raw.extend_from_slice(&value.to_le_bytes());
        }
        let values_path = dir.join("values.raw");
        std::fs::write(&values_path, &raw).unwrap();
        let mask_path = dir.join("valid.bin");
        std::fs::write(&mask_path, [1u8, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1]).unwrap();

        let window = RasterWindow {
            x: 1,
            y: 1,
            width: 2,
            height: 2,
        };
        let (samples, valid) =
            read_legacy_window(&values_path, &mask_path, &grid, window, &cancellation()).unwrap();
        assert_eq!(samples, vec![2.5, 3.0, 4.5, 5.0]);
        assert_eq!(valid, vec![1, 1, 0, 0]);

        let short = dir.join("short.raw");
        std::fs::write(&short, b"too short").unwrap();
        let error = read_legacy_window(&short, &mask_path, &grid, window, &cancellation())
            .expect_err("a short legacy file must fail");
        assert!(error.contains("expected 48"), "{error}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn windows_and_ordinals_are_validated_before_reading() {
        let lattice = lattice();
        let member = ResolvedMember {
            ordinal: 0,
            role: MemberRole::Add,
            grid: member_grid(0, 0, 2, 2),
            nodata: None,
            source: MemberSource::LegacyDense {
                values: PathBuf::new(),
                mask: PathBuf::new(),
            },
        };
        let error = resolve_window(
            std::slice::from_ref(&member),
            &lattice,
            full_window(0, 0, 0, 4),
            &cancellation(),
        )
        .expect_err("empty windows are rejected");
        assert!(error.contains("must not be empty"), "{error}");

        let error = resolve_window(
            std::slice::from_ref(&member),
            &lattice,
            full_window(0, 0, 1027, 1),
            &cancellation(),
        )
        .expect_err("oversized windows are rejected");
        assert!(error.contains("window cap"), "{error}");

        let mut later = member.clone();
        later.ordinal = 5;
        let error = resolve_window(
            &[later, member.clone()],
            &lattice,
            full_window(0, 0, 1, 1),
            &cancellation(),
        )
        .expect_err("ordinal order is enforced");
        assert!(error.contains("out of order"), "{error}");

        let misaligned = ResolvedMember {
            grid: RasterGrid {
                width: 2,
                height: 2,
                geotransform: [0.5, 1.0, 0.0, 0.0, 0.0, -1.0],
            },
            ..member.clone()
        };
        let error = resolve_window(
            &[misaligned],
            &lattice,
            full_window(0, 0, 1, 1),
            &cancellation(),
        )
        .expect_err("unaligned member grids are rejected");
        assert!(error.contains("aligned"), "{error}");
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn legacy_tiff_lease_reads_windows_with_the_authoritative_mask() {
        use crate::services::lidar::import::{raw_to_tif, write_f32_raw};
        let engine = GdalEngine::new();
        let dir = scratch("legacy-tiff");
        let grid = member_grid(0, 0, 4, 3);
        let values: Vec<f32> = vec![0.0, -1.0, 5.0, 7.0, 1.0, 2.0, 3.0, 4.0, 9.0, 8.0, 6.0, 5.0];
        let raw = dir.join("legacy.raw");
        write_f32_raw(&raw, &values).unwrap();
        let tiff = dir.join("legacy.tif");
        raw_to_tif(
            &engine,
            &cancellation(),
            &raw,
            &tiff,
            &grid,
            "EPSG:3857",
            -9999.0,
        )
        .unwrap();
        // The preserved generation's own mask is authoritative and disagrees
        // with the numeric samples on purpose.
        let mask = dir.join("legacy-mask.bin");
        std::fs::write(&mask, [1u8, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1]).unwrap();

        let mut lease = LegacyTiffLease::open(
            &engine,
            &tiff,
            &grid,
            Some(-9999.0),
            Some(mask.clone()),
            &dir,
            &cancellation(),
        )
        .expect("legacy lease prepares once");
        let window = RasterWindow {
            x: 1,
            y: 0,
            width: 2,
            height: 2,
        };
        let (samples, valid) = lease.read_window(window, &cancellation()).unwrap();
        assert_eq!(samples, vec![-1.0, 5.0, 2.0, 3.0]);
        assert_eq!(
            valid,
            vec![0, 1, 1, 0],
            "the legacy mask overrides validity"
        );
        let prepared: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("prepared-"))
            .collect();
        assert!(
            prepared.len() == 1,
            "one derivative per lease: {prepared:?}"
        );
        drop(lease);
        let left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("prepared-"))
            .collect();
        assert!(
            left.is_empty(),
            "the lease removes its derivative: {left:?}"
        );

        // A legacy TIFF is not a controlled COG, which is exactly why the
        // lease prepares a derivative once instead of reading it directly.
        let rejected = PreparedRaster::open_committed(&tiff, &grid, Some(-9999.0))
            .expect_err("a legacy TIFF is rejected by the committed-profile check");
        assert!(rejected.contains("uncompressed"), "{rejected}");

        // Region aggregates cover only the member's occupied chunk.
        let mut reader = PreparedRaster::open(
            &engine,
            &tiff,
            &grid,
            Some(-9999.0),
            0,
            &dir,
            &cancellation(),
        )
        .unwrap();
        let regions = member_regions(&mut reader, &lattice(), &grid, &cancellation()).unwrap();
        assert_eq!(regions.len(), 1, "one occupied chunk");
        let region = &regions[0];
        assert_eq!((region.block_x, region.block_y), (0, 0));
        // Every authored sample is finite and differs from the declared NoData.
        assert_eq!(region.valid_cells, 12);
        assert_eq!(region.min_value, -1.0);
        assert_eq!(region.max_value, 9.0);
        let expected_sum: f64 = values.iter().map(|value| f64::from(*value)).sum();
        assert_eq!(region.sum_value, expected_sum);
        drop(reader);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn persisted_chunks_are_read_directly_and_absent_chunks_are_invalid() {
        let engine = GdalEngine::new();
        let dir = scratch("persisted");
        let paths = LidarPaths::open(&dir).unwrap();
        let lattice = lattice();
        let chunk_side = CHUNK_SIDE as u32;
        let mut chunks = Vec::new();
        for (chunk_x, value) in [(0i64, 1.0f32), (2i64, 3.0f32)] {
            let grid = chunk_grid(&lattice, chunk_x, 0);
            let values = vec![value; (chunk_side * chunk_side) as usize];
            let asset = write_cog_asset(
                &engine,
                &cancellation(),
                &paths,
                &dir,
                &format!("chunk-{chunk_x}"),
                &grid,
                "EPSG:3857",
                Some(f32::NAN),
                &values,
            )
            .unwrap();
            chunks.push(PersistedChunk {
                chunk_x,
                chunk_y: 0,
                asset,
                nodata: Some(f32::NAN),
            });
        }

        // A window inside the first chunk.
        let first =
            read_persisted_window(&chunks, &lattice, full_window(0, 0, 4, 3), &cancellation())
                .unwrap();
        assert_eq!(first.valid, vec![1; 12]);
        assert!(first.samples.iter().all(|value| *value == 1.0));

        // The gap between chunk 0 and chunk 2 has no row: exact invalid mask,
        // and no member replay or absent-coordinate walk produces coverage.
        let gap = read_persisted_window(
            &chunks,
            &lattice,
            full_window(1024, 0, 4, 3),
            &cancellation(),
        )
        .unwrap();
        assert!(gap.valid.iter().all(|valid| *valid == 0));
        assert!(gap.samples.iter().all(|value| value.is_nan()));

        // The distant chunk reads its own persisted bytes.
        let far = read_persisted_window(
            &chunks,
            &lattice,
            full_window(2 * CHUNK_SIDE, 0, 4, 3),
            &cancellation(),
        )
        .unwrap();
        assert!(far.samples.iter().all(|value| *value == 3.0));

        // A truncated asset is an error, never empty coverage.
        let corrupted = chunks.clone();
        let path = corrupted[0].asset.path.clone();
        let bytes = std::fs::read(&path).unwrap();
        std::fs::write(&path, &bytes[..bytes.len() / 2]).unwrap();
        let error = read_persisted_window(
            &corrupted,
            &lattice,
            full_window(0, 0, 4, 3),
            &cancellation(),
        )
        .expect_err("a corrupt chunk must fail the read");
        assert!(!error.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn materialized_chunks_publish_and_read_back_without_member_replay() {
        let engine = GdalEngine::new();
        let dir = scratch("materialize");
        let registry = LidarPaths::open(&dir).unwrap();
        let lattice = lattice();

        // Add A=5, then replace B=9 across the same cells.
        let mut first = cog_member(&engine, &registry, &dir, "a", 0, 0, 4, 3, 5.0, None);
        first.ordinal = 0;
        let mut second = cog_member(&engine, &registry, &dir, "b", 0, 0, 4, 3, 9.0, None);
        second.ordinal = 1;
        second.role = MemberRole::Replace;

        let chunks = materialize_generation_chunks(
            &engine,
            &cancellation(),
            &registry,
            &dir,
            &[first, second],
            &lattice,
            "EPSG:3857",
            "gen",
        )
        .expect("chunks materialize");
        assert_eq!(chunks.len(), 1, "one occupied chunk for a 4x3 sequence");
        assert_eq!(chunks[0].aggregate.valid_cells, 12);
        assert_eq!(chunks[0].aggregate.min_value, 9.0);
        assert_eq!(chunks[0].aggregate.sum_value, 108.0);

        // The published read path uses only the persisted chunk rows.
        let persisted: Vec<PersistedChunk> = chunks
            .iter()
            .map(|chunk| PersistedChunk {
                chunk_x: chunk.chunk_x,
                chunk_y: chunk.chunk_y,
                asset: chunk.asset.clone(),
                nodata: Some(f32::NAN),
            })
            .collect();
        let read = read_persisted_window(
            &persisted,
            &lattice,
            full_window(0, 0, 4, 3),
            &cancellation(),
        )
        .unwrap();
        assert!(read.valid.iter().all(|valid| *valid == 1));
        assert!(read.samples.iter().all(|value| *value == 9.0));

        // A distant second member adds only its own chunk.
        let mut far = cog_member(
            &engine, &registry, &dir, "far", 1_000_000, 0, 4, 3, 2.0, None,
        );
        far.ordinal = 0;
        let mut near = cog_member(&engine, &registry, &dir, "near", 0, 0, 4, 3, 1.0, None);
        near.ordinal = 0;
        let sparse = materialize_generation_chunks(
            &engine,
            &cancellation(),
            &registry,
            &dir,
            &[near, far],
            &lattice,
            "EPSG:3857",
            "sparse",
        )
        .unwrap();
        assert_eq!(sparse.len(), 2, "only the two occupied chunks are written");
        let _ = std::fs::remove_dir_all(dir);
    }
}
