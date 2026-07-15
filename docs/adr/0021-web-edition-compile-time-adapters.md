# Web Edition uses compile-time platform adapters

Status: Accepted

The Web Edition should use compile-time platform adapter boundaries rather than runtime environment feature flags. The desktop Vite entry should import Tauri/native adapters, and the Web Edition Vite entry should import browser adapters. Shared app modules should depend on small caller-shaped interfaces for document persistence, settings, personal app data, Species Catalog reads, shell commands, and file import/export.

Runtime checks such as `if web then IndexedDB else Tauri IPC` inside shared app modules would make platform behavior harder to test, easier to accidentally bundle into the wrong target, and more likely to leak desktop promises into the browser shell. Compile-time entries give each build a clear dependency graph and make it possible for CI to reject web chunks that import `@tauri-apps/*`, desktop IPC modules, native file paths, or desktop-only command surfaces.

This does not mean forking the app. The Design Session, canvas runtime, panels, Species Catalog workbench, command graph, and `.canopi` format behavior should remain shared where they are platform-neutral. The split belongs at shell and adapter edges. Canvas toolbar command identity, shortcut matching, and projection therefore live in the neutral `app/canvas-commands/` module; desktop and browser callers provide live intent adapters without moving either shell's platform-only commands into that module. The browser entry owns a Web-only shortcut listener with explicit disposal and HMR cleanup, while the shared catalog separately supplies display and ARIA shortcut formats.
