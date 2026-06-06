use rusqlite::Connection;

use crate::db::PlantDb;

pub(crate) fn test_conn() -> Connection {
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

    for (species_id, canonical_name, min, max, stratum, height) in [
        ("s1", "Apple", 4, 8, "canopy", 8.0_f32),
        ("s2", "Pear", 4, 8, "canopy", 7.0_f32),
        ("s3", "Plum", 4, 8, "canopy", 6.0_f32),
        ("s4", "Currant", 4, 8, "shrub", 1.5_f32),
        ("s5", "Quince", 5, 8, "canopy", 20.0_f32),
        ("s6", "Apricot", 6, 8, "canopy", 9.0_f32),
    ] {
        conn.execute(
            "INSERT INTO species (id, canonical_name, hardiness_zone_min, hardiness_zone_max, stratum, height_max_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (species_id, canonical_name, min, max, stratum, height),
        )
        .unwrap();
    }

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

    conn
}

pub(crate) fn test_plant_db() -> PlantDb {
    PlantDb::available(test_conn())
}
