use std::collections::BTreeMap;

use rusqlite::Connection;

use super::{schema_contract, species_search_normalization};

pub(super) fn admit_prepared_catalog(connection: &Connection) -> Result<(), String> {
    let schema_version = connection
        .pragma_query_value::<i32, _>(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("failed to read prepared schema version: {error}"))?;
    if schema_version != schema_contract::EXPECTED_PLANT_SCHEMA_VERSION {
        return Err(format!(
            "prepared schema version {schema_version} does not equal required {}",
            schema_contract::EXPECTED_PLANT_SCHEMA_VERSION,
        ));
    }

    verify_prepared_identity(connection)?;
    initialize_search_connection(connection)
}

pub(crate) fn initialize_search_connection(connection: &Connection) -> Result<(), String> {
    species_search_normalization::register_sqlite_function(connection)
        .map_err(|error| format!("failed to register Species Search normalization: {error}"))?;
    ensure_search_initialized(connection)
}

pub(crate) fn ensure_search_initialized(connection: &Connection) -> Result<(), String> {
    let normalized = connection
        .query_row(
            "SELECT canopi_normalize_species_search('Straße')",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("Species Search connection is not initialized: {error}"))?;
    if normalized != "strasse" {
        return Err(
            "Species Search connection is not initialized with the admitted normalization"
                .to_owned(),
        );
    }
    Ok(())
}

fn verify_prepared_identity(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT key, value FROM species_search_metadata")
        .map_err(|error| format!("failed to read prepared search identity: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("failed to query prepared search identity: {error}"))?;
    let mut values_by_key = BTreeMap::<String, Vec<String>>::new();
    for row in rows {
        let (key, value) =
            row.map_err(|error| format!("failed to decode prepared search identity: {error}"))?;
        values_by_key.entry(key).or_default().push(value);
    }

    let expected = [
        (
            "schema_version",
            schema_contract::EXPECTED_PLANT_SCHEMA_VERSION.to_string(),
        ),
        (
            "storage_contract_fingerprint",
            schema_contract::SPECIES_STORAGE_CONTRACT_FINGERPRINT.to_owned(),
        ),
        (
            "normalization_version",
            schema_contract::SPECIES_SEARCH_NORMALIZATION_VERSION.to_string(),
        ),
        (
            "normalization_fingerprint",
            schema_contract::SPECIES_SEARCH_NORMALIZATION_FINGERPRINT.to_owned(),
        ),
    ];
    for (key, expected_value) in expected {
        let values = values_by_key.remove(key).unwrap_or_default();
        match values.as_slice() {
            [actual] if actual == &expected_value => {}
            [] => return Err(format!("prepared search identity is missing key {key:?}")),
            [_] => {
                return Err(format!(
                    "prepared search identity {key:?} does not match the required value"
                ));
            }
            _ => {
                return Err(format!(
                    "prepared search identity contains duplicate key {key:?}"
                ));
            }
        }
    }
    if let Some((key, _)) = values_by_key.first_key_value() {
        return Err(format!(
            "prepared search identity contains unexpected key {key:?}"
        ));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn stamp_expected_prepared_identity(connection: &Connection) {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS species_search_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            DELETE FROM species_search_metadata;",
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO species_search_metadata (key, value) VALUES (?1, ?2)",
            (
                "schema_version",
                schema_contract::EXPECTED_PLANT_SCHEMA_VERSION.to_string(),
            ),
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO species_search_metadata (key, value) VALUES (?1, ?2)",
            (
                "storage_contract_fingerprint",
                schema_contract::SPECIES_STORAGE_CONTRACT_FINGERPRINT,
            ),
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO species_search_metadata (key, value) VALUES (?1, ?2)",
            (
                "normalization_version",
                schema_contract::SPECIES_SEARCH_NORMALIZATION_VERSION.to_string(),
            ),
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO species_search_metadata (key, value) VALUES (?1, ?2)",
            (
                "normalization_fingerprint",
                schema_contract::SPECIES_SEARCH_NORMALIZATION_FINGERPRINT,
            ),
        )
        .unwrap();
    connection
        .pragma_update(
            None,
            "user_version",
            schema_contract::EXPECTED_PLANT_SCHEMA_VERSION,
        )
        .unwrap();
}
