//! TIFF header probing and band-1 decoding on the `wbgeotiff` primitives.
//!
//! The header is read from the file's directory alone, so probing a
//! multi-gigabyte GeoTIFF costs O(directory). Decoding streams one strip or
//! tile at a time through `wbgeotiff`'s codecs and predictor into a whole
//! Float32 band; the caller checks the capacity limit before asking for it.

use super::super::engine::check_cancel;
use std::fs::File;
use std::io::{BufReader, Read as _};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use wbgeotiff::geo_keys::GeoKeyDirectory;
use wbgeotiff::ifd::{ByteOrder, Ifd, TiffReader};
use wbgeotiff::tags::{Compression, SampleFormat, tag};

/// How band samples are chunked in the file.
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
pub(super) fn is_tiff(path: &Path) -> Result<bool, String> {
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

/// Read the directory of a TIFF without touching its samples.
pub(super) fn read_header(path: &Path) -> Result<TiffHeader, String> {
    let mut reader = open(path)?;
    let byte_order = reader.byte_order;
    let ifds = reader
        .read_all_ifds()
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
            "unittype" => {
                if !value.is_empty() {
                    unit = Some(value.to_string());
                }
            }
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

/// Decode band 1 as row-major Float32, `width * height` samples, streaming
/// one strip or tile at a time. Integer and Float64 samples convert as a
/// Float32 cast does; a chunk the file left empty reads as `fill`.
pub(super) fn read_band_f32(
    path: &Path,
    header: &TiffHeader,
    fill: f32,
    cancel: &AtomicBool,
) -> Result<Vec<f32>, String> {
    let width = header.width as usize;
    let height = header.height as usize;
    let cells = width
        .checked_mul(height)
        .ok_or_else(|| "raster cell count overflows".to_string())?;
    if !matches!(header.bits, 8 | 16 | 32 | 64) {
        return Err(format!(
            "band type {} is not supported by the raster engine",
            band_type_name(header.format, header.bits)
        ));
    }
    let bytes_per_sample = usize::from(header.bits / 8);
    let codec = codec(header.compression_tag)?;
    // Planar files keep every band in its own run of chunks; band 1 is the
    // first run. Chunky files interleave the bands within each pixel.
    let chunk_bands = if header.planar == 2 {
        1
    } else {
        usize::from(header.bands.max(1))
    };
    let mut reader = open(path)?;
    let mut out = vec![fill; cells];
    let mut decode_chunk = |offset: u64,
                            count: u64,
                            chunk_width: usize,
                            chunk_rows: usize|
     -> Result<Option<Vec<u8>>, String> {
        if count == 0 {
            return Ok(None);
        }
        let expected = chunk_width * chunk_rows * chunk_bands * bytes_per_sample;
        let raw = reader
            .read_bytes_at(
                offset,
                usize::try_from(count).map_err(|_| "chunk size overflows".to_string())?,
            )
            .map_err(|e| format!("Failed to read raster chunk: {e}"))?;
        let mut data = wbgeotiff::compression::decompress(codec, &raw, expected)
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
            header.predictor,
            chunk_width,
            chunk_rows,
            chunk_bands,
            bytes_per_sample,
            header.byte_order,
        )
        .map_err(|e| format!("Failed to undo the raster predictor: {e}"))?;
        Ok(Some(data))
    };
    let stride = chunk_bands * bytes_per_sample;
    match &header.layout {
        Layout::Strips {
            rows_per_strip,
            offsets,
            counts,
        } => {
            let rows_per_strip = *rows_per_strip as usize;
            let strips = height.div_ceil(rows_per_strip);
            if offsets.len() < strips || counts.len() < strips {
                return Err(format!(
                    "TIFF declares {} strips for {strips} needed",
                    offsets.len()
                ));
            }
            for strip in 0..strips {
                if strip % 16 == 0 {
                    check_cancel(cancel)?;
                }
                let first_row = strip * rows_per_strip;
                let rows = rows_per_strip.min(height - first_row);
                let Some(data) = decode_chunk(offsets[strip], counts[strip], width, rows)? else {
                    continue;
                };
                for row in 0..rows {
                    let target = (first_row + row) * width;
                    for column in 0..width {
                        let at = (row * width + column) * stride;
                        out[target + column] = sample_f32(
                            &data[at..at + bytes_per_sample],
                            header.format,
                            header.byte_order,
                        );
                    }
                }
            }
        }
        Layout::Tiles {
            width: tile_width,
            height: tile_height,
            offsets,
            counts,
        } => {
            let (tile_width, tile_height) = (*tile_width as usize, *tile_height as usize);
            if tile_width == 0 || tile_height == 0 {
                return Err("TIFF declares an empty tile size".to_string());
            }
            let tiles_x = width.div_ceil(tile_width);
            let tiles_y = height.div_ceil(tile_height);
            let tiles = tiles_x * tiles_y;
            if offsets.len() < tiles || counts.len() < tiles {
                return Err(format!(
                    "TIFF declares {} tiles for {tiles} needed",
                    offsets.len()
                ));
            }
            for tile_y in 0..tiles_y {
                check_cancel(cancel)?;
                for tile_x in 0..tiles_x {
                    let index = tile_y * tiles_x + tile_x;
                    let Some(data) =
                        decode_chunk(offsets[index], counts[index], tile_width, tile_height)?
                    else {
                        continue;
                    };
                    let x0 = tile_x * tile_width;
                    let y0 = tile_y * tile_height;
                    let columns = tile_width.min(width - x0);
                    let rows = tile_height.min(height - y0);
                    for row in 0..rows {
                        let target = (y0 + row) * width + x0;
                        for column in 0..columns {
                            let at = (row * tile_width + column) * stride;
                            out[target + column] = sample_f32(
                                &data[at..at + bytes_per_sample],
                                header.format,
                                header.byte_order,
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(out)
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
    fn names_follow_gdal_vocabulary() {
        assert_eq!(band_type_name(SampleFormat::Uint, 8), "Byte");
        assert_eq!(band_type_name(SampleFormat::IeeeFloat, 32), "Float32");
        assert_eq!(compression_name(8), "DEFLATE");
        assert_eq!(compression_name(32946), "DEFLATE");
        assert_eq!(compression_name(50000), "ZSTD");
        assert!(codec(50000).is_err());
        assert_eq!(codec(32946).unwrap(), Compression::Deflate);
    }
}
