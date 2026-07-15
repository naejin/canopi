# Web Edition stores personal app data in the browser

Status: Accepted

The Web Edition v1 may store personal app data in browser storage, such as IndexedDB and localStorage, without adding accounts, sync, or a backend persistence service. Browser-local app data includes internal Design drafts and autosave state, settings, favorites, recently viewed Species, and Saved Object Stamps.

This keeps the Web Edition compatible with static hosting on Cloudflare Pages and avoids turning the website into an account-backed application. Browser-local app data is convenience state, not a durable cloud library: it can be lost if the user clears site data, changes browser profiles, uses private browsing, or if browser storage is evicted. The durable portable boundary for Web Edition v1 remains explicit `.canopi` import/export for Designs.

Desktop app data remains native/user-database backed. Shared UI should depend on caller-shaped app-data APIs rather than importing Tauri IPC, IndexedDB, or localStorage directly.

Browser app data is partitioned into four independently versioned local-storage records: Draft bodies and summaries, Settings, Species activity, and Saved Object Stamps. Once a valid v2 resource record exists, it is authoritative for that resource; missing or unsupported records continue reading through the legacy v1 aggregate until an exact, immutable v2 authority tombstone commits the complete transition. This confines record corruption to one reliability domain without letting corrupt or foreign v2 data erase recoverable v1 data.

Migration is staged by resource writes rather than an eager full-store copy. Reads do not duplicate the aggregate. A write first reserves marker quota, then publishes only its target record; if quota prevents that publication while v1 is still authoritative for the resource, the write remains live by updating v1. The v1 source is removed only after all four supported records validate and the committed tombstone publishes. Interrupted finalization is retried by a later store instance, and stale migration progress cannot overwrite the separate committed tombstone. Consequently, ordinary v2 Settings, Species, and Stamp writes do not parse or serialize Draft bodies; a resource's first legacy transition or quota fallback may still decode or rewrite v1 because the old format is an aggregate.

The synchronous `BrowserAppDataStore` remains the only caller-facing seam; partition keys and migration behavior are internal storage policy. Local storage still has last-writer-wins behavior for genuinely concurrent writes to the same resource. An old cached v1 client may recreate the legacy key, but its writes cannot replace resources that v2 already made authoritative and are ignored entirely after the v2 tombstone commits.
