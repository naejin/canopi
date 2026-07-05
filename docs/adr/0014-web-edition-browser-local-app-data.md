# Web Edition stores personal app data in the browser

Status: Accepted

The Web Edition v1 may store personal app data in browser storage, such as IndexedDB and localStorage, without adding accounts, sync, or a backend persistence service. Browser-local app data includes internal Design drafts and autosave state, settings, favorites, recently viewed Species, and Saved Object Stamps.

This keeps the Web Edition compatible with static hosting on Cloudflare Pages and avoids turning the website into an account-backed application. Browser-local app data is convenience state, not a durable cloud library: it can be lost if the user clears site data, changes browser profiles, uses private browsing, or if browser storage is evicted. The durable portable boundary for Web Edition v1 remains explicit `.canopi` import/export for Designs.

Desktop app data remains native/user-database backed. Shared UI should depend on caller-shaped app-data APIs rather than importing Tauri IPC, IndexedDB, or localStorage directly.
