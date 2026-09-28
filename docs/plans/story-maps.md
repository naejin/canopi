# Story maps in Canopi: implementation plan

Status: in progress (2026-09-28). Shipped: saved views with extent and thumbnails, the Stories panel and presenting (beads canopi-5ys2.3.1, .2, .3, .5, .6, .8). Open: export (canopi-5ys2.3.4).
Beads: canopi-5ys2.3 (epic) · .1 saved views · .2 Stories panel · .3 present · .4 export.
Mockups: design canvas boards StoryAuthor, StoryPresent, StoryPhone.

## 1. What users get

- **Save a view** of the map: where it looks, which background and site data are shown, which species or objects are highlighted, an optional title and text. View › Saved views lists them; Go to view moves the camera only.
- **Build a story** in a Stories panel beside the live map: steps are saved views with a title, formatted text and optional images; add the current view as a step, reorder with drag or Alt ↑/↓, edit text in place, "Use the current map view" to update a step, "Go to this view" to check it.
- **Present** full-window inside Canopi (Desktop and Web, and on phones): a text card beside the map, Previous/Next, step dots, keyboard (← → Space Esc), the map moves between steps (a jump when reduced motion is on), highlighted plants ringed.
- **Export** later: a self-contained web page and a PDF, one step per page.

## 2. What already exists (parked branch `ux-views`, commit b2ee529b, not merged)

- `common-types/src/views.rs`: `SavedView` (camera lon/lat/zoom/bearing, visible layers: background, terrain, scene layers, site-data ids; highlight: species names and typed object refs; title; rich text), `Story`, `StoryStep` (view id, title, rich text, images), `RichTextBlock` (paragraph, bullets) with spans (bold, italic, link — http, https, mailto only), `StoryImage` (https URL or data URI), `validate_views_and_stories`.
- `.canopi` format v8 with `views` and `stories`; v7 refused (ADR 0003); generated TS bindings; Design Edit commands; `view.saveCurrentView` / `view.goToView`; a Save view dialog; camera fly in `maplibre/workspace-camera.ts`; i18n in 11 locales; guide updates. Gates had not been run to completion when the session limit hit.

Recommendation: keep this model and finish it as bead .1, after the decisions below (images and export affect it).

## 3. Architecture

- **Authority.** Views and stories are Design data owned by Design Edit (`app/design-edit/`), saved through the document session like budget and timeline. They are not part of scene undo (consistent with the architecture page); edits get an Undo toast for destructive actions (delete view, delete story, remove step).
- **Referential integrity.** A step references a view by id. Deleting a view used by steps asks first and names the stories; renaming is free. The validator refuses dangling references on load.
- **Applying a view** is session state, never a Design edit: camera through the workspace camera (fly or jump), background and terrain through the map layer store as a temporary presentation override (restored when leaving the step or presentation), scene layer and site-data visibility through presentation overrides (not the Design's own visibility), highlight through the existing species-focus / highlight seam. Leaving presentation restores the user's own state exactly.
- **Presentation mode** is a workspace mode owned by one controller (`app/story-presentation/`): it hides editing chrome, blocks editing commands and single-key tool shortcuts, traps focus in the story card, and disposes its overrides on exit, on Design switch and on HMR (resource-ownership rule).
- **Rich text.** A small editor over `RichTextBlock` (bold, italic, bullets, links, images) built on `contenteditable` with a strict schema: paste is sanitised to the block model; no raw HTML persists. Rendering is one pure function shared by panel, presenter and export.
- **Images.** See decision D1.
- **Web edition** has the same features (views and stories are plain Design data); export may differ (D3).

## 4. UI (per the mockups)

- Panel rail: Stories (Ctrl 9). Panel: story selector, New story; step list (thumbnail, number, title, first line of text, reorder handle, More: Duplicate, Move, Delete); Add the current view as a step; step editor (title, text toolbar, "This step shows" tags, Use the current map view, Go to this view); footer Export…, Present.
- Thumbnails: small map snapshots captured when a view is saved or updated, stored as session cache (or in the file, see D1) — never recomputed on every render.
- Presenter: floating text card (420 px, left), progress dots as buttons, Previous/Next, "Step n of m", full screen toggle, Leave (Esc). Phone: bottom card, swipe, 44 px targets, safe areas.
- View menu: Saved views ▸ list, Save current view…, Manage views… (a small dialog to rename/delete).

## 5. Export (bead .4)

- **Web page:** one HTML file with inline CSS, the story text, images and one map snapshot per step (PNG/WebP), attribution per snapshot. Static snapshots are reliable, offline and respect imagery terms better than embedding live Google tiles in a page outside Canopi (D3).
- **PDF:** reuse the PDF pipeline (ADR 0008) with one page per step: snapshot on top, title and text below.
- **Snapshot capture** needs a short spike: render each step's view off-screen at a fixed size (MapLibre canvas plus the Pixi scene layer) and read pixels after the frame settles (`preserveDrawingBuffer` or a read in the render callback), with tiles loaded or a timeout and a "some tiles missing" note.

## 6. Accessibility and languages

Presenter is a dialog-like region with a heading per step, live announcement of "Step n of m: title", keyboard and screen-reader navigation, visible focus, reduced-motion jumps, text scaling without clipping; step text keeps its authored language (`lang` per story, defaulting to the UI locale); all UI strings in 11 locales.

## 7. Tests

Format round-trip and refusal of v7; validator (dangling view ids, camera ranges, link schemes, image sources); Design Edit commands and undo toasts; applying a view never dirties the Design and restores state on exit; presenter keyboard and focus trap; rich-text paste sanitisation; snapshot capture fallback; export produces valid HTML and PDF with attribution; Web parity.

## 8. Beads and order

1. **.1 Saved views** — finish the parked branch: rebase on the new frame, run gates, add Manage views dialog and thumbnails cache. (M)
2. **Snapshot spike** — capture a map + scene snapshot reliably on Desktop and Web. (S)
3. **.2 Stories panel** — panel, step list, reorder, rich-text editor with sanitised paste, images per D1. (L)
4. **.3 Present** — presentation controller, overrides and restore, presenter card, phone layout, full screen. (M)
5. **.4 Export** — HTML and PDF. (M)

## 9. Decisions (2026-09-26: the user adopted the recommendations)

- **D1 Images:** (a) embedded in the `.canopi` as compressed data (single portable file; cap 1 MB per image, 10 MB per Design) — recommended; (b) links only (small files, breaks offline); (c) files beside the Design (breaks single-file sharing).
- **D2 Step ↔ view:** a step points to a saved view (one view can serve several stories; editing it updates all) — recommended; or each step owns a private copy.
- **D3 Export map:** static snapshots (recommended) vs an interactive web map (needs online tiles; Google imagery cannot be embedded outside Canopi, so it would fall back to OpenFreeMap).
- **D4 Scope for v2.0:** saved views, the Stories panel and presenting in v2.0, export after. Reason: the `.canopi` format change must land before v2.0, because a later bump would refuse every v2.0 Design (ADR 0003).
