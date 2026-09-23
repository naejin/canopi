# Final ownership repairs and remaining proof

Status: evidence — reviewed at `de336a7d`: F1 repaired, F2 refined by a teardown regression, R50 proof incomplete; use the current prompt.
Tracking: `canopi-j571.1`; existing `feature/raster-rework-completion`.
Current guidance: [sole prompt](completion-agent-prompt.md), [ownership contract](completion-ownership-design.md), [C0–C5](completion-design.md), [receipt](completion-receipt.md), [debrief](review-and-debrief.md).

Current repair guidance: [teardown and retry boundary proof](completion-review-de336a7d.md).
The fixed invariants below remain; the prior execution sequence is superseded.

## Evidence and scope

Independent review reran the supplied frontend acceptance packet: **81/81 pass**.
Both native acceptance proofs passed. Full frontend 2830/288 and the other C5 gates
are implementer-reported at this revision, not independently rerun. All five supplied
frontend failures were repaired without weakened assertions. Retain those repairs
and the scoped R48/R51 proofs; neither native obligation needs to be reinvented.

Two ownership defects remain. The restart defect has an executable failing probe;
cleanup retention is source-confirmed and still needs its failing detector. These
are refinements of existing lifecycle requirements, not a new architecture project.
The reviewer owns the earlier packet's omission of both boundaries. Implementation
and test gaps also apply; do not infer cause from agent identity.

## F1 — Settlement belongs to an installation and attempt

In `desktop/web/src/app/lidar/workflow.ts`, `attemptInstalled` reads the mutable
`installed` boolean. Dispose followed by install makes an old callback eligible
again. The review probe observed obsolete read failure replacing current status.

Each installation must have a distinct identity. An attempt may consume an intent,
attach, publish workflow status or release its per-job guard only while it still
owns those effects. Invalidate identity on teardown; a new install cannot revive it.
Fence success, error and finally. A retired attempt must not remove a replacement
attempt's guard for the same job. Preserve read-start fencing, ordered library
publication, recovery on polling, one attempt per job and Design identity checks.
Use a local token/generation and attempt ownership as needed; no new task framework.

Add these cases to the real-store/workflow acceptance suite, using deferred promises
and fake timers rather than sleeps:

| Starting state / event | Required observation |
| --- | --- |
| Old read pending; dispose, reinstall, then reject old read | New status unchanged; healthy new settlement still works |
| Old read pending; reinstall and start replacement for same job; resolve old read | Old success cannot consume new intent or attach; replacement does attach exactly once |
| Old attempt finishes while replacement for same job is pending; repeat Complete/poll tick | Old finally cannot release replacement guard; no third settlement read |
| Disposal without restart; failure then recovery in current installation | Existing passing disposal/retry controls remain green |

The first probe is reproducible by adding this test to
`desktop/web/src/__tests__/lidar-settlement-acceptance.test.ts` using its existing
fixtures. It failed at `592e04ed` with received `obsolete read error`:

```ts
it('reinstalled workflow ignores failure from previous installation', async () => {
  let rejectRead!: (reason: Error) => void
  mocks.list.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  store.openImportJob.value = { ...complete }; await flush()
  disposeLidarWorkflow()
  installLidarWorkflow(); await flush()
  store.lidarStatusMessage.value = 'current status'
  rejectRead(new Error('obsolete read error')); await flush()
  expect(store.lidarStatusMessage.value).toBe('current status')
})
```

## F2 — Unregistering releases retained ownership

`MapLibreSurfaceLifetimeRegistry.on` in
`desktop/web/src/maplibre/surface-adapter.ts` appends a cleanup closure capturing
the listener. Its new `off` removes the MapLibre subscription but leaves that
closure in `cleanups` until whole-map teardown. Hide/show accumulates retained
listeners and the provider resources they capture even though active counts pass.

Explicit unregister must remove the matching retained cleanup registration as well
as the map listener. Repeated unregister and final clear remain harmless. Unrelated
listeners/cleanups survive and run at their correct lifetime; registrations after
clear cannot leak. Retain the existing lifetime abstraction and call sites.

First demonstrate retention through the real adapter and repeated mount/unmount or
on/off cycles. Assert retained registration count returns to baseline before map
teardown, not merely that active map listeners disappear. A narrow test-only view
of ownership state is acceptable if no stable behavioral seam exposes retention;
do not add a public production diagnostic API or rely on nondeterministic GC.
Keep actual dispatch and final teardown controls so bookkeeping cannot pass while
listeners remain attached. Cover the real WorkspaceMapControls hide/show path.

## R50 — Close the saved-definition retry evidence gap

Reuse `AnalysisPanel`, `app/lidar/actions.ts::retryAnalysis`, the generated IPC
adapter, `commands/lidar.rs::lidar_retry_analysis` and
`LidarLibrary::retry_analysis`. Two failed definitions have different IDs, names
and saved parameters. Change the Create form and retry the second row by name.
Prove its ID and expected source generation reach the command; retry creates a new
job for that same saved definition, preserving its name/parameters and leaving the
other definition alone. A changed source head must refuse retry without replacing
the last valid result. A Design switch during the action cannot present into the
replacement Design. Existing tests may already supply some of these controls.

A real IPC drive is preferred when available. Otherwise use linked boundary tests:
real UI/action/generated adapter with only transport mocked, plus the actual native
command/executor/library against isolated storage. Exercise command argument wiring,
not just library behavior. Shared concrete inputs/outputs connect the proofs; label
them as boundary tests, never an end-to-end driven app. Do not build a bridge server
or new harness. Record RED only if there is a defect; already-correct behavior is
baseline GREEN, with a focused reversible fault check if detector sensitivity is
uncertain. Restore any mutation before gates.

## Remaining evidence and finish boundary

R48 proves mid-write preservation/cleanup and worker retry. R51 proves deterministic
Value/NoData currency rejection. Neither proves scheduler retry, live UI, stress or
peak resource behavior. Preserve these limits in the receipt.

R43 live scratch/queue evidence remains separate from the earlier capacity plane's
sampled process memory and post-run residue. Audit the existing C0–C5 and source
amendment gates, run feasible local scenarios using existing TS/Rust tests and
fixtures, and name exact commands, prerequisites and residual risk for missing
lanes. Do not drop R43 or silently turn measurements into stronger claims. Retain
production ceilings until the authorized evidence supports changing them. No new
performance targets or speculative optimization are introduced here.

Driven Desktop/Web is not automatically external: inspect the edition guide and
try the available local route. Private fixtures, credentials and other OS hosts
may genuinely be unavailable. Exhaust independent local work, then report a single
consolidated partial delivery if a required gate remains unavailable. Do not ask
for routine continuation or loop on an unchanged prerequisite. Integration, release
and branch cleanup remain separately authorized.
