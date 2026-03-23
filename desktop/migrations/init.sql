CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recent_files (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_opened TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
    canonical_name TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
);
