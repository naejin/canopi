//! Tiled GeoTIFF and COG output on the `wbgeotiff` codec and GeoKey primitives.
//!
//! One writer produces every profile the library persists: the controlled
//! numeric COG (uncompressed, no overviews), the display COG (Deflate,
//! averaged valid-data overviews) and the tiled Deflate exchange GeoTIFF.
//! Every file is little-endian classic TIFF with 256×256 Float32 tiles, its
//! directories at the front (what the bounded reader parses from a prefix)
//! and tile data after them. Overviews halve while a side exceeds one tile,
//! sized by floor division, and average only valid samples, the layout GDAL's
//! COG driver produced for the same profile.

use super::super::engine::check_cancel;
use super::super::grid::RasterGrid;
use std::fs::File;
use std::io::{BufWriter, Seek as _, SeekFrom, Write as _};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use wbgeotiff::geo_keys::GeoKeyDirectory;
use wbgeotiff::tags::{Compression, tag};

/// Tile side of every profile.
pub(super) const TILE: u32 = 256;
/// Classic TIFF addresses 32-bit offsets; the capacity limit keeps every
/// profile far below it, so the writer refuses rather than switch layouts.
const MAX_CLASSIC_BYTES: u64 = u32::MAX as u64;

/// What kind of file to write.
#[derive(Debug, Clone, Copy)]
pub(super) struct CogProfile {
    pub compression: Compression,
    pub overviews: bool,
}

/// Where the raster sits.
#[derive(Debug, Clone, Copy)]
pub(super) struct CogGeoref<'a> {
    pub grid: &'a RasterGrid,
    pub geo_keys: Option<&'a GeoKeyDirectory>,
}

/// Write `samples` (row-major, `grid.width * grid.height`) to `path`,
/// removing a partial file on any failure.
pub(super) fn write(
    path: &Path,
    georef: CogGeoref<'_>,
    nodata: Option<f32>,
    samples: &[f32],
    profile: CogProfile,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let written = write_inner(path, georef, nodata, samples, profile, cancel);
    if written.is_err() {
        let _ = std::fs::remove_file(path);
    }
    written
}

struct Level {
    width: u32,
    height: u32,
    samples: Vec<f32>,
}

fn write_inner(
    path: &Path,
    georef: CogGeoref<'_>,
    nodata: Option<f32>,
    samples: &[f32],
    profile: CogProfile,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let grid = georef.grid;
    let cells = usize::try_from(u64::from(grid.width) * u64::from(grid.height))
        .map_err(|_| "raster is too large for this platform".to_string())?;
    if samples.len() != cells {
        return Err(format!(
            "{} samples do not fill a {}x{} grid",
            samples.len(),
            grid.width,
            grid.height
        ));
    }
    if grid.width == 0 || grid.height == 0 {
        return Err("cannot write an empty raster".to_string());
    }
    check_cancel(cancel)?;

    // Reduced-resolution levels, each halved from the previous one.
    let mut overviews: Vec<Level> = Vec::new();
    if profile.overviews {
        let (mut width, mut height) = (grid.width, grid.height);
        while width.max(height) > TILE {
            check_cancel(cancel)?;
            let level = halve(
                overviews
                    .last()
                    .map_or(samples, |level| level.samples.as_slice()),
                width,
                height,
                nodata,
            );
            width = level.width;
            height = level.height;
            overviews.push(level);
        }
    }
    let level_dims: Vec<(u32, u32)> = std::iter::once((grid.width, grid.height))
        .chain(overviews.iter().map(|level| (level.width, level.height)))
        .collect();

    // Directory sizes depend on tile counts only, so the directories can be
    // reserved at the front and filled in once every tile's placement is known.
    let geo_keys = georef.geo_keys.map(GeoKeyDirectory::encode);
    let nodata_text = nodata.map(|value| format!("{:?}", f64::from(value)));
    let mut directory_offsets = Vec::with_capacity(level_dims.len());
    let mut cursor = 8u64;
    for (index, (width, height)) in level_dims.iter().enumerate() {
        directory_offsets.push(cursor);
        let placeholder = directory(
            cursor,
            *width,
            *height,
            index > 0,
            &vec![0; tile_count(*width, *height)],
            &vec![0; tile_count(*width, *height)],
            0,
            profile.compression,
            (index == 0).then_some(georef),
            geo_keys.as_ref().filter(|_| index == 0),
            nodata_text.as_deref(),
        );
        cursor += placeholder.len() as u64;
    }
    let data_start = cursor;

    let file =
        File::create(path).map_err(|e| format!("Failed to create {}: {e}", path.display()))?;
    let mut output = BufWriter::new(file);
    output
        .write_all(&vec![0u8; data_start as usize])
        .map_err(|e| format!("Failed to reserve the raster directory: {e}"))?;

    // Tile data: full resolution first, then each overview.
    let mut placements: Vec<(Vec<u32>, Vec<u32>)> = Vec::with_capacity(level_dims.len());
    let mut position = data_start;
    let pad = nodata.unwrap_or(0.0);
    for (index, (width, height)) in level_dims.iter().enumerate() {
        let level_samples = if index == 0 {
            samples
        } else {
            &overviews[index - 1].samples
        };
        let tiles_x = width.div_ceil(TILE);
        let tiles_y = height.div_ceil(TILE);
        let mut offsets = Vec::with_capacity((tiles_x * tiles_y) as usize);
        let mut counts = Vec::with_capacity((tiles_x * tiles_y) as usize);
        let mut tile = vec![pad; (TILE * TILE) as usize];
        for tile_y in 0..tiles_y {
            check_cancel(cancel)?;
            for tile_x in 0..tiles_x {
                tile.fill(pad);
                let x0 = (tile_x * TILE) as usize;
                let y0 = (tile_y * TILE) as usize;
                let columns = (TILE as usize).min(*width as usize - x0);
                let rows = (TILE as usize).min(*height as usize - y0);
                for row in 0..rows {
                    let source = (y0 + row) * *width as usize + x0;
                    let target = row * TILE as usize;
                    tile[target..target + columns]
                        .copy_from_slice(&level_samples[source..source + columns]);
                }
                let bytes: Vec<u8> = tile.iter().flat_map(|value| value.to_le_bytes()).collect();
                let encoded = wbgeotiff::compression::compress(profile.compression, &bytes)
                    .map_err(|e| format!("Failed to compress a raster tile: {e}"))?;
                if position + encoded.len() as u64 > MAX_CLASSIC_BYTES {
                    return Err("the raster exceeds the 4 GiB classic TIFF limit".to_string());
                }
                output
                    .write_all(&encoded)
                    .map_err(|e| format!("Failed to write a raster tile: {e}"))?;
                offsets.push(position as u32);
                counts.push(encoded.len() as u32);
                position += encoded.len() as u64;
            }
        }
        placements.push((offsets, counts));
    }
    output
        .flush()
        .map_err(|e| format!("Failed to flush the raster: {e}"))?;

    // Now the directories, with every tile placed.
    let mut file = output
        .into_inner()
        .map_err(|e| format!("Failed to finish the raster: {e}"))?;
    for (index, (width, height)) in level_dims.iter().enumerate() {
        let next = directory_offsets.get(index + 1).copied().unwrap_or(0);
        let (offsets, counts) = &placements[index];
        let bytes = directory(
            directory_offsets[index],
            *width,
            *height,
            index > 0,
            offsets,
            counts,
            next,
            profile.compression,
            (index == 0).then_some(georef),
            geo_keys.as_ref().filter(|_| index == 0),
            nodata_text.as_deref(),
        );
        debug_assert_eq!(
            directory_offsets[index] + bytes.len() as u64,
            directory_offsets
                .get(index + 1)
                .copied()
                .unwrap_or(data_start)
        );
        file.seek(SeekFrom::Start(directory_offsets[index]))
            .and_then(|_| file.write_all(&bytes))
            .map_err(|e| format!("Failed to write the raster directory: {e}"))?;
    }
    file.seek(SeekFrom::Start(0))
        .and_then(|_| file.write_all(&header(directory_offsets[0])))
        .map_err(|e| format!("Failed to write the raster header: {e}"))?;
    file.flush()
        .map_err(|e| format!("Failed to flush the raster: {e}"))
}

fn tile_count(width: u32, height: u32) -> usize {
    (width.div_ceil(TILE) * height.div_ceil(TILE)) as usize
}

fn header(first_directory: u64) -> [u8; 8] {
    let mut bytes = [0u8; 8];
    bytes[..2].copy_from_slice(b"II");
    bytes[2..4].copy_from_slice(&42u16.to_le_bytes());
    bytes[4..].copy_from_slice(&(first_directory as u32).to_le_bytes());
    bytes
}

/// Halve a level: each cell averages the valid samples of its source block
/// (floor-sized levels give some blocks a third row or column), and a block
/// with no valid sample stays NoData.
fn halve(source: &[f32], width: u32, height: u32, nodata: Option<f32>) -> Level {
    let (sw, sh) = (width as usize, height as usize);
    let dw = (sw / 2).max(1);
    let dh = (sh / 2).max(1);
    let invalid = nodata.unwrap_or(f32::NAN);
    let mut samples = vec![invalid; dw * dh];
    for dy in 0..dh {
        let y0 = dy * sh / dh;
        let y1 = ((dy + 1) * sh / dh).min(sh).max(y0 + 1);
        for dx in 0..dw {
            let x0 = dx * sw / dw;
            let x1 = ((dx + 1) * sw / dw).min(sw).max(x0 + 1);
            let mut sum = 0f64;
            let mut count = 0u32;
            for y in y0..y1 {
                for x in x0..x1 {
                    let value = source[y * sw + x];
                    if value.is_finite() && nodata.is_none_or(|marker| value != marker) {
                        sum += f64::from(value);
                        count += 1;
                    }
                }
            }
            if count > 0 {
                samples[dy * dw + dx] = (sum / f64::from(count)) as f32;
            }
        }
    }
    Level {
        width: dw as u32,
        height: dh as u32,
        samples,
    }
}

/// TIFF field types.
const SHORT: u16 = 3;
const LONG: u16 = 4;
const ASCII: u16 = 2;
const DOUBLE: u16 = 12;

struct Field {
    tag: u16,
    kind: u16,
    count: u32,
    payload: Vec<u8>,
}

fn shorts(tag: u16, values: &[u16]) -> Field {
    Field {
        tag,
        kind: SHORT,
        count: values.len() as u32,
        payload: values.iter().flat_map(|v| v.to_le_bytes()).collect(),
    }
}

fn longs(tag: u16, values: &[u32]) -> Field {
    Field {
        tag,
        kind: LONG,
        count: values.len() as u32,
        payload: values.iter().flat_map(|v| v.to_le_bytes()).collect(),
    }
}

fn doubles(tag: u16, values: &[f64]) -> Field {
    Field {
        tag,
        kind: DOUBLE,
        count: values.len() as u32,
        payload: values.iter().flat_map(|v| v.to_le_bytes()).collect(),
    }
}

fn ascii(tag: u16, text: &str) -> Field {
    let mut payload = text.as_bytes().to_vec();
    payload.push(0);
    Field {
        tag,
        kind: ASCII,
        count: payload.len() as u32,
        payload,
    }
}

/// One image file directory, serialised at `at` with its out-of-line values
/// right after it. Sizes depend on the counts alone, never on the values.
#[allow(clippy::too_many_arguments)]
fn directory(
    at: u64,
    width: u32,
    height: u32,
    reduced: bool,
    tile_offsets: &[u32],
    tile_counts: &[u32],
    next: u64,
    compression: Compression,
    georef: Option<CogGeoref<'_>>,
    geo_keys: Option<&(Vec<u16>, Vec<f64>, String)>,
    nodata: Option<&str>,
) -> Vec<u8> {
    let mut fields = Vec::new();
    if reduced {
        fields.push(longs(tag::NewSubFileType, &[1]));
    }
    fields.push(longs(tag::ImageWidth, &[width]));
    fields.push(longs(tag::ImageLength, &[height]));
    fields.push(shorts(tag::BitsPerSample, &[32]));
    fields.push(shorts(tag::Compression, &[compression.tag_value()]));
    fields.push(shorts(tag::PhotometricInterpretation, &[1]));
    fields.push(shorts(tag::SamplesPerPixel, &[1]));
    fields.push(shorts(tag::PlanarConfiguration, &[1]));
    fields.push(longs(tag::TileWidth, &[TILE]));
    fields.push(longs(tag::TileLength, &[TILE]));
    fields.push(longs(tag::TileOffsets, tile_offsets));
    fields.push(longs(tag::TileByteCounts, tile_counts));
    fields.push(shorts(tag::SampleFormat, &[3]));
    if let Some(georef) = georef {
        let gt = georef.grid.geotransform;
        fields.push(doubles(tag::ModelPixelScaleTag, &[gt[1], -gt[5], 0.0]));
        fields.push(doubles(
            tag::ModelTiepointTag,
            &[0.0, 0.0, 0.0, gt[0], gt[3], 0.0],
        ));
    }
    if let Some((words, values, text)) = geo_keys {
        fields.push(shorts(tag::GeoKeyDirectoryTag, words));
        if !values.is_empty() {
            fields.push(doubles(tag::GeoDoubleParamsTag, values));
        }
        if !text.is_empty() {
            fields.push(ascii(tag::GeoAsciiParamsTag, text));
        }
    }
    if let Some(nodata) = nodata {
        fields.push(ascii(tag::GdalNodata, nodata));
    }
    fields.sort_by_key(|field| field.tag);

    let entries_end = at + 2 + 12 * fields.len() as u64 + 4;
    let mut entries = Vec::with_capacity(2 + 12 * fields.len() + 4);
    let mut extra: Vec<u8> = Vec::new();
    entries.extend_from_slice(&(fields.len() as u16).to_le_bytes());
    for field in &fields {
        entries.extend_from_slice(&field.tag.to_le_bytes());
        entries.extend_from_slice(&field.kind.to_le_bytes());
        entries.extend_from_slice(&field.count.to_le_bytes());
        if field.payload.len() <= 4 {
            let mut inline = [0u8; 4];
            inline[..field.payload.len()].copy_from_slice(&field.payload);
            entries.extend_from_slice(&inline);
        } else {
            let offset = entries_end + extra.len() as u64;
            entries.extend_from_slice(&(offset as u32).to_le_bytes());
            extra.extend_from_slice(&field.payload);
            if extra.len() % 2 == 1 {
                extra.push(0);
            }
        }
    }
    entries.extend_from_slice(&(next as u32).to_le_bytes());
    entries.extend_from_slice(&extra);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halving_averages_valid_samples_only_and_keeps_holes() {
        let source = [1.0, 3.0, -9999.0, -9999.0, 5.0, 7.0, -9999.0, f32::NAN, 9.0];
        let level = halve(&source, 3, 3, Some(-9999.0));
        assert_eq!((level.width, level.height), (1, 1));
        // Every valid sample of the 3×3 block, the sentinel and NaN excluded.
        assert_eq!(level.samples, vec![5.0]);
        let hole = halve(&[-9999.0; 4], 2, 2, Some(-9999.0));
        assert_eq!(hole.samples, vec![-9999.0]);
        let untagged = halve(&[f32::NAN; 4], 2, 2, None);
        assert!(untagged.samples[0].is_nan());
    }

    #[test]
    fn level_sizes_follow_the_cog_driver() {
        let sizes = |width: u32, height: u32| {
            let mut dims = Vec::new();
            let (mut w, mut h) = (width, height);
            while w.max(h) > TILE {
                w = (w / 2).max(1);
                h = (h / 2).max(1);
                dims.push((w, h));
            }
            dims
        };
        assert_eq!(sizes(600, 400), vec![(300, 200), (150, 100)]);
        assert_eq!(sizes(513, 100), vec![(256, 50)]);
        assert_eq!(sizes(256, 256), vec![]);
        assert_eq!(
            sizes(4000, 3000),
            vec![(2000, 1500), (1000, 750), (500, 375), (250, 187)]
        );
    }

    #[test]
    fn directory_size_is_independent_of_its_values() {
        let grid = RasterGrid {
            width: 300,
            height: 260,
            geotransform: [0.0, 1.0, 0.0, 260.0, 0.0, -1.0],
        };
        let georef = CogGeoref {
            grid: &grid,
            geo_keys: None,
        };
        let zeros = vec![0u32; 4];
        let real = vec![u32::MAX; 4];
        let a = directory(
            8,
            300,
            260,
            false,
            &zeros,
            &zeros,
            0,
            Compression::Deflate,
            Some(georef),
            None,
            Some("-9999.0"),
        );
        let b = directory(
            8,
            300,
            260,
            false,
            &real,
            &real,
            999,
            Compression::Deflate,
            Some(georef),
            None,
            Some("-9999.0"),
        );
        assert_eq!(a.len(), b.len());
    }
}
