ALTER TABLE design_notebook_sections
ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE design_notebook_sections
SET sort_order = (
    SELECT COUNT(*)
    FROM design_notebook_sections AS earlier
    WHERE earlier.created_at < design_notebook_sections.created_at
       OR (
            earlier.created_at = design_notebook_sections.created_at
            AND earlier.id < design_notebook_sections.id
       )
);

ALTER TABLE design_notebook_entries
ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE design_notebook_entries
SET sort_order = (
    SELECT COUNT(*)
    FROM design_notebook_entries AS earlier
    WHERE earlier.last_opened > design_notebook_entries.last_opened
       OR (
            earlier.last_opened = design_notebook_entries.last_opened
            AND earlier.created_at > design_notebook_entries.created_at
       )
       OR (
            earlier.last_opened = design_notebook_entries.last_opened
            AND earlier.created_at = design_notebook_entries.created_at
            AND earlier.path < design_notebook_entries.path
       )
);
