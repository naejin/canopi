# Q admission completeness repair — implementation receipt

Status: evidence — admission completeness repaired across raw report → assembler → gate → CLI; **pending independent verification**. Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [admission-completeness prompt](q-admission-completeness-agent-prompt.md), [requirement contract](../../../scripts/raster-qualification/requirements.json), [review and debrief record](review-and-debrief.md).
Captured cycle evidence: [q-admission-completeness-cycles.txt](evidence/q-admission-completeness-cycles.txt).

This receipt covers a bounded repair of **evidence admission completeness**. It adds no engine,
transport, worker, decoder, slope, preparation or publication implementation; runs no qualification
experiment; changes no pin; and regenerates no private evidence.

## Baseline and delivery

| Item | Value |
| --- | --- |
| Baseline reviewed | `d963f755`, with `2c830b0d`, `0cc3b8fa`, `c94b7c7f` and the earlier stack preserved; UI `0e696722` untouched |
| Bead | `canopi-kqpp`, claimed; scope recorded in bd before coding; **left open** |
| Branch | `feature/raster-html-references` (not reset to main) |
| Owned files | `scripts/raster-qualification/{qualification_evidence.py,qualification_gate.py,measure.py,requirements.json}`, `tests/*`, this receipt, the captured evidence log and affected guidance |
| Not changed | production Rust/frontend, engine/pin selection, source builds, UI, skills, dependencies, private evidence |

### Skills read and what they constrained

| Skill | Files read | Constraint applied |
| --- | --- | --- |
| `tdd` | `SKILL.md`, `tests.md`, `refactoring.md` | One vertical RED→GREEN per behaviour from a scientifically coherent passing control through raw report → real assembler → real gate; expected sets come from the declaration, never recomputed from the code under test; each cycle's first RED cause was checked to be the intended one |
| `craft` | `SKILL.md` | Required sets parsed from declarations rather than inferred from supplied observations; absence of evidence never promoted to success; failure paths designed before the success path; one hard thing per function |
| `codebase-design` | `SKILL.md` | `SourceDocument` keeps evaluator-private facts beside the payload instead of mutating the caller's dict, so nothing internal leaks into a bundle; `admit_report` remains the seam and `evaluate` still decides eligibility |

No skills were created or modified. No subagents were used. All skills were available.

## Repairs

| Review ID | Defect at `d963f755` | Repair |
| --- | --- | --- |
| R4-01 | Fixture comparison was subset-only against an undifferentiated list: an unexpected fixture was ignored, a missing required fixture was not a gap, duplicates collapsed in a dict, and an omitted manifest silently skips the check. The CLI passed an empty fixture list, so correspondence could not be established at all | Coverage is judged against the declared per-role manifest: undeclared fixtures conflict, missing required fixtures are a gap, duplicated identities fail, digests must be well-formed SHA-256, and an absent manifest is a gap. `--fixture-manifest` wires the real CLI to the declaration; artifact-only reports keep their explicit no-raster policy |
| R4-02 | Correspondence iterated whichever records were supplied and took the expected pin from the record being checked, so an unrelated record satisfied a required artifact and a report could invent its own expectation | Coverage iterates the required measured artifact/version pairs and compares each against the pin read from the candidate manifest. Duplicate records fail; a differing pin fails; a revision mismatch needs built-artifact identity, matching source revision, recorded build command and digest, and a reported reproduction. Retained native GDAL keeps the explicit plan-authorized unpinned policy |
| R4-03 | No run identity, timestamp, age or digest check existed; freshness applied only to the bundle's own stamp, so reassembly refreshed old evidence | A nonempty `runId` and a finite, non-boolean `recordedAt` are required; age is checked against the shared seven-day limit with equality accepted; malformed or future times fail and a gap stays a gap. The bundle is stamped with the same injected evaluation time, and a source run's age is never refreshed. The digest is computed from the bytes read and a conflicting self-reported digest fails |
| R4-04 | A missing identity block returned early, discarding the report's own recorded failures and failed preconditions | Known failures, malformed structure, failed preconditions and duplicated identity keys are evaluated before identity, both failures and gaps accumulate, and `fail > inconclusive > pass` is applied once at the end. Legacy reports stay readable; declared negative-control scopes stay separate; a requirement drawing on several sources inherits any contributing source's failure without failing unrelated requirements |

### Same-class audit

* `Q-VALUE-1` is evidenced by both the numeric and the slope runs. It now combines both sources'
  admissions, so a failure in either reaches it. Which artifact a source is expected to have used now
  follows the **source**, not the requirement — admitting the numeric report on behalf of a
  multi-source requirement previously expected the slope's artifact.
* A report carrying no `result` field at all is a raw producer artifact, not corruption: it is a gap.
  A `result` that is present but unusable is a failure. This distinction keeps the recorded trace
  report in the gap class instead of manufacturing a `fail` for it.
* `SourceDocument` removes evaluator-private keys from caller payloads, so internal bookkeeping can no
  longer leak into a published bundle.

## Acceptance results

| Family | Case | Result |
| --- | --- | --- |
| Fixtures | Unexpected fixture, replaced hash, duplicate identity, malformed digest | conflict/gap as specified; no case passes |
| Fixtures | Missing required fixture; omitted manifest | inconclusive |
| Fixtures | Explicitly declared subset | passes |
| Artifacts | Unrelated correspondence, missing record, wrong version, duplicate records, revision mismatch with only `buildReproduced: true` | none passes |
| Artifacts | Matching-source control; fully evidenced pinned build; report-invented pin; absent declaration | pass / pass / non-pass / non-pass |
| Provenance | `recordedAt: 1`; missing runId; missing time; NaN/inf/bool; future; exactly at / just over the limit | as specified, at a fixed test time |
| Provenance | Reassembly | cannot change eligibility |
| Precedence | Failed report + missing identity; failed precondition + missing identity; source fail + stale timestamp; legacy passing report with no identity | failure retained with its reason; gap-only legacy is inconclusive |
| Invariants | Deleting evidence never improves eligibility; adding unrelated evidence never satisfies; adding a gap never downgrades a failure | held |
| CLI | Manifest loading, non-zero verdict exit, emitted blocking explanations, synthetic refusal | held through the real commands |

## Test evidence

```sh
python3 -m unittest discover -s scripts/raster-qualification/tests -v   # 168 passed
bash scripts/raster-qualification/tests/test_runner_exit.sh             # 8 passed, 0 failed
python3 scripts/check_docs.py                                           # 0 errors
git diff --check                                                        # clean
python3 -m py_compile scripts/raster-qualification/*.py ...              # OK
bash -n scripts/raster-qualification/run_all_experiments.sh              # OK
```

RED → GREEN per family, and the guard-removal sensitivity result for each guard, are recorded with
their commands and trimmed output in
[the captured evidence log](evidence/q-admission-completeness-cycles.txt). Every guard-removal check
was performed on an isolated copy of the module; the working tree was never mutated, and each was
detected by the corresponding tests.

No JavaScript file changed in this repair, so no `.mjs` syntax check was applicable.
`run_all_experiments.sh` was **not** run against the private evidence directory.

## Current evidence verdict

The existing reports were evaluated **read-only** into a fresh temporary root, with their digests
recorded from the bytes read; nothing was regenerated, replaced or synthesised.

**Corrected verdict: `inconclusive` — 12 of 12 requirements not passing. Exit status 1.**

The reports report passing runs but carry no identity block, so their route, environment, transport,
artifact and fixture provenance cannot be verified. Their `recordedAt` and `runId` are absent, which
under R4-03 is a gap rather than a failure. The absence of a `result` field on the trace report is
likewise a gap, so it does not manufacture a `fail`.

The prompt warned that failures previously hidden by missing identity might legitimately reappear. In
these reports none did: the honest classification of absent provenance is inconclusive, and inventing
a failure for it would misreport what the records say. That outcome is recorded as measured, not
forced toward either the previous twelve-inconclusive result or a failure.

Blocking requirement IDs: `Q-ART-1`, `Q-LOCAL-1`, `Q-PREP-1`, `Q-MEMBER-1`, `Q-VALUE-1`, `Q-CRS-1`,
`Q-CANCEL-1`, `Q-TEARDOWN-1`, `Q-FAILINJ-1`, `Q-HOST-1`, `Q-RES-1`, `Q-DISPLAY-1`.

## Limits of this repair

* This is a consistency boundary, not cryptographic attestation. The gate can show that evidence is
  present, self-consistent and matches the declared route and manifest; it cannot prove a measurement
  was physically performed. Confirming that the intended bundled Desktop assets were genuinely loaded,
  and that a caller-supplied host label is truthful, remain review steps.
* The existing reports cannot be made valid by reassembly. Qualifying Q needs new runs that record
  identity, run and time, which is a new qualification experiment outside this task.
* Synthetic gate fixtures remain labelled and are refused by default in `evaluate`; they carry no
  production qualification weight.
* No scientific contract, tolerance, budget, requirement ID or engine pin was changed.

## Unavailable evidence

No Desktop WebView, WebKit, macOS or Windows host run exists. No report carries identity, a run
identifier or a recorded time, so the corrected verdict above is the strongest conclusion those
records support. The RED/GREEN and sensitivity observations are captured in the evidence log linked
above rather than left unrecorded.

## Recommended follow-ups (not implemented)

* Extend the probe drivers to emit the identity block, a run identifier and a recorded time on every
  report. Success criterion: a re-run's reports pass `admit_report`, and the previously passing
  requirements reach `pass` on admitted evidence.
* Promote the requirement/role declaration (`requiredArtifacts`, `fixtureManifest`, `declaredPins`)
  into the contract file if a third consumer appears; two call sites do not yet justify moving it.

## Handoff

Repairs are recorded as **implemented, pending independent verification**, not resolved. Q stays open,
the prototype-approval and engine-decision gates remain with the user, and **N1 must not start**
before this repair is independently reviewed.
