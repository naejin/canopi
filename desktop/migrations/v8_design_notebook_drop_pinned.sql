DROP TABLE IF EXISTS design_notebook_entries_next;
DROP TABLE IF EXISTS temp.design_notebook_memberships_v8_backup;

CREATE TEMP TABLE design_notebook_memberships_v8_backup AS
SELECT path, section_id, created_at, updated_at
FROM design_notebook_section_memberships;

CREATE TABLE design_notebook_entries_next (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    plant_count INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_opened TEXT NOT NULL
);

INSERT INTO design_notebook_entries_next (
    path,
    name,
    updated_at,
    plant_count,
    sort_order,
    created_at,
    last_opened
)
SELECT
    path,
    name,
    updated_at,
    plant_count,
    sort_order,
    created_at,
    last_opened
FROM design_notebook_entries;

DROP TABLE design_notebook_entries;
ALTER TABLE design_notebook_entries_next RENAME TO design_notebook_entries;

INSERT INTO design_notebook_section_memberships (
    path,
    section_id,
    created_at,
    updated_at
)
SELECT backup.path, backup.section_id, backup.created_at, backup.updated_at
FROM design_notebook_memberships_v8_backup AS backup
JOIN design_notebook_entries AS entries ON entries.path = backup.path
JOIN design_notebook_sections AS sections ON sections.id = backup.section_id;

DROP TABLE temp.design_notebook_memberships_v8_backup;
