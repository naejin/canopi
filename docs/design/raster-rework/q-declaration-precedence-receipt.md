# Q declaration validation and precedence repair — implementation receipt

Status: evidence — **implemented, pending independent verification**. Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [declaration/precedence prompt](q-declaration-precedence-agent-prompt.md), [requirement contract](../../../scripts/raster-qualification/requirements.json), [review and debrief record](review-and-debrief.md).
Captured cycle evidence: [q-declaration-precedence-cycles.txt](evidence/q-declaration-precedence-cycles.txt).

This receipt covers a bounded repair of the three R5 findings in the review record. It adds no
engine, transport, worker, decoder, slope, preparation or publication implementation; runs no
qualification experiment; changes no pin; and regenerates no private evidence. Declarations are
treated as inputs: they are validated before anything is indexed from them, and a declaration defect
is labelled an evaluator-input failure rather than a measured engine failure.

## Baseline and delivery

| Item | Value |
| --- | --- |
| Baseline reviewed | `35c6166b`, preserving `578e3bdb`, `50c1211e`, `35c6166b` and the earlier stack; UI `0e696722` untouched; branch not reset to main |
| Bead | `canopi-kqpp`, claimed; scope recorded in bd before coding; **left open** |
| Branch | `feature/raster-html-references` |
| Owned files | `scripts/raster-qualification/{qualification_evidence.py,measure.py}`, `tests/test_qualification_gate.py`, `tests/test_cli_integration.py`, this receipt, the captured evidence log and affected guidance |
| Not changed | `qualification_gate.py`, `requirements.json`, `candidates.json` and its pins, production Rust/frontend, source builds, UI, skills, dependencies, private evidence |

### Skills read and what they constrained

| Skill | Files read | Constraint applied |
| --- | --- | --- |
| `tdd` | `SKILL.md`, `tests.md`, `refactoring.md` | One vertical RED→GREEN→refactor per behaviour, from a proven coherent control through the raw report → real assembler → real gate. Expected values written down before the code under test ran; no oracle in these cycles is computed by the module being tested. Each RED was checked to be the intended cause, and every guard was reverted in isolation afterwards to confirm the tests bite |
| `craft` | `SKILL.md` | Declarations treated as untrusted input on every entry point; absence never promoted into success; the failure and gap paths designed before the success path; one accumulation point and one reduction point per report |
| `codebase-design` | `SKILL.md` | `DeclarationValidation` is the validated value objects cross the seam; `admit_report` stays the admission seam and `evaluate` still decides eligibility; the reduction lives in one place instead of being smeared across sections |

No skills were created or modified. No subagents were used.

## What this prompt newly specifies

These were **not** explicit in the previous handoff; they are new in this prompt and are the parts
that changed the shape of the repair:

* **Declarations are inputs too, and the caller is not a guarantee.** The R4 repair validated the
  *observed* values against the declaration; it did not validate the declaration itself. The previous
  handoff's "required sets come from declarations" rule made the declaration authoritative without
  making it checked, so a malformed or duplicated declaration decided the outcome silently.
* **Decide each requirement only after collecting all independently evaluable findings.** The R4-04
  repair already accumulated failures and gaps in one report's admission, but it still reduced early
  — before the identity comparisons — so a gap could suppress a comparison rather than accompany it.
  "Collect then reduce once" is now a structural property of `admit_report`, not a local rule.
* **Invalid declarations are evaluator-input failures, not measured engine failures.** This is a new
  labelling obligation: the defect is in what the evaluator was handed, so it must be reported as
  such and must not read as a measurement that failed.
* **One validated declaration path for the real CLI and programmatic assembly, and tests must not
  exercise a stronger validation path than production.** Previously the CLI loaded declarations by
  hand (`json.loads` plus a shape check) while the assembler indexed them directly; neither validated,
  but they were also not the same code.
* **A known conflict must remain a failure when an unrelated field is missing** — stated as an
  invariant over the cross product of conflict kinds and gap kinds, in both orders, rather than as
  the individual examples the review happened to reproduce.
* **The same-class audit for the other declaration**, which the previous handoff did not require.

Already explicit before this prompt, and therefore not new: fail > inconclusive > pass precedence;
negative controls scoped separately; legacy gap-only reports staying readable and inconclusive; no
target verdict distribution for the existing records; retain `SourceDocument`, `Admission`, the
assembler and the gate.

## Repairs

| Review ID | Defect at `35c6166b` | Repair |
| --- | --- | --- |
| R5-01 | A fixture manifest was indexed straight into a dict and a set. A conflicting duplicate was order-dependent (`bad-first` passed, `bad-last` failed), an identical duplicate passed, a malformed member was misreported downstream as an undeclared fixture, a missing hash passed, and an explicit empty `requiredFixtures` list waived the raster requirement. The pin declaration had the same last-write-wins bypass through normal JSON decoding | `validate_fixture_manifest`, `validate_fixture_manifest_text`, `validate_pin_declaration` and `validate_pin_declaration_text` run before anything is indexed. Nonempty string names, well-formed SHA-256, and unique identities are required; duplicate JSON object keys are found while reading; required references must resolve to declared fixtures; a missing manifest or missing hash is inconclusive; malformed structure or values, duplicate identities (including identical), conflicting entries, undeclared required references and an explicit empty required list fail. An artifact-only role keeps its no-raster policy. Both entry points call the same functions: `assemble()` accepts either a raw declaration or an already-validated one, and `measure.py` returns the validation itself rather than collapsing a rejection into `None` |
| R5-02 | `admit_report` set a verdict inside its sections and returned early once a failure or a gap was known, before the identity comparisons. A wrong observed hash plus a missing `runId` produced `inconclusive` naming only the `runId`, with the conflict lost entirely — and the outcome was order-dependent | No section sets a verdict. Every section appends to `failed`/`gaps` or to the `conflicts`/`blocked` collectors, and the precedence is applied once at the end. A conflict outranks a gap, so a wrong hash is still a failure when the report also omits its `runId`, its recorded time or its command, and the reviewer sees both. The same holds for artifact, route and environment conflicts, and for a combined requirement whose contributing sources disagree — every contributing source's failure is retained |
| R5-03 | The report's own failures were gated on `result`: a positive failure list with the `result` key absent produced `inconclusive` and never surfaced the failure, an explicit `null` was treated exactly like an absent key, and a failed assertion was ignored. Containers were iterated without a shape check, so a malformed `failures` string was iterated character by character into nonsense failure names, a malformed `assertions` container raised `TypeError` from inside `assemble`, and a malformed `preconditions` container was read as "no unmet preconditions" and the requirement passed | Recorded failures, failed assertions and failed preconditions are read independently of `result` and are failures whatever the summary says. An absent `result` key stays a gap; a present-but-unusable `result` (including explicit `null`) is invalid, not absent. Every container is shape-checked by `_scan_failures`, `_failed_assertions`, `_scan_preconditions`, `_named_assertions`, `_texts` and `_failure_texts`; a malformed container is an input failure and is never read as an empty list, and the `assemble` crash is gone. Negative-control scopes stay separate and legacy gap-only reports stay readable and inconclusive |

### Same-class audit: the artifact/pin declarations

The prompt asked for the same audit on the other declaration, and the bypass was present. A pin
declaration `{"lib": "p", "lib": "q"}` collapsed to `"q"` under normal JSON decoding, so whichever
revision was written last silently became the expectation — the identical defect to the fixture
manifest, on the path that decides artifact/source correspondence. `validate_pin_declaration_text`
now reports a repeated pin key while reading, and the same text-level check covers
`pinnedSourceCommits`. A pin that is absent is a gap; a pin that is present but not a nonempty
string is a failure. The pins themselves are unchanged (`whitebox-wasm`
`9c0ff4fdf3513f27b89c78e294610c3b418b3a4f`, `cog-tiler-wasm`
`a71c321d357b0fde063238ab38bcf7ddb914eacd`).

## Acceptance results

| Family | Case | Result |
| --- | --- | --- |
| R5-01 | Remove the expected hash from the declaration | inconclusive, naming the missing field; not usable |
| R5-01 | Conflicting duplicate declaration, bad entry first / last | fail in both orders, naming both values |
| R5-01 | Identical duplicate declaration | fail, naming both values |
| R5-01 | Malformed member type, malformed SHA-256, unknown required reference, duplicate JSON key | named invalid declaration, nonzero CLI result, diagnostic artifact, no traceback |
| R5-01 | Explicit empty raster requirement set; artifact-only role | empty list fails; artifact-only keeps its no-raster policy |
| R5-01 | Duplicate pin key in the candidate manifest | rejected, nonzero CLI result, no traceback |
| R5-01 | Valid declaration through the real CLI | assembles, exit 0 |
| R5-02 | Wrong observed hash | fail, naming expected and observed |
| R5-02 | Wrong hash plus independently removed `runId` / time / command, both orders | still fail, both reasons visible |
| R5-02 | Same for artifact, route and environment conflicts | still fail, both reasons visible |
| R5-02 | Combined requirement with a failing contributing source | failure retained, other requirements unaffected |
| R5-03 | Positive failure with `result` absent | fail, naming the source failure |
| R5-03 | Failed assertion / failed precondition, absent or inconclusive `result` | fail, naming it |
| R5-03 | Explicit `null` `result` | invalid, not treated as absent |
| R5-03 | Malformed `failures` / `assertions` / `preconditions` container | input failure; no crash; no silent empty list |
| Compatibility | No `result`, no known failures, missing provenance | inconclusive, not a manufactured failure |
| Isolation | Invalid report or declaration scoped to numeric evidence | contributing requirements reflect it; unrelated valid requirements keep their prior verdicts |

## Test evidence

```sh
python3 -m unittest discover -s scripts/raster-qualification/tests -v   # 209 passed
bash scripts/raster-qualification/tests/test_runner_exit.sh             # 8 passed, 0 failed
python3 scripts/check_docs.py                                           # 0 errors
git diff --check                                                        # clean
python3 -m py_compile <each changed Python file>                        # OK
bash -n scripts/raster-qualification/run_all_experiments.sh             # OK
```

Test count progression: 168 at baseline → 180 (declaration validation) → 187 (CLI declaration path)
→ 205 (precedence and result-independence) → 209 (combined-fault probes). No existing test was
deleted. Two existing tests changed expectation because R5-01 deliberately changed the verdict they
asserted:

* `FixtureCoverage.test_malformed_hash_is_not_a_valid_identity` expected `inconclusive` for a
  declared digest of the wrong shape. A declared value that cannot be a digest is a malformed
  declaration, which is a failure; the rendered report is now `fail`. The test documents the change
  in its docstring rather than being weakened.
* The same class's declaration-level duplicate assertions were reworded to match the emitted
  messages; the verdicts were already correct.

## Cycle and sensitivity evidence

Full commands, trimmed output and per-family RED/GREEN observations are in
[the captured evidence log](evidence/q-declaration-precedence-cycles.txt). The sensitivity results in
summary:

| Probe | What was reverted | Detected by |
| --- | --- | --- |
| R5-01 | Both CLI declaration loaders replaced with a plain `json.loads` | 5 new CLI declaration tests, plus 5 existing CLI tests (10 failures) |
| R5-02 probe A | `if gaps: result.verdict = UNKNOWN; return result` reinstated before the comparisons | 36 failures: the combined-fault probe, 27 `AdmissionPrecedence` cases and 4 `ResultIndependentFailures` cases |
| R5-02 probe B | Collected conflict reasons no longer carried into `result.reasons` | 26 failures, including the combined-fault probe. This probe also caught a weakness in the *first* version of that probe, which is why it now stacks two conflicts on different code paths |
| R5-03 probe C | Container shape checks removed, and the recorded findings gated on an absent `result` again | 4 failures: the malformed `failures` and `preconditions` container tests, the malformed-container silence control, and the positive-failure-with-absent-`result` test |

The combined-fault probes ask a question the isolated tests cannot: whether *every* contributor to a
reduced verdict is still visible when several faults are stacked on one report. They are the only
checks that fail when any single collector's contribution is dropped, and they cover the composed
case where two conflicts reduce to one verdict while the isolated tests are each satisfied by a
different path. Both entry points are covered: the CLI tests drive the real `measure.py` command, and
the assembler tests drive `evidence.assemble` directly, through the same validators.

## Current evidence verdict

The existing reports were evaluated **read-only** into a fresh temporary root, with source digests
recorded from the bytes read; nothing was regenerated, replaced or synthesised.

**Verdict: `inconclusive` — 12 of 12 requirements not passing. Exit status 1.**

This matches the distribution recorded before this repair, so the repair did not change the honest
classification of the existing records. They carry no identity block and no `runId`/`recordedAt`, and
the absence of a `result` field on the trace report is a gap; none of that was manufactured into a
failure, and nothing was promoted into a pass. No target verdict distribution is prescribed for these
records. Blocking requirement IDs: `Q-ART-1`, `Q-LOCAL-1`, `Q-PREP-1`, `Q-MEMBER-1`, `Q-VALUE-1`,
`Q-CRS-1`, `Q-CANCEL-1`, `Q-TEARDOWN-1`, `Q-FAILINJ-1`, `Q-HOST-1`, `Q-RES-1`, `Q-DISPLAY-1`.

## Limits of this repair

* This is a consistency boundary, not cryptographic attestation. The gate can show that a declaration
  is well formed and that evidence is present, self-consistent and matches the declared route and
  manifest; it cannot prove a measurement was physically performed, nor that a caller-supplied host
  label is truthful.
* The existing reports cannot be made valid by reassembly. Qualifying Q needs new runs that record
  identity, run and time, which is a new qualification experiment outside this task.
* A malformed container is reported as an input failure but is not repaired. The evaluator does not
  guess the intended shape.
* The pin declaration is validated for shape and repetition; the pins are not re-derived and the
  correspondence policy is unchanged.
* No scientific contract, tolerance, budget, requirement ID or engine pin was changed.

## Unavailable evidence

* No Desktop WebView, WebKit, macOS or Windows run exists for this repair, so `Q-HOST-1` and the
  platform-specific requirements are untouched.
* No new qualification experiment was run or regenerated; the reconciliation reflects only the
  reports already present.
* The runner exit handling is proven with deterministic stubs, not a real browser run.
* No JavaScript file changed, so no `.mjs` syntax check was applicable.
* `run_all_experiments.sh` was **not** run against the private evidence directory.
* The cycle and sensitivity observations are recorded in the linked evidence log from captured
  session output rather than a committed raw transcript; every command there is reproducible from the
  stated inputs.

## Recommended follow-ups (not implemented)

* **Record the declaration verdicts in the decision output.** The bundle now carries a
  `declarations` block with each declaration's verdict, problems and usability, and the CLI refuses a
  rejected declaration with a nonzero result. Feeding those problems into the emitted decision would
  make an evaluator-input failure visible to a consumer that only reads `decision.json`.
  Detection criterion: a run with a duplicated fixture declaration produces a nonempty
  `blockingRequirementIds` or an explicit input-failure field in the decision, not only a nonzero exit
  and a stderr line.
* **Promote the declaration validators to a shared reuse point if a third consumer appears.** Two
  consumers (`assemble`, the CLI) now share them. Detection criterion: a third module imports
  `validate_fixture_manifest*` or re-implements a JSON-shape check, at which point the validators
  should move beside the declaration format rather than being imported from the evidence module.
* **Extend the probe drivers to emit the identity block, a run identifier and a recorded time.**
  Success criterion: a re-run's reports pass `admit_report` and the previously passing requirements
  reach `pass` on admitted evidence.
* **A container-shape guard for the remaining probe-authored containers.** `verifiedArtifacts`,
  `sourceCorrespondence` and `notes` are now read through guarded readers and cannot raise, but they
  are not yet shape-checked by admission. Detection criterion: a malformed `sourceCorrespondence`
  value produces a named input failure rather than a gap.

## Handoff

Repairs are recorded as **implemented, pending independent verification**, not resolved. Q stays open,
the prototype-approval and engine-decision gates remain with the user, and **N1 must not start** before
this repair is independently reviewed. The prompt
[q-declaration-precedence-agent-prompt.md](q-declaration-precedence-agent-prompt.md) is retired by this
delivery.
