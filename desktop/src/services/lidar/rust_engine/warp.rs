//! The display warp (U31, A2–A4): every display derivative is written in
//! EPSG:3857, so the renderer takes cog-tiler's affine path and does no
//! coordinate work of its own.
//!
//! **One global lattice** (A2). Pixels sit on the Web Mercator world grid:
//! its origin is the world's north-west corner and its pixel the zoom-ladder
//! rung (`2 × 20,037,508.34 m / 256 / 2^z`) just finer than one source cell
//! measured in Web Mercator metres at the CRS row's reference latitude (the
//! middle of the row's area). Every part in one CRS and cell size therefore
//! shares one rung, whatever its latitude, so adjacent parts line up pixel
//! for pixel and a content-keyed derivative is reused anywhere.
//!
//! **Footprint rule** (A2). A part writes only the pixels whose centres fall
//! inside its native grid, half-open as hover's containing cell is; every
//! other pixel is NoData. Adjacent parts leave no gap and no double cover.
//!
//! **Placement** (A4). A pixel centre goes Web Mercator → WGS84 → native
//! through the CRS authority, on cog-tiler's mesh: nodes every [`MESH`]
//! pixels of the global lattice are transformed exactly and the pixels
//! between them interpolated bilinearly. Nodes depend on the lattice only, so
//! two parts compute the same native point for the same pixel. The mesh stays
//! within a micrometre of the exact transform at a 0.5 m cell (a test), so a
//! pixel centre shows the native cell containing crs(P), the cell hover
//! reads, unless the point lies that close to a cell edge.
//!
//! **Sampling** (A3) is nearest neighbour: values and NoData are copied,
//! never blended. **Memory** (A3): the writer asks for output rows in windows
//! of at most half the capacity limit; each window reads the native window
//! under it through the bounded band reader, split by columns until it holds
//! at most the other half.

use super::super::engine::check_cancel;
use super::super::grid::RasterGrid;
use super::super::prepared_raster::RasterWindow;
use super::Cells;
use super::cog::{self, BandSource};
use super::crs::{self, ResolvedCrs, Transformer};
use super::crs_table::{self, CrsKind};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use wbgeotiff::tags::Compression;

/// Half the Web Mercator world's side, in metres: the lattice origin is
/// `(-HALF_WORLD, HALF_WORLD)`.
const HALF_WORLD: f64 = 20_037_508.342_789_244;
/// Pixels across the world at zoom 0.
const WORLD_PIXELS_AT_ZOOM_0: f64 = 256.0;
/// The finest rung: zoom 30, 0.15 mm. A finer cell is drawn at this rung.
const MAX_ZOOM: u32 = 30;
/// Mesh pitch in lattice pixels (cog-tiler's `NG`).
const MESH: i64 = 16;
/// Native cells between two points placed along a footprint edge to find
/// the derivative's extent, and the fewest and most points per edge: an
/// edge's bowing between points stays far below one pixel.
const EDGE_STEP: u32 = 16;
const EDGE_POINTS: std::ops::RangeInclusive<u32> = 64..=4096;
/// Web Mercator metres per degree of longitude.
const METRES_PER_DEGREE: f64 = 2.0 * HALF_WORLD / 360.0;

/// The pixel side of zoom `zoom` on the ladder.
fn rung_at(zoom: u32) -> f64 {
    2.0 * HALF_WORLD / WORLD_PIXELS_AT_ZOOM_0 / f64::from(1u32 << zoom)
}

/// The rung just finer than one cell of `grid` in `native`, in Web Mercator
/// metres at the row's reference latitude.
fn rung(native: &ResolvedCrs, grid: &RasterGrid) -> Result<f64, String> {
    let gt = grid.geotransform;
    let cell = gt[1].abs().min(gt[5].abs());
    let row = crs_table::row_of(native.code())
        .ok_or_else(|| format!("EPSG:{} has no row", native.code()))?;
    let reference_latitude = (row.area[1] + row.area[3]) / 2.0;
    let mercator = match native.kind() {
        CrsKind::ProjectedMetre => cell / reference_latitude.to_radians().cos(),
        CrsKind::ProjectedOther => cell,
        CrsKind::Geographic => cell * METRES_PER_DEGREE,
    };
    if !(mercator.is_finite() && mercator > 0.0) {
        return Err("the raster's cell size cannot be drawn".to_string());
    }
    Ok(rung_at(
        (0..=MAX_ZOOM)
            .find(|zoom| rung_at(*zoom) <= mercator)
            .unwrap_or(MAX_ZOOM),
    ))
}

/// Where a derivative sits on the lattice.
struct Placement {
    grid: RasterGrid,
    /// Lattice column and row of the derivative's top-left pixel.
    column: i64,
    row: i64,
    resolution: f64,
}

/// The lattice pixels around `native`'s footprint, placed point by point
/// along its edges.
fn place(
    native: &RasterGrid,
    to_mercator: &Transformer,
    resolution: f64,
) -> Result<Placement, String> {
    let gt = native.geotransform;
    let (width, height) = (f64::from(native.width), f64::from(native.height));
    let points = (native.width.max(native.height) / EDGE_STEP)
        .clamp(*EDGE_POINTS.start(), *EDGE_POINTS.end());
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for step in 0..=points {
        let t = f64::from(step) / f64::from(points);
        for (u, v) in [
            (t * width, 0.0),
            (t * width, height),
            (0.0, t * height),
            (width, t * height),
        ] {
            let Ok((x, y)) = to_mercator.apply(gt[0] + u * gt[1], gt[3] + v * gt[5]) else {
                continue;
            };
            if x.is_finite() && y.is_finite() {
                bounds = [
                    bounds[0].min(x),
                    bounds[1].min(y),
                    bounds[2].max(x),
                    bounds[3].max(y),
                ];
            }
        }
    }
    if !bounds.iter().all(|value| value.is_finite()) {
        return Err("the raster cannot be placed in Web Mercator".to_string());
    }
    let world = (2.0 * HALF_WORLD / resolution).round() as i64;
    let column = (((bounds[0] + HALF_WORLD) / resolution).floor() as i64).clamp(0, world);
    let end_column = (((bounds[2] + HALF_WORLD) / resolution).ceil() as i64).clamp(0, world);
    let row = (((HALF_WORLD - bounds[3]) / resolution).floor() as i64).clamp(0, world);
    let end_row = (((HALF_WORLD - bounds[1]) / resolution).ceil() as i64).clamp(0, world);
    let size = |cells: i64| {
        u32::try_from(cells)
            .ok()
            .filter(|cells| *cells > 0)
            .ok_or_else(|| "the raster's Web Mercator extent cannot be written".to_string())
    };
    Ok(Placement {
        grid: RasterGrid {
            width: size(end_column - column)?,
            height: size(end_row - row)?,
            geotransform: [
                -HALF_WORLD + column as f64 * resolution,
                resolution,
                0.0,
                HALF_WORLD - row as f64 * resolution,
                0.0,
                -resolution,
            ],
        },
        column,
        row,
        resolution,
    })
}

/// The lattice grid a derivative of `grid` in `native` is written on (the
/// GDAL oracle warps onto the same pixels).
#[cfg(test)]
pub(super) fn lattice(grid: &RasterGrid, native: &ResolvedCrs) -> Result<RasterGrid, String> {
    let mercator = crs::from_reference("EPSG:3857")?;
    place(
        grid,
        &Transformer::new(native, &mercator)?,
        rung(native, grid)?,
    )
    .map(|placement| placement.grid)
}

/// Native points of the mesh nodes over a block of lattice pixels.
struct Mesh {
    /// Node index of the block's first node column and row.
    first: (i64, i64),
    columns: usize,
    nodes: Vec<Option<(f64, f64)>>,
}

impl Mesh {
    /// Nodes covering lattice columns `columns` and rows `rows`.
    fn over(
        to_native: &Transformer,
        resolution: f64,
        columns: std::ops::Range<i64>,
        rows: std::ops::Range<i64>,
    ) -> Self {
        let first = (columns.start.div_euclid(MESH), rows.start.div_euclid(MESH));
        let last = (
            (columns.end - 1).div_euclid(MESH) + 1,
            (rows.end - 1).div_euclid(MESH) + 1,
        );
        let node_columns = (last.0 - first.0 + 1) as usize;
        let mut nodes = Vec::with_capacity(node_columns * (last.1 - first.1 + 1) as usize);
        for node_row in first.1..=last.1 {
            for node_column in first.0..=last.0 {
                let x = -HALF_WORLD + ((node_column * MESH) as f64 + 0.5) * resolution;
                let y = HALF_WORLD - ((node_row * MESH) as f64 + 0.5) * resolution;
                nodes.push(
                    to_native
                        .apply(x, y)
                        .ok()
                        .filter(|(x, y)| x.is_finite() && y.is_finite()),
                );
            }
        }
        Self {
            first,
            columns: node_columns,
            nodes,
        }
    }

    /// The native point under the centre of lattice pixel `(column, row)`.
    fn native(&self, column: i64, row: i64) -> Option<(f64, f64)> {
        let (node_column, node_row) = (column.div_euclid(MESH), row.div_euclid(MESH));
        let fx = (column - node_column * MESH) as f64 / MESH as f64;
        let fy = (row - node_row * MESH) as f64 / MESH as f64;
        let at = (node_row - self.first.1) as usize * self.columns
            + (node_column - self.first.0) as usize;
        let (n00, n10) = (self.nodes[at]?, self.nodes[at + 1]?);
        let (n01, n11) = (
            self.nodes[at + self.columns]?,
            self.nodes[at + self.columns + 1]?,
        );
        let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
        let top = (lerp(n00.0, n10.0, fx), lerp(n00.1, n10.1, fx));
        let bottom = (lerp(n01.0, n11.0, fx), lerp(n01.1, n11.1, fx));
        Some((lerp(top.0, bottom.0, fy), lerp(top.1, bottom.1, fy)))
    }
}

/// The derivative's band: each output window warped from the native window
/// under it.
struct Warp<'a> {
    band: &'a mut dyn BandSource,
    native: RasterGrid,
    to_native: Transformer,
    placement: &'a Placement,
    /// Most native cells one read may hold.
    budget: u64,
}

impl Warp<'_> {
    /// The native cell containing the point under lattice pixel
    /// `(column, row)`, half-open like hover's containing cell.
    fn cell(&self, mesh: &Mesh, column: i64, row: i64) -> Option<(u32, u32)> {
        let (x, y) = mesh.native(column, row)?;
        let gt = self.native.geotransform;
        let cell_x = ((x - gt[0]) / gt[1]).floor();
        let cell_y = ((y - gt[3]) / gt[5]).floor();
        ((0.0..f64::from(self.native.width)).contains(&cell_x)
            && (0.0..f64::from(self.native.height)).contains(&cell_y))
        .then_some((cell_x as u32, cell_y as u32))
    }

    /// Fill output columns `columns` of `window` (already NoData), splitting
    /// them while the native window under them exceeds the budget.
    fn fill(
        &mut self,
        window: RasterWindow,
        columns: std::ops::Range<u32>,
        out: &mut [f32],
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        check_cancel(cancel)?;
        let lattice_columns = self.placement.column + i64::from(columns.start)
            ..self.placement.column + i64::from(columns.end);
        let lattice_rows = self.placement.row + i64::from(window.y)
            ..self.placement.row + i64::from(window.y + window.height);
        let mesh = Mesh::over(
            &self.to_native,
            self.placement.resolution,
            lattice_columns.clone(),
            lattice_rows.clone(),
        );
        let mut extent: Option<[u32; 4]> = None;
        for row in lattice_rows.clone() {
            for column in lattice_columns.clone() {
                if let Some((x, y)) = self.cell(&mesh, column, row) {
                    let e = extent.get_or_insert([x, y, x, y]);
                    *e = [e[0].min(x), e[1].min(y), e[2].max(x), e[3].max(y)];
                }
            }
        }
        let Some([x0, y0, x1, y1]) = extent else {
            return Ok(());
        };
        let (width, height) = (x1 - x0 + 1, y1 - y0 + 1);
        let cells = u64::from(width) * u64::from(height);
        if cells > self.budget && columns.len() > MESH as usize {
            let middle = columns.start + (columns.len() as u32 / 2);
            self.fill(window, columns.start..middle, out, cancel)?;
            return self.fill(window, middle..columns.end, out, cancel);
        }
        let mut samples = Cells::zeroed(
            usize::try_from(cells).map_err(|_| "the native window is too large".to_string())?,
        );
        self.band.read(
            RasterWindow {
                x: x0,
                y: y0,
                width,
                height,
            },
            &mut samples,
            cancel,
        )?;
        for (line, row) in lattice_rows.enumerate() {
            for column in lattice_columns.clone() {
                if let Some((x, y)) = self.cell(&mesh, column, row) {
                    let target = line * window.width as usize
                        + (column - self.placement.column) as usize
                        - window.x as usize;
                    out[target] = samples[((y - y0) * width + (x - x0)) as usize];
                }
            }
        }
        Ok(())
    }
}

/// The NoData every derivative pixel outside the footprint holds.
struct Filled<'a> {
    warp: Warp<'a>,
    nodata: f32,
}

impl BandSource for Filled<'_> {
    fn read(
        &mut self,
        window: RasterWindow,
        out: &mut [f32],
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        out.fill(self.nodata);
        self.warp
            .fill(window, window.x..window.x + window.width, out, cancel)
    }
}

/// Write the display derivative of `band` (on `grid` in `native`) to
/// `output`: Web Mercator on the global lattice, Deflate, overviews, and
/// `nodata` everywhere the footprint does not reach.
pub(super) fn write(
    output: &Path,
    grid: &RasterGrid,
    native: &ResolvedCrs,
    band: &mut dyn BandSource,
    nodata: f32,
    budget: u64,
    cancel: &AtomicBool,
) -> Result<(), String> {
    check_cancel(cancel)?;
    let gt = grid.geotransform;
    if gt[2] != 0.0 || gt[4] != 0.0 || gt[1] <= 0.0 || gt[5] >= 0.0 {
        return Err(
            "rotated, reflected, or south-up rasters are not supported by the display warp"
                .to_string(),
        );
    }
    let mercator = crs::from_reference("EPSG:3857")?;
    let placement = place(
        grid,
        &Transformer::new(native, &mercator)?,
        rung(native, grid)?,
    )?;
    let geo_keys = crs::geokeys_for(&mercator)?;
    let mut filled = Filled {
        warp: Warp {
            band,
            native: grid.clone(),
            to_native: Transformer::new(&mercator, native)?,
            placement: &placement,
            budget: budget / 2,
        },
        nodata,
    };
    cog::write(
        output,
        cog::CogGeoref {
            grid: &placement.grid,
            geo_keys: Some(&geo_keys),
        },
        Some(nodata),
        &mut filled,
        cog::CogProfile {
            compression: Compression::Deflate,
            overviews: true,
        },
        budget / 2,
        cancel,
    )
}

#[cfg(test)]
mod tests {
    use super::super::super::engine::{RasterEngine, RasterGeoref, RasterInput, RasterProbe};
    use super::super::super::grid::RasterGrid;
    use super::super::{RustRasterEngine, high_water};
    use std::collections::HashSet;
    use std::path::Path;
    use std::sync::atomic::AtomicBool;

    const HALF_WORLD: f64 = 20_037_508.342_789_244;
    /// Zoom 18's pixel: RD New's 0.5 m cell is 0.82 Web Mercator metres at
    /// the row's reference latitude, so this is the rung just finer.
    const ZOOM_18: f64 = 2.0 * HALF_WORLD / 256.0 / 262_144.0;
    /// -2^127, the NoData of a derivative whose input declares none.
    const FILL: f32 = -1.701_411_8e38;

    fn scratch(label: &str) -> crate::test_scratch::TestScratch {
        crate::test_scratch::TestScratch::new(&format!("display-warp-{label}"))
    }

    fn cancel() -> AtomicBool {
        AtomicBool::new(false)
    }

    /// An RD New grid of 0.5 m cells whose top-left corner is `(x, y)`.
    fn rd(x: f64, y: f64, width: u32, height: u32) -> RasterGrid {
        RasterGrid {
            width,
            height,
            geotransform: [x, 0.5, 0.0, y, 0.0, -0.5],
        }
    }

    /// A distinct value per cell, a -9999 hole and a few NaN cells.
    fn ramp(width: u32, height: u32) -> Vec<f32> {
        let mut values = Vec::with_capacity((width * height) as usize);
        for row in 0..height {
            for column in 0..width {
                let value = if (20..30).contains(&row) && (40..55).contains(&column) {
                    -9999.0
                } else if row % 31 == 7 && column % 29 == 3 {
                    f32::NAN
                } else {
                    (row * width + column) as f32 * 0.25 + 1.0
                };
                values.push(value);
            }
        }
        values
    }

    fn display(
        output: &Path,
        grid: &RasterGrid,
        values: &[f32],
        nodata: Option<f32>,
    ) -> (RasterProbe, Vec<f32>) {
        let engine = RustRasterEngine;
        engine
            .write_display_cog(
                RasterInput::Samples { grid, values },
                output,
                Some(RasterGeoref {
                    grid,
                    crs: "EPSG:28992",
                }),
                nodata,
                &cancel(),
            )
            .unwrap();
        read(output)
    }

    fn read(path: &Path) -> (RasterProbe, Vec<f32>) {
        let engine = RustRasterEngine;
        let probe = engine.probe(path, &cancel()).unwrap();
        let samples = engine
            .read_f32(path, probe.width, probe.height, &cancel())
            .unwrap();
        (probe, samples)
    }

    /// The global lattice index of a derivative's top-left pixel.
    fn lattice_origin(probe: &RasterProbe) -> (i64, i64) {
        let gt = probe.geotransform;
        let column = (gt[0] + HALF_WORLD) / gt[1];
        let row = (HALF_WORLD - gt[3]) / -gt[5];
        assert!(
            (column - column.round()).abs() < 1e-6 && (row - row.round()).abs() < 1e-6,
            "the origin {gt:?} is off the lattice by ({column}, {row}) pixels"
        );
        (column.round() as i64, row.round() as i64)
    }

    /// The module's claim: at a 0.5 m RD cell the mesh places every pixel
    /// centre within a micrometre of the exact transform.
    #[test]
    fn the_mesh_stays_within_a_micrometre_of_the_exact_transform() {
        use super::super::crs::{Transformer, from_reference};
        let native = from_reference("EPSG:28992").unwrap();
        let mercator = from_reference("EPSG:3857").unwrap();
        let resolution = super::rung(&native, &rd(85_000.0, 447_500.0, 1, 1)).unwrap();
        assert!((resolution - ZOOM_18).abs() < 1e-12);
        let to_native = Transformer::new(&mercator, &native).unwrap();
        let (column, row) = (
            ((486_208.0 + HALF_WORLD) / resolution) as i64,
            ((HALF_WORLD - 6_801_382.0) / resolution) as i64,
        );
        let mesh = super::Mesh::over(&to_native, resolution, column..column + 64, row..row + 64);
        let mut worst = 0f64;
        for y in row..row + 64 {
            for x in column..column + 64 {
                let meshed = mesh.native(x, y).unwrap();
                let exact = to_native
                    .apply(
                        -HALF_WORLD + (x as f64 + 0.5) * resolution,
                        HALF_WORLD - (y as f64 + 0.5) * resolution,
                    )
                    .unwrap();
                worst = worst.max((meshed.0 - exact.0).hypot(meshed.1 - exact.1));
            }
        }
        assert!(
            worst < 1e-6,
            "the mesh is {worst} m from the exact transform"
        );
    }

    /// A2: the derivative carries the Web Mercator code keys, its pixel is a
    /// zoom-ladder rung and its origin sits on the global lattice.
    #[test]
    fn a_display_derivative_is_web_mercator_on_the_global_lattice() {
        let dir = scratch("lattice");
        let grid = rd(85_000.0, 447_500.0, 120, 80);
        let (probe, _) = display(&dir.join("tile.tif"), &grid, &ramp(120, 80), Some(-9999.0));
        assert_eq!(probe.crs_ref, "EPSG:3857");
        let gt = probe.geotransform;
        assert!((gt[1] - ZOOM_18).abs() < 1e-12, "{gt:?}");
        assert!((gt[5] + ZOOM_18).abs() < 1e-12, "{gt:?}");
        assert_eq!((gt[2], gt[4]), (0.0, 0.0));
        lattice_origin(&probe);
        // The derivative holds the tile: each corner, placed by the authority.
        let [min_x, min_y, max_x, max_y] = grid.bounds();
        let corners = RustRasterEngine
            .transform_points(
                "EPSG:28992",
                "EPSG:3857",
                &[
                    (min_x, max_y),
                    (max_x, max_y),
                    (max_x, min_y),
                    (min_x, min_y),
                ],
                &cancel(),
            )
            .unwrap();
        let west = gt[0];
        let north = gt[3];
        let east = west + gt[1] * f64::from(probe.width);
        let south = north + gt[5] * f64::from(probe.height);
        for (x, y) in corners.into_iter().flatten() {
            assert!(
                (west..=east).contains(&x) && (south..=north).contains(&y),
                "corner ({x}, {y}) lies outside [{west}, {south}, {east}, {north}]"
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A2: three RD tiles meeting along a vertical and a horizontal seam.
    /// Every Web Mercator pixel whose centre the authority places inside
    /// one tile shows that tile and no other: no gap, no double cover.
    #[test]
    fn adjacent_tiles_leave_no_gap_and_no_double_cover() {
        let dir = scratch("seams");
        let tiles = [
            (rd(85_000.0, 447_500.0, 120, 80), 1.0f32),
            (rd(85_060.0, 447_500.0, 120, 80), 2.0),
            (rd(85_000.0, 447_460.0, 120, 80), 3.0),
        ];
        let written: Vec<(RasterProbe, Vec<f32>, (i64, i64))> = tiles
            .iter()
            .enumerate()
            .map(|(index, (grid, value))| {
                let values = vec![*value; (grid.width * grid.height) as usize];
                let (probe, samples) =
                    display(&dir.join(format!("{index}.tif")), grid, &values, None);
                assert_eq!(probe.crs_ref, "EPSG:3857");
                let origin = lattice_origin(&probe);
                (probe, samples, origin)
            })
            .collect();
        let resolution = written[0].0.geotransform[1];
        let first_column = written.iter().map(|(_, _, (c, _))| *c).min().unwrap();
        let first_row = written.iter().map(|(_, _, (_, r))| *r).min().unwrap();
        let last_column = written
            .iter()
            .map(|(probe, _, (c, _))| c + i64::from(probe.width))
            .max()
            .unwrap();
        let last_row = written
            .iter()
            .map(|(probe, _, (_, r))| r + i64::from(probe.height))
            .max()
            .unwrap();
        let mut centres = Vec::new();
        for row in first_row..last_row {
            for column in first_column..last_column {
                centres.push((
                    -HALF_WORLD + (column as f64 + 0.5) * resolution,
                    HALF_WORLD - (row as f64 + 0.5) * resolution,
                ));
            }
        }
        let native = RustRasterEngine
            .transform_points("EPSG:3857", "EPSG:28992", &centres, &cancel())
            .unwrap();
        // Which tile holds a native point, or `None` within 1 mm of a tile
        // edge, where the mesh's micrometres may decide either way.
        let holder = |x: f64, y: f64| -> Option<Option<usize>> {
            let near = |a: f64, b: f64| (a - b).abs() < 1e-3;
            if [85_000.0, 85_060.0, 85_120.0]
                .iter()
                .any(|edge| near(x, *edge))
                || [447_420.0, 447_460.0, 447_500.0]
                    .iter()
                    .any(|edge| near(y, *edge))
            {
                return None;
            }
            Some(tiles.iter().position(|(grid, _)| {
                let [min_x, min_y, max_x, max_y] = grid.bounds();
                (min_x..max_x).contains(&x) && y > min_y && y <= max_y
            }))
        };
        let (mut seam_pixels, mut checked) = (0usize, 0usize);
        let width = (last_column - first_column) as usize;
        for (index, placed) in native.iter().enumerate() {
            let column = first_column + (index % width) as i64;
            let row = first_row + (index / width) as i64;
            let shown: Vec<usize> = written
                .iter()
                .enumerate()
                .filter(|(_, (probe, samples, (c, r)))| {
                    let (x, y) = (column - c, row - r);
                    x >= 0
                        && y >= 0
                        && x < i64::from(probe.width)
                        && y < i64::from(probe.height)
                        && samples[(y * i64::from(probe.width) + x) as usize] != FILL
                })
                .map(|(tile, _)| tile)
                .collect();
            assert!(shown.len() <= 1, "pixel ({column}, {row}) shows {shown:?}");
            let Some((x, y)) = placed else { continue };
            let Some(expected) = holder(*x, *y) else {
                continue;
            };
            checked += 1;
            assert_eq!(
                shown.first().copied(),
                expected,
                "pixel ({column}, {row}) at RD ({x}, {y})"
            );
            if expected.is_some()
                && ((x - 85_060.0).abs() < resolution || (y - 447_460.0).abs() < resolution)
            {
                seam_pixels += 1;
            }
        }
        assert!(checked > 30_000, "{checked} pixels checked");
        assert!(seam_pixels > 300, "{seam_pixels} pixels along the seams");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A3: a numeric asset above the capacity limit warps from bounded
    /// windows into exactly the bytes the whole raster gives.
    #[test]
    fn an_asset_above_the_extraction_limit_warps_in_bounded_sub_windows() {
        const LIMIT: u64 = 300_000;
        let dir = scratch("sub-windows");
        let engine = RustRasterEngine;
        let (width, height) = (1200u32, 900u32);
        assert!(u64::from(width * height) > 3 * LIMIT);
        let grid = rd(84_400.0, 447_500.0, width, height);
        let authored = ramp(width, height);
        let georef = RasterGeoref {
            grid: &grid,
            crs: "EPSG:28992",
        };
        let asset = dir.join("asset.tif");
        engine
            .write_controlled_cog(
                RasterInput::Samples {
                    grid: &grid,
                    values: &authored,
                },
                &asset,
                Some(georef),
                Some(-9999.0),
                &cancel(),
            )
            .unwrap();
        let whole = dir.join("whole.tif");
        engine
            .write_display_cog(
                RasterInput::Samples {
                    grid: &grid,
                    values: &authored,
                },
                &whole,
                Some(georef),
                Some(-9999.0),
                &cancel(),
            )
            .unwrap();
        let streamed = dir.join("streamed.tif");
        let peak = {
            let _limit = super::super::super::import::extraction_limit_probe::set(LIMIT);
            high_water::reset();
            engine
                .write_display_cog(RasterInput::File(&asset), &streamed, None, None, &cancel())
                .unwrap();
            high_water::peak()
        };
        assert!(peak > 0 && peak <= LIMIT, "held {peak} cells");
        assert_eq!(
            engine.probe(&streamed, &cancel()).unwrap().crs_ref,
            "EPSG:3857"
        );
        assert!(
            std::fs::read(&whole).unwrap() == std::fs::read(&streamed).unwrap(),
            "the bounded warp differs from the whole one"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A3: nearest-neighbour sampling copies values and NoData and blends
    /// nothing; a source without a NoData tag gets the display sentinel.
    #[test]
    fn nodata_is_kept_and_no_value_is_new() {
        let dir = scratch("values");
        let (width, height) = (150u32, 100u32);
        let grid = rd(85_000.0, 447_500.0, width, height);
        let authored = ramp(width, height);
        let (probe, samples) = display(&dir.join("tile.tif"), &grid, &authored, Some(-9999.0));
        assert_eq!(probe.crs_ref, "EPSG:3857");
        assert_eq!(probe.nodata, Some(-9999.0));
        let known: HashSet<u32> = authored.iter().map(|value| value.to_bits()).collect();
        let mut shown = HashSet::new();
        let mut holes = 0usize;
        for value in &samples {
            if value.is_nan() {
                continue;
            }
            assert!(
                known.contains(&value.to_bits()),
                "{value} is not an input value"
            );
            if *value == -9999.0 {
                holes += 1;
            } else {
                shown.insert(value.to_bits());
            }
        }
        // The pixel is finer than the cell, so every valid cell shows.
        let valid = authored
            .iter()
            .filter(|value| value.is_finite() && **value != -9999.0)
            .count();
        assert!(
            shown.len() * 100 >= valid * 99,
            "{} of {valid} cells shown",
            shown.len()
        );
        // The hole's 150 cells, plus everything outside the tile.
        assert!(holes > 150, "{holes} NoData pixels");

        let (probe, samples) = display(&dir.join("untagged.tif"), &grid, &vec![4.0; 15_000], None);
        assert_eq!(probe.nodata, Some(FILL));
        assert!(samples.iter().all(|value| *value == 4.0 || *value == FILL));
        let _ = std::fs::remove_dir_all(dir);
    }
}
