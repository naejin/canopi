//! Bounded native display tiles for generations that own no display pyramid.
//!
//! A generation stored as sparse resolved chunks has no directory of rendered
//! PNGs. Its tiles are rendered on demand from the immutable resolved lattice:
//! the renderer samples only the windows the target pixels need, never a
//! whole-extent intermediate, and answers with either PNG bytes or an explicit
//! empty/unavailable outcome. Nothing about the request comes from the
//! WebView except identifiers, a style and integer tile coordinates.

use super::analysis::ResultManifest;
use super::catalogue;
use super::display::ColorRamp;
use super::engine::{GdalEngine, GdalProgram};
use super::generation;
use super::grid::RasterGrid;
use super::import::{GenerationManifest, GenerationStorageFormat};
use super::tile_cache::TileKey;
use rusqlite::Connection;
use std::sync::atomic::AtomicBool;

pub(super) const TILE_PIXELS: u32 = 256;
/// Deepest supported display zoom, matching the legacy pyramid ceiling.
pub(super) const MAX_ZOOM: u32 = 22;
/// Web Mercator world width in metres.
const WEB_MERCATOR_WORLD: f64 = 40_075_016.685_578_49;
/// Reduction level whose cell is exactly one stored chunk, so its mean is a
/// stored aggregate rather than a raster read.
const PAGE_LEVEL: u32 = 10;
/// Highest reduction level a tile may select.
///
/// The exponent is bounded before it is used so the footprint arithmetic stays
/// representable; a request that needs more is reported as unavailable instead
/// of silently shortening its footprint.
const MAX_REDUCTION_LEVEL: u32 = 30;
/// Points per coordinate-transform invocation.
const TRANSFORM_BATCH: usize = 4096;
/// Bound on reduction reads while rendering one tile: one per stored chunk a
/// sub-chunk cell needs plus one per multi-chunk footprint. The advertised
/// zoom range needs at most sixteen; a deeper request is refused by name
/// rather than reading an unbounded region. Whole-chunk cells are answered
/// from stored aggregates and cost one record lookup, not a raster read.
const MAX_REDUCTION_READS_PER_TILE: usize = 64;
/// Largest encoded tile accepted, as the transport contract states.
const MAX_PNG_BYTES: usize = 1024 * 1024;

/// One display request, already parsed from the protocol URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TileRequest {
    pub entity_kind: String,
    pub entity_id: String,
    pub generation_id: String,
    pub style: String,
    pub z: u32,
    pub x: u32,
    pub y: u32,
}

/// What a tile request produced.
#[derive(Debug)]
pub(super) enum TileOutcome {
    /// Encoded 256×256 PNG with transparency where there is no valid data.
    Png(Vec<u8>),
    /// The tile holds no coverage at all: nothing to draw, not a failure.
    Empty,
}

impl TileRequest {
    /// Reject malformed requests before any raster work happens.
    pub(super) fn validate(&self) -> Result<(), String> {
        if !matches!(self.entity_kind.as_str(), "source" | "analysis") {
            return Err(format!("unknown raster entity kind {}", self.entity_kind));
        }
        if !matches!(self.style.as_str(), "elevation" | "slope") {
            return Err(format!("unknown display style {}", self.style));
        }
        if self.z > MAX_ZOOM {
            return Err(format!("zoom {} is outside the supported range", self.z));
        }
        let axis = 1u64 << self.z;
        if u64::from(self.x) >= axis || u64::from(self.y) >= axis {
            return Err(format!(
                "tile {}/{}/{} is outside zoom {z}",
                self.z,
                self.x,
                self.y,
                z = self.z
            ));
        }
        Ok(())
    }
}

/// The generation's manifest, whichever storage format describes it.
enum DisplayManifest {
    Dense(GenerationManifest),
    /// A generation with no stored pyramid: published resolved chunks.
    Sparse(GenerationManifest),
    /// A generation with no stored pyramid: an ordered source collection.
    Collection(GenerationManifest),
    SparseResult(ResultManifest),
}

impl DisplayManifest {
    fn grid(&self) -> &RasterGrid {
        match self {
            Self::Dense(manifest) => &manifest.grid,
            Self::Sparse(manifest) => &manifest.grid,
            Self::Collection(manifest) => &manifest.grid,
            Self::SparseResult(manifest) => &manifest.grid,
        }
    }

    /// Whether a slope result is stored in percent rather than degrees.
    fn slope_in_percent(&self) -> bool {
        match self {
            Self::SparseResult(manifest) => {
                manifest.parameters.slope_unit == Some(common_types::lidar::LidarSlopeUnit::Percent)
            }
            _ => false,
        }
    }

    fn crs_wkt(&self) -> &str {
        match self {
            Self::Dense(manifest) => &manifest.crs_wkt,
            Self::Sparse(manifest) => &manifest.crs_wkt,
            Self::Collection(manifest) => &manifest.crs_wkt,
            Self::SparseResult(manifest) => &manifest.crs_wkt,
        }
    }
}

/// Load and classify the manifest of the requested generation.
///
/// Only a sparse generation is rendered natively; a preserved dense
/// generation keeps its published asset pyramid and is refused here by name
/// rather than sampled through a path this adapter does not own.
fn load_manifest(
    connection: &Connection,
    _style: &str,
    request: &TileRequest,
) -> Result<DisplayManifest, String> {
    let json = catalogue::chunked_generation_manifest(
        connection,
        &request.entity_kind,
        &request.entity_id,
        &request.generation_id,
    )?
    .ok_or_else(|| {
        format!(
            "generation {} does not belong to {} {}",
            request.generation_id, request.entity_kind, request.entity_id
        )
    })?;
    match request.entity_kind.as_str() {
        "analysis" => {
            let manifest: ResultManifest = serde_json::from_str(&json)
                .map_err(|e| format!("Invalid analysis manifest: {e}"))?;
            if manifest.format != GenerationStorageFormat::CogChunksV1 {
                return Err("this result has no native tile source".to_string());
            }
            Ok(DisplayManifest::SparseResult(manifest))
        }
        _ => {
            let manifest: GenerationManifest = serde_json::from_str(&json)
                .map_err(|e| format!("Invalid generation manifest: {e}"))?;
            match manifest.format {
                GenerationStorageFormat::CogChunksV1 => Ok(DisplayManifest::Sparse(manifest)),
                GenerationStorageFormat::OrderedMembersV1 => {
                    Ok(DisplayManifest::Collection(manifest))
                }
                GenerationStorageFormat::LegacyDenseV1 => Ok(DisplayManifest::Dense(manifest)),
            }
        }
    }
}

/// Web Mercator bounds `[min_x, min_y, max_x, max_y]` of one XYZ tile.
pub(super) fn tile_bounds_3857(z: u32, x: u32, y: u32) -> [f64; 4] {
    let half = WEB_MERCATOR_WORLD / 2.0;
    let span = WEB_MERCATOR_WORLD / f64::from(1u32 << z);
    let min_x = -half + f64::from(x) * span;
    let max_y = half - f64::from(y) * span;
    [min_x, max_y - span, min_x + span, max_y]
}

/// Reduction level for one target sample's native displacement.
///
/// The rule is defined on global target coordinates, so a sample shared by two
/// tiles selects the same level in both.
pub(super) fn level_for_displacement(displacement_cells: f64) -> Result<u32, String> {
    if !displacement_cells.is_finite() {
        return Err("tile displacement is not finite".to_string());
    }
    let bounded = displacement_cells.max(1.0);
    let exponent = bounded.log2().floor();
    if exponent <= 0.0 {
        return Ok(0);
    }
    if exponent > f64::from(MAX_REDUCTION_LEVEL) {
        return Err(format!(
            "tile displacement needs reduction level {exponent}, above the supported level {MAX_REDUCTION_LEVEL}"
        ));
    }
    Ok(exponent as u32)
}

/// Native-cell side of one reduction level.
pub(super) fn reduced_side(level: u32) -> Result<i64, String> {
    if level > MAX_REDUCTION_LEVEL {
        return Err(format!(
            "reduction level {level} is above the supported level {MAX_REDUCTION_LEVEL}"
        ));
    }
    Ok(1i64 << level)
}

/// Reduced cell whose centre is nearest below a native cell position.
///
/// A reduced cell `k` covers native cells `[k * side, (k + 1) * side)` and its
/// centre sits at `(k + 0.5) * side`, so the cell a sample belongs to is
/// `floor(position / side - 0.5)`.
pub(super) fn reduced_cell(position_cells: f64, side: i64) -> Result<i64, String> {
    if !position_cells.is_finite() {
        return Err("sample position is not finite".to_string());
    }
    let index = position_cells / side as f64 - 0.5;
    if !index.is_finite() || index < i64::MIN as f64 || index > i64::MAX as f64 {
        return Err("reduced cell index is not representable".to_string());
    }
    Ok(index.floor() as i64)
}

/// Value of one minified sample from its reduced cells.
///
/// Reduced cells are a coarse grid whose centres sit at `(k + 0.5) * side`, so
/// a sample interpolates between the four cells around it, normalized over the
/// valid contributors. Nothing here is tile-local: the cell indices come from
/// the sample's own coordinates, so a sample shared by two tiles gets the same
/// value in both.
fn reduced_sample(
    reduction: &ReductionCells<'_>,
    level: u32,
    centre: (f64, f64),
) -> Result<Option<f64>, String> {
    let side_cells = reduced_side(level)?;
    let cell_x = reduced_cell(centre.0, side_cells)?;
    let cell_y = reduced_cell(centre.1, side_cells)?;
    let fx = centre.0 / side_cells as f64 - 0.5 - cell_x as f64;
    let fy = centre.1 / side_cells as f64 - 0.5 - cell_y as f64;
    Ok(bilinear_means(
        [
            reduction.mean(level, cell_x, cell_y),
            reduction.mean(level, cell_x + 1, cell_y),
            reduction.mean(level, cell_x, cell_y + 1),
            reduction.mean(level, cell_x + 1, cell_y + 1),
        ],
        fx,
        fy,
    ))
}

/// Valid-normalized bilinear value of four reduced-cell means.
pub(super) fn bilinear_means(means: [Option<f64>; 4], fx: f64, fy: f64) -> Option<f64> {
    let weights = [
        (1.0 - fx) * (1.0 - fy),
        fx * (1.0 - fy),
        (1.0 - fx) * fy,
        fx * fy,
    ];
    let mut sum = 0.0f64;
    let mut weight = 0.0f64;
    for (mean, weight_at) in means.iter().zip(weights) {
        let Some(value) = mean else {
            continue;
        };
        sum += *value * weight_at;
        weight += weight_at;
    }
    (weight > 0.0).then_some(sum / weight)
}

/// Lattice coordinates of a point, as fractional cell positions.
struct LatticeMapper {
    /// True when the generation lattice is already Web Mercator, so the world
    /// point needs no reprojection and only the lattice geotransform applies.
    identity: bool,
    crs_wkt: String,
    geotransform: [f64; 6],
}

impl LatticeMapper {
    /// Build a mapper, proving the affine shortcut against GDAL once.
    ///
    /// The layer lattice is authoritative, so when the generation's CRS *is*
    /// Web Mercator the lattice geotransform already maps world coordinates to
    /// cells. That shortcut is verified by transforming one point through GDAL
    /// and comparing; a mismatch drops to the batched transform, so the
    /// projection authority is never bypassed silently.
    fn open(
        engine: &GdalEngine,
        cancel: &AtomicBool,
        grid: &RasterGrid,
        crs_wkt: &str,
    ) -> Result<Self, String> {
        let geotransform = grid.geotransform;
        let mut identity = false;
        if crs_wkt.contains("3857") {
            // Prove the shortcut against the projection authority once: when
            // the lattice really is Web Mercator, GDAL's answer for a probe
            // point must equal the geotransform's.
            let through_gdal = transform_points(engine, cancel, crs_wkt, &[(0.0, 0.0)])?;
            if let Some((x, y)) = through_gdal.first() {
                let expected = lattice_point(&geotransform, *x, *y);
                let shortcut = lattice_point(&geotransform, 0.0, 0.0);
                if (expected.0 - shortcut.0).abs() < 1e-9 && (expected.1 - shortcut.1).abs() < 1e-9
                {
                    identity = true;
                }
            }
        }
        Ok(Self {
            identity,
            crs_wkt: crs_wkt.to_string(),
            geotransform,
        })
    }

    /// Fractional lattice cells of EPSG:3857 points.
    fn to_cells(
        &self,
        engine: &GdalEngine,
        cancel: &AtomicBool,
        points: &[(f64, f64)],
    ) -> Result<Vec<(f64, f64)>, String> {
        // A reprojected point is still a world coordinate: the lattice
        // geotransform is what turns it into a cell, in both paths.
        let projected = if self.identity {
            points.to_vec()
        } else {
            transform_points(engine, cancel, &self.crs_wkt, points)?
        };
        Ok(projected
            .iter()
            .map(|(x, y)| lattice_point(&self.geotransform, *x, *y))
            .collect())
    }
}

/// Fractional lattice cells of one point in the lattice's own CRS.
fn lattice_point(geotransform: &[f64; 6], x: f64, y: f64) -> (f64, f64) {
    (
        (x - geotransform[0]) / geotransform[1],
        (y - geotransform[3]) / geotransform[5],
    )
}

/// Transform EPSG:3857 points into the generation's lattice cells through
/// GDAL, in bounded batches, validating the returned count.
fn transform_points(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    crs_wkt: &str,
    points: &[(f64, f64)],
) -> Result<Vec<(f64, f64)>, String> {
    let mut cells = Vec::with_capacity(points.len());
    for batch in points.chunks(TRANSFORM_BATCH) {
        let mut input = String::with_capacity(batch.len() * 32);
        for (x, y) in batch {
            input.push_str(&format!("{x} {y}\n"));
        }
        let output = engine.run_with_input(
            GdalProgram::Transform,
            &[
                "-s_srs".to_string(),
                "EPSG:3857".to_string(),
                "-t_srs".to_string(),
                crs_wkt.to_string(),
            ],
            input.as_bytes(),
            Some(cancel),
        )?;
        let mut produced = 0usize;
        for line in output.stdout.lines() {
            let mut parts = line.split_whitespace();
            let (Some(x), Some(y)) = (parts.next(), parts.next()) else {
                continue;
            };
            let (Ok(x), Ok(y)) = (x.parse::<f64>(), y.parse::<f64>()) else {
                return Err(format!("gdaltransform produced an unreadable row: {line}"));
            };
            if !x.is_finite() || !y.is_finite() {
                return Err("gdaltransform produced a non-finite coordinate".to_string());
            }
            cells.push((x, y));
            produced += 1;
        }
        if produced != batch.len() {
            return Err(format!(
                "gdaltransform returned {produced} coordinates for {} requested points",
                batch.len()
            ));
        }
    }
    Ok(cells)
}

/// Valid-only mean of one aligned block inside a page buffer.
#[allow(clippy::too_many_arguments)]
fn block_mean(
    values: &[f32],
    valid: &[u8],
    page_origin_x: i64,
    page_origin_y: i64,
    block_x: i64,
    block_y: i64,
    side: i64,
    page_side: usize,
) -> Option<f64> {
    let start_x = block_x - page_origin_x;
    let start_y = block_y - page_origin_y;
    if start_x < 0 || start_y < 0 {
        return None;
    }
    let (mut sum, mut count) = (0.0f64, 0u64);
    for row in 0..side {
        let y = start_y + row;
        if y >= page_side as i64 {
            break;
        }
        for column in 0..side {
            let x = start_x + column;
            if x >= page_side as i64 {
                break;
            }
            let index = y as usize * page_side + x as usize;
            if valid[index] == 0 {
                continue;
            }
            sum += f64::from(values[index]);
            count += 1;
        }
    }
    if count == 0 {
        None
    } else {
        Some(sum / count as f64)
    }
}

/// Sample one 2×2 bilinear neighbourhood from a resolved window.
fn bilinear(
    values: &[f32],
    valid: &[u8],
    width: usize,
    x: usize,
    y: usize,
    fx: f64,
    fy: f64,
) -> Option<f64> {
    let mut weighted = 0.0f64;
    let mut weight_sum = 0.0f64;
    for (dy, wy) in [(0usize, 1.0 - fy), (1, fy)] {
        for (dx, wx) in [(0usize, 1.0 - fx), (1, fx)] {
            let weight = wx * wy;
            if weight <= 0.0 {
                continue;
            }
            let index = (y + dy) * width + x + dx;
            if valid[index] == 0 {
                continue;
            }
            weighted += f64::from(values[index]) * weight;
            weight_sum += weight;
        }
    }
    if weight_sum <= 0.0 {
        None
    } else {
        Some(weighted / weight_sum)
    }
}

/// Render one tile, serving a reproducible cached copy when one exists.
///
/// The cache is a pure accelerator: a hit is always the same pixels because
/// the key names an immutable generation and an explicit style version, and a
/// miss, an eviction or an interrupted write only costs a re-render.
pub(super) fn render_tile(
    library: &super::LidarLibrary,
    request: &TileRequest,
    cancel: &AtomicBool,
) -> Result<TileOutcome, String> {
    request.validate()?;
    let key = TileKey {
        generation_id: request.generation_id.clone(),
        style: request.style.clone(),
        z: request.z,
        x: request.x,
        y: request.y,
    };
    {
        let mut cache = library.tile_cache()?;
        if let Some(bytes) = cache.get(&key) {
            return Ok(TileOutcome::Png(bytes));
        }
        // Held across the render so eviction cannot drop what we are about to
        // store, then released before the cache lock is taken again.
        cache.begin(&key);
    }
    let outcome = render_tile_uncached(library, request, cancel);
    let mut cache = library.tile_cache()?;
    cache.end(&key);
    match outcome {
        Ok(TileOutcome::Png(bytes)) => {
            cache.insert(&key, bytes.clone())?;
            Ok(TileOutcome::Png(bytes))
        }
        // An empty tile costs nothing to re-derive and would only fill the
        // cache with transparent entries.
        other => other,
    }
}

/// The reader that serves one generation's numbers.
///
/// A chunked generation (source or slope result) reads its published records; an
/// ordered collection resolves its source COGs on demand. Either way the reader
/// is bound to the immutable generation the request named.
fn render_owner(
    library: &super::LidarLibrary,
    request: &TileRequest,
    manifest: &DisplayManifest,
    bounds: Option<super::collection::ReadBounds>,
    cancel: &AtomicBool,
) -> Result<generation::GenerationReader, String> {
    match manifest {
        DisplayManifest::Collection(manifest) => {
            let collection = super::collection::load_reader_within(
                library,
                &request.generation_id,
                manifest,
                bounds,
                cancel,
            )?
            .ok_or_else(|| {
                "accepted collection is missing a source payload; the layer cannot be \
                         displayed without inventing coverage"
                    .to_string()
            })?;
            Ok(generation::GenerationReader::Collection(Box::new(
                collection,
            )))
        }
        _ => Ok(generation::GenerationReader::Chunks(
            generation::GenerationChunkReader::new(&request.generation_id, generation::RESULT_ROLE),
        )),
    }
}

/// Half-open lattice cells a tile's own samples can read.
///
/// The footprint is the mapped sample grid with one cell of slack on every
/// side, which covers the windows this renderer actually reads. It is only
/// meaningful for an ordered composition; every other format ignores it.
fn tile_read_bounds(
    manifest: &DisplayManifest,
    cells: &[(f64, f64)],
) -> Result<Option<super::collection::ReadBounds>, String> {
    if !matches!(manifest, DisplayManifest::Collection(_)) {
        return Ok(None);
    }
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for (x, y) in cells {
        if !x.is_finite() || !y.is_finite() {
            continue;
        }
        min_x = min_x.min(*x);
        min_y = min_y.min(*y);
        max_x = max_x.max(*x);
        max_y = max_y.max(*y);
    }
    if !min_x.is_finite() || !min_y.is_finite() {
        return Ok(None);
    }
    Ok(Some(super::collection::ReadBounds {
        x0: min_x.floor() as i64 - 1,
        y0: min_y.floor() as i64 - 1,
        x1: max_x.ceil() as i64 + 2,
        y1: max_y.ceil() as i64 + 2,
    }))
}

/// Render one tile from an immutable generation.
fn render_tile_uncached(
    library: &super::LidarLibrary,
    request: &TileRequest,
    cancel: &AtomicBool,
) -> Result<TileOutcome, String> {
    let engine = &library.inner.engine;
    let manifest = {
        let connection = library.catalogue()?;
        load_manifest(&connection, &request.style, request)?
    };
    let lattice = manifest.grid().clone();
    let ramp = match request.style.as_str() {
        "slope" => ColorRamp::slope_degrees(),
        _ => {
            let (min, max) = generation_range(library, request)?;
            ColorRamp::elevation_range(min, max.max(min + 1.0))
        }
    };
    let lookup = |value: f64| -> f64 {
        if request.style == "slope" && manifest.slope_in_percent() {
            // Percent is converted to degrees for colour lookup only: the
            // stored result keeps the unit its recipe reported.
            (value / 100.0).atan().to_degrees()
        } else {
            value
        }
    };
    let mapper = LatticeMapper::open(engine, cancel, &lattice, manifest.crs_wkt())?;

    let bounds = tile_bounds_3857(request.z, request.x, request.y);
    let pixel_span_x = (bounds[2] - bounds[0]) / f64::from(TILE_PIXELS);
    let pixel_span_y = (bounds[3] - bounds[1]) / f64::from(TILE_PIXELS);
    let side = TILE_PIXELS as usize + 1;
    let mut points = Vec::with_capacity(side * side);
    for row in 0..side {
        let y = bounds[3] - (row as f64 + 0.5) * pixel_span_y;
        for column in 0..side {
            let x = bounds[0] + (column as f64 + 0.5) * pixel_span_x;
            points.push((x, y));
        }
    }
    let cells = mapper.to_cells(engine, cancel, &points)?;

    // Per-sample reduction level from the sample's own native displacement, so
    // a sample shared by two tiles selects the same level in both. The level
    // bounds the footprint arithmetic before it is used.
    let samples = TILE_PIXELS as usize;
    let mut levels = vec![0u32; samples * samples];
    for row in 0..samples {
        for column in 0..samples {
            let centre = cells[row * side + column];
            let right = cells[row * side + column + 1];
            let down = cells[(row + 1) * side + column];
            let displacement = hypot(right.0 - centre.0, right.1 - centre.1)
                .max(hypot(down.0 - centre.0, down.1 - centre.1));
            levels[row * samples + column] = level_for_displacement(displacement)?;
        }
    }

    // Bound to the immutable generation, and for an ordered composition to the
    // occurrences that can reach this tile: a source outside the footprint is
    // never opened, while the composed value stays identical to reading the
    // whole composition.
    let read_bounds = tile_read_bounds(&manifest, &cells)?;
    let owner = render_owner(library, request, &manifest, read_bounds, cancel)?;

    // Every reduced cell a sample interpolates between, resolved once per tile:
    // whole-chunk cells come from stored aggregates, sub-chunk cells share one
    // bounded page read per stored chunk, and a footprint crossing chunks adds
    // stored sums and reads only its boundary chunks.
    let mut reduction = ReductionCells::new(&owner, library, &lattice, cancel);
    for row in 0..samples {
        for column in 0..samples {
            let level = levels[row * samples + column];
            if level == 0 {
                continue;
            }
            let centre = cells[row * side + column];
            let side_cells = reduced_side(level)?;
            let cell_x = reduced_cell(centre.0, side_cells)?;
            let cell_y = reduced_cell(centre.1, side_cells)?;
            reduction.require(level, cell_x, cell_y)?;
            reduction.require(level, cell_x + 1, cell_y)?;
            reduction.require(level, cell_x, cell_y + 1)?;
            reduction.require(level, cell_x + 1, cell_y + 1)?;
        }
    }
    reduction.load()?;

    // Native-scale samples come from one window covering just those samples; a
    // tile that is minified everywhere never allocates a native-scale window.
    let dense = if levels.contains(&0) {
        Some(read_dense_window(
            &owner, library, &lattice, &cells, side, &levels, cancel,
        )?)
    } else {
        None
    };

    let mut rgba = vec![0u8; (TILE_PIXELS * TILE_PIXELS * 4) as usize];
    let mut painted = 0usize;
    let mut paint = |row: usize, column: usize, value: f64| {
        let Some((r, g, b)) = ramp.colour_for(lookup(value)) else {
            return;
        };
        let index = (row * samples + column) * 4;
        rgba[index] = r;
        rgba[index + 1] = g;
        rgba[index + 2] = b;
        rgba[index + 3] = 255;
        painted += 1;
    };
    for row in 0..samples {
        for column in 0..samples {
            if column % 32 == 0 {
                super::import::check_cancel(cancel)?;
            }
            let centre = cells[row * side + column];
            let level = levels[row * samples + column];
            let value = if level == 0 {
                dense
                    .as_ref()
                    .and_then(|window| window.sample(centre.0, centre.1))
            } else {
                reduced_sample(&reduction, level, centre)?
            };
            if let Some(value) = value {
                paint(row, column, value);
            }
        }
    }

    if painted == 0 {
        return Ok(TileOutcome::Empty);
    }
    let png = encode_png(&rgba)?;
    if png.len() > MAX_PNG_BYTES {
        return Err(format!(
            "encoded tile is {} bytes, above the {MAX_PNG_BYTES} byte transport limit",
            png.len()
        ));
    }
    Ok(TileOutcome::Png(png))
}

/// One bounded window of native cells, indexed for bilinear sampling.
struct DenseWindow {
    values: Vec<f32>,
    valid: Vec<u8>,
    width: usize,
    origin_x: i64,
    origin_y: i64,
}

impl DenseWindow {
    /// Bilinearly sample at fractional lattice cells, normalizing over the
    /// valid contributors; no valid contributor means no colour.
    fn sample(&self, cell_x: f64, cell_y: f64) -> Option<f64> {
        let base_x = cell_x.floor();
        let base_y = cell_y.floor();
        let x = base_x as i64 - self.origin_x;
        let y = base_y as i64 - self.origin_y;
        if x < 0 || y < 0 || x + 1 >= self.width as i64 || y + 1 >= self.width as i64 {
            return None;
        }
        bilinear(
            &self.values,
            &self.valid,
            self.width,
            x as usize,
            y as usize,
            cell_x - base_x,
            cell_y - base_y,
        )
    }
}

/// Published value range of the requested generation.
fn generation_range(
    library: &super::LidarLibrary,
    request: &TileRequest,
) -> Result<(f64, f64), String> {
    let connection = library.catalogue()?;
    let (table, owner_column) = match request.entity_kind.as_str() {
        "source" => ("lidar_layer_generations", "layer_id"),
        "analysis" => ("lidar_analysis_generations", "definition_id"),
        other => return Err(format!("unknown raster entity kind {other}")),
    };
    let sql =
        format!("SELECT min_value, max_value FROM {table} WHERE id = ?1 AND {owner_column} = ?2");
    connection
        .query_row(
            &sql,
            rusqlite::params![request.generation_id, request.entity_id],
            |row| Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, Option<f64>>(1)?)),
        )
        .map(|(min, max)| (min.unwrap_or(0.0), max.unwrap_or(1.0)))
        .map_err(|e| format!("Failed to read generation range: {e}"))
}

/// Reduced cells grouped by the stored chunk that holds them, as
/// `(level, cell_x, cell_y)` triples.
type ChunkCells = std::collections::BTreeMap<(i64, i64), Vec<(u32, i64, i64)>>;

/// Reduced cells one tile needs, with their valid-only means.
///
/// A cell whose footprint fits inside one stored chunk shares that chunk's
/// single bounded page read; a whole-chunk cell uses the stored aggregate; a
/// footprint crossing chunk boundaries adds stored sums for the chunks it
/// encloses and reads only its boundary chunks. Nothing here grows with the
/// generation: the plan is bounded by the tile's own samples.
struct ReductionCells<'a> {
    owner: &'a generation::GenerationReader,
    library: &'a super::LidarLibrary,
    lattice: &'a RasterGrid,
    cancel: &'a AtomicBool,
    needed: std::collections::BTreeSet<(u32, i64, i64)>,
    means: std::collections::HashMap<(u32, i64, i64), Option<f64>>,
    reads: usize,
}

impl<'a> ReductionCells<'a> {
    fn new(
        owner: &'a generation::GenerationReader,
        library: &'a super::LidarLibrary,
        lattice: &'a RasterGrid,
        cancel: &'a AtomicBool,
    ) -> Self {
        Self {
            owner,
            library,
            lattice,
            cancel,
            needed: std::collections::BTreeSet::new(),
            means: std::collections::HashMap::new(),
            reads: 0,
        }
    }

    /// Record one reduced cell this tile interpolates between.
    fn require(&mut self, level: u32, cell_x: i64, cell_y: i64) -> Result<(), String> {
        // The cell index is bounded by the level before any rectangle is built.
        let side = reduced_side(level)?;
        cell_x
            .checked_mul(side)
            .and_then(|origin| origin.checked_add(side))
            .ok_or_else(|| "reduced cell footprint overflows".to_string())?;
        cell_y
            .checked_mul(side)
            .and_then(|origin| origin.checked_add(side))
            .ok_or_else(|| "reduced cell footprint overflows".to_string())?;
        self.needed.insert((level, cell_x, cell_y));
        Ok(())
    }

    /// The valid-only mean of one required cell, when it holds any valid cell.
    fn mean(&self, level: u32, cell_x: i64, cell_y: i64) -> Option<f64> {
        self.means.get(&(level, cell_x, cell_y)).copied().flatten()
    }

    /// Resolve every required cell, reading each stored chunk at most once.
    fn load(&mut self) -> Result<(), String> {
        // Sub-chunk and whole-chunk cells, grouped by the chunk that holds them.
        let mut by_chunk: ChunkCells = std::collections::BTreeMap::new();
        for (level, cell_x, cell_y) in &self.needed {
            let side = reduced_side(*level)?;
            let origin_x = cell_x
                .checked_mul(side)
                .ok_or_else(|| "reduced cell footprint overflows".to_string())?;
            let origin_y = cell_y
                .checked_mul(side)
                .ok_or_else(|| "reduced cell footprint overflows".to_string())?;
            if *level > PAGE_LEVEL {
                self.reads += 1;
                if self.reads > MAX_REDUCTION_READS_PER_TILE {
                    return Err(format!(
                        "tile needs more than {MAX_REDUCTION_READS_PER_TILE} reduction reads"
                    ));
                }
                let rect = generation::LatticeWindow {
                    x: origin_x,
                    y: origin_y,
                    width: u32::try_from(side)
                        .map_err(|_| "reduced cell is too wide".to_string())?,
                    height: u32::try_from(side)
                        .map_err(|_| "reduced cell is too tall".to_string())?,
                };
                let mean = self
                    .owner
                    .aggregate(self.library, rect, self.cancel)?
                    .and_then(|aggregate| aggregate.mean());
                self.means.insert((*level, *cell_x, *cell_y), mean);
                continue;
            }
            by_chunk
                .entry((
                    origin_x.div_euclid(generation::CHUNK_SIDE),
                    origin_y.div_euclid(generation::CHUNK_SIDE),
                ))
                .or_default()
                .push((*level, *cell_x, *cell_y));
        }

        for ((chunk_x, chunk_y), cells) in by_chunk {
            // A record lookup is one indexed point query; only opening a chunk
            // page or aggregating a crossing footprint is a reduction read.
            // A block that holds no composition coverage is never opened: its
            // cells stay transparent, which is what keeps a minified tile cheap
            // far from the data.
            if !self
                .owner
                .chunk_is_occupied(self.library, chunk_x, chunk_y)?
            {
                for (level, cell_x, cell_y) in cells {
                    self.means.insert((level, cell_x, cell_y), None);
                }
                continue;
            }
            let record = self.owner.chunk_at(self.library, chunk_x, chunk_y)?;
            let origin_x = chunk_x * generation::CHUNK_SIDE;
            let origin_y = chunk_y * generation::CHUNK_SIDE;
            let mut page: Option<generation::ResolvedWindow> = None;
            for (level, cell_x, cell_y) in cells {
                let side = reduced_side(level)?;
                let block_x = cell_x * side;
                let block_y = cell_y * side;
                let mean = if level == PAGE_LEVEL
                    && block_x == origin_x
                    && block_y == origin_y
                    && let Some(record) = &record
                {
                    // The cell is exactly this stored chunk: its aggregate is
                    // already the valid-only sum and count.
                    record.mean()
                } else {
                    if page.is_none() {
                        self.reads += 1;
                        if self.reads > MAX_REDUCTION_READS_PER_TILE {
                            return Err(format!(
                                "tile needs more than {MAX_REDUCTION_READS_PER_TILE} reduction reads"
                            ));
                        }
                        page = Some(self.owner.read_window(
                            self.library,
                            self.lattice,
                            generation::LatticeWindow {
                                x: origin_x,
                                y: origin_y,
                                width: generation::CHUNK_SIDE as u32,
                                height: generation::CHUNK_SIDE as u32,
                            },
                            self.cancel,
                        )?);
                    }
                    let page = page.as_ref().expect("the page was just read");
                    block_mean(
                        &page.samples,
                        &page.valid,
                        origin_x,
                        origin_y,
                        block_x,
                        block_y,
                        side,
                        generation::CHUNK_SIDE as usize,
                    )
                };
                self.means.insert((level, cell_x, cell_y), mean);
            }
        }
        Ok(())
    }
}

/// Read the native cells the level-0 samples of this tile need.
///
/// Only the level-0 samples are covered, so a tile that is minified
/// everywhere never allocates a native-scale window at all.
#[allow(clippy::too_many_arguments)]
fn read_dense_window(
    owner: &generation::GenerationReader,
    library: &super::LidarLibrary,
    lattice: &RasterGrid,
    cells: &[(f64, f64)],
    side: usize,
    levels: &[u32],
    cancel: &AtomicBool,
) -> Result<DenseWindow, String> {
    let samples = TILE_PIXELS as usize;
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for row in 0..samples {
        for column in 0..samples {
            if levels[row * samples + column] != 0 {
                continue;
            }
            let (x, y) = cells[row * side + column];
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    let origin_x = min_x.floor() as i64 - 1;
    let origin_y = min_y.floor() as i64 - 1;
    let width = (max_x.ceil() as i64 - origin_x + 2).max(1);
    let height = (max_y.ceil() as i64 - origin_y + 2).max(1);
    if width > 1026 || height > 1026 {
        return Err(format!(
            "tile needs a {width}x{height} native window, above the reader cap"
        ));
    }
    let resolved = owner.read_window(
        library,
        lattice,
        generation::LatticeWindow {
            x: origin_x,
            y: origin_y,
            width: width as u32,
            height: height as u32,
        },
        cancel,
    )?;
    Ok(DenseWindow {
        values: resolved.samples,
        valid: resolved.valid,
        width: width as usize,
        origin_x,
        origin_y,
    })
}

fn hypot(x: f64, y: f64) -> f64 {
    (x * x + y * y).sqrt()
}

/// Encode 8-bit RGBA pixels as PNG.
fn encode_png(rgba: &[u8]) -> Result<Vec<u8>, String> {
    encode_rgba(rgba, TILE_PIXELS, TILE_PIXELS)
}

fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut bytes);
    image::ImageEncoder::write_image(
        encoder,
        rgba,
        width,
        height,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| format!("Failed to encode tile PNG: {e}"))?;
    Ok(bytes)
}

/// The shared empty tile: a 1×1 transparent PNG.
///
/// MapLibre accepts it as a successful draw of nothing, which keeps "no
/// coverage here" distinct from "this tile could not be rendered".
pub(super) fn transparent_tile() -> Result<&'static [u8], String> {
    use std::sync::OnceLock;
    static EMPTY: OnceLock<Vec<u8>> = OnceLock::new();
    if let Some(bytes) = EMPTY.get() {
        return Ok(bytes);
    }
    let encoded = encode_rgba(&[0u8, 0, 0, 0], 1, 1)?;
    let _ = EMPTY.set(encoded);
    EMPTY
        .get()
        .map(Vec::as_slice)
        .ok_or_else(|| "empty tile cache failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tile_bounds_follow_the_xyz_grid() {
        let world = tile_bounds_3857(0, 0, 0);
        assert!((world[0] + WEB_MERCATOR_WORLD / 2.0).abs() < 1e-6);
        assert!((world[3] - WEB_MERCATOR_WORLD / 2.0).abs() < 1e-6);
        // Tile rows run north to south: z1/y0 is the north-west quadrant.
        let north_west = tile_bounds_3857(1, 0, 0);
        assert!((north_west[2] - 0.0).abs() < 1e-6, "{north_west:?}");
        assert!((north_west[3] - WEB_MERCATOR_WORLD / 2.0).abs() < 1e-6);
        let south_east = tile_bounds_3857(1, 1, 1);
        assert!((south_east[1] + WEB_MERCATOR_WORLD / 2.0).abs() < 1e-6);
        assert!(south_east[2] > north_west[2], "x grows eastward");
    }

    #[test]
    fn reduction_level_follows_the_power_of_two_rule_without_a_page_clamp() {
        assert_eq!(level_for_displacement(0.25), Ok(0));
        assert_eq!(level_for_displacement(1.0), Ok(0));
        assert_eq!(level_for_displacement(1.99), Ok(0));
        assert_eq!(level_for_displacement(2.0), Ok(1));
        assert_eq!(level_for_displacement(3.9), Ok(1));
        assert_eq!(level_for_displacement(4.0), Ok(2));
        // The rule is complete: a footprint wider than one stored chunk keeps
        // its own level instead of being shortened to the chunk level.
        assert_eq!(level_for_displacement(1024.0), Ok(10));
        assert_eq!(level_for_displacement(2048.0), Ok(11));
        assert_eq!(level_for_displacement(4096.0), Ok(12));
        assert_eq!(level_for_displacement(1e9), Ok(29));
        assert_eq!(level_for_displacement(2e9), Ok(30));
        // An unrepresentable or non-finite displacement is explicitly
        // unavailable, never silently shortened.
        assert!(level_for_displacement(4e9).is_err());
        assert!(level_for_displacement(f64::NAN).is_err());
        assert!(level_for_displacement(f64::INFINITY).is_err());
    }

    #[test]
    fn reduced_cells_align_to_their_own_centres() {
        // Level 3 cells are 8 native cells wide and centred at (k + 0.5) * 8,
        // so the cell containing a native position is floor(position / 8 - 0.5).
        assert_eq!(reduced_cell(0.0, 8), Ok(-1));
        assert_eq!(reduced_cell(3.9, 8), Ok(-1));
        assert_eq!(reduced_cell(4.0, 8), Ok(0));
        assert_eq!(reduced_cell(11.9, 8), Ok(0));
        assert_eq!(reduced_cell(12.0, 8), Ok(1));
        // Negative positions follow the same centre convention.
        assert_eq!(reduced_cell(-0.1, 8), Ok(-1));
        assert_eq!(reduced_cell(-4.0, 8), Ok(-1));
        assert_eq!(reduced_cell(-4.1, 8), Ok(-2));
        assert!(reduced_cell(f64::NAN, 8).is_err());
        assert!(reduced_side(PAGE_LEVEL + 1).is_ok());
        assert!(reduced_side(MAX_REDUCTION_LEVEL + 1).is_err());
    }

    #[test]
    fn reduced_cells_interpolate_with_valid_normalized_weights() {
        // Midway between four valid cell centres: the plain mean.
        assert_eq!(
            bilinear_means([Some(0.0), Some(10.0), Some(20.0), Some(30.0)], 0.5, 0.5),
            Some(15.0)
        );
        // An invalid contributor is dropped and the rest renormalized, so a
        // single valid cell still answers exactly.
        assert_eq!(
            bilinear_means([Some(4.0), None, None, None], 0.5, 0.5),
            Some(4.0)
        );
        assert_eq!(bilinear_means([None, None, None, None], 0.5, 0.5), None);
        // A quarter of the way across: 0.75 * 0 + 0.25 * 10.
        assert_eq!(
            bilinear_means([Some(0.0), Some(10.0), None, None], 0.25, 0.0),
            Some(2.5)
        );
    }

    /// Decode a PNG tile into RGBA8 pixels.
    fn decode(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
        let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
            .expect("tile is a PNG")
            .to_rgba8();
        (image.width(), image.height(), image.into_raw())
    }

    /// A tile over a sparse generation draws the data, leaves everything else
    /// transparent, and reports an explicit empty tile far from the coverage.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn native_tiles_render_a_sparse_generation_and_report_empty_areas() {
        let root = std::env::temp_dir().join(catalogue::new_id("canopi-tiles"));
        std::fs::create_dir_all(&root).unwrap();
        let library = super::super::LidarLibrary::open(&root).expect("library opens");
        let engine = &library.inner.engine;
        let cancel = AtomicBool::new(false);

        // A constant plane spanning several chunks, published sparse through
        // the real callers.
        let (width, height, value) = (2048u32, 2048u32, 5.0f32);
        let values = vec![value; (width * height) as usize];
        let raw = root.join("plane.raw");
        super::super::import::write_f32_raw(&raw, &values).unwrap();
        let source = root.join("plane.tif");
        super::super::import::raw_to_tif(
            engine,
            &cancel,
            &raw,
            &source,
            &RasterGrid {
                width,
                height,
                geotransform: [0.0, 1.0, 0.0, f64::from(height), 0.0, -1.0],
            },
            "EPSG:3857",
            -9999.0,
        )
        .unwrap();
        let layer_id = {
            let layer_id = library
                .create_layer(
                    "tiles",
                    common_types::lidar::LidarMeasurementKind::GroundElevation,
                )
                .unwrap();
            let job_id = library.record_import_job(&layer_id).unwrap();
            let output = super::super::import::stage_import(
                &library,
                &job_id,
                &layer_id,
                std::slice::from_ref(&source),
                &cancel,
            )
            .unwrap();
            assert!(output.review.compatible, "{:?}", output.review.issues);
            library.finish_staging(
                &job_id,
                Ok(super::super::import::StagingOutput {
                    review: output.review.clone(),
                }),
            );
            let staging: super::super::import::StagedImport = serde_json::from_str(
                &std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
                    .unwrap(),
            )
            .unwrap();
            library.prepare_apply(&job_id).unwrap();
            super::super::import::apply_import(&library, &staging, true, false, &cancel).unwrap();
            layer_id
        };

        // The layer presents a native tileset rather than an asset template.
        let snapshot = library.library_snapshot().unwrap();
        let layer = snapshot
            .layers
            .iter()
            .find(|layer| layer.id == layer_id)
            .expect("layer summary");
        let tileset = layer
            .tilesets
            .iter()
            .find(|tileset| tileset.style == "elevation")
            .expect("a sparse layer is displayable");
        let common_types::lidar::LidarTileSource::NativeGeneration { generation_id } =
            &tileset.source
        else {
            panic!("a sparse generation has no asset template");
        };
        assert!(tileset.max_zoom >= tileset.min_zoom);

        // A tile at the layer's own zoom over the coverage draws the plane,
        // and a tile beyond it is empty rather than an error.
        let half = WEB_MERCATOR_WORLD / 2.0;
        let span = WEB_MERCATOR_WORLD / f64::from(1u32 << tileset.max_zoom);
        let centre = f64::from(width) / 2.0;
        let tile_x = ((centre + half) / span).floor() as u32;
        let tile_y = ((half - centre) / span).floor() as u32;
        let request = TileRequest {
            entity_kind: "source".to_string(),
            entity_id: layer_id.clone(),
            generation_id: generation_id.clone(),
            style: "elevation".to_string(),
            z: tileset.max_zoom,
            x: tile_x,
            y: tile_y,
        };
        let png = match render_tile(&library, &request, &cancel).unwrap() {
            TileOutcome::Png(bytes) => bytes,
            TileOutcome::Empty => panic!("the covered tile must be drawn"),
        };
        let (tile_width, tile_height, rgba) = decode(&png);
        assert_eq!((tile_width, tile_height), (TILE_PIXELS, TILE_PIXELS));
        assert!(
            rgba.chunks_exact(4).all(|pixel| pixel[3] == 255),
            "a tile inside the plane is fully opaque"
        );

        // A coarser tile holds both the plane and the empty area around it.
        let coarse_span = WEB_MERCATOR_WORLD / 256.0;
        let mixed = TileRequest {
            z: 8,
            x: ((centre + half) / coarse_span).floor() as u32,
            y: ((half - centre) / coarse_span).floor() as u32,
            ..request.clone()
        };
        let png = match render_tile(&library, &mixed, &cancel).unwrap() {
            TileOutcome::Png(bytes) => bytes,
            TileOutcome::Empty => panic!("the mixed tile must be drawn"),
        };
        let (_, _, rgba) = decode(&png);
        let painted = rgba.chunks_exact(4).filter(|p| p[3] == 255).count();
        let transparent = rgba.chunks_exact(4).filter(|p| p[3] == 0).count();
        assert!(painted > 0, "the plane must be drawn");
        assert!(transparent > 0, "outside the plane must stay transparent");
        assert_eq!(painted + transparent, (TILE_PIXELS * TILE_PIXELS) as usize);
        // A constant layer has min == max, so the ramp clamps to its first
        // stop: the rendered colour is exactly that stop.
        let ramp = ColorRamp::elevation_range(5.0, 6.0);
        let (r, g, b) = ramp.colour_for(5.0).unwrap();
        assert!(
            rgba.chunks_exact(4)
                .any(|pixel| pixel[3] == 255 && pixel[0] == r && pixel[1] == g && pixel[2] == b),
            "the drawn pixels use the elevation ramp"
        );

        let beyond = TileRequest {
            x: tile_x + 40,
            ..request.clone()
        };
        assert!(matches!(
            render_tile(&library, &beyond, &cancel).unwrap(),
            TileOutcome::Empty
        ));

        // A deep zoom-out is answered from the stored chunk aggregates and
        // bounded page reads: it must complete without unbounded work.
        let coarse = TileRequest {
            z: 7,
            x: (((centre + half) / (WEB_MERCATOR_WORLD / 128.0)).floor()) as u32,
            y: (((half - centre) / (WEB_MERCATOR_WORLD / 128.0)).floor()) as u32,
            ..request.clone()
        };
        assert!(render_tile(&library, &coarse, &cancel).is_ok());

        // The render path caches: the second identical request is a hit, and
        // deleting the layer drops the generation's cached tiles.
        let cached = match render_tile(&library, &mixed, &cancel).unwrap() {
            TileOutcome::Png(bytes) => bytes,
            TileOutcome::Empty => panic!("the mixed tile must be drawn"),
        };
        let (hits, _) = library.tile_cache().unwrap().counters();
        assert!(hits >= 1, "a repeated tile is served from the cache");
        assert_eq!(
            library.tile_cache().unwrap().get(&TileKey {
                generation_id: generation_id.clone(),
                style: "elevation".to_string(),
                z: mixed.z,
                x: mixed.x,
                y: mixed.y,
            }),
            Some(cached),
            "the cached tile is the drawn tile"
        );
        library.delete_layer(&layer_id).expect("layer deletes");
        let (_, disk_bytes) = library.tile_cache().unwrap().bytes();
        assert_eq!(disk_bytes, 0, "deletion drops the generation's tiles");

        // A generation that belongs to another entity is refused.
        let foreign = TileRequest {
            entity_id: "lyr-missing".to_string(),
            ..request
        };
        let error = render_tile(&library, &foreign, &cancel).unwrap_err();
        assert!(error.contains("does not belong"), "{error}");

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stored_aggregates_answer_whole_chunk_reductions() {
        let chunk = generation::PersistedChunk {
            chunk_x: 0,
            chunk_y: 0,
            asset: generation::CogAsset {
                sha256: "sha".to_string(),
                path: std::path::PathBuf::from("/unused"),
                bytes: 0,
                grid: RasterGrid {
                    width: 2,
                    height: 2,
                    geotransform: [0.0, 1.0, 0.0, 2.0, 0.0, -1.0],
                },
                nodata: Some(f32::NAN),
            },
            nodata: Some(f32::NAN),
            valid_cells: 4,
            sum_value: 20.0,
        };
        assert_eq!(chunk.mean(), Some(5.0));
        let empty = generation::PersistedChunk {
            valid_cells: 0,
            sum_value: 0.0,
            ..chunk
        };
        assert_eq!(empty.mean(), None);
    }

    #[test]
    fn block_means_ignore_invalid_cells_and_page_edges() {
        // A 2x2 page holding one invalid cell.
        let values = [1.0f32, 3.0, 5.0, 7.0];
        let valid = [1u8, 1, 0, 1];
        assert_eq!(
            block_mean(&values, &valid, 0, 0, 0, 0, 2, 2),
            Some(11.0 / 3.0)
        );
        // A block reaching past the page contributes only what the page holds.
        assert_eq!(block_mean(&values, &valid, 0, 0, 1, 1, 2, 2), Some(7.0));
        // A block entirely outside the page has no contributors.
        assert_eq!(block_mean(&values, &valid, 0, 0, -4, 0, 2, 2), None);
    }

    #[test]
    fn malformed_requests_are_rejected_before_any_work() {
        let base = TileRequest {
            entity_kind: "source".to_string(),
            entity_id: "layer".to_string(),
            generation_id: "generation".to_string(),
            style: "elevation".to_string(),
            z: 3,
            x: 1,
            y: 2,
        };
        assert!(base.validate().is_ok());
        let outside = TileRequest {
            x: 8,
            ..base.clone()
        };
        assert!(outside.validate().is_err());
        let unknown_style = TileRequest {
            style: "density".to_string(),
            ..base.clone()
        };
        assert!(unknown_style.validate().is_err());
        let zoom = TileRequest {
            z: MAX_ZOOM + 1,
            ..base
        };
        assert!(zoom.validate().is_err());
    }

    /// A minified sample reads its reduced cell's mean at a cell centre and
    /// interpolates between cell centres, including across a chunk boundary and
    /// at negative lattice coordinates. Missing coverage contributes nothing.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn reduced_sampling_uses_cell_centres_and_complete_footprints() {
        let dir = std::env::temp_dir().join(catalogue::new_id("canopi-reduced-samples"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let library = crate::services::lidar::LidarLibrary::open(&dir).unwrap();
        // Four 1024x1024 chunks, one per stored sum, covering a 2048-cell
        // level-11 footprint with the constants 0, 10, 20 and 30.
        let chunk_side = generation::CHUNK_SIDE as u32;
        // The covered footprint sits at negative lattice cells, so the same
        // arithmetic is exercised where the lattice extends left and up.
        for (chunk_x, chunk_y, value) in [
            (-2, -2, 0.0),
            (-1, -2, 10.0),
            (-2, -1, 20.0),
            (-1, -1, 30.0),
        ] {
            let values = vec![value; (chunk_side * chunk_side) as usize];
            generation::publish_test_chunk(
                &library,
                "generation-s",
                chunk_x,
                chunk_y,
                chunk_side,
                chunk_side,
                &values,
            );
        }
        let owner = generation::GenerationReader::Chunks(generation::GenerationChunkReader::new(
            "generation-s",
            generation::RESULT_ROLE,
        ));
        let lattice = RasterGrid {
            width: 1,
            height: 1,
            geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
        };
        let cancel = AtomicBool::new(false);
        let mut reduction = ReductionCells::new(&owner, &library, &lattice, &cancel);
        let level = 11;
        for cell_y in -2..1 {
            for cell_x in -2..1 {
                reduction.require(level, cell_x, cell_y).unwrap();
            }
        }
        reduction.load().unwrap();

        // The footprint centre is the exact mean of the four enclosed chunks:
        // (0 + 10 + 20 + 30) / 4 = 15.
        assert_eq!(
            reduced_sample(&reduction, level, (-1024.0, -1024.0)),
            Ok(Some(15.0)),
            "a negative reduced cell resolves like any other"
        );
        // Between two covered cell centres the value stays interpolated, and a
        // quarter of the way towards the next cell weights by distance.
        assert_eq!(
            reduced_sample(&reduction, level, (-2048.0, -1024.0)),
            Ok(Some(15.0))
        );
        assert_eq!(
            reduced_sample(&reduction, level, (-1536.0, -1024.0)),
            Ok(Some(15.0))
        );
        // The valid cell keeps answering as a sample moves towards an
        // unoccupied neighbour: an absent cell contributes no weight, so no
        // coverage is invented and no value is dragged towards zero.
        assert_eq!(
            reduced_sample(&reduction, level, (-512.0, -1024.0)),
            Ok(Some(15.0)),
            "the neighbouring empty cell contributes nothing"
        );
        // A sample whose four surrounding cells are all unoccupied has no
        // value at all: the pixel stays transparent.
        assert_eq!(
            reduced_sample(&reduction, level, (1024.0, -1024.0)),
            Ok(None)
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The actual renderer over a generation whose two constant regions meet on
    /// a chunk boundary: ramp colours at reduced-cell centres, interpolation
    /// between centres, alpha at the coverage edges and negative chunk
    /// coordinates all agree with the resolved means.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn native_tiles_interpolate_reduced_cells_across_a_chunk_boundary() {
        let root = std::env::temp_dir().join(catalogue::new_id("canopi-tile-reduction"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = super::super::LidarLibrary::open(&root).expect("library opens");
        let cancel = AtomicBool::new(false);
        let layer_id = library
            .create_layer(
                "tile reduction",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .expect("layer created");
        let generation_id = "generation-reduction";
        // Twelve stored 1024-cell chunks: value 5 west of world x = 0 (negative
        // chunk coordinates) and 25 east of it, so the value transition is
        // exactly the chunk boundary between chunk -1 and chunk 0. Each side is
        // three chunks wide so a whole tile fits inside one constant region.
        let side = generation::CHUNK_SIDE as u32;
        for chunk_y in 0..3 {
            for chunk_x in -3..3 {
                let value = if chunk_x < 0 { 5.0 } else { 25.0 };
                let values = vec![value; (side * side) as usize];
                generation::publish_test_chunk(
                    &library,
                    generation_id,
                    chunk_x,
                    chunk_y,
                    side,
                    side,
                    &values,
                );
            }
        }
        // The layer lattice is the east region's own grid, exactly as a fixed
        // anchor works in production: the west region was published later and
        // therefore occupies negative lattice cells and negative chunk
        // coordinates.
        // The origin is deliberately not a round world coordinate: a value
        // transition that coincides with a tile or sample edge would hide the
        // between-centre interpolation this test exists to prove.
        let grid = RasterGrid {
            width: 3072,
            height: 3072,
            geotransform: [37.5, 1.0, 0.0, 1024.0, 0.0, -1.0],
        };
        let manifest = serde_json::json!({
            "format": "cog-chunks-v1",
            "grid": {
                "width": grid.width,
                "height": grid.height,
                "geotransform": grid.geotransform,
            },
            "nodata": -99999.0,
            "crs_wkt": "EPSG:3857",
            "members": [],
            "engine_version": "test",
            "created_at": "0",
        });
        {
            let connection = library.catalogue().unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_layer_generations(
                        id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                        coverage_cells, min_value, max_value, bounds_3857)
                     VALUES(?1, ?2, '0', NULL, NULL, ?3, ?4, 5.0, 25.0, '[-3072,-1024,3072,1024]')",
                    rusqlite::params![
                        generation_id,
                        layer_id,
                        manifest.to_string(),
                        3072i64 * 3072,
                    ],
                )
                .unwrap();
        }

        // Two zoom levels inside the advertised range, so the samples are
        // minified (displacement about five native cells) and every value comes
        // from reduced cells rather than a native window.
        let max_zoom = (WEB_MERCATOR_WORLD / f64::from(TILE_PIXELS) / grid.geotransform[1])
            .log2()
            .floor() as u32;
        let z = max_zoom - 2;
        let span = WEB_MERCATOR_WORLD / f64::from(1u32 << z);
        let half = WEB_MERCATOR_WORLD / 2.0;
        let tile_x = |world_x: f64| ((world_x + half) / span).floor() as u32;
        let tile_y = |world_y: f64| ((half - world_y) / span).floor() as u32;
        let render = |x: u32, y: u32| -> TileOutcome {
            let request = TileRequest {
                entity_kind: "source".to_string(),
                entity_id: layer_id.clone(),
                generation_id: generation_id.to_string(),
                style: "elevation".to_string(),
                z,
                x,
                y,
            };
            render_tile(&library, &request, &cancel).expect("tile renders")
        };
        let pixels_of = |outcome: TileOutcome| -> Vec<u8> {
            match outcome {
                TileOutcome::Png(bytes) => {
                    let (width, height, rgba) = decode(&bytes);
                    assert_eq!((width, height), (TILE_PIXELS, TILE_PIXELS));
                    rgba
                }
                TileOutcome::Empty => panic!("expected a painted tile"),
            }
        };
        // The covered span in world coordinates: three chunks west and three
        // east of the lattice origin, where the value changes.
        let anchor = grid.geotransform[0];
        let coverage_west = anchor - 3.0 * f64::from(side);
        let coverage_east = anchor + 3.0 * f64::from(side);
        let ramp = ColorRamp::elevation_range(5.0, 25.0);
        let west = ramp.colour_for(5.0).expect("ramp covers the west value");
        let east = ramp.colour_for(25.0).expect("ramp covers the east value");
        // Every colour the ramp can produce between the two constants: a
        // nearest-cell render can only ever produce the two endpoint colours.
        let achievable: std::collections::HashSet<(u8, u8, u8)> = (0..=20_000)
            .filter_map(|step| ramp.colour_for(5.0 + f64::from(step) * 0.001))
            .collect();

        // A tile fully inside the covered area vertically, and inside a single
        // constant region horizontally: every pixel must then carry that
        // region's constant, which only correct reduced-cell means can produce.
        let mut row = None;
        let coverage_south = grid.geotransform[3] - 3.0 * f64::from(side);
        for y in tile_y(grid.geotransform[3])..=tile_y(coverage_south) {
            let bounds = tile_bounds_3857(z, 0, y);
            if bounds[1] >= coverage_south && bounds[3] <= grid.geotransform[3] {
                row = Some(y);
                break;
            }
        }
        let row = row.expect("a tile fits inside the coverage vertically");
        let mut inside_west = None;
        for x in tile_x(coverage_west)..=tile_x(anchor - 4.0) {
            let bounds = tile_bounds_3857(z, x, row);
            if bounds[0] >= coverage_west && bounds[2] <= anchor - 4.0 {
                inside_west = Some(x);
                break;
            }
        }
        let inside_west = inside_west.expect("a tile fits inside the west region");
        for (index, pixel) in pixels_of(render(inside_west, row))
            .chunks_exact(4)
            .enumerate()
        {
            assert_eq!(
                [pixel[0], pixel[1], pixel[2], pixel[3]],
                [west.0, west.1, west.2, 255],
                "west pixel {index}"
            );
        }
        let mut inside_east = None;
        for x in tile_x(anchor + 4.0)..=tile_x(coverage_east) {
            let bounds = tile_bounds_3857(z, x, row);
            if bounds[0] >= anchor + 4.0 && bounds[2] <= coverage_east {
                inside_east = Some(x);
                break;
            }
        }
        let inside_east = inside_east.expect("a tile fits inside the east region");
        for (index, pixel) in pixels_of(render(inside_east, row))
            .chunks_exact(4)
            .enumerate()
        {
            assert_eq!(
                [pixel[0], pixel[1], pixel[2], pixel[3]],
                [east.0, east.1, east.2, 255],
                "east pixel {index}"
            );
        }

        // The tile over the chunk boundary carries both constants and colours
        // between them, which only interpolation between reduced-cell centres
        // can produce.
        let mut saw_west = false;
        let mut saw_east = false;
        let mut saw_between = false;
        for pixel in pixels_of(render(tile_x(0.0), row)).chunks_exact(4) {
            if pixel[3] == 0 {
                continue;
            }
            assert_eq!(pixel[3], 255, "a painted pixel is opaque");
            let colour = (pixel[0], pixel[1], pixel[2]);
            assert!(
                achievable.contains(&colour),
                "every painted colour comes from the ramp between the constants: {colour:?}"
            );
            if colour == west {
                saw_west = true;
            } else if colour == east {
                saw_east = true;
            } else {
                saw_between = true;
            }
        }
        assert!(saw_west && saw_east, "both regions are drawn");
        assert!(
            saw_between,
            "a pixel between the reduced-cell centres is interpolated, not painted from one chunk"
        );

        // The coverage's west edge is at world x = -3072: the adjacent tile is
        // empty, and the covered tile's first painted column is the first sample
        // centre inside the coverage, within one pixel of the mapped edge.
        let edge = tile_x(coverage_west);
        let edge_bounds = tile_bounds_3857(z, edge, row);
        let neighbour_bounds = tile_bounds_3857(z, edge - 1, row);
        assert!(
            neighbour_bounds[2] <= coverage_west,
            "the neighbouring tile lies outside coverage: {neighbour_bounds:?}"
        );
        assert!(
            matches!(render(edge - 1, row), TileOutcome::Empty),
            "a tile outside the coverage is explicitly empty"
        );
        let pixel_span = (edge_bounds[2] - edge_bounds[0]) / f64::from(TILE_PIXELS);
        let expected_column = ((coverage_west - edge_bounds[0]) / pixel_span - 0.5).ceil() as i64;
        let edge_pixels = pixels_of(render(edge, row));
        let first_painted = (0..TILE_PIXELS as usize)
            .find(|column| edge_pixels[column * 4 + 3] != 0)
            .expect("the covered tile paints its coverage");
        assert!(
            (first_painted as i64 - expected_column).abs() <= 1,
            "the west edge lands at column {expected_column}, painted from {first_painted}"
        );
        // The north edge behaves the same way: the tile straddling it paints
        // from the first sample row inside the coverage.
        let north_row = tile_y(grid.geotransform[3] - 200.0);
        let north_bounds = tile_bounds_3857(z, inside_east, north_row);
        assert!(
            north_bounds[3] > grid.geotransform[3] && north_bounds[1] < grid.geotransform[3],
            "the chosen tile straddles the north edge: {north_bounds:?}"
        );
        let coverage_north = grid.geotransform[3];
        let expected_row = ((north_bounds[3] - coverage_north) / pixel_span - 0.5).ceil() as i64;
        let north_pixels = pixels_of(render(inside_east, north_row));
        let first_painted_row = (0..TILE_PIXELS as usize)
            .find(|row| north_pixels[row * TILE_PIXELS as usize * 4 + 3] != 0)
            .expect("the tile below the north edge paints its coverage");
        assert!(
            (first_painted_row as i64 - expected_row).abs() <= 1,
            "the north edge lands at row {expected_row}, painted from {first_painted_row}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
