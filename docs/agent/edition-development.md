# Desktop and Web edition development

Use this guide for daily work that can affect both Canopi editions. The narrower guides linked below own subsystem invariants; this guide owns safe setup, runnable development loops, verification selection, and handoff.

## Responsibility map

| Concern | Shared policy | Edition composition or infrastructure |
| --- | --- | --- |
| Entry | Shared Preact/app modules | `desktop/web/src/main.tsx` installs Desktop adapters; `desktop/web/src/main.web.tsx` installs browser adapters |
| Workspace and dock | `components/workspace/WorkspaceComposition.tsx` owns primary/side routing, command-to-surface validation, dock sizing, Calendar expansion reset, Suspense fallback, and shared PDF dialog registration | `DesktopWorkspace.tsx` supplies lazy Desktop surfaces; `web/WebWorkspace.tsx` supplies browser-safe surfaces and responsive mode |
| Commands | `desktop/web/src/app/shell-commands/index.ts` owns identities and capability-based projection | Desktop command graph and `desktop/web/src/web/browser-shell-commands.ts` supply supported actions |
| Canvas document | `SceneStore`, shared Workspace Runtime Composition, replacement, runtime lease, and exhaustive cleanup mechanisms are shared | Desktop sequencing stays in `use-canvas-document-session.ts` plus `document-session/lifecycle.ts`; Web sequencing stays in `WebCanvasWorkspace.tsx` plus `browser-design-session.ts`. `desktop-workspace-runtime.ts` and `browser-workspace-runtime.ts` bind only edition adapters; see the [assessed lifecycle map](document-lifecycle.md#canvas-host-lifecycle-assessment) |
| Non-canvas document | `desktop/web/src/app/design-edit/` owns Budget, Calendar, Consortium, Location, description, and extra | Edition actions supply persistence and delivery capabilities |
| Species Catalog | `desktop/web/src/app/plant-browser/workbench.ts` owns caller behavior; a narrow Favorites helper owns local filtering and detail focus return | Desktop uses native SQLite IPC and full presentation; Web uses generated DuckDB-WASM/Parquet adapters and a reduced presentation; see the [assessed presentation map](frontend-workbenches.md#catalog-presentation-assessment) |
| Persistence | Design Session replacement and persistence coordinators | Desktop acknowledges native saves; Web stores browser Drafts and requests `.canopi` downloads |

Trace a behavior from a production component to its action or workbench, then to Design Edit, Canvas Runtime, or document persistence. Keep infrastructure at the final adapter. Shared modules receive typed capabilities and do not inspect the running edition to choose I/O.

## Safe setup

Before editing, run `git status --short --branch` at the repository root and preserve every existing dirty or untracked file. Inspect or create the implementation bead, claim it with `bd update <id> --claim`, update `main` with `git pull --rebase`, and create a scoped branch. Use a separate worktree when the updated baseline does not contain accepted work that the task requires.

The supported toolchain is Node.js 22.13 or newer in the Node 22 line, npm from that installation, Python 3, and the Rust version pinned by `rust-toolchain.toml`. Install frontend dependencies from the repository root with:

```sh
npm ci --prefix desktop/web
```

Linux Desktop development also needs the packages listed in the root `README.md`. The first frontend dev, test, or build command downloads pinned PDF fonts and license texts into ignored `desktop/web/public/pdf-fonts/`; later runs verify and reuse the cache. Network access is required only when a valid cached font is absent.

Choose data before starting a host:

- The UI gallery uses deterministic in-memory fixtures and needs neither a plant database nor generated Web catalog assets.
- Desktop needs `desktop/resources/canopi-core.db` for real Species Catalog behavior. `python3 scripts/prepare-db.py` builds it only from the exact source export pinned by the storage contract.
- Web development uses real browser storage and the generated catalog under `desktop/web/public/canopi-catalog/`. Run `npm run generate:web-catalog` from `desktop/web/` when catalog interaction is in scope and the pinned source exports are available. The shell can start without those ignored assets, but catalog loading will report unavailable data.
- `npm run build:web` does not require a release catalog. It proves browser compilation, emitted bundle boundaries, and size limits for files present in the build. Packaging tests use deterministic synthetic catalog fixtures. `npm run package:web` and `npm run package:web:root` admit the actual generated catalog intended for release.

## Development hosts

The three hosts use separate strict ports and separate Vite dependency caches, so they can run concurrently. Start each command in its stated directory.

| Host | Working directory and command | Address | State and isolation |
| --- | --- | --- | --- |
| Desktop | repository root: `cargo tauri dev` | native window; frontend on `http://localhost:1420/` | Uses native app data and real files unless the OS profile is isolated |
| Web Edition | `desktop/web/`: `npm run dev:web` | `http://localhost:1421/app/` | Uses the browser profile's local storage and real generated Web catalog assets |
| UI gallery | `desktop/web/`: `npm run dev:ui` | `http://127.0.0.1:1422/` | Memory-only fixtures; reload recreates the session |

For routine shared UI work, start with the gallery. Its `surface=workspace`, `edition`, and fixture query parameters are documented in `desktop/web/ui-gallery/README.md`. Both edition registrations mount through the production workspace composition with at most one live disposable runtime. The mounted canvas surface owns that runtime: a Desktop Canvas-to-Location route change releases it, and returning to Canvas constructs a fresh owner. Changing the edition follows a normal link and reloads the page. The gallery does not prove Tauri IPC, browser persistence, native dialogs, downloads, or remote catalog behavior.

The gallery also serves `/library-reference.html`, an isolated interactive reference for the proposed Data Library/ Layers UX. It uses shared controls with a schematic SVG Design view and disposable memory state. It has no production canvas or raster engine and uses its own documented `state` fixtures; see the [reference contract](../design/raster-rework/geolibre-adoption-plan.md#interactive-reference-and-implementation-handoff). Keep its types in the gallery TypeScript project and its entry out of production builds.

Use a fresh browser profile for Web interaction. Close the browser before deleting that profile; clearing the `http://localhost:1421` site data resets Drafts, Settings, Species activity, and Saved Object Stamps. Avoid Download actions unless a disposable download directory has also been configured.

On Linux, isolate a real Desktop session by assigning fresh `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` directories before `cargo tauri dev`. A separate Cargo target or temporary build output does not isolate Tauri app data. On macOS and Windows, use a disposable OS account or equivalent isolated user profile when testing settings, recovery, Recent Designs, or file dialogs. Never point an isolated session at a saved user Design.

### Isolated Desktop verification on a nested X server

When the user's own display, servers and ports must stay untouched, run the whole Desktop verification inside a nested X server. This recipe is verified twice on this repository's Linux host (2026-09-22) and is the route for live pixel evidence of native raster/UI work.

1. Check the names are free (`xdpyinfo -display :99`, `ss -ltn | grep <port>`) and stop only processes this work started.
2. `Xephyr :99 -screen 1280x900x24 -ac -noreset -listen tcp -extension GLX` started **from the host display** (`DISPLAY=:0`): Xephyr nests, so it needs a parent, while everything driven below uses `:99`. Without `-extension GLX` it crashes in the NVIDIA EGL/GBM path; software GL (`LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe MESA_LOADER_DRIVER_OVERRIDE=llvmpipe`) is then sufficient for WebKit.
   - **Run a window manager on the nested display** (`DISPLAY=:99 metacity --sm-disable --replace`, verified 2026-09-22). Without one, a native dialog such as the GTK file chooser can end up unmapped and unreachable, and window geometry is reported inconsistently. With a window manager the same dialog renders, focuses and can be captured normally. Window IDs also change between runs, so discover them (`wmctrl -l`, `xwininfo -root -children`) rather than reusing an earlier id.
3. Frontend on a strict port from `desktop/web`: `npm run dev -- --port 1430 --strictPort`.
4. App with a disposable profile and a private bus:
   `dbus-run-session -- bash -c 'DISPLAY=:99 GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 XDG_CONFIG_HOME=… XDG_DATA_HOME=… XDG_CACHE_HOME=… XDG_RUNTIME_DIR=…(0700) cargo tauri dev --config "{\"build\":{\"devUrl\":\"http://localhost:1430\",\"beforeDevCommand\":null}}"'`.
   The window's own `$XDG_DATA_HOME/com.canopi.app` is the ownership proof; host PIDs are invisible from the sandbox, so `pgrep` is not one.
5. Drive it with XTEST and capture only the owned window (`import -display :99 -window <id>`). Hit-test every pointer action against the owning X window first: AT-SPI exposes no application objects here, so element positions come from screenshots. Without a compositor, resize the window a few pixels after a native dialog closes to force a repaint. Long panels re-flow while notices appear, so measure a control immediately before clicking it rather than reusing an older screenshot's position.
   - **A click must be motion → press → release → motion, with settle time after each step.** Without a window manager the app does not service queued button input until the pointer moves again or a redraw happens, so a bare press/release looks exactly like input that was never delivered: the screen does not change. Verified 2026-09-22 after four failed attempts were attributed to the app. `XSendEvent` is not a workaround — GTK correctly ignores synthetic button events — and `xdotool` may be unavailable where privilege escalation is blocked.
   - **Diagnose the layer before changing the technique.** Keyboard (an accelerator such as `Ctrl+N`) and pointer *motion* (a tooltip on hover) each prove a different half of the path. If keyboard and motion both work but clicks appear dead, suspect the drive sequence above, not the app.
   - **Read control positions from captured pixels at real size.** A downscaled screenshot preview reports scaled coordinates, and clicking a dozen pixels off a button is indistinguishable from a dead click.
   - **When clicks keep missing, stop guessing coordinates and install a DOM feedback loop.** Reading geometry from screenshots cannot tell a missed click from an unresponsive control, and any element that appears or disappears shifts everything below it — a stale y is the usual cause of a run of failed clicks. Add a **temporary** panel element that records DOM events and reports `getBoundingClientRect()` centres for the controls of interest, read it from a capture, act on the reported centres, then **revert the diagnostic before committing**. Verified 2026-09-22: with the trace in place a click that appeared to do nothing reported `pointerdown:DIV`, proving input reached the DOM and the coordinates were simply wrong. Never leave the diagnostic in a commit.
6. Native GTK file choosers: navigate by breadcrumb and row. Typing a path that contains a hidden segment into the location entry can wedge the main loop; the **Name** field of the Save dialog accepts an absolute path and is the reliable route. Fixtures may live under the ignored `.rq-scratch/` workspace directory — the chooser lists hidden directories, so they are reachable by breadcrumb.

7. Scripted journeys (verified 2026-09-25 for the GeoLibre adoption; scripts in the ignored `.rq-scratch/adoption-bench/`): a debug-assertion build exposes the MCP driver bridge. Keep every page script short and synchronous and poll from the driver: a long async page script can come back empty or time out, and a page reload can orphan a reply, so reconnect after each reload. Open chooser dialogs are answered by typing the absolute path into the focused chooser, pausing about a second, then Return; the first chooser of a fresh D-Bus session can wait on GVFS start-up. "Unsaved changes" is a native dialog with Save, Don't Save and Cancel across its bottom edge. An unbundled *release* binary resolves bundled resources to the installed `/usr/lib/Canopi`, so catalog journeys use a debug candidate, which falls back to `desktop/resources/canopi-core.db`.

Stop Vite or Tauri with Ctrl-C and wait for the process to exit before removing an isolated profile. Reload resets gallery memory. Web reset means clearing the isolated origin storage or discarding its browser profile; Desktop reset means discarding the isolated OS app-data profile.

For a sustained smoke session, finish builds and generated-file updates before driving the app. A `cargo tauri dev` watcher can restart the WebView during unrelated validation writes and invalidate interaction evidence. If that interferes, build the debug binary once with the intended frontend URL/configuration, then launch that exact binary directly inside the same isolated display, private bus and XDG profile, keeping its matching Vite host alive. Record the revision, binary path and frontend URL; rebuild deliberately after code changes. Do not assume that a later environment override changes configuration already embedded in the binary.

Describe the interaction actually driven: a bridge calling the production import action proves that action and its native path, but not the OS chooser or pointer hit-testing. Keep those claims separate from browser reload persistence, live pixels and packaged smoke. Clean up only the session's own processes and profiles.

## Verification workflow

Start with the narrowest Vitest file that crosses the behavior owner. Exercise shared behavior through both edition compositions and test differing storage or delivery adapters at their actual interfaces. Use real clicks, focus changes, keyboard events, resize, and scroll where the interaction depends on them. A jsdom click does not establish native WebView behavior.

From `desktop/web/`, `npm run check:editions` runs the application TypeScript check once, checks the gallery TypeScript project, builds the Desktop frontend, builds the real Web entry, and scans its emitted browser assets. It does not run tests, generated-contract drift checks, packaging, or Rust gates. Run focused Vitest while editing, then select broader checks from this matrix:

| Change | Required checks before handoff |
| --- | --- |
| Shared UI or workspace composition | focused Vitest, `npx tsc --noEmit`, `npm run check:ui`, both edition builds; run `npm test` for shared runtime behavior |
| Native adapter or IPC | relevant frontend test, Desktop build, Rust format/Clippy/check, workspace tests, and native command policy when a command or executor changed |
| Browser adapter | focused browser tests, `npm run build:web`, and packaging tests when base paths, assets, or admission changed |
| Catalog contract or artifact | prescribed Python contract/generator tests and checks, `npm run gen:types`, `npm run check:types`, focused browser admission/packaging tests, and strict prepared artifact verification when applicable |
| Persistence or lifecycle | focused replacement/persistence/runtime tests, `npm test`, TypeScript, both edition builds, and Rust workspace tests for persistence boundaries |
| Docs only | `git diff --check` and link/path review; code tests are unnecessary |

`AGENTS.md` is the gate authority. `docs/agent/frontend-validation.md` explains frontend test and architecture guards; `docs/agent/build-release.md` owns build, catalog, generated-output, packaging, and platform details. The executable Web boundary and packaging gates live in `desktop/web/scripts/`.

At integration, run the handoff's combined frontend set from `desktop/web/`: `npx tsc --noEmit`, `npm test`, `npm run check:ui`, `npm run check:types`, `npm run build`, and `npm run build:web`. Run `npm run check:editions` during editing when only composition/build feedback is needed; do not repeat the full suite after prose-only edits. Rebase onto current `main` before final architecture checks when required by `AGENTS.md`, then rerun gates affected by that rebase.

Production PDF WebView validation covers encoder, preview, worker/CSP, and fixed-path byte delivery on its platform matrix. It does not prove the app shell, popup behavior, native save dialog, or packaged-app integration. Record macOS, Windows, and unavailable local WebKitGTK paths explicitly rather than inferring them from browser or jsdom checks.

## Commit and push handoff

Before closing a bead, update every affected operating guide and its acceptance evidence. Migrate meaningful assertions before deleting old tests. Inspect `git diff` and `git diff --cached`, run `git diff --check`, and confirm `git status --short --branch` contains no user-owned file.

Record exact commands, working directories, revisions, exit results, useful test counts, baseline failures, and platform gaps in bead notes. Close completed beads with a reason naming the delivered behavior and checks, then export metadata with `bd export -o .beads/issues.jsonl`. Stage only intended files, commit with the repository message style, pull with rebase or rebase-merges as appropriate, rerun affected gates, and push the scoped branch with upstream tracking. Finish by verifying that the delivered branch contains every required commit and is up to date with its upstream.
