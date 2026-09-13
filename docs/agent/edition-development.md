# Desktop and Web edition development

Use this guide for daily work that can affect both Canopi editions. The narrower guides linked below own subsystem invariants; this guide owns safe setup, runnable development loops, verification selection, and handoff.

## Responsibility map

| Concern | Shared policy | Edition composition or infrastructure |
| --- | --- | --- |
| Entry | Shared Preact/app modules | `desktop/web/src/main.tsx` installs Desktop adapters; `desktop/web/src/main.web.tsx` installs browser adapters |
| Workspace and dock | `components/workspace/WorkspaceComposition.tsx` owns primary/side routing, command-to-surface validation, dock sizing, Calendar expansion reset, Suspense fallback, and shared PDF dialog registration | `DesktopWorkspace.tsx` supplies lazy Desktop surfaces; `web/WebWorkspace.tsx` supplies browser-safe surfaces and responsive mode |
| Commands | `desktop/web/src/app/shell-commands/index.ts` owns identities and capability-based projection | Desktop command graph and `desktop/web/src/web/browser-shell-commands.ts` supply supported actions |
| Canvas document | `SceneStore`, Canvas Runtime, and `app/document-session/` own scene and replacement behavior | Desktop attachment uses `use-canvas-document-session.ts`; Web attachment uses `WebCanvasWorkspace.tsx` and `browser-design-session.ts` |
| Non-canvas document | `desktop/web/src/app/design-edit/` owns Budget, Calendar, Consortium, Location, description, and extra | Edition actions supply persistence and delivery capabilities |
| Species Catalog | `desktop/web/src/app/plant-browser/workbench.ts` owns caller behavior | Desktop uses native SQLite IPC; Web uses generated DuckDB-WASM/Parquet adapters and a reduced supported-field projection |
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

For routine shared UI work, start with the gallery. Its `surface=workspace`, `edition`, and fixture query parameters are documented in `desktop/web/ui-gallery/README.md`. Both edition registrations mount through the production workspace composition over one disposable runtime. Changing the edition follows a normal link and reloads the page, so only one edition owns the runtime at a time. The gallery does not prove Tauri IPC, browser persistence, native dialogs, downloads, or remote catalog behavior.

Use a fresh browser profile for Web interaction. Close the browser before deleting that profile; clearing the `http://localhost:1421` site data resets Drafts, Settings, Species activity, and Saved Object Stamps. Avoid Download actions unless a disposable download directory has also been configured.

On Linux, isolate a real Desktop session by assigning fresh `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` directories before `cargo tauri dev`. A separate Cargo target or temporary build output does not isolate Tauri app data. On macOS and Windows, use a disposable OS account or equivalent isolated user profile when testing settings, recovery, Recent Designs, or file dialogs. Never point an isolated session at a saved user Design.

Stop Vite or Tauri with Ctrl-C and wait for the process to exit before removing an isolated profile. Reload resets gallery memory. Web reset means clearing the isolated origin storage or discarding its browser profile; Desktop reset means discarding the isolated OS app-data profile.

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
