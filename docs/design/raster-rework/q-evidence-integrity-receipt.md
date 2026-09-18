# Q evidence integrity repair — implementation receipt

Status: evidence — repair reviewed at `d963f755`; **not accepted**, remaining admission defects reproduced. Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [admission completeness prompt](q-admission-completeness-agent-prompt.md), [requirement contract](../../../scripts/raster-qualification/requirements.json), [review and debrief record](review-and-debrief.md).

## Independent review disposition

The remainder preserves implementation claims, not acceptance. Review independently reran 115 tests and documentation/diff checks successfully, then reproduced passing unlisted fixtures, unrelated artifact correspondence, stale/missing source-run provenance, and an explicit failed legacy report downgraded to inconclusive. See R4-01–R4-04 in the review record. The reported 12-inconclusive result is not proof that all source records lack measured failures; missing identity currently short-circuits their evaluation. No private qualification experiments were rerun by the reviewer.

This receipt covers a bounded repair of **evidence admission**. It adds no engine, transport, worker,
decoder, slope, preparation or publication implementation, runs no new qualification experiment, and
regenerates no private fixture evidence.

## Baseline and delivery

| Item | Value |
| --- | --- |
| Baseline reviewed | `47b9d508`, with `99832cc5` and `95310b85` atop `f637de31`; UI `0e696722` preserved |
| Bead | `canopi-kqpp`, claimed; scope recorded in bd before coding; **left open** |
| Branch | `feature/raster-html-references` (accepted stack preserved; not reset to main) |
| Owned files | `scripts/raster-qualification/{qualification_gate.py,qualification_evidence.py,requirements.json,measure.py,run_all_experiments.sh}`, `scripts/raster-qualification/tests/*`, this receipt and affected guidance |
| Not changed | production Rust/frontend, engine/build/transport/worker code, UI, skills, dependencies; no private fixture or report was written |

### Skills read and what they constrained

| Skill | Files read | Constraint applied |
| --- | --- | --- |
| `tdd` | `SKILL.md`, `tests.md`, `refactoring.md` | One vertical RED→GREEN per behaviour; each negative starts from a proven passing control; expected values for the percentile convention are hand-calculated rather than produced by the code under test; sensitivity confirmed by reversible mutation in isolated copies |
| `craft` | `SKILL.md` | Parse-don't-validate at the admission seam; one hard thing per module; absence of evidence never promoted to success; error paths designed before success paths; boundary inputs validated before use |
| `codebase-design` | `SKILL.md` | Admission is a deep module behind `admit_report(payload, expected=…) → Admission`; the gate consumes a verdict rather than re-deriving identity; entry construction takes admission as a required argument so an unadmitted entry cannot be built |

No skills were created or modified. No subagents were used.

## Contract and interface changes

* **`admit_report(payload, *, report_name, expected, requires_raster_fixture) → Admission`** — the new
  seam. It decides, for one raw report: whether the run's own result is usable, whether declared
  preconditions were met, whether the recorded identity matches the declared route/environment/host,
  artifact and fixture manifest, and whether it carries enough provenance to be traceable.
* **`Admission`** carries `verdict`, `reasons`, `identity`, split `positive_failures` /
  `negative_control_failures`, and `legacy`.
* **Report identity block** — raw reports now carry `identity` with `id`, `experiment`, `digest`,
  `runId`, `recordedAt`, `command`, `routeId`, `transport`, `environment`, `host`, `fixturePolicy`,
  `sidecarPolicy`, `fixtures[]`, and `artifact{name,version,sourceRevision}`. All are compared, never
  copied onto unlabelled reports.
* **`requirements.json`** gained `requiresRasterFixture` per requirement (Q-ART-1 is explicitly
  artifact-only, with a reason), plus two assertions recovered by the contract audit:
  `apis-called-and-worker-target-recorded` and `required-fixture-classes-covered`.
* Entry `provenance` is now taken from the report's identity; unadmitted sources keep their measured
  assertions under `observedAssertions` so partial successes stay visible without satisfying a
  requirement.

## Finding dispositions

All repair statuses are **implemented, pending independent verification**.

| Review ID | Defect | Repair |
| --- | --- | --- |
| R3-01 | Admission ignored a source report's own result, failures and failed preconditions; assertions were selected purely by prefix | `admit_report` refuses a report whose result is `fail`, whose failure list contradicts a `pass`, or whose named preconditions are unmet. Non-admitted assertions are not promoted |
| R3-02 | Identity was a caller-supplied label; missing fixture hashes and conflicting versions/routes/environments were not compared | Identity comes from the report; missing is a gap, conflicting is a failure with expected and observed values; legacy reports without identity are read as incomplete evidence |
| R3-03 | Route strings named the route; HTTP-range evidence could stand for the required local bridge; artifact/source mismatch was merely recorded | Transport is declared and compared structurally; an artifact published at a different source revision fails without a reproducible build from the pin |
| R3-04 | Sidecar absence was silent; an unobserved sidecar could be assumed absent | `sidecarPolicy` distinguishes `measured` / `not_applicable` / `unmeasured`; only an explicit policy settles it, and a changed sidecar fails |
| R3-05 | Statistics were accepted from the report; failed attempts could count as rendering | Counters must be whole, non-negative and consistent with the samples; median/p95/max are recomputed from individual latencies under a frozen hand-verified nearest-rank convention, and reported values must agree |
| Audit | Unconditional CRS assertion; measurement role inferred from a route-text prefix | `no-metadata-rewritten-or-inferred` now rests on the report's own observation; measurement role is declared and cross-checked against its label, and the worst candidate memory decides the budget |

## Acceptance cases

| Case | Test |
| --- | --- |
| Failed fixture-hash precondition fails `Q-LOCAL-1`, naming source and precondition | `test_failed_precondition_fails_the_requirement` |
| Inconclusive source; result/failure contradiction | `test_inconclusive_source_does_not_pass`, `test_result_contradiction_fails_even_when_assertions_pass` |
| Partial successes visible without satisfying | `test_partial_successes_stay_visible_but_do_not_satisfy` |
| Unrelated requirements preserved when one source fails | `test_unrelated_requirements_are_preserved_when_one_source_fails` |
| Missing fixture hashes ⇒ inconclusive | `test_missing_fixture_hash_is_inconclusive` |
| Artifact version / hash / route / environment conflicts ⇒ named mismatch | `test_artifact_version_conflict_fails`, `test_fixture_hash_conflict_fails_with_both_values`, `test_route_conflict_fails`, `test_environment_conflict_fails` |
| Reassembly cannot launder a conflict | `test_reassembly_cannot_launder_a_conflict` |
| HTTP-only transport preserves capability but cannot satisfy the bridge | `test_http_only_transport_cannot_satisfy_the_local_bridge`, `test_renaming_the_route_string_does_not_change_the_transport` |
| Different source revision cannot pass; reproducible build can | `test_different_source_revision_cannot_pass`, `test_reproducible_build_evidence_satisfies_correspondence` |
| Sidecar: removed observation, changed sidecar, explicit no-sidecar | `test_measured_policy_without_a_sidecar_record_is_inconclusive`, `test_measured_sidecar_that_changed_fails`, `test_unobserved_sidecar_is_inconclusive`, `test_control_declared_absent_sidecar_passes` |
| Coherent one-cold/three-warm trace passes | `test_control_consistent_run_passes_its_statistics`, `test_control_declared_roles_pass` |
| One failed tile; missing/invalid counts; count/sample mismatch | `test_one_failed_tile_fails_rendering`, `test_missing_counters_are_rejected`, `test_invalid_counts_are_rejected`, `test_counts_disagreeing_with_samples_are_rejected` |
| Inconsistent p95 rejected or recomputed and reported | `test_inconsistent_reported_p95_is_rejected`, `test_sample_derived_statistic_is_used_not_the_reported_one` |
| Unconditional CRS claim requires observation | `test_metadata_rewrite_assertion_requires_an_observation` |
| Reference measurement cannot be relabelled as candidate | `test_reference_measurement_relabelled_as_candidate_is_rejected`, `test_relabelling_both_role_and_text_is_rejected_as_a_contradiction` |
| Runner exit handling (retained) | `test_runner_exit.sh` — 8 cases |

## RED → GREEN and sensitivity evidence

Each cycle began with a failing test for the intended missing behaviour, from a control that passed
the same requirement.

| Behaviour | First RED (intended failure) | GREEN |
| --- | --- | --- |
| Source-report failures reach the gate | `test_failed_precondition_fails_the_requirement` — `'pass' != 'fail'`: a failing hash precondition was promoted anyway | `admit_report` refuses the source |
| Partial successes stay visible | `test_partial_successes_stay_visible_but_do_not_satisfy` — `{} is not true`: observations were dropped entirely | kept under `observedAssertions` |
| Identity conflict detection | `test_route_conflict_fails`, `test_environment_conflict_fails` — `'pass' != 'fail'`: no comparison existed | identity compared, values named |
| Transport sufficiency | `test_http_only_transport_cannot_satisfy_the_local_bridge` — `'pass' != 'inconclusive'` | transport declared and compared |
| Source correspondence | `test_different_source_revision_cannot_pass` — reasons lacked the revisions; severity order was inverted (`PASS` above `UNKNOWN`) | `_worse` fixed to fail > inconclusive > pass; revisions named |
| Sidecar evidence | `test_measured_sidecar_that_changed_fails` and two others — helper existed but was never wired in | sidecar policy decides the assertion |
| Display statistics | `test_inconsistent_reported_p95_is_rejected` — `'pass'`; the reported number was trusted | statistics recomputed from samples |
| Unconditional CRS assertion | `test_metadata_rewrite_assertion_requires_an_observation` — `'pass' != 'inconclusive'` | assertion rests on the report |
| Worst-case candidate memory | `test_candidate_memory_over_budget_fails_with_values` — `'pass' != 'fail'`: the first candidate value was taken instead of the worst | maximum candidate memory decides |

Sensitivity checks — each guard disabled in an **isolated copy**, working tree untouched, mutations not
committed:

| Guard disabled | Suite result |
| --- | --- |
| Admission gate bypassed | 11 failures |
| Fixture-hash conflict check | 3 failures |
| Route conflict check | 3 failures |
| Artifact/source correspondence | 2 failures |
| Transport-kind comparison | 3 failures |
| Sidecar policy | 4 failures |
| Statistics agreement | 4 failures |
| Role/label contradiction | 2 failures |
| Worst-case memory selection | 2 failures |

Defects found in my own test fixtures during these cycles (recorded because they are the same class of
error the repair targets): a shared nested `ASSEMBLY` dict was mutated by an artifact-conflict test and
leaked into later tests (fixed with `assembly()` deep-copying); one test class overrode
`unittest.TestCase.run`; an `evaluate()` override shadowed a base helper and made results
order-dependent; and three fixtures were physically inconsistent (reported statistics that did not
match their own sample, a 128-sample run claiming one rendered tile, and measurements with no declared
role). Each is now either corrected or deliberately rejected by the gate.

## Current evidence verdict

The existing reports were evaluated **read-only** into a fresh temporary root. Their digests were
recorded before evaluation; nothing was regenerated, replaced or synthesised.

| Report | SHA-256 (first 16) | `result` | `identity` block |
| --- | --- | --- | --- |
| `q1-artifacts.json` | `14125f911bf6f8e5` | pass | absent |
| `q2-numeric.json` | `b212325ac143cc12` | pass | absent |
| `q3-prepare.json` | `7b776e72c7d4cb87` | pass | absent |
| `q3-members.json` | `4fdb526ba469c012` | pass | absent |
| `q4-slope.json` | `b2a7e073892decbc` | pass | absent |
| `q4-crs.json` | `7d6828ef92cddfe1` | pass | absent |
| `q5-lifecycle.json` | `eb4245e6d7c49fb0` | pass | absent |
| `q6-resources.json` | `86730de8e55d85c9` | pass | absent |
| `q6-trace.json` | `567abb94e612f502` | none | absent |

```sh
python3 scripts/raster-qualification/measure.py gate-assemble \
  --reports <existing-reports-dir> --host chromium --out <fresh>/bundle.json
python3 scripts/raster-qualification/measure.py gate \
  --bundle <fresh>/bundle.json --out <fresh>/decision.json
```

**Corrected verdict: `inconclusive` — 12 of 12 requirements not passing. Exit status 1.**

`inconclusive` rather than `fail` is the accurate result: the records report passing runs but carry no
identity block, so their route, environment, transport and fixture provenance cannot be verified. This
is incomplete evidence, not a measured violation. The previous four-`pass` result came from reading
those reports without any identity requirement, and it is withdrawn.

Blocking requirement IDs: `Q-ART-1`, `Q-LOCAL-1`, `Q-PREP-1`, `Q-MEMBER-1`, `Q-VALUE-1`, `Q-CRS-1`,
`Q-CANCEL-1`, `Q-TEARDOWN-1`, `Q-FAILINJ-1`, `Q-HOST-1`, `Q-RES-1`, `Q-DISPLAY-1`.

Honest gaps that remain blocking and were **not** inferred from adjacent passing assertions:
overview precedence (`Q-MEMBER-1`), candidate-route memory and cache/queue/temp-disk accounting
(`Q-RES-1`), the intended Desktop WebView host (`Q-HOST-1`), in-flight cancellation (`Q-CANCEL-1`),
observed teardown release (`Q-TEARDOWN-1`), disk-write failure (`Q-FAILINJ-1`), zero/negative
retention and required fixture-class coverage (`Q-VALUE-1`), and one cold plus three warm display runs
(`Q-DISPLAY-1`).

## Verification performed

| Command | Result |
| --- | --- |
| `python3 -m unittest discover -s scripts/raster-qualification/tests -v` | **115 passed** |
| `bash scripts/raster-qualification/tests/test_runner_exit.sh` | 8 passed, 0 failed |
| `python3 scripts/check_docs.py` | 0 errors |
| `git diff --check` | clean |
| `bash -n scripts/raster-qualification/run_all_experiments.sh` | syntax OK |
| `python3 -m py_compile` on every changed module | OK |
| JavaScript syntax check | not applicable — no `.mjs` changed |

`run_all_experiments.sh` was **not** run against the private evidence directory.

## Limits of this repair

* A schema can establish consistency, not truth. The gate validates that identity is present,
  self-consistent and matching the declared route; it cannot prove a measurement was physically
  performed. Assertions that must come from raw probe output and independent review are: measured
  values themselves, the host label a caller supplies, and whether the intended bundled Desktop assets
  were genuinely loaded.
* Synthetic gate fixtures are labelled with `syntheticGateFixture` and are usable only for evaluator
  tests; they carry no production qualification weight.
* The legacy reports cannot be made valid by reassembly. Qualifying Q requires new runs that record
  identity, which is a new qualification experiment and outside this bounded repair.
* No scientific contract, tolerance, budget or engine pin was changed. The 50 ms UI-thread bound,
  the 1 GiB memory budget, the plan's cold/warm run counts and the requirement IDs are unchanged.

## Unavailable evidence

No Desktop WebView, WebKit, macOS or Windows host run exists. No report carries the identity block, so
the corrected verdict above is the strongest conclusion the existing records support. RED/GREEN and
sensitivity outcomes above were observed in this session and are reproducible with the named tests;
no transcript file was captured.

## Recommended follow-ups (not implemented)

* Extend the probe drivers to emit the identity block on every report, so the next qualification run
  can be admitted rather than merely recorded. Success criterion: a re-run produces reports that pass
  `admit_report` and move at least the four previously-passing requirements to `pass` on evidence.
* Consider promoting `_worse`/severity handling into a shared helper if a third caller appears; one
  instance does not justify extracting it yet.

## Handoff

Repair implemented and tested; findings are recorded as **implemented, pending independent
verification**, not resolved. Q stays open, the prototype approval gate and engine-decision gate are
untouched, and **N1 must not start** before this repair is independently reviewed.
