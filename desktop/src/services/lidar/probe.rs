//! Raster admission probes built on `gdalinfo -json`.
//!
//! Admission validates and records the interpretation rather than trusting
//! filenames or WKT names. The probe result is persisted verbatim (minus
//! absolute paths) in the source manifest so provenance survives reimports.

use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct RasterProbe {
    pub driver: String,
    pub width: u32,
    pub height: u32,
    pub band_count: u32,
    pub band_type: String,
    pub nodata: Option<f32>,
    pub scale: f64,
    pub offset: f64,
    pub unit: Option<String>,
    pub mask_flags: Vec<String>,
    pub geotransform: [f64; 6],
    pub crs_wkt: String,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct ProbeJson {
    #[serde(rename = "driverShortName")]
    driver_short_name: Option<String>,
    size: Option<[u32; 2]>,
    bands: Option<Vec<ProbeBand>>,
    geoTransform: Option<Vec<f64>>,
    coordinateSystem: Option<ProbeCrs>,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct ProbeBand {
    #[serde(rename = "type")]
    band_type: Option<String>,
    noDataValue: Option<serde_json::Value>,
    scale: Option<f64>,
    offset: Option<f64>,
    unit: Option<String>,
    mask: Option<ProbeMask>,
}

#[derive(Debug, Deserialize)]
struct ProbeMask {
    #[serde(default)]
    flags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct ProbeCrs {
    wkt: Option<String>,
}

pub fn parse_gdalinfo_json(json: &str) -> Result<RasterProbe, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("gdalinfo returned invalid JSON: {e}"))?;
    let parsed: ProbeJson = serde_json::from_value(value.clone())
        .map_err(|e| format!("gdalinfo JSON has unexpected shape: {e}"))?;

    let driver = parsed
        .driver_short_name
        .unwrap_or_else(|| "unknown".to_string());
    let [width, height] = parsed
        .size
        .ok_or_else(|| "gdalinfo JSON missing raster size".to_string())?;
    let bands = parsed.bands.unwrap_or_default();
    if bands.is_empty() {
        return Err("raster has no bands; Canopi admits single-band numeric rasters".to_string());
    }
    let first = &bands[0];
    let band_type = first
        .band_type
        .clone()
        .unwrap_or_else(|| "Unknown".to_string());
    if !is_numeric_band_type(&band_type) {
        return Err(format!(
            "band type {band_type} is not a supported numeric raster type"
        ));
    }
    let nodata = match &first.noDataValue {
        Some(serde_json::Value::Number(n)) => n.as_f64().map(|v| v as f32),
        _ => None,
    };
    let geotransform_raw = parsed
        .geoTransform
        .ok_or_else(|| "raster is not georeferenced (missing geotransform)".to_string())?;
    let mut geotransform = [0.0f64; 6];
    if geotransform_raw.len() != 6 {
        return Err("gdalinfo geotransform must have exactly 6 values".to_string());
    }
    for (slot, value) in geotransform_raw.iter().enumerate() {
        geotransform[slot] = *value;
    }
    if geotransform[1] == 0.0 || geotransform[5] == 0.0 {
        return Err("raster has degenerate pixel size (zero geotransform scale)".to_string());
    }
    let crs_wkt = parsed
        .coordinateSystem
        .and_then(|crs| crs.wkt)
        .ok_or_else(|| {
            "raster has no coordinate system; Canopi requires a horizontal CRS".to_string()
        })?;

    Ok(RasterProbe {
        driver,
        width,
        height,
        band_count: bands.len() as u32,
        band_type,
        nodata,
        scale: first.scale.unwrap_or(1.0),
        offset: first.offset.unwrap_or(0.0),
        unit: first.unit.clone().filter(|unit| !unit.trim().is_empty()),
        mask_flags: first
            .mask
            .as_ref()
            .map(|mask| mask.flags.clone())
            .unwrap_or_default(),
        geotransform,
        crs_wkt,
    })
}

fn is_numeric_band_type(band_type: &str) -> bool {
    matches!(
        band_type,
        "Byte"
            | "Int8"
            | "UInt16"
            | "Int16"
            | "UInt32"
            | "Int32"
            | "UInt64"
            | "Int64"
            | "Float16"
            | "Float32"
            | "Float64"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_numeric_gdalinfo_json() {
        let json = r#"{
            "driverShortName": "GTiff",
            "size": [2000, 2000],
            "geoTransform": [445999.75, 0.5, 0.0, 6807000.25, 0.0, -0.5],
            "coordinateSystem": {"wkt": "PROJCRS[\"EPSG:2154\"]"},
            "bands": [
                {
                    "type": "Float32",
                    "noDataValue": -9999.0,
                    "mask": {"flags": ["DATASET"]},
                    "minimum": 12.5,
                    "maximum": 88.25
                }
            ]
        }"#;
        let probe = parse_gdalinfo_json(json).expect("probe should parse");
        assert_eq!(probe.driver, "GTiff");
        assert_eq!(probe.width, 2000);
        assert_eq!(probe.band_type, "Float32");
        assert_eq!(probe.nodata, Some(-9999.0));
        assert_eq!(probe.scale, 1.0);
        assert_eq!(probe.offset, 0.0);
        assert_eq!(probe.mask_flags, vec!["DATASET"]);
        assert_eq!(probe.geotransform[1], 0.5);
        assert_eq!(probe.band_count, 1);
    }

    #[test]
    fn rejects_non_numeric_band() {
        let json = r#"{
            "driverShortName": "GTiff",
            "size": [4, 4],
            "geoTransform": [0, 1, 0, 4, 0, -1],
            "coordinateSystem": {"wkt": "x"},
            "bands": [{"type": "Byte", "noDataValue": null}]
        }"#;
        // Byte IS numeric; use a color table style failure instead.
        assert!(parse_gdalinfo_json(json).is_ok());
        let json = r#"{
            "driverShortName": "GTiff",
            "size": [4, 4],
            "geoTransform": [0, 1, 0, 4, 0, -1],
            "coordinateSystem": {"wkt": "x"},
            "bands": []
        }"#;
        let error = parse_gdalinfo_json(json).unwrap_err();
        assert!(error.contains("no bands"));
    }

    #[test]
    fn rejects_missing_georeference() {
        let json = r#"{
            "driverShortName": "GTiff",
            "size": [4, 4],
            "bands": [{"type": "Float32"}]
        }"#;
        let error = parse_gdalinfo_json(json).unwrap_err();
        assert!(error.contains("not georeferenced"));
    }

    #[test]
    fn captures_scale_offset_unit_and_mask_metadata() {
        let json = r#"{
            "driverShortName": "GTiff",
            "size": [4, 4],
            "geoTransform": [0, 1, 0, 4, 0, -1],
            "coordinateSystem": {"wkt": "x"},
            "bands": [{
                "type": "Int16",
                "scale": 0.01,
                "offset": 12.0,
                "unit": "metre",
                "mask": {"flags": ["PER_DATASET"]}
            }]
        }"#;
        let probe = parse_gdalinfo_json(json).unwrap();
        assert_eq!(probe.scale, 0.01);
        assert_eq!(probe.offset, 12.0);
        assert_eq!(probe.unit.as_deref(), Some("metre"));
        assert_eq!(probe.mask_flags, vec!["PER_DATASET"]);
    }

    #[test]
    fn rejects_complex_numeric_bands() {
        let json = r#"{
            "driverShortName": "GTiff",
            "size": [4, 4],
            "geoTransform": [0, 1, 0, 4, 0, -1],
            "coordinateSystem": {"wkt": "x"},
            "bands": [{"type": "CFloat32"}]
        }"#;
        assert!(
            parse_gdalinfo_json(json)
                .unwrap_err()
                .contains("not a supported numeric")
        );
    }
}
