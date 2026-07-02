CREATE TABLE IF NOT EXISTS design_notebook_sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS design_notebook_section_memberships (
    path TEXT PRIMARY KEY,
    section_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(path) REFERENCES design_notebook_entries(path) ON DELETE CASCADE,
    FOREIGN KEY(section_id) REFERENCES design_notebook_sections(id) ON DELETE CASCADE
);
