use common_types::design::Location;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateMeta {
    pub id: String,
    pub title: String,
    pub author: String,
    pub description: String,
    pub location: Location,
    pub plant_count: u32,
    pub climate_zone: String,
    pub tags: Vec<String>,
    pub screenshot_url: Option<String>,
    pub download_url: String,
}

/// Return the hardcoded catalog of featured design templates.
fn build_catalog() -> Vec<TemplateMeta> {
    vec![
        TemplateMeta {
            id: "tpl-001".into(),
            title: "Tropical Food Forest — Bahia".into(),
            author: "Ernst Götsch".into(),
            description: "A syntropic agroforestry system in the Atlantic Forest region with over 120 species arranged in successional strata.".into(),
            location: Location { lat: -14.785, lon: -39.174, altitude_m: Some(180.0) },
            plant_count: 127,
            climate_zone: "Tropical".into(),
            tags: vec!["food-forest".into(), "syntropic".into(), "tropical".into()],
            screenshot_url: None,
            download_url: "https://templates.canopi.app/tpl-001.canopi".into(),
        },
        TemplateMeta {
            id: "tpl-002".into(),
            title: "Temperate Guild Garden — Devon".into(),
            author: "Martin Crawford".into(),
            description: "A mature temperate food forest featuring apple-centered guilds, nitrogen fixers, and ground-cover layers.".into(),
            location: Location { lat: 50.533, lon: -3.613, altitude_m: Some(45.0) },
            plant_count: 84,
            climate_zone: "Temperate".into(),
            tags: vec!["food-forest".into(), "temperate".into(), "guilds".into()],
            screenshot_url: None,
            download_url: "https://templates.canopi.app/tpl-002.canopi".into(),
        },
        TemplateMeta {
            id: "tpl-003".into(),
            title: "Mediterranean Dryland Polyculture".into(),
            author: "Marcos Pinheiro".into(),
            description: "Drought-adapted design combining olives, carobs, and aromatic herbs with swale water harvesting.".into(),
            location: Location { lat: 37.017, lon: -7.930, altitude_m: Some(95.0) },
            plant_count: 56,
            climate_zone: "Mediterranean".into(),
            tags: vec!["dryland".into(), "mediterranean".into(), "water-harvesting".into()],
            screenshot_url: None,
            download_url: "https://templates.canopi.app/tpl-003.canopi".into(),
        },
        TemplateMeta {
            id: "tpl-004".into(),
            title: "Boreal Permaculture Homestead".into(),
            author: "Sanna Lindström".into(),
            description: "Cold-hardy design for zone 3 with berry hedges, windbreaks, and raised beds around a central hugelkultur.".into(),
            location: Location { lat: 63.825, lon: 20.263, altitude_m: Some(12.0) },
            plant_count: 42,
            climate_zone: "Boreal".into(),
            tags: vec!["permaculture".into(), "boreal".into(), "homestead".into()],
            screenshot_url: None,
            download_url: "https://templates.canopi.app/tpl-004.canopi".into(),
        },
        TemplateMeta {
            id: "tpl-005".into(),
            title: "Urban Rooftop — Tokyo".into(),
            author: "Yuki Tanaka".into(),
            description: "Compact rooftop design using containers and vertical trellises, optimized for small-space food production.".into(),
            location: Location { lat: 35.689, lon: 139.692, altitude_m: Some(35.0) },
            plant_count: 31,
            climate_zone: "Subtropical".into(),
            tags: vec!["urban".into(), "rooftop".into(), "small-space".into()],
            screenshot_url: None,
            download_url: "https://templates.canopi.app/tpl-005.canopi".into(),
        },
        TemplateMeta {
            id: "tpl-006".into(),
            title: "Savanna Agroforestry — Kenya".into(),
            author: "Wangari Muthoni".into(),
            description: "Multi-strata parkland system combining native acacias with food crops and livestock silvopasture.".into(),
            location: Location { lat: -1.286, lon: 36.817, altitude_m: Some(1660.0) },
            plant_count: 68,
            climate_zone: "Tropical".into(),
            tags: vec!["agroforestry".into(), "savanna".into(), "silvopasture".into()],
            screenshot_url: None,
            download_url: "https://templates.canopi.app/tpl-006.canopi".into(),
        },
        TemplateMeta {
            id: "tpl-007".into(),
            title: "Prairie Restoration — Iowa".into(),
            author: "Mark Shepard".into(),
            description: "Restoration agriculture layout with chestnut alleys, berry rows, and native prairie strips for pollinator habitat.".into(),
            location: Location { lat: 41.878, lon: -93.098, altitude_m: Some(305.0) },
            plant_count: 95,
            climate_zone: "Continental".into(),
            tags: vec!["restoration".into(), "prairie".into(), "alley-cropping".into()],
            screenshot_url: None,
            download_url: "https://templates.canopi.app/tpl-007.canopi".into(),
        },
        TemplateMeta {
            id: "tpl-008".into(),
            title: "Chinampas Revival — Xochimilco".into(),
            author: "Carlos Hernández".into(),
            description: "Floating garden system inspired by Aztec chinampas, integrating aquatic plants with raised bed polycultures.".into(),
            location: Location { lat: 19.257, lon: -99.104, altitude_m: Some(2240.0) },
            plant_count: 73,
            climate_zone: "Subtropical".into(),
            tags: vec!["chinampas".into(), "aquatic".into(), "heritage".into()],
            screenshot_url: None,
            download_url: "https://templates.canopi.app/tpl-008.canopi".into(),
        },
    ]
}

#[tauri::command]
pub fn get_template_catalog() -> Result<Vec<TemplateMeta>, String> {
    Ok(build_catalog())
}

#[tauri::command]
pub fn get_template_preview(id: String) -> Result<TemplateMeta, String> {
    build_catalog()
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("Template not found: {id}"))
}

/// Maximum template download size (50 MB).
const MAX_TEMPLATE_BYTES: u64 = 50 * 1024 * 1024;

/// Allowed domain for template downloads.
const ALLOWED_HOST: &str = "templates.canopi.app";

#[tauri::command]
pub fn download_template(url: String) -> Result<String, String> {
    // Validate URL — HTTPS only
    if !url.starts_with("https://") {
        return Err("Invalid URL: only HTTPS URLs are allowed".into());
    }

    // Domain allowlist — only accept downloads from our template host.
    // Extract host from URL: "https://host/path..." → "host"
    let host = url
        .strip_prefix("https://")
        .and_then(|rest| rest.split('/').next())
        .and_then(|host_port| host_port.split(':').next()) // strip optional port
        .unwrap_or("");
    if host != ALLOWED_HOST {
        return Err(format!("Downloads are restricted to {ALLOWED_HOST}"));
    }

    let mut response =
        crate::http::build_get_request(&url, "Canopi/1.0", std::time::Duration::from_secs(30))
            .call()
            .map_err(|e| format!("Failed to download template: {e}"))?;

    let bytes =
        crate::http::read_limited_bytes(&mut response, MAX_TEMPLATE_BYTES, "template body")?;

    // Sanitize filename — extract last path segment and strip path-traversal chars
    let raw_name = url.rsplit('/').next().unwrap_or("template.canopi");
    // Keep only safe filename characters (alphanum, dash, underscore, dot)
    let safe_name: String = raw_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();
    let file_name = if safe_name.is_empty() || safe_name.starts_with('.') {
        "template.canopi".to_owned()
    } else {
        safe_name
    };

    let tmp_dir = std::env::temp_dir();
    let dest = tmp_dir.join(&file_name);

    // Verify the resolved path is still inside tmp_dir (defense in depth).
    // Check BEFORE writing so no bytes land outside the temp directory.
    let canonical_tmp = tmp_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve temp dir: {e}"))?;
    let canonical_dest = canonical_tmp.join(&file_name);
    if !canonical_dest.starts_with(&canonical_tmp) {
        return Err("Path traversal detected — download aborted".into());
    }

    std::fs::write(&dest, &bytes).map_err(|e| format!("Failed to write template to disk: {e}"))?;

    canonical_dest
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid temp path encoding".into())
}
