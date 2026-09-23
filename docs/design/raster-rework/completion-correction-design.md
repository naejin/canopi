# Consolidated correction decisions after 26eca68a

Status: active — implementation-ready continuation approved on 2026-09-23; independent acceptance and integration pending.
Tracking: `canopi-j571.1` under `canopi-j571`; one candidate branch, no new completion epic.
Current guidance: [prompt](completion-agent-prompt.md), [completion contract](completion-design.md), [source-import amendment](source-import-design.md), [review R27–R43](completion-review-26eca68a.md), [protocol](collaboration-protocol.md).

The [578a4f1c review and fixed repairs](completion-review-578a4f1c.md) refine
R44–R51. Its seam-specific decisions and the sole prompt's execution order take
precedence over the earlier sequence here. R27–R43 and remaining C0–C5 stay in
scope; no prior report establishes acceptance.

## Mandate, authority and preservation

Make the existing candidate work through the accepted user workflows, repair the
review's invariant families, and complete all available required evidence before
one consolidated return. The user approved repair → independent acceptance →
integration into the normal development checkout. This assignment authorizes the
first step only; implementation delivery must not update the user's primary code
checkout or declare integration. The primary documentation checkout lacks candidate Data and
Analysis; they exist on candidate `578a4f1c`. That difference is not a sidebar bug.

Continue `feature/raster-rework-completion` in `.rq-scratch/wt-candidate` from
`578a4f1c` or its verified successor. Preserve accepted foundation `34e4ded4` and
main integration `f61f8494`, v18 migration, the source-only publication route,
exact/display metadata split, original and history compatibility, existing real
fixtures and all meaningful regressions. Merge this committed docs handoff with
merge history preserved. Prefer the new current disposition while retaining the
candidate's revision-labelled measurements. Inspect status first; primary
`.beads/issues.jsonl`, `desktop/src/native_operation.rs` and `.beads.gate.lock`
are user-owned. Do not stash, overwrite, stage or export over them.

This document clarifies repair ownership and acceptance after the new review.
It supplements C0–C5 and the source-import amendment; it does not reinstate old
ceilings, relax scientific/compatibility guarantees or create a new feature set.
The review is evidence, the receipt is evidence, and neither can amend a contract
by saying code is done. If a genuine conflict remains, return its counterexample
and recommended smallest resolution while continuing unaffected work.

No new engine, raster codec, precision policy, generic scheduler, broad error
framework, browser raster processing, reclamation or unrelated optimization.
No subagents, shared-skill changes or model-routing automation. Task-local tests,
small script fixes and guide corrections are authorized under the protocol.

## Reuse and responsibility

| Owner | Keep | Repair inside this owner |
| --- | --- | --- |
| Native import/storage: `import.rs`, `admission.rs`, `paths.rs`, `raster_assets.rs`, `prepared_raster.rs`, `engine.rs` | Heavy-job lease, promotion journal, capacity observation seam, bounded native reader/process cleanup | Cancellable copy/hash; operation-specific conversion lifetime; checked live storage and bounded metadata; retire source policy ceilings only when safe |
| Native composition/analysis: `collection.rs`, `generation.rs`, `analysis.rs`, `mod.rs` | Ordered composition, chunk readers, expected-head publication, previous-result preservation | Release catalogue locks before external work; slope estimate over actual work; retain current-head scheduling and same-definition retry |
| Frontend library and Design coordination: `app/lidar/`, Desktop lifecycle | Library signals/IPC, Design Edit, document session identity | Library-lived job polling and exactly-once session-fenced attachment; a small higher workflow may coordinate these existing owners |
| Inspection: `app/lidar/inspection.ts`, canvas lifecycle, native `inspection.rs` | Physical WGS84 point, signed reads, correct units, read tickets | Reactive invalidation of displayed and pending answers; cancellation before replacement; native completion fence |
| Maps: existing per-map provider, binding, transport and host lifetimes | Map instance, camera, layers, fixed endpoint authentication, bounded HTTP | Reactive configuration identity, current viewport identity, readiness/recovery and selective contribution updates |

The extra code is justified only by a reachable missing behavior in these owners.
Private helper names, local factoring, test organization and bounded algorithms
are delegated. Do not introduce a second authoritative job, map or Design store.

## A — finish the import and inspection lifecycle first

**Prerequisite:** retained candidate, reproduced small R32–R35 cases. This is the
first executable repair slice: it makes the product demonstrable while native
capacity work remains guarded. Use current small real fixtures, not large runs.

The Desktop application/workspace lifetime installs one LiDAR workflow owner;
Data/Analysis/Layers subscribe to it rather than individually stopping a shared
timer. It polls while tracked imports or analyses need settlement, survives panel
navigation and Design replacement, stops idle polling and disposes on Desktop
teardown/HMR. Reuse the existing polling functions, with awaited/deduplicated
refresh so a terminal job and its library head are observed consistently. Reopen
refreshes immediately. Native jobs remain library-owned even after UI shutdown;
existing restart recovery remains authoritative, not a new persistent frontend job store.

Capture Design identity before the first asynchronous import action. Track the
job's attachment intent in this lifetime owner once submission succeeds. On
committed success, refresh the library and attach once through Design Edit only
if that exact Design session is still active. Consume the intent on settlement;
do not reset an already-present entry's order, visibility or opacity. Failure,
cancellation or switching away and back to another session must not attach.
Closing Data does not lose intent; manual Add to Design remains available. New
dataset creation followed by submission failure leaves an honest empty/retryable
dataset. Preserve interpretation for retry; a failed initial submission must not
leave the UI permanently disabled or duplicate datasets via an unguarded click.
Do not import actions into another action/controller; a higher workflow may
coordinate library observations and the existing Design Edit seam.

Inspection's existing canvas/workspace owner installs one disposable observer
of Design identity, entity presence/visibility and displayed generation. A head
change cancels the pending lookup and marks any old value/NoData answer stale;
the target may stay armed for a fresh sample. Hide/remove, Design replacement,
Location navigation and teardown end inspection and release its gesture. Cancel
before `beginInspection` overwrites the old session, including same-target re-entry.
Every early invalid-point/missing-generation path must also prevent an older
pending answer from becoming current. Native lookup rechecks the head after the
read without holding the catalogue during transform/reading. Request IDs remain
scoped to the owning runtime, and all terminal paths release read admission.

**Exit evidence:** mounted Data close/reopen during import and analysis, terminal
success/failure/cancel and repeat submission; completion in same versus replaced
Design; no duplicate presentation mutation. Inspection tests cover head change
both before and after an answer, re-aim, document Undo hiding/removing a target,
replacement and teardown through actual owners. A small real Data → display →
slope → inspection → save/reopen attempt runs now. If GUI driving is unavailable,
record the failed input-layer observation once and continue the code-level work.

## B — repair provider lifecycle through every mounted caller

**Prerequisite:** existing provider/binding/readiness tests retained. R36–R42
require state transitions, not additional mock-only initialization assertions.

Each map lifetime owns reactive style, effective key and current application
locale inputs. Update an already mounted provider when they change; a getter
without an observer is insufficient. A configuration identity change aborts old
requests, clears incompatible credentials/viewport facts and renewal timers,
and acquires the appropriate session before using it. Key clearing follows the
accepted keyless path; configured-key rejection never falls back. Hidden or
provisional Canvas does no provider work and resumes using current inputs.

Keep one active viewport request and one latest desired viewport, not a queue per
movement. A newer viewport supersedes the older request/result: cancellation is
preferred, or finish it without publishing and immediately request the latest.
Same settled viewport need not refetch. Fence responses by map lifetime,
configuration/session and viewport identity. Renewal preserves the latest desired
viewport; expiry, config replacement and disposal cannot revive old credentials.

Ready requires both a usable unexpired session and validated metadata for the
current viewport. While either is pending, withhold the official contribution;
keep the map/camera and owned tile-source object where its configuration permits,
using visibility to prevent falsely attributed imagery. An actual invalidation
clears the transport credential. Metadata errors are actionable Unavailable;
the next distinct settled viewport or an explicit retry of the selected provider
may recover through the same bounded request policy. Expose retry where the
failure is shown; authentication failures require key correction. No endless
timer retry. On recovery reinstall credentials and renewal before Ready.

Compute availability afresh against the base descriptor, never the prior clamped
zoom. Validate copyright and finite applicable availability; do not accept `{}`
as established metadata. For a single-source zoom ceiling require support across the requested viewport,
respecting wrapped longitudes. Overlapping rectangles offer the greatest supported
zoom at a point; the source-wide ceiling cannot exceed the least such availability
across the viewport. Uncovered/unsupported metadata is unavailable, not an invented
zoom. The [official response examples](https://developers.google.com/maps/documentation/tile/2d-tiles-overview)
include overlapping rectangles; taking the minimum of every intersecting rectangle
would incorrectly let a broad low-zoom rectangle suppress a finer supported one.
Use the actual installed MapLibre tile overzoom behavior to avoid requesting above
the accepted ceiling. Verify response semantics against the official references
linked in C4; no live-account success is inferred from scripted responses.

Binding compares tile configuration (provider/template, tile size, zoom limits)
separately from attribution and visibility. Identical publications are no-ops;
copyright-only changes update attribution without removing the tile source.
Installed MapLibre exposes `AttributionControl` and map add/remove-control APIs;
replacing only a map-owned attribution control is an allowed small adapter if
there is no supported dynamic attribution setter. Preserve attribution from other
sources, compact behavior and safe rendering. Do not call private MapLibre fields
or fabricate events to force an update. Rebuild a source only when its actual tile
configuration requires it, preserving layer order, opacity and overlays. Disposal
releases the control, settings subscriptions, requests and timers with the map.

Settings feedback may simply derive availability during render or read signals
inside the computed callback; keep one settings authority. Its visible prompt,
error and attribution must change with a key/style update, not just the signal.

**Exit evidence:** all ten review diagnostic failures have ordinary regressions
(including A's lifecycle failures); mounted Canvas/Location/WorldMap change actual
settings after a session is ready, clear key, change locale, pan during metadata,
fail/recover, increase/decrease availability, renew and dispose. Assert outgoing
tile authentication and absence of fake credentials from persisted/logged state
separately. Unchanged/copyright-only publications retain source identity and loaded
state. Repeat available real Desktop/Web startup and placement/provider flows;
restricted-key evidence stays separate.

## C — complete bounded native source and analysis admission

**Prerequisite:** small publication and failure paths still pass. Follow the
[source-import amendment](source-import-design.md) for all budgets, compatibility,
disk reserve, BigTIFF and large-fixture outcomes; it remains the authority.

R28: pass the job's real cancellation flag through original copy, dedup verification,
COG hashing and metadata iteration. Check between bounded chunks and before
durable promotion; never delete a reused asset. OS read/write/fsync stalls are not
made interruptible by an atomic flag: state that limit explicitly, do not promise
unobserved universal five-second I/O settlement. Fixture-controlled copy/hash and
process cancellation must satisfy the existing five-second bound. Do not create
a general I/O worker service to disguise an uninterruptible syscall.

R29: scope catalogue guards to facts/transactions and release before bounds
transforms, executor/lease waits or raster work. A focused blocked-transform test
must permit another catalogue read; it needs no timing benchmark framework.

R30: give only the controlled source-conversion call an explicit cancellable
no-elapsed-deadline mode. Other GDAL calls retain finite deadlines and all calls
retain bounded output, process reaping and shutdown behavior. A controllable test
child/clock can prove the timeout exception without a ten-minute test sleep.

R27: bound growing source regions, members, reader/index metadata and publication
enumeration before lifting source byte/count/processing caps. Reuse catalogue
pages/job-local spooling, sequential preparation and existing read admission;
do not collect all raster blocks/occurrences into RAM under an unlimited-input
promise. Real checked format/index/addressability and reader-memory limits are
valid named refusals. Keep dense allocation guards only where dense allocation
actually happens. No environment or test-only bypass may qualify production.

Preflight original/sidecar retention before copying and the actual simultaneous
conversion/output/scratch/promotion obligations before their allocations, retaining
the shared reserve and rechecks. Use conservative uncompressed checked estimates
for the chosen GDAL profile, not assumed compression. Own GDAL temporary output
under job scratch. Preserve the existing supported NoData/mask/layout rules;
sidecar preservation does not authorize new sidecar scientific semantics. Ensure
controlled BigTIFF output and a real beyond-4-GiB read are supported by the pinned
reader. The active profile's absence of overviews must be reflected honestly in
both the estimate and measured display behavior.

R31: slope's sparse estimate covers the actual occupied work and live reader/chunk
metadata, core/halo buffers, staged result/quality bytes and reserve; use checked
arithmetic, bound or spool growth, and recheck real writes. Do not derive admission
from the first member's lattice width/height or exact composed coverage, which may
be unknown. Keep last valid result on refusal/failure and mark it previous/stale;
metadata source edits remain successful even when dependent analysis cannot fit.
Retain coalesced latest-head refresh and the C2 same-definition Retry contract.

**Exit evidence:** cancellable copy/hash/metadata/process paths and healthy controls;
small low-space refusal, mid-write/publication failure and retry through the real
owner; old head/result unchanged and owned scratch settled. Reuse `paths::capacity_probe`
for free-space observations and existing promotion fault seams. If a missing seam
prevents a decisive write-failure test, add a narrow test-only failpoint around the
real write, not a production filesystem abstraction. GDAL deleting its own partial
output is a valid cleanup outcome, not a reason to skip preservation/retry checks.

Then exercise >24 files, >2-GiB input/selection, cumulative work >400M cells and
the real beyond-4-GiB offset without admission overrides, plus existing MNH/MNT
and plane controls. Preflight fixture generation and keep private originals
read-only. If disk/fixtures genuinely prevent a lane, finish the rest and mark
that gate unavailable; do not call the amendment complete.

## D — evidence, final review and delivery

R43: sample live job/GDAL scratch while work runs, separately report durable bytes
and post-settlement residue, and name locations, cadence, missed samples and
scope. Zero after cleanup is never peak zero. Sample app plus simultaneous children
and caches during concurrent heavy work and display/inspection. Drive the existing
read queue's active/queued/refusal boundary and cancel queued/active reads through
real callers. Keep cold plus three warm renders and no-prior-pixel-read evidence;
a narrow read counter at the publication boundary is sufficient instrumentation.
Dependent slope may legitimately read after commit and must not be disabled to
improve the claim. No standalone benchmark service is needed.

Audit the complete C0–C5 contract once from the final callers, beyond the named
review examples: especially Analysis Retry, native inspection completion currency,
legacy libraries, saved Design round-trip, provider errors and live workflows.
Repair in-scope findings and rerun affected focused checks. Run C5 combined gates
on the final candidate after updating onto main with merge history preserved.
Use current guide commands; fixture variables must name real existing inputs.
Passing prose-only commits may inherit unchanged code evidence, but identify the
actual code/gate revision and rerun docs validation.

Finish the [receipt](completion-receipt.md#current-correction-acceptance) and
[debrief](review-and-debrief.md#final-correction-debrief-to-deliver), reconcile guides,
update/export intended bead records without touching user-owned exports, commit,
push both configured destinations and verify identical remote tips. Mark delivery
partial if required evidence is unavailable. Leave independent acceptance,
primary-checkout integration, release and branch cleanup to their owners.

If GUI automation fails, diagnose the failing input layer once using the existing
isolated recipe. Use installed tooling or small reversible driver corrections;
no new browser runtime dependency solely to avoid admitting an evidence gap.
Complete other work and provide exact remaining manual steps/expected observations
in the receipt. A missing key/runner blocks that proof only. Routine test failures,
context exhaustion, private helper choices and completion of a slice are not
reasons to request a continuation prompt.
