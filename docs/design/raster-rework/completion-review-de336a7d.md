# Teardown correction and retry boundary proof

Status: evidence — named teardown/native proof obligations completed after reviewer takeover from `82354620`; remaining qualification follows the current receipt and `canopi-j571.3`.
Tracking: `canopi-j571.1`; existing `feature/raster-rework-completion`.
Current guidance: [sole prompt](completion-agent-prompt.md), [C0–C5](completion-design.md), [ownership contract](completion-ownership-design.md), [receipt](completion-receipt.md), [debrief](review-and-debrief.md#final-correction-debrief-to-deliver).

## Reviewed baseline

Reviewer rerun: seven frontend suites **97 passed**, native retry identity **1 passed**,
native R48/R51 **2 passed**. A separate teardown probe failed with three healthy
controls passing. Full frontend 2835/288 and other C5 gates are implementer-reported,
not independently rerun. Preserve F1 generation fencing, replacement/finally tests,
the previous five caller repairs and scoped R48/R51 proofs. Do not reopen those fixes.

This record refines the [previous review](completion-review-592e04ed.md). Existing
scientific, persistence, compatibility and ceiling policies remain unchanged.
No new architecture, dependency framework or performance target is authorized.

## F2b — Drain cleanup safely when cleanup unregisters a listener

In `desktop/web/src/maplibre/surface-adapter.ts`, `off()` splices `cleanups` while
`clear()` iterates that same array by descending index. Register listener A, then
cleanup B that unregisters A. Running B removes an earlier entry, shifts B into the
next index and executes B twice. Location and WorldMap use this ownership pattern:
register the mount listener, then add the basemap mount disposer to the lifetime.

Keep explicit unregister releasing retained ownership. Make draining safe against
callbacks removing other registrations: each eligible cleanup executes at most once,
unrelated cleanup still runs, removed listener registrations are not retained or
replayed, repeated clear/off are harmless, and on/addCleanup after clear releases
immediately. Preserve error isolation: one throwing cleanup must not suppress others.
A small destructive drain or equivalent local change is enough; choose the simplest
implementation that satisfies these semantics. Do not add a lifecycle framework.

Add the following reviewer-reproduced test inside the existing describe block in
`desktop/web/src/__tests__/maplibre-surface-adapter.test.ts`; it uses that suite's
fixtures. At `de336a7d`, the final expectation receives **2**, not **1**.

```ts
it('cleanup unregistering an earlier listener runs once', async () => {
  const adapter = createMapLibreSurfaceAdapter<FakeMap>({ loadMapLibre: vi.fn(async () => maplibre) })
  const teardown = vi.fn()
  adapter.attach(container)
  adapter.requestMap({
    key: 'street',
    createMap: (api, target) => new api.Map({
      container: target, style: { version: 8, sources: {}, layers: [] },
      interactive: false, pitchWithRotate: false, dragRotate: false, touchZoomRotate: false,
    }) as FakeMap,
    onCreate: ({ lifetime }) => {
      const listener = () => {}
      lifetime.on('moveend', listener)
      lifetime.addCleanup(() => { teardown(); lifetime.off?.('moveend', listener) })
    },
  })
  await flushPromises()
  adapter.destroy()
  expect(teardown).toHaveBeenCalledTimes(1)
})
```

Run RED before repair, then GREEN with dispatch, retained-registration release,
unrelated cleanup and repeated teardown controls. Exercise the production mount
plus lifetime composition, not only isolated off counts. Reuse existing caller suites.
Inspect mutation during draining explicitly in self-review; arbitrary extra cases
or a combinatorial test matrix are unnecessary.

## R50 — The untested seams and preservation case

Current evidence is useful but incomplete: AnalysisPanel mocks its action, the
Design-switch action test mocks `ipc/lidar`, and the native test calls the library
directly with one definition and no previously published analysis result.

Reviewer wording correction: `desktop/web/src/ipc/lidar.ts` is an **authored** invoke
wrapper using generated contract types. Earlier references to a generated adapter
were inaccurate. Test the actual wrapper; do not invent or generate another adapter.

| Boundary to prove | Required fixture/action and assertions |
| --- | --- |
| UI → action → authored IPC wrapper | Two failed definitions with different IDs/names/parameters; change Create fields, retry the second row by name. Keep the real action and wrapper; mock only `@tauri-apps/api/core` transport plus unrelated environment adapters. Assert `lidar_retry_analysis` receives the second saved definition ID and expected generation, no create command is sent, and returned identity drives the right presentation/job tracking. |
| Native command → executor → library | Call the real `commands/lidar.rs::lidar_retry_analysis` boundary with managed test state and actual executor/library on isolated storage. Assert the intended definition is retried with a new job and its saved name/parameters, while the other definition is unchanged. Direct library tests alone cannot replace this proof. |
| Changed-head refusal preserves publication | Establish an existing valid published result, record its accepted head/manifest/assets, change the source head, then retry using the stale expected head through the command. Assert refusal, no new retry job for that refusal, and unchanged prior publication. Use the existing generated-plane/native acceptance patterns; do not invent an invalid manifest and call it a published result. |
| Design replacement and healthy action | Preserve the passing Design-switch test and add/retain a healthy control that presents the retried identity. Assert actual transport arguments; absence of presentation alone is not an identity detector. |

Linked boundary tests are sufficient; label them honestly rather than claiming a
live end-to-end app drive. Use existing Vitest/Tauri/Rust testing facilities. A
minimal test-only setup for existing Tauri state is permitted; no bridge service,
new runtime dependency or broad production refactor. If exercising the command is
actually blocked, record the exact attempted setup/error and missing prerequisite;
do not relabel direct library coverage as command coverage.

Observe baseline GREEN where behavior already works. Do not manufacture product RED
from fixture NOT NULL errors. Where confidence in the detector is uncertain, make
one reversible targeted mutation (e.g. wrong identity argument) and verify the
intended assertion fails; restore before gates. Wait for spawned native work to
settle before deleting test storage; do not fake job completion in SQL while a live
worker still owns it. Reuse existing bounded wait/cleanup patterns.

## Evidence classification and exit

Run feasible remaining C0–C5 lanes. Driven Desktop/Web and R43 live scratch/queue
are **unverified**, not established external blockers from the latest receipt alone.
Use the edition guide and existing fixture/sampling routes. For each missing required
lane report exact command attempted (or prerequisite check that prevents launching),
observed failure, required resource, residual acceptance risk and next owner/action.
Do not repeatedly retry unchanged environment failures or rebuild unrelated tooling.
Private fixtures, keys and platform hosts may be genuinely external. Synthetic
memory samples or settled residue must not substitute for live scratch/queue proof.

Finish F2b, all locally executable R50 proof and available required gates before one
consolidated delivery. Maintain the existing receipt and bd; no new tracker. Missing
required proof keeps the bead partial. Optional cleanup is a follow-up, not a blocker.
Independent acceptance, primary-checkout integration, release and branch cleanup
remain separate; no automatic delegation or release authority is granted.
