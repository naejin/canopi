# Independent review and repair decisions at 9208c930

Status: evidence — original R44–R51 obligations; current repairs are refined by the review at `578a4f1c`.
Tracking: `canopi-j571.1` under `canopi-j571`; continue the existing candidate.
Current guidance: [latest review](completion-review-578a4f1c.md), [sole prompt](completion-agent-prompt.md), [completion contract](completion-design.md), [earlier correction decisions](completion-correction-design.md), [source-import amendment](source-import-design.md), [receipt](completion-receipt.md).

## Evidence and scope

Reviewed candidate `9208c930`, code changes `96e4828d`, `837e67a0`, `77de3367`.
An isolated archive ran four added diagnostic assertions: all four failed, while
16 existing tests passed. No full native/frontend gate rerun or live provider
qualification was performed by the reviewer. Candidate and primary files were
unchanged. Temporary probes are not deliverable dependencies; reconstruct them
from the cases below as committed ordinary regressions.

R44–R51 continue the existing finding numbers. All are P2. R50/R51 are outstanding
accepted obligations, not regressions introduced by this batch. The code shows
useful repairs in cancellation loops, catalogue lock scope, polling ownership,
inspection invalidation and provider configuration; that does not establish their
complete caller-level acceptance. This addendum settles the specific seams below;
otherwise the earlier correction design and C0–C5 remain in force.

## Findings and fixed repair decisions

Paths below are relative to the repository. Line references describe `9208c930`.

### R44 — cancellation requests cannot decide import attachment

`desktop/web/src/app/lidar/actions.ts:154` deletes attachment intent after the
cancel command returns, even when native publication already won. Native
`cancel_job` leaves a completed job complete. Reproduced: tracked Staging →
request cancellation → observe Complete; no attachment occurs.

Keep `workflow.ts` as the sole settlement/attachment owner. Capture the originating
Design identity before the first asynchronous submission step. Actions submit jobs
or request cancellation; they must not discard intent merely because cancellation
was requested. The observed terminal result decides: Complete refreshes the
library and attaches once in the same Design session; Failed/Cancelled consume
without attachment. Preserve an existing entry's visibility, opacity and order.
A replaced Design never receives the attachment. Refresh coordination must await
real settlement reads, not return early merely because another refresh is running;
ensure a post-commit refresh occurs before concluding polling is idle.

Keep leaf actions free of imports from the higher workflow. The workflow may
coordinate leaf operations and Design Edit; put the small intent/state seam in
the existing library state owner if needed. Do not introduce another job registry
or scheduler. Update callers together. Check late-cancel success, genuine cancel,
repeated terminal observation, overlapping refresh, panel closure and Design swap.

### R45 — implement attribution in the production map adapter

`desktop/web/src/maplibre/basemap-contribution.ts:159` invokes optional
`replaceBasemapAttribution`, but no production target implements it. Copyright-only
updates therefore retain stale attribution. The tests' optional hook is insufficient.

Provide the required capability through the concrete adapter used by Canvas,
Location and World Map. Reuse public MapLibre control APIs and existing control
ownership. If replacing an owned attribution control, exclude stale basemap credit
from its source representation and supply current credit while retaining all other
source credits, compact behavior and safe rendering. No private field mutation or
synthetic MapLibre events. The map lifetime owns setup/update/disposal; replacing
copyright must retain the tile source, loaded tiles, camera, layer order and opacity.
A required behavior must not silently disappear behind an optional method.

Test the actual adapter/control construction and all owner wiring, not only a fake
method on a reconciler target. With unchanged tile configuration, publish credit A
then B: visible credit is B, A disappears, other source credits remain, source
identity is unchanged, teardown releases the owned control. Retain identical-state
and actual tile-configuration-change controls.

### R46 — compute effective visibility once

`desktop/web/src/maplibre/basemap-bind.ts:95` immediately makes the contribution
visible after the reconciler hid it for Loading. Reproduced through the binding.

Effective visibility is user visibility AND provider renderability. Apply that
rule consistently at publication, delayed style readiness and visibility-only
updates. Loading official metadata must not expose cached imagery; Ready requires
current session and metadata. Preserve the existing source while hidden when its
configuration permits. Withholding imagery must not replace the map.

Check Ready → Loading → Ready, failure, user hide/show during loading and delayed
style load through `bindBasemapProvider`; assert the final map layout property,
not just an intermediate hide call. Retain the existing hidden/provisional Canvas
no-network contract. Explicit provider retry where errors are shown remains an
outstanding earlier-design obligation; test it through its real UI caller.

### R47 — establish coverage over the full viewport

`desktop/web/src/maplibre/basemap-provider-session.ts:726` samples four corners
and the centre. It misses gaps and low-zoom regions between those points. Its
arithmetic longitude midpoint also mishandles wrapped viewports. Both reproduced:

- Viewport west/east 0/10, south/north 0/10; rectangles covering longitude 0–1,
  4–6 and 9–10 across the full latitude range, each zoom 18: currently accepted,
  must be unavailable because of uncovered strips.
- Viewport west/east 175/-175, south/north 1/9; rectangle west/east 170/-170,
  south/north 0/10 at zoom 18: currently rejected, must be supported at 18.

Use exact rectangle coverage for the small bounded metadata response. Normalize
wrapped viewport/rectangles into ordinary longitude intervals, clip to the viewport,
and partition at rectangle boundaries. Every positive-area partition needs support;
its supported zoom is the maximum of covering rectangles, and the source ceiling is
the minimum across partitions, capped by the base descriptor. Validate finite
ordered latitude/zoom inputs. Do not invent a geometry dependency or approximate
sampling fallback. Choose a bounded sweep/partition implementation locally; reject
unsupported/malformed metadata within the existing provider error policy rather
than permit unbounded work. Test uncovered strips, an interior lower ceiling,
overlap with a broad low-zoom rectangle, wrapped coverage, and zoom recovery.

### R48 — sparse slope needs actual resource admission

`desktop/src/services/lidar/analysis.rs:728` removes the dense guard before the
sparse branch, but `publish_sparse_slope` proceeds to occupied blocks and writes
without the promised checked workload/storage estimate. The comment and receipt
are stronger than the implementation.

Retain sparse execution. Before output work, estimate occupied core blocks plus
halos, bounded working buffers, result/quality assets, scratch overlap and metadata
using checked arithmetic and the existing resource observation seam. Use the
source-import amendment's budgets/reserve, not new arbitrary input ceilings or
the first source's lattice envelope. Recheck storage as appropriate while outputs
accumulate; cancellation/failure preserves the previous result and source head and
removes only job-owned staging. No schema migration or general resource framework.

Prove widely separated small members admit despite a large envelope; occupied
work beyond available storage is refused before output; arithmetic overflow is
refused; real mid-write failure preserves published state; successful retry works.
Use production callers and existing capacity/failure seams. A generic sparse-slope
suite total is not evidence that admission ran.

### R49 — keep timeout exceptions operation-specific

`desktop/src/services/lidar/raster_assets.rs:115` calls unlimited conversion from
`write_cog_asset`, also used for bounded result/quality chunks. A stalled chunk can
occupy the heavy-job slot until explicitly cancelled.

Only whole-source controlled conversion receives the no-elapsed-ceiling exception.
Bounded chunk conversion and other GDAL operations retain finite timeouts. Keep
process kill/reap and real cancellation on both routes. Narrow the engine entry
point so ordinary bounded writers cannot accidentally select the source exception;
no generic policy engine. Test routing plus actual cancellation/timeout cleanup
with an existing controllable subprocess/test clock seam, without a 600-second test.

### R50 — Analysis Retry keeps the definition identity

`desktop/web/src/components/panels/lidar/AnalysisPanel.tsx:197` labels a fresh
`analyseLayerAsSlope` / `lidarCreateAnalysis` call Retry. It accumulates definitions.
Implement the previously accepted retry command/seam: definition ID + expected
source head, existing parameters/name, new job receipt for the same definition.
Reject a changed head before work; preserve previous published result on failure
and publish atomically only while the expected head is current. Reuse heavy-job
admission and command registration/executor policy. Regenerate shared bindings.

The UI retries the selected failed definition, rather than guessing from any failed
result on the layer. Creating a different analysis remains an explicit create
operation. Retry a failed definition twice: definition count/ID and presentation
reference stay stable, job identities change, and previous valid results survive a
failed attempt. Test changed-head refusal, cancellation and success through the UI,
IPC and native service boundaries. This is existing scope, not permission to add a
new analysis editor.

### R51 — check native inspection currency after reading

`desktop/src/services/lidar/inspection.rs:316` checks expected generation before
transform/read, then returns without re-resolving. A concurrent head change makes
Value or NoData stale before delivery.

Resolve/read without holding the catalogue across slow work, then reacquire briefly
and recheck target identity/current generation before returning any successful
Value or NoData outcome. Changed head returns StaleGeneration; disappeared target
returns the existing missing/unavailable outcome. Keep frontend lifetime fencing
as additional protection. Tests gate an in-flight real service read, publish or
remove the target, release the read and assert no stale success; retain unchanged
head and NoData controls. Release read admission on every exit.

## Delivery acceptance

Execute lifecycle R44/R50/R51, provider R45–R47, native R48/R49 and the still-open
R27/R43 capacity/fault evidence in cohesive commits. Dependencies may move earlier.
Each slice exits when the named production-boundary regressions and healthy
controls pass; continue automatically to the next slice. Retain C0–C5 and previous
regressions. No generic state-machine framework, new engine/dependency, broad file
reorganization or unrelated cleanup is required.

Run the applicable repository gates on the combined final tree, including full
frontend tests, tsc, gallery and both edition builds, binding verification, Rust
fmt/strict clippy/check/workspace tests/native policy, docs validation and required
fixture lanes. Record exact unavailable commands and actual missing prerequisites;
local queue, scratch and fault tests are work to perform, not external by default.
Earlier `b4ab8fe6` gates do not validate these code changes. Continue all independent
work around genuine external gaps. Only independent review can accept the result.
