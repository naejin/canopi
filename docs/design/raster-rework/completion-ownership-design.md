# Raster completion: cohesive lifecycle ownership

Status: active — user-approved architectural correction against candidate `291d0773`; implementation and independent acceptance pending.
Tracking: `canopi-j571.1` under `canopi-j571`; continue `feature/raster-rework-completion`.
Current guidance: [sole execution prompt](completion-agent-prompt.md), [C0–C5 scope](completion-design.md), [source-import amendment](source-import-design.md), [receipt](completion-receipt.md), [debrief](review-and-debrief.md#ownership-correction-and-next-use-evidence).

## Mandate and precedence

Finish the existing product contract with two cohesive owners: map basemap lifecycle
and import result settlement. This addendum supersedes conflicting assembly and
sequencing prescriptions in earlier repair reviews. It does not supersede C0–C5,
scientific/compatibility requirements, R27 admission evidence or R43 measurements.
Prior repairs and passing gates are retained evidence, not whole-feature acceptance.
The architecture owner accepts responsibility for previously underspecified ownership;
implementation must not have to reconstruct these decisions from chat.

No database migration, native IPC/schema change, new dependency, universal map engine,
event bus, job framework, new raster engine or document-authority change is authorized.
Retain SceneStore, Design Edit, the workspace camera, numeric/display separation,
immutable history, Float32/NoData and native cancellation/resource limits. SQLite
remains native persistence; DuckDB-WASM remains the Web catalog query capability.

## Necessity and reuse

| Existing owner/reference | Decision and reason | Maintenance boundary |
| --- | --- | --- |
| `desktop/web/src/maplibre/basemap-bind.ts`, provider session, existing map hosts and `app/canvas-map-surface/workspace-runtime-composition.ts` | Adapt: helpers exist, but callers still assemble initialization, observation, binding and credits independently | One per-map basemap mount operation, implemented within existing map modules; existing surface owns its disposer |
| `desktop/web/src/app/lidar/{library-store,workflow}.ts`, `app/design-edit/lidar.ts` | Adapt: separate passive/fresh queues and promise error handling do not enforce settlement freshness | Store owns ordered snapshot reads; Desktop workflow owns intent settlement; Design Edit remains the only attachment write boundary |
| GeoLibre `bb18f8abaf89211aef68a7b6aed8460cec033f4c`, `packages/map/src/{MapCanvas.tsx,map-controller.ts}` | Adapt the initialize/update/dispose and desired-state reconciliation pattern, not code or framework | No React/Zustand dependency, whole-style replacement or multi-engine interface |
| Same GeoLibre revision, `packages/processing/src/runner.ts` | Retain the explicit operation/result-boundary lesson | Its result sink is not a substitute for Canopi durable native publication and generation checks |

The existing code is sufficient unless a concrete caller-level experiment disproves
that assumption. Internal function names, small private helpers and test gates are
delegated; the owner boundaries and outcomes below are fixed. No source copying is
needed. If proposing copying, first resolve licensing and dependencies separately.

## M — one basemap lifecycle per map

Expose one mount operation in the existing map integration. It takes the existing
map/readiness/configuration/visibility/viewport capabilities and returns teardown.
The owner creates the provider and its observers/binding, initializes from current
configuration immediately, applies later configuration and viewport changes, and
cleans up subscriptions, pending callbacks, requests, credentials and owned controls.
Where request transformation must exist before map construction, the map host creates
that credential capability and supplies it; do not install a second transform or
recreate the map. Document that construction ordering inside the mount seam.

Canvas, Location and WorldMap must all use this operation. Remove their redundant
provider initialization/observer/control wiring as they migrate. Keep map lifetime,
camera, scene, placement and layer ordering with their existing owners. Provider
replacement changes raster contributions, never the whole map style or scene.
A partially failed mount cleans up its acquired resources and surfaces failure via
the existing host path. Late callbacks after teardown or replacement cannot apply.

Use current provider state as the coherent input for contribution, effective
visibility and credit. Effective visibility remains user visibility AND Ready;
Loading/unavailable hides cached imagery and withdraws provider credit. A style-ready
callback applies the latest state, not an earlier captured state. Repeated identical
state must not rebuild sources or controls. Attribution changes preserve source and
camera identity. Preserve other sources' credits exactly once.

Use one map-owned attribution control for production maps: explicitly suppress any
automatic duplicate and let the owner combine source credits with current custom
provider credit through supported MapLibre APIs. Keep an existing control when its
credit is unchanged; never create an extra empty control on withdrawal. Retain a
source-carried fallback for targets without the adapter. Tests must model the actual
production capability; a missing mock export must not silently disable the behavior
that the test claims to verify. Inspect the installed MapLibre API before adapting it.

| Case | Observable acceptance |
| --- | --- |
| Mount each surface with existing keyless configuration and no movement/settings event | Initial basemap becomes renderable after style readiness; provider does not remain idle |
| Change style/key/locale while a request or style load is pending | Only current generation applies; scene/camera/placement survive |
| Ready → Loading → Ready; user hidden and visible variants | Visibility and current credit agree with the accepted state throughout |
| Identical state, copyright-only change, withdrawal, remount | No needless control churn, no duplicate other-source credit, no leaked callbacks/control |
| Coverage at zoom 0 and equivalent longitude views `-10..10`, `350..370`, `710..730` | Same supported coverage for equivalent world copies; preserve wrapped/gappy/interior-ceiling cases and the 64-rectangle bound |
| Nonfinite or malformed coordinates | Bounded rejection; no iterative normalization hang or invented coverage |

Longitude handling must normalize equivalent finite world copies with bounded
arithmetic; preserve viewport span and full-world semantics. Do not relax latitude,
rectangle count, numeric precision or provider zoom validation to admit invalid input.

## L — one ordered read boundary and one settlement owner

The library store owns a single ordering mechanism for all library snapshot reads.
Passive reads may coalesce. Settlement requests a read whose start is strictly after
its terminal observation; it must not join a read already started at that point.
A queued read may serve multiple callers only if it starts after all their fences.
Return the successful snapshot to the caller, rather than asking it to reinterpret a
mutable global signal after awaiting a void promise. Publish snapshots in read order;
an older passive response cannot overwrite newer state. No second library authority.
An internal sequence/barrier is sufficient; no wall-clock freshness heuristic.

The Desktop workflow owns pending intents and one settlement attempt per job at a
time. It uses the returned snapshot and the existing Design Edit attachment seam.
Cancellation request is not terminal outcome: observed Complete still settles success.
Failed/Cancelled consumes without attachment. Complete plus a successful post-fence
read attaches once only in the originating live document session. Preserve order,
visibility and opacity of an already attached entry. A successful fresh read proving
the target absent consumes the intent and reports that specific outcome.

A failed read retains intent and reports the read error; it must not fall through to
success or missing-target handling. The existing polling/refresh lifecycle retries
pending settlement even when job state remains Complete; no tight loop or new timer.
Session replacement or workflow disposal fences outstanding completions so they
cannot mutate another document; obsolete intents are discarded. Library jobs may
continue independently of panels and document lifetime.

| Case | Observable acceptance through real store + workflow |
| --- | --- |
| Passive read starts, Complete observed, old read resolves | No attachment until a subsequent read starts and successfully resolves |
| Settlement read A starts, another completion B is observed | B waits for a read started after B's observation; A's result is insufficient |
| Passive and settlement requests overlap | Published snapshot never regresses to an earlier response |
| Required fresh read rejects, subsequent poll succeeds with unchanged Complete state | Intent survives failure, read error is visible, exactly one later attachment |
| Fresh success omits target | No attachment, intent consumed, missing-target feedback rather than read-error feedback |
| Late cancellation request followed by Complete, repeated terminal observation, document replacement/disposal | Correct terminal outcome, at most one write, no cross-session write or late disposed write |

## Remaining obligations and TDD sequence

Use the repository TDD skill: one observable behavior, RED immediately, minimal
coherent GREEN, then refactor while green. Do not write all tests and implementation
in separate batches. Expectations come from the cases above and existing contracts.
For each material changed invariant, record test name/command, baseline revision,
intended failing assertion, repair revision and green result in the existing receipt.
If a test already passes, record that honestly; strengthen an insensitive detector or
retain existing behavior rather than manufacture a change. No red evidence may be
inferred retrospectively from the final green suite.

Start M with no-event initial mount through a production surface, then migrate all
three callers and exercise replacement/disposal. Start L with rejected post-Complete
read and recovery through the real store/workflow, then exercise freshness ordering.
Mock transport/map/process/filesystem boundaries only where needed; do not mock the
owner whose coordination is being asserted. Use deterministic deferred promises and
existing small fault hooks rather than sleeps, timing luck or a new test framework.

Then finish the existing obligations: R50 must show each failed result's stored name
and retry its own definition through UI/IPC/native boundaries with two distinguishable
failures; Create continues to use the form. R48 needs mid-write capacity/write failure,
old-publication preservation, cleanup and successful retry. R51 needs a gated native
in-flight head change for Value and early NoData, with a healthy control. R49 tests
must not assume an unguarded Unix `sleep` on Windows: use a portable fixture process
or explicitly platform-scope the test and report unverified platform behavior.

Complete discoverable R27/R43 evidence using existing fixtures/tools and run C0–C5.
Unset variables alone are not an external blocker. Keep ceilings until required lift
evidence exists; synthetic evidence does not stand in for real-fixture accuracy.
Unavailable keys, hosts or real inputs block their lanes only. Do not classify local
fault injection or caller integration as external work merely because it is unwritten.

## Exit and escalation

Each slice exits after focused regressions and caller behavior pass, then work
continues automatically. Run the final C5 gates on the combined code and required
post-rebase tree; docs-only receipt updates need only the docs gate. No arbitrary
iteration quota, new harness or exhaustive-input campaign is required.

Escalate a demonstrated conflict with these owner boundaries, scientific behavior,
persistence, dependencies or consequential scope. Supply the smallest counterexample,
alternatives and recommendation; continue unaffected work. Routine failing tests and
internal sequencing choices are delegated. Optional new capabilities go to bd.

Deliver one candidate, [receipt](completion-receipt.md#current-correction-acceptance)
and [debrief](review-and-debrief.md#ownership-correction-and-next-use-evidence).
Independent acceptance belongs to the main reviewer; integration/release remain
separate. Leave the bead open while mandatory code or proof obligations remain.
