# Raster rework completion contract

Status: active — consolidated correction handoff after independent review of candidate `26eca68a`; not independently accepted.
Tracking: `canopi-j571.1` under `canopi-j571`; continue the existing candidate bead/branch. No replacement epic or duplicate implementation bead.
Current guidance: [execution prompt](completion-agent-prompt.md), [correction decisions](completion-correction-design.md), [current review](completion-review-26eca68a.md), [broader product contract](../raster-data-analysis-rework.md), [ordered-source contract](ordered-cog-design.md), [LiDAR](../../agent/lidar.md), [delivery](../../workflow/delivery.md).

## Outcome, authority and exclusions

Finish the initial rework: users can import the representative larger numeric rasters, manage reusable Data Layers, run slope, arrange independently visible data/results, inspect physical values, and place a Design/use shared basemaps in Web. Deliver one combined, verified candidate with platform limits stated honestly. The user selected the entire sequence and sustained execution; intermediate phases do not require renewed authorization.

This contract and its [source-import amendment](source-import-design.md) supersede the original C1 limits and compulsory preview/measurement route. The [R27–R43 review](completion-review-26eca68a.md) and [earlier R15–R26 review](completion-review-5d0a5e0b.md) supply evidence, not separate assignments. The [correction decisions](completion-correction-design.md) settle the current repair sequence and lifecycle details within this contract. This contract replaces the old active ordered-correction prompt and the broader plan's expired execution freeze. It does not replace its settled product/scientific/provider rules. Precedence: repository safety/ownership → this contract's scope, capacity and delivery decisions → ordered COG composition/history rules → broader product contract and approved UI references. The old overlap-replacement checkbox, compulsory merged-source publication and Q prerequisite are retired, not passed.

The main agent owns architecture and independent review. The implementation agent owns all execution and contract-preserving local decisions. The user remains courier and retains consequential scope/risk authority. Foundation integration is already complete at `f61f8494`; C0 now verifies preservation and establishes the correction baseline. New implementation is pushed as a candidate for independent review; no public release, deployment, branch deletion, paid-service purchase or user-profile mutation is authorized.

Exclude new engines, custom raster codecs, precision migration, reprojection/resampling, local RGB/RGBA orthophotos, point clouds, hydrology/aspect/canopy expansion, Web local-raster processing, Web address search, offline map archives and PDF map export. General published-asset reclamation and a per-occurrence source-name column remain separate follow-ups. Preserve originals and accepted history even when deleting a source from a current composition.

## Inspected baseline and reuse decisions

The implementation baseline is `26eca68a` on `feature/raster-rework-completion`
in `.rq-scratch/wt-candidate`, descended from main integration `f61f8494` and
accepted foundation `34e4ded4`. Gates and real-fixture measurements were reported
at code tip `b4ab8fe6`; independent review reproduced ten failing assertions while
44 tests passed. Preserve the one-step import, v18 metadata migration, meaningful
R12–R26 repairs and their measurements. The review still requires functional,
resource-admission and evidence corrections; existing green totals are not acceptance.

The primary documentation checkout is `feature/raster-html-references`; its
pre-existing `.beads/issues.jsonl`, `desktop/src/native_operation.rs` and
`.beads.gate.lock` are user-owned. Do not stage, stash, reset or overwrite them.
Use the clean candidate worktree, inspect actual status/ancestry first, and merge
this committed docs handoff preserving candidate receipt/debrief evidence.

| Reuse/adapt | Concrete owner and retained behavior | Necessary addition / maintenance cost |
| --- | --- | --- |
| Reuse native library and selected dependencies | `desktop/src/services/lidar/{mod,collection,generation,prepared_raster,analysis,tiles}.rs`; `CollectionReader`, `GenerationReader`, `LidarLibrary`, GDAL slope and pinned native TIFF reader | Capacity consumes the same public callers. Inspection adds one bounded lookup, not another decoder/service. Preserve numeric/cancellation/legacy regressions. |
| Adapt one admission policy | `services/lidar/admission.rs`, `import.rs`, `paths.rs`; thread-local `limits_probe`, checked sizes, original copy/hash, disk checks | C1 removes arbitrary input policy ceilings after bounding preparation and metadata; actual working-resource/legacy guards remain. See the source-import amendment. |
| Reuse asynchronous library and document owners | `desktop/web/src/app/lidar/{actions,library-store}.ts`, `app/design-edit/lidar.ts`, ordered panel traversal/edit lifetimes | Split UI responsibilities without duplicating library state or moving jobs into components. Library data stays separate from Design presentation/history. |
| Adapt accepted UI with production primitives | `components/panels/lidar/`, `components/shared/`, workspace/shell registration; HTML reference `0e696722` | New Data/Analysis dock surfaces and flat presentation list, using existing fields, menus, tokens and focus behavior. No prototype runtime in production. |
| Reuse map, camera and placement | `app/canvas-map-surface/`, `maplibre/{host,surface-adapter,config}.ts`, `app/location/{coordinate-workbench,map-editing}.ts` | Inspection arbitrates existing canvas gestures; Web supplies coordinate placement without native search. Provider replacement updates contributions, not map lifetime. |
| Adapt settings/network boundaries | `app/settings/{platform-adapter,projection,state}.ts`, `desktop/src/http.rs`, executor-backed commands | Device-local Google setting and bounded provider requests; native HTTP only through fixed provider operations, never arbitrary caller URLs. No second settings store. |

The candidate already supplies the new dock surfaces; correct and complete their callers rather than reconstructing them. Existing readers, controllers, map host and settings are sufficient foundations. New runtime dependencies, a general task engine or a universal workbench framework are not justified by this handoff. If measurement disproves sufficiency, return the counterexample before replacing the engine or ownership model.

## C0 — retain the candidate and establish correction evidence

Inspect status, remotes, worktrees and `bd show canopi-j571.1`; claim/resume that
bead. Do not replay completed foundation integration or create a replacement
branch from a baseline missing candidate code. Merge this documentation handoff
into `feature/raster-rework-completion`, resolving current guidance in favour of
this contract and preserving revision-labelled delivered evidence. Reconcile the
existing bead's design/acceptance with C0–C5 and R27–R43; do not reopen accepted
foundation work or erase historical evidence. Bead exports must preserve unrelated
dirty records according to the issue workflow.

Begin external prerequisite discovery now: available disk/RAM, fixtures, working
isolated GUI recipe, existing non-publishing CI/platform runners, package assets,
and optional restricted Google key through device settings. Inspect/reuse the
existing fixture generator if needed; do not create another raster-processing
runtime. A missing key/host blocks that observation only. Try the documented file
chooser path using clipboard paste/short owned paths instead of repeating lossy
synthetic typing; classify automation failures separately from app defects.

**Exit:** retained candidate ancestry, updated existing bead, precise prerequisite
inventory and reproduced current review cases at appropriate caller boundaries.
Review probes in `/tmp/canopi-review-26eca68a` are optional local evidence; ordinary
committed regressions must remain reproducible without that scratch directory.

## C1 — independent source import and bounded capacity

Implement [Source import without collection-wide preparation](source-import-design.md).
It is the authoritative user flow, interface, migration, metadata, resource and
acceptance decision for this phase, replacing the original conservative policy.
Do not merely remove constants or hide previews. Remove the actual composed scan
from import and metadata edit publication; preserve numerical readers and
history. Source-level exact facts and result statistics remain distinct from
source-derived display ranges and unknown composed coverage.

Start with a small real caller fixture proving the new prepare → atomic publish
route, metadata semantics and failure recovery, then qualify larger inputs.
Bound copy/conversion/indexing and all publication/read consumers before removing
production input ceilings. An intermediate branch checkpoint may retain old
limits until safe; the delivered new route must use the amended admission, or
remain explicitly partial with the demonstrated blocker. Do not ship a bypass.

**Exit:** all amendment acceptance examples, migration/fault regressions, resource
measurements and real Data import flow pass. R23 and R26 are closed by this new
route's own evidence, not old preview-route measurements. No forced exact composed
statistics feature is added to replace the deleted scan.

## C2 — production Data, Analysis and Layers

Use the [approved reference contract](../raster-data-analysis-rework.md#html-ui-reference-contract) at `0e696722`, the [interface system](../../../.interface-design/system.md), dock family guide and [frontend routing guide](../../agent/frontend-patterns.md). Inspect actual components in the gallery before adapting. UI approval already exists; material departures need review, not faithful translation into Preact/CSS Modules.

Register Desktop Data and Analysis beside Layers through existing shell commands/workspace composition. Data manages reusable datasets, compatible imports, Add to Design, rename, source priority, history/Undo/Restore and confirmed library deletion. Analysis offers Slope only, compatible ground inputs with ineligible reasons, result name, degrees/percent, Run/Cancel/Retry and previous-result visibility during refresh/failure. Layers becomes a flat geographic presentation list in actual saved order, with independent source/result eyes, opacity, ramp/legend, extent navigation and undoable Remove from Design. Library delete and presentation remove remain different operations. A Data Layer eye controls its composed source presentation; it does not implicitly hide an independently displayed analysis result.

Use C1’s Data-owned chooser/interpretation/Import flow; replace the old staging/review/Apply interaction. Existing visual references govern components and hierarchy, not their retired preview/confirmation steps. Renaming library data does not dirty every Design. Adding/removing/reordering presentation uses Design Edit and coordinated document history; source priority changes library composition and triggers dependent analysis. New attachment is fenced to the originating Design session; closing the panel does not cancel a submitted job.

Reuse `app/lidar/actions.ts`/`library-store.ts` for jobs and settlement and `app/design-edit/lidar.ts` for presentation. Extract cohesive UI/workbench modules as needed; no controller-to-controller imports or mirrored canvas entity stores. Preserve separate collection/History traversal identities, edit ownership through settlement, expected-head edits, paging and unmount guards when replacing the old combined component. Do not create a second job scheduler.

Use shared contract fields where present. Any missing result name, unit or style metadata is added through the existing library/presentation/settings owners, with generated bindings and backward-compatible defaults. Maintain format-6 unknown-entry fields and stable `lidar` serialization. Percent slope colors use observed percent range; degree slope keeps 0–90° semantics. Constant domains and unknown saved styles follow the product contract. Library deletion includes dependency/current-Design impact and warnings about other Designs; successful deletion leaves unresolved external references honest, never remapped to another ID.

**Exit:** Data → import → Analysis → Layers works through real native commands; changing panels/Designs during jobs cannot misattach results or orphan pending state. Independent eyes/order/legends survive save/reopen; Remove is undoable without deleting the library. Both themes, 390px width, keyboard/focus and actual long translations in all 11 locales are checked through production gallery fixtures. Web preserves unavailable local references and imports no Desktop raster capability.

### Desktop corrections R23–R25

Data owns import progress, errors and retry under C1. Reuse one coherent source
management detail for Data's priority/History operations instead of duplicating
traversal state. Layers stays presentation-oriented; expose undoable Remove from
Design for source/result/unavailable entries using existing Design Edit, with no
library deletion. Library Delete remains a separate confirmed Data operation.
Analysis owns the initial submit-pending latch through settlement and exposes the
actual action error once. Guard repeated Run before the first IPC settles, retain
jobs across unmount, and label percent versus degree results from their own
parameters. Initial Run creates a definition; Retry refreshes the failed definition
against the current head rather than silently multiplying identical definitions.
Reuse `analysis::enqueue_refreshes`/the existing `run_refresh` worker ownership,
factoring the definition-specific scheduling path. Add an executor-backed typed
`lidar_retry_analysis(definition_id, expected_source_generation_id)` operation
returning the existing analysis job receipt; reject missing/deleted or changed
inputs and an already active run. It schedules the named definition, not every
dependent definition. This is an authorized extension of the existing owner,
not a second scheduler; regenerate bindings and native policy registration.
Test each through the production panel and real action boundary, including failure.

## C3 — numeric inspection without another interaction owner

Repair the existing command to implement `sample(request id, entity, expected generation, WGS84 point)` from the [numeric interface table](../raster-data-analysis-rework.md#implementation-contracts). The candidate already has `lidar_sample_pixel`; adapt it rather than add a competing sampler. Maintain typed request/result under `common-types/src/lidar.rs`, generate adapters, retain executor-backed commands and policy registration through existing conventions.

The request names source/result identity, immutable expected generation and finite point. Refuse a head mismatch at admission and recheck currency before returning; immutable bytes stay leased through the read, and a changed head returns stale rather than relabelling an old value. The library authorizes that identity and leases the same `CollectionReader`/`GenerationReader` or existing result reader used by scientific callers. Inverse CRS transform then selects the containing native pixel using the north-up half-open grid convention; no bilinear display sample or PNG decoding. Return the generation with physical numeric value/units, explicit NoData, or categorized unavailable/stale result. Out-of-coverage is NoData; missing/deleted generation, failed transform and unsupported input are unavailable. No raw path, raster buffer or third-party object crosses IPC. New operations use categorized outcomes; preserve compatible existing commands instead of undertaking a wholesale error-transport rewrite. Scientific Float32/scale/validity rules remain unchanged.

The canvas/workspace lifecycle owns one inspection session containing Design/session, entity, generation and request identity. Pointer or center-keyboard samples supersede older requests; layer/head/Design change rejects late responses. Cancel native work through the existing bounded read cancellation pattern rather than a detached timer. Entering Inspect suspends drawing/selection while preserving navigation; Escape, toggle off, hidden/removed layer, Location navigation or teardown exits and releases listeners. Use current interaction/camera seams, not MapLibre drag handlers or a second gesture owner. The inspection status is read-only and not saved in a Design.

**Exit:** click and keyboard-center return independently known physical values for source and slope. Half-open pixel boundaries select the adjacent cell; report NoData only when no member supplies a valid sample there, including outer uncovered edges and holes. A late answer after head/selection/Design replacement never appears current. Pan/zoom works, drawings remain intact, Escape restores normal tools and repeated mount/unmount leaves no listeners/reads. Accepted inspection reference, units, accessibility and runtime tests pass.

### Inspection corrections R15–R18

Use `canvas/projection.ts`'s existing `worldToGeo` for the actual scene point;
remove the candidate's anchor-plus-offset IPC path and duplicate bearing math.
The unreleased command may change in lockstep with generated bindings; no saved
Design contains that request. The displayed coordinate is the sampled point.
Native lookup transforms this WGS84 point into the chosen source/result CRS once.
Resolve source and analysis manifests/readers separately; use result parameters
for degrees/percent units. Use checked signed lattice indices and actual member
coverage, not the original first source's width/height. Historical dense/chunked
source and result reads reuse their existing compatible numeric readers.

Add an opaque request ID to the sample request and use the existing library
read-admission/cancel mechanism used by raster tile requests. The command must
pass its real cancellation flag, not an always-false local flag; retain finite
GDAL transform waits. Scope IDs to the originating runtime/session so one owner
cannot cancel another's active read. Register cancellation before work can block,
release permits/leases on every result, and fence both backend head currency at
completion and frontend Design/entity/head/request identity at publication.
The workspace owns the disposer; hide/remove, Design replacement, Location and
teardown exit. Escape/toggle off restore the prior tool. Expose a focusable Sample
at view centre button in the status surface, invoking the existing camera/query
seam; no new global shortcut is needed. Keyboard activation and pointer sampling
share the same command. Pan/zoom remains available during inspection.

Acceptance includes real unique-valued native cells at non-equatorial latitude,
nonzero bearing and beyond the original source extent, source and both slope
units, supported historical formats, and late head/Design replacement. Use an
independent geographic fixture oracle, not a copy of the projection formula.

## C4 — Web Location and shared basemap providers

Implement the settled [Web/provider contract](../raster-data-analysis-rework.md#web-location-and-basemaps). Retain candidate ADR 0028 and the updated ADR 0013/0016 status links; repair the actual shared-provider wiring without reopening that edition scope. Update relevant guides and equivalent/stronger architecture guards together. This authorizes Web map/coordinate placement and shared providers; it does not authorize native geocoding, local-raster processing, PWA or PDF map capture in Web.

Web composes `coordinate-workbench.ts` directly with a browser-safe Location surface; Desktop retains native search as an injected capability. Coordinate/map preview, Confirm/Move, Cancel/Escape and document Undo retain the complete spatial frame, altitude and north bearing. Camera movement alone never commits. Map failure leaves coordinate entry usable. Keep Location and Canvas lifecycle ownership exclusive.

Use the broader contract's provider/settings/session state machine, fixed retry/timeout policy, viewport attribution, cache/privacy boundaries and source replacement rules. Adapt the current contribution descriptor's fixed 256 tile size/zoom-19 assumptions to honor the actual provider descriptor while preserving current OSM/MapTiler values. Preserve saved `satellite` as MapTiler even without its build key; show unavailable instead of silently switching to street. Add `google_satellite` separately; the optional key is device-local, masked and excluded from Designs/exports/diagnostics. No key means the already selected keyless path with its exact non-blocking prompt; a configured official-key failure never silently downgrades.

The native HTTP helper currently offers GET/bounded response reads; it is not a generic provider proxy. If WebView access needs native transport, add fixed typed Google session/viewport operations through the network executor class, with bounded response bodies, cancellation, safe errors and fixed endpoint construction. Caller-supplied arbitrary URLs, headers or filesystem paths are not accepted. Share provider policy across editions and inject only the HTTP adapter. Use existing dependencies. Session/viewport requests and timers belong to the active provider generation and map lifetime; no settings-owned map, no `setStyle()` or map recreation on key/provider/session changes.

Official session response shape/expiry, viewport metadata and attribution were rechecked on 2026-09-22 against [session documentation](https://developers.google.com/maps/documentation/tile/session_tokens), [2D overview](https://developers.google.com/maps/documentation/tile/2d-tiles-overview) and [policies](https://developers.google.com/maps/documentation/tile/policies). These support API behavior, not live access on this account or guarantees for the keyless endpoint. Verify material changes at implementation. A real supplied restricted key and account-appropriate content access are external prerequisites for live official qualification; use fake recognizable credentials for fault tests and never infer service success from mocks.

**Exit:** both editions change provider/key/opacity without losing camera, scene, overlays or placement; out-of-order session/viewport answers are fenced; hidden/provisional Canvas issues no remote imagery work. Actual isolated Web placement saves/exports/reopens the same frame, including Undo and map-error entry. Test fake-key redaction in thrown errors, URLs, response bodies and diagnostics. Observe provider attribution/error states live and record credential/platform gaps rather than fabricating them. No service purchase or public release.

### Provider corrections R19–R22

Keep one concrete provider per mounted map lifetime on Canvas, Location and World
Map in each applicable edition. The map owner creates/disposes it; settings supply
reactive style/key/locale inputs rather than owning the map. Key/style/locale
replacement aborts obsolete session/viewport work and advances identity. Settled
viewport moves coalesce into one current metadata request; they need not recreate
the session. Parse epoch-seconds expiry strings, schedule renewal before expiry,
and dispose renewal/backoff timers and HTTP on teardown. A rejected configured
key never silently selects the keyless route. Hidden/provisional Canvas does not
request provider imagery/session work; reactivate using current settings/view.

Use MapLibre's request transformation seam at map creation with a closure over
the current provider transport to authenticate official tile requests. Published
source descriptors contain a non-secret official endpoint template; the transport
adds the current session and API key for that fixed Google tile endpoint only.
The binding must not leave `{session}` unresolved. Session and viewport HTTP use
fixed endpoint construction and the configured key. Keep ephemeral credentials
out of Designs, exported state, reports, receipts and log/error strings; real
network requests necessarily carry them. Sanitize map request errors too, not only
session-fetch exceptions. A fake credential test must observe the actual outgoing
tile request and separately prove safe persistence/diagnostic boundaries.

Do not mark the official contribution ready until a valid session and usable
viewport attribution/availability exist. Consume returned copyright and
`maxZoomRects`, rather than a universal zoom ceiling; do not request imagery above
its applicable availability. Metadata failure becomes an actionable unavailable
state, not falsely current attribution. Normal HTTP/timeout/authentication errors
must be distinguished; transient retry retains the existing finite policy.
The browser adapter counts streamed body bytes and cancels at 256 KiB even when
Content-Length is absent. Preserve cancellation during reads/backoff.

Wait for map style readiness before applying the latest provider state, and fence
callbacks to the live map. Update attribution without resetting the raster source
when its tile configuration is unchanged. Use existing layer-stack reconciliation
for provider changes, preserving source/result/custom-layer order, visibility,
opacity, camera and placement. Do not use `setStyle()` or recreate the map for
key/style/session changes. Real default street/keyless map startup must also work;
provider mocks must model delayed style load. Existing MapLibre 6 request/host
seams suffice; no generic proxy, new protocol framework or second map owner.

Prove actual key changes, expiry, viewport movement, delayed startup and disposal
through mounted callers. An HTTP mock establishes request construction and failure
handling, not Google account access. Reuse official sources linked above and
record real restricted-key observation separately.

## C5 — final candidate, independent review and debrief

Run repository gates for the final combined native/frontend/IPC/settings/edition diff: fmt, strict workspace Clippy/check/tests, native command policy, GDAL-backed ignored LiDAR lane (external fixture separately identified), generated bindings/drift, TypeScript, full Vitest, gallery check, both frontend builds and docs validator. Commands and working directories are in [AGENTS.md](../../../AGENTS.md#quality-gates) and the [edition guide](../../agent/edition-development.md#verification-workflow). Rebase preserving merges onto current `main` before final mixed-architecture gates; verify all required tips and rerun affected gates on that tree.

Use the existing build/packaging workflows for Linux, Windows and macOS. `canopi-9357` requires the Windows capacity API build/test; `canopi-kc8z` requires repeatable GDAL regression coverage, preferably an existing CI job extended with the required pinned tools. No separate qualification service. Run available non-publishing verification workflows; do not trigger release publication. The inspected `.github/workflows/release-candidate.yml` accepts an explicit ref/version and has read-only content permissions; inspect its current behavior before dispatching it for the candidate. The existing `build.yml` runs on main pushes/PRs, so use a reviewable draft PR when needed for its checks, without merging new work before independent review. A green compiler is not a packaged-window smoke. Record build, real workflow and fixture coverage separately by platform; missing runners, signing or required catalog assets remain explicit prerequisites. Build Web artifacts using actual admitted catalog inputs when claiming package readiness; frontend compilation alone is not packaging.

Exercise the complete isolated Desktop flow including a **confirmed** Design Location, mounted data and slope, order/Undo/Restore, inspection, independent visibility, panel navigation during edit, save/restart and offline local assets. Repeat a bounded representative workflow through the packaged app. Build a disposable historical library using existing legacy fixture helpers, open it through the actual app and verify Previous composition/display/slope eligibility without mutating user libraries or adding a migration UI. Exercise Web placement/providers and `.canopi` round-trip with unknown/unavailable local references. Keep basemap-online requirements separate from offline local-raster operation.

Before delivery review the final diff independently of the implementation sequence: trace actual callers to authority, inspect failure/publication/teardown paths, derive scientific expectations independently and check material receipt claims against logs/bytes/screenshots. Repair in-scope findings. Do not broaden testing after passing gates without a new change or concrete uncertainty.

Update current subsystem/design guides as behavior lands, retaining historical evidence by revision. Reconcile completed related beads with scope and tests, export intended metadata, push the candidate to both destinations and verify ancestry/status. Keep new candidate acceptance and public release pending for their actual owners. A required unavailable gate yields partial delivery, even when all available work is complete.

The [receipt](completion-receipt.md) owns measured evidence; bd owns progress; the [debrief](review-and-debrief.md#whole-rework-delivery-and-improvement) owns the final synthesis and tested improvements. Finish one consolidated handoff with completed capabilities, exact limits, integration/candidate revisions, gates, measured resource envelope, external blockers and applied versus proposed improvements. Independent review follows; no routine phase needs another prompt.

## Execution sequence and completion disposition

C0 establishes preservation and prerequisite inventory. Execute the current
[correction sequence A–D](completion-correction-design.md#a--finish-the-import-and-inspection-lifecycle-first)
inside C1–C5: small lifecycle/workflow repairs first, provider transitions, bounded
native admission/measurements, then combined self-review/gates. These phases do not
require separate prompts. A required unavailable proof yields partial delivery;
continue independent code repairs and available gates before returning.

R27–R43 and retained R15–R26 obligations need repair-and-regression receipt rows
or concrete counterevidence, not a self-approved weakening of the contract.
C1 replaces the old source policy after its resource prerequisites hold. Final
self-review checks all C0–C5, not only numbered findings. Independent acceptance
comes next; integration into the primary development checkout remains separate.
