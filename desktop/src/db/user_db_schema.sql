CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE recent_files (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_opened TEXT NOT NULL
);

CREATE TABLE favorites (
    canonical_name TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
);

CREATE TABLE recently_viewed (
    canonical_name TEXT PRIMARY KEY,
    viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER limit_recently_viewed
AFTER INSERT ON recently_viewed
BEGIN
    DELETE FROM recently_viewed WHERE canonical_name NOT IN (
        SELECT canonical_name FROM recently_viewed ORDER BY viewed_at DESC LIMIT 50
    );
END;

CREATE TABLE saved_object_stamps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE design_notebook_entries (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    plant_count INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_opened TEXT NOT NULL
);

CREATE TABLE design_notebook_sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE design_notebook_section_memberships (
    path TEXT PRIMARY KEY,
    section_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(path) REFERENCES design_notebook_entries(path) ON DELETE CASCADE,
    FOREIGN KEY(section_id) REFERENCES design_notebook_sections(id) ON DELETE CASCADE
);
