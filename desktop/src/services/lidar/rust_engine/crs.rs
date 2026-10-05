//! The one coordinate reference system authority (ADR 0014, U27, U31).
//!
//! Placement, extents, "Covers your site", hover, View coverage and the
//! display all transform through this module, on `proj4rs` over the rows of
//! `crs_table.rs`; nothing else in the app names a projection crate (a
//! policy test below). A CRS is referred to as canonical `EPSG:n`, the form
//! the catalogue stores; a GeoTIFF names it by code, or spells a row out key
//! by key. Every transform runs source → WGS84 longitude and latitude →
//! target, because Web Mercator carries no datum and a direct step to it
//! would skip the source's Helmert shift. Written files carry code keys
//! only. Every other system is refused with one message naming it and the
//! supported systems.
//!
//! Roadmap rule (A12): Whitebox tools read and write native coordinates
//! only, every longitude/latitude step goes through this module, and the
//! GeoLibre CLI's WGS84 GeoJSON is never trusted for placement.

use super::crs_table::{self, CrsKind, CrsRow};
use proj4rs::proj::Proj;
use proj4rs::transform::transform;
use wbgeotiff::geo_keys::{GeoKeyDirectory, GeoKeyEntry, GeoKeyValue, key};

/// One supported CRS: a row of the table.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct ResolvedCrs {
    row: &'static CrsRow,
}

impl ResolvedCrs {
    pub(super) fn code(&self) -> u32 {
        self.row.code
    }

    /// The canonical stored reference, `EPSG:n`.
    pub(super) fn reference(&self) -> String {
        format!("EPSG:{}", self.row.code)
    }

    pub(super) fn kind(&self) -> CrsKind {
        self.row.kind()
    }

    pub(super) fn is_projected(&self) -> bool {
        self.kind() == CrsKind::ProjectedMetre
    }

    fn proj(&self) -> Result<Proj, String> {
        Proj::from_proj_string(self.row.proj)
            .map_err(|e| format!("EPSG:{} cannot be read: {e}", self.row.code))
    }
}

/// Why a coordinate system is not placed: the one refusal (U31).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Unsupported {
    Code(u32),
    UserDefined,
    Geocentric,
}

impl std::fmt::Display for Unsupported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Unsupported::Code(code) => write!(f, "EPSG:{code}")?,
            Unsupported::UserDefined => f.write_str("The raster's user-defined system")?,
            Unsupported::Geocentric => f.write_str("A geocentric system")?,
        }
        write!(
            f,
            " is not a supported coordinate system. Canopi places LiDAR in {}.",
            crs_table::SUPPORTED_SUMMARY
        )
    }
}

fn refused(why: Unsupported) -> String {
    why.to_string()
}

/// Resolve a code, through the compound aliases.
fn from_code(code: u32) -> Result<ResolvedCrs, String> {
    crs_table::row_of(code)
        .map(|row| ResolvedCrs { row })
        .ok_or_else(|| refused(Unsupported::Code(code)))
}

/// Resolve a stored reference, `EPSG:n`.
pub(super) fn from_reference(reference: &str) -> Result<ResolvedCrs, String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() {
        return Err("no coordinate reference system was given".to_string());
    }
    let code = trimmed
        .get(..5)
        .filter(|prefix| prefix.eq_ignore_ascii_case("EPSG:"))
        .and_then(|_| trimmed[5..].parse::<u32>().ok())
        .ok_or_else(|| format!("{trimmed} is not an EPSG:n coordinate reference"))?;
    from_code(code)
}

/// Transforms between two rows, each through WGS84 longitude and latitude.
pub(super) struct Transformer {
    source: Step,
    target: Step,
    identity: bool,
}

/// One side of the hub: `None` when the side is WGS84 itself.
struct Step {
    proj: Option<Proj>,
    geographic: bool,
}

impl Step {
    fn of(crs: &ResolvedCrs) -> Result<Self, String> {
        Ok(Self {
            proj: (crs.code() != 4326).then(|| crs.proj()).transpose()?,
            geographic: crs.kind() == CrsKind::Geographic,
        })
    }
}

impl Transformer {
    pub(super) fn new(source: &ResolvedCrs, target: &ResolvedCrs) -> Result<Self, String> {
        Ok(Self {
            source: Step::of(source)?,
            target: Step::of(target)?,
            identity: source.code() == target.code(),
        })
    }

    /// One point; `Err` where a projection does not reach it.
    pub(super) fn apply(&self, x: f64, y: f64) -> Result<(f64, f64), String> {
        if self.identity {
            return Ok((x, y));
        }
        let wgs84 = wgs84()?;
        let (lon, lat) = match &self.source.proj {
            None => (x, y),
            Some(proj) => {
                let mut point = if self.source.geographic {
                    (x.to_radians(), y.to_radians(), 0.0)
                } else {
                    (x, y, 0.0)
                };
                transform(proj, &wgs84, &mut point).map_err(|e| e.to_string())?;
                (point.0.to_degrees(), point.1.to_degrees())
            }
        };
        match &self.target.proj {
            None => Ok((lon, lat)),
            Some(proj) => {
                let mut point = (lon.to_radians(), lat.to_radians(), 0.0);
                transform(&wgs84, proj, &mut point).map_err(|e| e.to_string())?;
                Ok(if self.target.geographic {
                    (point.0.to_degrees(), point.1.to_degrees())
                } else {
                    (point.0, point.1)
                })
            }
        }
    }
}

fn wgs84() -> Result<Proj, String> {
    from_code(4326)?.proj()
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

const USER_DEFINED: u16 = 32767;
/// Keys `wbgeotiff::geo_keys::key` does not name.
const GEOG_PRIME_MERIDIAN: u16 = 2051;
const GEOG_PRIME_MERIDIAN_LONG: u16 = 2061;
const PROJ_FALSE_ORIGIN_LONG: u16 = 3084;
const PROJ_FALSE_ORIGIN_LAT: u16 = 3085;
const PROJ_FALSE_ORIGIN_EASTING: u16 = 3086;
const PROJ_FALSE_ORIGIN_NORTHING: u16 = 3087;

fn registry_code(value: Option<u16>) -> Option<u32> {
    value
        .filter(|code| *code != USER_DEFINED && *code != 0)
        .map(u32::from)
}

/// Resolve the GeoTIFF keys of a file; `None` when the file declares no CRS.
///
/// A projected code names the row; keys spelling a projection out are
/// matched to a row; otherwise a geographic code names the row, whatever
/// the model type says (wbgeotiff keys every 4xxx code, such as RGM04 / UTM
/// 38S 4471, as geographic).
pub(super) fn from_geokeys(keys: &GeoKeyDirectory) -> Result<Option<ResolvedCrs>, String> {
    let model = short(keys, key::GTModelTypeGeoKey);
    if model == Some(3) {
        return Err(refused(Unsupported::Geocentric));
    }
    let projected = short(keys, key::ProjectedCSTypeGeoKey);
    if let Some(code) = registry_code(projected) {
        return from_code(code).map(Some);
    }
    if projected == Some(USER_DEFINED) || short(keys, key::ProjCoordTransGeoKey).is_some() {
        return user_defined(keys).map(Some);
    }
    if let Some(code) = registry_code(short(keys, key::GeographicTypeGeoKey)) {
        return from_code(code).map(Some);
    }
    match model {
        None => Ok(None),
        Some(_) => Err(refused(Unsupported::UserDefined)),
    }
}

/// The projection methods a user-defined key set can be matched on.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Method {
    TransverseMercator,
    /// Lambert conic, two standard parallels (unordered).
    Lambert2Sp {
        lat_1: f64,
        lat_2: f64,
    },
    /// Lambert conic, one standard parallel at the origin, with a scale.
    Lambert1Sp,
    LambertAzimuthal,
    ObliqueStereographic,
}

/// A projection's defining parameters, in degrees and metres.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Parameters {
    method: Method,
    lat_0: f64,
    lon_0: f64,
    k: f64,
    x_0: f64,
    y_0: f64,
}

const ANGLE_TOLERANCE_DEG: f64 = 1e-9;
const ORIGIN_TOLERANCE_M: f64 = 1e-3;
const SCALE_TOLERANCE: f64 = 1e-9;

impl Parameters {
    fn matches(&self, other: &Parameters) -> bool {
        let angle = |a: f64, b: f64| (a - b).abs() <= ANGLE_TOLERANCE_DEG;
        let method = match (self.method, other.method) {
            (
                Method::Lambert2Sp { lat_1, lat_2 },
                Method::Lambert2Sp {
                    lat_1: other_1,
                    lat_2: other_2,
                },
            ) => {
                (angle(lat_1, other_1) && angle(lat_2, other_2))
                    || (angle(lat_1, other_2) && angle(lat_2, other_1))
            }
            (a, b) => a == b,
        };
        method
            && angle(self.lat_0, other.lat_0)
            && angle(self.lon_0, other.lon_0)
            && (self.k - other.k).abs() <= SCALE_TOLERANCE
            && (self.x_0 - other.x_0).abs() <= ORIGIN_TOLERANCE_M
            && (self.y_0 - other.y_0).abs() <= ORIGIN_TOLERANCE_M
    }

    /// A row's parameters, read from its PROJ definition; `None` for a
    /// method keys are not matched on (Swiss, Krovak, Mercator, lon/lat).
    fn of_row(row: &CrsRow) -> Option<Self> {
        let terms: Vec<(&str, &str)> = row
            .proj
            .split_whitespace()
            .filter_map(|term| term.strip_prefix('+'))
            .map(|term| term.split_once('=').unwrap_or((term, "")))
            .collect();
        let text = |name: &str| terms.iter().find(|(n, _)| *n == name).map(|(_, v)| *v);
        let number = |name: &str| text(name).and_then(|value| value.parse::<f64>().ok());
        let mut parameters = Parameters {
            method: Method::TransverseMercator,
            lat_0: number("lat_0").unwrap_or(0.0),
            lon_0: number("lon_0").unwrap_or(0.0),
            k: number("k").unwrap_or(1.0),
            x_0: number("x_0").unwrap_or(0.0),
            y_0: number("y_0").unwrap_or(0.0),
        };
        match text("proj")? {
            "tmerc" | "etmerc" => {}
            "utm" => {
                let zone = number("zone")?;
                parameters.lon_0 = zone * 6.0 - 183.0;
                parameters.k = 0.9996;
                parameters.x_0 = 500_000.0;
                parameters.y_0 = if text("south").is_some() {
                    10_000_000.0
                } else {
                    0.0
                };
            }
            "lcc" => {
                let lat_1 = number("lat_1").unwrap_or(parameters.lat_0);
                parameters.method = match number("lat_2") {
                    Some(lat_2) if (lat_2 - lat_1).abs() > ANGLE_TOLERANCE_DEG => {
                        Method::Lambert2Sp { lat_1, lat_2 }
                    }
                    _ => Method::Lambert1Sp,
                };
            }
            "laea" => parameters.method = Method::LambertAzimuthal,
            "sterea" => parameters.method = Method::ObliqueStereographic,
            _ => return None,
        }
        Some(parameters)
    }

    /// The parameters a user-defined key set spells out.
    fn of_keys(keys: &GeoKeyDirectory) -> Option<Self> {
        let get = |ids: &[u16]| ids.iter().find_map(|id| double(keys, *id));
        let natural_lat = || get(&[key::ProjNatOriginLatGeoKey]).unwrap_or(0.0);
        let natural_lon = || get(&[key::ProjNatOriginLongGeoKey]).unwrap_or(0.0);
        let false_easting = || get(&[key::ProjFalseEastingGeoKey]).unwrap_or(0.0);
        let false_northing = || get(&[key::ProjFalseNorthingGeoKey]).unwrap_or(0.0);
        let scale = || get(&[key::ProjScaleAtNatOriginGeoKey]).unwrap_or(1.0);
        let parameters = match short(keys, key::ProjCoordTransGeoKey)? {
            1 => Parameters {
                method: Method::TransverseMercator,
                lat_0: natural_lat(),
                lon_0: natural_lon(),
                k: scale(),
                x_0: false_easting(),
                y_0: false_northing(),
            },
            8 => Parameters {
                method: Method::Lambert2Sp {
                    lat_1: get(&[key::ProjStdParallel1GeoKey])?,
                    lat_2: get(&[key::ProjStdParallel2GeoKey])?,
                },
                lat_0: get(&[PROJ_FALSE_ORIGIN_LAT, key::ProjNatOriginLatGeoKey]).unwrap_or(0.0),
                lon_0: get(&[PROJ_FALSE_ORIGIN_LONG, key::ProjNatOriginLongGeoKey]).unwrap_or(0.0),
                k: 1.0,
                x_0: get(&[PROJ_FALSE_ORIGIN_EASTING, key::ProjFalseEastingGeoKey]).unwrap_or(0.0),
                y_0: get(&[PROJ_FALSE_ORIGIN_NORTHING, key::ProjFalseNorthingGeoKey])
                    .unwrap_or(0.0),
            },
            9 => Parameters {
                method: Method::Lambert1Sp,
                lat_0: natural_lat(),
                lon_0: natural_lon(),
                k: scale(),
                x_0: false_easting(),
                y_0: false_northing(),
            },
            10 => Parameters {
                method: Method::LambertAzimuthal,
                lat_0: get(&[key::ProjCenterLatGeoKey, key::ProjNatOriginLatGeoKey]).unwrap_or(0.0),
                lon_0: get(&[key::ProjCenterLongGeoKey, key::ProjNatOriginLongGeoKey])
                    .unwrap_or(0.0),
                k: 1.0,
                x_0: false_easting(),
                y_0: false_northing(),
            },
            16 => Parameters {
                method: Method::ObliqueStereographic,
                lat_0: natural_lat(),
                lon_0: natural_lon(),
                k: scale(),
                x_0: false_easting(),
                y_0: false_northing(),
            },
            _ => return None,
        };
        Some(parameters)
    }
}

/// Semi-axes (a, b) of the EPSG ellipsoid codes the rows use.
fn ellipsoid_of_code(code: u16) -> Option<(f64, f64)> {
    let (a, inverse_flattening) = match code {
        7030 => (6_378_137.0, 298.257_223_563),
        7019 => (6_378_137.0, 298.257_222_101),
        7004 => (6_377_397.155, 299.152_812_8),
        7022 => (6_378_388.0, 297.0),
        7001 => (6_377_563.396, 299.324_964_6),
        7011 => (6_378_249.2, 293.466_021_293_626_9),
        _ => return None,
    };
    Some((a, a * (1.0 - 1.0 / inverse_flattening)))
}

/// The ellipsoid code of the EPSG geographic systems the rows sit on, as a
/// GeographicType key names them; Greenwich-based only.
fn ellipsoid_of_geographic(code: u32) -> Option<u16> {
    Some(match code {
        4326 => 7030,
        4258 | 4171 | 4121 => 7019,
        4289 | 4312 => 7004,
        4313 | 4181 => 7022,
        4277 => 7001,
        4275 => 7011,
        _ => return None,
    })
}

/// The ellipsoid a key set states, if any: `Some(None)` when it states one
/// Canopi cannot read, so no row can match.
fn stated_ellipsoid(keys: &GeoKeyDirectory) -> Option<Option<(f64, f64)>> {
    if let Some(code) = registry_code(short(keys, key::GeographicTypeGeoKey)) {
        return Some(ellipsoid_of_geographic(code).and_then(ellipsoid_of_code));
    }
    if let Some(a) = double(keys, key::GeogSemiMajorAxisGeoKey) {
        let b = match (
            double(keys, key::GeogInvFlatteningGeoKey),
            double(keys, key::GeogSemiMinorAxisGeoKey),
        ) {
            (Some(inverse), _) if inverse > 0.0 => a * (1.0 - 1.0 / inverse),
            (_, Some(b)) => b,
            _ => a,
        };
        return Some(Some((a, b)));
    }
    match short(keys, key::GeogEllipsoidGeoKey) {
        None | Some(USER_DEFINED) => None,
        Some(code) => Some(ellipsoid_of_code(code)),
    }
}

/// Match keys that spell a projection out to the first row they describe.
/// Units other than metres and degrees, another prime meridian, or an
/// ellipsoid that differs from the row's match nothing.
fn user_defined(keys: &GeoKeyDirectory) -> Result<ResolvedCrs, String> {
    let refusal = || refused(Unsupported::UserDefined);
    let unit_ok = |id: u16, expected: u16| {
        matches!(short(keys, id), None | Some(USER_DEFINED)) || short(keys, id) == Some(expected)
    };
    let greenwich = matches!(
        short(keys, GEOG_PRIME_MERIDIAN),
        None | Some(8901) | Some(USER_DEFINED)
    ) && double(keys, GEOG_PRIME_MERIDIAN_LONG).is_none_or(|lon| lon == 0.0);
    if !unit_ok(key::ProjLinearUnitsGeoKey, 9001)
        || !unit_ok(key::GeogAngularUnitsGeoKey, 9102)
        || !greenwich
    {
        return Err(refusal());
    }
    let parameters = Parameters::of_keys(keys).ok_or_else(refusal)?;
    let ellipsoid = stated_ellipsoid(keys);
    crs_table::ROWS
        .iter()
        .filter(|row| Parameters::of_row(row).is_some_and(|own| own.matches(&parameters)))
        .find(|row| match ellipsoid {
            None => true,
            Some(None) => false,
            Some(Some((a, b))) => Proj::from_proj_string(row.proj).is_ok_and(|proj| {
                let (row_a, row_b) = proj.ellipse_parameters();
                (row_a - a).abs() <= ORIGIN_TOLERANCE_M && (row_b - b).abs() <= ORIGIN_TOLERANCE_M
            }),
        })
        .map(|row| ResolvedCrs { row })
        .ok_or_else(refusal)
}

fn short_entry(key_id: u16, value: u16) -> GeoKeyEntry {
    GeoKeyEntry {
        key_id,
        value: GeoKeyValue::Short(value),
    }
}

/// The GeoTIFF keys of a written file: the code only.
pub(super) fn geokeys_for(resolved: &ResolvedCrs) -> Result<GeoKeyDirectory, String> {
    let code = u16::try_from(resolved.code())
        .map_err(|_| format!("EPSG:{} cannot be written as GeoTIFF keys", resolved.code()))?;
    let mut entries = vec![short_entry(key::GTRasterTypeGeoKey, 1)];
    if resolved.is_projected() {
        entries.push(short_entry(key::GTModelTypeGeoKey, 1));
        entries.push(short_entry(key::ProjectedCSTypeGeoKey, code));
        entries.push(short_entry(key::ProjLinearUnitsGeoKey, 9001));
    } else {
        entries.push(short_entry(key::GTModelTypeGeoKey, 2));
        entries.push(short_entry(key::GeographicTypeGeoKey, code));
        entries.push(short_entry(key::GeogAngularUnitsGeoKey, 9102));
    }
    entries.sort_by_key(|entry| entry.key_id);
    Ok(GeoKeyDirectory {
        version: 1,
        key_revision: 1,
        minor_revision: 0,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::super::crs_reference_points::REFERENCE_POINTS;
    use super::*;

    fn wgs84_crs() -> ResolvedCrs {
        from_code(4326).unwrap()
    }

    /// Each row against PROJ on its 3x3 reference grid, as a distance: within
    /// 1 cm of PROJ with the row's own Helmert shift, within the row's stated
    /// accuracy of PROJ's own operation, which no row puts beyond 10 m (U31),
    /// and back to the same longitude and latitude within 3e-8 deg (3 mm: a
    /// 2-D transform drops the ellipsoidal height a datum shift moves; 2.2e-8
    /// measured for the Greek Grid).
    #[test]
    fn every_row_matches_proj_on_its_reference_grid() {
        let mut worst: Vec<(u32, f64, f64)> = Vec::new();
        for row in crs_table::ROWS {
            let points: Vec<_> = REFERENCE_POINTS
                .iter()
                .filter(|point| point.0 == row.code)
                .collect();
            assert_eq!(points.len(), 9, "EPSG:{} has a reference grid", row.code);
            let crs = from_code(row.code).unwrap();
            let forward = Transformer::new(&wgs84_crs(), &crs).unwrap();
            let inverse = Transformer::new(&crs, &wgs84_crs()).unwrap();
            let geographic = crs.kind() == CrsKind::Geographic;
            // Degrees for a geographic row, as metres along a meridian.
            let scale = if geographic { 1.0 / 111_320.0 } else { 1.0 };
            let (mut by_row, mut by_code) = (0f64, 0f64);
            for (_, lon, lat, row_x, row_y, code_x, code_y) in points {
                let (x, y) = forward.apply(*lon, *lat).unwrap();
                by_row = by_row.max((x - row_x).hypot(y - row_y) / scale);
                by_code = by_code.max((x - code_x).hypot(y - code_y) / scale);
                let (back_lon, back_lat) = inverse.apply(x, y).unwrap();
                assert!(
                    (back_lon - lon).abs() <= 3e-8 && (back_lat - lat).abs() <= 3e-8,
                    "EPSG:{} inverse at {lon} {lat}: {back_lon} {back_lat}",
                    row.code
                );
            }
            assert!(
                by_row <= 0.01,
                "EPSG:{} is {by_row} m from PROJ with the same shift",
                row.code
            );
            assert!(
                row.accuracy_m <= 10.0,
                "EPSG:{} states {} m, beyond U31's 10 m",
                row.code,
                row.accuracy_m
            );
            assert!(
                by_code <= row.accuracy_m,
                "EPSG:{} is {by_code} m from PROJ's own operation",
                row.code
            );
            worst.push((row.code, by_row, by_code));
        }
        worst.sort_by(|a, b| b.2.total_cmp(&a.2));
        println!(
            "worst rows (code, same shift m, PROJ's operation m): {:?}",
            &worst[..8]
        );
    }

    /// The table's form, which proj4rs reads correctly: no `+pm` (ignored on
    /// the way through WGS84), no `+k_0` (proj4rs reads `+k`), a stated
    /// datum on every row but Web Mercator, which has none, and metres.
    #[test]
    fn rows_are_written_in_the_form_proj4rs_reads() {
        let mut codes = std::collections::HashSet::new();
        for row in crs_table::ROWS {
            assert!(codes.insert(row.code), "EPSG:{} is listed twice", row.code);
            let proj = row.proj;
            assert!(!proj.contains("+pm="), "EPSG:{}: {proj}", row.code);
            assert!(!proj.contains("+k_0="), "EPSG:{}: {proj}", row.code);
            let datum = proj.contains("+towgs84=") || proj.contains("+datum=WGS84");
            if row.code == 3857 {
                assert!(
                    !datum && proj.contains("+nadgrids=@null"),
                    "Web Mercator has no datum: {proj}"
                );
            } else {
                assert!(datum, "EPSG:{} states its datum: {proj}", row.code);
            }
            if row.kind() == CrsKind::ProjectedMetre {
                assert!(proj.contains("+units=m"), "EPSG:{}: {proj}", row.code);
            }
            assert!(Proj::from_proj_string(proj).is_ok(), "EPSG:{}", row.code);
            let [west, south, east, north] = row.area;
            assert!(west < east && south < north, "EPSG:{} area", row.code);
        }
        for (alias, to) in crs_table::ALIASES {
            assert!(crs_table::row_of(*alias).is_some_and(|row| row.code == *to));
        }
    }

    /// The refusal names every row: each code appears in the summary, or in
    /// a range it names (the CC zones and the UTM zones).
    #[test]
    fn the_refusal_names_the_supported_systems() {
        let message = refused(Unsupported::Code(2263));
        assert!(message.starts_with("EPSG:2263 is not a supported coordinate system."));
        let ranges = [(3942, 3950), (32601, 32660), (32701, 32760), (25828, 25838)];
        for (first, last) in ranges {
            assert!(message.contains(&format!("{first} to {last}")));
        }
        for row in crs_table::ROWS {
            let in_range = ranges
                .iter()
                .any(|(first, last)| (*first..=*last).contains(&row.code));
            assert!(
                in_range || message.contains(&row.code.to_string()),
                "the summary names EPSG:{}",
                row.code
            );
        }
    }

    #[test]
    fn references_resolve_only_as_epsg_codes_of_the_table() {
        for reference in ["EPSG:2154", "epsg:2154", " EPSG:2154 "] {
            assert_eq!(from_reference(reference).unwrap().code(), 2154);
        }
        assert_eq!(
            from_reference("EPSG:7415").unwrap().reference(),
            "EPSG:28992"
        );
        assert!(from_reference("").is_err());
        assert!(from_reference("2154").is_err());
        assert!(
            from_reference("PROJCS[\"RGF93 v1 / Lambert-93\"]")
                .unwrap_err()
                .contains("not an EPSG:n")
        );
        assert!(
            from_reference("EPSG:999999")
                .unwrap_err()
                .contains("EPSG:999999 is not a supported")
        );
    }

    #[test]
    fn written_keys_are_code_keys_and_read_back_to_the_row() {
        for code in [2154u32, 3857, 4326, 32632, 2056, 3035, 4471, 28992] {
            let resolved = from_code(code).unwrap();
            let keys = geokeys_for(&resolved).unwrap();
            assert!(
                keys.entries
                    .iter()
                    .all(|entry| matches!(entry.value, GeoKeyValue::Short(_))),
                "EPSG:{code} writes shorts only"
            );
            assert_eq!(from_geokeys(&keys).unwrap().unwrap().code(), code);
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
        assert!(
            from_geokeys(&geocentric)
                .unwrap_err()
                .starts_with("A geocentric system is not a supported coordinate system")
        );
    }

    /// User-defined keys in feet match no row, whatever the projection.
    #[test]
    fn user_defined_keys_in_feet_are_refused() {
        let keys = GeoKeyDirectory {
            entries: vec![
                short_entry(key::GTModelTypeGeoKey, 1),
                short_entry(key::ProjectedCSTypeGeoKey, USER_DEFINED),
                short_entry(key::ProjCoordTransGeoKey, 1),
                short_entry(key::ProjLinearUnitsGeoKey, 9002),
            ],
            ..GeoKeyDirectory::default()
        };
        assert!(
            from_geokeys(&keys)
                .unwrap_err()
                .starts_with("The raster's user-defined system")
        );
    }

    /// A12: only this module names a projection crate, and wbprojection is
    /// not a dependency of the app.
    #[test]
    fn only_the_crs_authority_names_a_projection_crate() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let this = root.join("src/services/lidar/rust_engine/crs.rs");
        let mut stack = vec![root.join("src")];
        let mut offenders = Vec::new();
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|ext| ext == "rs") && path != this {
                    let text = std::fs::read_to_string(&path).unwrap();
                    if [
                        "proj4rs::",
                        "wbprojection::",
                        "use proj4rs",
                        "use wbprojection",
                    ]
                    .iter()
                    .any(|name| text.contains(name))
                    {
                        offenders.push(path.display().to_string());
                    }
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "projection crates named in {offenders:?}"
        );
        let manifest = std::fs::read_to_string(root.join("Cargo.toml")).unwrap();
        assert!(
            !manifest
                .lines()
                .any(|line| line.trim_start().starts_with("wbprojection")),
            "wbprojection is a dependency"
        );
        assert!(manifest.contains("proj4rs = { version = \"=0.2.0\""));
    }
}
