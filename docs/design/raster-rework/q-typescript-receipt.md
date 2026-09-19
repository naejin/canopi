# TypeScript qualification decision path — migration receipt

Status: evidence — bounded NC1–NC2/MR1 slice independently accepted at `579880be`; the agreed repair loop is closed. See [independent acceptance](q-typescript-review.md#numeric-completion-independent-acceptance) for coverage and limits. The Desktop bridge transport slice at `fab0c381` reports measured Q-LOCAL-1 and Q-HOST-1 observations and awaits one independent review; Q remains unqualified. Historical delivery claims below are revision-specific, not full-Q acceptance.
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

## Implementation of the settled design (S1–S5)

Revision `5878f80e` (S1 `2b0a02c7`, S2 `70e51534`, S3 `1fb1d064`, S4 `8a85fc3a`, S5 `567e6d29`).
This section is the implementer's report for the [decision-complete
design](q-typescript-reassessment.md); it is a claim awaiting independent review, not acceptance, and
it does not qualify Q.

### What changed

| Phase | Delivered |
| --- | --- |
| S1 | `publication.ts` owns every write: an existing destination is refused whatever it looks like, a destination that is or resolves to a known input is refused even when that input is absent, and an unrecoverable read-set makes the requested destination unusable. Documents are serialized once and published by hard-linking a complete staging file, so a competing creator causes a refusal rather than truncation; there is no overwriting fallback. Refusals and rejected requests publish a `kind:"rejected-input"` diagnostic into a fresh exclusive directory beneath the destination parent, with the real path on stderr, and state explicitly when even that failed. `cli.ts` recovers the read-set before any validation, from the same bytes it parses; the runner refuses to start when its final output already exists, before any producer step, and no longer deletes stale reports. `DECISION_VERSION` is 2 |
| S2 | `evidence/checks.ts`: each check evaluates one independently decidable fact over the admitted snapshots and returns a required outcome (`satisfied`, `evidence`, `failures`, `gaps`). The driver validates the outcome, the evidence references and the declared inventory, then derives verdicts only through the existing reduction. A missing or malformed outcome, a thrown check, an unregistered or duplicate id, a required check with no implementation, or a contradictory success is a structured internal-check defect that cannot pass, does not stop its siblings, and exits input-class. The whole display requirement is fourteen checks |
| S3 | Artifacts and resources migrated: present versions and claimed pins are compared independently of missing siblings, the built revision is satisfied by the declared pin or by a fully evidenced reproducible build whose digest chain reaches the bench-verified record and every consuming source, and route attribution accepts only explicit role labels. Every budget is enforced per record; the plan's 512 MiB disk-cache bound and staging policy remain stated requirement gaps |
| S4 | The remaining nine requirements migrated through shared record readers, so no mapping writes a verdict of its own. Unsupported obligations are declared with their reasons; the cancellation control stays a rejection control |
| S5 | The registry tag and legacy adapter are removed; `CHECK_INVENTORIES` exposes the declared inventory for coverage tests. Guards added: contract/inventory coverage, one-decided-or-unsupported, no direct verdict writer outside the driver, receipts for exactly the declared checks, programmatic/CLI parity, and the enforced run bounds against the plan |

### Behaviour changes, expected and verified

* the positive display fixture is corrected: `run_display_trace.mjs` records one latency per rendered
  tile, so a coherent run is 100 requests / 100 renders / 100 samples. The former 128-request/100-sample
  shape now fails as physically inconsistent, and a test says so. It is not an oracle;
* migration oracle over the coherent corpus against `55d6f485` (normalizing version, receipts, times and
  temporary paths): **all twelve requirements and all 68 assertions unchanged**, version 1 → 2, and each
  requirement now publishes its check receipts (3–14 per requirement). The old decision diff is a
  regression baseline, not scientific truth;
* a destination whose parent directory does not exist is now refused rather than created: the caller
  prepares the output root, and this tool creates only its own staging and diagnostic directories;
* a malformed request whose read-set cannot be recovered no longer writes to the requested destination;
  the diagnostic is published into a freshly owned directory and its path is reported;
* test expectations that contradicted the accepted contract were corrected with the reason recorded:
  one destination per case instead of reuse, diagnostics located where they are actually published, the
  refusal reason accepted for an existing destination, and the unwritable-parent case now asserting the
  explicit "no diagnostic was saved" message.

### Verification actually run

* `desktop/web/node_modules/.bin/tsc -p scripts/raster-qualification/ts/tsconfig.json` — clean;
* `node --test 'scripts/raster-qualification/ts/dist/tests/*.test.js'` — **239 passing**, from 177 at the
  reviewed baseline; new files `publication.test.ts` (16), `checkedOutcomes.test.ts` (15),
  `migratedFamilies.test.ts` (14), `remainingFamilies.test.ts` (10), `inventoryCoverage.test.ts` (6);
* a fresh-output-directory compile and test run (ignored/stale `dist` cannot supply success);
* `python3 -m unittest discover -s scripts/raster-qualification/tests` — **261 passing**, unchanged and
  not used as the acceptance oracle;
* `bash scripts/raster-qualification/tests/test_runner_exit.sh` — **18 passing**, including the new
  stale-output refusal that proves no producer step runs;
* `bash -n run_all_experiments.sh`, `python3 scripts/check_docs.py`, `git diff --check` — clean.

### Guard-removal probes (each in an isolated copy of the sources)

Each guard was removed on its own, the suite rebuilt and the applicable tests run:

| Removed guard | Detected by |
| --- | --- |
| satisfied-without-evidence defect | 1 failure (`checkedOutcomes.test.js`) |
| display sample/render relationship check | 3 failures (`checkedOutcomes.test.js`) |
| failure precedence in the single reduction | 6 failures (`checkedOutcomes.test.js`) |
| explicit reference labelling | 1 failure (`migratedFamilies.test.js`) |
| early existence refusal | 1 failure (`publication.test.js`, read-only-parent case) |
| no-replace at the link step (replace instead) | 1 failure (`publication.test.js`, injected competitor) |
| claimed-pin comparison | 2 failures (`migratedFamilies.test.js`) |
| evidence digest validation | 1 failure (`checkedOutcomes.test.js`) |
| evidence reference resolution | 1 failure (`checkedOutcomes.test.js`) |

The first pass found two **zero results**: removing the early existence refusal and removing the link's
no-replace refusal were both undetected, because each guard made the other unreachable. Two
deterministic cases were added rather than leaving the redundancy unproven: a read-only parent that
distinguishes the early refusal from a staging failure, and one inert fault-injection seam in
`publication.ts` that lets a test act as a competing creator between the two layers. Both probes are now
detected. No probe remained a zero result.

The adversarial pass also closed one acceptance case the first delivery had under-implemented: evidence
references are now resolved against the snapshot they name. A satisfied outcome must resolve the whole
reference (`runs[2].individualLatenciesMs`, `assertions[version:whitebox-wasm]`, `identity.artifact.sha256`),
so a typo cannot be published as support; a failure or gap cites its evidence for review and needs only a
real part of the snapshot, because a reference into an absent record is a finding about the record rather
than an internal defect.

### Self-review discoveries fixed in scope

* the first directory-mode collision case did not reject anything — it validated and became a negative
  control; the rejected-input case was rebuilt with an unreadable contract;
* the artifact/resource checks initially returned only failures, dropping the independent gaps they had
  collected; `contradicted` now carries both, and the checks use it;
* a non-object sidecar record initially gapped instead of failing, caught by the retained T4 test;
* the incompleteness summary for resource records was lost during migration, caught by the retained
  counterexample test and restored as the reduction-level statement;
* the final adversarial pass found that evidence references were validated by digest but not by
  existence, so `runs[2].nope` could have been published as support; reference resolution was added with
  its own test and probe.

### Limitations and omissions

* the audit and the probe set are finite; they are not proof that no other guard is unreachable;
* no producer, engine, browser or private experiment was run. Every producer-side statement is read from
  tracked source, and the private `fail` distribution remains implementer-reported and was not rerun;
* `Q-HOST-1`'s accepted-host rule is implemented and driver-tested, but no role `host` has declared
  expectations and no producer emits a host report, so the assertion is a permanent gap through the CLI;
* `Q-RES-1`'s 512 MiB disk-cache bound, the staging/free-space policy, the local-bridge numeric
  measurement and the six lifecycle/member/value/host obligations remain unestablished;
* adding the request minimum and the sample/render relationship means a real run whose producer records
  fewer latencies than rendered tiles will now fail. That is the intended relationship, and the first
  real reconciliation after this change must report the decision diff per requirement;
* time and cost remain unknown: they were not measured.

## B1–B3 boundary repair (implementation response)

Revision `95028481`, baseline `d6b3f8e1`, design `ac68fb64`. This is the implementer's report for the
[bounded boundary-repair handoff](q-final-boundary-repair-agent-prompt.md); it claims no acceptance, and
the three families remain open until the reviewer confirms them.

### What changed

| Family | Repair |
| --- | --- |
| B1 — absent-input aliases | `canonicalInput` resolves an absent input through its nearest existing ancestor and appends the unresolved suffix, so the comparison with the destination is made in the same canonical space. The review's reproduction (an input declared as `alias/not-yet.json` with `alias` a symlink to `actual`, and the output written as `actual/not-yet.json`) now refuses with exit 2, leaves the absent input absent, and publishes the diagnostic into a freshly owned directory. Only genuine absence takes that route: an existing ancestor that cannot be resolved refuses publication instead of guessing. Nothing is created, and the existing-file, dangling-link and creation-race guards are unchanged |
| B2 — independent failures | Window dimensions, ledger counters, the validated-window count and the sidecar observations are parsed and judged individually before any comparison that needs a second operand. A width above the edge limit fails without a height; a negative byte or request count fails without its sibling; the unusable operand is recorded as a gap beside the failure, so both classes survive at assertion and requirement level. Sidecar survival is read whatever the policy says, so a disappearance observed after recorded presence fails and a missing policy is a separate gap; a genuinely not-applicable declaration without contradicting observations still passes |
| B3 — malformed versus absent | A present but unusable required leaf fails; genuine absence gaps. Window width `"bad"`, `null`, a list, an object, a boolean, zero, fractional and negative values fail; `routeRole` `null`, a number, a list, an object, an empty string and an unknown label fail on both the candidate and the reference side. No coercion or truthiness is used, and unsupported resource-policy gaps are unchanged |

### Same-family sweep results

One bounded sweep over the changed checks and their shared helpers, as tables rather than copy-pasted
cases: 15 window leaves, 11 ledger leaves, 14 sidecar/policy combinations, 9 role-label forms, record
permutations (violation first, violation second, unusable sibling) and both publication entry modes.

Four counterexamples were found and fixed before delivery:

1. a **negative validated-window count** was accepted as a positive count, because the counter reader
   admitted any finite number; negative counts are now unusable input;
2. a **negative byte or request count** participated in the corroboration arithmetic, so it could both
   fail and be reasoned about as a measurement; unusable values are now excluded from the comparison;
3. an **unmeasured window record** (`classification` other than `measured`) was silently skipped; it is
   now reported as a gap naming the classification, so a skipped window is visible;
4. **evidence references were resolved too strictly**: against the retained producer report shapes, an
   ordinary missing-field gap (a report with no `windows` list, or no identity block) was classified as
   an internal-check defect and made the run exit input-class. References are now resolved only for an
   outcome that claims the fact is satisfied, because a failure or gap that cites a field the report
   does not carry is reporting that absence. Found by running the decision path read-only over the
   retained producer reports, and it is the reason that reconciliation now exits 1 with no defects.

### Controls corrected

Two existing expectations contradicted the accepted contract and were corrected with the reason
recorded: the sweep's "window size substituted with an unusable value" expected `inconclusive` and now
expects `fail` (that expectation encoded the B3 defect), and one window gap message now names the
dimension that is missing instead of a collapsed "usable size". No test was weakened; both corrections
make the expectation match the contract's malformed-versus-absent rule.

### Guard-removal probes (isolated copies of the sources)

| Guard removed | Detected by |
| --- | --- |
| absent-input alias normalization | 4 failures (request-mode alias both sides, dangling ancestor, nested alias) |
| window independent-failure retention | 4 failures (width without height, area without operands, two sweep tables) |
| ledger independent-failure retention | 3 failures (negative bytes without requests, two sweep tables) |
| sidecar survival independent of policy | 2 failures |
| malformed window dimension classified as absent | 2 failures |
| malformed role classified as absent, candidate side | 2 failures |
| malformed role classified as absent, reference side | 2 failures |

No probe was a zero result, and each failed the intended cases rather than an unrelated permanent gap.
The directory-mode alias case did **not** fail under the alias probe: there the destination's parent is
canonicalized on the output side, so the input-side normalization is redundant for that direction. That
redundancy is reported rather than credited as coverage.

### Gate commands actually run

`desktop/web/node_modules/.bin/tsc -p scripts/raster-qualification/ts/tsconfig.json`; `node --test
'scripts/raster-qualification/ts/dist/tests/*.test.js'` (266 passing, from 255 before the repair); the
same compile and test from a fresh output directory; `python3 -m unittest discover -s
scripts/raster-qualification/tests` (261 passing, frozen reference); `bash
scripts/raster-qualification/tests/test_runner_exit.sh` (18 passing); `bash -n
scripts/raster-qualification/run_all_experiments.sh`; `python3 scripts/check_docs.py`; `git diff
--check`. The private experiment runner was not invoked, no producer was changed, and no identity was
fabricated for an old report.

### Limitations

The sweep is finite; it is not proof that no other leaf is misclassified. No engine, browser, platform or
private experiment was run. Time and cost remain unmeasured. The read-only reconciliation over the
retained producer reports is a local re-decision over already-collected evidence: it is not a
qualification run, and its reports predate parts of the current consumer vocabulary.

## Measurement-readiness handoff

Reviewer correction MR1 at delivery `933fb593`: the original inventory confused the `q2-local-bridge` command name with successful scoped Desktop transport. The row and prerequisite below are corrected from inspected code; no new measurement or producer implementation is claimed. See the [independent disposition](q-typescript-review.md#boundary-repair-independent-disposition).

What a fresh bounded qualification run needs, requirement by requirement. This maps the existing
mandatory gaps to producer and host availability; it changes no acceptance limit and claims no
measurement. Sources are the tracked producer code (`measure.py`, `qual_lib.py`, `run_display_trace.mjs`,
`run_all_experiments.sh`, `ts/src/request.ts`) and the read-only reconciliation above.

**Kind of gap**: *missing producer* means no code emits the observation; *missing run* means a producer
exists but the evidence has not been collected with the current vocabulary; *missing environment* means
the producer exists but its host or fixture is unavailable; *wiring* means the evidence is produced but
the decision path reads a different file or field.

| Requirement | Observation needed | Current availability | Kind |
| --- | --- | --- | --- |
| all roles | the `identity` block (`id`, `experiment`, `command`, `environment`, `routeId`, `host`, `transport`, `runId`, `recordedAt`, `fixturePolicy`, `fixtures`, `artifact`) that admission requires | no producer writes an `identity` block; `Report.payload()` in `qual_lib.py` has no such key, and only the frozen Python consumer references the vocabulary. 11 of 12 requirements report the missing block on the retained reports | **missing producer** (envelope), prerequisite for everything else |
| `Q-LOCAL-1` | successful bounded numeric windows through the scoped Desktop bridge with source identity, dimensions and ledger | `q2-numeric` emits numeric observations, but that does not establish the required Desktop transport. `cmd_q2_local_bridge` explicitly expects stripped-file range-read rejection and prefix metadata; it is a negative control, not an unwired positive bridge measurement | **missing positive producer/route evidence**, host environment and subsequent report wiring; not just a missing run |
| `Q-HOST-1` | a Desktop WebView host report recording `identity.host = desktop-webview` and the bundled worker/asset path | no producer emits a host report, and no source role `host` has declared expectations in the decision path, so the accepting rule is reachable only from a test | **missing producer** + consumer schema decision + **missing environment** (packaged Desktop WebView) |
| `Q-DISPLAY-1` | one cold and three warm runs with at least 100 tile requests and 100 usable latencies each, reconciled against renders | `run_display_trace.mjs` exists and writes `runs`; the retained probe has 1 cold and 1 warm run. The enveloped trace lives inside the resources report (`displayTrace`), while the decision path reads the raw probe as role `trace` | **missing run** + **wiring decision** (which file is the declared trace) + **missing environment** (Chromium present; Desktop hosting still absent) |
| `Q-RES-1` | candidate-route memory, sampling, counters and the display disk-cache bound | `measure.py q6-resources` exists and writes candidate/reference measurement rows; the retained rows carry no `routeRole` label. The 512 MiB disk-cache bound and the staging/free-space policy have no producer at all | **missing run** for the counters, **missing producer** for the two plan bounds |
| `Q-ART-1` | bench-verified versions, integrity, license and source correspondence | `bootstrap_bench.py` plus `candidates.json` exist; no artifact report carries the identity envelope or the correspondence chain | **missing run** |
| `Q-PREP-1`, `Q-MEMBER-1`, `Q-VALUE-1`, `Q-CRS-1` | preparation, member, slope and CRS verdicts | the `measure.py` subcommands and probes exist and the runner routes them; they need the identity envelope, the prepared fixtures and the private originals | **missing run** + **missing environment** (private IGN fixtures) |
| `Q-CANCEL-1` | cancellation with work in flight on the plan's route | the recorded probe slices a resident buffer, which is a different operation | **missing producer** (capability) |
| `Q-TEARDOWN-1` | resource release observed on the route's own handles | release is asserted from a flag rather than observed | **missing producer** (observation) |
| `Q-FAILINJ-1` | a forced disk-write failure | no probe injects one | **missing producer** (capability) |
| `Q-MEMBER-1` overview precedence, `Q-VALUE-1` fixture-class coverage | an overview-precedence comparison and a per-fixture-class coverage assertion | no probe or assertion exists | **missing producer** |

### Prerequisites for the first scoped-local-bridge Desktop WebView measurement

In dependency order, so a later authorization can size the work:

1. **Producer envelope.** Every report must record the `identity` block above; without it no requirement
   is admitted, and a run would only reproduce the 11-of-12 identity gaps. This is a producer change and
   is outside this slice.
2. **Host role decision.** The decision path rejects a source whose role is `host`, because no declared
   expectations exist for it. A Desktop WebView measurement needs either a declared host role or a
   declared expectation recording the host on an existing role.
3. **Positive local-bridge producer.** A separately authorized slice must exercise successful reads
   through the actual scoped Desktop bridge, then align the resulting report with declared roles.
   Retain `q2-local-bridge` as stripped-input rejection evidence only. Neither changing its filename
   nor adding a transport/identity label turns rejection into a measured positive capability.
4. **Bounded-read prerequisite.** The recorded numeric limitation stands (`Q` receipt limitation 1): a
   bounded numeric read needs a prepared tiled derivative or a bounded legacy reader, so preparation
   must precede numeric windows on the platform fixture.
5. **Display trace source and shape.** Decide whether role `trace` reads the raw probe or the enveloped
   `displayTrace`, and replay a fixed viewport with at least 100 requests across one cold and three warm
   runs.
6. **Run mechanics.** Each run needs a fresh output root: the decision CLI never replaces an existing
   path, and the runner refuses to start when its final output already exists.
7. **Then the remaining obligations**: the resource budgets and the two unobserved plan bounds, the
   lifecycle capabilities (`Q-CANCEL-1`, `Q-TEARDOWN-1`, `Q-FAILINJ-1`) and the member/value coverage
   gaps — none of which the local-bridge or host measurements would close.

## NC1–NC2 numeric counter completion (implementation response)

Revision `e1f7ac95`, baseline `933fb593`, implementation `95028481`, design `ac68fb64`. This is the
implementer's report for the [numeric completion handoff](q-numeric-counter-repair-agent-prompt.md); it
claims no acceptance, and the two counter families remain open until the reviewer confirms them.

### What changed

| Finding | Repair |
| --- | --- |
| NC1 — discrete counters | The validated-window count, the served-byte count and the request count are counts of discrete things, so a supplied value must be a finite non-negative integer. A fraction, a negative value, `null`, a string, a boolean or a container fails with the field and value named and the whole-number rule stated; an absent value gaps; zero stays a valid value. Nothing is coerced or rounded. An impossible negative count keeps its own wording, because "records -1 byte(s) served" is a recorded impossibility rather than a wrong type |
| NC2 — true comparison operands | The ledger decides each relationship from its own two operands. With nine validated windows, zero bytes fails even when the request count is absent, and the missing count is recorded as its own gap; the request relationship is symmetric. Zero validated windows contradict recorded bytes or requests one operand at a time. An unusable value never enters the arithmetic, positive counters with a missing third counter and no independently known contradiction stay inconclusive, and a pass still requires both relationships to have been decided coherently |

Semantic changes, stated explicitly: a fractional or otherwise non-integer counter that previously
satisfied "finite number" now fails; and the ledger corroboration no longer waits for all three counters,
so a contradiction between two of them is reported even when the third is absent. The rule that a zero
validated-window count demonstrates no successful numeric read is retained and unchanged, and no new
ratio, window-count minimum or scientific tolerance was introduced.

### RED and GREEN commands

* RED: `node --test 'scripts/raster-qualification/ts/dist/tests/numericCounters.test.js'` — 10 of 11
  cases failed before the change (the eleventh is the unaffected-requirements regression guard).
* GREEN: the same command after the change — 13 of 13 pass, including the two matrix tests.
* Full suite, in place and from a fresh output directory:
  `node --test 'scripts/raster-qualification/ts/dist/tests/*.test.js'` — 279 passing, from 266 at
  baseline.

### Bounded counter matrix coverage

`numericCounters.test.ts` adds 13 cases: the NC1 and NC2 examples, zero-value semantics (including
`T=0` with `B=0` and `R=0`, and `T=0` with activity), malformed types, and two tables — a 20-row matrix
over the three counters covering valid whole, zero, fractional, negative, `null`, string, boolean, list,
object and absent values with the specific assertion and reason asserted for each row, and a zero-window
table that asserts the **ledger** assertion as well as the transport assertion so the no-window finding
cannot mask a skipped comparison. Every row also asserts that the window-bound assertion is untouched by
a counter case, and the NC2 cases assert the retained gaps beside the failures.

Two retained expectations were corrected for the new wording of a malformed count (verdicts unchanged):
`boundarySweep.test.ts` rows "bytes not a number" and "window count not a number" now expect
"not a whole non-negative …" rather than "not a finite …".

### Guard-removal sensitivity (isolated copies)

| Guard removed | Detected by |
| --- | --- |
| integer validation (finiteness only) | 4 failures: both NC1 counter cases, the malformed-type case and the matrix, all on the intended assertion and reason |
| the byte relationship gated on the request count | 3 failures: the NC2 zero-byte case, the zero-window contradiction table and the zero-window matrix |
| the request relationship gated on the byte count | 3 failures: the NC2 zero-request case, the zero-window contradiction table and the zero-window matrix |

No probe was a zero result, and each failed the intended assertion rather than an unrelated permanent
gap. Probes P1–P7 from the boundary-repair delivery remain effective and their tests still pass.

### MR1 readiness verification

Verified against producer code, not against the command name. `measure.py:cmd_q2_local_bridge` states
that it "establish[es] whether any candidate role boundedly reads a stripped GeoTIFF", records the
expected outcome for a stripped fixture as "a clean rejection, which is the negative control for this
experiment", and asserts `stripped-layout:{fixture}`, `bounded-range-rejected:{fixture}` and
`metadata-from-prefix:{fixture}` together with a `conclusion-recorded` check. It therefore supplies
negative-control evidence that a stripped layout is rejected and that prefix metadata is readable; it
cannot establish successful scoped Desktop bridge transport, and renaming it, relabelling its transport
or moving it to another role would not change that.

Reconciled guidance: the receipt's `Q-LOCAL-1` readiness row and prerequisite 3 carry the reviewer's
correction; the debrief's readiness row is corrected here to state that the local bridge needs a positive
producer, not wiring of an existing one; and the LiDAR guide already records the corrected reading. No
producer was implemented and no measurement is claimed. **This slice adds zero real Q capabilities.**

### Gate commands actually run

`desktop/web/node_modules/.bin/tsc -p scripts/raster-qualification/ts/tsconfig.json`; `node --test
'scripts/raster-qualification/ts/dist/tests/*.test.js'` (279 passing); the same compile and test from a
fresh output directory; `python3 -m unittest discover -s scripts/raster-qualification/tests` (261
passing, frozen reference); `bash scripts/raster-qualification/tests/test_runner_exit.sh` (18 passing);
`bash -n scripts/raster-qualification/run_all_experiments.sh`; `python3 scripts/check_docs.py`; `git diff
--check`. The private experiment runner was not invoked, no producer or Python file changed, no identity
was fabricated for an old report, and no unavailable environment is inferred as covered.

### Limitations

The matrix is bounded to the three counters and their operand pairs; it is not an exhaustive audit. No
engine, browser, platform or private experiment was run, so every readiness statement remains a
statement about producer code. Time and cost remain unmeasured.

## Desktop bridge transport slice (implementation response)

Revision `fab0c381`, baseline `f92ee112`. This is the implementer's report for the
[Desktop bridge handoff](q-desktop-bridge-agent-prompt.md); it claims no acceptance, and Q
remains open and unqualified. Unlike the previous slices this one ran a real experiment, so
its observations are separated below from its code.

### What changed

| Area | Change |
| --- | --- |
| Isolated host | `scripts/raster-qualification/desktop-host/` is a separate Cargo workspace (own `Cargo.lock`, `tauri.conf.json`, bundled `web/dist`) with no production manifest, IPC registration or app-data change. `desktop/src/native_operation.rs` is reused **by path**, not copied |
| Byte seam | `read(handle, offset, length, requestId)` returns exactly one interval or a structured refusal, decided before any byte is read: `unknown-handle`, `closed-handle`, `wrong-run`, `duplicate-request-id`, `zero-length`, `out-of-range`, `too-large`, `whole-artifact`, `overflow`. `close` is idempotent, teardown revokes every handle, and two running reads with 32 waiting requests are admitted before anything is refused for capacity |
| Ledger | The host writes its own ledger at read time — fixture, request id, offset, requested/returned length, outcome, aggregate bytes, maximum read, active/queued high water. Hash/preflight I/O is labelled `reference` and is never candidate transport evidence. The launcher reconciles it with the worker's counters instead of trusting either side |
| Worker | Plans reads from a 64 KiB header prefix (grown only on a genuine header shortage, capped at 1 MiB), asks for exactly the tiles it needs, and decodes them with `CogStream`/`tiles_for_window`/`decode_tile_f64`. Engine JSON is validated field by field, so a renamed key is a named failure rather than a window of `NaN` |
| Profile | Fixed `desktop-local` profile: route id, candidate pins and `local-bridge` transport unchanged; host `desktop-webview`, environment `qualification-host-desktop-local-v1`, role `host`, experiment `q-host`, file `host.json`, artifact `{name: desktop-webview, version: bundled}` declared unpinned with the reason recorded. Selection is explicit launcher input, an unknown profile is refused, and a conflict between `--profile` and the request body is refused before publication |
| Python | `import_map.py` and its three `.mjs` consumers are replaced by `ts/src/importMap.ts`; the helper is deleted. Output is byte-identical over the installed tree (830 entries), including key order and scoped/subpath handling |

Semantic changes, stated explicitly: the isolated host declares one unpinned artifact
(`desktop-webview`, `bundled`); and the launcher refuses to run in a directory that already
holds results, because the publication policy never replaces an existing path and a reused
directory would otherwise present a previous run's decision as this run's evidence.

### Genuinely measured

Two runs at this revision (`pilot-1789852111652`, `pilot-1789852116521`) through
`node tools/runPilot.mjs --run-dir <fresh>`; both take about five seconds end to end and
produced identical transport numbers.

| Observation | Value |
| --- | --- |
| Windows | Five level-zero windows (origin, mid, hole, far, lower-left) compared cell by cell against the analytic expectation: 81 920 cells, **0 value mismatches, 0 validity mismatches** in both runs |
| Bounded transport | 12 candidate reads totalling 11 599 872 bytes: one 65 536-byte header prefix plus eleven 1 048 576-byte tiles. Largest read 1 048 576 of 16 778 048 fixture bytes; no read returned the artifact |
| Ledger reconciliation | Worker counters (11 599 872 bytes in 12 reads, largest 1 048 576, no unexpected read failures) agree exactly with the native ledger, which is written host-side |
| Refusal controls | `whole-artifact`→`too-large`, `zero-length`→`zero-length`, `past-end`→`out-of-range`, `unknown-handle`→`unknown-handle`: all four refused with the declared code through the real WebView→IPC→bridge path and recorded natively with 0 bytes returned |
| Bundled assets | The host re-hashed all six embedded bundle files inside the binary and matched the launcher's declaration |
| Network denial | `unshare -rn` network namespace with no interface other than loopback; the display is reached through a local-only X11 pathname-socket relay, so the WebView runs without a network origin |
| Evaluator | `--profile desktop-local` over the produced reports: **Q-LOCAL-1 pass**, **Q-HOST-1 pass**, 10 requirements inconclusive, 0 fail, `synthetic: false`, no internal defects, overall verdict `inconclusive` |

Q-HOST-1's three assertions (`bundled-worker-and-asset-path-exercised`,
`no-network-origin-required`, `observed-in-desktop-webview`) and Q-LOCAL-1's six
(`reads-over-proposed-local-transport`, `transport-ledger-corroborates-bytes`,
`no-single-request-returns-whole-artifact`, `values-match-independent-reference`,
`validity-matches-reference-exactly`, `window-size-within-contract-limit`) all pass on
measured evidence. **This is the first positive local-bridge transport observation in Q.**

### Induced failures and sensitivity probes

Failures met while building, kept because each one is the reason a guard exists:

| Observed failure | Cause | What now prevents it |
| --- | --- | --- |
| GTK panics under `unshare -rn` (`Failed to initialize GTK`, no `/tmp/.X11-unix`) | a network namespace also isolates the X11 *abstract* socket | the launcher relays the *pathname* socket, which is reached through the filesystem and needs no network |
| `Module name, 'undefined/whitebox_wasm.js' does not resolve to a valid URL` | the WebView read camelCase keys while Tauri returns the spec in its authored snake_case | the message was the stale-bundle symptom as well; both are now explicit (authored key names, and a host-side digest check) |
| `'text/html' is not a valid JavaScript MIME type` | engine assets copied into the bundle *after* the host was built, so the embedded snapshot fell back to `index.html` | the launcher builds the frontend, copies assets, then builds the host; the host re-hashes every embedded file |
| Every window returned `NaN` | the worker read `tile.column` while the engine's JSON says `col`, and ignored band interleaving | engine JSON is validated field by field, and the analytic comparison failed loudly instead of reporting a successful read |

Probes, each in an isolated copy of the sources with the original restored byte-for-byte
afterwards:

| Guard removed or expectation broken | Result |
| --- | --- |
| Independent expectation broken after the fixture was written (`column - row` → `column + row`), guards intact | q2 report `fail`, decision `fail`, Q-LOCAL-1 `fail`, 16 255–16 384 mismatching cells per window |
| The same break with `compareWindow` forced to report no mismatch | q2 report `pass`, Q-LOCAL-1 `pass` — the comparison is the load-bearing guard |
| The 4 MiB read cap in `bridge.rs` | `bridge::tests::refuses_every_interval_before_reading` fails (15 pass, 1 fails) |
| One declared bundled-asset digest replaced by zeros | the run fails naming the asset, its embedded digest and its declared digest |
| A refusal control declaring `out-of-range` for a zero-length read | the report's `no-whole-file-request:refused-before-read` assertion is `false` and Q-LOCAL-1 becomes `fail` |
| The host digest comparison neutered, with the wrong declaration above | the run passes — the host-side check is what makes the bundled-asset claim an observation |

### Gate commands actually run

`desktop/web/node_modules/.bin/tsc -p scripts/raster-qualification/ts/tsconfig.json` and the
same compile into a fresh output directory; `node --test
'scripts/raster-qualification/ts/dist/tests/*.test.js'` (**296 passing**, 279 at the previous
revision); `desktop/web/node_modules/.bin/tsc -p
scripts/raster-qualification/desktop-host/web/tsconfig.json`; `cargo build --offline`,
`cargo test --offline` (**16 passing**), `cargo check --offline --all-targets`, `cargo clippy
--offline --all-targets -- -D warnings` and `rustfmt --check --edition 2021` on the host's
own files; `python3 -m unittest discover -s scripts/raster-qualification/tests` (**261
passing**, frozen reference); `bash scripts/raster-qualification/tests/test_runner_exit.sh`
(18 passing); `bash -n scripts/raster-qualification/run_all_experiments.sh`; `python3
scripts/check_docs.py`; `git diff --check`. The host builds offline: `https://crates.io`
returns 403 from this environment, so every Rust command uses `--offline` against the
existing cache.

Two gates are deliberately not claimed as clean here, and the reason is stated exactly.
`cargo fmt --check` inside the host crate passes on this working tree, but only because the
working tree already carried an uncommitted import-ordering change to the reused production
file `desktop/src/native_operation.rs`; that file is included by path, so the host crate
formats it too. On a clean checkout of this revision the same command reports two diffs in
that file (rustfmt 1.9.0 orders `AssertUnwindSafe` after the lowercase names), and that file
belongs to production rather than to this slice, so it was left exactly as found and is not
part of either commit. The host's own files are therefore checked directly with `rustfmt
--check --edition 2021 src/bridge.rs src/main.rs build.rs`, which passes. Repository Rust CI
parity (`cargo fmt --all --check`, `cargo clippy --workspace`) was not run, because the
production workspace is untouched by this slice and the isolated crate is outside it.

### Limitations

The fixture is one generated 2048×2048 Float32 plane, not the plan's private-original
derivative, so the declared fixture manifest is a declared *subset*: it establishes coverage
of the fixture this run used, not of the plan's fixture classes. The pilot exercises the
transport, the refusal seam at the adapter boundary and the host's asset and network
posture; it does not measure cancellation, teardown-on-failure, resource budgets, display
traces, preparation, members, slope, CRS or artifact correspondence, and none of those are
inferred from it. The engine is the published `whitebox-wasm` 0.5.1 from the local bench:
`candidates.json` records that it does not correspond to the source pin, and that
correspondence failure is preserved rather than hidden — the engine was not rebuilt,
replaced or substituted, and the pinned route is not qualified by this evidence. Packaging
is claimed only for this Linux WebKit host. Time and cost are still unmeasured.

### Python replaced, and what still consumes Python

`scripts/raster-qualification/import_map.py` is deleted. Its replacements are
`ts/src/importMap.ts` and `ts/tests/importMap.test.ts` (8 tests, including a parity test that
compares this implementation with the Python helper while it exists and returns early once it
does not). The three callers `run_wasm_probe.mjs`, `run_display_trace.mjs` and `crs_probe.mjs`
now run `ts/dist/src/importMap.js` through `process.execPath`, and `serve_bench.py` consumes
the generated JSON unchanged with its `--import-map` help text updated.
`run_all_experiments.sh` compiles the tooling with a new `step00` before the probe steps.
`serve_bench.py`, `measure.py`, `qual_lib.py`, `bootstrap_bench.py` and the frozen Python
regressions remain as they were; no other Python file was touched and no new Python work was
added.

### Next blocked dependency and authority needed

The remaining Q obligations are unchanged and none of them is a wiring problem this slice
could have fixed. Each needs a producer decision the handoff did not authorize: preparation,
members, slope and CRS need the private fixtures and their producers; resources and display
need new producers and the two unobserved plan bounds; cancellation, teardown and failure
injection need capabilities, not runs. Because the fixture is generated and the engine does
not correspond to the source pin, no further run of this harness can qualify Q: a
qualification claim needs a separately authorized slice with the pinned artifact and the
managed fixtures. **This slice adds two positively observed Q capabilities (Q-LOCAL-1 and
Q-HOST-1, both as exploratory observations on a generated fixture) and zero qualified
requirements.**
