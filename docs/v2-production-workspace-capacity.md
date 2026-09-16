# V2 production workspace capacity evidence

This record contains two consecutive serial runs from 2026-09-16. Both runs
used the same source receipt, browser, hardware, dimensions, warm-up, and
sample counts. The repeated timings show browser-scheduling variation without
changing the gate result.

## Method

Run the development-only production workspace harness against the accepted
private v5 representative Design. It verifies the pinned source receipt before
and after the serial run. Dense and dispersed 10,000-Plant fixtures are
temporary deterministic derivatives; their directories are removed after each
scenario, including a failure.

The in-browser development preparation changes only `version` to `6` and adds
`newDesignSpatialFrame()`. It is not a file-format converter and must not be
shipped.

The harness mounts `createWorkspaceRuntimeComposition` with memory-only app,
panel-target, contribution, snapshot and offline-basemap adapters. It loads
through the public document surface before starting. It does not reconstruct
the camera, renderer, coordinator, or controls.

## Required scenarios

| Scenario | Expected ready outcome | Fixture |
| --- | --- | --- |
| Representative shared | `shared-ready` | Accepted representative receipt |
| Representative Canvas2D fallback | `fallback-ready` | Accepted representative receipt |
| Capacity dense shared | `shared-ready` | Temporary dense 10,000-Plant derivative |
| Capacity dispersed shared | `shared-ready` | Temporary dispersed 10,000-Plant derivative |

For each scenario, record public-surface pan, zoom, selection, Plant edit,
undo, a single connected canvas while mounted, and zero connected canvases
after disposal. Do not inspect private MapLibre ownership to fill a result.
The pointer interaction uses a bounded, centre-ranked set of visible unlocked
Plants, excluding grouped members, and requires exact pointer selection before
drag/undo. Candidate identity and coordinates are not evidence output.

## Measurement limits and gates

Navigation frame intervals and input-to-second-requestAnimationFrame are browser
frame opportunity proxies. Every navigation-frame sample dispatches an
alternating wheel event before waiting for animation-frame delivery, including
warm-up; it is neither an idle RAF measurement, native input latency, nor GPU
completion.
The JSON records actual browser/OS/GPU fields when observable, plus viewport,
DPR, warm-up and sample metadata. The harness temporarily captures the public
MapLibre map at `addLayer`, verifies `getLayersOrder()` for the shared semantic
bands, and counts public Map `remove()` calls. Cleanup requires one shared-map
removal, or zero to one fallback removal when capability rejection precedes map
construction, plus zero scoped persistent DOM listeners/canvases and unchanged public viewport
state after settled post-disposal workspace events. The DOM listener ledger
matches capture and duplicate-add identity rules. MapLibre internal Evented
registrations can remain after `remove()` and are recorded as non-gating /
unavailable. The instrumentation is restored in a `finally` block. Missing
work, render, or memory evidence is `unavailable`.

The plan targets are fixed:

- p95 frame-opportunity proxy compared directly with the 16.7 ms reference;
- p95 input-to-second-RAF proxy below 50 ms;
- no sustained stall: no consecutive run of two intervals over 100 ms.

The proxy classification always marks native qualification unavailable. Any
failed or unavailable required correctness evidence remains incomplete. A
performance miss requires a bounded optimization follow-up; do not change the
references. The all-scenario command records completed and failed scenario
aggregates before returning a nonzero exit for a scenario execution or
correctness failure. A recorded performance-proxy miss remains evidence and
does not change the process exit code.

## Run record

### Environment and fixture

- Linux 7.0.0-31-generic x64; Node v22.22.0.
- Intel Core i7-6700K at 4.00 GHz, 8 logical cores.
- Chrome 150.0.0.0, 1200 x 800 CSS pixels, DPR 1.
- Shared renderer GPU: ANGLE on NVIDIA GeForce GTX 1080 Ti, OpenGL 4.5.0.
- 20 navigation warm-up frames, 120 alternating wheel/frame-opportunity
  samples, and 30 input-to-second-RAF samples per scenario.
- Source SHA-256:
  `446c656e12eca21ddf5c03e79cd1f8d7862eae88626c4cb550d55b505d246f40`.
  Both serial runs and every scenario's before/after receipt matched it.
- Source receipt: format v5, 1,113,057 bytes, 2,201 Plants, 24 Zones, 106
  Annotations, 134 Measurement Guides, 8 Layers, 2 Guides, 124 Consortiums,
  and 117 Budget entries. All 2,201 Plant IDs were unique and non-empty.
- Dense and dispersed derivatives each had exactly 10,000 unique, non-empty
  Plant IDs and all recorded Plant references were valid. Their temporary
  directories were removed by the harness.

### Correctness and ownership

Both runs produced the same correctness result:

| Scenario | Outcome | Canvas owner | Pan / zoom / select / edit / undo | Order | Disposal |
| --- | --- | --- | --- | --- | --- |
| Representative shared | `shared-ready` | pass | pass | basemap, shared scene | pass |
| Representative fallback | `fallback-ready` | pass | pass | not applicable | pass |
| Dense 10,000 shared | `shared-ready` | pass | pass | basemap, shared scene | pass |
| Dispersed 10,000 shared | `shared-ready` | pass | pass | basemap, shared scene | pass |

Every shared scenario removed one public MapLibre map. The fallback rejected
WebGL2 before map construction and therefore removed zero maps. Every scenario
ended with zero connected workspace canvases, zero scoped persistent DOM
listeners, unchanged public viewport state after settled post-disposal events,
and no new page error during that post-disposal check. MapLibre internal Evented
registrations are unavailable as a public cleanup assertion.

### Browser proxy measurements

Values are milliseconds, rounded to one decimal. Each cell shows run 1 / run
2. Heap is the observed used JavaScript heap after the scenario.

| Scenario | Navigation p50 / p95 / p99 | Intervals >100 ms | Input-to-second-RAF p50 / p95 / p99 | Used heap bytes | Proxy result |
| --- | --- | ---: | --- | ---: | --- |
| Representative shared | 33.3 / 50.0 / 133.3; 33.4 / 83.3 / 83.4 | 2 / 0 | 50.7 / 87.0 / 88.4; 51.7 / 71.3 / 81.7 | 92,104,783 / 162,214,751 | fail |
| Representative fallback | 16.7 / 33.4 / 83.3; 16.7 / 33.4 / 83.2 | 1 / 1 | 38.2 / 76.3 / 81.5; 35.2 / 78.2 / 79.9 | 34,027,697 / 136,150,325 | fail |
| Dense 10,000 shared | 100.0 / 166.7 / 199.9; 100.0 / 166.7 / 266.7 | 54 / 53 | 154.4 / 210.3 / 244.8; 159.3 / 257.6 / 358.3 | 137,982,875 / 184,078,891 | fail |
| Dispersed 10,000 shared | 100.0 / 150.1 / 183.4; 100.0 / 166.6 / 183.4 | 45 / 54 | 156.9 / 190.9 / 211.2; 160.1 / 213.7 / 242.3 | 172,550,705 / 170,977,869 | fail |

All four scenarios missed the unchanged 16.7 ms frame-opportunity reference
and the below-50 ms input proxy target in both runs. Dense and dispersed also
had sustained runs of intervals above 100 ms in both runs. Representative
shared had a sustained run in run 1 only; fallback had none. The correctness
and ownership qualification passes, while the performance gate fails.
`canopi-ltck.26` owns the bounded profiling and optimization follow-up.

Native presented-frame timing, native input-to-visible timing, GPU completion,
renderer work counters, renderer submission counters, real network tiles,
raster/LiDAR workload, and concurrent editing qualification were unavailable
in this browser harness and remain unclaimed.

## Bounded navigation optimization follow-up

`canopi-ltck.26` profiled the production composition with an opt-in,
aggregate-only work observer. The accepted change shares exact Pixi Plant
geometry contexts, keeps three bounded exact generations for A/B/A zoom reuse,
retains coincident stack counts for unchanged visible Plant identities and
selection, avoids repeated hit-bound projection, updates visibility only when
Plants enter or leave the viewport, and skips presentation synchronization for
an unchanged MapLibre camera. It still submits the retained Pixi stage in every
admitted custom-layer callback. Botanical radius, symbol, colour, focus,
interaction, stacking, hit testing, culling margin, display order, editing,
history, fallback, camera authority, and WebGL lifecycle remain unchanged.

Matched profiled runs identified exact Plant geometry rebuilding as a material
CPU cost. Values below are synchronous browser-thread milliseconds; clear
counts are `Graphics.clear()` calls per shared custom-layer callback. They do
not include GPU completion.

| Scenario | Shared layer p50 / p95 before | Shared layer p50 / p95 after | Pixi submit p50 / p95 before | Pixi submit p50 / p95 after | Clears p50 before / after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Representative shared | 33.5 / 62.7 | 30.6 / 69.7 | 17.1 / 31.1 | 11.1 / 25.8 | 2,461 / 260 |
| Dense 10,000 shared | 101.9 / 179.2 | 53.4 / 140.6 | 42.0 / 72.7 | 13.1 / 42.3 | 7,023 / 282 |

The final profiled representative run spent a median 2.1 ms building Plant
presentation entries and 11.8 ms assigning/drawing exact Plant geometry. The
dense run spent 9.5 ms and 26.1 ms respectively. Wheel dispatch stayed below
1 ms median. Of 200 shared callbacks, 168 carried camera changes; the remaining
32 callbacks reused presentation state but still submitted Pixi. MapLibre
repaint requests were 859 and 845. Full-scene traversal count was unavailable.

Two final unprofiled serial runs used the same hardware, source receipt,
viewport, warm-up and sample counts as the original record. Each cell shows
run 1 / run 2 in milliseconds.

| Scenario | Navigation p95 | Input-to-second-RAF p95 | Sustained intervals over 100 ms | Result |
| --- | ---: | ---: | --- | --- |
| Representative shared | 66.7 / 66.7 | 53.7 / 100.0 | pass / pass | fail |
| Representative fallback | 33.4 / 50.0 | 81.3 / 78.8 | pass / pass | fail |
| Dense 10,000 shared | 66.8 / 83.4 | 173.0 / 263.6 | pass / pass | fail |
| Dispersed 10,000 shared | 100.1 / 133.3 | 308.8 / 236.6 | fail / fail | fail |

All correctness, semantic order, single-canvas ownership, interaction,
history, disposal, listener cleanup, temporary derivative cleanup, and source
receipt checks passed in both runs. The representative source remained at SHA-
256 `446c656e12eca21ddf5c03e79cd1f8d7862eae88626c4cb550d55b505d246f40`.

The exact-context cache materially reduced geometry churn and synchronous Pixi
submission, especially for the dense derivative, but the unchanged performance
gate still fails. The browser proxy cannot partition the remaining time into
MapLibre CPU work, driver/GPU completion, or frame scheduling, and this run had
no real tiles or raster/LiDAR workload. Phase E remains blocked pending a fresh,
bounded rendering slice; the reference thresholds remain unchanged.
