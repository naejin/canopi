# Web Edition stores personal app data in the browser

Status: Accepted

Web Edition stores Design drafts, settings, Species favorites/activity, and Saved Object Stamps in browser-local storage. It has no accounts, sync, or backend persistence service. This preserves static hosting, but browser profile changes, eviction, and clearing site data can lose that convenience state. Explicit `.canopi` downloads remain the portable Design save boundary; desktop personal data remains in its native user database.

The synchronous Browser App Data Store hides four independently versioned localStorage records: Drafts, Settings, Species activity, and Saved Object Stamps. Partitioning isolates corruption and keeps ordinary Settings, Species, and Stamp writes from parsing Design bodies. Migration preserves recoverable legacy aggregate data until each resource has valid replacement authority; an immutable completion tombstone prevents old clients or interrupted migration from restoring the retired aggregate as authority.

This accepts same-resource last-writer-wins concurrency and occasional legacy aggregate work during transition or quota recovery. Storage keys, staged migration, quota handling, and finalization belong behind the store, not in shared UI. The [Browser App Data guide](../agent/frontend-patterns.md#browser-app-data) records those implementation rules.
