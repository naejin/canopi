# Web Edition uses a Browser App Shell

Status: Accepted

The Web Edition v1 should use a browser-specific app shell around the shared Canopi app core instead of mounting desktop-native window controls or native file-management actions. Its chrome should still match the desktop workspace UX as closely as practical: desktop-style top bar structure, menu/dropdown interaction, centered Design identity, and the right-side PanelBar pattern. The implemented Browser App Shell command set is New, Open `.canopi`, Download `.canopi`, language/theme, and panel toggles. [ADR 0024](0024-shared-canvas-pdf-export.md) approves adding Canvas PDF export through a browser download capability when implemented. Browser Drafts remain internal autosave/recovery state rather than a visible shell command or list.

The desktop shell is shaped by Tauri and native OS expectations: window controls, Recent Design paths, reveal-in-file-manager actions, direct save/save-as flows, updater/reporting affordances, and native dialogs. Those affordances imply capabilities the static Web Edition intentionally does not have. A web-specific shell lets the Web Edition stay honest about explicit `.canopi` download/export and static Cloudflare Pages hosting while still sharing Design Session, canvas, panel, catalog, menu, and command infrastructure where those seams are platform-neutral.

The Browser App Shell is not a separate website page or reduced catalog widget. It is the shell for the real Web Edition app, and its commands should route through caller-shaped app seams rather than importing Tauri IPC, browser storage, or file APIs directly from generic components. The goal is desktop chrome parity with web-safe command availability, not a visually separate browser product.
