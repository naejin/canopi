CREATE TABLE IF NOT EXISTS design_notebook_entries (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    plant_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_opened TEXT NOT NULL
);
