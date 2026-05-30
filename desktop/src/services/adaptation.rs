use crate::contracts::adaptation::{CompatibilityResult, ReplacementSuggestion};
use crate::db::{PlantDb, require_plant_db};
use crate::services::species_catalog_read::SpeciesCatalogRead;

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

    let conn = require_plant_db(plant_db)?;
    let species_catalog = SpeciesCatalogRead::new(&conn);
    let rows = species_catalog.compatibility_rows_for_canonical_names(&canonical_names, &locale)?;
    let mut results = Vec::with_capacity(rows.len());
    for row in rows {
        let (is_compatible, zone_diff) =
            compute_zone_diff(row.hardiness_min, row.hardiness_max, target_hardiness);

        results.push(CompatibilityResult {
            species_id: row.species_id,
            canonical_name: row.canonical_name,
            common_name: row.common_name,
            hardiness_min: row.hardiness_min,
            hardiness_max: row.hardiness_max,
            is_compatible,
            zone_diff,
        });
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
    let conn = require_plant_db(plant_db)?;
    let species_catalog = SpeciesCatalogRead::new(&conn);
    species_catalog
        .replacement_rows_for_species(&canonical_name, target_hardiness, limit, &locale)
        .map(|rows| {
            rows.into_iter()
                .map(|row| ReplacementSuggestion {
                    canonical_name: row.canonical_name,
                    common_name: row.common_name,
                    hardiness_min: row.hardiness_min,
                    hardiness_max: row.hardiness_max,
                    stratum: row.stratum,
                    height_max_m: row.height_max_m,
                })
                .collect()
        })
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

        PlantDb::available(conn)
    }

    #[test]
    fn compatibility_returns_explicit_error_when_plant_db_missing() {
        let plant_db = PlantDb::missing();

        let error = check_plant_compatibility(
            &plant_db,
            vec!["Malus domestica".to_owned()],
            7,
            "en".to_owned(),
        )
        .unwrap_err();

        assert!(error.contains("Plant database unavailable"));
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

        let names: Vec<&str> = results
            .iter()
            .map(|item| item.canonical_name.as_str())
            .collect();
        assert_eq!(names, vec!["Pear", "Apple"]);
    }

    #[test]
    fn replacements_prefer_same_stratum_height_and_stable_order() {
        let plant_db = test_plant_db();
        let results = suggest_replacements(&plant_db, "Apple".into(), 6, 20, "en".into()).unwrap();
        let names: Vec<&str> = results
            .iter()
            .map(|item| item.canonical_name.as_str())
            .collect();

        assert_eq!(names, vec!["Apricot", "Pear", "Plum"]);
        assert_eq!(results[0].common_name.as_deref(), Some("Apricot"));
    }

    #[test]
    fn replacements_limit_is_capped_and_missing_source_falls_back_to_broad_matches() {
        let plant_db = test_plant_db();
        let broad = suggest_replacements(&plant_db, "Unknown".into(), 6, 99, "en".into()).unwrap();
        assert!(broad.len() <= 20);
        let names: Vec<&str> = broad
            .iter()
            .map(|item| item.canonical_name.as_str())
            .collect();
        assert_eq!(
            names,
            vec!["Apricot", "Quince", "Apple", "Currant", "Pear", "Plum"]
        );
    }
}
