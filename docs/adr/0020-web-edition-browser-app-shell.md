# Web Edition uses a Browser App Shell

Status: Accepted

The Web Edition v1 should use a browser-specific app shell around the shared Canopi app core instead of mounting the desktop title bar, desktop menu bar, or native window controls. The Browser App Shell should expose the v1 web command set: New, Open `.canopi`, Download `.canopi`, Drafts, language/theme, and panel toggles.

The desktop shell is shaped by Tauri and native OS expectations: window controls, menu behavior, Recent Design paths, reveal-in-file-manager actions, direct save/save-as flows, updater/reporting affordances, and native dialogs. Those affordances imply capabilities the static Web Edition intentionally does not have. A web-specific shell lets the Web Edition stay honest about browser-local drafts, explicit `.canopi` download/export, and static Cloudflare Pages hosting while still sharing Design Session, canvas, panel, catalog, and command infrastructure where those seams are platform-neutral.

The Browser App Shell is not a separate website page or reduced catalog widget. It is the shell for the real Web Edition app, and its commands should route through caller-shaped app seams rather than importing Tauri IPC, browser storage, or file APIs directly from generic components.
