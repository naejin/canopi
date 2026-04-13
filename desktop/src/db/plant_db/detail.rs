use common_types::species::{
    Relationship, SpeciesDetail, SpeciesExternalLink, SpeciesImage, SpeciesUse,
};
use rusqlite::{Connection, OptionalExtension};

use super::detail_contract::detail_query_sql;
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

    for (field, getter, setter) in [
        (
            "growth_rate",
            detail.growth_rate.clone(),
            &mut detail.growth_rate as &mut Option<String>,
        ),
        (
            "deciduous_evergreen",
            detail.deciduous_evergreen.clone(),
            &mut detail.deciduous_evergreen,
        ),
        (
            "drought_tolerance",
            detail.drought_tolerance.clone(),
            &mut detail.drought_tolerance,
        ),
        ("stratum", detail.stratum.clone(), &mut detail.stratum),
        (
            "succession_stage",
            detail.succession_stage.clone(),
            &mut detail.succession_stage,
        ),
        ("habit", detail.habit.clone(), &mut detail.habit),
        (
            "bloom_period",
            detail.bloom_period.clone(),
            &mut detail.bloom_period,
        ),
        (
            "flower_color",
            detail.flower_color.clone(),
            &mut detail.flower_color,
        ),
        (
            "active_growth_period",
            detail.active_growth_period.clone(),
            &mut detail.active_growth_period,
        ),
        ("lifespan", detail.lifespan.clone(), &mut detail.lifespan),
        ("toxicity", detail.toxicity.clone(), &mut detail.toxicity),
        (
            "anaerobic_tolerance",
            detail.anaerobic_tolerance.clone(),
            &mut detail.anaerobic_tolerance,
        ),
        (
            "canopy_position",
            detail.canopy_position.clone(),
            &mut detail.canopy_position,
        ),
        ("cn_ratio", detail.cn_ratio.clone(), &mut detail.cn_ratio),
        (
            "ecological_system",
            detail.ecological_system.clone(),
            &mut detail.ecological_system,
        ),
        (
            "fertility_requirement",
            detail.fertility_requirement.clone(),
            &mut detail.fertility_requirement,
        ),
        (
            "fire_tolerance",
            detail.fire_tolerance.clone(),
            &mut detail.fire_tolerance,
        ),
        (
            "fruit_seed_abundance",
            detail.fruit_seed_abundance.clone(),
            &mut detail.fruit_seed_abundance,
        ),
        (
            "grime_strategy",
            detail.grime_strategy.clone(),
            &mut detail.grime_strategy,
        ),
        (
            "growth_form_type",
            detail.growth_form_type.clone(),
            &mut detail.growth_form_type,
        ),
        (
            "growth_habit",
            detail.growth_habit.clone(),
            &mut detail.growth_habit,
        ),
        (
            "hedge_tolerance",
            detail.hedge_tolerance.clone(),
            &mut detail.hedge_tolerance,
        ),
        (
            "invasive_potential",
            detail.invasive_potential.clone(),
            &mut detail.invasive_potential,
        ),
        (
            "biogeographic_status",
            detail.biogeographic_status.clone(),
            &mut detail.biogeographic_status,
        ),
        (
            "leaf_compoundness",
            detail.leaf_compoundness.clone(),
            &mut detail.leaf_compoundness,
        ),
        (
            "leaf_shape",
            detail.leaf_shape.clone(),
            &mut detail.leaf_shape,
        ),
        ("leaf_type", detail.leaf_type.clone(), &mut detail.leaf_type),
        (
            "moisture_use",
            detail.moisture_use.clone(),
            &mut detail.moisture_use,
        ),
        (
            "mycorrhizal_type",
            detail.mycorrhizal_type.clone(),
            &mut detail.mycorrhizal_type,
        ),
        (
            "pollination_syndrome",
            detail.pollination_syndrome.clone(),
            &mut detail.pollination_syndrome,
        ),
        (
            "raunkiaer_life_form",
            detail.raunkiaer_life_form.clone(),
            &mut detail.raunkiaer_life_form,
        ),
        (
            "reproductive_type",
            detail.reproductive_type.clone(),
            &mut detail.reproductive_type,
        ),
        (
            "root_system_type",
            detail.root_system_type.clone(),
            &mut detail.root_system_type,
        ),
        (
            "salinity_tolerance",
            detail.salinity_tolerance.clone(),
            &mut detail.salinity_tolerance,
        ),
        (
            "seed_dispersal_mechanism",
            detail.seed_dispersal_mechanism.clone(),
            &mut detail.seed_dispersal_mechanism,
        ),
        (
            "seed_dormancy_type",
            detail.seed_dormancy_type.clone(),
            &mut detail.seed_dormancy_type,
        ),
        (
            "seed_dormancy_depth",
            detail.seed_dormancy_depth.clone(),
            &mut detail.seed_dormancy_depth,
        ),
        (
            "seed_spread_rate",
            detail.seed_spread_rate.clone(),
            &mut detail.seed_spread_rate,
        ),
        (
            "seed_storage_behaviour",
            detail.seed_storage_behaviour.clone(),
            &mut detail.seed_storage_behaviour,
        ),
        (
            "seedbank_type",
            detail.seedbank_type.clone(),
            &mut detail.seedbank_type,
        ),
        (
            "sexual_system",
            detail.sexual_system.clone(),
            &mut detail.sexual_system,
        ),
        (
            "storage_organ",
            detail.storage_organ.clone(),
            &mut detail.storage_organ,
        ),
        (
            "vegetative_spread_rate",
            detail.vegetative_spread_rate.clone(),
            &mut detail.vegetative_spread_rate,
        ),
        (
            "classification_source",
            detail.classification_source.clone(),
            &mut detail.classification_source,
        ),
        (
            "data_quality_tier",
            detail.data_quality_tier.clone(),
            &mut detail.data_quality_tier,
        ),
        (
            "photosynthesis_pathway",
            detail.photosynthesis_pathway.clone(),
            &mut detail.photosynthesis_pathway,
        ),
        (
            "clonal_growth_form",
            detail.clonal_growth_form.clone(),
            &mut detail.clonal_growth_form,
        ),
        (
            "mating_system",
            detail.mating_system.clone(),
            &mut detail.mating_system,
        ),
        (
            "conservation_status",
            detail.conservation_status.clone(),
            &mut detail.conservation_status,
        ),
        (
            "fruit_type",
            detail.fruit_type.clone(),
            &mut detail.fruit_type,
        ),
        (
            "fruit_seed_color",
            detail.fruit_seed_color.clone(),
            &mut detail.fruit_seed_color,
        ),
        (
            "fruit_seed_period_begin",
            detail.fruit_seed_period_begin.clone(),
            &mut detail.fruit_seed_period_begin,
        ),
        (
            "fruit_seed_period_end",
            detail.fruit_seed_period_end.clone(),
            &mut detail.fruit_seed_period_end,
        ),
        (
            "growth_form_shape",
            detail.growth_form_shape.clone(),
            &mut detail.growth_form_shape,
        ),
        (
            "propagation_method",
            detail.propagation_method.clone(),
            &mut detail.propagation_method,
        ),
        (
            "sowing_period",
            detail.sowing_period.clone(),
            &mut detail.sowing_period,
        ),
        (
            "harvest_period",
            detail.harvest_period.clone(),
            &mut detail.harvest_period,
        ),
        (
            "dormancy_conditions",
            detail.dormancy_conditions.clone(),
            &mut detail.dormancy_conditions,
        ),
        (
            "management_types",
            detail.management_types.clone(),
            &mut detail.management_types,
        ),
        (
            "pollinators",
            detail.pollinators.clone(),
            &mut detail.pollinators,
        ),
    ] {
        if let Some(ref value) = getter {
            *setter = Some(translate_composite_value(conn, field, value, locale));
        }
    }

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
