use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, params_from_iter};

use super::common_names;
use super::sql::ProjectionParams;

const MAX_REPLACEMENT_SUGGESTIONS: u32 = 20;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SpeciesReplacementProjection {
    pub(crate) canonical_name: String,
    pub(crate) common_name: Option<String>,
    pub(crate) hardiness_min: Option<i32>,
    pub(crate) hardiness_max: Option<i32>,
    pub(crate) stratum: Option<String>,
    pub(crate) height_max_m: Option<f32>,
}

pub(super) fn read_projection(
    conn: &Connection,
    canonical_name: &str,
    target_hardiness: i32,
    limit: u32,
    locale: &str,
) -> Result<Vec<SpeciesReplacementProjection>, String> {
    let source = replacement_source_for_species(conn, canonical_name)?;
    let query = ReplacementProjectionQuery::build(canonical_name, target_hardiness, limit, source);

    let mut stmt = conn
        .prepare(&query.sql)
        .map_err(|e| format!("Failed to prepare replacement projection: {e}"))?;
    let rows = stmt
        .query_map(params_from_iter(query.params.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i32>>(2)?,
                row.get::<_, Option<i32>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<f32>>(5)?,
            ))
        })
        .map_err(|e| format!("Failed to query replacement projection: {e}"))?;

    let mut suggestions = Vec::new();
    for row in rows {
        let (species_id, canonical_name, hardiness_min, hardiness_max, stratum, height_max_m) =
            row.map_err(|e| format!("Failed to read replacement projection row: {e}"))?;
        suggestions.push(SpeciesReplacementProjection {
            common_name: common_names::localized_name_for_species_id(conn, &species_id, locale),
            canonical_name,
            hardiness_min,
            hardiness_max,
            stratum,
            height_max_m,
        });
    }

    Ok(suggestions)
}

struct ReplacementProjectionQuery {
    sql: String,
    params: Vec<Value>,
}

impl ReplacementProjectionQuery {
    fn build(
        canonical_name: &str,
        target_hardiness: i32,
        limit: u32,
        source: SpeciesReplacementSource,
    ) -> Self {
        let mut params = ProjectionParams::default();
        let source_name = params.push(Value::Text(canonical_name.to_owned()));
        let target_zone = params.push(Value::Integer(i64::from(target_hardiness)));
        let mut where_clauses = vec![
            format!("s.canonical_name != {source_name}"),
            "s.hardiness_zone_min IS NOT NULL".to_owned(),
            "s.hardiness_zone_max IS NOT NULL".to_owned(),
            format!("s.hardiness_zone_min <= {target_zone}"),
            format!("s.hardiness_zone_max >= {target_zone}"),
        ];

        if let Some(source_stratum) = source.stratum {
            let stratum = params.push(Value::Text(source_stratum));
            where_clauses.push(format!("s.stratum = {stratum}"));
        }

        if let Some(source_height) = source.height_max_m {
            let min_height = source_height * 0.5;
            let max_height = source_height * 1.5;
            let min_height = params.push(Value::Real(f64::from(min_height)));
            where_clauses.push(format!("s.height_max_m >= {min_height}"));
            let max_height = params.push(Value::Real(f64::from(max_height)));
            where_clauses.push(format!("s.height_max_m <= {max_height}"));
        }

        let limit = params.push(Value::Integer(i64::from(
            limit.min(MAX_REPLACEMENT_SUGGESTIONS),
        )));

        let sql = format!(
            "SELECT s.id, s.canonical_name, s.hardiness_zone_min, s.hardiness_zone_max,
                    s.stratum, s.height_max_m
             FROM species s
             WHERE {}
             ORDER BY ABS(s.hardiness_zone_min - {target_zone}) ASC, s.canonical_name ASC
             LIMIT {limit}",
            where_clauses.join(" AND ")
        );

        Self {
            sql,
            params: params.into_values(),
        }
    }
}

fn replacement_source_for_species(
    conn: &Connection,
    canonical_name: &str,
) -> Result<SpeciesReplacementSource, String> {
    let source = conn
        .query_row(
            "SELECT s.stratum, s.height_max_m FROM species s WHERE s.canonical_name = ?1",
            [canonical_name],
            |row| {
                Ok(SpeciesReplacementSource {
                    stratum: row.get(0)?,
                    height_max_m: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to look up replacement source species: {e}"))?
        .unwrap_or_default();

    Ok(source)
}

#[derive(Default)]
struct SpeciesReplacementSource {
    stratum: Option<String>,
    height_max_m: Option<f32>,
}
