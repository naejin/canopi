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
use std::sync::Arc;
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
#[derive(Clone)]
pub(super) enum MemberSource {
    /// Retained standard COG for this interpretation.
    Cog(CogAsset),
    /// Preserved dense generation assets, read through the bounded adapter.
    LegacyDense { values: PathBuf, mask: PathBuf },
    /// A preserved immutable generation replayed as one indivisible member.
    ///
    /// An ordered collection exposes a pre-transition head as a single
    /// "previous composition" occurrence: its internals are never reordered,
    /// and the reader visits only the windows this composition asks for.
    Preserved(Arc<PreservedGeneration>),
    /// A preserved dense generation read through one prepared lease.
    ///
    /// The lease is owned by the library, not by the member: a dense mosaic is
    /// not in the controlled COG profile, so it needs one GDAL derivative, and
    /// preparing it per read would cost a conversion per window. The library's
    /// compatibility cache is the single lifecycle owner.
    LegacyHead(Arc<std::sync::Mutex<Option<LegacyTiffLease>>>),
}

/// A preserved generation read as one member of an ordered collection.
pub(super) struct PreservedGeneration {
    library: super::LidarLibrary,
    owner: GenerationChunkReader,
    grid: RasterGrid,
}

impl PreservedGeneration {
    /// Bind the published resolved chunks of a preserved generation.
    pub(super) fn chunks(
        library: &super::LidarLibrary,
        generation_id: &str,
        role: &str,
        grid: RasterGrid,
    ) -> Self {
        Self {
            library: library.clone(),
            owner: GenerationChunkReader::new(generation_id, role),
            grid,
        }
    }

    fn read(
        &self,
        window: RasterWindow,
        cancel: &AtomicBool,
    ) -> Result<(Vec<f32>, Vec<u8>), String> {
        let resolved = self.owner.read_window(
            &self.library,
            &self.grid,
            LatticeWindow {
                x: i64::from(window.x),
                y: i64::from(window.y),
                width: window.width,
                height: window.height,
            },
            cancel,
        )?;
        Ok((resolved.samples, resolved.valid))
    }
}

/// One ordered occurrence available for replay.
#[derive(Clone)]
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
    // The window's own grid: no production caller reads it yet, because the
    // display/legacy-base consumers that need it are deferred (`canopi-jv8a.4`).
    #[allow(dead_code)]
    pub grid: RasterGrid,
    pub samples: Vec<f32>,
    pub valid: Vec<u8>,
}

impl ResolvedWindow {
    // Test-only convenience: production callers read `samples`/`valid` directly.
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

/// One immutable ordered source collection, read in bounded windows.
///
/// A Data Layer is an ordered list of independently prepared source COGs; its
/// numeric value is the highest-priority valid sample at each location, and
/// NoData reveals a valid sample below. Nothing is materialized: display,
/// review and slope all resolve the same member list on demand, so a new
/// snapshot costs member metadata rather than a merged elevation raster.
///
/// `members` is held in resolver iteration order — bottom-most first — so the
/// existing ordered replay applies one uniform "paint the valid samples"
/// rule and the highest-priority source wins by being painted last. The
/// top-first list the UI and transport show is this list reversed; that
/// conversion is internal and never persisted twice.
#[derive(Clone)]
pub(super) struct CollectionReader {
    members: Vec<ResolvedMember>,
    /// Stable occurrence identity of `members`, parallel to it.
    /// The layer's fixed lattice, which every member coordinate is relative to.
    lattice: RasterGrid,
    /// The composition's occupied 1024-cell blocks, in lattice coordinates.
    ///
    /// Derived once from member extents: it is coordinates only, opens no
    /// raster, and lets a reader answer "does this block hold coverage?" from
    /// memory instead of consulting a store that does not exist.
    occupied: Vec<(i64, i64)>,
}

impl CollectionReader {
    /// Bind one snapshot's top-first member list.
    pub(super) fn new(
        members: Vec<(String, ResolvedMember)>,
        lattice: RasterGrid,
    ) -> Result<Self, String> {
        let mut ordered = Vec::with_capacity(members.len());
        // Reverse into resolver iteration order and renumber the ordinals, so
        // the ascending-ordinal precondition holds without a second ordering
        // concept.
        for (index, (_member_id, mut member)) in members.into_iter().rev().enumerate() {
            member.ordinal = i64::try_from(index).unwrap_or(i64::MAX);
            ordered.push(member);
        }
        let occupied = occupied_chunks(&ordered, &lattice)?;
        Ok(Self {
            members: ordered,
            lattice,
            occupied,
        })
    }

    /// The occurrence list in resolver iteration order (bottom-most first).
    ///
    /// Slope reuses it so analysis reads the same composed window the display
    /// does, rather than a stack of independently computed per-file slopes.
    pub(super) fn resolved(&self) -> &[ResolvedMember] {
        &self.members
    }

    /// Occupied 1024-cell lattice chunks of the current composition.
    ///
    /// Arithmetic over member extents only: the empty space between separated
    /// sources never contributes, and no raster is opened.
    pub(super) fn occupied_chunks(&self) -> Result<Vec<(i64, i64)>, String> {
        Ok(self.occupied.clone())
    }

    /// Whether one lattice block holds any of the composition's coverage.
    pub(super) fn is_occupied(&self, chunk_x: i64, chunk_y: i64) -> bool {
        self.occupied.binary_search(&(chunk_x, chunk_y)).is_ok()
    }

    /// Resolve one bounded window of the composed value.
    pub(super) fn read_window(
        &self,
        window: LatticeWindow,
        cancel: &AtomicBool,
    ) -> Result<ResolvedWindow, String> {
        resolve_window(&self.members, &self.lattice, window, cancel)
    }

    /// Exact valid-cell count and f64 sum over one reduced footprint.
    ///
    /// A collection has no stored per-chunk aggregates, so the footprint is
    /// answered from its **occupied chunks**: each chunk the footprint
    /// intersects is resolved once in a bounded window, and the empty space
    /// inside the footprint contributes nothing. Work therefore follows the
    /// stored coverage rather than the footprint's own area, which is what
    /// keeps a deeply minified display tile affordable.
    pub(super) fn aggregate(
        &self,
        rect: LatticeWindow,
        cancel: &AtomicBool,
    ) -> Result<Option<BlockAggregate>, String> {
        let end_x = rect
            .x
            .checked_add(i64::from(rect.width))
            .ok_or_else(|| "reduction footprint overflows".to_string())?;
        let end_y = rect
            .y
            .checked_add(i64::from(rect.height))
            .ok_or_else(|| "reduction footprint overflows".to_string())?;
        let mut total = BlockAggregate {
            sum_value: 0.0,
            valid_cells: 0,
        };
        for (chunk_x, chunk_y) in self.occupied_chunks()? {
            let origin_x = chunk_x
                .checked_mul(CHUNK_SIDE)
                .ok_or_else(|| "chunk origin overflows".to_string())?;
            let origin_y = chunk_y
                .checked_mul(CHUNK_SIDE)
                .ok_or_else(|| "chunk origin overflows".to_string())?;
            let clip_x0 = rect.x.max(origin_x);
            let clip_y0 = rect.y.max(origin_y);
            let clip_x1 = end_x.min(origin_x + CHUNK_SIDE);
            let clip_y1 = end_y.min(origin_y + CHUNK_SIDE);
            if clip_x0 >= clip_x1 || clip_y0 >= clip_y1 {
                continue;
            }
            check_cancel(cancel)?;
            let window = resolve_window(
                &self.members,
                &self.lattice,
                LatticeWindow {
                    x: clip_x0,
                    y: clip_y0,
                    width: u32::try_from(clip_x1 - clip_x0)
                        .map_err(|_| "reduction window is too wide".to_string())?,
                    height: u32::try_from(clip_y1 - clip_y0)
                        .map_err(|_| "reduction window is too tall".to_string())?,
                },
                cancel,
            )?;
            for (sample, valid) in window.samples.iter().zip(window.valid.iter()) {
                if *valid == 0 {
                    continue;
                }
                total.valid_cells = total.valid_cells.saturating_add(1);
                if sample.is_finite() {
                    total.sum_value += f64::from(*sample);
                }
            }
        }
        Ok((total.valid_cells > 0).then_some(total))
    }
}

/// How an immutable generation's numbers are read.
///
/// The selection is explicit and derived from the manifest's format
/// discriminator, so a collection can never fall back to a dense file it does
/// not own and a preserved generation keeps its accepted read.
#[derive(Clone)]
pub(super) enum GenerationReader {
    /// Published resolved chunks: the merge model's generations and every
    /// persisted analysis result.
    Chunks(GenerationChunkReader),
    /// An ordered source collection resolved on demand.
    Collection(Box<CollectionReader>),
}

impl GenerationReader {
    pub(super) fn read_window(
        &self,
        library: &super::LidarLibrary,
        lattice: &RasterGrid,
        window: LatticeWindow,
        cancel: &AtomicBool,
    ) -> Result<ResolvedWindow, String> {
        match self {
            Self::Chunks(owner) => owner.read_window(library, lattice, window, cancel),
            Self::Collection(collection) => collection.read_window(window, cancel),
        }
    }

    pub(super) fn aggregate(
        &self,
        library: &super::LidarLibrary,
        rect: LatticeWindow,
        cancel: &AtomicBool,
    ) -> Result<Option<BlockAggregate>, String> {
        match self {
            Self::Chunks(owner) => owner.aggregate(library, rect, cancel),
            Self::Collection(collection) => collection.aggregate(rect, cancel),
        }
    }

    /// The first published record, for a caller that only needs one
    /// representative raster of a chunked generation.
    /// Whether one whole-chunk reduction cell holds any composition coverage.
    ///
    /// A chunked generation answers from its published records; an ordered
    /// collection answers from the block index derived from member extents. A
    /// block that holds nothing is never opened.
    pub(super) fn chunk_is_occupied(
        &self,
        library: &super::LidarLibrary,
        chunk_x: i64,
        chunk_y: i64,
    ) -> Result<bool, String> {
        match self {
            Self::Chunks(owner) => Ok(owner.chunk_at(library, chunk_x, chunk_y)?.is_some()),
            Self::Collection(collection) => Ok(collection.is_occupied(chunk_x, chunk_y)),
        }
    }

    /// One published resolved chunk by exact coordinate.
    pub(super) fn chunk_at(
        &self,
        library: &super::LidarLibrary,
        chunk_x: i64,
        chunk_y: i64,
    ) -> Result<Option<PersistedChunk>, String> {
        match self {
            Self::Chunks(owner) => owner.chunk_at(library, chunk_x, chunk_y),
            Self::Collection(_) => Ok(None),
        }
    }
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
        MemberSource::Preserved(preserved) => preserved.read(window, cancel),
        MemberSource::LegacyHead(lease) => {
            let mut guard = lease
                .lock()
                .map_err(|_| "preserved composition lease is poisoned".to_string())?;
            let lease = guard.as_mut().ok_or_else(|| {
                "preserved composition lease was released before the read".to_string()
            })?;
            lease.read_window(window, cancel)
        }
    }
}

/// A prepared, read-only lease over a legacy TIFF-only generation.
///
/// The controlled derivative is prepared once for the whole lease and removed
/// when it drops, so replaying a preserved composition never re-prepares per
/// window. The preserved generation's own mask stays authoritative: it is read
/// independently and overrides the derivative's validity.
pub(super) struct LegacyTiffLease {
    reader: PreparedRaster,
    mask: Option<PathBuf>,
}

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

/// One persisted resolved-chunk reference the reader can select, with the
/// stored aggregate a minifying display can use without reading the chunk.
#[derive(Debug, Clone)]
pub(super) struct PersistedChunk {
    pub chunk_x: i64,
    pub chunk_y: i64,
    pub asset: CogAsset,
    pub nodata: Option<f32>,
    /// Valid cell count of the chunk.
    pub valid_cells: i64,
    /// Exact f64 sum of the chunk's valid cells.
    pub sum_value: f64,
}

impl PersistedChunk {
    /// Valid-only mean of the whole chunk, when it holds any valid cell.
    pub(super) fn mean(&self) -> Option<f64> {
        if self.valid_cells <= 0 {
            None
        } else {
            Some(self.sum_value / self.valid_cells as f64)
        }
    }
}

/// Test support: publish one synthetic chunk record with its own committed COG
/// plus the catalogue rows a reader resolves it from.
///
/// Shared by the generation and tile test modules so both exercise the same
/// published shape.
#[cfg(test)]
pub(super) fn publish_test_chunk(
    library: &super::LidarLibrary,
    generation_id: &str,
    chunk_x: i64,
    chunk_y: i64,
    width: u32,
    height: u32,
    values: &[f32],
) -> CogAsset {
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;
    let dir = paths.root().to_path_buf();
    let grid = RasterGrid {
        width,
        height,
        geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
    };
    let asset = crate::services::lidar::raster_assets::write_cog_asset(
        engine,
        &AtomicBool::new(false),
        paths,
        &dir,
        &format!("chunk-{}-{}-{}", generation_id, chunk_x, chunk_y),
        &grid,
        "EPSG:3857",
        Some(f32::NAN),
        values,
    )
    .expect("test chunk COG is created");
    let (valid_cells, sum_value) = values
        .iter()
        .filter(|value| value.is_finite())
        .fold((0i64, 0.0f64), |(count, sum), value| {
            (count + 1, sum + f64::from(*value))
        });
    let connection = library.catalogue().unwrap();
    super::catalogue::insert_raster_asset(
        &connection,
        &asset_row(paths, &asset, "EPSG:3857").unwrap(),
    )
    .unwrap();
    super::catalogue::insert_unpublished_chunks(
        &connection,
        generation_id,
        &[super::catalogue::GenerationChunkRow {
            role: RESULT_ROLE.to_string(),
            chunk_x,
            chunk_y,
            asset_sha256: asset.sha256.clone(),
            valid_cells,
            min_value: 0.0,
            max_value: 0.0,
            sum_value,
        }],
    )
    .unwrap();
    super::catalogue::publish_generation_chunks(&connection, generation_id).unwrap();
    asset
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
    let mut samples = vec![f32::NAN; cells];
    let mut valid = vec![0u8; cells];
    read_chunk_records(chunks, window, cancel, &mut samples, &mut valid)?;
    Ok(ResolvedWindow {
        grid: window_grid(lattice, window)?,
        samples,
        valid,
    })
}

/// Read the intersecting portion of each given record into an existing buffer.
///
/// Records are addressed directly instead of scanning the window's chunk
/// range, so the cost is what the caller actually supplied.
fn read_chunk_records(
    chunks: &[PersistedChunk],
    window: LatticeWindow,
    cancel: &AtomicBool,
    samples: &mut [f32],
    valid: &mut [u8],
) -> Result<(), String> {
    let width = window.width as usize;
    let end_x = window
        .x
        .checked_add(i64::from(window.width))
        .ok_or_else(|| "chunk read window overflows".to_string())?;
    let end_y = window
        .y
        .checked_add(i64::from(window.height))
        .ok_or_else(|| "chunk read window overflows".to_string())?;
    for chunk in chunks {
        check_cancel(cancel)?;
        let chunk_origin_x = chunk
            .chunk_x
            .checked_mul(CHUNK_SIDE)
            .ok_or_else(|| "chunk origin overflows".to_string())?;
        let chunk_origin_y = chunk
            .chunk_y
            .checked_mul(CHUNK_SIDE)
            .ok_or_else(|| "chunk origin overflows".to_string())?;
        let chunk_end_x = chunk_origin_x
            .checked_add(i64::from(chunk.asset.grid.width))
            .ok_or_else(|| "chunk extent overflows".to_string())?;
        let chunk_end_y = chunk_origin_y
            .checked_add(i64::from(chunk.asset.grid.height))
            .ok_or_else(|| "chunk extent overflows".to_string())?;
        // Exact signed overlap: a record that does not intersect contributes
        // nothing and is never opened.
        if chunk_end_x <= window.x
            || chunk_origin_x >= end_x
            || chunk_end_y <= window.y
            || chunk_origin_y >= end_y
        {
            continue;
        }
        let clip_x0 = (window.x - chunk_origin_x).max(0);
        let clip_y0 = (window.y - chunk_origin_y).max(0);
        let clip_x1 = (end_x - chunk_origin_x).min(i64::from(chunk.asset.grid.width));
        let clip_y1 = (end_y - chunk_origin_y).min(i64::from(chunk.asset.grid.height));
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
    check_cancel(cancel)?;
    Ok(())
}

/// Maximum chunk records one catalogue page returns.
///
/// The page is the unit of catalogue work: a reader never loads a whole
/// generation's records to answer a window or a reduction.
pub(super) const CHUNK_PAGE_MAX: usize = 256;

/// Stored sum and valid count of one reduced footprint.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct BlockAggregate {
    pub sum_value: f64,
    pub valid_cells: u64,
}

impl BlockAggregate {
    /// Valid-only mean of the footprint, or `None` when nothing there is valid.
    pub(super) fn mean(self) -> Option<f64> {
        if self.valid_cells == 0 {
            None
        } else {
            Some(self.sum_value / self.valid_cells as f64)
        }
    }
}

/// One immutable generation and role, bound for paged reads.
///
/// The owner holds no catalogue lock and no record list: every page is fetched
/// in its own short catalogue read, the lock is released, and only then is a
/// committed asset opened. A read therefore costs what its window intersects
/// rather than what the whole generation stores.
#[derive(Debug, Clone)]
pub(super) struct GenerationChunkReader {
    generation_id: String,
    role: String,
}

impl GenerationChunkReader {
    pub(super) fn new(generation_id: &str, role: &str) -> Self {
        Self {
            generation_id: generation_id.to_string(),
            role: role.to_string(),
        }
    }

    /// One page of records intersecting `window`, or the whole generation when
    /// no window is given. The catalogue lock is held only for this query.
    pub(super) fn page(
        &self,
        library: &super::LidarLibrary,
        window: Option<LatticeWindow>,
        after: Option<(i64, i64)>,
    ) -> Result<Vec<PersistedChunk>, String> {
        let filter = match window {
            Some(window) => Some(chunk_window(window)?),
            None => None,
        };
        let rows = {
            let connection = library.catalogue()?;
            super::catalogue::generation_chunk_page(
                &connection,
                &self.generation_id,
                &self.role,
                filter,
                after,
                CHUNK_PAGE_MAX,
            )?
        };
        let mut chunks = Vec::with_capacity(rows.len());
        for row in rows {
            chunks.push(persisted_chunk(&library.inner.paths, row)?);
        }
        Ok(chunks)
    }

    /// The first published record, for a caller that only needs one
    /// representative raster of the generation.
    pub(super) fn first(
        &self,
        library: &super::LidarLibrary,
    ) -> Result<Option<PersistedChunk>, String> {
        Ok(self.page(library, None, None)?.into_iter().next())
    }

    /// One record by exact coordinate, when it is published.
    pub(super) fn chunk_at(
        &self,
        library: &super::LidarLibrary,
        chunk_x: i64,
        chunk_y: i64,
    ) -> Result<Option<PersistedChunk>, String> {
        let row = {
            let connection = library.catalogue()?;
            super::catalogue::generation_chunk_at(
                &connection,
                &self.generation_id,
                &self.role,
                chunk_x,
                chunk_y,
            )?
        };
        row.map(|row| persisted_chunk(&library.inner.paths, row))
            .transpose()
    }

    /// Read one window, page by page, opening only intersecting records.
    pub(super) fn read_window(
        &self,
        library: &super::LidarLibrary,
        lattice: &RasterGrid,
        window: LatticeWindow,
        cancel: &AtomicBool,
    ) -> Result<ResolvedWindow, String> {
        let cells = validate_window(window)?;
        let mut samples = vec![f32::NAN; cells];
        let mut valid = vec![0u8; cells];
        let mut cursor = None;
        loop {
            check_cancel(cancel)?;
            let page = self.page(library, Some(window), cursor)?;
            if page.is_empty() {
                break;
            }
            let returned = page.len();
            cursor = page.last().map(|chunk| (chunk.chunk_y, chunk.chunk_x));
            read_chunk_records(&page, window, cancel, &mut samples, &mut valid)?;
            if returned < CHUNK_PAGE_MAX {
                break;
            }
        }
        check_cancel(cancel)?;
        Ok(ResolvedWindow {
            grid: window_grid(lattice, window)?,
            samples,
            valid,
        })
    }

    /// Stored sum and valid count over one reduced footprint.
    ///
    /// A chunk wholly inside the footprint contributes its stored aggregate
    /// without any raster I/O; a boundary chunk contributes only its
    /// intersecting cells, read through the bounded reader. Invalid and absent
    /// cells contribute neither sum nor count, and `None` means the footprint
    /// holds no valid cell.
    pub(super) fn aggregate(
        &self,
        library: &super::LidarLibrary,
        rect: LatticeWindow,
        cancel: &AtomicBool,
    ) -> Result<Option<BlockAggregate>, String> {
        let end_x = rect
            .x
            .checked_add(i64::from(rect.width))
            .ok_or_else(|| "reduction footprint overflows".to_string())?;
        let end_y = rect
            .y
            .checked_add(i64::from(rect.height))
            .ok_or_else(|| "reduction footprint overflows".to_string())?;
        let mut total = BlockAggregate {
            sum_value: 0.0,
            valid_cells: 0,
        };
        let mut cursor = None;
        loop {
            check_cancel(cancel)?;
            let page = self.page(library, Some(rect), cursor)?;
            if page.is_empty() {
                break;
            }
            let returned = page.len();
            cursor = page.last().map(|chunk| (chunk.chunk_y, chunk.chunk_x));
            for chunk in &page {
                let origin_x = chunk
                    .chunk_x
                    .checked_mul(CHUNK_SIDE)
                    .ok_or_else(|| "chunk origin overflows".to_string())?;
                let origin_y = chunk
                    .chunk_y
                    .checked_mul(CHUNK_SIDE)
                    .ok_or_else(|| "chunk origin overflows".to_string())?;
                let chunk_end_x = origin_x
                    .checked_add(i64::from(chunk.asset.grid.width))
                    .ok_or_else(|| "chunk extent overflows".to_string())?;
                let chunk_end_y = origin_y
                    .checked_add(i64::from(chunk.asset.grid.height))
                    .ok_or_else(|| "chunk extent overflows".to_string())?;
                if origin_x >= rect.x
                    && origin_y >= rect.y
                    && chunk_end_x <= end_x
                    && chunk_end_y <= end_y
                {
                    total.sum_value += chunk.sum_value;
                    total.valid_cells = total
                        .valid_cells
                        .saturating_add(u64::try_from(chunk.valid_cells).unwrap_or(0));
                    continue;
                }
                let clip_x0 = rect.x.max(origin_x);
                let clip_y0 = rect.y.max(origin_y);
                let clip_x1 = end_x.min(chunk_end_x);
                let clip_y1 = end_y.min(chunk_end_y);
                if clip_x0 >= clip_x1 || clip_y0 >= clip_y1 {
                    continue;
                }
                let member_window = RasterWindow {
                    x: (clip_x0 - origin_x) as u32,
                    y: (clip_y0 - origin_y) as u32,
                    width: (clip_x1 - clip_x0) as u32,
                    height: (clip_y1 - clip_y0) as u32,
                };
                let mut reader = PreparedRaster::open_committed(
                    &chunk.asset.path,
                    &chunk.asset.grid,
                    chunk.nodata,
                )?;
                let read = reader.read_window(member_window, cancel)?;
                for (value, valid) in read.samples().iter().zip(read.valid()) {
                    if *valid == 0 {
                        continue;
                    }
                    total.valid_cells = total.valid_cells.saturating_add(1);
                    if value.is_finite() {
                        total.sum_value += f64::from(*value);
                    }
                }
            }
            if returned < CHUNK_PAGE_MAX {
                break;
            }
        }
        Ok((total.valid_cells > 0).then_some(total))
    }
}

/// Chunk-coordinate bounds of one lattice-cell window, exactly and checked.
fn chunk_window(window: LatticeWindow) -> Result<super::catalogue::ChunkWindow, String> {
    let end_x = window
        .x
        .checked_add(i64::from(window.width))
        .ok_or_else(|| "chunk read window overflows".to_string())?;
    let end_y = window
        .y
        .checked_add(i64::from(window.height))
        .ok_or_else(|| "chunk read window overflows".to_string())?;
    super::catalogue::ChunkWindow::for_cells(window.x, end_x, window.y, end_y, CHUNK_SIDE)
}

/// Resolve one catalogue row into its readable record.
fn persisted_chunk(
    paths: &super::paths::LidarPaths,
    row: super::catalogue::ChunkAssetRow,
) -> Result<PersistedChunk, String> {
    let asset = cog_from_row(paths, &row.asset)?;
    Ok(PersistedChunk {
        chunk_x: row.chunk_x,
        chunk_y: row.chunk_y,
        nodata: asset.nodata,
        asset,
        valid_cells: row.aggregate_valid_cells,
        sum_value: row.aggregate_sum_value,
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
/// Read only the requested rows of a preserved dense mask file.
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

/// Whether new publications use sparse resolved chunks.
///
/// Enabled: every reader consumes a sparse generation — review, Apply, undo,
/// slope and the bounded display transport — and the migrated flows are
/// verified end to end on real data, including a 48M-cell batch inside the
/// production admission limits. Tests that must exercise the preserved dense
/// route force it for their own thread through [`chunked_publication`].
#[cfg(not(test))]
pub(super) const fn chunked_publication_enabled() -> bool {
    true
}

#[cfg(test)]
pub(super) fn chunked_publication_enabled() -> bool {
    !chunked_publication::forced_dense()
}

/// Test-only seam for the storage format switch.
///
/// Mirrors `paths::capacity_probe`: the decision stays production code and only
/// the switch is overridden per thread, so a test exercises the same
/// publication path a production caller would take.
#[cfg(test)]
pub(super) mod chunked_publication {
    use std::cell::Cell;

    thread_local! {
        static FORCED_DENSE: Cell<bool> = const { Cell::new(false) };
    }

    pub(super) fn forced_dense() -> bool {
        FORCED_DENSE.with(Cell::get)
    }

    /// Publish in the preserved dense format until the guard is dropped.
    pub(crate) fn without_sparse() -> Guard {
        FORCED_DENSE.with(|slot| slot.set(true));
        Guard
    }

    pub(crate) struct Guard;

    impl Drop for Guard {
        fn drop(&mut self) {
            FORCED_DENSE.with(|slot| slot.set(false));
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
///
/// Test oracle only: every production reader binds a `GenerationChunkReader`
/// and fetches bounded pages, so no caller materializes a whole generation's
/// records.
#[cfg(test)]
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
            valid_cells: row.aggregate_valid_cells,
            sum_value: row.aggregate_sum_value,
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
    use std::sync::Mutex;

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
    fn preserved_composition_reads_exact_values_with_the_authoritative_mask() {
        use crate::services::lidar::import::{raw_to_tif, write_f32_raw};
        let engine = GdalEngine::new();
        let dir = scratch("preserved-composition");
        let grid = member_grid(0, 0, 4, 3);
        let values: Vec<f32> = vec![0.0, -1.0, 5.0, 7.0, 1.0, 2.0, 3.0, 4.0, 9.0, 8.0, 6.0, 5.0];
        let raw = dir.join("legacy.raw");
        write_f32_raw(&raw, &values).unwrap();
        let mosaic = dir.join("mosaic.tif");
        raw_to_tif(
            &engine,
            &cancellation(),
            &raw,
            &mosaic,
            &grid,
            "EPSG:3857",
            -9999.0,
        )
        .unwrap();
        // The preserved generation's own mask is authoritative and disagrees
        // with the numeric samples on purpose, so the test detects a reader that
        // silently fell back to the mosaic's NoData tag.
        let mask = dir.join("legacy-mask.bin");
        std::fs::write(&mask, [1u8, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1]).unwrap();

        // A dense mosaic is not in the controlled COG profile, which is exactly
        // why one compatibility lease makes it readable.
        let lease = LegacyTiffLease::open(
            &engine,
            &mosaic,
            &grid,
            None,
            Some(mask.clone()),
            &dir,
            &cancellation(),
        )
        .expect("the compatibility lease prepares once");
        let member = ResolvedMember {
            ordinal: 0,
            role: MemberRole::Replace,
            grid: grid.clone(),
            nodata: None,
            source: MemberSource::LegacyHead(Arc::new(Mutex::new(Some(lease)))),
        };
        let read = resolve_window(
            std::slice::from_ref(&member),
            &lattice(),
            full_window(0, 0, 4, 3),
            &cancellation(),
        )
        .unwrap();
        let mask_values = [1u8, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1];
        let expected: Vec<f32> = values
            .iter()
            .zip(mask_values.iter())
            .map(|(value, valid)| if *valid == 1 { *value } else { f32::NAN })
            .collect();
        // NaN is this resolver's "no sample here", so the comparison is
        // NaN-aware: an invalid cell carries no value to compare.
        assert!(
            read.samples
                .iter()
                .zip(expected.iter())
                .all(|(actual, want)| (actual.is_nan() && want.is_nan()) || actual == want),
            "the preserved mosaic is replayed exactly where the mask admits it: {:?}",
            read.samples
        );
        assert_eq!(
            read.valid,
            mask_values.to_vec(),
            "the generation's own mask overrides the mosaic's NoData tag"
        );

        // A window read is bounded and clipped to the member, not a whole-raster
        // read: the same member answers a sub-window with that window's values
        // without re-preparing the derivative.
        let clipped = resolve_window(
            std::slice::from_ref(&member),
            &lattice(),
            LatticeWindow {
                x: 1,
                y: 0,
                width: 2,
                height: 2,
            },
            &cancellation(),
        )
        .unwrap();
        assert!(
            clipped
                .samples
                .iter()
                .zip([f32::NAN, 5.0, 2.0, f32::NAN].iter())
                .all(|(actual, want)| (actual.is_nan() && want.is_nan()) || actual == want),
            "{:?}",
            clipped.samples
        );
        assert_eq!(clipped.valid, vec![0, 1, 1, 0]);
        let retained = match &member.source {
            MemberSource::LegacyHead(lease) => lease.lock().unwrap().is_some(),
            _ => false,
        };
        assert!(retained, "the lease stays owned for the next read");

        // The deterministic oracle for the derivative conversion: every
        // authored sample keeps the value GDAL wrote, and the region aggregate
        // covers exactly the member's occupied chunk.
        let mut reader =
            PreparedRaster::open(&engine, &mosaic, &grid, None, 0, &dir, &cancellation()).unwrap();
        let regions = member_regions(&mut reader, &lattice(), &grid, &cancellation()).unwrap();
        assert_eq!(regions.len(), 1, "one occupied chunk");
        let region = &regions[0];
        assert_eq!((region.block_x, region.block_y), (0, 0));
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
    fn ordered_collection_resolves_topmost_valid_without_materializing_anything() {
        let engine = GdalEngine::new();
        let dir = scratch("ordered-collection");
        let registry = LidarPaths::open(&dir).unwrap();
        let lattice = lattice();
        let grid = member_grid(0, 0, 3, 1);

        // Bottom A = [10,20,30]; top B = [100,NoData,0] on the same three
        // cells. NoData reveals the valid sample below, and a valid zero and a
        // valid negative both survive: neither is treated as absence.
        let author = |name: &str, nodata: f32, values: &[f32]| {
            let asset = write_cog_asset(
                &engine,
                &cancellation(),
                &registry,
                &dir,
                name,
                &grid,
                "EPSG:3857",
                Some(nodata),
                values,
            )
            .expect("member COG is created");
            ResolvedMember {
                ordinal: 0,
                role: MemberRole::Replace,
                grid: grid.clone(),
                nodata: Some(nodata),
                source: MemberSource::Cog(asset),
            }
        };
        let bottom = author("bottom", f32::NAN, &[10.0, 20.0, 30.0]);
        let top = author("top", f32::NAN, &[100.0, f32::NAN, 0.0]);

        // The reader is built from a top-first list, exactly as the UI and the
        // transport present it.
        let top_first = |first: &ResolvedMember, second: &ResolvedMember| {
            CollectionReader::new(
                vec![
                    ("first".to_string(), first.clone()),
                    ("second".to_string(), second.clone()),
                ],
                lattice.clone(),
            )
            .unwrap()
        };
        let window = LatticeWindow {
            x: 0,
            y: 0,
            width: 3,
            height: 1,
        };
        let resolved = top_first(&top, &bottom)
            .read_window(window, &cancellation())
            .unwrap();
        assert_eq!(resolved.samples, vec![100.0, 20.0, 0.0]);
        assert_eq!(resolved.valid, vec![1, 1, 1]);

        // Moving the top source below the bottom one — the top-first list swap —
        // changes the composed value, and this is the composition Undo restores.
        let moved = top_first(&bottom, &top)
            .read_window(window, &cancellation())
            .unwrap();
        assert_eq!(moved.samples, vec![10.0, 20.0, 30.0]);
        assert!(moved.valid.iter().all(|valid| *valid == 1));
        let restored = top_first(&top, &bottom)
            .read_window(window, &cancellation())
            .unwrap();
        assert_eq!(restored.samples, vec![100.0, 20.0, 0.0]);

        // No composed raster exists anywhere: the composition is resolved from
        // the retained source COGs and nothing is re-encoded by reordering.
        let reader = top_first(&top, &bottom);
        assert_eq!(reader.occupied_chunks().unwrap(), vec![(0, 0)]);
        assert_eq!(reader.resolved().len(), 2);
        let composed: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains("gen") || name.contains("chunk"))
            .collect();
        assert!(
            composed.is_empty(),
            "an ordered composition materializes nothing: {composed:?}"
        );

        // A distant second member adds only its own occupied chunk, so the empty
        // gap contributes neither work nor coverage.
        let far = cog_member(
            &engine, &registry, &dir, "far", 1_000_000, 0, 4, 3, 2.0, None,
        );
        let sparse =
            CollectionReader::new(vec![("far".to_string(), far)], lattice.clone()).unwrap();
        assert_eq!(sparse.occupied_chunks().unwrap(), vec![(976, 0)]);
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
                valid_cells: i64::from(chunk_side) * i64::from(chunk_side),
                sum_value: f64::from(value) * f64::from(chunk_side) * f64::from(chunk_side),
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

    // -----------------------------------------------------------------------
    // BG3/BG2: paged generation reads and complete reduction footprints
    // -----------------------------------------------------------------------

    fn constant_chunk(value: f32) -> Vec<f32> {
        vec![value; 4 * 4]
    }

    /// A footprint wider than one stored chunk adds the stored sum and count of
    /// every chunk it encloses: the mean is total sum over total valid count,
    /// not the unweighted average of chunk means.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn crossing_footprints_aggregate_stored_sums_over_enclosed_chunks() {
        let dir = scratch("footprint-aggregate");
        let library = crate::services::lidar::LidarLibrary::open(&dir).unwrap();
        for (chunk_x, chunk_y, value) in [(0, 0, 0.0), (1, 0, 10.0), (0, 1, 20.0), (1, 1, 30.0)] {
            publish_test_chunk(
                &library,
                "generation-a",
                chunk_x,
                chunk_y,
                4,
                4,
                &constant_chunk(value),
            );
        }
        let owner = GenerationChunkReader::new("generation-a", RESULT_ROLE);
        let aggregate = owner
            .aggregate(&library, full_window(0, 0, 2048, 2048), &cancellation())
            .unwrap()
            .expect("the footprint holds coverage");
        // Four fully valid 4x4 chunks: sum 960 over 64 cells.
        assert_eq!(aggregate.valid_cells, 64);
        assert_eq!(aggregate.mean(), Some(15.0));

        // The counterexample the unweighted average would fail: three cells of
        // 2 in one chunk and one cell of 10 in another. Chunk means are 2 and
        // 10 (average 6), while the correct mean is 16 / 4 = 4.
        let dir = scratch("footprint-weighted");
        let library = crate::services::lidar::LidarLibrary::open(&dir).unwrap();
        let mut sparse_low = vec![f32::NAN; 4 * 4];
        sparse_low[0] = 2.0;
        sparse_low[1] = 2.0;
        sparse_low[2] = 2.0;
        publish_test_chunk(&library, "generation-b", 0, 0, 4, 4, &sparse_low);
        let mut sparse_high = vec![f32::NAN; 4 * 4];
        sparse_high[0] = 10.0;
        publish_test_chunk(&library, "generation-b", 1, 0, 4, 4, &sparse_high);
        let owner = GenerationChunkReader::new("generation-b", RESULT_ROLE);
        let aggregate = owner
            .aggregate(&library, full_window(0, 0, 2048, 1024), &cancellation())
            .unwrap()
            .expect("both chunks contribute");
        assert_eq!(aggregate.valid_cells, 4);
        assert_eq!(aggregate.mean(), Some(4.0));

        // Only the intersecting cells of a boundary chunk contribute: a
        // one-cell footprint inside the second chunk reads that cell alone.
        let aggregate = owner
            .aggregate(&library, full_window(1024, 0, 1, 1), &cancellation())
            .unwrap()
            .expect("the boundary cell is valid");
        assert_eq!(aggregate.valid_cells, 1);
        assert_eq!(aggregate.mean(), Some(10.0));
        // Coverage in a chunk that does not hold the footprint still counts:
        // the same one-cell footprint one chunk over reads the low chunk only.
        let aggregate = owner
            .aggregate(&library, full_window(0, 0, 1, 1), &cancellation())
            .unwrap()
            .expect("the first chunk cell is valid");
        assert_eq!(aggregate.mean(), Some(2.0));
        // An empty footprint is invalid coverage, not a fabricated zero.
        assert_eq!(
            owner
                .aggregate(&library, full_window(3000, 3000, 8, 8), &cancellation())
                .unwrap(),
            None
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A record whose committed file is gone stays an error, and a small window
    /// never opens the records it does not intersect.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn unrelated_records_are_never_opened_for_a_small_window() {
        let dir = scratch("paged-window");
        let library = crate::services::lidar::LidarLibrary::open(&dir).unwrap();
        publish_test_chunk(&library, "generation-c", 0, 0, 4, 4, &constant_chunk(7.0));
        // A record far away whose file is removed: a reader that visited it
        // would fail instead of returning the window it was asked for.
        let unwanted =
            publish_test_chunk(&library, "generation-c", 9, 9, 4, 4, &constant_chunk(3.0));
        std::fs::remove_file(&unwanted.path).unwrap();
        let owner = GenerationChunkReader::new("generation-c", RESULT_ROLE);
        let resolved = owner
            .read_window(
                &library,
                &lattice(),
                full_window(0, 0, 4, 4),
                &cancellation(),
            )
            .unwrap();
        assert!(resolved.samples.iter().all(|value| *value == 7.0));
        assert!(resolved.valid.iter().all(|valid| *valid == 1));
        // The distant record is still a referenced asset: a read that must open
        // it, or a footprint that only partly covers it, reports the missing
        // file instead of empty coverage.
        let distant = full_window(9 * CHUNK_SIDE, 9 * CHUNK_SIDE, 4, 4);
        let error = owner
            .read_window(&library, &lattice(), distant, &cancellation())
            .expect_err("a missing committed file is an error");
        assert!(!error.is_empty());
        let error = owner
            .aggregate(
                &library,
                full_window(9 * CHUNK_SIDE, 9 * CHUNK_SIDE, 2, 2),
                &cancellation(),
            )
            .expect_err("a boundary chunk with no file is an error");
        assert!(!error.is_empty());
        // A footprint enclosing the same record is answered from its stored
        // aggregate, which is exactly why stored sums exist: no raster I/O.
        let enclosed = owner
            .aggregate(&library, distant, &cancellation())
            .unwrap()
            .expect("the stored aggregate covers the footprint");
        assert_eq!(enclosed.valid_cells, 16);
        // Cancellation before the first page publishes nothing and a later
        // healthy pass reads the same window exactly.
        let cancelled = AtomicBool::new(true);
        assert!(
            owner
                .read_window(&library, &lattice(), full_window(0, 0, 4, 4), &cancelled)
                .is_err()
        );
        let resolved = owner
            .read_window(
                &library,
                &lattice(),
                full_window(0, 0, 4, 4),
                &cancellation(),
            )
            .unwrap();
        assert!(resolved.samples.iter().all(|value| *value == 7.0));
        // The window page loads the one intersecting record and no other.
        let page = {
            let connection = library.catalogue().unwrap();
            catalogue::generation_chunk_page(
                &connection,
                "generation-c",
                RESULT_ROLE,
                Some(catalogue::ChunkWindow::for_cells(0, 4, 0, 4, CHUNK_SIDE).unwrap()),
                None,
                CHUNK_PAGE_MAX,
            )
            .unwrap()
        };
        assert_eq!(page.len(), 1);
        assert_eq!((page[0].chunk_x, page[0].chunk_y), (0, 0));
        // Both records remain published: nothing was deleted by reading.
        let all = {
            let connection = library.catalogue().unwrap();
            catalogue::generation_chunk_page(
                &connection,
                "generation-c",
                RESULT_ROLE,
                None,
                None,
                CHUNK_PAGE_MAX,
            )
            .unwrap()
        };
        assert_eq!(all.len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Publish one record whose stored aggregate is the only thing a reader
    /// needs: no file exists, so any read of it would fail loudly.
    fn publish_stored_chunk(
        library: &crate::services::lidar::LidarLibrary,
        generation_id: &str,
        chunk_x: i64,
        chunk_y: i64,
        valid_cells: i64,
        sum_value: f64,
    ) {
        let paths = &library.inner.paths;
        let sha256 = format!("stored-{generation_id}-{chunk_x}-{chunk_y}");
        let asset = CogAsset {
            sha256: sha256.clone(),
            path: paths.asset_cog(&sha256),
            bytes: 0,
            grid: RasterGrid {
                width: 4,
                height: 4,
                geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
            },
            nodata: Some(f32::NAN),
        };
        let connection = library.catalogue().unwrap();
        catalogue::insert_raster_asset(
            &connection,
            &asset_row(paths, &asset, "EPSG:3857").unwrap(),
        )
        .unwrap();
        catalogue::insert_unpublished_chunks(
            &connection,
            generation_id,
            &[catalogue::GenerationChunkRow {
                role: RESULT_ROLE.to_string(),
                chunk_x,
                chunk_y,
                asset_sha256: sha256,
                valid_cells,
                min_value: 0.0,
                max_value: 0.0,
                sum_value,
            }],
        )
        .unwrap();
        catalogue::publish_generation_chunks(&connection, generation_id).unwrap();
    }

    /// More than two pages of occupied records contribute exactly once, page at
    /// most `CHUNK_PAGE_MAX` records, and distant records stay out of a small
    /// window's path.
    #[test]
    fn paged_reads_cover_every_occupied_record_once_with_bounded_pages() {
        let dir = scratch("paged-records");
        let library = crate::services::lidar::LidarLibrary::open(&dir).unwrap();
        // 600 occupied records in a 24x25 block, each holding four valid cells
        // whose sum is `4 * index`, plus 50 distant records that must not
        // contribute to this footprint.
        let mut expected_sum = 0.0f64;
        let mut index = 0i64;
        for chunk_y in 0..25 {
            for chunk_x in 0..24 {
                let value = index as f64;
                publish_stored_chunk(&library, "generation-p", chunk_x, chunk_y, 4, value * 4.0);
                expected_sum += value * 4.0;
                index += 1;
            }
        }
        for distant in 0..50 {
            publish_stored_chunk(
                &library,
                "generation-p",
                9000 + distant,
                9000,
                4,
                1_000_000.0,
            );
        }
        let owner = GenerationChunkReader::new("generation-p", RESULT_ROLE);
        let footprint = full_window(0, 0, 24 * CHUNK_SIDE as u32 + 4, 25 * CHUNK_SIDE as u32 + 4);
        let aggregate = owner
            .aggregate(&library, footprint, &cancellation())
            .unwrap()
            .expect("the footprint holds coverage");
        assert_eq!(aggregate.valid_cells, 2400, "each record counts once");
        assert_eq!(aggregate.mean(), Some(expected_sum / 2400.0));

        // Pages are bounded and ordered, and the full walk sees every record
        // exactly once.
        let mut seen: Vec<(i64, i64)> = Vec::new();
        let mut cursor = None;
        let mut pages = 0usize;
        loop {
            let page = {
                let connection = library.catalogue().unwrap();
                catalogue::generation_chunk_page(
                    &connection,
                    "generation-p",
                    RESULT_ROLE,
                    None,
                    cursor,
                    CHUNK_PAGE_MAX,
                )
                .unwrap()
            };
            if page.is_empty() {
                break;
            }
            pages += 1;
            assert!(
                page.len() <= CHUNK_PAGE_MAX,
                "a page holds at most {CHUNK_PAGE_MAX} records"
            );
            assert!(
                page.windows(2)
                    .all(|pair| (pair[0].chunk_y, pair[0].chunk_x)
                        < (pair[1].chunk_y, pair[1].chunk_x)),
                "page order is stable"
            );
            cursor = page.last().map(|row| (row.chunk_y, row.chunk_x));
            seen.extend(page.iter().map(|row| (row.chunk_x, row.chunk_y)));
        }
        assert!(pages >= 3, "more than two pages were exercised: {pages}");
        assert_eq!(seen.len(), 650);
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), 650, "no record was returned twice");

        // A small window loads only what it intersects, and its aggregate is
        // the one record's stored sum.
        let window = catalogue::ChunkWindow::for_cells(0, 8, 0, 8, CHUNK_SIDE).unwrap();
        let filtered = {
            let connection = library.catalogue().unwrap();
            catalogue::generation_chunk_page(
                &connection,
                "generation-p",
                RESULT_ROLE,
                Some(window),
                None,
                CHUNK_PAGE_MAX,
            )
            .unwrap()
        };
        assert_eq!(filtered.len(), 1);
        assert_eq!((filtered[0].chunk_x, filtered[0].chunk_y), (0, 0));
        let aggregate = owner
            .aggregate(&library, full_window(0, 0, 4, 4), &cancellation())
            .unwrap()
            .expect("the first record covers the window");
        assert_eq!(aggregate.valid_cells, 4);
        assert_eq!(aggregate.mean(), Some(0.0));
        let _ = std::fs::remove_dir_all(dir);
    }
}
