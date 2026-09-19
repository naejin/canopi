# TypeScript qualification decision path — migration receipt

Status: evidence — migration and both repair rounds delivered; complete decision path remains unaccepted. Historical implementation claims below are not acceptance. Reassessment `55d6f485` was reviewed; the [reviewer-owned design](q-typescript-reassessment.md) and [implementation handoff](q-typescript-implementation-agent-prompt.md) replace the unresolved proposal. No new implementation is claimed; Q remains unqualified.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
Acceptance contract: [q-admission-acceptance.md](q-admission-acceptance.md) — C1–C8, unchanged.
Current guidance: [implementation plan](../raster-data-analysis-rework.md#qualification-tooling-language-and-migration), [review evidence](review-and-debrief.md), [LiDAR guide](../../agent/lidar.md).
Assertion-to-evidence mapping: [assertion_evidence_map.md](../../../scripts/raster-qualification/assertion_evidence_map.md).

This receipt covers one bounded migration slice: replacing the raster qualification **decision path**
with TypeScript. It runs no qualification experiment, selects or builds no engine, changes no
requirement ID, pin, tolerance or budget, and deletes no Python. Harness acceptance does not qualify
an engine, and accepting this migration does not accept Q.

## Baseline and delivery

| Item | Value |
| --- | --- |
| Starting revision | `3a7ec9eb` (`a874dec0`), preserving the R5 and C1–C8 stacks and UI `0e696722`; branch not reset to main |
| Bead | `canopi-kqpp`, claimed; scope recorded in bd before coding; **left open** |
| Branch | `feature/raster-html-references` |
| New source | `scripts/raster-qualification/ts/` — 2,632 lines of TypeScript across 14 source modules plus 11 evidence modules |
| New tests | 2,309 lines across 7 test modules; 74 tests |
| Compiler | TypeScript 5.9.3 from `desktop/web/node_modules/.bin/tsc`, verified present before use |
| Runtime | Node v22.22.0, using the built-in `node --test` runner |
| Direct dependencies | **none** — no `dependencies` or `devDependencies` are declared; the emitter addresses the compiler and `@types/node` already installed for `desktop/web` through `typeRoots` |
| Python | frozen for comparison; not repaired and not deleted |

### Skills read and what they constrained

| Skill | Files read | Constraint applied |
| --- | --- | --- |
| `tdd` | `SKILL.md` | One vertical slice before breadth: a single raw-report-to-CLI requirement path with a passing control, then a RED/GREEN per boundary family. Expected values are hand-written literals in `tests/fixtures.ts`; no oracle is computed by the module under test. The whole-contract control is per requirement rather than whole-bundle, because six requirements have no producer and asserting a whole-contract pass would have required fabricating observations |
| `craft` | `SKILL.md` | Error paths first: an absent source, a corrupt source, an unreadable request, an unwritable destination and a malformed declaration were designed before the success path. Parse-don't-validate at one seam (`sources.ts` + `json.ts` + `report.ts`), then pass validated shapes inward. No dependency added for JSON or CLI parsing. Blast radius traced through the runner before changing its final step |
| `codebase-design` | `SKILL.md` | One authoritative operation (`runQualification`) behind a small interface; `Findings` in `verdict.ts` is the single reduction, so "failure outranks gap" is a property of the code rather than a rule each caller remembers; `SourceView` is the seam a mapping sees, so a mapping cannot re-read a file and decide on different bytes; `sourceAdmitted` keeps "may this source contribute" separate from "is the requirement satisfied" |

No skills were created or modified. No subagents were used.

## Behavioural inventory

The `desktop/web` compiler and Node types were verified before use. The existing Python suite was run
first without experiments (261 tests, 13/13 stub-runner checks, docs and diff clean).

The five review counterexamples were reproduced against the Python baseline **before** writing any
TypeScript, so the replacement was specified from observed behaviour rather than from the Python
source:

| Reproduction at `3a7ec9eb` | Python baseline | TypeScript |
| --- | --- | --- |
| `passing_evidence()` with admission labels but no supporting provenance | overall `pass` | no bundle input exists; a request naming absent sources is `inconclusive` |
| admission `fail`, `sourceAdmitted: true`, all labels pass | requirement `pass` | admission is recomputed from bytes; a report whose own run failed fails its requirement |
| bundle timestamp NaN | passes | refused as malformed JSON, exit 2 |
| unadmitted entry with `observed: ["bad"]` | `AttributeError` | structured diagnostic, no crash |
| two candidate records each missing a different counter | `pass` | `inconclusive`, naming both incomplete runs |
| 100 ms then 900 ms sampling | `pass` | `fail` in both orderings |

## Architecture

One parse, one reduction, one authority.

```
bytes ──▶ json.ts (duplicate keys, non-finite tokens)
      ──▶ sources.ts (read once, hash those bytes, absent≠corrupt)
      ──▶ report.ts (container kinds, strict leaves, keyed records)
      ──▶ admit.ts (identity, provenance, fixtures) ──▶ Findings
      ──▶ evidence/*.ts (one mapping per requirement)
      ──▶ reduce.ts (per-run, then across runs)
      ──▶ decide.ts (one requirement) ──▶ qualification.ts (one decision) ──▶ cli.ts
```

| Decision | Why |
| --- | --- |
| The CLI takes a contract, declarations and **raw source paths**; there is no bundle input | A serialized bundle is a diagnostic output, not evidence. With no way to present an admission label as proof, the reviewed "labels only" and "admission says fail but claims admitted" attacks have no surface |
| `SourceDocument`-equivalent reads each source exactly once and hashes those bytes | Admission, digesting and every observation share one snapshot, so a source cannot be read twice into two readings within one decision |
| `verdict.ts` owns the only reduction | `reduce(failures, gaps)` is called at every layer, so precedence cannot drift between them |
| `sourceAdmitted` is stored separately from the reduced verdict | A requirement whose admitted observation failed is a finding about the engine; a source that could not be admitted is a finding about the record. Collapsing them reports a measured violation as unusable evidence |
| Expectations come from `declared/route.ts`, keyed by role | A caller cannot withdraw a comparison by omitting it, and a report cannot nominate what it is checked against |
| Seven assertions are hard-coded inconclusive with a stated reason | No producer emits them. Recording the reason keeps a capability gap distinguishable from a gate defect |
| `legacyProducerCommand` labels the recorded producer | The tool never runs it; the name says so, so a reader cannot mistake provenance for a call |

## Contract coverage

Every required assertion in `requirements.json` (68 across 12 requirements) is mapped. Tests are
grouped by matrix row in `tests/boundaries.test.ts`; the end-to-end control is in
`tests/counterexamples.test.ts`.

| ID | What the TypeScript path does | Tests |
| --- | --- | --- |
| C1 | `ok`/`met` accept only a real boolean; a present null is malformed while an absent key is a gap; duplicate assertion and precondition names are rejected | `C1` cases ×9 leaves ×2 leaf kinds, duplicate cases |
| C2 | Every report container kind is validated at the parse seam; absence and corruption stay distinct; a truncated, empty, non-object or non-finite report is a failure naming the source | per-role removal ×9, wrong nested shapes ×13 fields ×6 shapes, four corruption shapes, one genuine-absence case, undeclared role |
| C3 | Experiment, route, environment, host, transport and artifact expectations derive from the role; a recorded disagreement fails and a missing record is a gap | wrong experiment/route/environment/artifact/hash/identity ×6, transport mismatch, missing declaration |
| C4 | The window bound is decided from recorded sizes; artifact correspondence from the inventory; a missing window is a gap and prose cannot substitute for a record | window absent/over-limit/pass, correspondence note removed, note without record |
| C5 | Each plan budget is enforced independently on sampled candidate records only; counters are never unioned across incomplete runs; a measured violation survives an unrelated gap | four over-budget counters, five missing counters, fault+gaps, 900 ms stall in both orders, five display completeness mutations, coarse sampling |
| C6 | A contract is validated before use; unsupported versions, duplicate ids, non-boolean `required`, empty assertions and malformed shapes are refused with exit 2 and no decision document | seven malformed contracts, unsupported version, no bundle surface |
| C7 | A decision is written only when the output is writable; exit 0 only on full eligibility; every malformed request is a structured diagnostic | malformed requests ×6, missing request, unwritable destination, non-eligible contract |
| C8 | Four fault kinds crossed with four independent gap kinds in both orders, plus remove-evidence and add-evidence invariants | 4 faults, 4 gaps, 16 pairs × 2 orders, monotonicity |

### Deliberate semantic corrections

These differ from the Python baseline on purpose, and each is a repair the review asked for:

1. **A present `null` boolean leaf is invalid, not a gap.** Python read a missing or null `ok` as an
   absent outcome. The schema for that leaf is boolean, so a null that is *present* is malformed.
2. **A source that is present but unreadable is corruption.** Python reported a truncated report with
   the "is missing" wording, so corruption and absence were indistinguishable to a reader.
3. **Missing required identity fields are validated at the parse seam.** `runId` and the other
   required identity fields are checked with the report's shape, so a requirement cannot be satisfied
   while its source never recorded a run.
4. **Incomplete resource records do not combine.** Counters are reduced per sampled record; Python
   unioned across records, which is how two incomplete runs produced a passing resource requirement.
5. **Sampling is a bound, not a preference.** A run sampled more coarsely than the plan allows fails,
   rather than being skipped in favour of the first record that looked compliant.
6. **A recorded violation survives an unrelated gap**, including the display stall, in either order.

### Unsupported capabilities, kept blocked

Seven assertions are permanent gaps because no producer emits them. The decision reports each with
its reason; the tests assert they are never promoted by adjacent evidence:

| Assertion | Requirement | Why it remains a gap |
| --- | --- | --- |
| `overviews-do-not-resurrect-replaced-pixels` | Q-MEMBER-1 | no probe exercises overview precedence |
| `required-fixture-classes-covered` | Q-VALUE-1 | no producer reports per-fixture-class coverage |
| `cancellation-issued-while-work-in-flight` | Q-CANCEL-1 | the recorded probe slices a resident buffer, not the plan's route |
| `concurrent-in-flight-work-measured` | Q-CANCEL-1 | the probe counts completed operations, not concurrent in-flight work |
| `teardown-observably-releases-resource` | Q-TEARDOWN-1 | release is asserted from a flag, not observed |
| `disk-write-failure-exercised` | Q-FAILINJ-1 | no probe injects a disk-write failure |
| `observed-in-desktop-webview` | Q-HOST-1 | no Desktop WebView run exists |

Closing these needs new qualification experiments, which this slice is not authorized to run.

## Verification

All commands run from the repository root.

```sh
# Build from source only, with no stale emitted files present
desktop/web/node_modules/.bin/tsc -p scripts/raster-qualification/ts/tsconfig.json
# exit 0

# Emitted tests
node --test "scripts/raster-qualification/ts/dist/tests/*.test.js"
# tests 74 | pass 74 | fail 0

# The retained Python regressions
python3 -m unittest discover -s scripts/raster-qualification/tests -v
# Ran 261 tests ... OK

# Stub runner, now routing the decision step to TypeScript
bash scripts/raster-qualification/tests/test_runner_exit.sh
# runner exit handling: 14 passed, 0 failed

# Repository gates
python3 scripts/check_docs.py     # 0 errors
git diff --check                  # clean
bash -n scripts/raster-qualification/run_all_experiments.sh   # OK
node --check <each changed .mjs>  # no .mjs changed
```

A clean build was verified with `dist/` removed first, so the emitted tool has no dependence on stale
output. `dist/` is ignored by the existing `dist/` rule in `.gitignore`; only source and configuration
are committed. No Rust test was required because no Rust file changed.

### Production acceptance: no Python in the decision path

```sh
grep -rn "python\|child_process\|spawn\|exec" scripts/raster-qualification/ts/src/
```

The only matches are `legacyProducerCommand` documentation strings that record which producer wrote a
report. There is no Python import, no subprocess call, and no shell-out anywhere in the TypeScript
decision path. The runner's final step invokes `node .../dist/src/cli.js` directly; the measurement
steps above it remain Python producers and are labelled as legacy at the call site.

## Adversarial review

The `tests/adversarial.test.ts` module is the separate adversarial pass. Each case tries to cause a
false pass, hide a failure or crash the **real emitted CLI** as a subprocess; nothing is mocked.

Cases attempted, with results:

| Attack | Result |
| --- | --- |
| report claims `pass` while recording a failure | fails, and the recorded failure text reaches the reader |
| `result` absent with recorded failures | fails, naming the recorded failure |
| failed assertion | fails, naming the assertion |
| empty assertion list with `pass` | does not qualify |
| every failure declared in a negative-control scope | does not excuse the mandatory positive assertion |
| absurd counters (`MAX_SAFE_INTEGER`, `1e308`, `-1`, `2.5`, `"1024"`, `null`) | none accepted |
| non-finite counters (`1e999`, `NaN`, `-Infinity`) | malformed input, exit 1, no crash |
| a bundle offered alongside the sources | ignored; the decision comes from the sources |
| a path traversal in a declared source path | read as declared; nothing embedded in a document is followed |
| unwritable destination | exit 2, clear stderr, no `"out"` claim |
| deeply nested array in a consumed field | no crash, no pass |
| unreadable source file | corruption, not absence; no crash |
| every contract requirement id | present in the decision, count matches |
| a runner-style directory decision | byte-identical decision on a rerun at a fixed time |

**No counterexample was found in the TypeScript decision path.** The adversarial module did find one
defect in the agent's own fixtures: an earlier gap case (`removeFixtureManifest`) mutated a
requirement that does not consume the fixture manifest, so it asserted an interaction that cannot
occur. It was replaced with a gap on a path the requirement genuinely reads.

### Guard-removal sensitivity

Each probe reverts one guard, rebuilds, runs the emitted suite, and restores. Reported honestly,
including the zero result.

| Probe | Guard reverted | Failing tests |
| --- | --- | --- |
| S1d | the recorded-failure reason text replaced with a generic one | **0** |
| S1e | the recorded-failure reason dropped entirely | 2 |
| S2 | failed assertions no longer fail | 0 |
| S3b | duplicate JSON keys accepted | 3 |
| S4 | non-finite tokens accepted | 3 |
| S5 | boolean leaves coerced by truthiness | 2 |
| S6 | window bound back to absence-of-failure | 6 |
| S7 | per-run sampling replaced by first-record | 1 |
| S8 | display stall demoted by an unrecognised field | 1 |
| S9 | resource budgets not enforced | 8 |

**Two zero results are reported rather than hidden.** S1d showed that the suite checked the *verdict*
but not the *reason text* for a discarded failure, so the failure could be recorded without being
explained; reason-preservation tests were added and the re-probe (S1e) bites with 2 failures. S2 shows
the failed-assertion guard is not load-bearing on its own: the `result: "pass"` contradiction check
and the `Findings` reduction still catch that case, so removing one guard leaves the suite green. That
is redundant defence, and it is recorded as such rather than counted as coverage.

## Read-only reconciliation of the existing records

The old reports were evaluated read-only into a fresh temporary root, with no experiment run and no
report rewritten. Source digests (sha256, first 16 hex):

| File | Digest | File | Digest |
| --- | --- | --- | --- |
| `q1-artifacts.json` | `14125f911bf6f8e5` | `q2-numeric.json` | `b212325ac143cc12` |
| `q2ranged.json` | `ef0959bdea7afa2f` | `q3-members.json` | `4fdb526ba469c012` |
| `q3-prepare.json` | `7b776e72c7d4cb87` | `q4-crs.json` | `7d6828ef92cddfe1` |
| `q4-slope.json` | `b2a7e073892decbc` | `q5-lifecycle.json` | `eb4245e6d7c49fb0` |
| `q6-resources.json` | `86730de8e55d85c9` | `q6-trace.json` | `567abb94e612f502` |
| `ledger-q2ranged.json` | `3785f911bf87e7ad` | | |

```sh
node scripts/raster-qualification/ts/dist/src/cli.js \
  --reports <fresh-root>/reports \
  --contract scripts/raster-qualification/requirements.json \
  --pins scripts/raster-qualification/candidates.json \
  --now 1760000000 --out <fresh-root>/ts-decision.json
# exit 1
# verdict: fail — 1 fail, 11 inconclusive
```

The TypeScript path reproduces the Python baseline verdict **for all twelve requirements**, including
`Q-DISPLAY-1` failing on the recorded trace's run counts. That agreement is evidence of a faithful
port, not of correctness: the Python output is not an oracle, and where the two disagreed the review's
findings, not Python, would have decided. No target verdict distribution is prescribed, and these
records cannot be made valid by re-evaluation.

## Measurements for the debrief

| Measure | Value |
| --- | --- |
| Source size | 2,632 lines TypeScript (14 core + 11 evidence modules) |
| Test size | 2,309 lines, 74 tests |
| Python replaced for comparison | 3,650 lines (`qualification_evidence.py` + `qualification_gate.py`) |
| Direct runtime dependencies | 0 |
| Authoritative evaluator entry points | 1 (`runQualification`); `prepare` and `decideRequirement` are its internal seams |
| Contract assertions mapped | 68 of 68; 7 are explicit permanent gaps |
| Independent-review rounds | 0 so far — this receipt awaits the first |
| Escaped invariant failures found by the adversarial pass | 0 in the decision path; 1 in the agent's own fixtures |
| Sensitivity probes | 10 run, 2 reported as zero results |
| Elapsed effort / cost | not measured; not inferred from test count |

Comparison with the Python baseline, stated carefully: the Python implementation had two modules and
multi-source aggregation spread across a 2,980-line admission module; the TypeScript path has one
reduction (`verdict.ts`) and one authority (`qualification.ts`). The five review counterexamples all
reproduced against Python and none against TypeScript. That is consistent with the hypothesis that one
parsing/reduction path and per-run reductions reduce escaped false passes, but it is **not proof**:
the TypeScript path was written knowing those five counterexamples, and Python was not. Language choice
and architecture are separable, and this receipt does not claim the port succeeded because of the
language.

## Residual gaps and limitations

**Harness blockers: none known.** All gates pass, every contract assertion is mapped, and the
adversarial pass found no false pass, hidden failure or crash.

Non-blocking findings for separately scoped work:

* **Seven assertions remain permanent gaps** because no producer emits them (table above). Closing
  them needs new experiments, which this slice is not authorized to run.
* **Python experiment orchestration, fixture/bootstrap/server and reference helpers remain.** The
  plan stages their replacement separately. The decision path no longer depends on them; the runner's
  measurement steps still do, and are labelled legacy.
* **The Python decision path remains in the tree**, frozen and unrepaired, as the plan requires. It is
  no longer the qualification authority: the runner's final step is TypeScript.
* **Legacy CLI compatibility is explicit rejection, not silent acceptance.** `measure.py gate` still
  exists and still runs; it is no longer wired into the runner. A caller invoking it directly gets the
  frozen Python decision and must be told it is not the authority. Recording that message in
  `measure.py` is deferred because this slice must not repair Python.
* `temporaryDiskHighWaterBytes` is **recorded and reported, not gated**, because the plan states a
  staging and free-space policy rather than a universal byte cap. Inventing a cap would be inventing a
  requirement. The decision reports the value and its per-run attribution.
* The **typeRoots coupling** to `desktop/web/node_modules` means the harness cannot be built without
  the frontend's install. That is deliberate: it avoids a new dependency. If a clean checkout without
  `desktop/web` installed must build this tool, that is the specific dependency need to raise.

Limits of what this slice establishes:

* The decision path decides what the recorded evidence supports. It cannot prove a measurement was
  physically performed or that a caller-supplied host label is truthful.
* The banner emitted for a legacy `measure.py gate` caller is not yet present.
* The runner's decision routing is proven with deterministic stubs; no private experiment pipeline was
  executed.

## Unavailable evidence

* No Desktop WebView, WebKit, macOS or Windows run exists, so Q-HOST-1 and the platform requirements
  are untouched.
* No new qualification experiment or probe run was performed, and no engine was downloaded, built or
  selected.
* `run_all_experiments.sh` was not run against the private evidence directory; the runner's behaviour
  is exercised only through isolated deterministic stubs in fresh temporary roots.
* Cycle, sensitivity and adversarial observations are recorded here from captured session output
  rather than a committed raw transcript; every command above is reproducible from the stated inputs.
* Elapsed cost and time were not measured and are left unknown.

## Handoff

This migration slice is recorded as **implemented, pending independent verification**. Q stays open and
unqualified, the prototype-approval and engine-decision gates remain with the user, and **N1 must not
start** before this slice is independently reviewed. The
[execution prompt](q-typescript-agent-prompt.md) is retired by this delivery; the
[acceptance contract](q-admission-acceptance.md) is retained unchanged as the basis for that review.

Per the plan, the next migration phase — replacing remaining Python experiment orchestration,
fixture/bootstrap/server and reference helpers — requires separate authorization after this slice is
independently accepted. Deletion of superseded Python is explicitly out of scope until then.


---

# Round 1 — repair against the standing review at `abf502b6`

Status of this round: **implemented, delivered for independent review**. Round 0 was the baseline
review. Starting revision `abf502b6` / `df54b314`; one consolidated delivery, one receipt section, no
per-defect prompts. Nothing in this section is accepted on the implementer's authority.

Captured reproduction, mutation and sensitivity log:
[q-typescript-repair-round1.txt](evidence/q-typescript-repair-round1.txt).

## What was retained

The architecture is unchanged: one parse, one reduction, one authority; no bundle input; no Python in
the decision path; the runner's TypeScript decision routing; source-byte parsing and recomputation
rather than bundle trust; the strict boolean and duplicate-key regressions; and the independently
verified R5 behaviors. No file was rewritten wholesale and no second evaluator was introduced.

## Family responses

| Family | Response | Tests |
| --- | --- | --- |
| **T1** keyed identity | `prepare` counts every source role before indexing and rejects any role claimed more than once, omitting it from the index. The ambiguity reaches the requirement as a *failure* — two sources claiming one role is invalid input, not missing evidence. Order no longer matters, in either direction. | `t1DuplicateRoles.test.ts` (4); Q-VALUE-1's two-source case in `adversarialRound1.test.ts` |
| **T2** per-run completeness and precedence | `incrementalPeakRssMiB` joined the mandatory per-run observations; every leaf is classified as usable, present-but-unusable (fails) or absent (a gap), so an explicit `null` fails and the sampling gap names its field; the budget check reads **every** record that recorded the counter, so a measured over-limit value survives a sampling gap in the same record. | `t2RunReduction.test.ts` (10) |
| **T3** required artifact coverage | The three artifact assertions iterate the *declared* required artifacts and look up each one's own record instead of prefix-matching the supplied list. `q3prepare`, `q4slope` and `q4crs` now declare native GDAL; for those retained roles the name must match while the version is whatever the run discovered, so `gdal@3.9.0` is recorded and `unrelated-engine@999` fails. | `t3ArtifactCoverage.test.ts` (11) |
| **T4** sidecar evidence | Present-but-malformed digests fail while absent ones are gaps; hash equality is no longer treated as survival evidence, so a `measured` record must observe that the sidecar was present before and after; `absent`/`false`, a conflicting declared hash, a non-object record and unrecognised or absent policies each get their own treatment. | `t4Sidecar.test.ts` (12) |

## Additional T2 scope named by the review

The plan's 512 MiB display disk-cache bound and the staging/free-space policy have **no producer
observation**. Rather than invent a field name, the requirement carries an explicit, unconditional
gap: a caller supplying `displayDiskCacheBytes` at 1 GiB, 1 or 0 leaves the requirement inconclusive,
so it cannot be moved in either direction by inventing a key.

Recorded consequence: `Q-RES-1` moved out of the supported set in the test fixture. Its five contract
assertions are all decidable and correct; the *requirement* is permanently a gap because one
dimension of the plan's budget is unmeasured. Declaring it supported would have required fabricating
that observation.

## Sweep, adversarial review and sensitivity

- **Mutation sweep** (`mutationSweep.test.ts`, 32 mutations): every mutation declares both the target
  assertion's verdict and the requirement verdict, then every unaffected requirement is checked
  separately. Three defects in the agent's **own expectations** were found and are recorded in the
  log — including one case that asserted an interaction that cannot occur, and one that claimed a
  prefix-based validation record could not cover its prefix.
- **Adversarial review** (`adversarialRound1.test.ts`, 9 cases): sibling paths across other keyed
  collections, other per-run fields, other mappings, the programmatic entry point versus the CLI, an
  empty source list and a directory as a source path. One further fixture defect was found and fixed.
- **Sensitivity** (11 guard-removal probes): **G4 was a genuine gap in the agent's tests** — reverting
  the budget check to sampled records left the suite green because every over-limit case had a second
  healthy run. Two cases were added and the re-probe now fails one test. G3 is reported as a build
  failure rather than counted as coverage.

No counterexample in the production code was found by the sweep or the adversarial pass beyond the
T1-T4 families, and none of the reviewed examples reproduces after the repair.

## Verification and reconciliation

All gates green: `tsc` from an empty `dist/` (nothing stale), 127 emitted tests, 261 retained Python
regressions, 14 stub-runner checks, 0 documentation errors, clean `git diff --check`, shell syntax OK.
No Python decision-path file changed and no private evidence was touched.

Read-only reconciliation through the emitted CLI at a fixed time gives **the same per-requirement
verdicts as round 0** — `fail`, 1 fail and 11 inconclusive. That is expected: every T1-T4 defect
requires a duplicate source, a malformed or incomplete per-run record, a missing artifact record or
an unsupported sidecar policy, and these records supply none of those. No target distribution is
prescribed.

## Responses to the standing review

The review's four families are addressed at family scope rather than example scope, and its two
additional T2 items (display disk cache and the staging policy) are answered with an explicit gap
rather than an invented cap. The review's protocol notes are respected: one consolidated delivery,
one receipt section, no acceptance written on the reviewer's behalf, and no repair round inferred from
silence.

**Round 1 is complete and delivered. It awaits independent review.**

---

# Round 2 — repair against the Round 1 independent disposition

Status of this round: **implemented, delivered for independent review**. Round 1 was delivered at
`73a7b214` and independently reviewed at `8ab1fff7`, which retained specific repairs and listed six
remaining families (R1-A to R1-F). This round addresses all six at family scope. Nothing here is
accepted on the implementer's authority, and Round 2 is the final round covered by the standing
prompt.

Captured reproduction, sweep and sensitivity log:
[q-typescript-repair-round2.txt](evidence/q-typescript-repair-round2.txt).

## What was retained

No architecture change, no language change, no second evaluator. Retained unchanged: one parse, one
reduction, one authority; no bundle input; recomputation from source bytes rather than bundle trust;
the runner's TypeScript decision routing; the strict boolean, duplicate-key and non-finite-token
regressions; the previously accepted R5 behaviors; and the whole of the Round 1 repair set — duplicate
source roles rejected before indexing, mandatory per-run memory, three-way leaf classification,
declaration-driven artifact records, and the sidecar survival distinction.

## Family responses

| Family | What was wrong | Response |
| --- | --- | --- |
| **R1-A** declaration correspondence | The declared pins reached admission but were never consulted, so a record's two own revision strings agreeing was mistaken for pin verification. A correspondence record for any version passed, and a wrong-version duplicate prepended to `verifiedArtifacts` was silently ignored | Correspondence is compared against the declaration at three independent points: the record's version must be the one the route declares for that artifact, its claimed pin must equal the declared pin, and its built revision must equal that pin. An artifact outside the required set fails, a missing record for a required artifact is a gap, duplicate verified-artifact identities fail before indexing, and an absent pin declaration blocks correspondence rather than passing it. `SourceView` now carries the declared expectations, so a mapping consults an independent declaration rather than a second input path |
| **R1-B** failure retained before gaps | A 900 ms cadence violation was lost when the same run omitted `sampleCount`; a 2048 MiB peak was missed when a leading non-record shifted the index pairing; a missing observed hash softened a recorded non-survival; and a declaration gap hid a conflicting fixture hash | The sampling reduction collects violations and gaps independently and reduces them once, so a violation is never replaced by a gap. The memory reader keys off the record itself instead of pairing two differently-filtered lists by position. A present `after: false` is read before any missing-hash gap, and a `before: false` fails likewise. A partly incomplete fixture declaration keeps its resolved members, so observed fixtures are still compared against what the declaration did resolve |
| **R1-C** scientific sufficiency | A run reporting one rendered tile of 999 requests passed; all-negative latencies passed as fast; a ledger accounting for zero bytes over zero requests corroborated nine validated windows; a 0.5-cell window dimension was compared as though it were a size; HTTP Range passed the proposed-local-transport assertion; and preparation mapped the contract's "tiled and bounded" obligation onto the producer's tiling check alone | Render counts must reconcile with requests and page errors must be empty; negative latency samples fail; the ledger must account for the windows the report claims to have validated; window dimensions must be whole positive numbers of cells; the declared transport is now the plan's scoped **local bridge** rather than `http-range`, with an HTTP-only measurement failing the assertion and naming what it measured; and the preparation obligation combines the producer's separate tiling and block-bounding checks |
| **R1-D** admission and policy boundary | A precondition that recorded no outcome passed; a null container passed as absent; any report-chosen prefix could exempt a positive failure; an envelope could contradict its own identity; `1e999` passed because it decodes to `Infinity`; and `after: true` without `before` passed as preservation | A precondition without `met` blocks; `preconditions: null` and `failures: null` are malformed rather than absent; a negative-control scope must be an explicit `expected-rejection:` declaration rather than an arbitrary substring; the envelope's experiment label must agree with the identity block; numeric overflow is detected after decoding as well as for bare tokens; and preservation requires **both** the before and after observations |
| **R1-E** synthetic isolation | `synthetic: true` published an overall pass on a reduced contract, and an unknown source role threw from the programmatic path instead of returning a structured outcome | The synthetic marker blocks a qualifying verdict on the decision itself, independently of whether unrelated permanent gaps happen to be present. Unknown source roles produce a structured error outcome with exit code 2 from the programmatic entry point, so it agrees with the CLI |
| **R1-F** output safety and diagnostics | `--out` pointing at an input overwrote that report, and a malformed request exited 2 with the diagnosis only on stderr | The destination is compared against every file the run reads and a collision is refused with the source bytes intact. A refused input writes an explicitly labelled `kind: "rejected-input"` document when the destination is writable, carrying no requirement verdicts, so it cannot be mistaken for a decision; a collision suppresses even that |

## The transport declaration, and why it mattered

The review's R1-C item about HTTP Range was not a missing comparison but a **wrong declaration**. The
plan states that numeric windows must be read "via the intended Desktop/native/worker bridge", that
"Q must qualify this local bridge, not just HTTP COG access", and that a remote HTTP demo "does not
qualify local access". The route declaration nonetheless expected `http-range`, so the comparison ran
and passed against the very capability the plan rules out.

Correcting the declaration exposed the vacuity: two committed tests had been written around the wrong
expectation and had to be corrected to the plan's semantics rather than the reverse. The control
fixture now declares the local bridge, and an HTTP-only measurement fails the assertion with a reason
naming the observed transport.

## Verification and reconciliation

All gates are green: `tsc` from an empty `dist/` (nothing stale), 176 emitted tests (from 127), 261
retained Python regressions, 14 stub-runner checks, 0 documentation errors, clean `git diff --check`,
shell and `.mjs` syntax OK. No Python decision-path file changed and no private evidence was touched.

Read-only reconciliation through the emitted CLI at a fixed time is unchanged from Round 1: `fail`,
1 fail and 11 inconclusive, with no per-requirement difference. Every Round 2 repair requires a
duplicate declaration, an incomplete per-run record, a self-consistent but undeclared revision pair, a
non-reconciling render or a malformed container, and these records supply none of those. No target
distribution is prescribed.

## Reported honestly

- **Two guard-removal probes are zero results and one measurement was initially wrong.** The pin
  comparison (H1) does not fail the suite alone because the built-revision comparison immediately
  after it catches the same inputs — the two are load-bearing only as a pair, which a combined probe
  confirms (H1b fails six tests). One earlier probe read `process.stderr` output that the test runner
  captures, so a first reading of "the check never fires" was a measurement artifact and was
  re-measured before being believed.
- **Two committed tests were corrected rather than the code.** They had encoded the wrong transport
  expectation, so they were asserting the defect. Both are now written against the plan.
- The sweep remains finite. It is not proof against all inputs, and this receipt does not claim
  otherwise.

## Responses to the standing review

All six families are addressed at family scope, and the review's two precision notes are honoured: the
resource mapping's assertion verdicts are validated individually as well as the requirement verdict,
and the staging/free-space policy is recorded as its own missing observation rather than being folded
into the display disk-cache reason.

**Round 2 is complete and delivered. It awaits independent review.**

## Reassessment closure of this receipt (documentation only)

The Round 2 review was delivered as **not accepted**, and the two-round repair authority is exhausted. This receipt therefore closes without a further implementer repair: the migration it reports is preserved, and the remaining work is a design decision that belongs to the user.

The user-authorized [reassessment](q-typescript-reassessment.md) at `82184e6c` re-reproduced the four Round 2 families at the same implementation revision, verified the emitted build against a fresh compilation of the inspected source, and added two demonstrated families this receipt never covered (`evidence/resources.ts` route attribution and the `--reports`-mode publication path). It also found that two of the TypeScript behaviours under review are regressions against the retained Python gate rather than new specification gaps: the per-run rendered-versus-sample reconciliation and the undeclared-role rule both still exist and are tested in `qualification_evidence.py` and `tests/test_qualification_gate.py`. No claim in this receipt is withdrawn; the receipt simply does not establish those two behaviours.

Nothing further is implemented, and no migration step is authorized, until the user has independent design review of that document. `canopi-kqpp` stays open.
