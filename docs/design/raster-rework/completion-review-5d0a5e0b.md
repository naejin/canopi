# Completion candidate independent review

Status: evidence — independent review; changes required.
Tracking: `canopi-j571.1`.
Current guidance: [completion contract](completion-design.md), [LiDAR guide](../../agent/lidar.md), [architecture ownership](../../workflow/architecture-ownership.md).

Reviewed candidate `5d0a5e0b` on `feature/raster-rework-completion`.
The accepted foundation is not reopened. This review does not authorize merging
or releasing the candidate. The [completion contract](completion-design.md)
remains the acceptance baseline, subject to the import direction below.

The subsequent [source-import contract](source-import-design.md) now settles that
amendment for implementation. This review remains evidence at `5d0a5e0b`; use the
current prompt/contract for the complete correction assignment.

## Verdict and evidence

The remaining work is not just four unavailable observations. Inspection and
provider wiring have functional defects; parts of the Desktop workflow are
missing. The receipt correctly calls delivery partial, but its claim that all
capabilities are implemented is not supported by the code.

Review included the changed native inspection/import/admission paths, their
readers and manifests, frontend inspection/canvas projection, provider transport
and mounted callers, Data/Analysis/Layers, and capacity evidence. Source locations
below refer to the candidate, not the older documentation checkout.

An isolated archive at `.rq-scratch/review-5d0a5e0b` contains diagnostic additions
to `lidar-inspection.test.ts` and `basemap-provider-binding.test.ts`. Running
`npx vitest run src/__tests__/basemap-provider-binding.test.ts src/__tests__/lidar-inspection.test.ts`
from its `desktop/web` produces **five failing diagnostic probes and 16 passing
existing tests**. The failures establish unresolved tile session URLs, missing
viewport authentication, copyright not reaching the map, stale head answers,
and inspection surviving Design replacement. Output is in `review-probes.log`
at the archive root. These are review probes, not committed production tests.

Other findings are caller/implementation traces, identified below; no new real
Google, packaged-window or platform run is claimed. The candidate remained clean.
The diff from `2b39ee2a` to `5d0a5e0b` contains only the receipt, debrief and bead
export, consistent with the reported gate revision. The full gate suite was not
rerun for this review.

## Required corrections

### R15 — P1: sample the geographic point the canvas actually displays

`desktop/web/src/app/lidar/camera-request.ts:88` derives east/north from the
scene point, but `desktop/src/services/lidar/inspection.rs:134` rotates that
offset back and adds its metres directly to the raster CRS coordinates. This
undoes the Design bearing and assumes projected units and scale equal local
metres. For example, Web Mercator at approximately 48° needs a scale adjustment;
a degree-based grid cannot accept a metre offset as degrees at all.

Reuse the canvas's existing `worldToGeo` projection, then transform that actual
WGS84 sample point into the native grid. Do not invent another spatial model.
Display that clicked coordinate instead of the anchor currently stored in
`inspectionLocation`. Invalid offsets must produce unavailable, not silently
sample the anchor. The native test's `project_offset` repeats the implementation
formula, and its transform test conditionally skips out-of-grid pixel assertions;
neither proves that a rendered point selects the correct native cell.

Regression: independently located, uniquely valued cells away from the anchor,
at nonzero bearing and non-equatorial latitude; assert the actual value read,
including a supported non-Mercator source CRS.

### R16 — P1: read analysis results through their actual storage contract

`inspection.rs:47–82` parses both source and analysis heads as
`import::GenerationManifest`. The analysis writer uses `analysis::ResultManifest`
(`analysis.rs:529`): it has no `members` and sparse results have `nodata: null`,
where the source manifest requires members and a numeric nodata. A published
slope therefore fails before sampling. After parsing is corrected, using the
source collection reader still does not identify the analysis result chunks.
The units also incorrectly come from the source layer, so slope would be labelled
metres instead of its selected degrees/percent.

Resolve source and result targets separately, reuse the existing appropriate
bounded numeric readers, and derive units from the result parameters. Exercise
actual published source and slope fixtures in both slope units, not just outcome
enum formatting. Preserve the required supported historical formats; the blanket
dense-generation rejection needs reconciliation with the compatibility contract.

### R17 — P1: do not clip ordered coverage to the original lattice dimensions

`inspection.rs:170–188` rejects negative cell coordinates and cells beyond
`manifest.grid.width/height`. An ordered collection keeps its lattice origin
while later members can extend outside the first source's rectangle, including
negative indices. Display and the collection reader support those signed
extents. Inspection currently reports NoData for valid appended coverage.

Use checked signed lattice coordinates and the generation's actual coverage/
bounded reader. Keep finite/index guards. Regressions need members extending on
both sides of the original extent, plus a true uncovered point.

### R18 — P1: connect inspection to the workspace lifecycle and head identity

`app/lidar/inspection.ts:53–56, 92–100, 155–161` fences only an internal request
counter. Nothing advances it when the current head changes or the Design is
replaced. The presentation reconciliation function has no production caller
after `beginInspection`; native currency is checked before the read only.
The five-probe run includes two failing reproductions of these stale-state cases.

Bind the existing session to Design identity, entity, head and request identity;
invalidate on hide/remove, Location navigation and teardown, and check identity
again at response publication. Release the installed pointer handler and cancel
superseded native work through the existing cancellation owner. The returned
pointer disposer is currently discarded. `sampleInspectionCentre` has no
production caller, so the promised keyboard sampling path is also missing.

Test lifecycle events through their actual owners rather than calling the
reconciliation helper manually from tests.

### R19 — P1: make the official Google request path usable

`maplibre/basemap-provider-session.ts` publishes the descriptor without replacing
`session={session}`; `basemap-contribution.ts` forwards it unchanged to MapLibre.
There is no request transformer supplying the token. A real key cannot repair
that URL. Viewport requests omit the API key. Returned copyright is stored on
state but ignored when creating the source; imagery becomes ready before usable
viewport metadata. `maxZoomRects` is ignored. Expiry parsing accepts a number,
where the documented response contains an epoch-seconds string.

Use an ephemeral authenticated tile transport, parse the documented response,
apply viewport attribution/availability, and retain safe credential handling at
logs, diagnostics and persistence boundaries. Keeping a token out of all tile
requests is not a privacy implementation. Three independent probes fail here.
The existing test explicitly asserting that no token reaches the map protects
the broken behavior and must be replaced by a transport-level assertion.

Primary references checked for review:
[sessions](https://developers.google.com/maps/documentation/tile/session_tokens),
[2D requests and viewport](https://developers.google.com/maps/documentation/tile/2d-tiles-overview),
[attribution](https://developers.google.com/maps/documentation/tile/policies).
Live account verification remains a separate requirement after these repairs.

### R20 — P1: wait for a mounted map's style before mutating it

`app/location/map-editing.ts:164` and `components/world-map/WorldMapSurface.tsx:93`
bind immediately in `onCreate`. `maplibre/host.ts:161` calls that hook immediately
after map construction, not after style load. The binding synchronously applies
the current provider descriptor and calls `addSource`. MapLibre loads even an
inline JSON style asynchronously and its `addSource` throws
`Style is not done loading.` before readiness. A ready street/keyless provider
can therefore break map initialization. Recording maps used by provider tests
do not model this real precondition.

Use the existing map lifetime/style readiness mechanism, apply the latest state
once ready, and cancel pending application on disposal. Verify delayed style
load through the mounted surface and one real rendered map.

### R21 — P1: finish shared provider ownership in actual map callers

`app/canvas-map-surface/workspace-map-controls.ts:303` still uses the static
contribution builder without the configured key or session provider. Thus the
main Canvas cannot follow the official provider path and can silently use the
keyless path while a key is configured.

Location/WorldMap providers capture the key once at creation, update only on
style changes, do not refresh viewport metadata on map movement, and are never
disposed by their map owners (only the binding subscription is removed).
There is no scheduled session renewal. Settings/key changes therefore do not
reach existing maps, and teardown leaves owned requests alive.

Use the same concrete provider owner on all required surfaces. Observe key/style/
locale changes, settled viewport movement, expiry and disposal; preserve the
existing Canvas visibility/provisional guards. Reconcile the basemap without
resetting camera, opacity or layer order, and avoid recreating its source merely
because copyright changed. Tests must actually change the key and destroy the
surface; the existing “key change” test repeats the same style with the same key.

### R22 — P2: enforce the provider body bound while reading

`maplibre/basemap-http.browser.ts:90–104` checks Content-Length, then calls
`response.text()` before checking size. A chunked or missing-length response is
fully buffered, so the stated 256 KiB bound is not enforced. String length also
is not byte length. Read incrementally to the byte cap and cancel the body on
excess, using the existing browser transport. Test a missing-length stream.

### R23 — P2: finish the Data import workflow in its owning surface

`DataPanel.tsx` starts `startImportForLayer`, but that only sets the tracked import
state. Progress/review/Apply live exclusively in `LayersPanel.tsx:21`; Data neither
renders them nor navigates there. The user must discover another panel to finish.
The primary “Import sources” action also only creates an empty dataset and stops.

Keep selection, preparation, progress, cancellation and completion reachable from
Data. The simplified import direction below should remove the obsolete review
step rather than add another copy of it. Test through the production surface,
including cancellation and failure without losing the user's interpretation.

### R24 — P2: expose undoable Remove from Design without deleting library data

`LidarLayersSection.tsx:413–443` offers library/result deletion but no Remove from
Design, including no remedy for unavailable references. The existing
`app/design-edit/lidar.ts:106` seam can remove presentation entries without
deleting assets. Wire that operation through the action layer and test document
Undo plus unchanged library contents. This is explicitly required by C2.

### R25 — P2: make Analysis failures and units observable

`AnalysisPanel.tsx` relies on rejection to set its local error, but
`app/lidar/actions.ts:274` swallows errors into `lidarStatusMessage`, which Analysis
does not render. A failed Run can therefore settle with no visible explanation.
Run also remains enabled until a library refresh reports Preparing, allowing
duplicate submissions during the initial request. Guard that request without
tying job ownership to panel lifetime, and expose its failure through one existing
error path. In Layers, every analysis row is labelled `slopeDegrees` even when
the result was computed in percent. Read the result's actual unit consistently.

### R26 — P1 acceptance gap: establish resource safety before broadening admission

The receipt explicitly leaves low-space/write-failure and queue bounds unverified,
and cold/three-warm display timing unmeasured. C1 conditioned production activation
on these gates; activation was premature. The “temporary 0” figure measures
scratch remaining **after settlement**, not the peak temporary footprint needed
to admit a conversion. It is cleanup evidence, not conversion-capacity evidence.

Retain the useful large-input and cancellation measurements. Add bounded fault
injection at real write/publication seams, proving old head/result preservation,
owned cleanup and successful retry; no special filesystem service is necessary.
Measure peak live scratch and simultaneous process/cache/queue scope through the
real import/display/analysis callers. The new import route below needs its own
resource evidence; the old route's numbers cannot qualify it automatically.

## Import direction requested after the original handoff

This is a **design amendment**, not a retroactive allegation that implementing
the old numeric limits violated the original assignment. The main agent owns
reconciling the earlier C1 contract before another implementation launch.

The desired interaction is: choose files, declare interpretation/units, prepare
and validate each source as a managed COG, register it, and display requested
windows. Import should not depend on rendering before/after previews or
re-evaluating all existing raster values. Keep the existing native GDAL/pinned
reader and ordered immutable source model; no GeoLibre server, Python runtime,
replacement engine or generic job framework is needed.

The candidate still generates previews in `import.rs:471–589`, and
`collection::measure` scans the complete composed coverage before publication.
It also scans source facts and regions separately during preparation. Hiding the
preview UI or deleting `admission.rs` constants does not remove these costs.

Required design outcomes for the next implementation contract:

- Remove arbitrary per-file, selected-byte and total-active-cell policy ceilings
  from the new streamed source route once all callers are bounded. Keep actual
  format/dimension/index representability checks, finite values, scientific
  interpretation/NoData rules, bounded workers/read buffers/caches, cancellation,
  and the necessary legacy dense allocation guard. Batch scheduling can be
  bounded without turning worker capacity into a raster-size rejection.
- Admit against disk requirements for retained originals, output COG/overviews,
  live conversion scratch, promotion copies and reserve. Support the required
  BigTIFF path. Free space is a necessary condition, not a guarantee that arbitrary
  input is valid or that writes cannot fail. Report unsupported input, insufficient
  space and cancellation concretely; preserve the old accepted head.
- Prepare each source independently and reuse validated assets. Publish ordered
  membership atomically with the existing head fence. Reorder/remove/Undo/Restore
  must not require a whole-composition numeric scan just to publish metadata.
- Separate derived exact composed statistics from source registration and display
  readiness. Audit current consumers before changing their contract. Source ranges
  or envelopes can support explicitly conservative display hints, but cannot be
  relabelled as exact composed min/max, covered area or scientific results.
  Required exact statistics need a cancellable bounded computation and explicit
  availability state; saved historical exact results stay readable.
- Admit slope and other existing computations against their own workload/storage
  budget. A source being stored and viewable does not promise that every analysis
  can run immediately over its full extent.

Verify an input above the retired byte/cell caps through the actual Data workflow,
bounded conversion/read memory, measured scratch, cancel/restart/failure, and
display after reopening. Also prove that adding one source or reordering existing
members does not decode the entire prior collection. Do not build a new benchmark
framework or optimize unrelated consumers to pursue an “unlimited” slogan.

## Review and workflow improvements

The self-review's detector lesson is useful, but five additional caller probes
still fail while existing tests pass. Apply that lesson to the actual contract:
a usable authenticated tile request, a changed key, a sampled physical cell,
a real head/Design transition and a mounted map's loading state. Increasing the
test count or repeating gates cannot substitute for those assertions.

Classify this round correctly: source-import simplification is a main-agent
design amendment; R15–R25 are implementation/coverage gaps; R26 is an acceptance
gate deviation. Record each repair's failing reproduction and passing result in
the existing receipt/debrief, replacing contradictory current claims while
preserving revision-labelled history. No extra productivity tracker or review
framework is warranted.

After repair, run affected regressions and the required combined candidate gates,
then the actual Desktop and Web workflows. Linux packaged smoke, live inspection,
real Google access and Windows/macOS evidence remain explicit pending checks.
Do not infer those observations from mock tests, or characterize the candidate as
waiting only for another host. Keep reclamation, per-occurrence naming and new
analysis types outside these corrections unless a demonstrated required flow
depends on them.
