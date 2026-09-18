# Qualification gate repair — implementation receipt

Status: evidence — gate-only repair implemented and tested; **pending independent verification**. Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [Q gate repair prompt](q-gate-repair-agent-prompt.md), [requirement contract](../../../scripts/raster-qualification/requirements.json), [review and debrief record](review-and-debrief.md).

This receipt records a bounded repair of the **qualification gate**. It does not attempt to finish Q,
does not run new qualification experiments, and does not touch the raster engine.

## Baseline and delivery

| Item | Value |
| --- | --- |
| Baseline commit | `f637de31` (atop `cfbb0c35`, `fd86de68`, `ab2f7d25`, approved UI `0e696722`) |
| Bead | `canopi-kqpp`, claimed and left **open**; bounded scope recorded in bd before coding |
| Branch | `feature/raster-html-references` (accepted stack preserved) |
| Owned files | `scripts/raster-qualification/{requirements.json,qualification_gate.py,qualification_evidence.py,measure.py,run_all_experiments.sh}`, `scripts/raster-qualification/tests/*`, this folder's evidence/guidance |
| Not owned, not changed | production Rust and frontend, transport/worker/decoder/slope/preparation/publication implementations, engine selection, UI, N1, dependencies |

## Skills read and applied

| Skill | Files read | How it constrained the work |
| --- | --- | --- |
| `tdd` | `SKILL.md`, `tests.md`, `refactoring.md` | One behaviour at a time, RED observed for the intended missing behaviour, expected values taken from the plan rather than recomputed from the implementation, sensitivity checked by reversible mutation in an isolated copy |
| `craft` | `SKILL.md` | Parse-don't-validate at the bundle seam; one hard thing per module; error paths designed first; absence of evidence never treated as success; every external input validated at the boundary |
| `codebase-design` | `SKILL.md` | The evaluator is a deep module: a small interface (`require…`/`evaluate`) over contract loading, bundle coherence, assertion combination and precedence. Probes assemble evidence; the gate decides eligibility. Two modules rather than one, because a probe's output shape must not be able to redefine a requirement |

No skills were created or modified. No subagents were used.

## What the gate now distinguishes

Three conclusions that the previous harness collapsed:

1. **An assertion or negative control executed as expected** — recorded per assertion.
2. **A candidate capability was demonstrated for a stated route, fixture and environment** — an
   evidence entry must name its route, artifact, environment, command and source; a wrong host or a
   reference-only measurement cannot satisfy a candidate requirement.
3. **Every mandatory Q requirement is supported by adequate evidence** — decided from
   `requirements.json`, independently of which experiments reported success.

### Requirement matrix

The machine-readable contract is [`requirements.json`](../../../scripts/raster-qualification/requirements.json).
This receipt refers to it rather than restating it.

| ID | Requirement | Phase | Assertions | Current evidence verdict |
| --- | --- | --- | --- | --- |
| `Q-ART-1` | Candidate artifact correspondence | Q | 5 | **pass** |
| `Q-LOCAL-1` | Scoped local numeric transport | Q | 6 | **pass** |
| `Q-PREP-1` | Bounded preparation preserving originals | Q | 7 | **pass** |
| `Q-MEMBER-1` | Resolved members and overview precedence | Q | 5 | inconclusive (overviews) |
| `Q-VALUE-1` | Scientific values and exact validity | Q | 8 | inconclusive (zero/negative) |
| `Q-CRS-1` | CRS agreement | Q | 5 | **pass** |
| `Q-CANCEL-1` | Active-operation cancellation | Q | 5 | inconclusive (in-flight work) |
| `Q-TEARDOWN-1` | Owned worker teardown and resource release | Q | 4 | inconclusive (release not observed) |
| `Q-FAILINJ-1` | Required failure injection | Q | 5 | inconclusive (disk-write failure) |
| `Q-HOST-1` | Local Desktop worker/asset hosting without network | Q | 3 | inconclusive (no Desktop WebView) |
| `Q-RES-1` | Route-level resource measurement | Q | 5 | inconclusive (candidate memory) |
| `Q-DISPLAY-1` | Route-level display measurement | Q | 7 | **fail** (run completeness; long-task observation inconclusive) |

Verdict contract: `pass` only when every required assertion has valid, matching evidence meeting its
threshold; `fail` for measured violations or malformed/inconsistent/corrupt evidence;
`inconclusive` for missing, not-run, unsupported or wrong-route/environment evidence. Overall
precedence is fail → inconclusive → pass, and only an overall pass exits zero.

`F-PLATFORM-1` (cross-platform packaged distribution) and `F-E2E-1` (48-million-cell real batch
import) are recorded as later release gates with reasons. macOS/Windows absence does not make Q
inconclusive, but no Q result may be reported as cross-platform support.

## Reproduced review findings

| ID | Finding | Status |
| --- | --- | --- |
| R2-01 | Producer emitted `longTaskMaxMs`; evaluator read `maxLongTaskMs` and permitted missing values, so 900 ms passed a 50 ms bound | **Repaired, pending verification.** The assembler reads the producer's field, requires a supported observer, and reports unrecognised producer fields. `900 ms` now fails with the observed value and the bound in the reason |
| R2-02 | Empty trace passed; a run with 127 of 128 tiles failed passed | **Repaired, pending verification.** One cold and three warm runs, ≥100 individual valid latencies per run, `ok` true, zero failed tiles, and a usable p95 are required |
| R2-03 | Mandatory missing evidence became a limitation instead of blocking | **Repaired, pending verification.** Eligibility is derived from the contract; a limitations string cannot waive a requirement |
| R2-04 | Lifecycle probe slices a resident buffer; `operationsBeforeCancel` counts completed operations | **Repaired as a verdict, not as an experiment.** `Q-CANCEL-1` and `Q-TEARDOWN-1` are inconclusive: cancellation is not observed in flight and release is asserted from a flag. A later authorized experiment must measure the proposed route |
| R2-05 | Runner recorded failures but finished without returning failure | **Repaired, pending verification.** Accumulated step failures and a non-passing or absent aggregate both exit non-zero while the diagnostic summary is retained |
| R2-06 | Receipt deferred candidate memory/cache/queue/temp-disk, Desktop hosting and overview precedence to successors | **Repaired as a verdict.** These are recorded in the contract as Q requirements; they cannot be reassigned without an explicit decision |
| R2-07 | Negative tests could pass for unrelated preconditions | **Repaired, pending verification.** New negative cases start from an otherwise valid passing control and assert the specific reason and requirement id |

## Test evidence

```sh
python3 -m unittest discover -s scripts/raster-qualification/tests -v
```

**63 tests, all passing** (`test_qualification_gate.py`, plus the shell runner contract exercised
through `test_runner_exit.py`).

### Representative RED → GREEN and sensitivity outcomes

Observed RED during this work, with the failing reason (not a setup error):

| Behaviour | RED observation | GREEN |
| --- | --- | --- |
| Gate could not decide a missing bundle | `test_missing_bundle_is_inconclusive` failed `'fail' != 'inconclusive'` — absence was treated as corruption | `_read_bundle` returns presence separately; absence is inconclusive |
| Coherence check was over-broad | After adding bundle coherence, the passing control failed `'fail' != 'pass'` because per-entry gaps failed every requirement | Corruption (bundle-wide) separated from per-entry gaps (inconclusive) |
| Environment mismatch not detected | `test_environment_mismatch_fails_with_a_named_reason` failed `'pass' != 'fail'` — the comparison was never implemented | Entry environments are compared; a mixed bundle fails with a named reason |
| Duplicate requirement key undetected | `test_duplicate_requirement_key_cannot_hide_a_failure` failed `'pass' == 'pass'` on a report carrying `Q-RES-1` twice | Raw-text pair parsing detects the repeat |
| Gate CLI passed `name@version` as a version | `qualified-roles-name-artifact-version` failed on the real evidence with `whitebox-wasm@0.5.1` vs verified `0.5.1` | Defaults pass exact versions; a mismatch is still a named failure |

Sensitivity checks (guard removed in an **isolated copy**, working tree untouched, mutations not
committed):

| Guard | Mutation | Result |
| --- | --- | --- |
| Long-task field agreement | Reverted the consumer to `maxLongTaskMs` | Test detects: verdict becomes `inconclusive` with "fields this consumer does not recognise: longTaskMaxMs" |
| Long-task bound comparison | Bypassed the comparison (`if violation:` → `if False:`) on a complete trace | Test detects: verdict becomes `pass`, so the strengthened test fails as required |

The second check initially **missed** the mutation because the regression fixture used a single run,
so the run-count gap masked the bound. The fixture was corrected to one cold and three warm runs, and
`assert_only_the_bound_fails` now proves every other assertion passes — so a failure cannot be
explained by an unrelated precondition.

## Current evidence reconciliation

Evaluated **read-only** against the reports already present in the private scratch directory; no
evidence was regenerated or synthesised.

```sh
python3 scripts/raster-qualification/measure.py gate-assemble \
  --reports <existing-reports-dir> --host chromium --out <bundle.json>
python3 scripts/raster-qualification/measure.py gate --bundle <bundle.json> --out <decision.json>
```

**Overall verdict: `fail` — 1 fail, 7 inconclusive, 4 pass. Exit status 1.** Q does not qualify.

Unresolved gate IDs:

| Requirement | Why it is not passing |
| --- | --- |
| `Q-DISPLAY-1` | fail: the recorded trace has one cold and two warm runs, not the required one cold and three warm; the long-task observation is also inconclusive for that run set |
| `Q-RES-1` | inconclusive: no candidate-route memory measurement; the 18.32 MiB figure is the **native reference reader** and cannot substitute. Temporary disk, cache, queue depth and child count are unrecorded |
| `Q-HOST-1` | inconclusive: host is `chromium`; only `desktop-webview` is accepted. Chromium and Node cannot satisfy it |
| `Q-CANCEL-1` | inconclusive: cancellation is not observed with work genuinely in flight, and completed operations are not concurrent in-flight work |
| `Q-TEARDOWN-1` | inconclusive: release is asserted from a flag; no observed resource release for the route's own handles |
| `Q-FAILINJ-1` | inconclusive: disk-write failure is not exercised |
| `Q-MEMBER-1` | inconclusive: overview precedence is not exercised by any probe |
| `Q-VALUE-1` | inconclusive: valid zero/negative retention has no assertion in the recorded evidence. The observation was added to the probe for future runs; the recorded report predates it and was **not** regenerated |

This matches the review's expectation. The four passing requirements are genuine measured subtests,
not a qualification.

## Verification performed

| Command | Result |
| --- | --- |
| `python3 -m unittest discover -s scripts/raster-qualification/tests -v` | 63 passed |
| `bash scripts/raster-qualification/tests/test_runner_exit.sh` | 8 passed, 0 failed |
| `python3 scripts/check_docs.py` | 0 errors |
| `git diff --check` | clean |
| `bash -n scripts/raster-qualification/run_all_experiments.sh` | syntax OK |
| `node --check` on the changed probe | not applicable — no JavaScript file changed in this repair |

`run_all_experiments.sh` was **not** run against the private evidence directory, as the assignment
requires. Rust and production frontend suites were not run: no Rust or frontend file changed.

## Evidence quality: what the gate cannot establish

A schema can prove consistency, not truth. The following must come from raw probe output and
independent review, and the gate is explicit about it:

* measured values (RSS, latencies, byte counts) are read from probe reports; the gate validates
  range, unit plausibility and observation support, but cannot verify a report was not fabricated;
* `Q-HOST-1` depends on the host label a caller supplies. The gate refuses a non-Desktop host, but
  confirming a run really was the packaged Desktop WebView is a review step;
* `Q-MEMBER-1`'s overview-precedence assertion is `inconclusive` by construction: no probe observes
  it, and the gate must not infer it from adjacent results;
* the negative control for stripped input passes as expected rejection and deliberately does **not**
  satisfy `Q-LOCAL-1`, which requires positive bounded-access evidence.

## Unavailable evidence

* No Desktop WebView, WebKit, macOS or Windows run exists for this repair.
* No new qualification experiments were run or regenerated; the reconciliation reflects the reports
  already present.
* The runner exit handling is proven with deterministic stubs, not a real browser run.
* No RED/GREEN transcript was captured to a log file; the observations above are recorded from the
  working session and are reproducible with the named test commands.

## Remaining work

Deliberately **not** done here, and not authorized by this assignment: measuring the candidate
route's own memory, running the display trace with one cold and three warm runs, exercising the
bundled Desktop WebView host, observing cancellation with work in flight, observing real teardown
release, injecting a disk-write failure, exercising overview precedence, and re-running the probes so
the recorded reports carry the zero/negative observation.

## Handoff

The repair is implemented and its tests pass. Per the assignment, the findings above are marked
**implemented — pending independent verification**; they are not declared resolved on the
implementer's word. Q stays open, and N1 must not start before this gate repair is reviewed.
