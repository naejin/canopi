use crate::db::{PlantDb, acquire};
use crate::contracts::adaptation::{CompatibilityResult, ReplacementSuggestion};
use rusqlite::types::ToSql;

pub fn check_plant_compatibility(
    plant_db: &PlantDb,
    canonical_names: Vec<String>,
    target_hardiness: i32,
    locale: String,
) -> Result<Vec<CompatibilityResult>, String> {
    if canonical_names.is_empty() {
        return Ok(Vec::new());
    }
    if canonical_names.len() > 500 {
        return Err("Batch size exceeds maximum of 500 names".into());
    }

    let conn = acquire(&plant_db.0, "PlantDb");
    let placeholders = canonical_names
        .iter()
        .enumerate()
        .map(|(index, _)| format!("?{}", index + 1))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT s.id, s.canonical_name, s.hardiness_zone_min, s.hardiness_zone_max
         FROM species s
         WHERE s.canonical_name IN ({placeholders})"
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare compatibility query: {e}"))?;

    let params: Vec<&dyn ToSql> = canonical_names.iter().map(|name| name as &dyn ToSql).collect();

    let rows = stmt
        .query_map(params.as_slice(), |row| -> rusqlite::Result<_> {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i32>>(2)?,
                row.get::<_, Option<i32>>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to query compatibility: {e}"))?;

    let mut by_name = std::collections::HashMap::new();
    for row in rows {
        let (species_id, canonical_name, hardiness_min, hardiness_max) =
            row.map_err(|e| format!("Failed to read row: {e}"))?;
        let common_name = crate::db::plant_db::get_common_name(&conn, &species_id, &locale);
        let (is_compatible, zone_diff) =
            compute_zone_diff(hardiness_min, hardiness_max, target_hardiness);

        by_name.insert(canonical_name.clone(), CompatibilityResult {
            species_id,
            canonical_name,
            common_name,
            hardiness_min,
            hardiness_max,
            is_compatible,
            zone_diff,
        });
    }

    let mut results = Vec::with_capacity(by_name.len());
    for canonical_name in canonical_names {
        if let Some(result) = by_name.remove(&canonical_name) {
            results.push(result);
        }
    }

    Ok(results)
}

pub fn suggest_replacements(
    plant_db: &PlantDb,
    canonical_name: String,
    target_hardiness: i32,
    limit: u32,
    locale: String,
) -> Result<Vec<ReplacementSuggestion>, String> {
    let conn = acquire(&plant_db.0, "PlantDb");

    let source: Option<(Option<String>, Option<f32>)> = conn
        .query_row(
            "SELECT s.stratum, s.height_max_m FROM species s WHERE s.canonical_name = ?1",
            [&canonical_name],
            |row| -> rusqlite::Result<_> { Ok((row.get(0)?, row.get(1)?)) },
        )
        .map_err(|e| format!("Failed to look up source species: {e}"))
        .ok();

    let (stratum, height) = source.unwrap_or((None, None));

    let mut where_clauses = vec![
        "s.canonical_name != ?1".to_owned(),
        "s.hardiness_zone_min IS NOT NULL".to_owned(),
        "s.hardiness_zone_max IS NOT NULL".to_owned(),
        "s.hardiness_zone_min <= ?2".to_owned(),
        "s.hardiness_zone_max >= ?2".to_owned(),
    ];
    let mut params: Vec<Box<dyn ToSql>> =
        vec![Box::new(canonical_name.clone()), Box::new(target_hardiness)];

    if let Some(ref source_stratum) = stratum {
        params.push(Box::new(source_stratum.clone()));
        where_clauses.push(format!("s.stratum = ?{}", params.len()));
    }

    if let Some(source_height) = height {
        let min_height = source_height * 0.5;
        let max_height = source_height * 1.5;
        params.push(Box::new(min_height));
        where_clauses.push(format!("s.height_max_m >= ?{}", params.len()));
        params.push(Box::new(max_height));
        where_clauses.push(format!("s.height_max_m <= ?{}", params.len()));
    }

    params.push(Box::new(limit.min(20)));
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

    let param_refs: Vec<&dyn ToSql> = params
        .iter()
        .map(|value| value.as_ref() as &dyn ToSql)
        .collect();

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare replacements query: {e}"))?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| -> rusqlite::Result<_> {
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
        let common_name = crate::db::plant_db::get_common_name(&conn, &species_id, &locale);
        suggestions.push(ReplacementSuggestion {
            canonical_name,
            common_name,
            hardiness_min,
            hardiness_max,
            stratum,
            height_max_m,
        });
    }

    Ok(suggestions)
}

/// Returns `(is_compatible, zone_diff)`.
fn compute_zone_diff(
    hardiness_min: Option<i32>,
    hardiness_max: Option<i32>,
    target: i32,
) -> (bool, i32) {
    match (hardiness_min, hardiness_max) {
        (Some(min), Some(max)) => {
            if target >= min && target <= max {
                (true, 0)
            } else if target < min {
                let diff = min - target;
                (diff <= 2, diff)
            } else {
                let diff = target - max;
                (diff <= 2, diff)
            }
        }
        (Some(min), None) => {
            if target >= min {
                (true, 0)
            } else {
                let diff = min - target;
                (diff <= 2, diff)
            }
        }
        (None, Some(max)) => {
            if target <= max {
                (true, 0)
            } else {
                let diff = target - max;
                (diff <= 2, diff)
            }
        }
        (None, None) => (true, 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::PlantDb;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn test_plant_db() -> PlantDb {
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
            );",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO species (id, canonical_name, hardiness_zone_min, hardiness_zone_max, stratum, height_max_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            ("s1", "Apple", 4, 8, "canopy", 8.0_f32),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO species (id, canonical_name, hardiness_zone_min, hardiness_zone_max, stratum, height_max_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            ("s2", "Pear", 4, 8, "canopy", 7.0_f32),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO species (id, canonical_name, hardiness_zone_min, hardiness_zone_max, stratum, height_max_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            ("s3", "Plum", 4, 8, "canopy", 6.0_f32),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO species (id, canonical_name, hardiness_zone_min, hardiness_zone_max, stratum, height_max_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            ("s4", "Currant", 4, 8, "shrub", 1.5_f32),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO species (id, canonical_name, hardiness_zone_min, hardiness_zone_max, stratum, height_max_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            ("s5", "Quince", 5, 8, "canopy", 20.0_f32),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO species (id, canonical_name, hardiness_zone_min, hardiness_zone_max, stratum, height_max_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            ("s6", "Apricot", 6, 8, "canopy", 9.0_f32),
        )
        .unwrap();

        for (species_id, language, common_name) in [
            ("s1", "en", "Apple"),
            ("s1", "fr", "Pommier"),
            ("s2", "en", "Pear"),
            ("s2", "fr", "Poirier"),
            ("s3", "en", "Plum"),
            ("s4", "en", "Currant"),
            ("s5", "en", "Quince"),
            ("s6", "en", "Apricot"),
        ] {
            conn.execute(
                "INSERT INTO best_common_names (species_id, language, common_name) VALUES (?1, ?2, ?3)",
                (species_id, language, common_name),
            )
            .unwrap();
        }

        PlantDb(Mutex::new(conn))
    }

    #[test]
    fn zone_diff_semantics_cover_known_cases() {
        assert_eq!(compute_zone_diff(Some(3), Some(8), 5), (true, 0));
        assert_eq!(compute_zone_diff(Some(3), Some(8), 2), (true, 1));
        assert_eq!(compute_zone_diff(Some(3), Some(8), 11), (false, 3));
        assert_eq!(compute_zone_diff(None, None, 5), (true, 0));
        assert_eq!(compute_zone_diff(None, Some(7), 10), (false, 3));
    }

    #[test]
    fn compatibility_handles_empty_and_batch_limit() {
        let plant_db = test_plant_db();
        assert_eq!(
            check_plant_compatibility(&plant_db, Vec::new(), 6, "en".into()).unwrap(),
            Vec::<CompatibilityResult>::new()
        );

        let names = (0..501).map(|index| format!("Species {index}")).collect();
        let error = check_plant_compatibility(&plant_db, names, 6, "en".into()).unwrap_err();
        assert!(error.contains("Batch size exceeds maximum"));
    }

    #[test]
    fn compatibility_hydrates_locale_common_names() {
        let plant_db = test_plant_db();
        let results = check_plant_compatibility(
            &plant_db,
            vec!["Apple".into(), "Pear".into()],
            6,
            "fr".into(),
        )
        .unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].common_name.as_deref(), Some("Pommier"));
        assert_eq!(results[1].common_name.as_deref(), Some("Poirier"));
        assert!(results.iter().all(|result| result.is_compatible));
    }

    #[test]
    fn compatibility_preserves_input_order_for_found_species() {
        let plant_db = test_plant_db();
        let results = check_plant_compatibility(
            &plant_db,
            vec!["Pear".into(), "Missing".into(), "Apple".into()],
            6,
            "en".into(),
        )
        .unwrap();

        let names: Vec<&str> = results.iter().map(|item| item.canonical_name.as_str()).collect();
        assert_eq!(names, vec!["Pear", "Apple"]);
    }

    #[test]
    fn replacements_prefer_same_stratum_height_and_stable_order() {
        let plant_db = test_plant_db();
        let results = suggest_replacements(&plant_db, "Apple".into(), 6, 20, "en".into()).unwrap();
        let names: Vec<&str> = results.iter().map(|item| item.canonical_name.as_str()).collect();

        assert_eq!(names, vec!["Apricot", "Pear", "Plum"]);
        assert_eq!(results[0].common_name.as_deref(), Some("Apricot"));
    }

    #[test]
    fn replacements_limit_is_capped_and_missing_source_falls_back_to_broad_matches() {
        let plant_db = test_plant_db();
        let broad = suggest_replacements(&plant_db, "Unknown".into(), 6, 99, "en".into()).unwrap();
        assert!(broad.len() <= 20);
        let names: Vec<&str> = broad.iter().map(|item| item.canonical_name.as_str()).collect();
        assert_eq!(names, vec!["Apricot", "Quince", "Apple", "Currant", "Pear", "Plum"]);
    }
}
