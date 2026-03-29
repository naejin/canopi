use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoResult {
    pub display_name: String,
    pub lat: f64,
    pub lon: f64,
}

/// Raw Nominatim response entry — only the fields we need.
#[derive(Deserialize)]
struct NominatimResult {
    display_name: String,
    #[serde(deserialize_with = "de_f64_from_str")]
    lat: f64,
    #[serde(deserialize_with = "de_f64_from_str")]
    lon: f64,
}

/// Nominatim returns lat/lon as JSON strings, not numbers.
fn de_f64_from_str<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    let s = String::deserialize(d)?;
    s.parse::<f64>().map_err(serde::de::Error::custom)
}

const MAX_GEOCODING_BYTES: u64 = 1024 * 1024;

#[tauri::command]
pub fn geocode_address(query: String) -> Result<Vec<GeoResult>, String> {
    let mut response = crate::http::build_get_request(
        "https://nominatim.openstreetmap.org/search",
        "Canopi/1.0",
        std::time::Duration::from_secs(5),
    )
    .query("q", &query)
    .query("format", "json")
    .query("limit", "5")
    .call()
    .map_err(|e| format!("Failed to geocode: {e}"))?;

    let body =
        crate::http::read_limited_string(&mut response, MAX_GEOCODING_BYTES, "geocoding response")?;

    let results: Vec<NominatimResult> =
        serde_json::from_str(&body).map_err(|e| format!("Failed to geocode: {e}"))?;

    Ok(results
        .into_iter()
        .map(|r| GeoResult {
            display_name: r.display_name,
            lat: r.lat,
            lon: r.lon,
        })
        .collect())
}
