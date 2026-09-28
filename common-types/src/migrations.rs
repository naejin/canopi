//! Forward migrations of `.canopi` Designs (ADR 0013).
//!
//! This module is the one place that knows what older formats looked like.
//! Callers hand it the parsed JSON of a file at a supported older version and
//! receive the same Design in the current format, or a
//! [`PendingSitePlacement`] when the Design predates geolocation and has no
//! site of its own. Each step is pure and idempotent on its input version:
//!
//! - v5 (Canopi 1.2): local metres with an optional `location` and
//!   `north_bearing_deg` → v6: the same metres under a `spatial_frame`
//!   (confirmed when the file had a location, provisional otherwise).
//! - v6 → v7: every position becomes WGS84 lon/lat through the local Mercator
//!   frame the anchor and bearing describe; the frame is dropped. A
//!   provisional frame has no site, so the step stops with `NeedsSite`.
//! - v7 → v8: `views` and `stories` appear, empty.
//! - v8 → v9: a zone's name becomes its `id` and, when the user typed it, its
//!   display `name`; `zone_name` targets become `zone_id`; LiDAR entries of
//!   kind `Analysis` become `Derived`.
//!
//! Nothing here validates the current format: admission runs after the ladder.

use serde_json::{Map, Value, json};

use crate::design::{CURRENT_CANOPI_FILE_VERSION, GeoPoint};

/// Oldest `.canopi` format the ladder starts from: Canopi 1.2's release format.
pub const MINIMUM_SUPPORTED_CANOPI_FILE_VERSION: u32 = 5;

/// Where a Design without a site is placed while it waits for the user's
/// answer; this is only a placeholder inside a pending v6 document.
const PROVISIONAL_ANCHOR: (f64, f64) = (13.0, 23.0);
/// Layers of the pre-map canvas that the map replaced.
const RETIRED_LAYER_NAMES: &[&str] = &["base", "contours"];

const EARTH_RADIUS_METERS: f64 = 6_371_008.8;
const EARTH_CIRCUMFERENCE_METERS: f64 = 2.0 * std::f64::consts::PI * EARTH_RADIUS_METERS;
const DEGREES_TO_RADIANS: f64 = std::f64::consts::PI / 180.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationError {
    /// Older than the minimum or newer than the current format.
    UnsupportedVersion(u32),
    /// The document does not have the shape its version promises; the message
    /// names a JSON path and never a file.
    InvalidDocument(String),
}

impl std::fmt::Display for MigrationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedVersion(version) => write!(
                formatter,
                "$.version: unsupported Canopi Design version {version}; this build opens versions {MINIMUM_SUPPORTED_CANOPI_FILE_VERSION} to {CURRENT_CANOPI_FILE_VERSION}",
            ),
            Self::InvalidDocument(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for MigrationError {}

/// The result of running the ladder.
#[derive(Debug, Clone, PartialEq)]
pub enum Migrated {
    /// A current-format document. `migrated_from` is `None` when the input
    /// already was current.
    Current {
        value: Value,
        migrated_from: Option<u32>,
    },
    /// A pre-geolocation Design without a site: the ladder stops at v6 until
    /// the user says where the site is ([`place_at_site`]).
    NeedsSite(PendingSitePlacement),
}

/// A v5 or v6 Design held in its v6 form until it is placed on the map.
/// Opaque to everything outside this module.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingSitePlacement {
    pub from_version: u32,
    document: Value,
}

/// What the "Where is your site?" prompt may tell the user about a pending Design.
#[derive(Debug, Clone, PartialEq)]
pub struct SitePlacementSummary {
    pub name: String,
    pub plant_count: u32,
    pub zone_count: u32,
    /// Plants, zones, annotations and measurement guides.
    pub object_count: u32,
    /// Ground the objects span, in metres, east-west then north-south.
    pub width_m: f64,
    pub height_m: f64,
}

impl PendingSitePlacement {
    /// The pending v6 document as JSON text, for transport. Only
    /// [`PendingSitePlacement::from_document_json`] reads it back.
    pub fn document_json(&self) -> String {
        self.document.to_string()
    }

    pub fn from_document_json(from_version: u32, json: &str) -> Result<Self, MigrationError> {
        let document: Value = serde_json::from_str(json).map_err(|error| {
            MigrationError::InvalidDocument(format!("$: pending Design is not JSON: {error}"))
        })?;
        if !document.is_object() {
            return Err(MigrationError::InvalidDocument(
                "$: expected a pending Canopi Design object".to_owned(),
            ));
        }
        Ok(Self {
            from_version,
            document,
        })
    }

    pub fn summary(&self) -> SitePlacementSummary {
        let name = self.document["name"].as_str().unwrap_or("").to_owned();
        let bounds = local_bounds(&self.document);
        let count = |key: &str| {
            let items = self.document[key].as_array().map_or(0, |items| items.len());
            u32::try_from(items).unwrap_or(u32::MAX)
        };
        let plant_count = count("plants");
        let zone_count = count("zones");
        SitePlacementSummary {
            name,
            plant_count,
            zone_count,
            object_count: plant_count
                .saturating_add(zone_count)
                .saturating_add(count("annotations"))
                .saturating_add(count("measurement_guides")),
            width_m: bounds.map_or(0.0, |b| b.max_x - b.min_x),
            height_m: bounds.map_or(0.0, |b| b.max_y - b.min_y),
        }
    }
}

/// Upgrade `value`, a document at format `from`, to the current format.
pub fn migrate_to_current(value: Value, from: u32) -> Result<Migrated, MigrationError> {
    if !(MINIMUM_SUPPORTED_CANOPI_FILE_VERSION..=CURRENT_CANOPI_FILE_VERSION).contains(&from) {
        return Err(MigrationError::UnsupportedVersion(from));
    }
    let Value::Object(mut object) = value else {
        return Err(MigrationError::InvalidDocument(
            "$: expected a Canopi Design object".to_owned(),
        ));
    };
    if from == CURRENT_CANOPI_FILE_VERSION {
        return Ok(Migrated::Current {
            value: Value::Object(object),
            migrated_from: None,
        });
    }
    let mut version = from;
    while version < CURRENT_CANOPI_FILE_VERSION {
        match version {
            5 => step_v5_to_v6(&mut object),
            6 => match step_v6_to_v7(object)? {
                Placement::Placed(placed) => object = placed,
                Placement::NeedsSite(document) => {
                    return Ok(Migrated::NeedsSite(PendingSitePlacement {
                        from_version: from,
                        document: Value::Object(document),
                    }));
                }
            },
            7 => step_v7_to_v8(&mut object),
            8 => step_v8_to_v9(&mut object),
            _ => return Err(MigrationError::UnsupportedVersion(version)),
        }
        version += 1;
    }
    Ok(Migrated::Current {
        value: Value::Object(object),
        migrated_from: Some(from),
    })
}

/// Finish a pending Design: its objects, centred on their own extent, land
/// around `site` with north up, then the rest of the ladder runs.
pub fn place_at_site(
    pending: PendingSitePlacement,
    site: GeoPoint,
) -> Result<Migrated, MigrationError> {
    if !site.is_valid() {
        return Err(MigrationError::InvalidDocument(
            "$.site: expected lon in [-180, 180] and a Web Mercator latitude".to_owned(),
        ));
    }
    let Value::Object(mut object) = pending.document else {
        return Err(MigrationError::InvalidDocument(
            "$: expected a pending Canopi Design object".to_owned(),
        ));
    };
    let centre = local_bounds(&Value::Object(object.clone())).map_or((0.0, 0.0), |b| {
        ((b.min_x + b.max_x) / 2.0, (b.min_y + b.max_y) / 2.0)
    });
    translate_local_geometry(&mut object, -centre.0, -centre.1);
    let frame = object.entry("spatial_frame").or_insert_with(|| json!({}));
    if let Some(frame) = frame.as_object_mut() {
        frame.insert("anchor_longitude_deg".to_owned(), json!(site.lon));
        frame.insert("anchor_latitude_deg".to_owned(), json!(site.lat));
        frame.insert("placement_status".to_owned(), json!("confirmed"));
        frame
            .entry("north_bearing_deg")
            .or_insert_with(|| json!(0.0));
    }
    match migrate_to_current(Value::Object(object), 6)? {
        Migrated::Current { value, .. } => Ok(Migrated::Current {
            value,
            migrated_from: Some(pending.from_version),
        }),
        Migrated::NeedsSite(_) => Err(MigrationError::InvalidDocument(
            "$.spatial_frame: the placed frame is still provisional".to_owned(),
        )),
    }
}

// ---------------------------------------------------------------------------
// v5 → v6
// ---------------------------------------------------------------------------

fn step_v5_to_v6(object: &mut Map<String, Value>) {
    let location = object.remove("location");
    let bearing = object
        .remove("north_bearing_deg")
        .and_then(|value| value.as_f64())
        .filter(|value| value.is_finite())
        .unwrap_or(0.0);
    let anchor = location.as_ref().and_then(|location| {
        let lon = location.get("lon")?.as_f64()?;
        let lat = location.get("lat")?.as_f64()?;
        let point = GeoPoint { lon, lat };
        point.is_valid().then_some(point)
    });
    let altitude = location
        .as_ref()
        .and_then(|location| location.get("altitude_m"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite());
    let (lon, lat, status) = match anchor {
        Some(point) => (point.lon, point.lat, "confirmed"),
        None => (PROVISIONAL_ANCHOR.0, PROVISIONAL_ANCHOR.1, "provisional"),
    };
    object.insert(
        "spatial_frame".to_owned(),
        json!({
            "anchor_longitude_deg": lon,
            "anchor_latitude_deg": lat,
            "north_bearing_deg": bearing,
            "placement_status": status,
            "location_metadata": { "altitude_m": altitude },
        }),
    );
    object.insert("version".to_owned(), json!(6));
}

// ---------------------------------------------------------------------------
// v6 → v7
// ---------------------------------------------------------------------------

enum Placement {
    Placed(Map<String, Value>),
    NeedsSite(Map<String, Value>),
}

/// The local Mercator frame a v6 `spatial_frame` describes: canvas metres
/// (x east, y south, rotated by the north bearing) around a WGS84 anchor.
struct LocalFrame {
    mercator_origin_x: f64,
    mercator_origin_y: f64,
    units_per_meter: f64,
    bearing_deg: f64,
    bearing_cos: f64,
    bearing_sin: f64,
}

impl LocalFrame {
    fn new(anchor: GeoPoint, bearing_deg: f64) -> Self {
        let bearing_rad = bearing_deg * DEGREES_TO_RADIANS;
        Self {
            mercator_origin_x: mercator_x_from_lon(anchor.lon),
            mercator_origin_y: mercator_y_from_lat(anchor.lat),
            units_per_meter: 1.0
                / EARTH_CIRCUMFERENCE_METERS
                / (anchor.lat * DEGREES_TO_RADIANS).cos(),
            bearing_deg,
            bearing_cos: bearing_rad.cos(),
            bearing_sin: bearing_rad.sin(),
        }
    }

    /// Canvas metres to east/north metres from the anchor.
    fn east_north(&self, x: f64, y: f64) -> (f64, f64) {
        (
            x * self.bearing_cos + y * self.bearing_sin,
            x * self.bearing_sin - y * self.bearing_cos,
        )
    }

    fn geo_from_east_north(&self, east: f64, north: f64) -> Value {
        let lon = lon_from_mercator_x(self.mercator_origin_x + east * self.units_per_meter);
        let lat = lat_from_mercator_y(self.mercator_origin_y - north * self.units_per_meter);
        json!({ "lon": round_geo_degrees(lon), "lat": round_geo_degrees(lat) })
    }

    fn geo(&self, x: f64, y: f64) -> Value {
        let (east, north) = self.east_north(x, y);
        self.geo_from_east_north(east, north)
    }

    /// A canvas rotation (degrees clockwise on the canvas) as degrees
    /// clockwise from true north.
    fn rotation(&self, canvas_degrees: f64) -> f64 {
        let normalized = (canvas_degrees - self.bearing_deg).rem_euclid(360.0);
        if normalized == 0.0 { 0.0 } else { normalized }
    }
}

fn step_v6_to_v7(mut object: Map<String, Value>) -> Result<Placement, MigrationError> {
    let Some(frame) = object.get("spatial_frame").and_then(Value::as_object) else {
        return Err(MigrationError::InvalidDocument(
            "$.spatial_frame: expected the v6 spatial frame object".to_owned(),
        ));
    };
    let confirmed = frame.get("placement_status").and_then(Value::as_str) == Some("confirmed");
    if !confirmed {
        return Ok(Placement::NeedsSite(object));
    }
    let anchor = GeoPoint {
        lon: frame
            .get("anchor_longitude_deg")
            .and_then(Value::as_f64)
            .unwrap_or(f64::NAN),
        lat: frame
            .get("anchor_latitude_deg")
            .and_then(Value::as_f64)
            .unwrap_or(f64::NAN),
    };
    if !anchor.is_valid() {
        return Err(MigrationError::InvalidDocument(
            "$.spatial_frame: expected a finite anchor in WGS84 and Web Mercator range".to_owned(),
        ));
    }
    let bearing = frame
        .get("north_bearing_deg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if !bearing.is_finite() {
        return Err(MigrationError::InvalidDocument(
            "$.spatial_frame.north_bearing_deg: expected a finite number".to_owned(),
        ));
    }
    let local = LocalFrame::new(anchor, bearing);
    object.remove("spatial_frame");

    for_each_object(&mut object, "plants", |plant| {
        if let Some(point) = local_point(plant.get("position")) {
            plant.insert("position".to_owned(), local.geo(point.0, point.1));
        }
        rotate_field(plant, "rotation", &local);
    });
    for_each_object(&mut object, "annotations", |annotation| {
        if let Some(point) = local_point(annotation.get("position")) {
            annotation.insert("position".to_owned(), local.geo(point.0, point.1));
        }
        rotate_field(annotation, "rotation", &local);
    });
    for_each_object(&mut object, "measurement_guides", |guide| {
        for key in ["start", "end"] {
            if let Some(point) = local_point(guide.get(key)) {
                guide.insert(key.to_owned(), local.geo(point.0, point.1));
            }
        }
    });
    for_each_object(&mut object, "zones", |zone| {
        let points: Vec<(f64, f64)> = zone
            .get("points")
            .and_then(Value::as_array)
            .map(|points| points.iter().filter_map(|p| local_point(Some(p))).collect())
            .unwrap_or_default();
        let boxed = matches!(
            zone.get("zone_type").and_then(Value::as_str),
            Some("rect" | "rectangle" | "ellipse")
        );
        let projected: Vec<Value> = if boxed && points.len() == 2 {
            // Opposite corners of the unrotated box: keep the box's size and
            // centre, whatever the frame's bearing.
            let centre = (
                (points[0].0 + points[1].0) / 2.0,
                (points[0].1 + points[1].1) / 2.0,
            );
            let (centre_east, centre_north) = local.east_north(centre.0, centre.1);
            points
                .iter()
                .map(|(x, y)| {
                    local.geo_from_east_north(
                        centre_east + (x - centre.0),
                        centre_north - (y - centre.1),
                    )
                })
                .collect()
        } else {
            points.iter().map(|(x, y)| local.geo(*x, *y)).collect()
        };
        zone.insert("points".to_owned(), Value::Array(projected));
        let rotation = zone.get("rotation").and_then(Value::as_f64).unwrap_or(0.0);
        zone.insert("rotation".to_owned(), json!(local.rotation(rotation)));
    });
    if let Some(guides) = object.get_mut("guides").and_then(Value::as_array_mut) {
        let mut placed = Vec::with_capacity(guides.len());
        for guide in guides.iter() {
            let (Some(id), Some(axis), Some(position)) = (
                guide.get("id").and_then(Value::as_str),
                guide.get("axis").and_then(Value::as_str),
                guide.get("position").and_then(Value::as_f64),
            ) else {
                continue;
            };
            match axis {
                "h" => placed
                    .push(json!({ "id": id, "axis": "h", "lat": local.geo(0.0, position)["lat"] })),
                "v" => placed
                    .push(json!({ "id": id, "axis": "v", "lon": local.geo(position, 0.0)["lon"] })),
                _ => {}
            }
        }
        *guides = placed;
    }
    if let Some(layers) = object.get_mut("layers").and_then(Value::as_array_mut) {
        layers.retain(|layer| {
            !layer
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| RETIRED_LAYER_NAMES.contains(&name))
        });
    }
    object.insert("version".to_owned(), json!(7));
    Ok(Placement::Placed(object))
}

fn rotate_field(item: &mut Map<String, Value>, key: &str, local: &LocalFrame) {
    if let Some(rotation) = item.get(key).and_then(Value::as_f64) {
        item.insert(key.to_owned(), json!(local.rotation(rotation)));
    }
}

fn local_point(value: Option<&Value>) -> Option<(f64, f64)> {
    let value = value?;
    let x = value.get("x")?.as_f64()?;
    let y = value.get("y")?.as_f64()?;
    (x.is_finite() && y.is_finite()).then_some((x, y))
}

fn for_each_object(
    object: &mut Map<String, Value>,
    key: &str,
    mut visit: impl FnMut(&mut Map<String, Value>),
) {
    if let Some(items) = object.get_mut(key).and_then(Value::as_array_mut) {
        for item in items.iter_mut().filter_map(Value::as_object_mut) {
            visit(item);
        }
    }
}

#[derive(Clone, Copy)]
struct LocalBounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

/// The box around every local (v5/v6) position of `document`, or `None`
/// when it has no positioned object.
fn local_bounds(document: &Value) -> Option<LocalBounds> {
    let mut bounds: Option<LocalBounds> = None;
    let mut include = |point: Option<&Value>| {
        if let Some((x, y)) = local_point(point) {
            let b = bounds.get_or_insert(LocalBounds {
                min_x: x,
                min_y: y,
                max_x: x,
                max_y: y,
            });
            b.min_x = b.min_x.min(x);
            b.min_y = b.min_y.min(y);
            b.max_x = b.max_x.max(x);
            b.max_y = b.max_y.max(y);
        }
    };
    let items = |key: &str| document[key].as_array().into_iter().flatten();
    for plant in items("plants") {
        include(plant.get("position"));
    }
    for annotation in items("annotations") {
        include(annotation.get("position"));
    }
    for guide in items("measurement_guides") {
        include(guide.get("start"));
        include(guide.get("end"));
    }
    for zone in items("zones") {
        for point in zone["points"].as_array().into_iter().flatten() {
            include(Some(point));
        }
    }
    bounds
}

fn translate_local_geometry(object: &mut Map<String, Value>, dx: f64, dy: f64) {
    let shift = |point: &mut Value| {
        if let Some((x, y)) = local_point(Some(point)) {
            *point = json!({ "x": x + dx, "y": y + dy });
        }
    };
    for key in ["plants", "annotations"] {
        for_each_object(object, key, |item| {
            if let Some(position) = item.get_mut("position") {
                shift(position);
            }
        });
    }
    for_each_object(object, "measurement_guides", |guide| {
        for key in ["start", "end"] {
            if let Some(point) = guide.get_mut(key) {
                shift(point);
            }
        }
    });
    for_each_object(object, "zones", |zone| {
        if let Some(points) = zone.get_mut("points").and_then(Value::as_array_mut) {
            points.iter_mut().for_each(shift);
        }
    });
    for_each_object(object, "guides", |guide| {
        let axis = guide.get("axis").and_then(Value::as_str).map(str::to_owned);
        if let Some(position) = guide.get("position").and_then(Value::as_f64) {
            let moved = match axis.as_deref() {
                Some("h") => position + dy,
                Some("v") => position + dx,
                _ => position,
            };
            guide.insert("position".to_owned(), json!(moved));
        }
    });
}

// ---------------------------------------------------------------------------
// v7 → v8
// ---------------------------------------------------------------------------

fn step_v7_to_v8(object: &mut Map<String, Value>) {
    for key in ["views", "stories"] {
        object.entry(key).or_insert_with(|| json!([]));
    }
    object.insert("version".to_owned(), json!(8));
}

// ---------------------------------------------------------------------------
// v8 → v9
// ---------------------------------------------------------------------------

fn step_v8_to_v9(object: &mut Map<String, Value>) {
    let mut taken = std::collections::HashSet::new();
    for_each_object(object, "zones", |zone| {
        let Some(name) = zone.get("name").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };
        // The old name stays the identity so targets, groups and saved views
        // still resolve; a second zone with the same name gets a numbered id.
        let mut id = name.clone();
        let mut n = 2;
        while !taken.insert(id.clone()) {
            id = format!("{name} ({n})");
            n += 1;
        }
        let display = if is_generated_zone_name(&name) {
            Value::Null
        } else {
            json!(name)
        };
        zone.insert("id".to_owned(), json!(id));
        zone.insert("name".to_owned(), display);
    });
    for_each_object(object, "timeline", |action| {
        if let Some(targets) = action.get_mut("targets").and_then(Value::as_array_mut) {
            targets.iter_mut().for_each(convert_zone_target);
        }
    });
    for_each_object(object, "budget", |item| {
        if let Some(target) = item.get_mut("target") {
            convert_zone_target(target);
        }
    });
    if let Some(lidar) = object.get_mut("lidar").and_then(Value::as_object_mut) {
        for_each_object(lidar, "entries", |entry| {
            if entry.get("kind").and_then(Value::as_str) == Some("Analysis") {
                entry.insert("kind".to_owned(), json!("Derived"));
            }
        });
    }
    object.insert("version".to_owned(), json!(9));
}

fn convert_zone_target(target: &mut Value) {
    let Some(object) = target.as_object_mut() else {
        return;
    };
    if object.get("kind").and_then(Value::as_str) != Some("zone") {
        return;
    }
    if let Some(name) = object.remove("zone_name") {
        object.entry("zone_id").or_insert(name);
    }
}

/// A zone name Canopi generated (`zone-<uuid>`, a bare UUID, or a pasted
/// " copy" / " copy 2" of one) rather than one the user typed.
fn is_generated_zone_name(name: &str) -> bool {
    let mut rest = name.strip_prefix("zone-").unwrap_or(name);
    let Some(after_uuid) = strip_uuid(rest) else {
        return false;
    };
    rest = after_uuid;
    while let Some(after_copy) = rest.strip_prefix(" copy") {
        rest = after_copy;
        if let Some(after_space) = rest.strip_prefix(' ') {
            let digits = after_space.bytes().take_while(u8::is_ascii_digit).count();
            if digits > 0 {
                rest = &after_space[digits..];
            }
        }
    }
    rest.is_empty()
}

fn strip_uuid(text: &str) -> Option<&str> {
    const GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
    let mut rest = text;
    for (index, length) in GROUPS.iter().enumerate() {
        if index > 0 {
            rest = rest.strip_prefix('-')?;
        }
        let group = rest.get(..*length)?;
        if !group.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        rest = &rest[*length..];
    }
    Some(rest)
}

// ---------------------------------------------------------------------------
// Projection (mirrors canvas/projection.ts and session-plane.ts)
// ---------------------------------------------------------------------------

fn mercator_x_from_lon(lon: f64) -> f64 {
    (180.0 + lon) / 360.0
}

fn mercator_y_from_lat(lat: f64) -> f64 {
    (180.0
        - (180.0 / std::f64::consts::PI
            * (std::f64::consts::PI / 4.0 + lat * DEGREES_TO_RADIANS / 2.0)
                .tan()
                .ln()))
        / 360.0
}

fn lon_from_mercator_x(x: f64) -> f64 {
    x * 360.0 - 180.0
}

fn lat_from_mercator_y(y: f64) -> f64 {
    let y2 = 180.0 - y * 360.0;
    360.0 / std::f64::consts::PI * (y2 * std::f64::consts::PI / 180.0).exp().atan() - 90.0
}

/// 1e-9 degree (about 0.1 mm), the codec's rounding for changed positions.
/// `floor(v + 0.5)` so Rust and JavaScript agree on every half.
fn round_geo_degrees(value: f64) -> f64 {
    let rounded = (value * 1e9 + 0.5).floor() / 1e9;
    if rounded == 0.0 { 0.0 } else { rounded }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v5(extra: Value) -> Value {
        let mut base = json!({
            "version": 5,
            "name": "Canopi 1.2 garden",
            "plant_species_colors": {},
            "layers": [
                { "name": "base", "visible": false, "locked": false, "opacity": 1.0 },
                { "name": "plants", "visible": true, "locked": false, "opacity": 1.0 }
            ],
            "plants": [{
                "id": "plant-1",
                "canonical_name": "Malus domestica",
                "position": { "x": 100.0, "y": -50.0 },
                "rotation": 45.0
            }],
            "zones": [{
                "name": "Orchard",
                "zone_type": "rect",
                "points": [{ "x": 0.0, "y": 0.0 }, { "x": 20.0, "y": 10.0 }],
                "rotation": 30.0
            }],
            "annotations": [{
                "id": "note-1",
                "annotation_type": "text",
                "position": { "x": 5.0, "y": 5.0 },
                "text": "Well",
                "font_size": 14.0
            }],
            "measurement_guides": [{
                "id": "guide-1",
                "start": { "x": 0.0, "y": 0.0 },
                "end": { "x": 10.0, "y": 0.0 }
            }],
            "guides": [
                { "id": "ruler-h", "axis": "h", "position": 40.0 },
                { "id": "ruler-v", "axis": "v", "position": -30.0 }
            ],
            "timeline": [{
                "id": "action-1",
                "action_type": "plant",
                "description": "Plant",
                "targets": [{ "kind": "zone", "zone_name": "Orchard" }],
                "completed": false,
                "order": 0
            }],
            "created_at": "2026-07-15T00:00:00.000Z",
            "updated_at": "2026-07-15T00:00:00.000Z"
        });
        if let (Some(base), Some(extra)) = (base.as_object_mut(), extra.as_object()) {
            for (key, value) in extra {
                base.insert(key.clone(), value.clone());
            }
        }
        base
    }

    fn current(result: Migrated) -> (Value, Option<u32>) {
        match result {
            Migrated::Current {
                value,
                migrated_from,
            } => (value, migrated_from),
            Migrated::NeedsSite(pending) => panic!("expected a placed Design, got {pending:?}"),
        }
    }

    #[test]
    fn versions_outside_the_ladder_are_refused() {
        assert_eq!(
            migrate_to_current(json!({ "version": 4 }), 4),
            Err(MigrationError::UnsupportedVersion(4))
        );
        assert_eq!(
            migrate_to_current(json!({ "version": 10 }), 10),
            Err(MigrationError::UnsupportedVersion(10))
        );
        assert!(matches!(
            migrate_to_current(json!([]), 9),
            Err(MigrationError::InvalidDocument(_))
        ));
        let (value, from) = current(migrate_to_current(json!({ "version": 9 }), 9).unwrap());
        assert_eq!(value, json!({ "version": 9 }));
        assert_eq!(from, None);
    }

    #[test]
    fn v5_with_a_location_becomes_a_confirmed_v6_frame() {
        let mut object = v5(json!({
            "location": { "lat": 48.8566, "lon": 2.3522, "altitude_m": 35.0 },
            "north_bearing_deg": 18.0
        }))
        .as_object()
        .cloned()
        .unwrap();
        step_v5_to_v6(&mut object);
        assert_eq!(object["version"], json!(6));
        assert!(!object.contains_key("location"));
        assert!(!object.contains_key("north_bearing_deg"));
        assert_eq!(
            object["spatial_frame"],
            json!({
                "anchor_longitude_deg": 2.3522,
                "anchor_latitude_deg": 48.8566,
                "north_bearing_deg": 18.0,
                "placement_status": "confirmed",
                "location_metadata": { "altitude_m": 35.0 }
            })
        );
    }

    #[test]
    fn v5_without_a_location_becomes_a_provisional_v6_frame() {
        let mut object = v5(json!({ "location": null, "north_bearing_deg": null }))
            .as_object()
            .cloned()
            .unwrap();
        step_v5_to_v6(&mut object);
        assert_eq!(
            object["spatial_frame"]["placement_status"],
            json!("provisional")
        );
        assert_eq!(object["spatial_frame"]["north_bearing_deg"], json!(0.0));
        assert_eq!(
            object["spatial_frame"]["location_metadata"],
            json!({ "altitude_m": null })
        );
    }

    #[test]
    fn v6_confirmed_frame_projects_every_position_and_drops_the_frame() {
        let mut object = v5(json!({ "location": { "lat": 48.8566, "lon": 2.3522 } }))
            .as_object()
            .cloned()
            .unwrap();
        step_v5_to_v6(&mut object);
        let Placement::Placed(placed) = step_v6_to_v7(object).unwrap() else {
            panic!("a confirmed frame places the Design");
        };
        assert_eq!(placed["version"], json!(7));
        assert!(!placed.contains_key("spatial_frame"));
        // x east, y south: 100 m east and 50 m north of the anchor.
        let position = &placed["plants"][0]["position"];
        let lon = position["lon"].as_f64().unwrap();
        let lat = position["lat"].as_f64().unwrap();
        assert!(lon > 2.3522 && lon < 2.3522 + 0.002, "{lon}");
        assert!(lat > 48.8566 && lat < 48.8566 + 0.001, "{lat}");
        // Local Mercator metres: 100 m east at 48.86° N is about 0.00137°.
        assert!((lon - 2.3522 - 0.001_366_6).abs() < 1e-5, "{lon}");
        assert_eq!(placed["plants"][0]["rotation"], json!(45.0));
        assert_eq!(placed["zones"][0]["rotation"], json!(30.0));
        assert_eq!(
            placed["zones"][0]["points"][0],
            json!({ "lon": 2.3522, "lat": 48.8566 })
        );
        assert_eq!(
            placed["measurement_guides"][0]["start"],
            json!({ "lon": 2.3522, "lat": 48.8566 })
        );
        assert_eq!(placed["guides"][0]["axis"], json!("h"));
        assert!(placed["guides"][0]["lat"].as_f64().unwrap() < 48.8566);
        assert_eq!(placed["guides"][1]["axis"], json!("v"));
        assert!(placed["guides"][1]["lon"].as_f64().unwrap() < 2.3522);
        let layer_names: Vec<_> = placed["layers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|layer| layer["name"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(layer_names, ["plants"]);
    }

    #[test]
    fn v6_bearing_rotates_the_frame_and_keeps_box_zones_axis_aligned() {
        let mut object = v5(json!({
            "location": { "lat": 0.0, "lon": 0.0 },
            "north_bearing_deg": 90.0
        }))
        .as_object()
        .cloned()
        .unwrap();
        step_v5_to_v6(&mut object);
        let Placement::Placed(placed) = step_v6_to_v7(object).unwrap() else {
            panic!("a confirmed frame places the Design");
        };
        // With north 90° clockwise on the canvas, canvas +x points north.
        let plant = &placed["plants"][0]["position"];
        assert!(plant["lat"].as_f64().unwrap() > 0.0, "{plant}");
        assert!(plant["lon"].as_f64().unwrap().abs() < 1e-3, "{plant}");
        assert_eq!(placed["plants"][0]["rotation"], json!(315.0));
        assert_eq!(placed["zones"][0]["rotation"], json!(300.0));
        // The rect corners stay a 20 m by 10 m box on east/north axes around the rotated centre.
        let corners = placed["zones"][0]["points"].as_array().unwrap();
        let width =
            (corners[1]["lon"].as_f64().unwrap() - corners[0]["lon"].as_f64().unwrap()).abs();
        let height =
            (corners[1]["lat"].as_f64().unwrap() - corners[0]["lat"].as_f64().unwrap()).abs();
        let metres_per_degree = EARTH_CIRCUMFERENCE_METERS / 360.0;
        assert!((width * metres_per_degree - 20.0).abs() < 0.01, "{width}");
        assert!((height * metres_per_degree - 10.0).abs() < 0.01, "{height}");
    }

    #[test]
    fn v6_provisional_frame_needs_a_site_and_placing_it_finishes_the_ladder() {
        let result = migrate_to_current(v5(json!({})), 5).unwrap();
        let Migrated::NeedsSite(pending) = result else {
            panic!("a Design without a site waits for one");
        };
        assert_eq!(pending.from_version, 5);
        let summary = pending.summary();
        assert_eq!(summary.name, "Canopi 1.2 garden");
        assert_eq!(summary.plant_count, 1);
        assert_eq!(summary.zone_count, 1);
        assert_eq!(summary.object_count, 4);
        assert_eq!(summary.width_m, 100.0);
        assert_eq!(summary.height_m, 60.0);

        let transported = PendingSitePlacement::from_document_json(
            pending.from_version,
            &pending.document_json(),
        )
        .unwrap();
        assert_eq!(transported, pending);

        let site = GeoPoint {
            lon: 2.3522,
            lat: 48.8566,
        };
        let (value, from) = current(place_at_site(transported, site).unwrap());
        assert_eq!(from, Some(5));
        assert_eq!(value["version"], json!(9));
        // The objects' centre (50, -20) lands on the site: the plant at (100, -50)
        // ends 50 m east and 30 m north of it.
        let plant = &value["plants"][0]["position"];
        assert!(plant["lon"].as_f64().unwrap() > site.lon);
        assert!(plant["lat"].as_f64().unwrap() > site.lat);
        let note = &value["annotations"][0]["position"];
        assert!(note["lon"].as_f64().unwrap() < site.lon);
        assert!(note["lat"].as_f64().unwrap() < site.lat);
        assert_eq!(value["zones"][0]["id"], json!("Orchard"));
        assert_eq!(value["zones"][0]["name"], json!("Orchard"));
        assert_eq!(
            value["timeline"][0]["targets"][0],
            json!({ "kind": "zone", "zone_id": "Orchard" })
        );
        assert_eq!(value["views"], json!([]));

        assert!(
            place_at_site(
                pending,
                GeoPoint {
                    lon: 181.0,
                    lat: 0.0
                }
            )
            .is_err()
        );
    }

    #[test]
    fn v6_without_a_frame_is_invalid() {
        let mut object = v5(json!({})).as_object().cloned().unwrap();
        object.insert("version".to_owned(), json!(6));
        assert!(matches!(
            migrate_to_current(Value::Object(object), 6),
            Err(MigrationError::InvalidDocument(_))
        ));
    }

    #[test]
    fn v7_gains_empty_views_and_stories() {
        let mut object = json!({ "version": 7, "views": [{ "id": "kept" }] })
            .as_object()
            .cloned()
            .unwrap();
        step_v7_to_v8(&mut object);
        assert_eq!(object["version"], json!(8));
        assert_eq!(object["views"], json!([{ "id": "kept" }]));
        assert_eq!(object["stories"], json!([]));
    }

    #[test]
    fn v8_zone_names_become_ids_and_typed_names_stay_visible() {
        let mut object = json!({
            "version": 8,
            "zones": [
                { "name": "North bed", "zone_type": "rect", "points": [] },
                { "name": "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy 2", "zone_type": "rect", "points": [] },
                { "name": "12df7cef-c856-47a2-a4d0-63a5bfcff9d4", "zone_type": "rect", "points": [] },
                { "name": "North bed", "zone_type": "line", "points": [] }
            ],
            "timeline": [{ "targets": [
                { "kind": "zone", "zone_name": "North bed" },
                { "kind": "species", "canonical_name": "Malus domestica" }
            ] }],
            "budget": [{ "target": { "kind": "zone", "zone_name": "North bed" } }, {}],
            "lidar": { "schema_version": 1, "entries": [
                { "kind": "Analysis", "id": "slope-1" },
                { "kind": "Source", "id": "dem-1" }
            ] }
        })
        .as_object()
        .cloned()
        .unwrap();
        step_v8_to_v9(&mut object);
        assert_eq!(object["version"], json!(9));
        let zones = object["zones"].as_array().unwrap();
        assert_eq!(zones[0]["id"], json!("North bed"));
        assert_eq!(zones[0]["name"], json!("North bed"));
        assert_eq!(
            zones[1]["id"],
            json!("zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy 2")
        );
        assert_eq!(zones[1]["name"], Value::Null);
        assert_eq!(zones[2]["name"], Value::Null);
        assert_eq!(zones[3]["id"], json!("North bed (2)"));
        assert_eq!(zones[3]["name"], json!("North bed"));
        assert_eq!(
            object["timeline"][0]["targets"][0],
            json!({ "kind": "zone", "zone_id": "North bed" })
        );
        assert_eq!(
            object["timeline"][0]["targets"][1],
            json!({ "kind": "species", "canonical_name": "Malus domestica" })
        );
        assert_eq!(
            object["budget"][0]["target"],
            json!({ "kind": "zone", "zone_id": "North bed" })
        );
        assert_eq!(object["lidar"]["entries"][0]["kind"], json!("Derived"));
        assert_eq!(object["lidar"]["entries"][1]["kind"], json!("Source"));
    }

    #[test]
    fn generated_zone_names_are_recognised() {
        for name in [
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4",
            "12df7cef-c856-47a2-a4d0-63a5bfcff9d4",
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy",
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy copy 4 copy 3 copy",
            "ZONE-12DF7CEF-C856-47A2-A4D0-63A5BFCFF9D4"
                .to_lowercase()
                .as_str(),
        ] {
            assert!(is_generated_zone_name(name), "{name}");
        }
        for name in [
            "Z01",
            "North bed",
            "zone-12df7cef",
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copyx",
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 (2)",
            "",
        ] {
            assert!(!is_generated_zone_name(name), "{name}");
        }
    }

    #[test]
    fn the_whole_ladder_runs_from_v5_to_current() {
        let (value, from) = current(
            migrate_to_current(
                v5(json!({ "location": { "lat": 48.8566, "lon": 2.3522 } })),
                5,
            )
            .unwrap(),
        );
        assert_eq!(from, Some(5));
        assert_eq!(value["version"], json!(CURRENT_CANOPI_FILE_VERSION));
        assert_eq!(value["stories"], json!([]));
        assert_eq!(value["zones"][0]["id"], json!("Orchard"));
        assert!(value["plants"][0]["position"].get("lon").is_some());
        assert!(value.get("spatial_frame").is_none());
    }

    #[test]
    fn projection_round_trips_the_anchor_and_rounds_like_the_codec() {
        let frame = LocalFrame::new(
            GeoPoint {
                lon: -73.5,
                lat: 45.5,
            },
            0.0,
        );
        assert_eq!(frame.geo(0.0, 0.0), json!({ "lon": -73.5, "lat": 45.5 }));
        assert_eq!(round_geo_degrees(1.0000000005), 1.000000001);
        assert_eq!(round_geo_degrees(-0.0000000004), 0.0);
        assert_eq!(round_geo_degrees(-2.5e-9), -0.000000002);
    }
}
