# Focus and keyboard ownership

Status: Accepted (2026-09-29, Canopi v2); amended 2026-10-01

Amends [ADR 0010](0010-map-first-interface.md) (single-key shortcut scope). Product rules: [ADR 0015](0015-rotating-map-and-canvas-controls.md).

## Context

Thirteen key listeners (shell shortcuts, Web canvas shortcuts, focus regions, the canvas runtime, popovers) each decided scope for themselves; one Esc could close a popover and clear the selection. About 110 `.focus()` calls moved focus ad hoc, so arming a tool from a panel sometimes left focus in the panel, and a Start card autofocus made Ctrl+Z skip undo (canopi-28w8). ADR 0010 said single keys work only while the map has focus; the code let them work anywhere except text fields.

## Decision

- **One `KeyRouter`** in the neutral `app/keyboard/` module owns the only window key listeners: `keydown` in capture and bubble, `keyup` in capture. Capture: skip IME composition, classify focus (modal, text, map, body, other), track modifiers and (on the map or body) Space, give a live canvas gesture the key first, F6. Bubble, skipped for a key a widget handled: a modal gets only its pushed scope (story presenter, PDF page editor) and `worksInModal` rows; `global` rows; the Stories Undo toast; Esc runs the Esc chain, where popovers are layers, not scopes; then the keymap.
- **Scopes.** `global` rows work everywhere except modals (a few also in text fields: Ctrl+K, Ctrl+S, F1, F6). `command` rows (tool letters, `[` `]`, N, Shift+N, Shift+L, paste, undo) work anywhere except text fields and dialogs; a held stamp's `[` `]` also work on map focus with single keys off, as today. `view-arrows` (Shift+←/→/↑) likewise, except inside an arrow-owning widget (a list, menu, slider, tab list, toolbar, focusable splitter, or an element that declares `data-owns-keys`).
- **Map-focus rows.** `canvas-focus` rows (plain and Ctrl/Cmd arrows, Enter, Space, Backspace in a polygon draft, F2, `+` `−`, Menu) need the map, or body after a press on the map or focus in it. A widget keeps a `command` key only by declaring it (`data-owns-keys`).
- **Selection edits.** `outside-dock` rows, the edits of the map's selection (cut, copy, select all, same species, duplicate, Delete, group, rotate, lock), work like `command` rows except from the side-panel dock or the phone sheet (focus there, or body after a press or focus there): a panel keeps the browser's copy and select all, and the map, its floating chrome, the rail and the title bar keep the edits.
- **The keymap is data**: each row names its chords, scope and whether it follows the single-key switch; F1 renders it. `mod` means Cmd on Mac and Ctrl elsewhere; AltGr never matches; non-Latin layouts fall back to `event.code` for letters, digits and brackets.
- **One Esc, one thing.** An open text entry handles its own Esc first. Layers register with a priority: popover, canvas menu, live gesture (a rotate drag restores the starting camera), nudge series, tool transient, tool to Select, selection, raster inspection, dock panel. The top active layer runs; the tool card's Esc hint reads the same chain. Canvas layers are live from any non-text focus while a tool is armed.
- **One `FocusOwner`** moves focus between regions (title bar, tool rail, map, dock), focuses the map host itself, and lets a component focus its first field only when a user action opened it. Content-derived UI cannot take focus. Closing a modal returns focus through `useModalLayer`, the one modal exception.
- **One `armCanvasTool`** is the only way app code arms a tool; it moves focus to the map for every source except a shortcut.
- **Built once** (user, 2026-10-01). Since v2 ships as one release, the router, the Esc chain, the focus owner and arming are built in this target form directly, with no step that first rebuilds today's key order.
- **The canvas runtime adds no window or document key listeners**; it exposes a keyboard port (Esc layers, commands, key state). Only its own focusable chrome (the text-entry host, handles, the locked-object affordance) handles its own keys at element level; every other key reaches it through the port.

## Options considered

- **Single keys only while the map has focus** (ADR 0010 as written), **only in the canvas region**, or **excluded from every widget**: all contradict "anywhere except text fields", the user's decision.
- **Per-caller focus fixes** (today): each new entry point repeats the bug; one arming path and one focus owner end it.
- **Document-level Esc listeners per component** (today): two handlers fire on one Esc.
- **Shift+arrows as canvas-focus rows**: reset north from the rail would work (N) but rotation would not.
- **A remapping UI**: not requested; the keymap stays data so one can come later.

## Consequences

- ADR 0010's shortcut rule, `system.md`, `frontend.md` and the Rules board say "anywhere except text fields and dialogs"; the F1 copy and the Settings hint, both read inside a dialog, keep the shorter "anywhere except text fields".
- Policy tests keep one owner of window key listeners and one arming path; `app/keyboard/` imports no commands, platform, Web or component code. One focus mover and one Esc for one thing are held by behaviour tests (the focus owner, arming and Start card tests, the Esc fixtures), not by regexes whose allowlists would grow with every dialog (2026-10-01).
- canopi-28w8's focus part lands through `FocusOwner`; its state and chrome parts ship first on their own.
- Details: [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).
