use std::collections::HashMap;

use rusqlite::{Connection, params_from_iter};

use super::common_names;
use super::sql;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SpeciesCompatibilityProjection {
    pub(crate) species_id: String,
    pub(crate) canonical_name: String,
    pub(crate) common_name: Option<String>,
    pub(crate) hardiness_min: Option<i32>,
    pub(crate) hardiness_max: Option<i32>,
}

pub(super) fn read_projection(
    conn: &Connection,
    canonical_names: &[String],
    locale: &str,
) -> Result<Vec<SpeciesCompatibilityProjection>, String> {
    if canonical_names.is_empty() {
        return Ok(Vec::new());
    }

    let sql = format!(
        "SELECT s.id, s.canonical_name, s.hardiness_zone_min, s.hardiness_zone_max
         FROM species s
         WHERE s.canonical_name IN ({})",
        sql::placeholders(canonical_names.len())
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare compatibility projection: {e}"))?;

    let rows = stmt
        .query_map(params_from_iter(canonical_names.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i32>>(2)?,
                row.get::<_, Option<i32>>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to query compatibility projection: {e}"))?;

    let mut by_name = HashMap::new();
    for row in rows {
        let (species_id, canonical_name, hardiness_min, hardiness_max) =
            row.map_err(|e| format!("Failed to read compatibility projection row: {e}"))?;
        by_name.insert(
            canonical_name.clone(),
            SpeciesCompatibilityProjection {
                common_name: common_names::localized_name_for_species_id(conn, &species_id, locale),
                species_id,
                canonical_name,
                hardiness_min,
                hardiness_max,
            },
        );
    }

    let mut results = Vec::with_capacity(by_name.len());
    for canonical_name in canonical_names {
        if let Some(row) = by_name.remove(canonical_name) {
            results.push(row);
        }
    }

    Ok(results)
}
