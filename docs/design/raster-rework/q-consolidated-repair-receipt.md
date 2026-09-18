# Consolidated admission repair — implementation receipt

Status: evidence — **implemented, pending independent verification**. Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
Acceptance contract: [q-admission-acceptance.md](q-admission-acceptance.md) — C1–C8, the single matrix this repair is judged against.
Current guidance: [review evidence](q-consolidated-admission-review.md), [implementation plan](../raster-data-analysis-rework.md), [LiDAR guide](../../agent/lidar.md).
Captured cycle, sensitivity and self-review log: [q-consolidated-repair-cycles.txt](evidence/q-consolidated-repair-cycles.txt).
Assertion-to-evidence mapping: [assertion_evidence_map.md](../../../scripts/raster-qualification/assertion_evidence_map.md).

This receipt covers a bounded repair of the **complete admission-to-CLI decision path**. It adds no
engine, transport, worker, decoder, slope or preparation implementation; runs no qualification
experiment; selects or builds no engine; changes no pin, tolerance or budget; and regenerates no
private evidence. `qualification_gate.py`, `measure.py`, `qual_lib.py` and the runner were in scope
for this repair, unlike the previous one.

## Baseline and delivery

| Item | Value |
| --- | --- |
| Baseline reviewed | `29789fe5`, preserving `5becb043`, `9fea1931` and the prior accepted stack; UI `0e696722` untouched; branch not reset to main |
| Bead | `canopi-kqpp`, claimed; scope recorded in bd before coding; **left open** |
| Branch | `feature/raster-html-references` |
| Owned files | `scripts/raster-qualification/{qualification_evidence.py,qualification_gate.py,measure.py,qual_lib.py,run_all_experiments.sh}`, `tests/{test_acceptance_contract.py,test_qualification_gate.py,test_cli_integration.py,test_runner_exit.sh}`, `assertion_evidence_map.md`, this receipt, the evidence log and affected guidance |
| Not changed | production Rust/frontend, `requirements.json`, `candidates.json` and its pins, probe drivers, scientific limits, UI, skills, dependencies, private evidence |

### Skills read and what they constrained

| Skill | Files read | Constraint applied |
| --- | --- | --- |
| `tdd` | `SKILL.md` | One vertical RED→GREEN per behaviour from a coherent passing control, through the raw report, the real assembler and the real gate. Vertical rather than horizontal: no bulk test-writing ahead of implementation. Expected values written down from the contract before the code under test ran, and no oracle computed by the module under test |
| `craft` | `SKILL.md` | Error paths designed first (unreadable report, unwritable output, malformed container); parse-don't-validate at the load seam; blast-radius traced before each structural change; no new dependency for JSON shape checking; proportion kept to the matrix rather than a generic schema framework |
| `codebase-design` | `SKILL.md` | `SourceDocument` deepened with `present` so absence and corruption stay distinct at one seam; `admission` keeps the source's own state separate from the derived failure severity via `sourceAdmitted`; one parse and one reduction rather than validation smeared across callers; the failure/gap collectors make `admit_report` deep behind an unchanged interface |

No skills were created or modified. No subagents were used.

## What changed, by matrix row

### Retained and independently verified (must not regress)

The R5 repairs were independently checked in the preceding review and are preserved: missing declared
hash is inconclusive; a conflicting duplicate declaration fails; a hash conflict survives a missing
`runId` with both reasons visible; a positive failure survives an absent `result`. Their tests are
unchanged and still pass. Nothing in this repair rewrites or weakens them.

### Newly implemented

| ID | Defect at `29789fe5` | Repair |
| --- | --- | --- |
| **C1** | `ok: "false"` and `ok: 1` passed because the leaf was read for truthiness; `met: "false"` and `met: 1` passed the same way; duplicate assertion names were accepted | `_failed_assertions` and `_scan_preconditions` accept only a real `bool`. A present `null` is malformed rather than absent; a missing key stays a gap. Duplicate assertion and precondition names fail whether or not the duplicates agree |
| **C2** | Eight distinct malformed shapes raised `AttributeError` from inside `assemble`; dropping q1 raised `UnboundLocalError` on `art_unpinned_names`; a truncated report was reported with the absence wording, so corruption read as "missing" | `load_source` validates every report field's container kind at the parse seam before returning a payload, and records whether the path existed. `SourceDocument.present` distinguishes absence from corruption; `admit_report` returns FAIL for a readable-but-unusable report with the reason preserved. The artifact observation names are computed from the declaration instead of inside the success branch. Assembly reads each source exactly once and every consumer shares that snapshot |
| **C3** | Renaming the numeric report's experiment to `q1-artifacts` still passed; the CLI declared no expected environment identity and no expected transport, and a declaration that omitted the transport skipped the comparison entirely | `experiment_by_source` and `transport_by_source` derive the expectation from the role the report is read for, so a caller cannot withdraw it by omission. A missing declaration element is reported as a gap naming the key. The CLI now declares `--expected-environment`, `--numeric-expected-transport` and `--display-expected-transport` |
| **C4** | `window-size-within-contract-limit` passed from the absence of an "exceeds the" string; `non-corresponding-artifacts-recorded` depended on a prose note | The probe records the window bounds it measured and the assertion is derived from them: within the bound passes, over it fails naming the size, absent is an explicit gap. The artifact assertion reads the correspondence inventory, so a complete inventory needs no note and prose alone does not rescue an absent one. The mapping is written down in `assertion_evidence_map.md` and a drift test keeps it in step with the contract |
| **C5** | A 1 GiB decoded cache passed a 128 MiB plan bound because counters were checked for presence, not value; an unsampled record could supply a compliant reading; a 900 ms stall against a 50 ms bound became inconclusive once any unrecognised optional field was added | `RESOURCE_BUDGETS` names the plan's limits (128 MiB decoded cache, 2 active reads, 32 pending requests) and each is checked independently on **sampled** candidate records only. A measured violation outranks a missing counter. The display bound is read from the runs before any producer-agreement gap is applied |
| **C6** | `evaluate(passing_evidence())` returned overall pass with no admission, declaration or provenance block at all; a failing assertion plus a missing route became inconclusive; a list-valued assertion verdict raised `TypeError`; an empty admission block passed | Every entry must carry a well-formed admission block: verdict and reasons are shape-checked and validated by identity before any membership test. Entry-level identity gaps accumulate and are reduced once with the assertion verdicts under fail > inconclusive > pass. The shared `passing_evidence()` control now carries a real admission block, so it exercises the admitted path instead of demonstrating the missing boundary |
| **C7** | `run_all_experiments.sh` ended at `measure.py compare` and tested `q-summary.json`; it never invoked `gate-assemble` or `gate`, so a run could finish zero without asking whether the evidence satisfies the contract | The runner assembles a bundle from the same reports and exits with `measure.py gate`'s status. The experiment summary is retained as a labelled diagnostic, and a summary that disagrees with an eligible gate is reported. The runner suite grew from 8 to 13 checks, including ineligible-gate-exits-nonzero-despite-passing-experiments and proof that the gate is really invoked with the assembled bundle |
| **C8** | Cross-layer combinations were not covered; a window fault plus a removed `runId` reduced to inconclusive; an entry whose source was unadmitted filed its recorded failures into `observed` without reducing them, so a recorded failure could grade down to a gap | Four fault kinds are crossed with four independent gap kinds in both orders, plus order-permutation and add/remove-evidence invariants. A measured violation of a requirement now raises the record's reduced severity, and an observed failure keeps its severity even when the source was not admitted. `sourceAdmitted` keeps "may this source contribute" separate from "is the requirement satisfied" |

### Discovered during the work and repaired in scope

The adversarial self-review and the real-evidence reconciliation found two further defects in the
owned surfaces. Both are same-class matrix violations and were repaired here rather than deferred:

* **C7/C4 — an unwritable destination raised a traceback.** Found by the self-review: pointing
  `gate-assemble` or `gate` at a destination that cannot be written crashed instead of exiting with a
  clear error. Both now exit non-zero through `qual_lib.write_output`, which reports the failure on
  stderr and never claims an output was saved. `write_report` returns whether it wrote.
* **C8 — a recorded assertion failure did not lift the admission severity.** Found while reconciling
  the real evidence: an entry whose source was unadmitted stored its failures in `observed` without
  reducing them, so a measured violation could be reported as a gap.

Optional and cosmetic findings are **not** included; they are listed under residual gaps for separate
bd follow-ups, per the contract's non-blocker rule.

## Acceptance matrix coverage

Every row is traced to tests. The new suites live in
`scripts/raster-qualification/tests/test_acceptance_contract.py`; existing suites keep their homes.

| ID | Tests | Boundary proven |
| --- | --- | --- |
| C1 | `C1StrictLeaves`: `test_assertion_ok_accepts_only_booleans` (9 wrong leaves), `test_precondition_met_accepts_only_booleans` (9), `test_control_still_passes`, `test_duplicate_assertion_names_are_rejected`, `test_duplicate_precondition_names_are_rejected`, `test_a_true_control_and_a_negative_control_stay_meaningful` | Boolean-only leaves; present null differs from absent; duplicate keyed records; controls still meaningful |
| C2 | `C2LoaderTotality`: `test_missing_each_report_role_produces_a_verdict` (9 roles), `test_missing_q1_does_not_crash_the_artifact_entry`, `test_wrong_nested_mapping_shapes_do_not_crash` (8 fields × 6 shapes), `test_truncated_report_keeps_its_malformed_reason`, `test_completely_absent_report_is_a_gap_not_corruption` | No uncaught exception; absence is a gap and corruption is a failure, with the reason preserved |
| C3 | `C3RoleIdentity`: `test_role_experiment_identity_is_required` (3 roles), `test_control_still_passes`, `test_declared_transport_is_compared`, `test_missing_required_declaration_blocks_rather_than_skips` (2 keys), `test_missing_declaration_does_not_disable_the_comparison` | Source identity fixed by role; omissions block rather than disable |
| C4 | `C4AssertionEvidence`: `test_numeric_window_bound_needs_a_positive_observation`, `test_numeric_window_bound_fails_when_a_window_exceeds_the_limit`, `test_numeric_window_bound_passes_on_a_recorded_valid_window`, `test_artifact_inventory_does_not_depend_on_a_prose_note`; `C4MappingDrift`: `test_every_contract_assertion_is_mapped` | Each assertion decides from an observation; the mapping cannot drift from the contract |
| C5 | `C5QuantitativeBudgets`: `test_control_within_every_budget_passes`, `test_over_budget_counters_fail` (3 counters), `test_missing_counter_is_a_gap_not_a_pass` (3), `test_unsampled_record_cannot_substitute_for_a_sampled_run`, `test_over_budget_still_fails_alongside_a_missing_counter`; `C5DisplayBudgets`: `test_stall_alone_fails`, `test_stall_survives_an_unrecognised_optional_field`, `test_control_within_bound_passes` | Plan budgets enforced per counter on sampled runs; a measured stall survives a producer-agreement gap |
| C6 | `C6AssertionVerdictTypes`: `test_non_verdict_assertion_values_fail` (11 values), `test_absent_assertion_value_stays_inconclusive`, `test_null_assertion_value_is_invalid_not_absent`, `test_control_still_passes`; `C6AdmissionRequired`: `test_entry_without_an_admission_block_cannot_pass`, `test_no_entry_anywhere_can_pass_without_admission` (4), `test_whole_bundle_without_admission_is_not_a_pass`, `test_malformed_admission_blocks_fail` (10 shapes), `test_not_admitted_sources_keep_their_own_severity`, `test_admitted_source_with_passing_assertions_still_passes`; `C6FailureOutranksGap`: `test_failing_assertion_survives_every_entry_gap` (6), `test_failing_assertion_survives_a_bundle_wide_gap`, `test_gap_alone_stays_inconclusive` (6) | Admission required and shape-checked; missing route cannot hide a fail; verdict types validated before membership |
| C7 | `C7OutputFailure`: `test_unwritable_gate_assemble_destination_reports_cleanly`, `test_unwritable_gate_destination_reports_cleanly`; `test_runner_exit.sh` cases 1–7 including the gate-decides cases and the summary/gate disagreement | Nonzero exit and diagnostic artifact on missing/malformed input; the runner's outcome is the requirement gate's; output failure is clear and never claims a save |
| C8 | `C8CrossLayerInvariants`: `test_each_fault_alone_fails_its_requirement` (4), `test_each_gap_alone_is_a_gap_for_its_requirement` (4), `test_fault_survives_every_cross_layer_gap` (16 pairs), `test_order_does_not_change_severity` (16 pairs × 2 orders), `test_adding_unrelated_evidence_never_closes_a_gap`, `test_removing_required_evidence_never_creates_a_pass` (4); `C8ObservedFailureSeverity`: `test_observed_failure_in_an_unadmitted_entry_stays_a_failure`, `test_observed_gap_in_an_unadmitted_entry_stays_a_gap` | Fault × gap interaction, order independence, monotonicity, retained severity |

### Minimum decisive cases the contract names, and where they sit

| Contract case | Covered by |
| --- | --- |
| Strings `"false"`, numbers and containers never pass a boolean leaf | C1 `NOT_BOOLEANS` (9 shapes, assertions and preconditions) |
| Missing result differs from null | C6 `test_absent_assertion_value_stays_inconclusive`, `test_null_assertion_value_is_invalid_not_absent` |
| Duplicate assertion/precondition/run/source identities fail | C1 duplicate tests; existing `DuplicateDeclaration`, `SourceProvenance` run-identity and `_named_assertions` index checks |
| Valid true and explicit negative-control controls remain meaningful | C1 `test_a_true_control_and_a_negative_control_stay_meaningful`; existing `ResultIndependentFailures` |
| Remove each source in turn, especially q1 | C2 `test_missing_each_report_role_produces_a_verdict` (all 9) |
| Corrupt/truncate JSON, wrong root/nested shapes, null measurements, missing identity, nonempty list identity | C2 shape matrix; `test_truncated_report_keeps_its_malformed_reason` |
| Wrong experiment, source role, route, transport, artifact/version/pin, fixture/hash, environment cannot qualify | C3 role identity and transport; existing `IdentityAdmission`, `HostScoping`, `ArtifactCorrespondence` |
| CLI supplies independent expectations; omissions block | C3 `test_missing_required_declaration_blocks_rather_than_skips`; CLI `--expected-*` options |
| Window dimensions/bounds and artifact correspondence cannot pass from absence or prose | C4 all four tests |
| 900 ms stall remains fail with another run's gap or an unknown optional field, either order | C5 `test_stall_survives_an_unrecognised_optional_field`; `test_stall_alone_fails` |
| Normal gate cannot pass missing/malformed admission, declarations, provenance | C6 `C6AdmissionRequired` |
| Validate assertion verdict types before membership tests | C6 `test_non_verdict_assertion_values_fail` |
| Missing route cannot hide an existing fail | C6 `test_failing_assertion_survives_every_entry_gap` |
| Synthetic mode isolated; supported synthetic control can exercise verdict logic internally | Existing `SyntheticMarking`, `MalformedEvidence`; `passing_evidence()` remains unmarked |
| `gate` exits zero only for full eligibility | Existing `MissingEvidence`, `FailingEvidence`, `MalformedEvidence`, CLI integration |
| Runner's final outcome depends on the requirement gate | `test_runner_exit.sh` cases 1, 3, 4, 7 |
| Cross-boundary failure × gap, order permutation, monotonicity | `C8CrossLayerInvariants` |
| Retain verified R5 fixes and previous numerical/statistics controls | Whole existing suite unchanged and passing |

## Verification

```sh
python3 -m unittest discover -s scripts/raster-qualification/tests -v   # 261 passed
bash scripts/raster-qualification/tests/test_runner_exit.sh             # 13 passed, 0 failed
python3 scripts/check_docs.py                                           # 0 errors
git diff --check                                                        # clean
python3 -m py_compile <each changed Python file>                        # OK
bash -n scripts/raster-qualification/run_all_experiments.sh             # OK
```

No JavaScript file changed, so no `.mjs` syntax check was applicable. Test count: 209 → 261. No
existing test was deleted or weakened; three existing behaviours changed verdict because this repair
deliberately changed them, and each is documented in the sections above rather than adjusted away.

## Sensitivity

Fourteen guard-removal probes were run, each reverting one guard in a working tree and restoring it.
All are recorded with their failing-case counts in the evidence log. Every boundary category has at
least one probe that bites:

| Probe | Guard reverted | Failing cases |
| --- | --- | --- |
| S1 | strict boolean leaves | 14 |
| S2 | one of the two duplicate-name checks | 0 |
| S2d | both duplicate-name checks | 2 |
| S3 | gate admission block required | 7 |
| S4 | gate verdict type check | 2 |
| S5 | entry-gap early return | 6 |
| S6 | role-derived experiment/transport | 5 |
| S7 | window bound from observation | 7 |
| S8 | resource budgets | 9 |
| S9 | sampled-records-only reduction | 1 |
| S10 | stall survives producer gap | 1 |
| S11 | loader shape validation | 42 |
| S12 | runner gate authority | 3 runner checks |
| S13 | observed-failure severity | 1 |
| S14 | mapping drift | 1 |

**S2 is reported honestly as a zero-result probe.** Duplicate detection exists twice — in
`_failed_assertions`/`_scan_preconditions` and in `_named_assertions` — and removing either alone
leaves the suite green because the other still refuses the duplicate. Removing both (S2d) fails. The
behaviour is bound by tests; the redundancy is defence in depth, not a single load-bearing check.
Reporting it as a pass would have overstated the coverage.

## Adversarial self-review

33 cases were driven through the **real** `measure.py` commands as subprocesses against small fresh
temporary reports. No assembler or gate was mocked or stubbed; each case recorded whether the CLI
crashed, whether a diagnostic bundle was produced, and the requirement verdicts read back through the
real `gate` command. The full case list is in the evidence log; the categories were: admissions
stripped from an assembled bundle; each of the nine report roles missing in turn; eight malformed
input shapes; six wrong identities; four over-limit or missing measurements; three failure-plus-gap
combinations; three declaration defects; and an unwritable destination.

Outcome: no false pass, no hidden failure and no crash remained after the repairs. **One
counterexample was found**: the unwritable destination produced a traceback for both `gate-assemble`
and `gate`, which violates the contract's C7/C4 requirement for a clear error and no false claim of a
saved output. It was repaired with its own tests. One further asymmetry (an unadmitted entry grading
an observed failure down to a gap) was found while reconciling the real evidence and repaired with
tests. Recording only "all tests pass" would not have found either.

## Current evidence verdict

The existing reports were evaluated **read-only** into a fresh temporary root. No experiment was run
or regenerated, no report was rewritten, and no identity was added to an old record. Source digests
are recorded in the evidence log.

**Verdict: `fail` — 1 fail, 11 inconclusive. Exit status 1.**

| Requirement | Verdict |
| --- | --- |
| `Q-DISPLAY-1` | **fail** |
| `Q-ART-1`, `Q-LOCAL-1`, `Q-PREP-1`, `Q-MEMBER-1`, `Q-VALUE-1`, `Q-CRS-1`, `Q-CANCEL-1`, `Q-TEARDOWN-1`, `Q-FAILINJ-1`, `Q-HOST-1`, `Q-RES-1` | inconclusive |

The previous reconciliation of the same record set reported twelve inconclusive. The single change is
a repair, not a regression, and it is deliberate:

* the recorded trace holds **one cold and one warm run** where the plan requires one cold and three
  warm, so `one-cold-and-three-warm-runs` is `fail`. That assertion was already computed from the
  trace; it was being filed as unusable partial evidence because the same report carries no `result`
  and no identity block, so a known measured failure never reached the verdict. C6 and C8 require the
  opposite. The run counts are verifiable in the raw bytes (`len(runs) == 2`,
  `Counter({'cold': 1, 'warm': 1})`).
* Both runs report `ok=True` and `tilesRendered=128/128`, so this is not a fabricated failure — it is
  the trace's own run count disagreeing with the plan.
* The remaining eleven requirements stay honestly inconclusive, and nothing was promoted to a pass.
  No target verdict distribution is prescribed for these records.

## Residual gaps and limitations

**Contract blockers: none known.** All eight rows are traced to tests, all focused gates are green,
and the adversarial self-review through the real CLI found no remaining false pass, hidden failure or
crash.

Non-blocking findings, each a candidate for a separately scoped bd follow-up rather than an expansion
of this repair:

* **Seven assertions are permanent gaps by construction** because no probe emits their evidence:
  `Q-MEMBER-1` overview precedence, `Q-VALUE-1` fixture-class coverage, `Q-CANCEL-1` in-flight
  cancellation and concurrent in-flight work, `Q-TEARDOWN-1` observable resource release,
  `Q-FAILINJ-1` disk-write failure injection, and `Q-HOST-1` Desktop WebView observation. Closing
  them needs new qualification experiments, which this repair is not authorized to run. They are
  listed in `assertion_evidence_map.md`.
* **Temporary-directory cleanup warnings** appear in test output. They do not affect any assertion.
* The **C4 mapping audit** covered the two assertions the review reproduced plus the drift check that
  keeps the whole map honest. A deeper per-assertion audit of the remaining sixty-six mappings against
  their probes is a larger, separately scoped exercise; the map records the current behaviour
  faithfully so that audit has a baseline.
* `Q-RES-1`'s **temporary-disk high-water** is recorded and reported but not gated against a numeric
  cap, because the plan states a staging/free-space policy rather than a universal byte budget.
  Inventing a cap is out of scope.
* **Per-process versus combined memory attribution**: the candidate's `incrementalPeakRssMiB` is the
  plan's combined figure as the producer records it. Splitting per-process samples is a producer
  change and is not attempted here.

Limits of what this repair establishes:

* This is a consistency boundary, not cryptographic attestation. The gate can show that evidence is
  present, self-consistent and matches the declared route, fixture and manifest; it cannot prove a
  measurement was physically performed or that a caller-supplied host label is truthful.
* The existing reports cannot be made valid by reassembly. Qualifying Q needs new runs that record
  identity, run and time.
* The runner's gate routing is proven with deterministic stubs, not a real benchmark run.

## Unavailable evidence

* No Desktop WebView, WebKit, macOS or Windows run exists, so `Q-HOST-1` and the platform-specific
  requirements are untouched.
* No new qualification experiment or probe run was performed, and no engine was selected or built.
* `run_all_experiments.sh` was **not** run against the private evidence directory; its behaviour is
  exercised only through isolated deterministic stubs in fresh temporary roots.
* Cycle, sensitivity and self-review observations are recorded in the linked evidence log from
  captured session output rather than a committed raw transcript; every command there is reproducible
  from the stated inputs.

## Handoff

Repairs are recorded as **implemented, pending independent verification**, not accepted on this
authority. Q stays open and unqualified, the prototype-approval and engine-decision gates remain with
the user, and **N1 must not start** before this repair is independently reviewed. The
[execution prompt](q-consolidated-agent-prompt.md) is retired by this delivery; the
[acceptance contract](q-admission-acceptance.md) is retained unchanged as the stable basis for that
review.
