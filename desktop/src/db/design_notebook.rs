use common_types::design::{DesignNotebookEntry, DesignNotebookSection, DesignSummary};
use rusqlite::Connection;

pub fn record_design_reference(
    conn: &Connection,
    path: &str,
    name: &str,
    plant_count: u32,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO design_notebook_entries (
            path,
            name,
            updated_at,
            plant_count,
            created_at,
            last_opened
         )
         VALUES (?1, ?2, datetime('now'), ?3, datetime('now'), datetime('now'))
         ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            updated_at = excluded.updated_at,
            plant_count = excluded.plant_count,
            last_opened = excluded.last_opened",
        rusqlite::params![path, name, plant_count],
    )?;
    Ok(())
}

pub fn get_design_notebook_entries(
    conn: &Connection,
) -> Result<Vec<DesignSummary>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT path, name, updated_at, plant_count
         FROM design_notebook_entries
         ORDER BY last_opened DESC, created_at DESC, path ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(DesignSummary {
            path: row.get(0)?,
            name: row.get(1)?,
            updated_at: row.get(2)?,
            plant_count: row.get(3)?,
        })
    })?;

    rows.collect()
}

pub fn remove_design_reference(conn: &Connection, path: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM design_notebook_section_memberships WHERE path = ?1",
        rusqlite::params![path],
    )?;
    conn.execute(
        "DELETE FROM design_notebook_entries WHERE path = ?1",
        rusqlite::params![path],
    )?;
    Ok(())
}

pub fn create_notebook_section(
    conn: &Connection,
    name: &str,
) -> Result<DesignNotebookSection, rusqlite::Error> {
    conn.execute(
        "INSERT INTO design_notebook_sections (id, name, created_at, updated_at)
         VALUES ('section-' || lower(hex(randomblob(16))), ?1, datetime('now'), datetime('now'))",
        rusqlite::params![name],
    )?;

    let row_id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, name, created_at, updated_at
         FROM design_notebook_sections
         WHERE rowid = ?1",
        rusqlite::params![row_id],
        notebook_section_from_row,
    )
}

pub fn get_notebook_sections(
    conn: &Connection,
) -> Result<Vec<DesignNotebookSection>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, updated_at
         FROM design_notebook_sections
         ORDER BY created_at ASC, id ASC",
    )?;

    let rows = stmt.query_map([], notebook_section_from_row)?;
    rows.collect()
}

pub fn rename_notebook_section(
    conn: &Connection,
    section_id: &str,
    name: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE design_notebook_sections
         SET name = ?2, updated_at = datetime('now')
         WHERE id = ?1",
        rusqlite::params![section_id, name],
    )?;
    Ok(())
}

pub fn delete_notebook_section(conn: &Connection, section_id: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM design_notebook_section_memberships WHERE section_id = ?1",
        rusqlite::params![section_id],
    )?;
    conn.execute(
        "DELETE FROM design_notebook_sections WHERE id = ?1",
        rusqlite::params![section_id],
    )?;
    Ok(())
}

pub fn assign_design_reference_to_section(
    conn: &Connection,
    path: &str,
    section_id: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO design_notebook_section_memberships (path, section_id, created_at, updated_at)
         VALUES (?1, ?2, datetime('now'), datetime('now'))
         ON CONFLICT(path) DO UPDATE SET
            section_id = excluded.section_id,
            updated_at = excluded.updated_at",
        rusqlite::params![path, section_id],
    )?;
    Ok(())
}

pub fn remove_design_reference_from_section(
    conn: &Connection,
    path: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM design_notebook_section_memberships WHERE path = ?1",
        rusqlite::params![path],
    )?;
    Ok(())
}

pub fn get_design_notebook_entries_with_sections(
    conn: &Connection,
) -> Result<Vec<DesignNotebookEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT e.path, e.name, e.updated_at, e.plant_count, m.section_id
         FROM design_notebook_entries e
         LEFT JOIN design_notebook_section_memberships m ON m.path = e.path
         ORDER BY e.last_opened DESC, e.created_at DESC, e.path ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(DesignNotebookEntry {
            path: row.get(0)?,
            name: row.get(1)?,
            updated_at: row.get(2)?,
            plant_count: row.get(3)?,
            section_id: row.get(4)?,
        })
    })?;

    rows.collect()
}

fn notebook_section_from_row(
    row: &rusqlite::Row<'_>,
) -> Result<DesignNotebookSection, rusqlite::Error> {
    Ok(DesignNotebookSection {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE design_notebook_entries (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                plant_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                last_opened TEXT NOT NULL
            );

            CREATE TABLE design_notebook_sections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE design_notebook_section_memberships (
                path TEXT PRIMARY KEY,
                section_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn records_and_lists_saved_design_references() {
        let conn = test_db();

        super::record_design_reference(&conn, "/designs/forest.canopi", "Forest Edge", 7).unwrap();

        let entries = super::get_design_notebook_entries(&conn).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "/designs/forest.canopi");
        assert_eq!(entries[0].name, "Forest Edge");
        assert_eq!(entries[0].plant_count, 7);
    }

    #[test]
    fn removes_saved_design_references() {
        let conn = test_db();
        super::record_design_reference(&conn, "/designs/forest.canopi", "Forest Edge", 7).unwrap();

        super::remove_design_reference(&conn, "/designs/forest.canopi").unwrap();

        assert!(
            super::get_design_notebook_entries(&conn)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn creates_renames_and_deletes_notebook_sections() {
        let conn = test_db();

        let section = super::create_notebook_section(&conn, "Client work").unwrap();

        assert!(section.id.starts_with("section-"));
        assert_eq!(section.name, "Client work");
        assert_eq!(super::get_notebook_sections(&conn).unwrap().len(), 1);

        super::rename_notebook_section(&conn, &section.id, "Food forests").unwrap();
        assert_eq!(
            super::get_notebook_sections(&conn).unwrap()[0].name,
            "Food forests"
        );

        super::delete_notebook_section(&conn, &section.id).unwrap();
        assert!(super::get_notebook_sections(&conn).unwrap().is_empty());
    }

    #[test]
    fn assigns_design_references_to_at_most_one_section() {
        let conn = test_db();
        super::record_design_reference(&conn, "/designs/forest.canopi", "Forest Edge", 7).unwrap();
        let first = super::create_notebook_section(&conn, "Clients").unwrap();
        let second = super::create_notebook_section(&conn, "Home").unwrap();

        super::assign_design_reference_to_section(&conn, "/designs/forest.canopi", &first.id)
            .unwrap();
        assert_eq!(
            super::get_design_notebook_entries_with_sections(&conn).unwrap()[0].section_id,
            Some(first.id.clone())
        );

        super::assign_design_reference_to_section(&conn, "/designs/forest.canopi", &second.id)
            .unwrap();
        assert_eq!(
            super::get_design_notebook_entries_with_sections(&conn).unwrap()[0].section_id,
            Some(second.id)
        );

        super::remove_design_reference_from_section(&conn, "/designs/forest.canopi").unwrap();
        assert_eq!(
            super::get_design_notebook_entries_with_sections(&conn).unwrap()[0].section_id,
            None
        );
    }
}
