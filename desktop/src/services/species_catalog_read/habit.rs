use std::collections::HashMap;

use rusqlite::{Connection, params_from_iter};

const MAX_BATCH_NAMES: usize = 500;

/// Catalog habit (`Tree`, `Shrub`, ...) per canonical name; species without a habit are absent.
pub fn get_species_habits_batch(
    conn: &Connection,
    canonical_names: &[String],
) -> Result<HashMap<String, String>, String> {
    if canonical_names.is_empty() {
        return Ok(HashMap::new());
    }
    if canonical_names.len() > MAX_BATCH_NAMES {
        return Err(format!(
            "Batch size exceeds maximum of {MAX_BATCH_NAMES} names"
        ));
    }

    let placeholders = std::iter::repeat_n("?", canonical_names.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT canonical_name, habit
         FROM species
         WHERE canonical_name IN ({placeholders})
           AND habit IS NOT NULL AND habit <> ''"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare species habit query: {e}"))?;
    let rows = stmt
        .query_map(params_from_iter(canonical_names.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Species habit query failed: {e}"))?;

    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|e| format!("Failed to read species habit row: {e}"))
}

pub(super) fn read_projection(
    conn: &Connection,
    canonical_names: &[String],
) -> Result<HashMap<String, String>, String> {
    get_species_habits_batch(conn, canonical_names)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn habit_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id TEXT PRIMARY KEY,
                canonical_name TEXT NOT NULL,
                habit TEXT
            );
            INSERT INTO species (id, canonical_name, habit) VALUES
                ('s1', 'Malus domestica', 'Tree'),
                ('s2', 'Ribes nigrum', 'Shrub'),
                ('s3', 'Mentha spicata', NULL),
                ('s4', 'Vitis vinifera', ''),
                ('s5', 'Allium ursinum', 'Herbaceous');",
        )
        .unwrap();
        conn
    }

    fn names(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn returns_habits_for_requested_species_only() {
        let conn = habit_db();
        let habits = get_species_habits_batch(
            &conn,
            &names(&["Malus domestica", "Ribes nigrum", "Missing species"]),
        )
        .unwrap();

        assert_eq!(habits.len(), 2);
        assert_eq!(habits["Malus domestica"], "Tree");
        assert_eq!(habits["Ribes nigrum"], "Shrub");
    }

    #[test]
    fn null_and_empty_habits_are_absent() {
        let conn = habit_db();
        let habits =
            get_species_habits_batch(&conn, &names(&["Mentha spicata", "Vitis vinifera"])).unwrap();

        assert!(habits.is_empty());
    }

    #[test]
    fn empty_input_short_circuits() {
        // No species table: an empty request must not touch the database.
        let conn = Connection::open_in_memory().unwrap();
        assert!(get_species_habits_batch(&conn, &[]).unwrap().is_empty());
    }

    #[test]
    fn batch_limit_is_enforced() {
        let conn = habit_db();
        let at_limit: Vec<String> = (0..MAX_BATCH_NAMES).map(|i| format!("n{i}")).collect();
        assert!(
            get_species_habits_batch(&conn, &at_limit)
                .unwrap()
                .is_empty()
        );

        let over_limit: Vec<String> = (0..=MAX_BATCH_NAMES).map(|i| format!("n{i}")).collect();
        let error = get_species_habits_batch(&conn, &over_limit).unwrap_err();
        assert!(error.contains("maximum of 500"));
    }
}
