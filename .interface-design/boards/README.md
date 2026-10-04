# Design boards

The boards are the agreed target for the Canopi v2 interface: one static HTML page per surface (workspace, catalog, Layers, planning panels, dialogs, Web on phones, dark theme, French), drawn from one design system. The rules they embody are written in [`../system.md`](../system.md) and the pattern files; the boards show what the rules look like. When a rule and a board disagree, fix both in the same change.

## Render

```sh
python3 .interface-design/boards/build.py            # every board → .interface-design/boards/out/ (ignored by git)
python3 .interface-design/boards/build.py Layers Menus  # only those boards
python3 .interface-design/boards/serve.py [port]     # serves out/ at http://127.0.0.1:47213/ (an index lists every board)
```

Python 3 standard library only; no network. The pages link the Literata, Source Sans 3 and IBM Plex Mono web fonts, so offline they fall back to system fonts. Each page renders its board at true size; interactive boards (Workspace) run on `runtime.js`.

Optional checks: with the server running, `node check.js [Board ...]` screenshots each board into `out/shots/` and audits contrast, text under 12 px, targets under 24 px, missing accessible names, clipped text and overflow, exiting non-zero on a page error. It needs Playwright (`npm i -g playwright` or `PLAYWRIGHT_MODULE=/path/to/node_modules/playwright`) and a browser (Playwright's Chromium, or `CHROME=/usr/bin/google-chrome`). This is a manual gate, not part of CI.

## Files

| File | Role |
| --- | --- |
| `ds.py` | Tokens (light and dark), CSS, icons and component functions. Every board is built from these, so a fix here lands everywhere. |
| `common.py` | Shared board pieces: the reference orchard, map backgrounds, chrome, tags, selection box, status chips. |
| `boards_a.py`, `boards_b.py`, `boards_nav.py` | The boards, registered with `board(name, w, h, title, group, ...)` as a decorator or a call; `boards_nav.py` holds the turned-map boards. |
| `build.py` | Renders `out/<Board>.html`, `out/index.html`, `out/boards.json`; `ROWS` orders the index. |
| `runtime.js` | Renders the page template: `{{ expr }}`, `<sc-if>`, `<sc-for>`, event handlers; `DCLogic` with `setState()` for interactive boards. |
| `assets.py`, `overlay.py` | Generate every background at build time: a flat field, map paper, slope and wetness tints, synthetic streams and crowns, and the orchard's plants drawn with the symbol set. |
| `orchard.json` | The reference Design: 117 species and 2,201 plant positions in board pixels (compact; `assets.orchard()` expands it). |
| `symbols.py`, `defs-v3.svg.part` | The 29 plant symbols (the app adds four abstract marks) as SVG `<symbol>`s; `python3 symbols.py` regenerates the `.part`. The app's copies are the recipes in `desktop/web/src/canvas/runtime/plant-symbol-recipes.ts`. |
| `labels_close.json` | Plant positions and codes for the NamesOnMap label-thinning board. |
| `serve.py`, `check.js` | Local server and headless audit. |

Satellite tiles and the LiDAR rasters the boards were first drawn over are not in the repository (imagery terms, size). `assets.py` stands in for them procedurally, so the chrome, not the background, is what a board asserts.

## Add or change a board

1. Write or edit the board function in `boards_a.py`, `boards_b.py` or `boards_nav.py` using `ds.py` components (`topbar`, `toolrail`, `panel`, `btn`, `finder`, ...), real elements and ARIA semantics. Copy is US English from the app's `en` locale, numbers follow it (`2,201`, `€6,482.30`).
2. Add a component or token to `ds.py` only when no existing one fits; then it is available to every board.
3. Put the board in `ROWS` in `build.py` so the index shows it; render, open it, and run `check.js` on it.
4. Update the pattern file that lists the board (`../patterns/*.md`), and the rule it changes, in the same change. A board is design only once the pattern says so.

Names: `PascalCase` board names, 1440 × 900 for workspace boards, 390 × 844 for phones; dark boards pass `dark=True`, interactive ones a `script` (a `Component extends DCLogic` with `renderVals()`), as `Workspace` does.
