//! Coordinate reference systems for the raster engine.
//!
//! A CRS reaches the engine as `EPSG:n`, as WKT (the catalogue's stored
//! form), as GeoTIFF keys or as the PROJ string of another raster format.
//! Every route resolves to one [`ResolvedCrs`]: a PROJ definition `proj4rs`
//! transforms through, the WKT the catalogue stores and the name written as
//! the GeoTIFF citation. A registry code takes its definition and WKT from
//! `crs-definitions` and is preferred whenever the source names one; a code
//! whose definition `proj4rs` cannot read is refused by name, never
//! approximated. `wbprojection` only reads WKT that names no code, identifies
//! codes and gives areas of use (ADR 0014).

use proj4rs::Proj;
use wbgeotiff::geo_keys::{GeoKeyDirectory, GeoKeyEntry, GeoKeyValue, key};
use wbprojection::{Crs, Datum, DatumTransform, Ellipsoid, ProjectionKind, ProjectionParams};

/// One horizontal CRS the engine can transform through and write.
#[derive(Debug, Clone)]
pub(super) struct ResolvedCrs {
    pub epsg: Option<u32>,
    /// WKT the catalogue stores; resolving it again yields the same CRS.
    pub wkt: String,
    /// The name written as the GeoTIFF citation.
    name: String,
    /// The normalised PROJ definition `proj` was read from.
    definition: String,
    proj: Proj,
    /// A CRS with no registry code, as GeoTIFF keys spell it out.
    user: Option<ProjectionParams>,
}

impl ResolvedCrs {
    pub(super) fn is_projected(&self) -> bool {
        !self.proj.is_latlong()
    }

    /// Transform one point into `target`: degrees in a geographic CRS, the
    /// CRS's own linear unit in a projected one.
    pub(super) fn transform_to(
        &self,
        x: f64,
        y: f64,
        target: &ResolvedCrs,
    ) -> Result<(f64, f64), String> {
        let mut point = if self.proj.is_latlong() {
            (x.to_radians(), y.to_radians(), 0.0)
        } else {
            (x, y, 0.0)
        };
        proj4rs::transform::transform(&self.proj, &target.proj, &mut point)
            .map_err(|e| e.to_string())?;
        Ok(if target.proj.is_latlong() {
            (point.0.to_degrees(), point.1.to_degrees())
        } else {
            (point.0, point.1)
        })
    }
}

/// The prime meridians the registry's definitions name, in degrees east of
/// Greenwich as EPSG defines them: PROJ and proj4rs 0.2.0 keep an older
/// Madrid (3°41'16.58" W, 48 m west of EPSG's) and proj4rs an older
/// Copenhagen, while PROJ places EPSG:2062 at EPSG's Madrid.
const PRIME_MERIDIANS: [(&str, f64); 14] = [
    ("greenwich", 0.0),
    ("lisbon", -9.131_906_111_111),
    ("paris", 2.337_229_166_667),
    ("bogota", -74.080_916_666_667),
    ("madrid", -3.687_375),
    ("rome", 12.452_333_333_333),
    ("bern", 7.439_583_333_333),
    ("jakarta", 106.807_719_444_444),
    ("ferro", -17.666_666_666_667),
    ("brussels", 4.367_975),
    ("stockholm", 18.058_277_777_778),
    ("athens", 23.716_337_5),
    ("oslo", 10.722_916_666_667),
    ("copenhagen", 12.577_875),
];

/// A PROJ string as proj4rs 0.2.0 reads it right, with its prime meridian.
///
/// That release reads the scale factor only as `+k` or `+k0` (`proj.rs`), so
/// `+k_0` would silently fall back to 1, and it adds `+pm`, held in degrees,
/// to longitudes in radians (`transform.rs`, `prime_meridian`). `+k_0`
/// becomes `+k` and the meridian folds into `+lon_0`; without both, 323 EPSG
/// definitions (the NTF Lambert zones, EOV, the Paris, Madrid and Ferro
/// grids) are placed wrong. Goes when proj4rs fixes both upstream.
fn normalise(definition: &str) -> Result<(String, f64), String> {
    let mut prime_meridian = 0.0;
    let mut terms = Vec::new();
    for term in definition.split_whitespace() {
        if let Some(value) = term.strip_prefix("+k_0=") {
            terms.push(format!("+k={value}"));
        } else if let Some(value) = term.strip_prefix("+pm=") {
            prime_meridian = PRIME_MERIDIANS
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(value))
                .map(|(_, degrees)| *degrees)
                .or_else(|| value.parse().ok())
                .ok_or_else(|| format!("unknown prime meridian {value}"))?;
        } else {
            terms.push(term.to_string());
        }
    }
    if prime_meridian != 0.0 {
        match terms.iter_mut().find(|term| term.starts_with("+lon_0=")) {
            Some(term) => {
                let lon0: f64 = term["+lon_0=".len()..]
                    .parse()
                    .map_err(|_| format!("unreadable {term}"))?;
                *term = format!("+lon_0={}", lon0 + prime_meridian);
            }
            None => terms.push(format!("+lon_0={prime_meridian}")),
        }
    }
    Ok((terms.join(" "), prime_meridian))
}

/// The value of one `+name=` term of a PROJ definition.
fn term<'a>(definition: &'a str, name: &str) -> Option<&'a str> {
    definition
        .split_whitespace()
        .find_map(|term| term.strip_prefix(name))
}

/// Read a PROJ definition: a geocentric CRS, a geographic one on another
/// meridian than Greenwich (proj4rs ignores its `+pm`) and a polar LAEA
/// (proj4rs fails every ellipsoidal south-polar point) are refused (U24).
fn parse(definition: &str) -> Result<(String, Proj), String> {
    let (normalised, prime_meridian) = normalise(definition)?;
    let proj = Proj::from_proj_string(&normalised).map_err(|e| e.to_string())?;
    if proj.is_geocent() {
        return Err("a geocentric CRS".to_string());
    }
    if proj.is_latlong() && prime_meridian != 0.0 {
        return Err(OTHER_MERIDIAN.to_string());
    }
    let polar = term(&normalised, "+lat_0=")
        .and_then(|lat0| lat0.parse::<f64>().ok())
        .is_some_and(|lat0| lat0.abs() == 90.0);
    if term(&normalised, "+proj=") == Some("laea") && polar {
        return Err("a polar Lambert azimuthal equal-area CRS".to_string());
    }
    Ok((normalised, proj))
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
    // A WKT names its own code at the top. A nested node's code is a
    // datum's, a unit's or a parameter's, and identification by parameters
    // misreads hundreds of codes, so a WKT naming no code the registry has is
    // read as it is spelled.
    let stored = |resolved: ResolvedCrs| ResolvedCrs {
        wkt: trimmed.to_string(),
        ..resolved
    };
    let nodes = wkt_nodes(trimmed);
    if let Some(code) = own_code(&nodes) {
        return from_epsg(code).map(stored);
    }
    if let Some(definition) = proj4_extension(&nodes) {
        return from_proj4(definition).map(stored);
    }
    let crs = Crs::from_wkt(trimmed).map_err(|e| format!("unsupported CRS WKT: {e}"))?;
    let params = crs.projection.params();
    // wbprojection reads the projection in metres from Greenwich, as its keys
    // are written back (a projected CRS's meridian goes into its central
    // meridian), while the raster's coordinates keep the WKT's own unit and a
    // geographic CRS's longitudes their own meridian.
    // The last unit node is the CRS's own (the geographic base's comes first).
    let number = |keywords: [&str; 2]| {
        let node = nodes
            .iter()
            .rfind(|node| keywords.contains(&node.keyword))?;
        node.numbers().first().copied()
    };
    let geographic = matches!(params.kind, ProjectionKind::Geographic);
    if geographic && number(["PRIMEM", "PRIMEMERIDIAN"]).is_some_and(|pm| pm != 0.0) {
        return Err(not_supported(OTHER_MERIDIAN));
    }
    if !geographic && number(["UNIT", "LENGTHUNIT"]).is_some_and(|unit| unit != 1.0) {
        return Err(not_supported(OTHER_UNIT));
    }
    user_defined(
        params.clone(),
        wkt_shift(&nodes).or_else(|| geographic_shift(&nodes)),
        crs.name.clone(),
        trimmed.to_string(),
    )
}

fn definition_of(code: u32) -> Option<crs_definitions::Def> {
    u16::try_from(code)
        .ok()
        .and_then(crs_definitions::from_code)
}

/// The codes whose `crs-definitions` definition drops the south-west axis
/// PROJ gives them (every code checked against `projinfo`); without it a
/// tile lands 2,400 km away with its axes negated and swapped.
const SOUTH_WEST_AXIS: [u32; 2] = [2065, 5513];

/// Resolve a registry code.
pub(super) fn from_epsg(code: u32) -> Result<ResolvedCrs, String> {
    let unsupported = || format!("EPSG:{code} is not supported");
    let def = definition_of(code).ok_or_else(unsupported)?;
    let axis = if SOUTH_WEST_AXIS.contains(&code) {
        " +axis=swu"
    } else {
        ""
    };
    let (definition, proj) = parse(&format!("{}{axis}", def.proj4)).map_err(|_| unsupported())?;
    Ok(ResolvedCrs {
        epsg: Some(code),
        wkt: with_authority(def.wkt, code),
        name: def
            .wkt
            .split('"')
            .nth(1)
            .map_or_else(|| format!("EPSG:{code}"), str::to_string),
        definition,
        proj,
        user: None,
    })
}

/// Resolve the PROJ string another raster format carries; `wbprojection`
/// reads the normalised string for the projection the keys written back
/// spell out. Keys spell a user-defined CRS in metres, and only the
/// projections `projection_terms` names, so a string in another linear unit
/// or projection is refused here rather than when its keys are written.
pub(super) fn from_proj4(definition: &str) -> Result<ResolvedCrs, String> {
    let unsupported = |e: String| format!("unsupported PROJ definition: {e}");
    let (definition, proj) = parse(definition).map_err(unsupported)?;
    if !proj.is_latlong() && proj.to_meter() != 1.0 {
        return Err(unsupported(OTHER_UNIT.to_string()));
    }
    let crs =
        wbprojection::from_proj_string(&definition).map_err(|e| unsupported(e.to_string()))?;
    projection_terms(crs.projection.params()).map_err(unsupported)?;
    Ok(ResolvedCrs {
        epsg: None,
        wkt: with_definition(&crs.to_wkt(), &definition),
        name: crs.name.clone(),
        definition,
        proj,
        user: Some(crs.projection.params().clone()),
    })
}

/// Why a CRS with no registry code in another linear unit is refused: its
/// keys are written back in metres.
const OTHER_UNIT: &str = "a linear unit other than the metre";

/// Why a geographic CRS on another meridian is refused: proj4rs ignores its
/// `+pm`, and keys spell a CRS with no code from Greenwich.
const OTHER_MERIDIAN: &str = "a prime meridian other than Greenwich";

fn not_supported(reason: &str) -> String {
    format!("the raster's coordinate system is not supported: {reason}")
}

/// A CRS with no registry code: its projection, ellipsoid and datum shift.
fn user_defined(
    params: ProjectionParams,
    shift: Option<Vec<f64>>,
    name: String,
    wkt: String,
) -> Result<ResolvedCrs, String> {
    let ellipsoid = &params.ellipsoid;
    let mut definition = format!(
        "{} +a={} +b={}",
        projection_terms(&params)?,
        ellipsoid.a,
        ellipsoid.b
    );
    if let Some(shift) = &shift {
        definition.push_str(&format!(" +towgs84={}", list(shift)));
    }
    let (definition, proj) = parse(&definition).map_err(|e| not_supported(&e))?;
    Ok(ResolvedCrs {
        epsg: None,
        wkt: with_definition(&wkt, &definition),
        name,
        definition,
        proj,
        user: Some(params),
    })
}

/// The PROJ terms of a user-defined projection, for the kinds GeoTIFF keys
/// and WKT without a code spell out.
fn projection_terms(params: &ProjectionParams) -> Result<String, String> {
    let origin = format!(
        "+lat_0={} +lon_0={} +x_0={} +y_0={}",
        params.lat0, params.lon0, params.false_easting, params.false_northing
    );
    let k = params.scale;
    Ok(match &params.kind {
        ProjectionKind::Geographic => "+proj=longlat".to_string(),
        ProjectionKind::TransverseMercator => format!("+proj=tmerc +k={k} {origin}"),
        ProjectionKind::Utm { zone, south } => {
            format!(
                "+proj=utm +zone={zone}{}",
                if *south { " +south" } else { "" }
            )
        }
        ProjectionKind::Mercator => format!("+proj=merc +k={k} {origin}"),
        ProjectionKind::LambertConformalConic {
            lat1,
            lat2: Some(lat2),
        } => format!("+proj=lcc +lat_1={lat1} +lat_2={lat2} {origin}"),
        ProjectionKind::LambertConformalConic { lat1, lat2: None } => {
            format!("+proj=lcc +lat_1={lat1} +k={k} {origin}")
        }
        ProjectionKind::LambertAzimuthalEqualArea => format!("+proj=laea {origin}"),
        ProjectionKind::AlbersEqualAreaConic { lat1, lat2 } => {
            format!("+proj=aea +lat_1={lat1} +lat_2={lat2} {origin}")
        }
        ProjectionKind::Stereographic => format!("+proj=stere +k={k} {origin}"),
        ProjectionKind::ObliqueStereographic => format!("+proj=sterea +k={k} {origin}"),
        ProjectionKind::Equirectangular { lat_ts } => {
            format!("+proj=eqc +lat_ts={lat_ts} {origin}")
        }
        other => return Err(format!("the projection {other:?} is not supported")),
    })
}

fn list(values: &[f64]) -> String {
    values
        .iter()
        .map(f64::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// The Helmert shifts of proj4rs 0.2.0's named datums (`datums.rs`); WGS84
/// and NAD83 shift nothing and NAD27 needs grids proj4rs refuses.
const NAMED_SHIFTS: [(&str, &[f64]); 14] = [
    ("GGRS87", &[-199.87, 74.79, 246.62]),
    ("potsdam", &[598.1, 73.7, 418.2, 0.202, 0.045, -2.455, 6.7]),
    ("carthage", &[-263.0, 6.0, 431.0]),
    (
        "hermannskogel",
        &[577.326, 90.129, 463.919, 5.137, 1.474, 5.297, 2.4232],
    ),
    (
        "ire65",
        &[482.530, -130.596, 564.557, -1.042, -0.214, -0.631, 8.15],
    ),
    (
        "nzgd49",
        &[59.47, -5.04, 187.44, 0.47, -0.1, 1.024, -4.5993],
    ),
    (
        "OSGB36",
        &[446.448, -125.157, 542.060, 0.1502, 0.2470, 0.8421, -20.4894],
    ),
    ("ch1903", &[674.374, 15.056, 405.346]),
    (
        "osni52",
        &[482.530, -130.596, 564.557, -1.042, -0.214, -0.631, 8.15],
    ),
    ("rassadiran", &[-133.63, -157.5, -158.62]),
    ("s_jtsk", &[589.0, 76.0, 480.0]),
    ("beduaram", &[-106.0, -87.0, 188.0]),
    ("gunung_segara", &[-403.0, 684.0, 41.0]),
    (
        "rnb72",
        &[
            106.869, -52.2978, 103.724, -0.33657, 0.456955, -1.84218, 1.0,
        ],
    ),
];

/// The Helmert shift to WGS84 of a PROJ definition, `None` when it shifts
/// nothing: its `+towgs84`, or its named datum's.
fn datum_shift(definition: &str) -> Option<Vec<f64>> {
    let shift: Vec<f64> = match term(definition, "+towgs84=") {
        Some(values) => values
            .split(',')
            .map(|value| value.trim().parse().ok())
            .collect::<Option<_>>()?,
        None => {
            let datum = term(definition, "+datum=")?;
            NAMED_SHIFTS
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(datum))?
                .1
                .to_vec()
        }
    };
    shift.iter().any(|value| *value != 0.0).then_some(shift)
}

/// One node of a WKT: its keyword, the keywords of the nodes it sits in
/// (outermost first) and its text between the brackets.
struct WktNode<'a> {
    parents: Vec<&'a str>,
    keyword: &'a str,
    body: &'a str,
}

impl WktNode<'_> {
    /// The values that read as numbers: not its name nor a nested node's code.
    fn numbers(&self) -> Vec<f64> {
        self.body
            .split(',')
            .filter_map(|value| value.trim().parse().ok())
            .collect()
    }

    /// The code an `AUTHORITY["EPSG","n"]` (WKT1) or `ID["EPSG",n]` (WKT2)
    /// node names.
    fn epsg(&self) -> Option<u32> {
        if self.keyword != "AUTHORITY" && self.keyword != "ID" {
            return None;
        }
        let mut values = self
            .body
            .split(',')
            .map(|value| value.trim().trim_matches('"'));
        (values.next() == Some("EPSG"))
            .then(|| values.next()?.parse().ok())
            .flatten()
    }
}

/// Every node of a WKT, in the order they open.
fn wkt_nodes(wkt: &str) -> Vec<WktNode<'_>> {
    let mut nodes: Vec<WktNode> = Vec::new();
    let mut open: Vec<(usize, usize)> = Vec::new();
    let mut quoted = false;
    for (index, ch) in wkt.char_indices() {
        match ch {
            '"' => quoted = !quoted,
            '[' if !quoted => {
                let keyword = wkt[..index].rsplit([',', '[']).next().unwrap_or("").trim();
                let parents = open.iter().map(|(node, _)| nodes[*node].keyword).collect();
                open.push((nodes.len(), index + 1));
                nodes.push(WktNode {
                    parents,
                    keyword,
                    body: "",
                });
            }
            ']' if !quoted => {
                if let Some((node, start)) = open.pop() {
                    nodes[node].body = &wkt[start..index];
                }
            }
            _ => {}
        }
    }
    nodes
}

/// The shift a WKT's `TOWGS84` node gives, `None` when it shifts nothing.
fn wkt_shift(nodes: &[WktNode]) -> Option<Vec<f64>> {
    let shift = nodes
        .iter()
        .find(|node| node.keyword == "TOWGS84")?
        .numbers();
    shift.iter().any(|value| *value != 0.0).then_some(shift)
}

/// `wkt` carrying the PROJ definition it was resolved through, as GDAL's
/// `EXTENSION["PROJ4",..]` node: wbprojection's WKT writer drops the scale
/// of a one-parallel Lambert, a named datum's ellipsoid and the datum shift,
/// so a CRS with no registry code resolves again through the definition.
fn with_definition(wkt: &str, definition: &str) -> String {
    match wkt.trim_end().strip_suffix(']') {
        Some(body) => format!("{body},EXTENSION[\"PROJ4\",\"{definition}\"]]"),
        None => wkt.to_string(),
    }
}

/// The shift of the registry geographic CRS a WKT names inside it, as
/// `datum_of` takes it for keys: GDAL 3 writes WKT1 without TOWGS84.
fn geographic_shift(nodes: &[WktNode]) -> Option<Vec<f64>> {
    let code = nodes
        .iter()
        .filter(|node| {
            node.parents.last().is_some_and(|parent| {
                matches!(
                    *parent,
                    "GEOGCS" | "GEOGCRS" | "BASEGEOGCRS" | "GEODCRS" | "BASEGEODCRS"
                )
            })
        })
        .find_map(WktNode::epsg)?;
    datum_shift(&from_epsg(code).ok()?.definition)
}

/// The PROJ definition a WKT's `EXTENSION["PROJ4",..]` node carries.
fn proj4_extension<'a>(nodes: &[WktNode<'a>]) -> Option<&'a str> {
    let extension = nodes.iter().find(|node| node.keyword == "EXTENSION")?;
    Some(
        extension
            .body
            .strip_prefix("\"PROJ4\",")?
            .trim()
            .trim_matches('"'),
    )
}

/// The registry code a WKT names for itself, not a nested node's: its
/// root's, or else a compound CRS's horizontal part's.
fn own_code(nodes: &[WktNode]) -> Option<u32> {
    nodes
        .iter()
        .filter(|node| match node.parents.as_slice() {
            [_] => true,
            [root, part] => {
                matches!(*root, "COMPD_CS" | "COMPOUNDCRS")
                    && matches!(
                        *part,
                        "PROJCS" | "GEOGCS" | "PROJCRS" | "GEOGCRS" | "GEODCRS"
                    )
            }
            _ => false,
        })
        .filter_map(|node| {
            let code = node.epsg().filter(|code| definition_of(*code).is_some())?;
            Some((node.parents.len(), code))
        })
        .min()
        .map(|(_, code)| code)
}

/// WKT with the authority node GDAL and the parser both key on, so a
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
/// Keys `wbgeotiff::geo_keys::key` does not name: the false origin of conic
/// projections and the datum shift to WGS84.
const PROJ_FALSE_ORIGIN_EASTING: u16 = 3086;
const PROJ_FALSE_ORIGIN_NORTHING: u16 = 3087;
const GEOG_TOWGS84: u16 = 2062;

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
            let (datum, shift) = datum_of(keys)?;
            let params = ProjectionParams {
                kind: ProjectionKind::Geographic,
                ellipsoid: datum.ellipsoid.clone(),
                datum: datum.clone(),
                ..ProjectionParams::default()
            };
            let name = ascii(keys, key::GTCitationGeoKey)
                .or_else(|| ascii(keys, key::GeogCitationGeoKey))
                .unwrap_or_else(|| "user-defined geographic CRS".to_string());
            let crs = Crs::new(name.clone(), datum, params.clone())
                .map_err(|e| format!("unsupported geographic CRS: {e}"))?;
            user_defined(params, shift, name, crs.to_wkt()).map(Some)
        }
        Some(3) => Err("geocentric rasters are not supported".to_string()),
        None => Ok(None),
        Some(other) => Err(format!("GeoTIFF model type {other} is not supported")),
    }
}

/// A projected CRS spelled out key by key (no registry code), in metres.
fn user_defined_projected(keys: &GeoKeyDirectory) -> Result<ResolvedCrs, String> {
    if short(keys, key::ProjLinearUnitsGeoKey).is_some_and(|unit| unit != 9001) {
        return Err(not_supported(OTHER_UNIT));
    }
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
    let (datum, shift) = datum_of(keys)?;
    let params = ProjectionParams {
        kind,
        lon0,
        lat0,
        false_easting,
        false_northing,
        scale,
        ellipsoid: datum.ellipsoid.clone(),
        datum: datum.clone(),
    };
    let citation =
        ascii(keys, key::GTCitationGeoKey).or_else(|| ascii(keys, key::PCSCitationGeoKey));
    let name = citation
        .clone()
        .unwrap_or_else(|| "user-defined projected CRS".to_string());
    let crs = Crs::new(name.clone(), datum, params.clone())
        .map_err(|e| format!("unsupported projection: {e}"))?;
    // A citation naming a registry code the keys agree with is that code.
    if let Some(code) = citation
        .as_deref()
        .and_then(wbprojection::epsg_from_srs_reference)
        && wbprojection::identify_epsg_from_crs(&crs) == Some(code)
        && let Ok(resolved) = from_epsg(code)
    {
        return Ok(resolved);
    }
    user_defined(params, shift, name, crs.to_wkt())
}

/// The datum of a user-defined CRS and its shift to WGS84: a registry
/// geographic code's own, or the keys' ellipsoid, shifted only by a
/// `GeogTOWGS84GeoKey`. An unknown datum shifts nothing, as GDAL treats it.
fn datum_of(keys: &GeoKeyDirectory) -> Result<(Datum, Option<Vec<f64>>), String> {
    if short(keys, key::GeogPrimeMeridianGeoKey).is_some_and(|meridian| meridian != 8901) {
        return Err(not_supported(OTHER_MERIDIAN));
    }
    let written = match keys.get(GEOG_TOWGS84) {
        Some(GeoKeyValue::Doubles(values)) if values.iter().any(|value| *value != 0.0) => {
            Some(values.clone())
        }
        _ => None,
    };
    let datum = |ellipsoid: Ellipsoid| Datum {
        name: "unknown",
        ellipsoid,
        transform: DatumTransform::None,
    };
    let ellipsoid = |a: f64, inverse_flattening: f64| {
        Ellipsoid::from_a_inv_f("user-defined", a, inverse_flattening)
    };
    if let Some(code) = registry_code(short(keys, key::GeographicTypeGeoKey)) {
        let geographic = from_epsg(code)?;
        let (a, b) = geographic.proj.ellipse_parameters();
        let inverse_flattening = if a > b { a / (a - b) } else { f64::INFINITY };
        let shift = written.or_else(|| datum_shift(&geographic.definition));
        return Ok((datum(ellipsoid(a, inverse_flattening)), shift));
    }
    let keyed = match (
        double(keys, key::GeogSemiMajorAxisGeoKey),
        double(keys, key::GeogInvFlatteningGeoKey),
        double(keys, key::GeogSemiMinorAxisGeoKey),
    ) {
        (Some(a), Some(inv_f), _) if inv_f > 0.0 => ellipsoid(a, inv_f),
        (Some(a), _, Some(b)) if b > 0.0 && a > b => ellipsoid(a, a / (a - b)),
        (Some(a), _, _) => ellipsoid(a, f64::INFINITY),
        _ => match short(keys, key::GeogEllipsoidGeoKey) {
            Some(7019) => Ellipsoid::GRS80,
            _ => Ellipsoid::WGS84,
        },
    };
    Ok((datum(keyed), written))
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

/// The GeoTIFF unit code of a projected CRS's linear unit: metre, foot or
/// US survey foot.
fn linear_unit(proj: &Proj) -> Option<u16> {
    let metres = proj.to_meter();
    [(1.0, 9001), (0.3048, 9002), (1200.0 / 3937.0, 9003)]
        .into_iter()
        .find(|(unit, _)| (metres - unit).abs() < 1e-12)
        .map(|(_, code)| code)
}

/// The GeoTIFF keys that describe `resolved` in a written file. A datum
/// shift travels as `GeogTOWGS84GeoKey`, which the display renderer reads
/// beside the code, so the drawn pixel agrees with the engine; a CRS that
/// shifts nothing writes no such key.
pub(super) fn geokeys_for(resolved: &ResolvedCrs) -> Result<GeoKeyDirectory, String> {
    let projected = resolved.is_projected();
    let mut entries = vec![
        short_entry(key::GTModelTypeGeoKey, if projected { 1 } else { 2 }),
        short_entry(key::GTRasterTypeGeoKey, 1),
        entry(
            key::GTCitationGeoKey,
            GeoKeyValue::Ascii(resolved.name.replace('|', " ")),
        ),
    ];
    match (resolved.epsg, &resolved.user) {
        (_, Some(params)) => entries.extend(user_defined_entries(params, &resolved.proj)?),
        (Some(code), None) => {
            let code = u16::try_from(code)
                .map_err(|_| format!("EPSG:{code} cannot be written as GeoTIFF keys"))?;
            if projected {
                entries.push(short_entry(key::ProjectedCSTypeGeoKey, code));
                if let Some(unit) = linear_unit(&resolved.proj) {
                    entries.push(short_entry(key::ProjLinearUnitsGeoKey, unit));
                }
            } else {
                entries.push(short_entry(key::GeographicTypeGeoKey, code));
                entries.push(short_entry(key::GeogAngularUnitsGeoKey, 9102));
            }
        }
        (None, None) => {
            return Err("a coordinate system with neither a code nor a definition".to_string());
        }
    }
    if let Some(shift) = datum_shift(&resolved.definition) {
        entries.push(entry(GEOG_TOWGS84, GeoKeyValue::Doubles(shift)));
    }
    entries.sort_by_key(|entry| entry.key_id);
    Ok(GeoKeyDirectory {
        version: 1,
        key_revision: 1,
        minor_revision: 0,
        entries,
    })
}

/// The keys of a CRS with no registry code: the projection as `params`
/// spell it, the ellipsoid as `proj` transforms through.
fn user_defined_entries(
    params: &ProjectionParams,
    proj: &Proj,
) -> Result<Vec<GeoKeyEntry>, String> {
    let (a, b) = proj.ellipse_parameters();
    let mut entries = vec![
        short_entry(key::GeographicTypeGeoKey, USER_DEFINED),
        short_entry(key::GeogGeodeticDatumGeoKey, USER_DEFINED),
        short_entry(key::GeogEllipsoidGeoKey, USER_DEFINED),
        double_entry(key::GeogSemiMajorAxisGeoKey, a),
    ];
    if a > b {
        entries.push(double_entry(key::GeogInvFlatteningGeoKey, a / (a - b)));
    } else {
        entries.push(double_entry(key::GeogSemiMinorAxisGeoKey, b));
    }
    entries.push(short_entry(key::GeogAngularUnitsGeoKey, 9102));
    if proj.is_latlong() {
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
            .transform_to(700_000.0, 6_600_000.0, &from_epsg(4326).unwrap())
            .unwrap();
        assert!((lon - 3.0).abs() < 1e-8 && (lat - 46.5).abs() < 1e-8);
    }

    #[test]
    fn user_defined_lambert_keys_without_a_citation_keep_their_false_origin() {
        let mut keys = lambert93_keys();
        keys.entries
            .retain(|entry| entry.key_id != key::GTCitationGeoKey);
        let resolved = from_geokeys(&keys).unwrap().unwrap();
        assert_eq!(resolved.epsg, None);
        let wgs84 = from_epsg(4326).unwrap();
        // Its WKT re-parses to the same placement and keys re-read to it.
        let again = from_reference(&resolved.wkt).unwrap();
        let written = geokeys_for(&resolved).unwrap();
        let reread = from_geokeys(&written).unwrap().unwrap();
        for crs in [&resolved, &again, &reread] {
            let (x, y) = wgs84.transform_to(3.0, 46.5, crs).unwrap();
            assert!((x - 700_000.0).abs() < 1e-3 && (y - 6_600_000.0).abs() < 1e-3);
        }
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
            // GDAL's own coordinates read back within 1e-7 deg (a centimetre).
            let (back_lon, back_lat) = lv95.transform_to(e, n, &wgs84).unwrap();
            assert!(
                (back_lon - lon).abs() < 1e-7 && (back_lat - lat).abs() < 1e-7,
                "inverse of GDAL's {e} {n}: {back_lon} {back_lat}"
            );
            // The datum shift's dropped height closes within 3e-8 deg (3 mm).
            let (x, y) = wgs84.transform_to(lon, lat, &lv95).unwrap();
            let (back_lon, back_lat) = lv95.transform_to(x, y, &wgs84).unwrap();
            assert!(
                (back_lon - lon).abs() < 3e-8 && (back_lat - lat).abs() < 3e-8,
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
        assert!((lon - 2.35).abs() < 1e-8 && (lat - 48.85).abs() < 1e-8);
        assert!(laea.is_projected());
        // A user-defined LAEA from keys takes the same route.
        let keys = GeoKeyDirectory {
            version: 1,
            key_revision: 1,
            minor_revision: 0,
            entries: vec![
                short_entry(key::GTModelTypeGeoKey, 1),
                short_entry(key::GeographicTypeGeoKey, 4258),
                short_entry(key::ProjectedCSTypeGeoKey, USER_DEFINED),
                short_entry(key::ProjCoordTransGeoKey, 10),
                double_entry(key::ProjCenterLatGeoKey, 52.0),
                double_entry(key::ProjCenterLongGeoKey, 10.0),
                double_entry(key::ProjFalseEastingGeoKey, 4_321_000.0),
                double_entry(key::ProjFalseNorthingGeoKey, 3_210_000.0),
            ],
        };
        let reread = from_geokeys(&keys).unwrap().unwrap();
        assert_eq!(reread.epsg, None);
        let (x2, y2) = wgs84.transform_to(2.35, 48.85, &reread).unwrap();
        // They place where PROJ does within 1e-6 m; the registry definition's
        // seven zero shift parameters move proj4rs 0.1 mm off it.
        let (_, _, _, px, py) = REFERENCE_POINTS
            .iter()
            .find(|row| row.0 == 3035)
            .copied()
            .unwrap();
        assert!(
            (x2 - px).abs() < 1e-6 && (y2 - py).abs() < 1e-6,
            "{x2} {y2}, PROJ {px} {py}"
        );
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

    use super::super::super::analyses::{CRS_PROJECTED_METRE, crs_class};
    use super::super::crs_reference_points::REFERENCE_POINTS;

    /// Metres in one linear unit of a code in the reference table.
    fn unit_metres(code: u32) -> f64 {
        if code == 2263 { 1200.0 / 3937.0 } else { 1.0 }
    }

    /// Every code of the reference table against PROJ: forward within 1 cm
    /// (8 m for Krovak, whose PROJ method proj4rs approximates; 0.5 m
    /// for Martinique 2973, where PROJ takes the 0.1 m Helmert shift and the
    /// definition carries the 10 m one), and the engine's own inverse returns
    /// the input within 1e-8 deg. A datum shift moves the ellipsoidal height
    /// some 50 m, which a 2-D transform drops as PROJ's does, so those codes
    /// close within 3e-8 deg (3 mm).
    #[test]
    fn registry_codes_match_proj_at_their_reference_points() {
        let wgs84 = from_epsg(4326).unwrap();
        let mut failures = Vec::new();
        for &(code, lon, lat, x, y) in REFERENCE_POINTS {
            let crs = match from_epsg(code) {
                Ok(crs) => crs,
                Err(error) => {
                    failures.push(format!("EPSG:{code}: {error}"));
                    continue;
                }
            };
            let (px, py) = wgs84.transform_to(lon, lat, &crs).unwrap();
            let tolerance = match code {
                5514 | 5513 | 2065 => 8.0,
                2973 => 0.5,
                _ if !crs.is_projected() => 1e-7,
                _ => 0.01 / unit_metres(code),
            };
            let closure = if datum_shift(&crs.definition).is_some() {
                3e-8
            } else {
                1e-8
            };
            if (px - x).abs() > tolerance || (py - y).abs() > tolerance {
                failures.push(format!(
                    "EPSG:{code} at {lon} {lat}: {px} {py}, PROJ {x} {y}"
                ));
            }
            let (back_lon, back_lat) = crs.transform_to(px, py, &wgs84).unwrap();
            if (back_lon - lon).abs() > closure || (back_lat - lat).abs() > closure {
                failures.push(format!("EPSG:{code} inverse: {back_lon} {back_lat}"));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// IGN's LiDAR HD point clouds are in RGF93 v2b / Lambert-93 (EPSG:5698):
    /// the code resolves, and its stored WKT and written keys name it again.
    #[test]
    fn epsg_5698_resolves_and_round_trips() {
        let resolved = from_reference("EPSG:5698").unwrap();
        assert_eq!(resolved.epsg, Some(5698));
        assert!(resolved.is_projected());
        assert_eq!(crs_class(&resolved.wkt), CRS_PROJECTED_METRE);
        assert_eq!(from_reference(&resolved.wkt).unwrap().epsg, Some(5698));
        let keys = geokeys_for(&resolved).unwrap();
        assert_eq!(from_geokeys(&keys).unwrap().unwrap().epsg, Some(5698));
    }

    /// An AHN-style tile whose keys spell RD New out instead of naming 28992
    /// places where PROJ places 28992, datum shift included, and keeps doing
    /// so through the WKT the catalogue stores and the keys written back.
    #[test]
    fn a_user_defined_rd_tile_places_within_a_centimetre_of_28992() {
        let keys = GeoKeyDirectory {
            version: 1,
            key_revision: 1,
            minor_revision: 0,
            entries: vec![
                short_entry(key::GTModelTypeGeoKey, 1),
                short_entry(key::GTRasterTypeGeoKey, 1),
                short_entry(key::GeographicTypeGeoKey, 4289),
                short_entry(key::GeogAngularUnitsGeoKey, 9102),
                short_entry(key::ProjectedCSTypeGeoKey, USER_DEFINED),
                short_entry(key::ProjectionGeoKey, USER_DEFINED),
                short_entry(key::ProjCoordTransGeoKey, 16),
                short_entry(key::ProjLinearUnitsGeoKey, 9001),
                double_entry(key::ProjNatOriginLatGeoKey, 52.156_160_555_555_55),
                double_entry(key::ProjNatOriginLongGeoKey, 5.387_638_888_888_89),
                double_entry(key::ProjScaleAtNatOriginGeoKey, 0.999_907_9),
                double_entry(key::ProjFalseEastingGeoKey, 155_000.0),
                double_entry(key::ProjFalseNorthingGeoKey, 463_000.0),
            ],
        };
        let wgs84 = from_epsg(4326).unwrap();
        let user = from_geokeys(&keys).unwrap().unwrap();
        assert_eq!(user.epsg, None);
        let stored = from_reference(&user.wkt).unwrap();
        let rewritten = from_geokeys(&geokeys_for(&user).unwrap()).unwrap().unwrap();
        for &(_, lon, lat, x, y) in REFERENCE_POINTS.iter().filter(|row| row.0 == 28992) {
            for (label, crs) in [
                ("keys", &user),
                ("stored WKT", &stored),
                ("written keys", &rewritten),
            ] {
                let (ux, uy) = wgs84.transform_to(lon, lat, crs).unwrap();
                assert!(
                    (ux - x).abs() < 0.01 && (uy - y).abs() < 0.01,
                    "{label} at {lon} {lat}: {ux} {uy}, PROJ {x} {y}"
                );
            }
        }
    }

    /// Another format's PROJ string places where PROJ places its code, and
    /// keeps doing so through the WKT the catalogue stores, the keys written
    /// back and those keys' own stored WKT: its `+towgs84`, `+k_0`, named
    /// datum and ellipsoid survive every route. A string in feet is refused,
    /// and so is a WKT naming no code whose GDAL `EXTENSION["PROJ4",..]`
    /// node is in feet, rather than identified by its parameters.
    #[test]
    fn a_proj_string_places_the_same_through_its_stored_wkt_and_written_keys() {
        let wgs84 = from_epsg(4326).unwrap();
        let definition = |code: u32| crs_definitions::from_code(code as u16).unwrap().proj4;
        for code in [28992u32, 27572, 27571, 31287] {
            let resolved = from_proj4(definition(code)).unwrap();
            let stored = from_reference(&resolved.wkt).unwrap();
            let rewritten = from_geokeys(&geokeys_for(&resolved).unwrap())
                .unwrap()
                .unwrap();
            let rewritten_stored = from_reference(&rewritten.wkt).unwrap();
            for &(_, lon, lat, x, y) in REFERENCE_POINTS.iter().filter(|row| row.0 == code) {
                for (label, crs) in [
                    ("PROJ string", &resolved),
                    ("stored WKT", &stored),
                    ("written keys", &rewritten),
                    ("their stored WKT", &rewritten_stored),
                ] {
                    let (px, py) = wgs84.transform_to(lon, lat, crs).unwrap();
                    assert!(
                        (px - x).abs() < 0.01 && (py - y).abs() < 0.01,
                        "EPSG:{code} through its {label} at {lon} {lat}: {px} {py}, PROJ {x} {y}"
                    );
                }
            }
        }
        assert!(from_proj4(definition(2263)).is_err());
        let new_york = crs_definitions::from_code(2263).unwrap().wkt;
        let codeless = new_york.replace(r#",AUTHORITY["EPSG","2263"]]"#, "]");
        let gdal = with_definition(&codeless, definition(2263));
        assert_eq!(own_code(&wkt_nodes(&gdal)), None);
        assert!(
            from_reference(&gdal)
                .unwrap_err()
                .contains("a linear unit other than the metre")
        );
    }

    /// `wkt` without any `AUTHORITY` node, as a hand-made or ESRI-style WKT.
    fn without_authorities(wkt: &str) -> String {
        let mut wkt = wkt.to_string();
        while let Some(start) = wkt.find(",AUTHORITY[") {
            let end = start + wkt[start..].find(']').unwrap() + 1;
            wkt.replace_range(start..end, "");
        }
        wkt
    }

    const ESRI_LONG_ISLAND_FEET: &str = r#"PROJCS["NAD_1983_StatePlane_New_York_Long_Island_FIPS_3104_Feet",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",984250.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-74.0],PARAMETER["Standard_Parallel_1",40.66666666666666],PARAMETER["Standard_Parallel_2",41.03333333333333],PARAMETER["Latitude_Of_Origin",40.16666666666666],UNIT["Foot_US",0.3048006096012192]]"#;

    /// wbprojection reads a WKT naming no code in metres, as its keys are
    /// written back, so one in feet is refused rather than placed 3.28 times
    /// too far from its false origin: GDAL's Long Island with every authority
    /// stripped, and an ESRI .prj in Foot_US.
    #[test]
    fn a_wkt_naming_no_code_in_feet_is_refused() {
        let gdal = without_authorities(crs_definitions::from_code(2263).unwrap().wkt);
        for wkt in [gdal.as_str(), ESRI_LONG_ISLAND_FEET] {
            let refused = from_reference(wkt).map(|crs| crs.definition);
            assert!(
                refused
                    .as_ref()
                    .is_err_and(|e| e.contains("a linear unit other than the metre")),
                "{refused:?}"
            );
        }
    }

    /// A WKT names its own code at its root, or for a compound CRS naming
    /// none in its horizontal part. A nested node's code is never the CRS's: with the
    /// root's removed, Long Island's last nested code is its unit's (9003,
    /// IGS97 geographic in the registry), so it is read as the feet WKT it
    /// is, not as longitudes and latitudes.
    #[test]
    fn a_wkt_is_identified_by_its_own_code_only() {
        let long_island = crs_definitions::from_code(2263).unwrap().wkt;
        let rootless = long_island.replace(r#",AUTHORITY["EPSG","2263"]]"#, "]");
        let refused = from_reference(&rootless).map(|crs| crs.definition);
        assert!(
            refused
                .as_ref()
                .is_err_and(|e| e.contains("a linear unit other than the metre")),
            "{refused:?}"
        );
        let rd = crs_definitions::from_code(28992).unwrap().wkt;
        let compound = format!(
            r#"COMPD_CS["Amersfoort / RD New + NAP height",{rd},VERT_CS["NAP height",VERT_DATUM["Normaal Amsterdams Peil",2005,AUTHORITY["EPSG","5109"]],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Gravity-related height",UP],AUTHORITY["EPSG","5709"]]]"#
        );
        let resolved = from_reference(&compound).unwrap();
        assert_eq!(resolved.epsg, Some(28992));
        let keys = geokeys_for(&resolved).unwrap();
        assert_eq!(short(&keys, key::ProjectedCSTypeGeoKey), Some(28992));
    }

    /// GDAL 3 writes WKT1 without TOWGS84. A custom grid on a registry datum
    /// (here RD New and Belgian Lambert 72 with their own codes removed)
    /// takes the shift of the geographic CRS it names, as keys do, and places
    /// where PROJ places the code.
    #[test]
    fn a_wkt_naming_no_code_takes_its_geographic_codes_shift() {
        let wgs84 = from_epsg(4326).unwrap();
        for code in [28992u32, 31370] {
            let mut wkt = crs_definitions::from_code(code as u16)
                .unwrap()
                .wkt
                .replace(&format!(r#",AUTHORITY["EPSG","{code}"]]"#), "]");
            let start = wkt.find(",TOWGS84[").unwrap();
            let end = start + wkt[start..].find(']').unwrap() + 1;
            wkt.replace_range(start..end, "");
            let custom = from_reference(&wkt).unwrap();
            assert_eq!(custom.epsg, None);
            for &(_, lon, lat, x, y) in REFERENCE_POINTS.iter().filter(|row| row.0 == code) {
                let (px, py) = wgs84.transform_to(lon, lat, &custom).unwrap();
                assert!(
                    (px - x).abs() < 0.01 && (py - y).abs() < 0.01,
                    "EPSG:{code} at {lon} {lat}: {px} {py}, PROJ {x} {y}"
                );
            }
        }
    }

    /// The engine refuses a registry geographic CRS on another meridian
    /// (EPSG:4807, NTF Paris), and so a code-less one, from WKT or keys,
    /// rather than reading its Paris longitudes as Greenwich's (170 km west).
    #[test]
    fn a_crs_naming_no_code_on_another_meridian_is_refused() {
        let wkt = r#"GEOGCS["NTF (Paris)",DATUM["Nouvelle_Triangulation_Francaise_Paris",SPHEROID["Clarke 1880 (IGN)",6378249.2,293.4660212936269]],PRIMEM["Paris",2.33722917],UNIT["degree",0.0174532925199433]]"#;
        let keys = GeoKeyDirectory {
            version: 1,
            key_revision: 1,
            minor_revision: 0,
            entries: vec![
                short_entry(key::GTModelTypeGeoKey, 2),
                short_entry(key::GeographicTypeGeoKey, USER_DEFINED),
                short_entry(key::GeogGeodeticDatumGeoKey, USER_DEFINED),
                short_entry(key::GeogPrimeMeridianGeoKey, 8903),
                short_entry(key::GeogAngularUnitsGeoKey, 9102),
                double_entry(key::GeogSemiMajorAxisGeoKey, 6_378_249.2),
                double_entry(key::GeogInvFlatteningGeoKey, 293.466_021_293_626_9),
            ],
        };
        let from_wkt = from_reference(wkt).map(|crs| crs.definition);
        let from_keys = from_geokeys(&keys).map(|crs| crs.map(|crs| crs.definition));
        for refused in [from_wkt, from_keys.map(Option::unwrap_or_default)] {
            assert!(
                refused
                    .as_ref()
                    .is_err_and(|e| e.contains("a prime meridian other than Greenwich")),
                "{refused:?}"
            );
        }
    }

    /// Keys spelling a projection with no code in US feet give their false
    /// origin and coordinates in feet; the engine reads and writes such keys
    /// in metres, so they are refused as a PROJ string in feet is.
    #[test]
    fn user_defined_keys_in_feet_are_refused() {
        let mut keys = lambert93_keys();
        keys.entries
            .retain(|entry| entry.key_id != key::GTCitationGeoKey);
        for entry in &mut keys.entries {
            if entry.key_id == key::ProjLinearUnitsGeoKey {
                entry.value = GeoKeyValue::Short(9003);
            }
        }
        let refused = from_geokeys(&keys).map(|crs| crs.map(|crs| crs.definition));
        assert!(
            refused
                .as_ref()
                .is_err_and(|e| e.contains("a linear unit other than the metre")),
            "{refused:?}"
        );
    }

    /// A PROJ string names no code, so it is written back as user-defined
    /// keys: a projection keys cannot spell (spherical Web Mercator, Swiss
    /// oblique Mercator, Krovak) is refused when probed, not when written.
    #[test]
    fn a_proj_string_keys_cannot_spell_is_refused_when_probed() {
        let definition = |code: u16| crs_definitions::from_code(code).unwrap().proj4;
        for proj4 in [
            "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs",
            definition(3857),
            definition(2056),
            definition(5514),
        ] {
            let refused = from_proj4(proj4).map(|crs| crs.definition);
            assert!(
                refused
                    .as_ref()
                    .is_err_and(|e| e.contains("is not supported")),
                "{proj4}: {refused:?}"
            );
        }
    }

    /// A user-defined CRS on the WGS84 ellipsoid with a datum shift keeps
    /// the shift through the keys written back, so hover reads the written
    /// file where import placed it (and where the display tile draws it).
    #[test]
    fn a_shifted_crs_on_the_wgs84_ellipsoid_keeps_its_shift_in_written_keys() {
        let wgs84 = from_epsg(4326).unwrap();
        let source = from_proj4("+proj=longlat +ellps=WGS84 +towgs84=-84,-22,209").unwrap();
        let reread = from_geokeys(&geokeys_for(&source).unwrap())
            .unwrap()
            .unwrap();
        let (lon, lat) = source.transform_to(2.35, 48.85, &wgs84).unwrap();
        let (again_lon, again_lat) = reread.transform_to(2.35, 48.85, &wgs84).unwrap();
        assert!(
            (again_lon - lon).abs() < 1e-9 && (again_lat - lat).abs() < 1e-9,
            "{again_lon} {again_lat}, import placed {lon} {lat}"
        );
    }

    /// NAD83 / New York Long Island (EPSG:2263) is in US survey feet: points
    /// come out in feet (the reference table), its WKT names the unit and
    /// its written keys say US feet.
    #[test]
    fn feet_systems_are_placed_and_labelled_in_feet() {
        let new_york = from_epsg(2263).unwrap();
        assert!(
            new_york
                .wkt
                .contains(r#"UNIT["US survey foot",0.3048006096012192"#),
            "{}",
            new_york.wkt
        );
        let keys = geokeys_for(&new_york).unwrap();
        assert_eq!(short(&keys, key::ProjLinearUnitsGeoKey), Some(9003));
    }

    /// The display renderer rebuilds the CRS from the written keys, so a datum
    /// shift travels as GeogTOWGS84GeoKey (2062): Amersfoort's seven
    /// parameters and OSGB36's named datum. A CRS that shifts nothing writes
    /// no such key, so Lambert-93's keys stay the code and its unit; only the
    /// citation changed with the registry, from wbprojection's "RGF93 v1 /
    /// Lambert-93 (EPSG:2154)" to crs-definitions' name.
    #[test]
    fn written_keys_carry_the_datum_shift_and_nothing_for_a_zero_shift() {
        let shift = |code: u32| match geokeys_for(&from_epsg(code).unwrap()).unwrap().get(2062) {
            Some(GeoKeyValue::Doubles(values)) => Some(values.clone()),
            _ => None,
        };
        assert_eq!(
            shift(28992),
            Some(vec![
                565.2369, 50.0087, 465.658, -0.406857, 0.350733, -1.87035, 4.0812
            ])
        );
        assert_eq!(
            shift(27700),
            Some(vec![
                446.448, -125.157, 542.060, 0.1502, 0.2470, 0.8421, -20.4894
            ])
        );
        for code in [2154, 3035, 25832] {
            assert_eq!(shift(code), None, "EPSG:{code}");
        }
        let lambert93 = geokeys_for(&from_epsg(2154).unwrap()).unwrap();
        let keys: Vec<(u16, GeoKeyValue)> = lambert93
            .entries
            .into_iter()
            .map(|entry| (entry.key_id, entry.value))
            .collect();
        assert_eq!(
            keys,
            vec![
                (key::GTModelTypeGeoKey, GeoKeyValue::Short(1)),
                (key::GTRasterTypeGeoKey, GeoKeyValue::Short(1)),
                (
                    key::GTCitationGeoKey,
                    GeoKeyValue::Ascii("RGF93 / Lambert-93".to_string())
                ),
                (key::ProjectedCSTypeGeoKey, GeoKeyValue::Short(2154)),
                (key::ProjLinearUnitsGeoKey, GeoKeyValue::Short(9001)),
            ]
        );
    }

    /// Codes the library cannot read (Cassini, oblique Mercator, a geographic
    /// CRS on the Paris meridian in grads, polar LAEA north and south, an
    /// unknown code) are refused by name, never approximated (U24).
    #[test]
    fn codes_the_library_cannot_read_are_refused_by_name() {
        for code in [3068u32, 2057, 4807, 3571, 6932, 999_999] {
            assert_eq!(
                from_epsg(code).unwrap_err(),
                format!("EPSG:{code} is not supported")
            );
        }
        assert_eq!(
            from_reference("EPSG:3068").unwrap_err(),
            "EPSG:3068 is not supported"
        );
    }
}
