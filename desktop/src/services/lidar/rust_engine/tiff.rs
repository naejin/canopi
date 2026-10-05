//! TIFF header probing and band-1 decoding on the `wbgeotiff` primitives.
//!
//! The header is read from the file's directory alone, so probing a
//! multi-gigabyte GeoTIFF costs O(directory). Band 1 is read in windows, one
//! strip or tile at a time through `wbgeotiff`'s codecs and predictor; the
//! caller decides whether a window is a row band or the whole raster.

use super::super::engine::check_cancel;
use super::super::prepared_raster::RasterWindow;
use std::fs::File;
use std::io::{BufReader, Read as _, Seek as _, SeekFrom};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use wbgeotiff::geo_keys::GeoKeyDirectory;
use wbgeotiff::ifd::{ByteOrder, Ifd, TiffReader, TiffVariant};
use wbgeotiff::tags::{Compression, DataType, SampleFormat, tag};

/// How band samples are chunked in the file.
#[derive(Clone)]
pub(super) enum Layout {
    Strips {
        rows_per_strip: u32,
        offsets: Vec<u64>,
        counts: Vec<u64>,
    },
    Tiles {
        width: u32,
        height: u32,
        offsets: Vec<u64>,
        counts: Vec<u64>,
    },
}

/// Everything a probe and a decode need from the directory.
pub(super) struct TiffHeader {
    pub width: u32,
    pub height: u32,
    pub bands: u16,
    pub bits: u16,
    pub format: SampleFormat,
    pub compression_tag: u16,
    pub predictor: u16,
    pub planar: u16,
    pub layout: Layout,
    pub byte_order: ByteOrder,
    pub geotransform: Option<[f64; 6]>,
    pub geo_keys: Option<GeoKeyDirectory>,
    pub nodata: Option<f64>,
    pub scale: f64,
    pub offset: f64,
    pub unit: Option<String>,
    pub overview_count: u32,
    pub has_mask: bool,
    pub has_alpha: bool,
}

/// Whether the file starts with a classic or BigTIFF signature.
pub(crate) fn is_tiff(path: &Path) -> Result<bool, String> {
    let mut file =
        File::open(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    let mut magic = [0u8; 4];
    match file.read_exact(&mut magic) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(false),
        Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    }
    Ok(matches!(
        &magic,
        b"II\x2a\x00" | b"MM\x00\x2a" | b"II\x2b\x00" | b"MM\x00\x2b"
    ))
}

fn open(path: &Path) -> Result<TiffReader<BufReader<File>>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    TiffReader::new(BufReader::new(file))
        .map_err(|e| format!("{} is not a readable TIFF: {e}", path.display()))
}

fn first_u64(ifd: &Ifd, code: u16) -> Option<u64> {
    ifd.get(code).and_then(|entry| entry.value.as_u64())
}

fn u64s(ifd: &Ifd, code: u16) -> Option<Vec<u64>> {
    ifd.get(code).and_then(|entry| entry.value.as_u64_vec())
}

fn f64s(ifd: &Ifd, code: u16) -> Option<Vec<f64>> {
    ifd.get(code).and_then(|entry| entry.value.as_f64_vec())
}

fn text(ifd: &Ifd, code: u16) -> Option<String> {
    ifd.get(code).and_then(|entry| {
        entry
            .value
            .as_str()
            .map(|s| s.trim_end_matches('\0').to_string())
    })
}

/// At most this many image directories are read: a full image, its
/// overviews and their masks fit with room to spare.
const MAX_DIRECTORIES: usize = 64;
/// At most this many entries per directory; a GeoTIFF writes a few dozen.
const MAX_DIRECTORY_ENTRIES: u64 = 1024;
/// At most this many bytes of tag values across the chain. A 2 GiB source's
/// strip or tile index takes a few MiB.
const MAX_DIRECTORY_VALUE_BYTES: u64 = 64 * 1024 * 1024;

/// Read the directory chain without trusting it. wbgeotiff follows
/// next-directory offsets and sizes its buffers from the header's counts
/// unchecked, so a loop, a long chain, a huge entry count or tag values
/// beyond the budget are refused here, from the raw entries, before it reads
/// a directory. This keeps the header read bounded (U32 runs it on UserData).
fn read_directories(reader: &mut TiffReader<BufReader<File>>) -> Result<Vec<Ifd>, String> {
    let mut seen = std::collections::HashSet::new();
    let mut value_bytes = 0u64;
    let mut ifds = Vec::new();
    let mut offset = reader.first_ifd_offset;
    while offset != 0 {
        if !seen.insert(offset) {
            return Err("its image directories loop".to_string());
        }
        if ifds.len() == MAX_DIRECTORIES {
            return Err(format!("more than {MAX_DIRECTORIES} image directories"));
        }
        value_bytes += directory_value_bytes(reader, offset)?;
        if value_bytes > MAX_DIRECTORY_VALUE_BYTES {
            return Err(format!(
                "its tags declare more than {} MiB of values",
                MAX_DIRECTORY_VALUE_BYTES / (1024 * 1024)
            ));
        }
        let ifd = reader.read_ifd(offset).map_err(|e| e.to_string())?;
        offset = ifd.next_ifd_offset;
        ifds.push(ifd);
    }
    Ok(ifds)
}

/// The bytes of tag values the directory at `offset` declares, read from its
/// raw entries.
fn directory_value_bytes(
    reader: &mut TiffReader<BufReader<File>>,
    offset: u64,
) -> Result<u64, String> {
    let order = reader.byte_order;
    // Bytes of the entry count, of each entry, and of an entry's value count.
    let (entries_size, entry_size, value_count_size) = match reader.variant {
        TiffVariant::Classic => (2, 12, 4),
        TiffVariant::BigTiff => (8, 20, 8),
    };
    let file = reader.inner_mut();
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut read = |size: usize| -> Result<Vec<u8>, String> {
        let mut bytes = vec![0u8; size];
        file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        Ok(bytes)
    };
    let entries = uint(&read(entries_size)?, order);
    if entries > MAX_DIRECTORY_ENTRIES {
        return Err(format!("an image directory with {entries} entries"));
    }
    let mut total = 0u64;
    for _ in 0..entries {
        let entry = read(entry_size)?;
        let kind = uint(&entry[2..4], order) as u16;
        let count = uint(&entry[4..4 + value_count_size], order);
        let size = DataType::from_u16(kind).map_or(0, |kind| kind.byte_size() as u64);
        total = total.saturating_add(count.saturating_mul(size));
    }
    Ok(total)
}

/// An unsigned integer of 2, 4 or 8 bytes in the file's byte order.
fn uint(bytes: &[u8], order: ByteOrder) -> u64 {
    let push = |value: u64, byte: &u8| (value << 8) | u64::from(*byte);
    match order {
        ByteOrder::BigEndian => bytes.iter().fold(0, push),
        ByteOrder::LittleEndian => bytes.iter().rev().fold(0, push),
    }
}

/// Read the directory of a TIFF without touching its samples.
pub(super) fn read_header(path: &Path) -> Result<TiffHeader, String> {
    let mut reader = open(path)?;
    let byte_order = reader.byte_order;
    let ifds = read_directories(&mut reader)
        .map_err(|e| format!("{} has an unreadable directory: {e}", path.display()))?;
    let Some(first) = ifds.first() else {
        return Err(format!("{} has no image directory", path.display()));
    };
    let width = u32::try_from(first_u64(first, tag::ImageWidth).unwrap_or(0))
        .map_err(|_| "raster width exceeds this platform".to_string())?;
    let height = u32::try_from(first_u64(first, tag::ImageLength).unwrap_or(0))
        .map_err(|_| "raster height exceeds this platform".to_string())?;
    if width == 0 || height == 0 {
        return Err(format!("{} declares an empty image", path.display()));
    }
    let bands = first_u64(first, tag::SamplesPerPixel).unwrap_or(1) as u16;
    let bits = first_u64(first, tag::BitsPerSample).unwrap_or(1) as u16;
    let format = SampleFormat::from_tag(first_u64(first, tag::SampleFormat).unwrap_or(1) as u16);
    let compression_tag = first_u64(first, tag::Compression).unwrap_or(1) as u16;
    let predictor = first_u64(first, tag::Predictor).unwrap_or(1) as u16;
    let planar = first_u64(first, tag::PlanarConfiguration).unwrap_or(1) as u16;
    let layout = if let Some(tile_width) = first_u64(first, tag::TileWidth) {
        Layout::Tiles {
            width: tile_width as u32,
            height: first_u64(first, tag::TileLength).unwrap_or(tile_width) as u32,
            offsets: u64s(first, tag::TileOffsets)
                .ok_or_else(|| "tiled TIFF without tile offsets".to_string())?,
            counts: u64s(first, tag::TileByteCounts)
                .ok_or_else(|| "tiled TIFF without tile byte counts".to_string())?,
        }
    } else {
        let rows_per_strip = first_u64(first, tag::RowsPerStrip)
            .map(|rows| rows.min(u64::from(height)) as u32)
            .unwrap_or(height)
            .max(1);
        Layout::Strips {
            rows_per_strip,
            offsets: u64s(first, tag::StripOffsets)
                .ok_or_else(|| "TIFF without strip offsets".to_string())?,
            counts: u64s(first, tag::StripByteCounts)
                .ok_or_else(|| "TIFF without strip byte counts".to_string())?,
        }
    };
    let geotransform = geotransform_of(first);
    let geo_keys = geo_keys_of(first)?;
    let nodata = text(first, tag::GdalNodata).and_then(|value| parse_nodata(&value));
    let (scale, offset, unit) = text(first, tag::GdalMetadata)
        .map(|xml| gdal_metadata(&xml))
        .unwrap_or((1.0, 0.0, None));
    let mut overview_count = 0;
    let mut has_mask = false;
    for ifd in ifds.iter().skip(1) {
        let kind = first_u64(ifd, tag::NewSubFileType).unwrap_or(0);
        if kind & 4 != 0 {
            has_mask = true;
        } else if kind & 1 != 0 {
            overview_count += 1;
        }
    }
    if first_u64(first, tag::NewSubFileType).unwrap_or(0) & 4 != 0 {
        has_mask = true;
    }
    let has_alpha = u64s(first, tag::ExtraSamples)
        .is_some_and(|samples| samples.iter().any(|sample| *sample == 1 || *sample == 2));
    Ok(TiffHeader {
        width,
        height,
        bands,
        bits,
        format,
        compression_tag,
        predictor,
        planar,
        layout,
        byte_order,
        geotransform,
        geo_keys,
        nodata,
        scale,
        offset,
        unit,
        overview_count,
        has_mask,
        has_alpha,
    })
}

fn geotransform_of(ifd: &Ifd) -> Option<[f64; 6]> {
    if let Some(matrix) = f64s(ifd, tag::ModelTransformationTag)
        && matrix.len() >= 16
    {
        return Some([
            matrix[3], matrix[0], matrix[1], matrix[7], matrix[4], matrix[5],
        ]);
    }
    let scale = f64s(ifd, tag::ModelPixelScaleTag)?;
    let tiepoint = f64s(ifd, tag::ModelTiepointTag)?;
    if scale.len() < 2 || tiepoint.len() < 6 {
        return None;
    }
    let (i, j, x, y) = (tiepoint[0], tiepoint[1], tiepoint[3], tiepoint[4]);
    Some([
        x - i * scale[0],
        scale[0],
        0.0,
        y + j * scale[1],
        0.0,
        -scale[1],
    ])
}

fn geo_keys_of(ifd: &Ifd) -> Result<Option<GeoKeyDirectory>, String> {
    let Some(directory) = ifd.get(tag::GeoKeyDirectoryTag) else {
        return Ok(None);
    };
    let Some(words) = directory.value.as_u16_vec() else {
        return Ok(None);
    };
    let doubles = f64s(ifd, tag::GeoDoubleParamsTag).unwrap_or_default();
    let ascii = text(ifd, tag::GeoAsciiParamsTag).unwrap_or_default();
    GeoKeyDirectory::parse(words, &doubles, &ascii)
        .map(Some)
        .map_err(|e| format!("unreadable GeoTIFF keys: {e}"))
}

/// GDAL writes the tag as text: a decimal, `nan`, `inf` or `-inf`.
fn parse_nodata(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok()
}

/// Band scale, offset and unit from the `GDAL_METADATA` XML tag.
fn gdal_metadata(xml: &str) -> (f64, f64, Option<String>) {
    let mut scale = 1.0;
    let mut offset = 0.0;
    let mut unit = None;
    let mut rest = xml;
    while let Some(start) = rest.find("<Item ") {
        let item = &rest[start..];
        let Some(close) = item.find("</Item>") else {
            break;
        };
        let (head, body) = match item.find('>') {
            Some(end) if end < close => (&item[..end], &item[end + 1..close]),
            _ => break,
        };
        let role = attribute(head, "role")
            .unwrap_or_default()
            .to_ascii_lowercase();
        let value = body.trim();
        match role.as_str() {
            "scale" => scale = value.parse().unwrap_or(1.0),
            "offset" => offset = value.parse().unwrap_or(0.0),
            "unittype" if !value.is_empty() => unit = Some(value.to_string()),
            _ => {}
        }
        rest = &item[close + 7..];
    }
    (scale, offset, unit)
}

fn attribute<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{name}=\"");
    let start = head.find(&key)? + key.len();
    let end = head[start..].find('"')? + start;
    Some(&head[start..end])
}

/// Sample type in GDAL's vocabulary.
pub(super) fn band_type_name(format: SampleFormat, bits: u16) -> String {
    match (format, bits) {
        (SampleFormat::Uint, 8) => "Byte",
        (SampleFormat::Int, 8) => "Int8",
        (SampleFormat::Uint, 16) => "UInt16",
        (SampleFormat::Int, 16) => "Int16",
        (SampleFormat::Uint, 32) => "UInt32",
        (SampleFormat::Int, 32) => "Int32",
        (SampleFormat::Uint, 64) => "UInt64",
        (SampleFormat::Int, 64) => "Int64",
        (SampleFormat::IeeeFloat, 16) => "Float16",
        (SampleFormat::IeeeFloat, 32) => "Float32",
        (SampleFormat::IeeeFloat, 64) => "Float64",
        _ => return format!("{format:?}{bits}"),
    }
    .to_string()
}

/// Compression in GDAL's vocabulary.
pub(super) fn compression_name(compression_tag: u16) -> String {
    match compression_tag {
        1 => "NONE",
        2 => "CCITTRLE",
        5 => "LZW",
        6 | 7 => "JPEG",
        8 | 32946 => "DEFLATE",
        32773 => "PACKBITS",
        34887 => "LERC",
        50000 => "ZSTD",
        50001 => "WEBP",
        50002 => "JXL",
        other => return format!("{other}"),
    }
    .to_string()
}

fn codec(compression_tag: u16) -> Result<Compression, String> {
    match compression_tag {
        32946 => Ok(Compression::Deflate),
        other => match Compression::from_tag(other) {
            Compression::Other(_) | Compression::Huffman => Err(format!(
                "compression {} is not supported by the raster engine",
                compression_name(other)
            )),
            supported => Ok(supported),
        },
    }
}

/// Largest chunk decoded whole on a streamed read. A compressed chunk above
/// it (typically a whole image in one strip) would hold more than a row
/// window, so such a file is loaded whole under the capacity limit instead.
pub(super) const MAX_STREAMED_CHUNK_BYTES: u64 = 64 * 1024 * 1024;

/// The chunk ceiling in force on this thread: the constant, or the lower one
/// a test installed through [`chunk_ceiling_probe`].
fn max_streamed_chunk_bytes() -> u64 {
    #[cfg(test)]
    if let Some(bytes) = CHUNK_CEILING.with(std::cell::Cell::get) {
        return bytes;
    }
    MAX_STREAMED_CHUNK_BYTES
}

#[cfg(test)]
thread_local! {
    static CHUNK_CEILING: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

/// Test-only seam for the chunk ceiling, thread-local like
/// `import::extraction_limit_probe`, so a small authored file can take the
/// whole-load path of a huge compressed chunk.
#[cfg(test)]
pub(super) mod chunk_ceiling_probe {
    /// Hold the ceiling at `bytes` until the guard is dropped.
    pub(in super::super) fn set(bytes: u64) -> Guard {
        super::CHUNK_CEILING.with(|slot| slot.set(Some(bytes)));
        Guard
    }

    pub(in super::super) struct Guard;

    impl Drop for Guard {
        fn drop(&mut self) {
            super::CHUNK_CEILING.with(|slot| slot.set(None));
        }
    }
}

/// How band 1's samples are laid out and encoded, chunk by chunk.
#[derive(Clone)]
pub(super) struct BandFormat {
    pub width: u32,
    pub height: u32,
    pub format: SampleFormat,
    pub bits: u16,
    pub compression_tag: u16,
    pub predictor: u16,
    /// Samples per pixel inside a chunk: every band for chunky files, one
    /// for planar files, whose first run of chunks is band 1.
    pub chunk_bands: usize,
    pub byte_order: ByteOrder,
    pub layout: Layout,
}

impl BandFormat {
    /// Whether samples are read by byte range instead of decoding chunks:
    /// uncompressed strips without a predictor.
    fn by_byte_range(&self) -> bool {
        matches!(self.layout, Layout::Strips { .. })
            && self.compression_tag == 1
            && self.predictor == 1
    }

    /// Whether no chunk decoded whole exceeds [`MAX_STREAMED_CHUNK_BYTES`]
    /// (or a test's lower ceiling).
    fn streams(&self) -> bool {
        if self.by_byte_range() {
            return true;
        }
        let (columns, rows) = match &self.layout {
            Layout::Strips { rows_per_strip, .. } => (self.width, *rows_per_strip),
            Layout::Tiles { width, height, .. } => (*width, *height),
        };
        u64::from(columns) * u64::from(rows) * (self.chunk_bands as u64) * u64::from(self.bits / 8)
            <= max_streamed_chunk_bytes()
    }
}

impl TiffHeader {
    pub(super) fn band_format(&self) -> BandFormat {
        BandFormat {
            width: self.width,
            height: self.height,
            format: self.format,
            bits: self.bits,
            compression_tag: self.compression_tag,
            predictor: self.predictor,
            chunk_bands: if self.planar == 2 {
                1
            } else {
                usize::from(self.bands.max(1))
            },
            byte_order: self.byte_order,
            layout: self.layout.clone(),
        }
    }
}

/// One chunk's place in the band: its file range and the cells it covers.
struct Chunk {
    offset: u64,
    count: u64,
    x: usize,
    y: usize,
    /// The chunk's own row length and row count as stored (a tile keeps its
    /// full size at the band's edge; the last strip is short).
    stored_width: usize,
    stored_rows: usize,
}

/// Windowed band-1 reads of a TIFF as row-major Float32, one strip or tile
/// at a time through `wbgeotiff`'s codecs and predictor. Integer and Float64
/// samples convert as a Float32 cast does; a chunk the file left empty reads
/// as `fill`. Uncompressed strips without a predictor are read by byte range,
/// so a whole image stored in one strip is never held; every other chunk is
/// decoded whole and the last one is kept for the next window.
pub(super) struct BandReader {
    file: File,
    band: BandFormat,
    codec: Compression,
    bytes_per_sample: usize,
    fill: f32,
    decoded: Option<(usize, Vec<u8>)>,
}

impl BandReader {
    pub(super) fn open(path: &Path, band: BandFormat, fill: f32) -> Result<Self, String> {
        if !matches!(band.bits, 8 | 16 | 32 | 64) {
            return Err(format!(
                "band type {} is not supported by the raster engine",
                band_type_name(band.format, band.bits)
            ));
        }
        let codec = codec(band.compression_tag)?;
        let (width, height) = (band.width as usize, band.height as usize);
        match &band.layout {
            Layout::Strips {
                rows_per_strip,
                offsets,
                counts,
            } => {
                let strips = height.div_ceil(*rows_per_strip as usize);
                if offsets.len() < strips || counts.len() < strips {
                    return Err(format!(
                        "TIFF declares {} strips for {strips} needed",
                        offsets.len()
                    ));
                }
            }
            Layout::Tiles {
                width: tile_width,
                height: tile_height,
                offsets,
                counts,
            } => {
                if *tile_width == 0 || *tile_height == 0 {
                    return Err("TIFF declares an empty tile size".to_string());
                }
                let tiles =
                    width.div_ceil(*tile_width as usize) * height.div_ceil(*tile_height as usize);
                if offsets.len() < tiles || counts.len() < tiles {
                    return Err(format!(
                        "TIFF declares {} tiles for {tiles} needed",
                        offsets.len()
                    ));
                }
            }
        }
        let file =
            File::open(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
        Ok(Self {
            file,
            bytes_per_sample: usize::from(band.bits / 8),
            band,
            codec,
            fill,
            decoded: None,
        })
    }

    /// Whether every window reads within the streamed working set.
    pub(super) fn streams(&self) -> bool {
        self.band.streams()
    }

    /// The chunks overlapping rows `y0..y1` and columns `x0..x1`, in file
    /// order.
    fn chunks(&self, x0: usize, y0: usize, x1: usize, y1: usize) -> Vec<(usize, Chunk)> {
        let (width, height) = (self.band.width as usize, self.band.height as usize);
        match &self.band.layout {
            Layout::Strips {
                rows_per_strip,
                offsets,
                counts,
            } => {
                let rows_per_strip = *rows_per_strip as usize;
                (y0 / rows_per_strip..y1.div_ceil(rows_per_strip))
                    .map(|strip| {
                        let y = strip * rows_per_strip;
                        (
                            strip,
                            Chunk {
                                offset: offsets[strip],
                                count: counts[strip],
                                x: 0,
                                y,
                                stored_width: width,
                                stored_rows: rows_per_strip.min(height - y),
                            },
                        )
                    })
                    .collect()
            }
            Layout::Tiles {
                width: tile_width,
                height: tile_height,
                offsets,
                counts,
            } => {
                let (tile_width, tile_height) = (*tile_width as usize, *tile_height as usize);
                let tiles_x = width.div_ceil(tile_width);
                let mut chunks = Vec::new();
                for tile_y in y0 / tile_height..y1.div_ceil(tile_height) {
                    for tile_x in x0 / tile_width..x1.div_ceil(tile_width) {
                        let index = tile_y * tiles_x + tile_x;
                        chunks.push((
                            index,
                            Chunk {
                                offset: offsets[index],
                                count: counts[index],
                                x: tile_x * tile_width,
                                y: tile_y * tile_height,
                                stored_width: tile_width,
                                stored_rows: tile_height,
                            },
                        ));
                    }
                }
                chunks
            }
        }
    }

    fn read_bytes(&mut self, offset: u64, count: usize) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0u8; count];
        self.file
            .seek(SeekFrom::Start(offset))
            .and_then(|_| self.file.read_exact(&mut bytes))
            .map_err(|e| format!("Failed to read raster chunk: {e}"))?;
        Ok(bytes)
    }

    /// The decoded bytes of chunk `index`, decoding it unless it was the
    /// last one decoded.
    fn decode(&mut self, index: usize, chunk: &Chunk) -> Result<&[u8], String> {
        if let Some((held, data)) = self.decoded.take_if(|(held, _)| *held == index) {
            return Ok(&self.decoded.insert((held, data)).1);
        }
        // Free the previous chunk before decoding the next one.
        self.decoded = None;
        let expected =
            chunk.stored_width * chunk.stored_rows * self.band.chunk_bands * self.bytes_per_sample;
        let raw = self.read_bytes(
            chunk.offset,
            usize::try_from(chunk.count).map_err(|_| "chunk size overflows".to_string())?,
        )?;
        let mut data = wbgeotiff::compression::decompress(self.codec, &raw, expected)
            .map_err(|e| format!("Failed to decode raster chunk: {e}"))?;
        if data.len() < expected {
            return Err(format!(
                "raster chunk decoded to {} bytes, expected {expected}",
                data.len()
            ));
        }
        data.truncate(expected);
        wbgeotiff::compression::undo_predictor(
            &mut data,
            self.band.predictor,
            chunk.stored_width,
            chunk.stored_rows,
            self.band.chunk_bands,
            self.bytes_per_sample,
            self.band.byte_order,
        )
        .map_err(|e| format!("Failed to undo the raster predictor: {e}"))?;
        Ok(&self.decoded.insert((index, data)).1)
    }

    /// Fill `out` with `window` of band 1, row-major.
    pub(super) fn read(
        &mut self,
        window: RasterWindow,
        out: &mut [f32],
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let (x0, y0) = (window.x as usize, window.y as usize);
        let (x1, y1) = (x0 + window.width as usize, y0 + window.height as usize);
        let columns = window.width as usize;
        debug_assert_eq!(out.len(), columns * window.height as usize);
        debug_assert!(x1 <= self.band.width as usize && y1 <= self.band.height as usize);
        out.fill(self.fill);
        let (format, order) = (self.band.format, self.band.byte_order);
        let bytes_per_sample = self.bytes_per_sample;
        let stride = self.band.chunk_bands * bytes_per_sample;
        let by_byte_range = self.band.by_byte_range();
        for (position, (index, chunk)) in self.chunks(x0, y0, x1, y1).into_iter().enumerate() {
            if position % 16 == 0 {
                check_cancel(cancel)?;
            }
            if chunk.count == 0 {
                continue;
            }
            let (cx0, cy0) = (x0.max(chunk.x), y0.max(chunk.y));
            let cx1 = x1.min(chunk.x + chunk.stored_width);
            let cy1 = y1.min(chunk.y + chunk.stored_rows);
            if cx0 >= cx1 || cy0 >= cy1 {
                continue;
            }
            let span = cx1 - cx0;
            let row_bytes = chunk.stored_width * stride;
            if by_byte_range {
                let expected = row_bytes * chunk.stored_rows;
                if chunk.count < expected as u64 {
                    return Err(format!(
                        "raster chunk decoded to {} bytes, expected {expected}",
                        chunk.count
                    ));
                }
                for row in cy0..cy1 {
                    let at = (row - chunk.y) * row_bytes + (cx0 - chunk.x) * stride;
                    let bytes = self.read_bytes(chunk.offset + at as u64, span * stride)?;
                    let target = (row - y0) * columns + (cx0 - x0);
                    convert_row(
                        &bytes,
                        stride,
                        bytes_per_sample,
                        format,
                        order,
                        &mut out[target..target + span],
                    );
                }
            } else {
                let data = self.decode(index, &chunk)?;
                for row in cy0..cy1 {
                    let at = (row - chunk.y) * row_bytes + (cx0 - chunk.x) * stride;
                    let target = (row - y0) * columns + (cx0 - x0);
                    convert_row(
                        &data[at..],
                        stride,
                        bytes_per_sample,
                        format,
                        order,
                        &mut out[target..target + span],
                    );
                }
            }
        }
        Ok(())
    }
}

/// Convert consecutive pixels starting at `bytes` into `out`: the first
/// `bytes_per_sample` bytes (band 1) of every `stride`-byte pixel.
fn convert_row(
    bytes: &[u8],
    stride: usize,
    bytes_per_sample: usize,
    format: SampleFormat,
    order: ByteOrder,
    out: &mut [f32],
) {
    for (column, value) in out.iter_mut().enumerate() {
        let at = column * stride;
        *value = sample_f32(&bytes[at..at + bytes_per_sample], format, order);
    }
}

/// One sample as Float32, exactly as a Float32 cast of its native value.
fn sample_f32(bytes: &[u8], format: SampleFormat, order: ByteOrder) -> f32 {
    macro_rules! read {
        ($ty:ty, $len:expr) => {{
            let array: [u8; $len] = match bytes.try_into() {
                Ok(array) => array,
                Err(_) => return f32::NAN,
            };
            match order {
                ByteOrder::LittleEndian => <$ty>::from_le_bytes(array),
                ByteOrder::BigEndian => <$ty>::from_be_bytes(array),
            }
        }};
    }
    match (format, bytes.len()) {
        (SampleFormat::Uint, 1) => bytes[0] as f32,
        (SampleFormat::Uint, 2) => read!(u16, 2) as f32,
        (SampleFormat::Uint, 4) => read!(u32, 4) as f32,
        (SampleFormat::Uint, 8) => read!(u64, 8) as f32,
        (SampleFormat::Int, 1) => bytes[0] as i8 as f32,
        (SampleFormat::Int, 2) => read!(i16, 2) as f32,
        (SampleFormat::Int, 4) => read!(i32, 4) as f32,
        (SampleFormat::Int, 8) => read!(i64, 8) as f32,
        (SampleFormat::IeeeFloat, 4) => f32::from_bits(read!(u32, 4)),
        (SampleFormat::IeeeFloat, 8) => f64::from_bits(read!(u64, 8)) as f32,
        _ => f32::NAN,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_convert_like_a_float32_cast_in_either_byte_order() {
        assert_eq!(
            sample_f32(
                &(-12i16).to_be_bytes(),
                SampleFormat::Int,
                ByteOrder::BigEndian
            ),
            -12.0
        );
        assert_eq!(
            sample_f32(
                &70000u32.to_le_bytes(),
                SampleFormat::Uint,
                ByteOrder::LittleEndian
            ),
            70000.0
        );
        assert_eq!(
            sample_f32(
                &1.5f64.to_le_bytes(),
                SampleFormat::IeeeFloat,
                ByteOrder::LittleEndian
            ),
            1.5
        );
        assert!(
            sample_f32(
                &f32::NAN.to_be_bytes(),
                SampleFormat::IeeeFloat,
                ByteOrder::BigEndian
            )
            .is_nan()
        );
    }

    #[test]
    fn gdal_metadata_yields_scale_offset_and_unit() {
        let xml = r#"<GDALMetadata>
  <Item name="OFFSET" sample="0" role="offset">12</Item>
  <Item name="SCALE" sample="0" role="scale">0.01</Item>
  <Item name="UNITTYPE" sample="0" role="unittype">metre</Item>
  <Item name="AREA_OR_POINT">Area</Item>
</GDALMetadata>"#;
        assert_eq!(gdal_metadata(xml), (0.01, 12.0, Some("metre".to_string())));
        assert_eq!(gdal_metadata("<GDALMetadata/>"), (1.0, 0.0, None));
    }

    #[test]
    fn nodata_text_parses_gdal_spellings() {
        assert_eq!(parse_nodata("-9999"), Some(-9999.0));
        assert_eq!(
            parse_nodata("-3.4028234663852886e+38"),
            Some(f64::from(f32::MIN))
        );
        assert!(parse_nodata("nan").is_some_and(f64::is_nan));
        assert_eq!(parse_nodata("-inf"), Some(f64::NEG_INFINITY));
        assert_eq!(parse_nodata("x"), None);
    }

    #[test]
    fn only_a_chunk_decoding_above_64_mib_keeps_a_tiff_from_streaming() {
        let band = |layout: Layout, compression_tag: u16, predictor: u16| BandFormat {
            width: 8193,
            height: 4096,
            format: SampleFormat::IeeeFloat,
            bits: 32,
            compression_tag,
            predictor,
            chunk_bands: 1,
            byte_order: ByteOrder::LittleEndian,
            layout,
        };
        let strips = |rows_per_strip: u32| Layout::Strips {
            rows_per_strip,
            offsets: Vec::new(),
            counts: Vec::new(),
        };
        // One Deflate strip of the whole image decodes to 128 MiB.
        assert!(!band(strips(4096), 8, 1).streams());
        // Uncompressed, it is read by byte range whatever its size...
        assert!(band(strips(4096), 1, 1).streams());
        // ...unless a predictor needs whole rows decoded.
        assert!(!band(strips(4096), 1, 2).streams());
        // 2048 rows of 8193 Float32 samples are exactly 64 MiB plus 2048 samples.
        assert!(!band(strips(2048), 8, 1).streams());
        assert!(band(strips(2047), 8, 3).streams());
        let tiles = Layout::Tiles {
            width: 512,
            height: 512,
            offsets: Vec::new(),
            counts: Vec::new(),
        };
        assert!(band(tiles, 8, 3).streams());
    }

    #[test]
    fn names_follow_gdal_vocabulary() {
        assert_eq!(band_type_name(SampleFormat::Uint, 8), "Byte");
        assert_eq!(band_type_name(SampleFormat::IeeeFloat, 32), "Float32");
        assert_eq!(compression_name(8), "DEFLATE");
        assert_eq!(compression_name(32946), "DEFLATE");
        assert_eq!(compression_name(50000), "ZSTD");
        assert!(codec(50000).is_err());
        assert_eq!(codec(32946).unwrap(), Compression::Deflate);
    }

    /// A classic little-endian TIFF whose one directory, at offset 8, holds
    /// `entries` (tag, type, count, value) and points its next directory at
    /// `next`.
    fn crafted_tiff(
        root: &Path,
        entries: &[(u16, u16, u32, u32)],
        next: u32,
    ) -> std::path::PathBuf {
        let mut bytes = b"II*\0".to_vec();
        bytes.extend(8u32.to_le_bytes());
        bytes.extend((entries.len() as u16).to_le_bytes());
        for (code, kind, count, value) in entries {
            bytes.extend(code.to_le_bytes());
            bytes.extend(kind.to_le_bytes());
            bytes.extend(count.to_le_bytes());
            bytes.extend(value.to_le_bytes());
        }
        bytes.extend(next.to_le_bytes());
        let path = root.join("crafted.tif");
        std::fs::write(&path, bytes).unwrap();
        path
    }

    /// wbgeotiff follows next-directory offsets and sizes its buffers from
    /// header counts unchecked; the header read must stay bounded on a
    /// crafted file (U32 runs it on the UserData lane).
    #[test]
    fn a_directory_chain_that_loops_is_refused() {
        // ImageWidth = 16, and the next directory is this one again.
        let root = crate::test_scratch::TestScratch::new("tiff-ifd-loop");
        let path = crafted_tiff(&root, &[(tag::ImageWidth, 3, 1, 16)], 8);
        let error = read_header(&path).err().expect("refused");
        assert!(error.contains("loop"), "{error}");
    }

    #[test]
    fn a_tag_declaring_gigabytes_of_values_is_refused_before_they_are_read() {
        // ModelPixelScale as 2^32 - 1 doubles: 32 GiB.
        let root = crate::test_scratch::TestScratch::new("tiff-huge-tag");
        let path = crafted_tiff(&root, &[(tag::ModelPixelScaleTag, 12, u32::MAX, 26)], 0);
        let error = read_header(&path).err().expect("refused");
        assert!(error.contains("MiB"), "{error}");
    }

    #[test]
    fn a_bigtiff_directory_declaring_too_many_entries_is_refused() {
        let mut bytes = b"II+\0".to_vec();
        bytes.extend(8u16.to_le_bytes());
        bytes.extend(0u16.to_le_bytes());
        bytes.extend(16u64.to_le_bytes());
        bytes.extend((1u64 << 60).to_le_bytes());
        let root = crate::test_scratch::TestScratch::new("tiff-huge-ifd");
        let path = root.join("crafted.tif");
        std::fs::write(&path, bytes).unwrap();
        let error = read_header(&path).err().expect("refused");
        assert!(error.contains("entries"), "{error}");
    }
}
