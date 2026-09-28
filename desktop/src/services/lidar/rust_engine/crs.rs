//! Coordinate reference systems for the raster engine, on `wbprojection`.
//!
//! A CRS reaches the engine as `EPSG:n`, as WKT (the catalogue's stored
//! form) or as GeoTIFF keys. Every route resolves to one [`ResolvedCrs`]
//! that can transform points and be written back as GeoTIFF keys. An EPSG
//! code is preferred whenever the definition names one, so stored WKT and
//! written keys stay registry-backed; only a source with user-defined keys
//! and no recognisable code keeps a user-defined definition.

use super::laea::Laea;
use super::swiss::SwissGrid;
use wbgeotiff::geo_keys::{GeoKeyDirectory, GeoKeyEntry, GeoKeyValue, key};
use wbprojection::{Crs, Datum, DatumTransform, Ellipsoid, ProjectionKind, ProjectionParams};

/// Projections the engine computes itself because the crate's are not
/// accurate enough (see `swiss.rs` and `laea.rs`).
#[derive(Debug, Clone, Copy, PartialEq)]
enum OwnProjection {
    Swiss(SwissGrid),
    Laea(Laea),
}

impl OwnProjection {
    fn forward(&self, lon: f64, lat: f64) -> (f64, f64) {
        match self {
            OwnProjection::Swiss(grid) => grid.forward(lon, lat),
            OwnProjection::Laea(laea) => laea.forward(lon, lat),
        }
    }

    fn inverse(&self, x: f64, y: f64) -> (f64, f64) {
        match self {
            OwnProjection::Swiss(grid) => grid.inverse(x, y),
            OwnProjection::Laea(laea) => laea.inverse(x, y),
        }
    }
}

/// One horizontal CRS the engine can transform through and write.
#[derive(Debug, Clone)]
pub(super) struct ResolvedCrs {
    /// The crate's definition: datum and, unless `own` is set, projection.
    pub crs: Crs,
    pub epsg: Option<u32>,
    /// WKT the catalogue stores; re-parsing it yields the same CRS.
    pub wkt: String,
    /// A projection the engine computes itself; `crs` is then the geographic
    /// definition on the same datum, used for the datum step only.
    own: Option<OwnProjection>,
}

impl ResolvedCrs {
    /// A crate definition, with LAEA taken over by the engine's formulas.
    pub(super) fn registry(crs: Crs, epsg: Option<u32>, wkt: String) -> Self {
        let params = crs.projection.params();
        if matches!(params.kind, ProjectionKind::LambertAzimuthalEqualArea)
            && params.lat0.abs() < 89.999
        {
            let laea = Laea {
                lon0: params.lon0,
                lat0: params.lat0,
                false_easting: params.false_easting,
                false_northing: params.false_northing,
                a: params.ellipsoid.a,
                e2: params.ellipsoid.e2,
            };
            if let Some(geographic) = geographic_on(&crs.datum, &crs.name) {
                return Self {
                    crs: geographic,
                    epsg,
                    wkt,
                    own: Some(OwnProjection::Laea(laea)),
                };
            }
        }
        Self {
            crs,
            epsg,
            wkt,
            own: None,
        }
    }

    pub(super) fn is_projected(&self) -> bool {
        self.own.is_some() || self.crs.is_projected()
    }

    /// Geodetic WGS84 (lon, lat) of a point in this CRS.
    fn to_wgs84(&self, x: f64, y: f64, wgs84: &Crs) -> Result<(f64, f64), String> {
        match self.own {
            Some(own) => {
                let (lon, lat) = own.inverse(x, y);
                self.crs.transform_to(lon, lat, wgs84)
            }
            None => self.crs.transform_to(x, y, wgs84),
        }
        .map_err(|e| e.to_string())
    }

    /// A point of this CRS from geodetic WGS84 (lon, lat).
    fn place_wgs84(&self, lon: f64, lat: f64, wgs84: &Crs) -> Result<(f64, f64), String> {
        match self.own {
            Some(own) => {
                let (lon, lat) = wgs84
                    .transform_to(lon, lat, &self.crs)
                    .map_err(|e| e.to_string())?;
                Ok(own.forward(lon, lat))
            }
            None => wgs84
                .transform_to(lon, lat, &self.crs)
                .map_err(|e| e.to_string()),
        }
    }

    /// Transform one point into `target`, through geodetic WGS84.
    pub(super) fn transform_to(
        &self,
        x: f64,
        y: f64,
        target: &ResolvedCrs,
    ) -> Result<(f64, f64), String> {
        let wgs84 = Crs::wgs84_geographic();
        let (lon, lat) = self.to_wgs84(x, y, &wgs84)?;
        target.place_wgs84(lon, lat, &wgs84)
    }
}

/// GDAL's WKT1 of the Swiss grids, which the crate's registry text does not
/// describe truthfully (see `swiss.rs`).
const LV95_WKT: &str = r#"PROJCS["CH1903+ / LV95",GEOGCS["CH1903+",DATUM["CH1903+",SPHEROID["Bessel 1841",6377397.155,299.1528128,AUTHORITY["EPSG","7004"]],AUTHORITY["EPSG","6150"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4150"]],PROJECTION["Hotine_Oblique_Mercator_Azimuth_Center"],PARAMETER["latitude_of_center",46.9524055555556],PARAMETER["longitude_of_center",7.43958333333333],PARAMETER["azimuth",90],PARAMETER["rectified_grid_angle",90],PARAMETER["scale_factor",1],PARAMETER["false_easting",2600000],PARAMETER["false_northing",1200000],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","2056"]]"#;
const LV03_WKT: &str = r#"PROJCS["CH1903 / LV03",GEOGCS["CH1903",DATUM["CH1903",SPHEROID["Bessel 1841",6377397.155,299.1528128,AUTHORITY["EPSG","7004"]],AUTHORITY["EPSG","6149"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4149"]],PROJECTION["Hotine_Oblique_Mercator_Azimuth_Center"],PARAMETER["latitude_of_center",46.9524055555556],PARAMETER["longitude_of_center",7.43958333333333],PARAMETER["azimuth",90],PARAMETER["rectified_grid_angle",90],PARAMETER["scale_factor",1],PARAMETER["false_easting",600000],PARAMETER["false_northing",200000],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","21781"]]"#;

/// The Swiss grids: the crate's datum, the engine's projection.
fn swiss(code: u32) -> Option<ResolvedCrs> {
    let (grid, wkt, datum) = match code {
        2056 => (SwissGrid::LV95, LV95_WKT, Datum::CH1903_PLUS),
        21781 => (SwissGrid::LV03, LV03_WKT, Datum::CH1903),
        _ => return None,
    };
    let params = ProjectionParams {
        kind: ProjectionKind::Geographic,
        ellipsoid: datum.ellipsoid.clone(),
        datum: datum.clone(),
        ..ProjectionParams::default()
    };
    let geographic = Crs::new(format!("EPSG:{code} geodetic"), datum, params).ok()?;
    Some(ResolvedCrs {
        crs: geographic,
        epsg: Some(code),
        wkt: wkt.to_string(),
        own: Some(OwnProjection::Swiss(grid)),
    })
}

/// The geographic CRS on `datum`, for the datum step of an own projection.
fn geographic_on(datum: &Datum, name: &str) -> Option<Crs> {
    let params = ProjectionParams {
        kind: ProjectionKind::Geographic,
        ellipsoid: datum.ellipsoid.clone(),
        datum: datum.clone(),
        ..ProjectionParams::default()
    };
    Crs::new(format!("{name} geodetic"), datum.clone(), params).ok()
}

/// Resolve `EPSG:n` (any common spelling) or WKT.
pub(super) fn from_reference(reference: &str) -> Result<ResolvedCrs, String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() {
        return Err("no coordinate reference system was given".to_string());
    }
    if !trimmed.contains('[') {
        let code = wbprojection::epsg_from_srs_reference(trimmed)
            .ok_or_else(|| format!("unrecognised coordinate reference system {trimmed}"))?;
        return from_epsg(code);
    }
    if let Some(code) = wbprojection::epsg_from_wkt(trimmed)
        && let Ok(mut resolved) = from_epsg(code)
    {
        resolved.wkt = trimmed.to_string();
        return Ok(resolved);
    }
    let crs = Crs::from_wkt(trimmed).map_err(|e| format!("unsupported CRS WKT: {e}"))?;
    Ok(ResolvedCrs::registry(crs, None, trimmed.to_string()))
}

/// Resolve a registry code.
pub(super) fn from_epsg(code: u32) -> Result<ResolvedCrs, String> {
    if let Some(resolved) = swiss(code) {
        return Ok(resolved);
    }
    let crs = Crs::from_epsg(code)
        .map_err(|e| format!("EPSG:{code} is not in the projection registry: {e}"))?;
    let wkt = wbprojection::to_ogc_wkt(code).unwrap_or_else(|_| crs.to_wkt());
    Ok(ResolvedCrs::registry(
        crs,
        Some(code),
        with_authority(&wkt, code),
    ))
}

/// WKT1 with the authority node GDAL and the parser both key on, so a
/// stored definition resolves back to its code rather than by name.
fn with_authority(wkt: &str, code: u32) -> String {
    let authority = format!("AUTHORITY[\"EPSG\",\"{code}\"]");
    if wkt.contains(&authority) {
        return wkt.to_string();
    }
    match wkt.trim_end().strip_suffix(']') {
        Some(body) => format!("{body},{authority}]"),
        None => wkt.to_string(),
    }
}

fn short(keys: &GeoKeyDirectory, id: u16) -> Option<u16> {
    match keys.get(id) {
        Some(GeoKeyValue::Short(value)) => Some(*value),
        _ => None,
    }
}

fn double(keys: &GeoKeyDirectory, id: u16) -> Option<f64> {
    match keys.get(id) {
        Some(GeoKeyValue::Doubles(values)) => values.first().copied(),
        Some(GeoKeyValue::Short(value)) => Some(f64::from(*value)),
        _ => None,
    }
}

fn ascii(keys: &GeoKeyDirectory, id: u16) -> Option<String> {
    match keys.get(id) {
        Some(GeoKeyValue::Ascii(value)) => Some(value.trim_end_matches('|').trim().to_string()),
        _ => None,
    }
}

const USER_DEFINED: u16 = 32767;
/// False-origin keys of conic projections, which `wbgeotiff::geo_keys::key`
/// does not name.
const PROJ_FALSE_ORIGIN_EASTING: u16 = 3086;
const PROJ_FALSE_ORIGIN_NORTHING: u16 = 3087;

fn registry_code(value: Option<u16>) -> Option<u32> {
    value
        .filter(|code| *code != USER_DEFINED && *code != 0)
        .map(u32::from)
}

/// Resolve the GeoTIFF keys of a file; `None` when the file declares no CRS.
pub(super) fn from_geokeys(keys: &GeoKeyDirectory) -> Result<Option<ResolvedCrs>, String> {
    match short(keys, key::GTModelTypeGeoKey) {
        Some(1) => {
            if let Some(code) = registry_code(short(keys, key::ProjectedCSTypeGeoKey)) {
                return from_epsg(code).map(Some);
            }
            user_defined_projected(keys).map(Some)
        }
        Some(2) => {
            if let Some(code) = registry_code(short(keys, key::GeographicTypeGeoKey)) {
                return from_epsg(code).map(Some);
            }
            let (ellipsoid, datum) = ellipsoid_of(keys)?;
            let params = ProjectionParams {
                kind: ProjectionKind::Geographic,
                ellipsoid,
                datum: datum.clone(),
                ..ProjectionParams::default()
            };
            let name = ascii(keys, key::GTCitationGeoKey)
                .or_else(|| ascii(keys, key::GeogCitationGeoKey))
                .unwrap_or_else(|| "user-defined geographic CRS".to_string());
            let crs = Crs::new(name, datum, params)
                .map_err(|e| format!("unsupported geographic CRS: {e}"))?;
            Ok(Some(ResolvedCrs::registry(crs.clone(), None, crs.to_wkt())))
        }
        Some(3) => Err("geocentric rasters are not supported".to_string()),
        None => Ok(None),
        Some(other) => Err(format!("GeoTIFF model type {other} is not supported")),
    }
}

/// A projected CRS spelled out key by key (no registry code).
fn user_defined_projected(keys: &GeoKeyDirectory) -> Result<ResolvedCrs, String> {
    let transformation = short(keys, key::ProjCoordTransGeoKey).ok_or_else(|| {
        "the raster declares a user-defined projection without a coordinate transformation"
            .to_string()
    })?;
    let lat0 = double(keys, key::ProjNatOriginLatGeoKey)
        .or_else(|| double(keys, key::ProjFalseProjOriginLatGeoKey))
        .or_else(|| double(keys, key::ProjCenterLatGeoKey))
        .unwrap_or(0.0);
    let lon0 = double(keys, key::ProjNatOriginLongGeoKey)
        .or_else(|| double(keys, key::ProjFalseProjOriginLongGeoKey))
        .or_else(|| double(keys, key::ProjCenterLongGeoKey))
        .or_else(|| double(keys, key::ProjStraightVertPoleLongGeoKey))
        .unwrap_or(0.0);
    let lat1 = double(keys, key::ProjStdParallel1GeoKey);
    let lat2 = double(keys, key::ProjStdParallel2GeoKey);
    let false_easting = double(keys, key::ProjFalseEastingGeoKey)
        .or_else(|| double(keys, PROJ_FALSE_ORIGIN_EASTING))
        .unwrap_or(0.0);
    let false_northing = double(keys, key::ProjFalseNorthingGeoKey)
        .or_else(|| double(keys, PROJ_FALSE_ORIGIN_NORTHING))
        .unwrap_or(0.0);
    let scale = double(keys, key::ProjScaleAtNatOriginGeoKey).unwrap_or(1.0);
    let parallel = |value: Option<f64>, what: &str| {
        value.ok_or_else(|| format!("the raster's projection lacks its {what}"))
    };
    let kind = match transformation {
        1 => ProjectionKind::TransverseMercator,
        7 => ProjectionKind::Mercator,
        8 => ProjectionKind::LambertConformalConic {
            lat1: parallel(lat1, "first standard parallel")?,
            lat2: Some(parallel(lat2, "second standard parallel")?),
        },
        9 => ProjectionKind::LambertConformalConic {
            lat1: lat1.unwrap_or(lat0),
            lat2: None,
        },
        10 => ProjectionKind::LambertAzimuthalEqualArea,
        11 => ProjectionKind::AlbersEqualAreaConic {
            lat1: parallel(lat1, "first standard parallel")?,
            lat2: parallel(lat2, "second standard parallel")?,
        },
        14 => ProjectionKind::Stereographic,
        16 => ProjectionKind::ObliqueStereographic,
        17 => ProjectionKind::Equirectangular {
            lat_ts: lat1.unwrap_or(0.0),
        },
        other => {
            return Err(format!(
                "GeoTIFF coordinate transformation {other} is not supported by the raster engine"
            ));
        }
    };
    let (ellipsoid, datum) = ellipsoid_of(keys)?;
    let params = ProjectionParams {
        kind,
        lon0,
        lat0,
        false_easting,
        false_northing,
        scale,
        ellipsoid,
        datum: datum.clone(),
    };
    let citation =
        ascii(keys, key::GTCitationGeoKey).or_else(|| ascii(keys, key::PCSCitationGeoKey));
    let name = citation
        .clone()
        .unwrap_or_else(|| "user-defined projected CRS".to_string());
    let crs = Crs::new(name, datum, params).map_err(|e| format!("unsupported projection: {e}"))?;
    // A citation naming a registry code the keys agree with is that code.
    if let Some(code) = citation
        .as_deref()
        .and_then(wbprojection::epsg_from_srs_reference)
        && wbprojection::identify_epsg_from_crs(&crs) == Some(code)
        && let Ok(resolved) = from_epsg(code)
    {
        return Ok(resolved);
    }
    Ok(ResolvedCrs::registry(crs.clone(), None, crs.to_wkt()))
}

/// The ellipsoid and datum of a user-defined CRS. An unknown datum is
/// treated as WGS84-equivalent with no shift, as GDAL treats it.
fn ellipsoid_of(keys: &GeoKeyDirectory) -> Result<(Ellipsoid, Datum), String> {
    if let Some(code) = registry_code(short(keys, key::GeographicTypeGeoKey)) {
        let geographic = Crs::from_epsg(code)
            .map_err(|e| format!("EPSG:{code} is not in the projection registry: {e}"))?;
        return Ok((geographic.datum.ellipsoid.clone(), geographic.datum));
    }
    let ellipsoid = match (
        double(keys, key::GeogSemiMajorAxisGeoKey),
        double(keys, key::GeogInvFlatteningGeoKey),
        double(keys, key::GeogSemiMinorAxisGeoKey),
    ) {
        (Some(a), Some(inv_f), _) if inv_f > 0.0 => {
            Ellipsoid::from_a_inv_f("user-defined", a, inv_f)
        }
        (Some(a), _, Some(b)) if b > 0.0 && a > b => {
            Ellipsoid::from_a_inv_f("user-defined", a, a / (a - b))
        }
        (Some(a), _, _) => Ellipsoid::from_a_inv_f("user-defined sphere", a, f64::INFINITY),
        _ => match short(keys, key::GeogEllipsoidGeoKey) {
            Some(7019) => Ellipsoid::GRS80,
            _ => Ellipsoid::WGS84,
        },
    };
    let datum = Datum {
        name: "unknown",
        ellipsoid: ellipsoid.clone(),
        transform: DatumTransform::None,
    };
    Ok((ellipsoid, datum))
}

fn entry(key_id: u16, value: GeoKeyValue) -> GeoKeyEntry {
    GeoKeyEntry { key_id, value }
}

fn short_entry(key_id: u16, value: u16) -> GeoKeyEntry {
    entry(key_id, GeoKeyValue::Short(value))
}

fn double_entry(key_id: u16, value: f64) -> GeoKeyEntry {
    entry(key_id, GeoKeyValue::Doubles(vec![value]))
}

/// The GeoTIFF keys that describe `resolved` in a written file.
pub(super) fn geokeys_for(resolved: &ResolvedCrs) -> Result<GeoKeyDirectory, String> {
    let projected = resolved.is_projected();
    let mut entries = vec![
        short_entry(key::GTModelTypeGeoKey, if projected { 1 } else { 2 }),
        short_entry(key::GTRasterTypeGeoKey, 1),
        entry(
            key::GTCitationGeoKey,
            GeoKeyValue::Ascii(resolved.crs.name.replace('|', " ")),
        ),
    ];
    if let Some(code) = resolved.epsg {
        let code = u16::try_from(code)
            .map_err(|_| format!("EPSG:{code} cannot be written as GeoTIFF keys"))?;
        if projected {
            entries.push(short_entry(key::ProjectedCSTypeGeoKey, code));
            entries.push(short_entry(key::ProjLinearUnitsGeoKey, 9001));
        } else {
            entries.push(short_entry(key::GeographicTypeGeoKey, code));
            entries.push(short_entry(key::GeogAngularUnitsGeoKey, 9102));
        }
    } else {
        entries.extend(user_defined_entries(resolved, projected)?);
    }
    entries.sort_by_key(|entry| entry.key_id);
    Ok(GeoKeyDirectory {
        version: 1,
        key_revision: 1,
        minor_revision: 0,
        entries,
    })
}

fn user_defined_entries(
    resolved: &ResolvedCrs,
    projected: bool,
) -> Result<Vec<GeoKeyEntry>, String> {
    let crs = &resolved.crs;
    let params = crs.projection.params();
    let ellipsoid = &params.ellipsoid;
    let mut entries = Vec::new();
    let wgs84 = (ellipsoid.a - Ellipsoid::WGS84.a).abs() < 1e-6
        && (ellipsoid.f - Ellipsoid::WGS84.f).abs() < 1e-12;
    if wgs84 {
        entries.push(short_entry(key::GeographicTypeGeoKey, 4326));
    } else {
        entries.push(short_entry(key::GeographicTypeGeoKey, USER_DEFINED));
        entries.push(short_entry(key::GeogGeodeticDatumGeoKey, USER_DEFINED));
        entries.push(short_entry(key::GeogEllipsoidGeoKey, USER_DEFINED));
        entries.push(double_entry(key::GeogSemiMajorAxisGeoKey, ellipsoid.a));
        if ellipsoid.f.abs() > 0.0 {
            entries.push(double_entry(
                key::GeogInvFlatteningGeoKey,
                1.0 / ellipsoid.f,
            ));
        } else {
            entries.push(double_entry(key::GeogSemiMinorAxisGeoKey, ellipsoid.b));
        }
    }
    entries.push(short_entry(key::GeogAngularUnitsGeoKey, 9102));
    if !projected {
        return Ok(entries);
    }
    entries.push(short_entry(key::ProjectedCSTypeGeoKey, USER_DEFINED));
    entries.push(short_entry(key::ProjectionGeoKey, USER_DEFINED));
    entries.push(short_entry(key::ProjLinearUnitsGeoKey, 9001));
    let natural_origin = |entries: &mut Vec<GeoKeyEntry>| {
        entries.push(double_entry(key::ProjNatOriginLatGeoKey, params.lat0));
        entries.push(double_entry(key::ProjNatOriginLongGeoKey, params.lon0));
        entries.push(double_entry(
            key::ProjFalseEastingGeoKey,
            params.false_easting,
        ));
        entries.push(double_entry(
            key::ProjFalseNorthingGeoKey,
            params.false_northing,
        ));
    };
    if let Some(OwnProjection::Laea(laea)) = resolved.own {
        entries.push(short_entry(key::ProjCoordTransGeoKey, 10));
        entries.push(double_entry(key::ProjCenterLatGeoKey, laea.lat0));
        entries.push(double_entry(key::ProjCenterLongGeoKey, laea.lon0));
        entries.push(double_entry(
            key::ProjFalseEastingGeoKey,
            laea.false_easting,
        ));
        entries.push(double_entry(
            key::ProjFalseNorthingGeoKey,
            laea.false_northing,
        ));
        return Ok(entries);
    }
    match &params.kind {
        ProjectionKind::TransverseMercator | ProjectionKind::Utm { .. } => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 1));
            entries.push(double_entry(key::ProjScaleAtNatOriginGeoKey, params.scale));
            natural_origin(&mut entries);
        }
        ProjectionKind::Mercator => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 7));
            entries.push(double_entry(key::ProjScaleAtNatOriginGeoKey, params.scale));
            natural_origin(&mut entries);
        }
        ProjectionKind::LambertConformalConic {
            lat1,
            lat2: Some(lat2),
        } => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 8));
            entries.push(double_entry(key::ProjStdParallel1GeoKey, *lat1));
            entries.push(double_entry(key::ProjStdParallel2GeoKey, *lat2));
            entries.push(double_entry(key::ProjFalseProjOriginLatGeoKey, params.lat0));
            entries.push(double_entry(
                key::ProjFalseProjOriginLongGeoKey,
                params.lon0,
            ));
            entries.push(double_entry(
                PROJ_FALSE_ORIGIN_EASTING,
                params.false_easting,
            ));
            entries.push(double_entry(
                PROJ_FALSE_ORIGIN_NORTHING,
                params.false_northing,
            ));
        }
        ProjectionKind::LambertConformalConic { lat1, lat2: None } => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 9));
            entries.push(double_entry(key::ProjStdParallel1GeoKey, *lat1));
            entries.push(double_entry(key::ProjScaleAtNatOriginGeoKey, params.scale));
            natural_origin(&mut entries);
        }
        ProjectionKind::LambertAzimuthalEqualArea => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 10));
            entries.push(double_entry(key::ProjCenterLatGeoKey, params.lat0));
            entries.push(double_entry(key::ProjCenterLongGeoKey, params.lon0));
            entries.push(double_entry(
                key::ProjFalseEastingGeoKey,
                params.false_easting,
            ));
            entries.push(double_entry(
                key::ProjFalseNorthingGeoKey,
                params.false_northing,
            ));
        }
        ProjectionKind::AlbersEqualAreaConic { lat1, lat2 } => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 11));
            entries.push(double_entry(key::ProjStdParallel1GeoKey, *lat1));
            entries.push(double_entry(key::ProjStdParallel2GeoKey, *lat2));
            natural_origin(&mut entries);
        }
        ProjectionKind::Stereographic => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 14));
            entries.push(double_entry(key::ProjScaleAtNatOriginGeoKey, params.scale));
            natural_origin(&mut entries);
        }
        ProjectionKind::ObliqueStereographic => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 16));
            entries.push(double_entry(key::ProjScaleAtNatOriginGeoKey, params.scale));
            natural_origin(&mut entries);
        }
        ProjectionKind::Equirectangular { lat_ts } => {
            entries.push(short_entry(key::ProjCoordTransGeoKey, 17));
            entries.push(double_entry(key::ProjStdParallel1GeoKey, *lat_ts));
            natural_origin(&mut entries);
        }
        other => {
            return Err(format!(
                "the projection {other:?} has no registry code and cannot be written as GeoTIFF keys"
            ));
        }
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lambert93_keys() -> GeoKeyDirectory {
        // The IGN LiDAR HD tiles: every key user-defined, the code only in the citation.
        GeoKeyDirectory {
            version: 1,
            key_revision: 1,
            minor_revision: 0,
            entries: vec![
                short_entry(key::GTModelTypeGeoKey, 1),
                short_entry(key::GTRasterTypeGeoKey, 1),
                entry(
                    key::GTCitationGeoKey,
                    GeoKeyValue::Ascii("EPSG:2154".into()),
                ),
                short_entry(key::GeographicTypeGeoKey, USER_DEFINED),
                short_entry(key::GeogGeodeticDatumGeoKey, USER_DEFINED),
                short_entry(key::GeogAngularUnitsGeoKey, 9102),
                short_entry(key::GeogEllipsoidGeoKey, USER_DEFINED),
                short_entry(key::ProjectedCSTypeGeoKey, USER_DEFINED),
                short_entry(key::ProjectionGeoKey, USER_DEFINED),
                short_entry(key::ProjCoordTransGeoKey, 8),
                short_entry(key::ProjLinearUnitsGeoKey, 9001),
                double_entry(key::ProjStdParallel1GeoKey, 49.0),
                double_entry(key::ProjStdParallel2GeoKey, 44.0),
                double_entry(key::ProjFalseProjOriginLongGeoKey, 3.0),
                double_entry(key::ProjFalseProjOriginLatGeoKey, 46.5),
                double_entry(PROJ_FALSE_ORIGIN_EASTING, 700_000.0),
                double_entry(PROJ_FALSE_ORIGIN_NORTHING, 6_600_000.0),
            ],
        }
    }

    #[test]
    fn epsg_references_resolve_and_their_wkt_round_trips_to_the_code() {
        for reference in ["EPSG:2154", "epsg:2154", "2154"] {
            let resolved = from_reference(reference).unwrap();
            assert_eq!(resolved.epsg, Some(2154), "{reference}");
            assert!(
                resolved.wkt.contains("AUTHORITY[\"EPSG\",\"2154\"]"),
                "{}",
                resolved.wkt
            );
            let again = from_reference(&resolved.wkt).unwrap();
            assert_eq!(again.epsg, Some(2154));
            assert_eq!(
                super::super::super::analyses::crs_class(&resolved.wkt),
                super::super::super::analyses::CRS_PROJECTED_METRE
            );
        }
        assert_eq!(
            super::super::super::analyses::crs_class(&from_epsg(4326).unwrap().wkt),
            super::super::super::analyses::CRS_GEOGRAPHIC
        );
        assert!(from_reference("").is_err());
        assert!(from_reference("EPSG:999999").is_err());
    }

    #[test]
    fn user_defined_lambert_keys_with_a_citation_resolve_to_the_registry_code() {
        let resolved = from_geokeys(&lambert93_keys()).unwrap().unwrap();
        assert_eq!(resolved.epsg, Some(2154));
        let (lon, lat) = resolved
            .crs
            .transform_to(700_000.0, 6_600_000.0, &Crs::from_epsg(4326).unwrap())
            .unwrap();
        assert!((lon - 3.0).abs() < 1e-9 && (lat - 46.5).abs() < 1e-9);
    }

    #[test]
    fn user_defined_lambert_keys_without_a_citation_keep_their_false_origin() {
        let mut keys = lambert93_keys();
        keys.entries
            .retain(|entry| entry.key_id != key::GTCitationGeoKey);
        let resolved = from_geokeys(&keys).unwrap().unwrap();
        assert_eq!(resolved.epsg, None);
        let (x, y) = resolved.crs.forward(3.0, 46.5).unwrap();
        assert!((x - 700_000.0).abs() < 1e-3 && (y - 6_600_000.0).abs() < 1e-3);
        // Its WKT re-parses to the same placement and keys re-read to it.
        let again = from_reference(&resolved.wkt).unwrap();
        let (x, y) = again.crs.forward(3.0, 46.5).unwrap();
        assert!((x - 700_000.0).abs() < 1e-3 && (y - 6_600_000.0).abs() < 1e-3);
        let written = geokeys_for(&resolved).unwrap();
        let reread = from_geokeys(&written).unwrap().unwrap();
        let (x, y) = reread.crs.forward(3.0, 46.5).unwrap();
        assert!((x - 700_000.0).abs() < 1e-3 && (y - 6_600_000.0).abs() < 1e-3);
    }

    /// GDAL's LV95 and LV03 coordinates of six points across Switzerland.
    #[test]
    fn the_swiss_grids_match_proj_to_the_millimetre() {
        let wgs84 = from_epsg(4326).unwrap();
        let cases = [
            (
                (7.438_632_42, 46.951_082_77),
                (2_600_000.000_5, 1_200_000.000_9),
            ),
            ((6.14, 46.2), (2_499_760.951_66, 1_117_336.097_86)),
            ((8.54, 47.37), (2_683_186.285_58, 1_247_156.744_09)),
            ((8.95, 46.0), (2_717_083.916_00, 1_095_398.664_11)),
            ((5.96, 45.82), (2_485_071.575_25, 1_075_346.305_28)),
            ((10.49, 47.81), (2_828_515.816_10, 1_299_941.786_44)),
        ];
        let lv95 = from_epsg(2056).unwrap();
        let lv03 = from_epsg(21781).unwrap();
        for ((lon, lat), (e, n)) in cases {
            let (x, y) = wgs84.transform_to(lon, lat, &lv95).unwrap();
            assert!(
                (x - e).abs() < 1e-3 && (y - n).abs() < 1e-3,
                "LV95 {lon} {lat}: {x} {y}"
            );
            let (x, y) = wgs84.transform_to(lon, lat, &lv03).unwrap();
            assert!(
                (x - (e - 2_000_000.0)).abs() < 1e-3 && (y - (n - 1_000_000.0)).abs() < 1e-3,
                "LV03 {lon} {lat}: {x} {y}"
            );
            // The crate's datum step closes to about 1e-8 deg (a millimetre).
            let (back_lon, back_lat) = lv95.transform_to(e, n, &wgs84).unwrap();
            assert!(
                (back_lon - lon).abs() < 1e-7 && (back_lat - lat).abs() < 1e-7,
                "round trip {lon} {lat}: {back_lon} {back_lat} ({:e}, {:e})",
                back_lon - lon,
                back_lat - lat
            );
        }
        assert!(lv95.is_projected());
        assert_eq!(
            super::super::super::analyses::crs_class(&lv95.wkt),
            super::super::super::analyses::CRS_PROJECTED_METRE
        );
        assert_eq!(from_reference(&lv95.wkt).unwrap().epsg, Some(2056));
    }

    /// GDAL's EPSG:3035 coordinates, through the registry definition.
    #[test]
    fn europe_laea_matches_proj_through_the_registry_code() {
        let wgs84 = from_epsg(4326).unwrap();
        let laea = from_epsg(3035).unwrap();
        let (x, y) = wgs84.transform_to(2.35, 48.85, &laea).unwrap();
        assert!(
            (x - 3_760_536.822_90).abs() < 1e-3 && (y - 2_888_771.020_95).abs() < 1e-3,
            "{x} {y}"
        );
        let (lon, lat) = laea.transform_to(x, y, &wgs84).unwrap();
        assert!((lon - 2.35).abs() < 1e-9 && (lat - 48.85).abs() < 1e-9);
        assert!(laea.is_projected());
        // A user-defined LAEA from keys takes the same route.
        let keys = geokeys_for(&ResolvedCrs::registry(
            Crs::from_epsg(3035).unwrap(),
            None,
            String::new(),
        ))
        .unwrap();
        let reread = from_geokeys(&keys).unwrap().unwrap();
        let (x2, y2) = wgs84.transform_to(2.35, 48.85, &reread).unwrap();
        assert!((x2 - x).abs() < 1e-6 && (y2 - y).abs() < 1e-6, "{x2} {y2}");
    }

    #[test]
    fn registry_codes_are_written_as_one_key_and_read_back() {
        for code in [2154u32, 3857, 4326, 32632, 2056, 3035] {
            let resolved = from_epsg(code).unwrap();
            let keys = geokeys_for(&resolved).unwrap();
            let reread = from_geokeys(&keys).unwrap().unwrap();
            assert_eq!(reread.epsg, Some(code));
        }
    }

    #[test]
    fn files_without_keys_have_no_crs_and_geocentric_ones_are_refused() {
        let empty = GeoKeyDirectory::default();
        assert!(from_geokeys(&empty).unwrap().is_none());
        let geocentric = GeoKeyDirectory {
            entries: vec![short_entry(key::GTModelTypeGeoKey, 3)],
            ..GeoKeyDirectory::default()
        };
        assert!(from_geokeys(&geocentric).is_err());
    }
}
