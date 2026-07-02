PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS design_notebook_entries_next;

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

PRAGMA foreign_keys = ON;
