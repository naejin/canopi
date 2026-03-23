CREATE TABLE IF NOT EXISTS recently_viewed (
    canonical_name TEXT PRIMARY KEY,
    viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS limit_recently_viewed
AFTER INSERT ON recently_viewed
BEGIN
    DELETE FROM recently_viewed WHERE canonical_name NOT IN (
        SELECT canonical_name FROM recently_viewed ORDER BY viewed_at DESC LIMIT 50
    );
END;
