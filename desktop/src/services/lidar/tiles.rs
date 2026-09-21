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
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

pub(super) const TILE_PIXELS: u32 = 256;
/// Deepest supported display zoom, matching the legacy pyramid ceiling.
pub(super) const MAX_ZOOM: u32 = 22;
/// Web Mercator world width in metres.
const WEB_MERCATOR_WORLD: f64 = 40_075_016.685_578_49;
/// Deepest reduction level: 2^10 cells per side is exactly the reader's window
/// cap, so a mean cell is always readable in one bounded window.
const MAX_LEVEL: u32 = 10;
/// Points per coordinate-transform invocation.
const TRANSFORM_BATCH: usize = 4096;
/// Bound on reduction pages read while rendering one tile. The advertised
/// zoom range needs at most sixteen; a deeper request is refused by name
/// rather than reading an unbounded region. Pages whose samples are whole
/// chunks are answered from stored aggregates and are not reads.
const MAX_PAGES_PER_TILE: usize = 64;
/// Reduction level whose cell is exactly one stored chunk.
const PAGE_LEVEL: u32 = MAX_LEVEL;
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
    Sparse(GenerationManifest),
    SparseResult(ResultManifest),
}

impl DisplayManifest {
    fn grid(&self) -> &RasterGrid {
        match self {
            Self::Dense(manifest) => &manifest.grid,
            Self::Sparse(manifest) => &manifest.grid,
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
pub(super) fn level_for_displacement(displacement_cells: f64) -> u32 {
    if !displacement_cells.is_finite() {
        return MAX_LEVEL;
    }
    let bounded = displacement_cells.max(1.0);
    let exponent = bounded.log2().floor();
    if exponent <= 0.0 {
        return 0;
    }
    exponent.min(f64::from(MAX_LEVEL)) as u32
}

/// First lattice cell of the aligned reduction block containing `cell`.
pub(super) fn block_origin(cell: i64, level: u32) -> i64 {
    let side = 1i64 << level;
    cell.div_euclid(side) * side
}

/// Lattice coordinates of a point, as fractional cell positions.
struct LatticeMapper {
    /// `[origin_x, pixel_x, _, origin_y, _, pixel_y]` when the generation is
    /// already Web Mercator; otherwise a verified GDAL transform is used.
    affine: Option<[f64; 6]>,
    crs_wkt: String,
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
        let affine = if crs_wkt.contains("3857") {
            let probe = [(0.0f64, 0.0f64)];
            let through_gdal = transform_points(engine, cancel, crs_wkt, &probe)?;
            let identity = [
                grid.geotransform[0],
                grid.geotransform[1],
                grid.geotransform[3],
                grid.geotransform[5],
            ];
            let affine = [identity[0], identity[1], 0.0, identity[2], 0.0, identity[3]];
            if let Some((x, y)) = through_gdal.first() {
                let expected = affine_point(&affine, 0.0, 0.0);
                if (expected.0 - x).abs() < 1e-6 && (expected.1 - y).abs() < 1e-6 {
                    Some(affine)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        Ok(Self {
            affine,
            crs_wkt: crs_wkt.to_string(),
        })
    }

    /// Fractional lattice cells of EPSG:3857 points.
    fn to_cells(
        &self,
        engine: &GdalEngine,
        cancel: &AtomicBool,
        points: &[(f64, f64)],
    ) -> Result<Vec<(f64, f64)>, String> {
        if let Some(affine) = &self.affine {
            return Ok(points
                .iter()
                .map(|(x, y)| affine_point(affine, *x, *y))
                .collect());
        }
        transform_points(engine, cancel, &self.crs_wkt, points)
    }
}

fn affine_point(affine: &[f64; 6], x: f64, y: f64) -> (f64, f64) {
    let cell_x = (x - affine[0]) / affine[1];
    let cell_y = (y - affine[3]) / affine[5];
    (cell_x, cell_y)
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

/// Render one tile from an immutable sparse generation.
pub(super) fn render_tile(
    library: &super::LidarLibrary,
    request: &TileRequest,
    cancel: &AtomicBool,
) -> Result<TileOutcome, String> {
    request.validate()?;
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;
    let (manifest, chunks) = {
        let connection = library.catalogue()?;
        let manifest = load_manifest(&connection, &request.style, request)?;
        let chunks = generation::persisted_chunks(
            &connection,
            paths,
            &request.generation_id,
            generation::RESULT_ROLE,
        )?;
        (manifest, chunks)
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

    // Per-sample reduction level from the sample's own native displacement,
    // so a sample shared by two tiles selects the same level in both.
    let samples = TILE_PIXELS as usize;
    let mut levels = vec![0u32; samples * samples];
    for row in 0..samples {
        for column in 0..samples {
            let centre = cells[row * side + column];
            let right = cells[row * side + column + 1];
            let down = cells[(row + 1) * side + column];
            let displacement = hypot(right.0 - centre.0, right.1 - centre.1)
                .max(hypot(down.0 - centre.0, down.1 - centre.1));
            levels[row * samples + column] = level_for_displacement(displacement);
        }
    }

    // Native-scale samples come from one window covering just those samples;
    // minified samples are read one occupied reduction page at a time, so the
    // work is bounded by the pages the tile actually touches and absent pages
    // are never visited.
    let dense_origins: Vec<(usize, usize)> = (0..samples)
        .flat_map(|row| (0..samples).map(move |column| (row, column)))
        .filter(|(row, column)| levels[row * samples + column] == 0)
        .collect();
    let dense = if dense_origins.is_empty() {
        None
    } else {
        Some(read_dense_window(
            &chunks, &lattice, &cells, side, &levels, cancel,
        )?)
    };

    let mut pages: HashMap<(i64, i64), Vec<(usize, usize)>> = HashMap::new();
    for row in 0..samples {
        for column in 0..samples {
            let level = levels[row * samples + column];
            if level == 0 {
                continue;
            }
            let centre = cells[row * side + column];
            let block_x = block_origin(centre.0.floor() as i64, level);
            let block_y = block_origin(centre.1.floor() as i64, level);
            pages
                .entry((
                    block_x.div_euclid(generation::CHUNK_SIDE),
                    block_y.div_euclid(generation::CHUNK_SIDE),
                ))
                .or_default()
                .push((row, column));
        }
    }
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
            if levels[row * samples + column] != 0 {
                continue;
            }
            if column % 32 == 0 {
                super::import::check_cancel(cancel)?;
            }
            let centre = cells[row * side + column];
            if let Some(value) = dense
                .as_ref()
                .and_then(|window| window.sample(centre.0, centre.1))
            {
                paint(row, column, value);
            }
        }
    }
    let mut pages_read = 0usize;
    for ((page_x, page_y), members) in pages {
        super::import::check_cancel(cancel)?;
        let Some(chunk) = chunks
            .iter()
            .find(|chunk| chunk.chunk_x == page_x && chunk.chunk_y == page_y)
        else {
            // An absent page is invalid coverage: never read, never visited.
            continue;
        };
        let origin_x = page_x * generation::CHUNK_SIDE;
        let origin_y = page_y * generation::CHUNK_SIDE;
        // A sample whose block is the whole page contributes the chunk's
        // stored f64 sum/count, so a deep zoom-out costs no raster I/O.
        let mut partial = Vec::new();
        for (row, column) in members {
            let level = levels[row * samples + column];
            let centre = cells[row * side + column];
            let block_x = block_origin(centre.0.floor() as i64, level);
            let block_y = block_origin(centre.1.floor() as i64, level);
            if level == PAGE_LEVEL && block_x == origin_x && block_y == origin_y {
                if let Some(value) = chunk.mean() {
                    paint(row, column, value);
                }
            } else {
                partial.push((row, column));
            }
        }
        if partial.is_empty() {
            continue;
        }
        pages_read += 1;
        if pages_read > MAX_PAGES_PER_TILE {
            return Err(format!(
                "tile needs more than {MAX_PAGES_PER_TILE} reduction page reads"
            ));
        }
        let page = generation::read_persisted_window(
            &chunks,
            &lattice,
            generation::LatticeWindow {
                x: origin_x,
                y: origin_y,
                width: generation::CHUNK_SIDE as u32,
                height: generation::CHUNK_SIDE as u32,
            },
            cancel,
        )?;
        let page_side = generation::CHUNK_SIDE as usize;
        for (row, column) in partial {
            let level = levels[row * samples + column];
            let centre = cells[row * side + column];
            let block_x = block_origin(centre.0.floor() as i64, level);
            let block_y = block_origin(centre.1.floor() as i64, level);
            if let Some(value) = block_mean(
                &page.samples,
                &page.valid,
                origin_x,
                origin_y,
                block_x,
                block_y,
                1i64 << level,
                page_side,
            ) {
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

/// Read the native cells the level-0 samples of this tile need.
///
/// Only the level-0 samples are covered, so a tile that is minified
/// everywhere never allocates a native-scale window at all.
#[allow(clippy::too_many_arguments)]
fn read_dense_window(
    chunks: &[generation::PersistedChunk],
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
    let resolved = generation::read_persisted_window(
        chunks,
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
    fn reduction_level_follows_the_power_of_two_rule() {
        assert_eq!(level_for_displacement(0.25), 0);
        assert_eq!(level_for_displacement(1.0), 0);
        assert_eq!(level_for_displacement(1.99), 0);
        assert_eq!(level_for_displacement(2.0), 1);
        assert_eq!(level_for_displacement(3.9), 1);
        assert_eq!(level_for_displacement(4.0), 2);
        assert_eq!(level_for_displacement(1e9), MAX_LEVEL);
        assert_eq!(level_for_displacement(f64::NAN), MAX_LEVEL);
    }

    #[test]
    fn reduction_blocks_align_to_the_layer_lattice() {
        assert_eq!(block_origin(0, 3), 0);
        assert_eq!(block_origin(7, 3), 0);
        assert_eq!(block_origin(8, 3), 8);
        // A lattice extends left/up, so negative cells align the same way.
        assert_eq!(block_origin(-1, 3), -8);
        assert_eq!(block_origin(-8, 3), -8);
        assert_eq!(block_origin(-9, 3), -16);
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
            let _guard = super::super::generation::chunked_publication::enable();
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
}
