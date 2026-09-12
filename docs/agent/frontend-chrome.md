# Frontend chrome implementation

Visual rules: [design contract](../../.interface-design/system.md) and its surface guides.


- Use CSS Modules and tokens from `desktop/web/src/styles/global.css`.
- Do not use Tailwind or global component styles for new UI.
- Dark theme uses `[data-theme="dark"]` on `<html>`.
- Use CSS module `composes:` for modifier classes that mostly share a base class.
- No native `<select>` in UI chrome; use `Dropdown`.
- No native `<input type="date">` in UI chrome; use `DatePicker`.
- No `window.prompt()`, `confirm()`, or `alert()`; WebView blocks these.
- Hide WebKit search input clear buttons when using a custom clear button.
- Use `pointerup` for click-outside-to-close, not `mousedown`.
- Controls that should not dismiss overlays use `data-preserve-overlays="true"`.
- Nested overlay Escape handling belongs on the inner dialog DOM element, not a document-level listener.
- Move focus into dialogs after mount. Appearance editors focus the current choice; the Inspection Lens focuses its keyboard-operable preview.
- Floating element positioning should be synchronous; avoid post-render rAF corrections that visibly snap.
- Use `Dropdown.tsx` and `utils/floating-position.ts` for viewport-aware dropdown behavior.
- Preact SVG attributes use native spellings such as `stroke-width`, `clip-path`, and lowercase `tabindex`. React-style camelCase can be emitted as an ineffective attribute; verify actual SVG rendering and focus when physical output or keyboard interaction depends on them.
- Do not use raw `white`, `black`, or raw `rgba()` in CSS Modules. Use tokens.
- Use only font weights `400` and `600`.
- Use spacing, font-size, radius, control-size, slider, and transition tokens. Add a shared token when a visual value belongs to one of those design scales; do not hide a raw scale value behind arithmetic or a scoped custom property. Keep unavoidable structural geometry or deliberately off-scale component behavior as a narrow, reviewed policy exception.
- Icon-only chrome buttons with hover/focus tooltips should use `components/shared/ButtonTooltip.tsx` instead of native `title`, especially in rail toolbars and panel bars where locale changes must update immediately.


- Portalled Preact controls may use compat event normalization. Prefer real focus()/blur() in tests; synthetic focus events must use focusin/focusout when compat is active.
