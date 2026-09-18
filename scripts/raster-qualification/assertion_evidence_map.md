# Assertion-to-evidence mapping (Q requirement contract)

Status: active — the executable mapping the acceptance contract's C4 row requires next to the harness.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [acceptance contract](../design/raster-rework/q-admission-acceptance.md), [requirement contract](requirements.json), [repair receipt](../design/raster-rework/q-consolidated-repair-receipt.md).

`requirements.json` owns *which* assertions a Q requirement has and remains the executable obligation
set. This file records, for each assertion, **which recorded evidence decides it and what an absent
observation means**. It exists so a mapping cannot silently pass by absence of a failure string, and
so a reader can tell a capability gap from a gate defect.

`ok` in the tables below means the q1 artifact report's own named assertion, matched by exact name for
`_single` and by the given prefix for `_all_named`.

Rules applied throughout:

* an assertion passes only on a positive observation the producer recorded, or on a comparison the
  declaration makes possible;
* an observation that is absent is an explicit gap, never a pass;
* a value that is present but contradicts the declaration is a failure;
* a producer field this consumer does not recognise makes the affected assertion inconclusive and is
  reported, but it cannot erase an independently measured failure;
* nothing here fabricates a measurement. Where no probe emits the required evidence, the row says so
  and the assertion stays inconclusive.

## Q-ART-1 — candidate artifact correspondence (source: q1)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `artifacts-present-at-declared-version` | q1 assertions prefixed `version:` | inconclusive |
| `artifacts-match-integrity-digest` | q1 assertions prefixed `integrity:` | inconclusive |
| `artifacts-record-license` | q1 assertions prefixed `license-recorded:` | inconclusive |
| `qualified-roles-name-artifact-version` | worse of `verifiedArtifacts` against the exercised roles, and `sourceCorrespondence` against the declared pins | inconclusive |
| `non-corresponding-artifacts-recorded` | a recorded non-correspondence note, or a `sourceCorrespondence` inventory covering every required measured artifact | failure when a required artifact is neither covered nor noted |
| `apis-called-and-worker-target-recorded` | q1 assertion `apis-and-worker-target-recorded` | inconclusive |

## Q-LOCAL-1 — scoped local numeric transport (source: q2)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `reads-over-proposed-local-transport` | the count of validated windows in q2 | failure when no window was validated |
| `transport-ledger-corroborates-bytes` | q2 `serverLedger` reconciled against the probe's transport ledger | inconclusive |
| `no-single-request-returns-whole-artifact` | q2 assertions prefixed `no-whole-file-request` | inconclusive |
| `values-match-independent-reference` | q2 assertions prefixed `analytic:` | inconclusive |
| `validity-matches-reference-exactly` | q2 assertions prefixed `validity:` | inconclusive |
| `window-size-within-contract-limit` | q2 `windows` records against the 1024×1024-cell plan bound | inconclusive when no window size was recorded; failure when a measured window exceeds the bound |

## Q-PREP-1 — bounded preparation preserving originals (source: q3-prepare)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `original-bytes-unchanged` | q3-prepare assertion `original-unchanged` | inconclusive |
| `original-matches-recorded-hash` | q3-prepare assertion `original-hash-declared` | inconclusive |
| `sidecar-unchanged` | the identity `sidecarPolicy` and the recorded sidecar hashes (see `_sidecar_verdicts`) | inconclusive |
| `derivative-is-tiled-and-bounded` | q3-prepare assertion `derived-tiled` | inconclusive |
| `derivative-cell-exact` | q3-prepare assertion `cell-exact` | inconclusive |
| `derivative-preserves-metadata` | q3-prepare assertion `geotransform-preserved` | inconclusive |
| `derivative-windows-match-original` | q3-prepare assertion `all-values-match` | inconclusive |

## Q-MEMBER-1 — resolved members and overview precedence (source: q3-members)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `window-spanning-members-resolves` | q3-members assertions prefixed `multi-member:` | inconclusive |
| `unoccupied-slots-zero-coverage` | q3-members assertions prefixed `gap-empty:` | inconclusive |
| `ordered-replacement-precedence` | q3-members assertion `precedence-last-wins` | inconclusive |
| `nodata-does-not-erase-earlier-value` | q3-members assertion `nodata-does-not-erase` | inconclusive |
| `overviews-do-not-resurrect-replaced-pixels` | **none — hard-coded `UNKNOWN`** | always inconclusive; no probe exercises overview precedence |

## Q-VALUE-1 — scientific values and exact validity (sources: q2 and q4-slope)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `values-match-analytic-expectation` | q2 assertions prefixed `analytic:` | inconclusive |
| `validity-matches-reference-exactly` | q2 assertions prefixed `validity:` | inconclusive |
| `nodata-reported-invalid` | q4-slope assertions prefixed `hole-centre-not-interpolated:` | inconclusive |
| `valid-zero-and-negative-retained` | q2 assertions prefixed `zero-negative-retained:` | inconclusive |
| `slope-degrees-within-tolerance` | q4-slope assertions prefixed `degrees:` | inconclusive |
| `slope-percent-within-tolerance` | q4-slope assertions prefixed `percent:` | inconclusive |
| `blocked-slope-agrees-at-seams` | q4-slope assertion `seam-matches-whole` | inconclusive |
| `holes-and-edges-not-interpolated` | q4-slope assertions prefixed `outer-edge` | inconclusive |
| `required-fixture-classes-covered` | **none — hard-coded `UNKNOWN`** | always inconclusive; no assertion reports fixture-class coverage |

## Q-CRS-1 — CRS agreement (source: q4-crs)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `reference-crs-configured-explicitly` | q4-crs assertion `reference-epsg-configured-explicitly` | inconclusive |
| `crs-resolver-identified` | q4-crs assertion `crs-resolver-identified` | inconclusive |
| `candidate-projection-within-tolerance` | q4-crs assertion `candidate-projection-matches-reference` | inconclusive |
| `returned-coordinate-addresses-requested-pixel` | q4-crs assertion `candidate-returned-coordinate-addresses-requested-pixel` | inconclusive |
| `no-metadata-rewritten-or-inferred` | q4-crs assertion `original-metadata-untouched` | inconclusive |

## Q-CANCEL-1 — active-operation cancellation on the proposed route (source: q5-lifecycle)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `cancellation-issued-while-work-in-flight` | **none — hard-coded `UNKNOWN`** | always inconclusive; the recorded probe slices a resident buffer rather than the plan's route |
| `concurrent-in-flight-work-measured` | **none — hard-coded `UNKNOWN`** | always inconclusive; the probe counts completed operations |
| `unstarted-work-never-scheduled` | q5-lifecycle assertion `cancellation-stops-scheduling` | inconclusive |
| `owned-work-settles-within-bound` | q5-lifecycle assertion `cancellation-settles-in-bound` | inconclusive |
| `uncancelled-control-completes` | q5-lifecycle assertion `expected-rejection:` scoped control | inconclusive |

## Q-TEARDOWN-1 — owned worker teardown (source: q5-lifecycle)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `adapter-tolerates-repeated-dispose` | q5-lifecycle assertion `adapter-dispose-idempotent` | inconclusive |
| `teardown-observably-releases-resource` | **none — hard-coded `UNKNOWN`** | always inconclusive; release is asserted from a flag, not observed |
| `stalled-worker-terminated-within-bound` | q5-lifecycle assertion `lifecycle:stalled-worker-termination` | inconclusive |
| `silently-dead-worker-detectable` | q5-lifecycle assertion for dead-worker detection | inconclusive |

## Q-FAILINJ-1 — required failure injection (source: q5-lifecycle)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `truncated-header-rejected` | q5-lifecycle assertion `malformed-rejected:truncated-header` | inconclusive |
| `corrupt-tile-rejected` | q5-lifecycle assertion `malformed-rejected:corrupt-tile` | inconclusive |
| `out-of-extent-window-rejected` | q5-lifecycle assertion `malformed-rejected:out-of-image-window` | inconclusive |
| `stalled-worker-forced` | q5-lifecycle assertion `lifecycle:stalled-worker-termination` | inconclusive |
| `disk-write-failure-exercised` | **none — hard-coded `UNKNOWN`** | always inconclusive; no probe injects a disk-write failure |

## Q-HOST-1 — local Desktop worker and asset hosting (source: host report)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `bundled-worker-and-asset-path-exercised` | the host report's own assertions, with the declared accepted-host rule | inconclusive |
| `no-network-origin-required` | the host report's own assertions | inconclusive |
| `observed-in-desktop-webview` | the entry or bundle host label against `acceptedHosts` | inconclusive; only `desktop-webview` can satisfy it |

## Q-RES-1 — route-level resource measurement (source: q6-resources)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `candidate-memory-within-budget` | candidate `incrementalPeakRssMiB` against the plan's 1 GiB combined budget | inconclusive; the reference reader's reading never substitutes |
| `measurement-is-of-candidate-route` | each measurement's declared `routeRole` against its own route text | failure on a contradiction; inconclusive when no candidate record exists |
| `reference-measurements-labelled-separately` | the presence of reference-labelled records | inconclusive |
| `sampling-meets-requirement` | candidate `sampleIntervalMs` ≤ 100 ms with a positive `sampleCount` | inconclusive |
| `disk-cache-reads-queue-and-children-recorded` | **sampled** candidate records: `temporaryDiskHighWaterBytes`, `decodedCacheBytes` ≤ 128 MiB, `activeReads` ≤ 2, `queueDepth` ≤ 32, `maxConcurrentChildren` | inconclusive when a counter is unrecorded or no sampled record exists; failure when a recorded counter exceeds its budget |

## Q-DISPLAY-1 — route-level display measurement (source: q6-trace)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `one-cold-and-three-warm-runs` | the trace `runs` names against the plan's run set | inconclusive when the list is empty; failure when the counts are short |
| `hundred-valid-latencies-per-run` | each run's `individualLatenciesMs` count against the plan's ≥100 samples | inconclusive |
| `runs-report-successful-rendering` | each run's `ok`, `tilesRendered`, `failedTiles` | inconclusive |
| `p95-from-individual-latencies` | the run's own samples recomputed against `p95Ms` | inconclusive |
| `statistics-agree-with-samples` | median and max recomputed from the samples | inconclusive |
| `cache-state-recorded` | each run's `cachesCleared` | inconclusive |
| `no-ui-thread-task-above-bound` | each run's `longTaskMaxMs` against the 50 ms plan bound | inconclusive when no run records a usable value; a recorded value over the bound fails regardless of other producer-agreement findings |
| `unsupported-observation-is-inconclusive` | `longTaskObserverSupported` and unrecognised run fields | inconclusive |

## Observations that are deliberately permanent gaps

Seven assertions are hard-coded `UNKNOWN` because **no probe emits their evidence**. They stay
inconclusive and this repair did not implement them, because doing so would require new qualification
experiments:

* `Q-MEMBER-1` `overviews-do-not-resurrect-replaced-pixels`;
* `Q-VALUE-1` `required-fixture-classes-covered`;
* `Q-CANCEL-1` `cancellation-issued-while-work-in-flight` and `concurrent-in-flight-work-measured`;
* `Q-TEARDOWN-1` `teardown-observably-releases-resource`;
* `Q-FAILINJ-1` `disk-write-failure-exercised`;
* `Q-HOST-1` `observed-in-desktop-webview` (satisfiable only by a real Desktop WebView run).

Recording them as gaps is the honest outcome. Fabricating a measurement, or weakening an assertion to
match what a probe happens to emit, is not permitted, and neither is treating the absence of a failure
string as a pass.
