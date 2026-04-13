use common_types::design::Location;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Maximum template download size (50 MB).
const MAX_TEMPLATE_BYTES: u64 = 50 * 1024 * 1024;

/// Allowed domain for template downloads.
const ALLOWED_HOST: &str = "templates.canopi.app";
static DOWNLOAD_SEQUENCE: AtomicU64 = AtomicU64::new(1);

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

pub fn get_template_catalog() -> Vec<TemplateMeta> {
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

pub fn get_template_preview(id: &str) -> Result<TemplateMeta, String> {
    get_template_catalog()
        .into_iter()
        .find(|template| template.id == id)
        .ok_or_else(|| format!("Template not found: {id}"))
}

pub fn download_template_blocking(url: String) -> Result<String, String> {
    download_template_blocking_with_fetch(url, |url| {
        let mut response =
            crate::http::build_get_request(url, "Canopi/1.0", std::time::Duration::from_secs(30))
                .call()
                .map_err(|e| format!("Failed to download template: {e}"))?;

        crate::http::read_limited_bytes(&mut response, MAX_TEMPLATE_BYTES, "template body")
    })
}

fn download_template_blocking_with_fetch<F>(url: String, mut fetch_bytes: F) -> Result<String, String>
where
    F: FnMut(&str) -> Result<Vec<u8>, String>,
{
    validate_download_url(&url)?;
    let bytes = fetch_bytes(&url)?;
    persist_downloaded_template(&url, &bytes, &std::env::temp_dir())
}

fn persist_downloaded_template(
    url: &str,
    bytes: &[u8],
    tmp_dir: &std::path::Path,
) -> Result<String, String> {
    let file_name = sanitized_download_file_name(url);
    let dest = unique_download_destination(tmp_dir, &file_name)?;

    std::fs::write(&dest, bytes).map_err(|e| format!("Failed to write template to disk: {e}"))?;

    dest.to_str()
        .map(|path| path.to_string())
        .ok_or_else(|| "Invalid temp path encoding".into())
}

fn validate_download_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Invalid URL: only HTTPS URLs are allowed".into());
    }

    let host = extract_https_host(url).unwrap_or_default();
    if host != ALLOWED_HOST {
        return Err(format!("Downloads are restricted to {ALLOWED_HOST}"));
    }

    Ok(())
}

fn extract_https_host(url: &str) -> Option<&str> {
    url.strip_prefix("https://")
        .and_then(|rest| rest.split('/').next())
        .and_then(|host_port| host_port.split(':').next())
}

fn sanitized_download_file_name(url: &str) -> String {
    let raw_name = url.rsplit('/').next().unwrap_or("template.canopi");
    let safe_name: String = raw_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();

    if safe_name.is_empty() || safe_name.starts_with('.') {
        "template.canopi".to_owned()
    } else {
        safe_name
    }
}

fn resolve_download_destination(tmp_dir: &std::path::Path, file_name: &str) -> Result<PathBuf, String> {
    let canonical_tmp = tmp_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve temp dir: {e}"))?;
    let canonical_dest = canonical_tmp.join(file_name);

    if !canonical_dest.starts_with(&canonical_tmp) {
        return Err("Path traversal detected — download aborted".into());
    }

    Ok(canonical_dest)
}

fn unique_download_destination(tmp_dir: &std::path::Path, file_name: &str) -> Result<PathBuf, String> {
    resolve_download_destination(tmp_dir, &unique_file_name(file_name))
}

fn unique_file_name(file_name: &str) -> String {
    let sequence = DOWNLOAD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    match file_name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
            format!("{stem}-{stamp}-{sequence}.{ext}")
        }
        _ => format!("{file_name}-{stamp}-{sequence}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        download_template_blocking_with_fetch, get_template_catalog, get_template_preview,
        resolve_download_destination, sanitized_download_file_name,
        unique_download_destination, validate_download_url,
    };

    #[test]
    fn preview_lookup_uses_catalog_ids() {
        let first = get_template_catalog().into_iter().next().unwrap();
        let preview = get_template_preview(&first.id).unwrap();
        assert_eq!(preview.id, first.id);
    }

    #[test]
    fn rejects_non_https_and_wrong_hosts() {
        assert!(validate_download_url("http://templates.canopi.app/tpl-001.canopi").is_err());
        assert!(validate_download_url("https://example.com/tpl-001.canopi").is_err());
        assert!(validate_download_url("https://templates.canopi.app/tpl-001.canopi").is_ok());
    }

    #[test]
    fn sanitizes_download_file_name() {
        assert_eq!(
            sanitized_download_file_name("https://templates.canopi.app/../weird?.canopi"),
            "weird.canopi"
        );
        assert_eq!(
            sanitized_download_file_name("https://templates.canopi.app/.env"),
            "template.canopi"
        );
    }

    #[test]
    fn resolves_downloads_under_temp_dir() {
        let tmp = std::env::temp_dir();
        let dest = resolve_download_destination(&tmp, "template.canopi").unwrap();
        assert!(dest.starts_with(tmp.canonicalize().unwrap()));
    }

    #[test]
    fn generates_unique_download_destinations() {
        let tmp = std::env::temp_dir();
        let first = unique_download_destination(&tmp, "template.canopi").unwrap();
        let second = unique_download_destination(&tmp, "template.canopi").unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn download_workflow_persists_bytes_to_a_unique_temp_file() {
        let url = "https://templates.canopi.app/tpl-001.canopi".to_string();
        let path = download_template_blocking_with_fetch(url, |_| Ok(vec![1, 2, 3, 4])).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes, vec![1, 2, 3, 4]);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn download_workflow_surfaces_fetch_errors() {
        let url = "https://templates.canopi.app/tpl-001.canopi".to_string();
        let error = download_template_blocking_with_fetch(url, |_| Err("network down".into()))
            .unwrap_err();
        assert!(error.contains("network down"));
    }
}
