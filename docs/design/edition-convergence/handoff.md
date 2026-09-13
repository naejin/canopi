# Desktop and Web development convergence

Status: implementation specification; proposed work is not delivered by this document.
Prepared 2026-09-13 against `cfa16e8cab9f06f1dfe37a99fd64c668208cae2c`.
Documentation bead: `canopi-0d0q`. Implementation progress belongs in a separate bd epic and dependent slices.
The [agent prompt](agent-prompt.md) starts implementation from this specification.

## Outcome and scope

Make a shared feature such as Calendar or Budget require one behavior implementation, with routine verification of both editions. Reduce duplicate workspace policy and make the development loop predictable for agents. Preserve current product scope, data semantics, and edition-specific capabilities.

Deliver edition validation and development tooling first, shared workspace composition second, then separately assess and implement justified canvas-host and catalog-presentation extractions. Documentation maintenance is part of each slice, not a final cleanup phase. A measured decision to retain a seam is acceptable for the latter assessments; silently omitting them is not.

Success means fewer independently maintained owners and fewer files needing coordinated edits for a shared feature. There is no target percentage of shared code. Do not build a generic application factory, plugin framework, service locator, or new boolean capability registry merely to reduce entry-point code.

## Establish the current baseline

Read `AGENTS.md`, [the documentation map](../../README.md), and [frontend routing](../../agent/frontend-patterns.md). Use `craft` and `codebase-design`. Then read the relevant portions of [Browser Edition](../../agent/browser-edition.md), [document lifecycle](../../agent/document-lifecycle.md), [frontend validation](../../agent/frontend-validation.md), [build and release](../../agent/build-release.md), and [the gallery README](../../../desktop/web/ui-gallery/README.md).

The following observations were checked in source at the baseline commit. Recheck them on the implementation checkout; prior passing suites and this handoff are evidence, not substitutes for inspection.

| Concern | Existing owner or difference | Implication |
| --- | --- | --- |
| Entry points | `desktop/web/src/main.tsx` and `main.web.tsx`; Vite chooses adapters at build time | Keep two thin composition roots and browser bundle exclusion checks |
| Workspace | `src/app.tsx` and `src/web/WebApp.tsx` separately assemble dock, panels, canvas, and PDF dialog | Share meaningful composition policy; avoid a wrapper that simply receives two unchanged trees |
| Shell commands | `src/app/shell-commands/index.ts`, Desktop command graph, `src/web/browser-shell-commands.ts` | Extend existing capability-based composition; do not create a second source of command availability |
| Design Session | Shared `src/app/document-session/replacement.ts`, `persistence.ts`, `store.ts`, and workflow runner | Preserve these authorities; do not replace them with an application-wide service object |
| Canvas mounting | Desktop hook delegates to `document-session/lifecycle.ts`; `WebCanvasWorkspace.tsx` contains substantial host lifecycle logic | Assess common host mechanics separately from edition save, attachment, and close policy |
| Catalog | Shared `app/plant-browser/workbench.ts`; native SQLite and Web DuckDB-WASM/Parquet adapters | Share caller behavior without migrating databases or expanding Web data |
| Catalog presentation | Desktop `PlantDbPanel`, `FavoritesPanel`, `PlantDetailCard`; Web `WebSpeciesCatalogPanel` | Trace differences before extracting interaction/layout; reduced detail is intentional |
| Planning panels | Calendar, Budget, Consortium and workbenches already shared | Preserve and use them as the reference pattern |
| Tests | Toolbar parity, shell catalog/projection, Web workspace, document lifecycle, and packaging tests already exist | Extend/migrate their behavior coverage; do not duplicate suites or replace them with DOM shape checks |
| CI | `.github/workflows/build.yml` runs Desktop frontend build; no workflow invokes `build:web` or `check:ui` at baseline | Add actual Web bundle and gallery gates, not just configuration assertions |
| Gallery | Memory backend, disposable canvas, deterministic states; some `edition=web` stories already exist | Reuse this host and extend coverage to actual edition compositions |

Paths beginning `src/` in the table are relative to `desktop/web/`.

## Preserve intentional edition differences

Read ADRs [0008](../../adr/0008-species-catalog-storage-adapters.md), [0020](../../adr/0020-web-edition-browser-app-shell.md), and [0021](../../adr/0021-web-edition-compile-time-adapters.md), plus relevant Web-scope ADRs linked by the Browser Edition guide. These are constraints on implementation, not permission to add features.

- Web omits Design Location/geocoding/map editing, native Notebook navigation, Problem Reports, updater, native close controls, Recent Design paths, and native Save/Save As. Preserve imported Location and unsupported data on save/download.
- Native Save has durable write/acknowledgement semantics. Browser Download requests delivery and does not prove durable filesystem persistence. Browser Draft autosave/recovery remains distinct from native autosave and backups.
- Web catalog scope includes reduced filters/detail, selected-locale names, and limited image metadata; this is more than a difference in record count. Use existing generated supported-field contracts. No database migration, richer Web catalog, new image service, offline-first behavior, or new runtime dependency is required.
- Preserve the optional, statically configured Web Templates surface and its default-empty behavior. Do not restore the retired Desktop Community service.
- Preserve current shell, catalog, and Favorites UX unless a specific behavior change is separately justified. Narrow-window or touch behavior should be driven by layout/input needs where practical; do not equate the browser edition with a phone.
- Keep typed, compile-time infrastructure selection. UI may render supplied capabilities, but shared modules must not inspect `isWeb`/`isTauri` to select native or browser I/O. A `location: false` flag alone does not prevent native imports from entering a browser bundle.

## Implementation slices and acceptance

Create or reuse one bd epic and scoped child beads. Put durable problem statements in descriptions, implementation detail in design fields, and observable completion criteria in acceptance fields. Link this specification rather than copying it into every bead. Slice A precedes B; C and D follow B and can be delivered independently. Use scoped branches and preserve integrated fixes when starting each slice.

### A. Reliable edition feedback loop

Add a discoverable Web dev command using the existing Vite Web mode and a port distinct from Desktop's 1420 and gallery's 1422. Verify the actual base URL/entry route, font prerequisite, catalog prerequisites, and concurrent server behavior. Do not promise that Web dev is memory-only: the real Web app uses browser storage. Expose a small, clearly named combined edition verification command if it reduces command duplication. It must propagate failures, reuse existing gates, and avoid unnecessary repeated full tests or typechecks.

Add `npm run build:web` and `npm run check:ui` to appropriate pull-request and main CI jobs. Retain existing Rust, Desktop, generated-contract, packaging, and PDF gates. Ensure Web checks can run without private plant data or release credentials; use deterministic generated fixture assets where artifact validation requires data. State clearly which checks prove bundling, fixture packaging, and actual release-catalog admission. Do not use empty assets to claim production catalog validation.

Acceptance: a clean supported checkout can follow documented setup and run Desktop, Web, and gallery on distinct ports; CI runs real edition builds and gallery typechecking; browser bundles still reject native dependencies and oversized emitted assets. Existing `/app/` and root-subdomain artifact behavior remains covered. Explain prerequisites, first-run downloads, and cache reuse truthfully.

### B. Shared workspace composition

Concentrate common dock routing, planning-panel mounting, Calendar expansion/manual resize policy, and shared dialog placement in a small shared composition module. Supply edition-specific surfaces and operations at the composition root using existing command identities/capabilities. Keep native title/window integration and browser file shell behavior explicit. Preserve lazy loading where currently useful; do not eagerly bundle every Desktop surface through a shared registry.

Ensure command navigation and mounted panel availability agree. Do not maintain independent boolean lists for commands and panels; derive or validate their relationship through the existing capability model. An unsupported panel must not expose a blank dock or dispatch native work. Typed panel registrations or explicit slots are possible tools, not prescribed architecture.

Extend the memory-only gallery to exercise both production workspace compositions with supported panels, shell actions supplied by memory adapters, and real interactions. Edition switching in the gallery must have one live runtime owner; sequential mounts are sufficient. Avoid simultaneously mounting two roots backed by shared global session signals.

Acceptance: changing common dock/planning mounting behavior has one owner; both roots use it; existing visual hierarchy and capabilities remain; switching side panels preserves canvas instance, history, selection, and view state. Primary navigation to Location/Templates has different existing mounting behavior: preserve its loss-prevention semantics and test it separately. This refactor does not require keeping hidden canvases alive across every primary route.

### C. Canvas-host lifecycle assessment and bounded extraction

Trace Desktop `use-canvas-document-session.ts` and `lifecycle.ts`, Web `WebCanvasWorkspace.tsx`, shared `canvas/runtime/lifecycle-owner.ts`, and their tests. Record ownership of host construction/init, DOM refs, ruler attachment, resize observation, session publication, detach/handoff, teardown, and failed-disposal retry.

Extract common host mechanics only when they can sit behind a smaller interface that preserves edition attachment policy. Keep Desktop dirty/close/settings/autosave coordination and browser Draft behavior in their current policy owners. A factory with numerous lifecycle callbacks whose callers still reconstruct ordering is not an improvement.

Acceptance: provide a before/after ownership map and observable lifecycle coverage. If extraction would increase caller complexity, retain the separate adapters and document the concrete reason in the bead and durable guide. Otherwise migrate both callers, preserve recovery obligations, and delete replaced code only after behavior coverage transfers.

### D. Catalog presentation assessment and bounded consolidation

Compare actual search, filters, loading/error/retry, paging, list/card choices, drag/drop, Place actions, Favorites detail navigation, and detail rendering. Preserve approved differences rather than treating the richer Desktop UI as the default for all callers. Common interactions should consume the existing Species Catalog Workbench. Reduced/full detail slots and supported-field projections may remain different.

Acceptance: document which duplicate behaviors were unified and which differences remain intentional. Changes must preserve keyboard/focus behavior, localized matching/display, query cancellation/stale-result handling, unavailable-data behavior, and supported filters. Retain edition-specific views where extracting a shared one does not reduce ownership complexity; record evidence. Do not turn this slice into a general catalog redesign or storage rewrite.

## Non-negotiable lifecycle and data invariants

Canvas SceneStore and non-canvas Design Edit retain separate authority. Ordinary Budget, Calendar, Consortium, settings, and panel-state changes must not reload the canvas or clear history. View state follows the Design Session identity. Replacements, including Designs with repeated object/action IDs, invalidate predecessor drafts and delayed callbacks.

Save/download and ordinary edits preserve unknown/deferred fields, recurrence/dependencies, mixed/unavailable targets, IDs/order, malformed/end-only dates, Location, and existing Consortium data. Do not normalize away unsupported data to make both UIs look identical. Preserve existing canonical wire encoding and compatibility tests.

Every effect, listener, observer, timer, worker, portal, and async operation has a lifecycle owner. Exercise unmount during initialization, Design replacement while work is pending, reentrant attachment, failed detach/disposal and retry, and HMR. Never publish an obsolete host or discard a failed loss-prevention handoff just to finish teardown. Preserve popup selection, Escape hierarchy, focus restoration, placement, and cleanup if shared shell/layout changes affect them.

## Required documentation deliverables

The implementing agent must update operating docs in the same slice as code or command changes. Proposed behavior stays labeled proposed until its implementation and checks exist. Replace contradictions; do not append exceptions beneath obsolete rules.

| Document | Required treatment |
| --- | --- |
| `AGENTS.md` | Keep repo-wide rules concise; add routing to the edition workflow and update common commands/quality gates when delivered |
| `docs/agent/edition-development.md` (new) | Own the daily workflow described below, edition responsibility map, and verification selection |
| `docs/agent/frontend-patterns.md` | Route shared workspace and edition work to the correct guides |
| `docs/agent/browser-edition.md` | Replace obsolete file/import instructions after moves; retain product exclusions and browser persistence semantics |
| `docs/agent/frontend-runtime.md`, `frontend-workbenches.md`, `frontend-chrome.md` | Update shared composition, catalog, and shell owners affected by the slice |
| `docs/agent/document-lifecycle.md`, `canvas-runtime.md` | Update host/attachment/teardown ownership if C changes it; avoid duplicate descriptions of the same lifecycle policy |
| `docs/agent/frontend-validation.md`, `build-release.md` | Reconcile local/CI commands, test tiers, prerequisites, artifact checks, and platform limitations |
| `desktop/web/ui-gallery/README.md` | Document working edition scenarios, URLs, reset/isolation guarantees, and which integrations remain outside the gallery |
| `README.md`, `docs/README.md` | Link the durable workflow and remove stale discovery paths |
| `.interface-design/system.md` and relevant family guides | Update only if surface ownership or reusable interaction rules change; preserve tokens/hierarchy |
| ADRs and `CONTEXT.md` | Review for contradictions; update implementation references without erasing history. Record a new decision only for a material architecture change |
| This handoff and bd metadata | Record disposition and link delivered guides; retire execution instructions when fully integrated rather than leaving a second operating contract |

The new daily workflow guide must let an agent with a fresh checkout answer these questions without reading every subsystem guide:

1. What owns the requested behavior? Show entry roots, shared workspace/workbench policy, and real infrastructure adapters. Explain how to trace component → action/workbench → Design Edit/runtime/persistence.
2. How do I start safely? Show status/claim/branch steps, supported tool prerequisites, dependency setup, and fixture selection. Preserve dirty/untracked work and use isolated profiles for real app sessions.
3. What do I run while editing? Document tested commands for gallery, real Web dev, and Desktop dev; their ports/URLs, reset procedure, teardown, and whether they touch storage. Prefer the memory gallery for routine shared UI work. Do not imply that a temporary output directory alone isolates Tauri app data.
4. How do I test efficiently? Start with a focused regression at the behavior owner, use shared scenarios for both compositions, and test differing adapters at their actual interfaces. Full broad gates run at integration; rerun after relevant changes or rebases, not after every prose edit. Do not label jsdom clicks as native WebView validation.
5. How do I finish reliably? Update affected guides and bead criteria, migrate assertions before deleting tests, inspect both staged and unstaged changes, run applicable final gates, export beads, commit/push, and report exact revisions/results/limits.

Include a short change-to-check matrix: shared UI/composition, native adapter, browser adapter, catalog contract, persistence/lifecycle, and docs-only. Link gate definitions to their authority and executable scripts; avoid copying long command lists into several guides. Validate commands from the documented working directories. Eliminate stale file references and ensure proposed commands are not advertised as already available.

## Verification and release criteria

Use synthetic deterministic fixtures; no Downloads files, saved user Designs, user settings, or active Desktop sessions. Validate empty/populated/mixed/unavailable data, long names, narrow width, short height, light/dark, French, and keyboard interactions for changed surfaces. Use real clicks, focus transitions, and actual resize/scroll where relevant. DOM placement alone is insufficient evidence.

Reuse and extend `canvas-toolbar-command-parity.test.tsx`, `shell-command-catalog.test.ts`, `web-shell-projection.test.ts`, `web-app-shell.test.tsx`, `web-canvas-workspace.test.tsx`, `browser-canvas-runtime.test.ts`, relevant document-session tests, `frontend-architecture-policies.test.ts`, and Web build/packaging tests. Find additional coverage through callers. Transfer every meaningful regression assertion before removing old tests; preserve architecture guard strength when ownership changes.

For the integrated frontend change, run from `desktop/web/`:

```sh
npx tsc --noEmit
npm test
npm run check:ui
npm run check:types
npm run build
npm run build:web
```

Run focused Vitest during each slice and the delivered combined command as applicable. For root/subpath packaging changes, exercise both packaging modes with deterministic admitted assets and keep production release-asset validation distinct. Never overwrite checked-in generated files or user-owned artifacts just to check drift.

Apply all additional `AGENTS.md` gates for touched areas. Rust/mixed changes require formatting, strict Clippy, workspace check, and relevant workspace/native-policy tests. Persistence changes require workspace tests even if edited files are TypeScript. Shared authored contracts require generation and drift verification; catalog contracts require the prescribed Python checks. Use an isolated copy for generation when needed to preserve existing work. Always run `git diff --check` and validate affected Markdown links/code-path references.

Exercise changed interaction paths in isolated browser sessions and actual WebKitGTK when available; keep macOS/Windows coverage explicit. Preserve the production PDF WebView workflow. Its encoder/preview/byte-delivery test does not prove shell, popup, native save-dialog, or packaged-app behavior. Document how missing platforms are covered in CI and which checks remain unverified.

Record command, working directory, exit result, relevant test counts, commit, and limitations in bead notes. Establish baseline failures on the same baseline/environment before classifying them as pre-existing. Never weaken a gate, silently skip a failed platform, or treat green unit tests as proof of complete release readiness.

## Completion and handoff

Required delivery includes A and B, explicit completed assessments/dispositions for C and D, transferred regression coverage, the durable daily workflow guide, coherent affected docs, and truthful bead metadata. Do not call a mandatory failed gate complete. Track out-of-scope defects and any retained architectural follow-ups in bd with concrete evidence.

Follow repository commit/push rules on scoped branches. Before reporting integration, verify the intended checkout actually contains all required slice commits and check the combined result. Do not publish a release or deploy the website as part of this refactor. Report shipped behavior, retained differences, code/documentation ownership, tests and platform gaps, bead IDs, commits, branches, and untouched user work.
