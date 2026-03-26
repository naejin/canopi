use rusqlite::{Connection, OptionalExtension, params_from_iter};
use common_types::species::{
    FilterOptions, PaginatedResult, Relationship, Sort, SpeciesDetail, SpeciesFilter,
    SpeciesListItem, SpeciesUse,
};
use crate::db::query_builder::{encode_cursor, sort_column, QueryBuilder};

/// Searches species using FTS5, structured filters, or both.
///
/// Returns a paginated result. Pass the `next_cursor` from a previous result
/// to fetch the next page.
pub fn search(
    conn: &Connection,
    text: Option<String>,
    filters: SpeciesFilter,
    cursor: Option<String>,
    sort: Sort,
    limit: u32,
    locale: String,
) -> Result<PaginatedResult<SpeciesListItem>, String> {
    let sort_col = sort_column(&sort).to_owned();
    let qb = QueryBuilder::new(text, filters, cursor, sort, limit, locale.clone());
    let (sql, params) = qb.build();

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare species search: {e}"))?;

    let rows: Vec<SpeciesListItem> = stmt
        .query_map(params_from_iter(params.iter()), |row| {
            Ok(SpeciesListItem {
                canonical_name: row.get(0)?,
                slug: row.get(1)?,
                common_name: row.get(2)?,
                family: row.get(3)?,
                genus: row.get(4)?,
                height_max_m: row.get(5)?,
                hardiness_zone_min: row.get(6)?,
                hardiness_zone_max: row.get(7)?,
                growth_rate: row.get(8)?,
                stratum: row.get(9)?,
                edibility_rating: row.get(10)?,
                medicinal_rating: row.get(11)?,
                width_max_m: row.get(12)?,
                is_favorite: false,
            })
        })
        .map_err(|e| format!("Failed to execute species search: {e}"))?
        .filter_map(|r| match r {
            Ok(item) => Some(item),
            Err(e) => { tracing::warn!("Skipped species search row: {e}"); None }
        })
        .collect();

    // We fetched limit+1 rows to detect a next page.
    let has_next = rows.len() as u32 > limit;
    let items: Vec<SpeciesListItem> = rows.into_iter().take(limit as usize).collect();

    let next_cursor = if has_next {
        items.last().map(|last| {
            let sort_val = match sort_col.as_str() {
                "s.family" => last.family.clone(),
                "s.height_max_m" => last
                    .height_max_m
                    .map(|h| h.to_string())
                    .unwrap_or_default(),
                "s.hardiness_zone_min" => last
                    .hardiness_zone_min
                    .map(|z| z.to_string())
                    .unwrap_or_default(),
                "s.growth_rate" => last.growth_rate.clone().unwrap_or_default(),
                _ => last.canonical_name.clone(),
            };
            encode_cursor(&sort_val, &last.canonical_name)
        })
    } else {
        None
    };

    // Approximate total: a COUNT(*) with the same WHERE would be expensive on
    // large FTS queries, so we return 0 as a sentinel meaning "unknown".
    // The frontend should use cursor presence to drive pagination, not this count.
    Ok(PaginatedResult {
        items,
        next_cursor,
        total_estimate: 0,
    })
}

/// Returns the full detail record for a species by canonical name.
pub fn get_detail(
    conn: &Connection,
    canonical_name: &str,
    locale: &str,
) -> Result<SpeciesDetail, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id,                          -- 0
                    s.canonical_name,               -- 1
                    s.family,                       -- 2
                    s.genus,                        -- 3
                    s.height_min_m,                 -- 4
                    s.height_max_m,                 -- 5
                    s.width_max_m,                  -- 6
                    s.hardiness_zone_min,           -- 7
                    s.hardiness_zone_max,           -- 8
                    s.growth_rate,                  -- 9
                    s.is_annual,                    -- 10
                    s.is_biennial,                  -- 11
                    s.is_perennial,                 -- 12
                    s.lifespan,                     -- 13
                    s.deciduous_evergreen,          -- 14
                    s.habit,                        -- 15
                    s.active_growth_period,         -- 16
                    s.bloom_period,                 -- 17
                    s.flower_color,                 -- 18
                    s.tolerates_full_sun,           -- 19
                    s.tolerates_semi_shade,         -- 20
                    s.tolerates_full_shade,         -- 21
                    s.frost_tender,                 -- 22
                    s.drought_tolerance,            -- 23
                    s.soil_ph_min,                  -- 24
                    s.soil_ph_max,                  -- 25
                    s.well_drained,                 -- 26
                    s.heavy_clay,                   -- 27
                    s.tolerates_acid,               -- 28
                    s.tolerates_alkaline,           -- 29
                    s.tolerates_saline,             -- 30
                    s.tolerates_wind,               -- 31
                    s.tolerates_pollution,          -- 32
                    s.tolerates_nutritionally_poor, -- 33
                    s.stratum,                      -- 34
                    s.succession_stage,             -- 35
                    s.nitrogen_fixer,               -- 36
                    s.attracts_wildlife,            -- 37
                    s.scented,                      -- 38
                    s.stratum_confidence,           -- 39
                    s.succession_confidence,        -- 40
                    s.edibility_rating,             -- 41
                    s.medicinal_rating,             -- 42
                    s.other_uses_rating,            -- 43
                    s.edible_uses,                  -- 44
                    s.medicinal_uses,               -- 45
                    s.other_uses,                   -- 46
                    s.toxicity,                     -- 47
                    s.known_hazards,                -- 48
                    s.summary,                      -- 49
                    s.cultivation_notes,            -- 50
                    s.propagation_notes,            -- 51
                    s.native_range,                 -- 52
                    s.carbon_farming,               -- 53
                    s.data_quality_tier,            -- 54
                    s.common_name                   -- 55
             FROM species s
             WHERE s.canonical_name = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare species detail query: {e}"))?;

    let (species_id, mut detail) = stmt
        .query_row([canonical_name], |row| {
            let id: String = row.get(0)?;
            let fallback_common: Option<String> = row.get(55)?;
            Ok((
                id,
                SpeciesDetail {
                    canonical_name: row.get(1)?,
                    common_name: fallback_common,
                    family: row.get(2)?,
                    genus: row.get(3)?,
                    height_min_m: row.get(4)?,
                    height_max_m: row.get(5)?,
                    width_max_m: row.get(6)?,
                    hardiness_zone_min: row.get(7)?,
                    hardiness_zone_max: row.get(8)?,
                    growth_rate: row.get(9)?,
                    is_annual: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
                    is_biennial: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
                    is_perennial: row.get::<_, Option<i32>>(12)?.map(|v| v != 0),
                    lifespan: row.get(13)?,
                    deciduous_evergreen: row.get(14)?,
                    habit: row.get(15)?,
                    active_growth_period: row.get(16)?,
                    bloom_period: row.get(17)?,
                    flower_color: row.get(18)?,
                    tolerates_full_sun: row.get::<_, Option<i32>>(19)?.map(|v| v != 0),
                    tolerates_semi_shade: row.get::<_, Option<i32>>(20)?.map(|v| v != 0),
                    tolerates_full_shade: row.get::<_, Option<i32>>(21)?.map(|v| v != 0),
                    frost_tender: row.get::<_, Option<i32>>(22)?.map(|v| v != 0),
                    drought_tolerance: row.get(23)?,
                    soil_ph_min: row.get(24)?,
                    soil_ph_max: row.get(25)?,
                    well_drained: row.get::<_, Option<i32>>(26)?.map(|v| v != 0),
                    heavy_clay: row.get::<_, Option<i32>>(27)?.map(|v| v != 0),
                    tolerates_acid: row.get::<_, Option<i32>>(28)?.map(|v| v != 0),
                    tolerates_alkaline: row.get::<_, Option<i32>>(29)?.map(|v| v != 0),
                    tolerates_saline: row.get::<_, Option<i32>>(30)?.map(|v| v != 0),
                    tolerates_wind: row.get::<_, Option<i32>>(31)?.map(|v| v != 0),
                    tolerates_pollution: row.get::<_, Option<i32>>(32)?.map(|v| v != 0),
                    tolerates_nutritionally_poor: row.get::<_, Option<i32>>(33)?.map(|v| v != 0),
                    stratum: row.get(34)?,
                    succession_stage: row.get(35)?,
                    nitrogen_fixer: row.get::<_, Option<i32>>(36)?.map(|v| v != 0),
                    attracts_wildlife: row.get::<_, Option<i32>>(37)?.map(|v| v != 0),
                    scented: row.get::<_, Option<i32>>(38)?.map(|v| v != 0),
                    stratum_confidence: row.get(39)?,
                    succession_confidence: row.get(40)?,
                    edibility_rating: row.get(41)?,
                    medicinal_rating: row.get(42)?,
                    other_uses_rating: row.get(43)?,
                    edible_uses: row.get(44)?,
                    medicinal_uses: row.get(45)?,
                    other_uses: row.get(46)?,
                    toxicity: row.get(47)?,
                    known_hazards: row.get(48)?,
                    summary: row.get(49)?,
                    cultivation_notes: row.get(50)?,
                    propagation_notes: row.get(51)?,
                    native_range: row.get(52)?,
                    carbon_farming: row.get(53)?,
                    data_quality_tier: row.get(54)?,
                    uses: vec![],
                    soil_types: vec![],
                    relationships: vec![],
                },
            ))
        })
        .map_err(|e| format!("Failed to fetch species detail for '{canonical_name}': {e}"))?;

    // Override common_name with the locale-aware lookup.
    detail.common_name = get_common_name(conn, &species_id, locale).or(detail.common_name);

    // Translate categorical fields for the requested locale.
    // translate_value returns the English value unchanged if no translation exists.
    for (field, getter, setter) in [
        ("growth_rate", detail.growth_rate.clone(), &mut detail.growth_rate as &mut Option<String>),
        ("deciduous_evergreen", detail.deciduous_evergreen.clone(), &mut detail.deciduous_evergreen),
        ("drought_tolerance", detail.drought_tolerance.clone(), &mut detail.drought_tolerance),
        ("stratum", detail.stratum.clone(), &mut detail.stratum),
        ("succession_stage", detail.succession_stage.clone(), &mut detail.succession_stage),
        ("habit", detail.habit.clone(), &mut detail.habit),
        ("bloom_period", detail.bloom_period.clone(), &mut detail.bloom_period),
        ("flower_color", detail.flower_color.clone(), &mut detail.flower_color),
        ("active_growth_period", detail.active_growth_period.clone(), &mut detail.active_growth_period),
        ("lifespan", detail.lifespan.clone(), &mut detail.lifespan),
        ("toxicity", detail.toxicity.clone(), &mut detail.toxicity),
    ] {
        if let Some(ref v) = getter {
            *setter = Some(translate_value(conn, field, v, locale));
        }
    }

    // Fetch uses.
    detail.uses = {
        let mut s = conn
            .prepare(
                "SELECT use_category, use_description
                 FROM species_uses
                 WHERE species_id = ?1
                 ORDER BY use_category",
            )
            .map_err(|e| format!("Failed to prepare uses query: {e}"))?;
        s.query_map([&species_id], |row| {
            Ok(SpeciesUse {
                use_category: row.get(0)?,
                use_description: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to fetch uses: {e}"))?
        .filter_map(|r| match r {
            Ok(item) => Some(item),
            Err(e) => { tracing::warn!("Skipped uses row: {e}"); None }
        })
        .collect()
    };

    // Fetch soil types.
    detail.soil_types = {
        let mut s = conn
            .prepare(
                "SELECT soil_type
                 FROM species_soil_types
                 WHERE species_id = ?1
                 ORDER BY soil_type",
            )
            .map_err(|e| format!("Failed to prepare soil types query: {e}"))?;
        s.query_map([&species_id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to fetch soil types: {e}"))?
            .filter_map(|r| match r {
                Ok(item) => Some(item),
                Err(e) => { tracing::warn!("Skipped soil type row: {e}"); None }
            })
            .collect()
    };

    // Fetch relationships.
    detail.relationships = get_relationships(conn, &species_id)?;

    Ok(detail)
}

/// Returns companion/antagonist relationships for a species by its UUID.
pub fn get_relationships(
    conn: &Connection,
    species_id: &str,
) -> Result<Vec<Relationship>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.canonical_name, sr.relationship_type
             FROM species_relationships sr
             JOIN species s ON s.slug = sr.related_species_slug
             WHERE sr.species_id = ?1
             ORDER BY sr.relationship_type, s.canonical_name",
        )
        .map_err(|e| format!("Failed to prepare relationships query: {e}"))?;

    let relationships = stmt
        .query_map([species_id], |row| {
            Ok(Relationship {
                related_canonical_name: row.get(0)?,
                relationship_type: row.get(1)?,
                description: None,
            })
        })
        .map_err(|e| format!("Failed to fetch relationships: {e}"))?
        .filter_map(|r| match r {
            Ok(item) => Some(item),
            Err(e) => { tracing::warn!("Skipped relationship row: {e}"); None }
        })
        .collect();

    Ok(relationships)
}

/// Returns all distinct values used to populate filter UI dropdowns.
pub fn get_filter_options(conn: &Connection) -> Result<FilterOptions, String> {
    let families: Vec<String> = {
        let mut s = conn
            .prepare(
                "SELECT DISTINCT family FROM species WHERE family IS NOT NULL ORDER BY family",
            )
            .map_err(|e| format!("Failed to prepare families query: {e}"))?;
        s.query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to fetch families: {e}"))?
            .filter_map(|r| match r {
                Ok(item) => Some(item),
                Err(e) => { tracing::warn!("Skipped family row: {e}"); None }
            })
            .collect()
    };

    let growth_rates: Vec<String> = {
        let mut s = conn
            .prepare(
                "SELECT DISTINCT growth_rate FROM species WHERE growth_rate IS NOT NULL ORDER BY growth_rate",
            )
            .map_err(|e| format!("Failed to prepare growth rates query: {e}"))?;
        s.query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to fetch growth rates: {e}"))?
            .filter_map(|r| match r {
                Ok(item) => Some(item),
                Err(e) => { tracing::warn!("Skipped growth rate row: {e}"); None }
            })
            .collect()
    };

    let strata: Vec<String> = {
        let mut s = conn
            .prepare(
                "SELECT DISTINCT stratum FROM species WHERE stratum IS NOT NULL ORDER BY stratum",
            )
            .map_err(|e| format!("Failed to prepare strata query: {e}"))?;
        s.query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to fetch strata: {e}"))?
            .filter_map(|r| match r {
                Ok(item) => Some(item),
                Err(e) => { tracing::warn!("Skipped stratum row: {e}"); None }
            })
            .collect()
    };

    // Life cycles are now boolean columns (is_annual, is_biennial, is_perennial).
    // Return a fixed list — the frontend renders these as checkboxes and the
    // query builder maps them to the boolean column checks.
    let life_cycles: Vec<String> = vec![
        "Annual".to_owned(),
        "Biennial".to_owned(),
        "Perennial".to_owned(),
    ];

    let soil_types: Vec<String> = {
        let mut s = conn
            .prepare(
                "SELECT DISTINCT soil_type FROM species_soil_types WHERE soil_type IS NOT NULL ORDER BY soil_type",
            )
            .map_err(|e| format!("Failed to prepare soil types query: {e}"))?;
        s.query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to fetch soil types: {e}"))?
            .filter_map(|r| match r {
                Ok(item) => Some(item),
                Err(e) => { tracing::warn!("Skipped soil type row (filter options): {e}"); None }
            })
            .collect()
    };

    let sun_tolerances: Vec<String> = {
        // These are synthesized from boolean columns rather than a DISTINCT query.
        let mut result = Vec::new();
        let has_full_sun: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM species WHERE tolerates_full_sun = 1)",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        let has_semi_shade: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM species WHERE tolerates_semi_shade = 1)",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        let has_full_shade: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM species WHERE tolerates_full_shade = 1)",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if has_full_sun {
            result.push("full_sun".to_owned());
        }
        if has_semi_shade {
            result.push("semi_shade".to_owned());
        }
        if has_full_shade {
            result.push("full_shade".to_owned());
        }
        result
    };

    let hardiness_range: (i32, i32) = conn
        .query_row(
            "SELECT COALESCE(MIN(hardiness_zone_min), 1), COALESCE(MAX(hardiness_zone_max), 13)
             FROM species",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Failed to fetch hardiness range: {e}"))?;

    Ok(FilterOptions {
        families,
        growth_rates,
        strata,
        hardiness_range,
        life_cycles,
        sun_tolerances,
        soil_types,
    })
}

/// Returns the best available common name for a species, preferring the
/// requested locale and falling back to English.
/// Uses `best_common_names` (pre-aggregated by prepare-db.py) first, then
/// falls back to `species_common_names` for broader coverage.
pub fn get_common_name(conn: &Connection, species_id: &str, locale: &str) -> Option<String> {
    // Try best_common_names first (most reliable, one entry per species+language).
    let best: Option<String> = conn
        .query_row(
            "SELECT common_name FROM best_common_names
             WHERE species_id = ?1 AND language = ?2
             LIMIT 1",
            [species_id, locale],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();

    if best.is_some() {
        return best;
    }

    // Fall back to best_common_names English.
    let best_en: Option<String> = conn
        .query_row(
            "SELECT common_name FROM best_common_names
             WHERE species_id = ?1 AND language = 'en'
             LIMIT 1",
            [species_id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();

    if best_en.is_some() {
        return best_en;
    }

    // Final fallback to species_common_names.
    conn.query_row(
        "SELECT common_name FROM species_common_names
         WHERE species_id = ?1 AND language = 'en' AND is_primary = 1
         LIMIT 1",
        [species_id],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

/// Batch lookup: given a list of canonical names and a locale, return a map
/// of canonical_name → common_name. One SQL query using JOIN + IN clause.
/// Falls back to English if the requested locale has no entry.
pub fn get_common_names_batch(
    conn: &Connection,
    canonical_names: &[String],
    locale: &str,
) -> Result<std::collections::HashMap<String, String>, String> {
    if canonical_names.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    if canonical_names.len() > 500 {
        return Err("Batch size exceeds maximum of 500 names".into());
    }

    // Params: ?1 = locale, ?2..?N+1 = canonical names
    let name_placeholders: Vec<String> = (2..=canonical_names.len() + 1)
        .map(|i| format!("?{i}"))
        .collect();
    let in_clause = name_placeholders.join(", ");

    let sql = format!(
        "SELECT s.canonical_name,
                COALESCE(loc.common_name, en.common_name, s.common_name) AS resolved_name
         FROM species s
         LEFT JOIN species_common_names loc
           ON loc.species_id = s.id AND loc.language = ?1 AND loc.is_primary = 1
         LEFT JOIN species_common_names en
           ON en.species_id = s.id AND en.language = 'en' AND en.is_primary = 1
         WHERE s.canonical_name IN ({in_clause})",
    );

    let mut stmt = conn.prepare(&sql)
        .map_err(|e| format!("Failed to prepare batch common name query: {e}"))?;

    // Build params: locale first, then all canonical names
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::with_capacity(canonical_names.len() + 1);
    params.push(Box::new(locale.to_string()));
    for name in canonical_names {
        params.push(Box::new(name.clone()));
    }
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(&*param_refs, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|e| format!("Batch common name query failed: {e}"))?;

    let mut result = std::collections::HashMap::new();
    for row in rows {
        if let Ok((canonical, Some(name))) = row {
            if !name.is_empty() {
                result.insert(canonical, name);
            }
        }
    }
    Ok(result)
}

/// Looks up a translated display value from the `translated_values` table.
/// The table uses a wide format: field_name, value_en, value_fr, value_es, etc.
/// Returns the original English value if no translation is found.
pub fn translate_value(
    conn: &Connection,
    field: &str,
    value_en: &str,
    locale: &str,
) -> String {
    // Validate locale to prevent SQL injection — only known locale columns allowed
    let col = match locale {
        "fr" => "value_fr",
        "es" => "value_es",
        "pt" => "value_pt",
        "it" => "value_it",
        "zh" => "value_zh",
        _ => return value_en.to_owned(), // "en" or unknown → return English
    };
    let sql = format!(
        "SELECT COALESCE({col}, value_en) FROM translated_values \
         WHERE field_name = ?1 AND value_en = ?2 LIMIT 1"
    );
    conn.query_row(&sql, [field, value_en], |row| row.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .unwrap_or_else(|| value_en.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL,
                canonical_name TEXT NOT NULL,
                common_name TEXT,
                family TEXT,
                genus TEXT,
                height_min_m REAL,
                height_max_m REAL,
                width_max_m REAL,
                hardiness_zone_min INTEGER,
                hardiness_zone_max INTEGER,
                soil_ph_min REAL,
                soil_ph_max REAL,
                drought_tolerance TEXT,
                frost_tender INTEGER,
                growth_rate TEXT,
                is_annual INTEGER,
                is_biennial INTEGER,
                is_perennial INTEGER,
                lifespan TEXT,
                habit TEXT,
                deciduous_evergreen TEXT,
                active_growth_period TEXT,
                bloom_period TEXT,
                flower_color TEXT,
                tolerates_full_sun INTEGER,
                tolerates_semi_shade INTEGER,
                tolerates_full_shade INTEGER,
                well_drained INTEGER,
                heavy_clay INTEGER,
                tolerates_acid INTEGER,
                tolerates_alkaline INTEGER,
                tolerates_saline INTEGER,
                tolerates_wind INTEGER,
                tolerates_pollution INTEGER,
                tolerates_nutritionally_poor INTEGER,
                nitrogen_fixer INTEGER,
                stratum TEXT,
                succession_stage TEXT,
                stratum_confidence REAL,
                succession_confidence REAL,
                edibility_rating INTEGER,
                medicinal_rating INTEGER,
                other_uses_rating INTEGER,
                edible_uses TEXT,
                medicinal_uses TEXT,
                other_uses TEXT,
                summary TEXT,
                cultivation_notes TEXT,
                propagation_notes TEXT,
                known_hazards TEXT,
                carbon_farming TEXT,
                native_range TEXT,
                toxicity TEXT,
                attracts_wildlife INTEGER,
                scented INTEGER,
                data_quality_tier TEXT
            );
            CREATE VIRTUAL TABLE species_fts USING fts5(
                canonical_name, common_name,
                content='species', content_rowid='rowid'
            );
            CREATE TABLE species_common_names (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                source TEXT,
                is_primary INTEGER DEFAULT 1
            );
            CREATE TABLE species_uses (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                use_category TEXT NOT NULL,
                use_description TEXT,
                glossary_description TEXT
            );
            CREATE TABLE species_soil_types (
                species_id TEXT NOT NULL,
                soil_type TEXT NOT NULL
            );
            CREATE TABLE species_relationships (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                related_species_slug TEXT NOT NULL,
                relationship_type TEXT NOT NULL,
                description TEXT
            );
            CREATE TABLE translated_values (
                id TEXT PRIMARY KEY,
                field_name TEXT NOT NULL,
                value_en TEXT NOT NULL,
                value_fr TEXT,
                value_es TEXT,
                value_pt TEXT,
                value_it TEXT,
                value_zh TEXT
            );
            CREATE TABLE best_common_names (
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                PRIMARY KEY (species_id, language)
            );

            INSERT INTO species (id, slug, canonical_name, common_name, family, genus,
                height_min_m, height_max_m, width_max_m, hardiness_zone_min, hardiness_zone_max,
                soil_ph_min, soil_ph_max, drought_tolerance, frost_tender, growth_rate,
                is_annual, is_biennial, is_perennial, lifespan, habit, deciduous_evergreen,
                bloom_period, flower_color, tolerates_full_sun, tolerates_semi_shade, tolerates_full_shade,
                well_drained, nitrogen_fixer, stratum, edibility_rating, medicinal_rating,
                scented, toxicity, known_hazards, summary)
            VALUES (
                'uuid-lav', 'lavandula-angustifolia', 'Lavandula angustifolia',
                'Lavender', 'Lamiaceae', 'Lavandula',
                0.3, 0.6, 0.9, 5, 9, 6.0, 8.0,
                'Medium', 0, 'Slow',
                0, 0, 1, 'Short-lived perennial', 'Shrub', 'Evergreen',
                'Summer', 'Purple', 1, 1, 0,
                1, 0, 'Low', 3, 2,
                1, NULL, NULL, 'A popular aromatic herb'
            );
            INSERT INTO species (id, slug, canonical_name, common_name, family, genus,
                height_min_m, height_max_m, width_max_m, hardiness_zone_min, hardiness_zone_max,
                soil_ph_min, soil_ph_max, growth_rate,
                is_annual, is_biennial, is_perennial, habit, deciduous_evergreen,
                tolerates_full_sun, tolerates_semi_shade, tolerates_full_shade,
                nitrogen_fixer, stratum, edibility_rating, medicinal_rating,
                succession_stage, known_hazards)
            VALUES (
                'uuid-ald', 'alnus-glutinosa', 'Alnus glutinosa',
                'Alder', 'Betulaceae', 'Alnus',
                5.0, 20.0, 8.0, 1, 8, 5.5, 7.5,
                'Fast',
                0, 0, 1, 'Tree', 'Deciduous',
                1, 0, 0,
                1, 'Canopy', 0, 0,
                'secondary_i', 'None known'
            );

            INSERT INTO species_common_names VALUES
                ('cn1', 'uuid-lav', 'en', 'Lavender', NULL, 1),
                ('cn2', 'uuid-lav', 'fr', 'Lavande', NULL, 1),
                ('cn3', 'uuid-ald', 'en', 'Common Alder', NULL, 1);

            INSERT INTO species_uses VALUES
                ('u1', 'uuid-lav', 'Medicinal', 'Used in aromatherapy', NULL),
                ('u2', 'uuid-lav', 'Culinary', 'Edible flowers', NULL);

            INSERT INTO species_soil_types VALUES
                ('uuid-lav', 'Well-drained'),
                ('uuid-lav', 'Sandy'),
                ('uuid-ald', 'Clay'),
                ('uuid-ald', 'Boggy');

            INSERT INTO species_relationships VALUES
                ('r1', 'uuid-lav', 'alnus-glutinosa', 'companion', 'Attracts pollinators');

            INSERT INTO translated_values VALUES
                ('t1', 'growth_rate', 'Slow', 'Lent', NULL, NULL, NULL, NULL);

            INSERT INTO best_common_names VALUES
                ('uuid-lav', 'en', 'Lavender'),
                ('uuid-lav', 'fr', 'Lavande'),
                ('uuid-ald', 'en', 'Common Alder');
        ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_get_detail_returns_species() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(detail.canonical_name, "Lavandula angustifolia");
        assert_eq!(detail.family, "Lamiaceae");
        assert_eq!(detail.common_name.as_deref(), Some("Lavender"));
        // New fields
        assert_eq!(detail.drought_tolerance.as_deref(), Some("Medium"));
        assert_eq!(detail.bloom_period.as_deref(), Some("Summer"));
        assert_eq!(detail.flower_color.as_deref(), Some("Purple"));
        assert_eq!(detail.scented, Some(true));
        assert_eq!(detail.well_drained, Some(true));
        assert_eq!(detail.summary.as_deref(), Some("A popular aromatic herb"));
    }

    #[test]
    fn test_get_detail_locale_fallback() {
        let conn = test_db();
        // 'de' has no entry; should fall back to English "Lavender"
        let detail = get_detail(&conn, "Lavandula angustifolia", "de").unwrap();
        assert_eq!(detail.common_name.as_deref(), Some("Lavender"));
    }

    #[test]
    fn test_get_detail_locale_match() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "fr").unwrap();
        assert_eq!(detail.common_name.as_deref(), Some("Lavande"));
    }

    #[test]
    fn test_get_detail_uses() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(detail.uses.len(), 2);
        let categories: Vec<&str> = detail.uses.iter().map(|u| u.use_category.as_str()).collect();
        assert!(categories.contains(&"Medicinal"));
        assert!(categories.contains(&"Culinary"));
    }

    #[test]
    fn test_get_detail_soil_types() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(detail.soil_types.len(), 2);
        assert!(detail.soil_types.contains(&"Well-drained".to_owned()));
    }

    #[test]
    fn test_get_detail_relationships() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(detail.relationships.len(), 1);
        assert_eq!(detail.relationships[0].related_canonical_name, "Alnus glutinosa");
        assert_eq!(detail.relationships[0].relationship_type, "companion");
    }

    #[test]
    fn test_get_detail_nitrogen_fixer() {
        let conn = test_db();
        let detail = get_detail(&conn, "Alnus glutinosa", "en").unwrap();
        assert_eq!(detail.nitrogen_fixer, Some(true));
        assert_eq!(detail.is_perennial, Some(true));
        assert_eq!(detail.is_annual, Some(false));
        assert_eq!(detail.succession_stage.as_deref(), Some("secondary_i"));
        assert_eq!(detail.known_hazards.as_deref(), Some("None known"));
    }

    #[test]
    fn test_get_detail_translates_categorical_fields() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "fr").unwrap();
        // growth_rate "Slow" should be translated to "Lent" in French
        assert_eq!(detail.growth_rate.as_deref(), Some("Lent"));
        // deciduous_evergreen has no French translation in test data,
        // so it stays as English
        assert_eq!(detail.deciduous_evergreen.as_deref(), Some("Evergreen"));
    }

    #[test]
    fn test_get_filter_options() {
        let conn = test_db();
        let opts = get_filter_options(&conn).unwrap();
        assert!(opts.families.contains(&"Lamiaceae".to_owned()));
        assert!(opts.families.contains(&"Betulaceae".to_owned()));
        // life_cycles is now a hardcoded list (boolean columns replaced the string column)
        assert!(opts.life_cycles.contains(&"Perennial".to_owned()));
        assert!(opts.life_cycles.contains(&"Annual".to_owned()));
        assert!(opts.life_cycles.contains(&"Biennial".to_owned()));
        assert!(opts.soil_types.contains(&"Clay".to_owned()));
        assert!(opts.sun_tolerances.contains(&"full_sun".to_owned()));
        assert!(opts.hardiness_range.0 <= 1);
        assert!(opts.hardiness_range.1 >= 9);
    }

    #[test]
    fn test_get_common_name_locale() {
        let conn = test_db();
        assert_eq!(
            get_common_name(&conn, "uuid-lav", "fr"),
            Some("Lavande".to_owned())
        );
    }

    #[test]
    fn test_get_common_name_fallback_to_en() {
        let conn = test_db();
        assert_eq!(
            get_common_name(&conn, "uuid-lav", "de"),
            Some("Lavender".to_owned())
        );
    }

    #[test]
    fn test_get_common_name_missing_species() {
        let conn = test_db();
        assert_eq!(get_common_name(&conn, "uuid-nonexistent", "en"), None);
    }

    #[test]
    fn test_translate_value_found() {
        let conn = test_db();
        assert_eq!(translate_value(&conn, "growth_rate", "Slow", "fr"), "Lent");
    }

    #[test]
    fn test_translate_value_fallback() {
        let conn = test_db();
        // No German translation — returns the English value unchanged.
        assert_eq!(translate_value(&conn, "growth_rate", "Slow", "de"), "Slow");
    }

    #[test]
    fn test_get_detail_missing_species_returns_err() {
        let conn = test_db();
        let result = get_detail(&conn, "Nonexistent species", "en");
        assert!(result.is_err());
    }
}
