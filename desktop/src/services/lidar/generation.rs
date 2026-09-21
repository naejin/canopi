#![allow(dead_code)] // Temporary: see the wiring note below.
//!
//! Bounded reads over ordered member occurrences.
//!
//! One resolver serves staged review candidates, published generations and
//! preserved legacy generations. It reads only the window a caller asks for,
//! maps signed lattice coordinates onto each member's own grid, and replays
//! occurrences in ordinal order with the accepted role semantics. No union
//! raster, no absent-coordinate walk and no whole-extent buffer is created.
//!
//! Wiring status: publication and the preview/display/slope callers that
//! consume this resolver land in B2–B4, so until then the compiler sees no
//! production caller. The allowance is removed with the first wired caller
//! (`canopi-jv8a.4`).

use super::grid::RasterGrid;
use super::prepared_raster::{PreparedRaster, RasterWindow};
use super::raster_assets::CogAsset;
use std::collections::BTreeSet;
use std::io::{Read as _, Seek as _, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Spatial chunk side shared by resolved generation and result storage.
pub(super) const CHUNK_SIDE: i64 = 1024;
/// Largest requested window side, matching the reader's halo allowance.
const MAX_WINDOW_SIDE: i64 = 1026;

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
    pub grid: RasterGrid,
    pub samples: Vec<f32>,
    pub valid: Vec<u8>,
}

impl ResolvedWindow {
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

fn window_grid(lattice: &RasterGrid, window: LatticeWindow) -> Result<RasterGrid, String> {
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
}
