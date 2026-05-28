use common_types::species::{
    Relationship, SpeciesDetail, SpeciesExternalLink, SpeciesImage, SpeciesUse,
};
use rusqlite::{Connection, OptionalExtension};

use super::detail_projection::{detail_query_sql, translate_projected_text_fields};
use super::detail_row_map::map_detail_row;
use super::lookup::{get_common_name, translate_composite_value, translate_value};

/// Parse a JSON array string (e.g. `["China", "India"]`) into a
/// comma-separated display string. Returns `None` for empty arrays,
/// passes through non-JSON strings unchanged.
fn parse_json_array_to_display(json_str: &str) -> Option<String> {
    match serde_json::from_str::<Vec<String>>(json_str) {
        Ok(items) if !items.is_empty() => Some(items.join(", ")),
        Ok(_) => None,
        Err(_) => Some(json_str.to_owned()),
    }
}

fn parse_json_array_to_translated_display(
    conn: &Connection,
    field: &str,
    json_str: &str,
    locale: &str,
) -> Option<String> {
    match serde_json::from_str::<Vec<String>>(json_str) {
        Ok(items) if !items.is_empty() => Some(
            items
                .iter()
                .map(|item| translate_value(conn, field, item, locale))
                .collect::<Vec<_>>()
                .join(", "),
        ),
        Ok(_) => None,
        Err(_) => Some(translate_composite_value(conn, field, json_str, locale)),
    }
}

pub fn get_detail(
    conn: &Connection,
    canonical_name: &str,
    locale: &str,
) -> Result<SpeciesDetail, String> {
    let mut stmt = conn
        .prepare(detail_query_sql())
        .map_err(|e| format!("Failed to prepare species detail query: {e}"))?;

    let (species_id, mut detail) = stmt
        .query_row([canonical_name], map_detail_row)
        .map_err(|e| format!("Failed to fetch species detail for '{canonical_name}': {e}"))?;

    detail.common_name = get_common_name(conn, &species_id, locale).or(detail.common_name);

    // Parse distribution JSON arrays into readable comma-separated text
    detail.native_distribution = detail
        .native_distribution
        .as_deref()
        .and_then(parse_json_array_to_display);
    detail.introduced_distribution = detail
        .introduced_distribution
        .as_deref()
        .and_then(parse_json_array_to_display);
    detail.climate_zones = detail.climate_zones.as_deref().and_then(|value| {
        parse_json_array_to_translated_display(conn, "climate_zone", value, locale)
    });

    translate_projected_text_fields(conn, &mut detail, locale)?;

    detail.uses = load_uses(conn, &species_id, locale)?;
    detail.relationships = get_relationships(conn, &species_id)?;

    Ok(detail)
}

pub fn get_relationships(conn: &Connection, species_id: &str) -> Result<Vec<Relationship>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.canonical_name, sr.relationship_type
             FROM species_relationships sr
             JOIN species s ON s.slug = sr.related_species_slug
             WHERE sr.species_id = ?1
             ORDER BY sr.relationship_type, s.canonical_name",
        )
        .map_err(|e| format!("Failed to prepare relationships query: {e}"))?;

    Ok(stmt
        .query_map([species_id], |row| {
            Ok(Relationship {
                related_canonical_name: row.get(0)?,
                relationship_type: row.get(1)?,
                description: None,
            })
        })
        .map_err(|e| format!("Failed to fetch relationships: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped relationship row: {error}");
                None
            }
        })
        .collect())
}

pub fn resolve_species_id(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM species WHERE canonical_name = ?1 LIMIT 1",
        [canonical_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Failed to look up species id for '{canonical_name}': {e}"))
}

pub fn get_species_images(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<SpeciesImage>, String> {
    let Some(species_id) = resolve_species_id(conn, canonical_name)? else {
        return Ok(vec![]);
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, species_id, url, source, sort_order
             FROM species_images
             WHERE species_id = ?1
             ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare species images query: {e}"))?;

    Ok(stmt
        .query_map([&species_id], |row| {
            Ok(SpeciesImage {
                id: row.get(0)?,
                species_id: row.get(1)?,
                url: row.get(2)?,
                source: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to fetch species images: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped species image row: {error}");
                None
            }
        })
        .collect())
}

pub fn get_species_external_links(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<SpeciesExternalLink>, String> {
    let Some(species_id) = resolve_species_id(conn, canonical_name)? else {
        return Ok(vec![]);
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, species_id, link_type, url
             FROM species_external_links
             WHERE species_id = ?1
             ORDER BY link_type",
        )
        .map_err(|e| format!("Failed to prepare species external links query: {e}"))?;

    Ok(stmt
        .query_map([&species_id], |row| {
            Ok(SpeciesExternalLink {
                id: row.get(0)?,
                species_id: row.get(1)?,
                link_type: row.get(2)?,
                url: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to fetch species external links: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped species external link row: {error}");
                None
            }
        })
        .collect())
}

fn load_uses(conn: &Connection, species_id: &str, locale: &str) -> Result<Vec<SpeciesUse>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT use_category, use_description
             FROM species_uses
             WHERE species_id = ?1
             ORDER BY use_category",
        )
        .map_err(|e| format!("Failed to prepare uses query: {e}"))?;

    let rows: Vec<SpeciesUse> = stmt
        .query_map([species_id], |row| {
            Ok(SpeciesUse {
                use_category: row.get(0)?,
                use_description: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to fetch uses: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped uses row: {error}");
                None
            }
        })
        .collect();

    Ok(rows
        .into_iter()
        .map(|mut item| {
            let field = format!("use:{}", item.use_category.replace(' ', "_"));
            if let Some(ref description) = item.use_description {
                item.use_description = Some(translate_value(conn, &field, description, locale));
            }
            item
        })
        .collect())
}
