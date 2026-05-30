use std::collections::HashMap;

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, params_from_iter};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SpeciesCompatibilityReadRow {
    pub(crate) species_id: String,
    pub(crate) canonical_name: String,
    pub(crate) common_name: Option<String>,
    pub(crate) hardiness_min: Option<i32>,
    pub(crate) hardiness_max: Option<i32>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SpeciesReplacementReadRow {
    pub(crate) canonical_name: String,
    pub(crate) common_name: Option<String>,
    pub(crate) hardiness_min: Option<i32>,
    pub(crate) hardiness_max: Option<i32>,
    pub(crate) stratum: Option<String>,
    pub(crate) height_max_m: Option<f32>,
}

pub(crate) struct SpeciesCatalogRead<'conn> {
    conn: &'conn Connection,
}

impl<'conn> SpeciesCatalogRead<'conn> {
    pub(crate) fn new(conn: &'conn Connection) -> Self {
        Self { conn }
    }

    pub(crate) fn common_name_for_species_id(
        &self,
        species_id: &str,
        locale: &str,
    ) -> Option<String> {
        crate::db::plant_db::get_common_name(self.conn, species_id, locale)
    }

    pub(crate) fn common_names_for_canonical_names(
        &self,
        canonical_names: &[String],
        locale: &str,
    ) -> Result<HashMap<String, String>, String> {
        crate::db::plant_db::get_common_names_batch(self.conn, canonical_names, locale)
    }

    pub(crate) fn compatibility_rows_for_canonical_names(
        &self,
        canonical_names: &[String],
        locale: &str,
    ) -> Result<Vec<SpeciesCompatibilityReadRow>, String> {
        if canonical_names.is_empty() {
            return Ok(Vec::new());
        }

        let sql = format!(
            "SELECT s.id, s.canonical_name, s.hardiness_zone_min, s.hardiness_zone_max
             FROM species s
             WHERE s.canonical_name IN ({})",
            placeholders(canonical_names.len())
        );

        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare compatibility query: {e}"))?;

        let rows = stmt
            .query_map(params_from_iter(canonical_names.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i32>>(2)?,
                    row.get::<_, Option<i32>>(3)?,
                ))
            })
            .map_err(|e| format!("Failed to query compatibility: {e}"))?;

        let mut by_name = HashMap::new();
        for row in rows {
            let (species_id, canonical_name, hardiness_min, hardiness_max) =
                row.map_err(|e| format!("Failed to read compatibility row: {e}"))?;
            by_name.insert(
                canonical_name.clone(),
                SpeciesCompatibilityReadRow {
                    common_name: self.common_name_for_species_id(&species_id, locale),
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

    pub(crate) fn replacement_rows_for_species(
        &self,
        canonical_name: &str,
        target_hardiness: i32,
        limit: u32,
        locale: &str,
    ) -> Result<Vec<SpeciesReplacementReadRow>, String> {
        let source = self.replacement_source_for_species(canonical_name)?;

        let mut where_clauses = vec![
            "s.canonical_name != ?1".to_owned(),
            "s.hardiness_zone_min IS NOT NULL".to_owned(),
            "s.hardiness_zone_max IS NOT NULL".to_owned(),
            "s.hardiness_zone_min <= ?2".to_owned(),
            "s.hardiness_zone_max >= ?2".to_owned(),
        ];
        let mut params = vec![
            Value::Text(canonical_name.to_owned()),
            Value::Integer(i64::from(target_hardiness)),
        ];

        if let Some(source_stratum) = source.stratum {
            params.push(Value::Text(source_stratum));
            where_clauses.push(format!("s.stratum = ?{}", params.len()));
        }

        if let Some(source_height) = source.height_max_m {
            let min_height = source_height * 0.5;
            let max_height = source_height * 1.5;
            params.push(Value::Real(f64::from(min_height)));
            where_clauses.push(format!("s.height_max_m >= ?{}", params.len()));
            params.push(Value::Real(f64::from(max_height)));
            where_clauses.push(format!("s.height_max_m <= ?{}", params.len()));
        }

        params.push(Value::Integer(i64::from(limit.min(20))));
        let limit_idx = params.len();

        let sql = format!(
            "SELECT s.id, s.canonical_name, s.hardiness_zone_min, s.hardiness_zone_max,
                    s.stratum, s.height_max_m
             FROM species s
             WHERE {}
             ORDER BY ABS(s.hardiness_zone_min - ?2) ASC, s.canonical_name ASC
             LIMIT ?{limit_idx}",
            where_clauses.join(" AND ")
        );

        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare replacements query: {e}"))?;
        let rows = stmt
            .query_map(params_from_iter(params.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i32>>(2)?,
                    row.get::<_, Option<i32>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<f32>>(5)?,
                ))
            })
            .map_err(|e| format!("Failed to query replacements: {e}"))?;

        let mut suggestions = Vec::new();
        for row in rows {
            let (species_id, canonical_name, hardiness_min, hardiness_max, stratum, height_max_m) =
                row.map_err(|e| format!("Failed to read replacement row: {e}"))?;
            suggestions.push(SpeciesReplacementReadRow {
                common_name: self.common_name_for_species_id(&species_id, locale),
                canonical_name,
                hardiness_min,
                hardiness_max,
                stratum,
                height_max_m,
            });
        }

        Ok(suggestions)
    }

    fn replacement_source_for_species(
        &self,
        canonical_name: &str,
    ) -> Result<SpeciesReplacementSource, String> {
        let source = self
            .conn
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
            .map_err(|e| format!("Failed to look up source species: {e}"))?
            .unwrap_or_default();

        Ok(source)
    }
}

#[derive(Default)]
struct SpeciesReplacementSource {
    stratum: Option<String>,
    height_max_m: Option<f32>,
}

fn placeholders(count: usize) -> String {
    (0..count).map(|_| "?").collect::<Vec<_>>().join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id TEXT PRIMARY KEY,
                canonical_name TEXT NOT NULL,
                hardiness_zone_min INTEGER,
                hardiness_zone_max INTEGER,
                stratum TEXT,
                height_max_m REAL
            );
            CREATE TABLE best_common_names (
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                PRIMARY KEY (species_id, language)
            );
            CREATE TABLE species_common_names (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                source TEXT,
                is_primary INTEGER DEFAULT 1
            );
            INSERT INTO species VALUES
                ('s1', 'Apple', 4, 8, 'canopy', 8.0),
                ('s2', 'Pear', 4, 8, 'canopy', 7.0),
                ('s3', 'Plum', 4, 8, 'canopy', 6.0),
                ('s4', 'Currant', 4, 8, 'shrub', 1.5),
                ('s5', 'Apricot', 6, 8, 'canopy', 9.0);
            INSERT INTO best_common_names VALUES
                ('s1', 'en', 'Apple'),
                ('s1', 'fr', 'Pommier'),
                ('s2', 'fr', 'Poirier'),
                ('s5', 'en', 'Apricot');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn compatibility_rows_preserve_input_order_and_locale_names() {
        let conn = test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let rows = catalog
            .compatibility_rows_for_canonical_names(
                &["Pear".to_owned(), "Missing".to_owned(), "Apple".to_owned()],
                "fr",
            )
            .unwrap();

        let names: Vec<&str> = rows.iter().map(|row| row.canonical_name.as_str()).collect();

        assert_eq!(names, vec!["Pear", "Apple"]);
        assert_eq!(rows[0].common_name.as_deref(), Some("Poirier"));
        assert_eq!(rows[1].common_name.as_deref(), Some("Pommier"));
    }

    #[test]
    fn replacement_rows_keep_storage_query_inside_catalog_read() {
        let conn = test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let rows = catalog
            .replacement_rows_for_species("Apple", 6, 99, "en")
            .unwrap();

        let names: Vec<&str> = rows.iter().map(|row| row.canonical_name.as_str()).collect();

        assert_eq!(names, vec!["Apricot", "Pear", "Plum"]);
        assert!(rows.len() <= 20);
        assert_eq!(rows[0].common_name.as_deref(), Some("Apricot"));
    }
}
