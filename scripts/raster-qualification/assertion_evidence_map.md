# Assertion-to-evidence mapping (Q requirement contract)

Status: active — the executable mapping the acceptance contract's C4 row requires next to the harness.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [acceptance contract](../design/raster-rework/q-admission-acceptance.md), [requirement contract](requirements.json), [decision-complete design](../design/raster-rework/q-typescript-reassessment.md), [migration receipt](../design/raster-rework/q-typescript-receipt.md).

The executable form of this map is the declared check inventory in
`ts/src/evidence/registry.ts` (`CHECK_INVENTORIES`), one entry per requirement, each
check deciding exactly one contract assertion. This file records the same evidence in
prose so a reader can tell a capability gap from a gate defect; it does not generate
expected test outcomes, which are derived independently in `ts/tests/`.

`requirements.json` owns *which* assertions a Q requirement has and remains the executable obligation
set. This file records, for each assertion, **which recorded evidence decides it and what an absent
observation means**. It exists so a mapping cannot silently pass by absence of a failure string, and
so a reader can tell a capability gap from a gate defect.

`ok` in the tables below means the q1 artifact report's own named assertion, matched by exact name for
`_single` and by the given prefix for `_all_named`.

Rules applied throughout:

* an assertion passes only on a positive observation the producer recorded, or on a comparison the
  declaration makes possible;
* a check returns an explicit outcome: a pass needs affirmative applicable evidence, and a missing or
  malformed outcome, a thrown check or a contradictory success is a reported internal-check defect
  that cannot pass and exits input-class rather than being read as an engine failure;
* an observation that is absent is an explicit gap, never a pass;
* a value that is present but contradicts the declaration is a failure;
* a producer field this consumer does not recognise makes the affected assertion inconclusive and is
  reported, but it cannot erase an independently measured failure;
* nothing here fabricates a measurement. Where no probe emits the required evidence, the row says so
  and the assertion stays inconclusive.

## Q-ART-1 — candidate artifact correspondence (source: q1)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `artifacts-present-at-declared-version` | each **declared** required artifact's own `version:<artifact>` record | inconclusive; a record that fails fails the assertion |
| `artifacts-match-integrity-digest` | each **declared** required artifact's own `integrity:<artifact>` record | inconclusive; a record that fails fails the assertion |
| `artifacts-record-license` | each **declared** required artifact's own `license-recorded:<artifact>` record | inconclusive; a record that fails fails the assertion |
| `qualified-roles-name-artifact-version` | each artifact's own bench-verified version compared against the declaration; the claimed `pinnedRevision` compared against the declared pin **whenever the claim is present**; the recorded `artifactRevision` equal to that pin, or a fully evidenced reproducible build from it (`builtArtifact.{name,version,sha256}`, `sourceRevision`, `buildEvidence.{command,sha256}`, `buildReproduced`, the bench-verified digest and every consuming source's `identity.artifact.sha256`) | inconclusive for the comparison whose own operand is missing; a wrong version, a wrong claimed pin or a mismatched digest fails independently of any other gap |
| `non-corresponding-artifacts-recorded` | a `sourceCorrespondence` inventory covering every required measured artifact | inconclusive when a required artifact has no correspondence record; a duplicate key, an unrequired artifact or a wrong version in the inventory fails. A prose note is not correspondence evidence |
| `apis-called-and-worker-target-recorded` | q1 assertion `apis-and-worker-target-recorded` | inconclusive |

## Q-LOCAL-1 — scoped local numeric transport (source: q2)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `reads-over-proposed-local-transport` | the transport the q2 identity declares, which must be the plan's `local-bridge`, together with a positive validated-window count | inconclusive when the transport is unrecorded or no window count is recorded; a different transport (HTTP range included) or zero validated windows fails |
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
| `sidecar-unchanged` | the identity `sidecarPolicy` and a sidecar record that observes the sidecar present before **and** after preparation; a present malformed digest, a changed sidecar, a sidecar that did not survive or a conflicting declared hash fails | inconclusive; hash equality alone is not survival evidence |
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
| `observed-in-desktop-webview` | the host report's `identity.host` against the declared accepted hosts; only `desktop-webview` satisfies it | inconclusive when the host report is absent, which is the case under the default `chromium` profile. The `desktop-local` profile declares the role `host` and the isolated Desktop host produces `host.json`; the assertion passed on measured evidence at `fab0c381` |

## Q-RES-1 — route-level resource measurement (source: q6-resources)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `candidate-memory-within-budget` | each candidate run's `incrementalPeakRssMiB` against the plan's 1 GiB combined budget; the per-run peak is a mandatory observation, so a run that omits it cannot evidence the bound | inconclusive; the reference reader's reading never substitutes |
| `measurement-is-of-candidate-route` | each measurement's declared `routeRole` against its own route text | failure on a contradiction; inconclusive when no candidate record exists |
| `reference-measurements-labelled-separately` | records that explicitly declare the `reference` role | inconclusive when any record declares no role, and when no reference-labelled record exists; an invalid role label fails. A record with no role is never counted as a labelled reference measurement |
| `sampling-meets-requirement` | candidate `sampleIntervalMs` ≤ 100 ms with a positive `sampleCount` | inconclusive |
| `disk-cache-reads-queue-and-children-recorded` | **every** candidate record that recorded a counter: `temporaryDiskHighWaterBytes`, `decodedCacheBytes` ≤ 128 MiB, `activeReads` ≤ 2, `queueDepth` ≤ 32, `maxConcurrentChildren`; a budget is checked whether or not the record sampled correctly | inconclusive when a mandatory observation is unrecorded or no record sampled; failure when a recorded counter exceeds its budget or a leaf is present but unusable |

## Q-DISPLAY-1 — route-level display measurement (source: q6-trace)

| Assertion | Evidence read | If absent |
| --- | --- | --- |
| `one-cold-and-three-warm-runs` | the trace `runs` names against the plan's run set | inconclusive when the list is empty; failure when the counts are short |
| `hundred-valid-latencies-per-run` | each run's `individualLatenciesMs`: at least 100 finite non-negative samples, and a sample count equal to that run's successfully rendered tile count | inconclusive when the list or the rendered count is unreadable; a short list, a negative or non-finite sample, or a sample/render mismatch fails |
| `runs-report-successful-rendering` | each run's `ok`, `tilesRendered`, `failedTiles`, `tileRequests` and `pageErrors`, each read on its own: `ok` true, zero failed tiles, no page errors, rendered + failed equal to requested, at least 100 requested tiles, and a positive rendered count | inconclusive for the operand that is missing; a recorded failure, page error or reconciliation mismatch fails even when a sibling field is missing |
| `p95-from-individual-latencies` | the run's own samples recomputed against `p95Ms` | inconclusive |
| `statistics-agree-with-samples` | median and max recomputed from the samples | inconclusive |
| `cache-state-recorded` | each run's `cachesCleared` | inconclusive |
| `no-ui-thread-task-above-bound` | each run's `longTaskMaxMs` against the 50 ms plan bound | inconclusive when no run records a usable value; a recorded value over the bound fails regardless of other producer-agreement findings |
| `unsupported-observation-is-inconclusive` | `longTaskObserverSupported` and unrecognised run fields | inconclusive |

## Observations that are deliberately permanent gaps

Six assertions are hard-coded `UNKNOWN` because **no probe emits their evidence**. They stay
inconclusive and no repair has implemented them, because doing so would require new qualification
experiments:

* `Q-MEMBER-1` `overviews-do-not-resurrect-replaced-pixels`;
* `Q-VALUE-1` `required-fixture-classes-covered`;
* `Q-CANCEL-1` `cancellation-issued-while-work-in-flight` and `concurrent-in-flight-work-measured`;
* `Q-TEARDOWN-1` `teardown-observably-releases-resource`;
* `Q-FAILINJ-1` `disk-write-failure-exercised`.

`Q-HOST-1` `observed-in-desktop-webview` was listed here until the isolated Desktop host produced a
real WebView run at `fab0c381`; the `desktop-local` profile's `host` role now decides it, so it is no
longer a permanent gap.

Recording them as gaps is the honest outcome. Fabricating a measurement, or weakening an assertion to
match what a probe happens to emit, is not permitted, and neither is treating the absence of a failure
string as a pass.

Two further observations have no producer and are reported as requirement-level gaps without being
contract assertions:

* the plan's **512 MiB display disk-cache bound**. The gap is stated unconditionally rather than
  inferred from a missing field name, because a field name is this consumer's guess: accepting one
  would let a caller establish the plan's bound by inventing a key. `Q-RES-1` therefore stays a gap
  even though its five contract assertions are all decidable and correct;
* the plan's **staging and free-space policy** for temporary disk. `temporaryDiskHighWaterBytes` is
  recorded and reported, but it is compared with that policy rather than an invented universal cap.

## Executable check inventory

Generated from `CHECK_INVENTORIES` at the delivered revision; each contract assertion is
decided by the listed checks, or declared unsupported with its reason.

| Requirement | Assertion | Check id(s) | Unsupported reason |
| --- | --- | --- | --- |
| `Q-ART-1` | `artifacts-present-at-declared-version` | `artifacts.version-records` |  |
| `Q-ART-1` | `artifacts-match-integrity-digest` | `artifacts.integrity-records` |  |
| `Q-ART-1` | `artifacts-record-license` | `artifacts.license-records` |  |
| `Q-ART-1` | `qualified-roles-name-artifact-version` | `artifacts.verified-versions`, `artifacts.correspondence-inventory`, `artifacts.claimed-pin`, `artifacts.observed-revision` |  |
| `Q-ART-1` | `non-corresponding-artifacts-recorded` | `artifacts.correspondence-coverage` |  |
| `Q-ART-1` | `apis-called-and-worker-target-recorded` | `artifacts.api-and-worker-target` |  |
| `Q-LOCAL-1` | `reads-over-proposed-local-transport` | `local.transport` |  |
| `Q-LOCAL-1` | `transport-ledger-corroborates-bytes` | `local.ledger` |  |
| `Q-LOCAL-1` | `no-single-request-returns-whole-artifact` | `local.whole-file-requests` |  |
| `Q-LOCAL-1` | `values-match-independent-reference` | `local.analytic-values` |  |
| `Q-LOCAL-1` | `validity-matches-reference-exactly` | `local.validity` |  |
| `Q-LOCAL-1` | `window-size-within-contract-limit` | `local.window-bounds` |  |
| `Q-PREP-1` | `original-bytes-unchanged` | `prep.original-unchanged` |  |
| `Q-PREP-1` | `original-matches-recorded-hash` | `prep.original-hash` |  |
| `Q-PREP-1` | `sidecar-unchanged` | `prep.sidecar-policy`, `prep.sidecar-hashes`, `prep.sidecar-survival` |  |
| `Q-PREP-1` | `derivative-is-tiled-and-bounded` | `prep.derivative-tiled-and-bounded` |  |
| `Q-PREP-1` | `derivative-cell-exact` | `prep.cell-exact` |  |
| `Q-PREP-1` | `derivative-preserves-metadata` | `prep.metadata-preserved` |  |
| `Q-PREP-1` | `derivative-windows-match-original` | `prep.windows-match` |  |
| `Q-MEMBER-1` | `window-spanning-members-resolves` | `members.multi-member` |  |
| `Q-MEMBER-1` | `unoccupied-slots-zero-coverage` | `members.gap-empty` |  |
| `Q-MEMBER-1` | `ordered-replacement-precedence` | `members.precedence` |  |
| `Q-MEMBER-1` | `nodata-does-not-erase-earlier-value` | `members.nodata` |  |
| `Q-MEMBER-1` | `overviews-do-not-resurrect-replaced-pixels` | **none — declared unsupported** | no probe observes overview precedence, so the obligation remains unmeasured |
| `Q-VALUE-1` | `values-match-analytic-expectation` | `values.analytic` |  |
| `Q-VALUE-1` | `validity-matches-reference-exactly` | `values.validity` |  |
| `Q-VALUE-1` | `nodata-reported-invalid` | `values.nodata` |  |
| `Q-VALUE-1` | `valid-zero-and-negative-retained` | `values.zero-negative` |  |
| `Q-VALUE-1` | `slope-degrees-within-tolerance` | `values.slope-degrees` |  |
| `Q-VALUE-1` | `slope-percent-within-tolerance` | `values.slope-percent` |  |
| `Q-VALUE-1` | `blocked-slope-agrees-at-seams` | `values.seams` |  |
| `Q-VALUE-1` | `holes-and-edges-not-interpolated` | `values.holes-edges` |  |
| `Q-VALUE-1` | `required-fixture-classes-covered` | **none — declared unsupported** | no producer reports per-fixture-class coverage of the required fixture set |
| `Q-CRS-1` | `reference-crs-configured-explicitly` | `crs.reference-crs-configured-explicitly` |  |
| `Q-CRS-1` | `crs-resolver-identified` | `crs.crs-resolver-identified` |  |
| `Q-CRS-1` | `candidate-projection-within-tolerance` | `crs.candidate-projection-within-tolerance` |  |
| `Q-CRS-1` | `returned-coordinate-addresses-requested-pixel` | `crs.returned-coordinate-addresses-requested-pixel` |  |
| `Q-CRS-1` | `no-metadata-rewritten-or-inferred` | `crs.no-metadata-rewritten-or-inferred` |  |
| `Q-CANCEL-1` | `cancellation-issued-while-work-in-flight` | **none — declared unsupported** | the recorded probe slices a resident buffer rather than the plan's route, so in-flight work on the proposed route is not measured |
| `Q-CANCEL-1` | `unstarted-work-never-scheduled` | `cancel.unstarted-work` |  |
| `Q-CANCEL-1` | `concurrent-in-flight-work-measured` | **none — declared unsupported** | the recorded probe counts completed operations, which is not concurrent in-flight work |
| `Q-CANCEL-1` | `owned-work-settles-within-bound` | `cancel.settles-in-bound` |  |
| `Q-CANCEL-1` | `uncancelled-control-completes` | `cancel.uncancelled-control` |  |
| `Q-TEARDOWN-1` | `adapter-tolerates-repeated-dispose` | `teardown.repeated-dispose` |  |
| `Q-TEARDOWN-1` | `teardown-observably-releases-resource` | **none — declared unsupported** | release is asserted from a flag rather than observed on the route's own handles |
| `Q-TEARDOWN-1` | `stalled-worker-terminated-within-bound` | `teardown.stalled-worker` |  |
| `Q-TEARDOWN-1` | `silently-dead-worker-detectable` | `teardown.dead-worker` |  |
| `Q-FAILINJ-1` | `truncated-header-rejected` | `failinj.truncated-header` |  |
| `Q-FAILINJ-1` | `corrupt-tile-rejected` | `failinj.corrupt-tile` |  |
| `Q-FAILINJ-1` | `out-of-extent-window-rejected` | `failinj.out-of-extent-window` |  |
| `Q-FAILINJ-1` | `stalled-worker-forced` | `failinj.stalled-worker` |  |
| `Q-FAILINJ-1` | `disk-write-failure-exercised` | **none — declared unsupported** | no probe injects a disk-write failure |
| `Q-HOST-1` | `bundled-worker-and-asset-path-exercised` | `host.bundled-worker` |  |
| `Q-HOST-1` | `no-network-origin-required` | `host.no-network-origin` |  |
| `Q-HOST-1` | `observed-in-desktop-webview` | `host.accepted-webview` |  |
| `Q-RES-1` | `candidate-memory-within-budget` | `resources.candidate-memory` |  |
| `Q-RES-1` | `measurement-is-of-candidate-route` | `resources.role-labels` |  |
| `Q-RES-1` | `reference-measurements-labelled-separately` | `resources.reference-labels` |  |
| `Q-RES-1` | `sampling-meets-requirement` | `resources.sampling` |  |
| `Q-RES-1` | `disk-cache-reads-queue-and-children-recorded` | `resources.counters-and-budgets` |  |
| `Q-DISPLAY-1` | `one-cold-and-three-warm-runs` | `display.run-set` |  |
| `Q-DISPLAY-1` | `hundred-valid-latencies-per-run` | `display.latency-samples`, `display.sample-count-matches-rendered` |  |
| `Q-DISPLAY-1` | `runs-report-successful-rendering` | `display.request-minimum`, `display.run-outcome`, `display.failed-tiles`, `display.counter-reconciliation`, `display.page-errors` |  |
| `Q-DISPLAY-1` | `p95-from-individual-latencies` | `display.p95` |  |
| `Q-DISPLAY-1` | `statistics-agree-with-samples` | `display.median-max` |  |
| `Q-DISPLAY-1` | `cache-state-recorded` | `display.cache-state` |  |
| `Q-DISPLAY-1` | `no-ui-thread-task-above-bound` | `display.ui-thread-bound` |  |
| `Q-DISPLAY-1` | `unsupported-observation-is-inconclusive` | `display.unrecognised-fields`, `display.observer-support` |  |
