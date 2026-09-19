# TypeScript qualification — bounded design reassessment

Status: proposed — evidence-backed reassessment delivered for user-mediated independent design review. No implementation, Round 3, evaluator rewrite or language change is authorized by this document.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
Current guidance: [reassessment prompt](q-typescript-reassessment-agent-prompt.md), [Round 2 disposition](q-typescript-review.md#round-2-independent-disposition), [C1–C8 contract](q-admission-acceptance.md#stable-acceptance-matrix), [assertion evidence map](../../../scripts/raster-qualification/assertion_evidence_map.md), [migration receipt](q-typescript-receipt.md), [debrief](review-and-debrief.md#round-2-debrief-inputs).

This document answers one question: why known failures still disappear and inconsistent observations still pass after two repair rounds, and what bounded change would stop the recurrence. It is not a repair report and not an execution prompt. It contains no new producer observation, no benchmark run, no engine build and no private reconciliation; every reproduction below is a local mutation of the synthetic helper corpus through the emitted CLI.

## Inspected revision and method

| Item | Value |
| --- | --- |
| Checkout | `82184e6c` on `feature/raster-html-references` (two commits above implementation `c76d1b2e`, one above the reviewed checkout `6a98cd33`) |
| Reviewed implementation | `c76d1b2e`; reviewed checkout `6a98cd33` |
| Source changes to `scripts/raster-qualification/ts` since `c76d1b2e` | none (`git diff --stat c76d1b2e HEAD -- scripts/raster-qualification/ts` is empty) |
| Build identity | verified, not assumed: `tsc -p scripts/raster-qualification/ts/tsconfig.json --outDir <temp>` exited 0 and `diff -r scripts/raster-qualification/ts/dist <temp>` was empty, so the emitted `dist/` the reproductions ran against is the compilation of the inspected revision |
| Reproducer | untracked scratch driver over `ts/tests/contractFixture.ts` (`roleReports()`, `SOURCE_ROLES`, `NOW`) plus `ts/tests/fixtures.ts` (`fixtureManifest()`, `candidatePins()`), run through `ts/dist/src/cli.js` in fresh helper-owned temporary roots; deleted before commit |

Method notes that constrain what may be concluded:

* the control is a **synthetic, internally coherent corpus**, marked `synthetic: true` in the request so the run records it as a control; the flag can only demote an overall `pass`, and no requirement verdict below depends on it;
* a whole-Q non-pass does not validate individual requirements, so **every case below asserts one requirement and one named reason**, never the overall exit code alone;
* the sweep is finite and targeted. It is not a proof that the remaining mappings are correct, and this document does not claim one;
* each case preserves every input byte except the disposable copy of the file a case intentionally aims at;
* the assignment named **craft**, **codebase-design** and **write-plan**. The first two were applied; `write-plan` is **not present in this session's available skill catalog**, so its guidance could not be loaded and the plan structure here follows the assignment's required sections and the repository's delivery workflow instead. `tdd` informed the test-first ordering in the implementation proposal; no RED/GREEN claim is made for this documentation-only delivery.

## Reproductions from the coherent positive control

Control (`exit=1`, document `verdict=inconclusive`, `synthetic=true`, every source byte-identical before and after):

| Requirement | Verdict |
| --- | --- |
| `Q-ART-1`, `Q-LOCAL-1`, `Q-PREP-1`, `Q-CRS-1`, `Q-DISPLAY-1` | `pass` |
| `Q-MEMBER-1`, `Q-VALUE-1`, `Q-CANCEL-1`, `Q-TEARDOWN-1`, `Q-FAILINJ-1`, `Q-HOST-1`, `Q-RES-1` | `inconclusive` |

The five passing requirements are the ones whose assertions a producer observation can satisfy; the seven inconclusive ones carry the known permanent gaps. The contract rows that govern each case are C1 (strict leaves), C3 (required identity/correspondence), C4 (explicit evidence per assertion), C5 (per-run reductions and plan bounds), C7 (CLI authority and publication) and C8 (cross-layer invariants).

### Round 2 families, re-reproduced

| Case | Expected per C1–C8 | Observed | Reasons recorded |
| --- | --- | --- | --- |
| Control | requirement passes | `exit=1`, `Q-DISPLAY-1=pass` | none |
| `failedTiles=1` on the cold run | C5/C8: `Q-DISPLAY-1` fails | `exit=1`, `Q-DISPLAY-1=fail` | `run cold rendered 128 tile(s) with 1 failure(s)` |
| the same failure **plus** `ok` deleted on that run | C5/C8: the failure survives an independent gap | `exit=1`, `Q-DISPLAY-1=inconclusive` | `run cold does not record whether it rendered successfully`; the tile failure is gone |
| `pageErrors=['render crashed']` **plus** `tilesRendered` deleted | C4/C5: the recorded page error is a failure | `exit=1`, `Q-DISPLAY-1=inconclusive` | `run cold does not record its rendered and failed tile counts`; the page error is gone |
| `verifiedArtifacts[0].version='999'` | C3: `Q-ART-1` fails | `exit=1`, `Q-ART-1=fail` | `whitebox-wasm was verified at version "999" but the route declares "0.5.1"` |
| the same wrong version **plus** the second verified record removed | C3/C8: the wrong-version comparison survives the coverage gap | `exit=1`, `Q-ART-1=inconclusive` | `no bench-verified version is recorded for cog-tiler-wasm`; the wrong version is never compared |
| `sourceCorrespondence[0].pinnedRevision` set to forty zeroes **plus** `artifactRevision` deleted | C3: a present claimed pin that contradicts the declaration fails, and only the built-revision comparison may be blocked | `exit=1`, `Q-ART-1=inconclusive` | `whitebox-wasm@0.5.1: the correspondence record does not record both revisions`; the pin conflict is never compared |
| cold run `tilesRendered=1`, `tileRequests=1`, 100 latency samples, `failedTiles=0` | C5: `pass` requires the plan's per-run tile-request minimum and count/sample reconciliation | `exit=1`, `Q-DISPLAY-1=pass` | none — the run qualifies with one rendered tile of one request |
| request `now='invalid'`, `--out` set to one of the request's own source paths | C7: the input is preserved; the run refuses before writing | `exit=2`, source replaced by a `kind:'rejected-input'` document | the collision is not detected |
| negative control: valid request, same `--out` | C7: refused before writing | `exit=2`, source byte-identical, no document written | collision detected |

### Families found in this reassessment

These are new here, not Round 2 findings. They matter because the assignment asked for an audit of every mapping, and because they show the same family outside the three files the review named.

| Case | Expected per C1–C8 | Observed |
| --- | --- | --- |
| `--reports <dir> --out <dir>/q1-artifacts.json`, valid contract (negative control) | C7: declared report files are inputs; refuse and preserve | `exit=2`, report byte-identical, no document written |
| the same destination with an unreadable contract | C7: the rejection diagnostic is emitted, but not over an input | `exit=2`, the declared report file is replaced by a `kind:'rejected-input'` document |
| `measurements` reduced to the labelled candidate record only | C4: no reference measurement exists, so the assertion is unestablished | `Q-RES-1=inconclusive`; `measurement-is-of-candidate-route=pass`; `reference-measurements-labelled-separately=inconclusive` |
| the same, with the candidate record's `routeRole` deleted | C4/C8: removing a label cannot create evidence | `Q-RES-1=inconclusive`; `measurement-is-of-candidate-route=inconclusive`; `reference-measurements-labelled-separately=**pass**` |

The last pair is a false individual pass produced by deleting a label: the record whose own `route` text still reads `candidate (wasm ranged transport)` is reclassified as a *separately labelled reference measurement* because the consumer tests `routeRole !== 'candidate'`. The producer this repository ships emits no `routeRole` on any measurement — the candidate record carries only its prose `route` and its per-fixture counters (`measure.py`, candidate measurement append) — so this is the shipped report's shape, not a hypothetical one.

### Hypotheses that did not survive re-measurement

`decide.ts` merges the shape's gaps and then discards them in a no-op loop (`for (const gap of merged.gaps) void gap;`). Read alone, that looks like the same family: a computed finding thrown away before reduction. It is not. `admitReport` is called with the merged shape and reports those gaps itself, so a deleted `identity.runId` — the one gap that only `checkReportShape` produces — does reach the decision. Measured: `Q-LOCAL-1` moves from `pass` to `inconclusive` and the `runId` reason appears. The loop is dead code with a misleading comment, not an evidence loss. It is reported here as a review-coverage observation, not a defect.

## Structural trace from bytes to exit code

The path is: raw bytes → `sources.ts` (`readSource`: one read, digest, absent ≠ corrupt) → `report.ts` (`checkReportShape`, `readAdmissionFacts`) → `admit.ts` (`admitReport`) → `decide.ts` (`prepare`, then `decideRequirement` per requirement) → `evidence/*.ts` (one mapping per requirement) → `verdict.ts` (`Findings`, `reduce`, `worse`) → `qualification.ts` (`runQualification`, `overallVerdict`) → `cli.ts` (publication and exit code). `reduce.ts` holds the per-run and across-run reductions that `resources.ts` and the display mapping consult.

The single reduction is correct and total: `reduce(failures, gaps)` returns `fail` if any failure exists, then `inconclusive`, then `pass`, and the same rule is applied at every layer. **The defect is not in the reduction. It is that the mappings decide the *reachability* of each check with imperative control flow, and a check that never runs appends no finding, so the reducer never sees it.** Four variants of that one cause are demonstrated above:

1. **Mutually exclusive chain.** `display.ts` rendering facts are an `if / else if / else if / else if / else` chain, so `pageErrors` and the render/request reconciliation live only in the final branch and are lost whenever `ok`, `tilesRendered` or `failedTiles` is unusable. The family predates the migration: the retained Python reducer also breaks out of its counter loop at the first missing counter and therefore never evaluates `failed > 0` for that run.
2. **Early return on a coverage gap.** `verifiedVersions` returns `inconclusive` as soon as one required artifact lacks a verified version, so the versions it *does* hold are never compared against the declaration.
3. **Conjunction of independent preconditions.** `pinnedCorrespondence` requires both `pinnedRevision` and `artifactRevision` to be present before comparing either. The claimed-pin comparison needs only the claimed pin and the declaration; only the built-revision comparison needs the built revision. The same conjunction exists in the retained Python gate.
4. **Requirement inferred from what was supplied.** `resources.ts` derives "reference measurements are labelled separately" from `routeRole !== 'candidate'` rather than from a declared role, so absence of the label is read as the label. `display.ts` checks the length of the latency list but never ties it to the tile counts, so a one-tile run with 100 samples satisfies a per-run sample minimum; and `DECLARATIONS` has no key for the plan's "at least 100 tile requests in each cold/warm run" ([main plan](../raster-data-analysis-rework.md), resource step), so no verdict can depend on it.

The mappings that do **not** show the family are as informative as the ones that do. `values.ts`, `members.ts`, `crs.ts` and `lifecycle.ts` set every assertion unconditionally from its own evidence through the accumulating helpers `named`/`allNamed`; `reduce.ts` enforces every budget on every record whether or not the record sampled correctly; `lifecycle.ts` declares its assertions, its producer names and its unmeasurable obligations as three explicit lists. Those are the target shape, already present in this codebase, for three requirements and one reducer.

Two further asymmetries are worth recording without overstating them:

* `resources.ts` reports `sampleCount === 0` as "does not record a positive sample count", i.e. a present zero read as absence, while `reduce.ts` classifies a present `null` as malformed rather than missing. Both are severity-direction choices, not demonstrated false passes;
* `numericTransport.ts` skips a window record whose `classification` is not `measured` without recording that it skipped it. No measured claim is lost by that skip, so it is an analogous risk rather than a demonstrated defect;
* the artifact required set is derived twice with different filters (all declared artifacts for the inventory assertion, declared-minus-unpinned for the correspondence assertion). The two agree today only because no currently declared artifact is in `UNPINNED_ROLES`; a future unpinned artifact would make the inventory assertion unsatisfiable while the correspondence check fails any record naming it.

## Required consumed evidence and dependencies

The per-assertion inventory is not missing: [`assertion_evidence_map.md`](../../../scripts/raster-qualification/assertion_evidence_map.md) is active and records, for each of the 68 contract assertions, the evidence that decides it and what an absent observation means. The reassessment's finding is about the **tie between that inventory and the code**, not about its existence. Three concrete disagreements were measured:

* the map's `runs-report-successful-rendering` row names `ok`, `tilesRendered` and `failedTiles`; the code additionally reads `pageErrors` and `tileRequests`, and the map does not record either, so the row that a reviewer would check against C5 is silent about the check that R2-A and R2-C defeat;
* the map's `reference-measurements-labelled-separately` row says "the presence of reference-labelled records", which is weaker than the assertion's own name: presence of *unlabelled* records satisfies it in the code. The retained Python gate instead keeps an explicit `undeclared` bucket, refuses a pass while any measurement records no role, and has a test for it (`tests/test_qualification_gate.py`, `test_measurement_without_a_declared_role_is_not_candidate_evidence`);
* the retained Python reducer reconciles `rendered` tiles against the individual sample count per run, a check the TypeScript display mapping does not perform. R2-C is therefore a **migration regression with a retained oracle**, not a new specification gap. Its second half — the plan's ≥100 tile requests per run — is checked by neither implementation.

Dependencies each comparison actually needs, separated from what it has been written to require:

| Comparison | Needs | Must not be blocked by |
| --- | --- | --- |
| claimed pin vs declared pin | the record's claimed pin, the declaration's pin | a missing built revision, a missing coverage record for another artifact, a `matches` boolean |
| built revision vs declared pin | the record's built revision and the declaration's pin | nothing beyond those two; a missing built revision gaps *this* comparison only |
| version verified vs declared version | each required artifact's own record | another artifact's missing record |
| per-run count reconciliation | that run's own counters | another run's missing counters |
| per-run sample sufficiency | that run's own samples and tile counters | any other run |
| route attribution | the record's declared role and its own route text | any other record |

Producer negative control and positive capability stay distinct and must stay distinct under any change: `expected-rejection:`-scoped failure strings are the producer's record that a deliberately bad input was rejected (`admit.ts`, `NEGATIVE_CONTROL_PREFIX` and the `positiveFailures` / `negativeControlFailures` split). A negative control may support only rejection assertions, and the contract is explicit that "an expected rejection is successful execution of that control, not a positive capability". A check inventory that reads a control scope for a capability assertion would be a new false-pass channel.

Evidence that exists in this repository but is **not** in the consumer's vocabulary is a third category and should be reported as such rather than as missing measurement: the shipped q6-resources producer records the route as prose and emits no `routeRole`, no per-record sampling cadence and no per-record counters, so `Q-RES-1`'s five assertions are undecidable from the report this checkout can produce, while the consumer reports them as unrecorded rather than as a producer/consumer vocabulary mismatch. Unavailable evidence that stays unavailable: the 512 MiB display disk-cache bound, the staging/free-space policy, the local-bridge numeric measurement, the Desktop WebView host observation, and the six lifecycle/member/value/host assertions already listed as permanent gaps. None of them is created or removed by this reassessment.

## Output ownership and publication policy

`cli.ts` is the only writer in the decision path (verified by grepping every `writeFileSync`, `mkdirSync`, `renameSync`, `unlinkSync` and stream constructor in `ts/src`): the decision document and the `kind:'rejected-input'` diagnostic. Every other module reads.

The defect is a derivation order, not a missing check. The read-set is built from the four argument paths, and the request's own source paths are added **after** `readRequest` returns a request object. `readRequest` returns `QualificationRequest | string`, so every structured validation failure — including a failure that occurs *after* the source list was fully parsed, such as the reproduced `now='invalid'` — discards the facts the collision guard exists to use. The rejection path then evaluates the guard against a read-set that omits the sources and writes the diagnostic to `--out`. The guard therefore protects exactly the runs where publication is least dangerous (a decision whose inputs are known) and not the runs where it is most dangerous (a refusal that knows nothing) — even though the refusal also publishes, through the same `--out` and the same `writeFileSync`.

The same derivation order makes the directory mode protectable by accident rather than by construction: with a valid contract the built request registers all nine report paths and a collision is detected; with an unreadable contract the request is never built, no source path is registered, and a declared report file is replaced. In directory mode the source set is statically declared (`REPORT_FILES`), so it is knowable before any validation at all; in request mode the `sources` array is structurally readable before any semantic validation.

Proposed policy, one rule with three parts:

1. **Compute the read-set before publishing anything, from the strongest available source.** Argument inputs (`--request`, `--contract`, `--fixture-manifest`, `--pins`) always; in directory mode, the nine declared report files resolved against `--reports`, with no dependence on validation; in request mode, every source path recovered **while** parsing, so a later semantic failure cannot discard paths already seen. Parsing collects paths monotonically and never drops them on an error path.
2. **Refuse to write when the canonical destination is a read-set member**, in both the decision and the rejection path, before `mkdirSync` runs. Canonicalisation: `realpathSync` when the path exists (which also resolves symlinks and returns the on-disk name on a case-insensitive filesystem), otherwise `resolve`; compare the canonical forms case-sensitively. This decides ordinary aliases — `./out.json`, `a/../out.json`, relative versus absolute, a symlink to an input — without inventing a threat model. Stated non-goals: hard links and bind mounts are not detected; a directory destination keeps failing with the existing `EISDIR` diagnostic.
3. **When the read-set cannot be recovered at all** — the request bytes do not parse, or `sources` is not a list — never replace `--out`. Write the diagnostic to the documented sibling path `<out>.rejected.json` and name it on stderr. This keeps C7's requirement that a diagnostic is emitted when the destination is writable, keeps exit status 2, and cannot destroy a file whose provenance the run cannot establish. Rejected alternative: overwrite `--out` only when its current bytes look like this tool's own document. That makes publication depend on the content of a file the run did not produce, which is a weaker and harder-to-review rule than "never replace a file whose provenance is unknown".

Existing-output behaviour: overwriting is **kept** for both documents when the destination is provably not an input, because the runner re-runs into the same `$OUT/q-decision.json` and a stale document must not block a fresh one; when a rejection replaces an existing decision document the replacement is stated on stderr. No `--force` flag is added.

## Options and recommendation

Both options keep one TypeScript authority, the current runner routing, source-byte snapshots, recomputation from sources, and every requirement id, tolerance, pin and budget.

**Option A — disciplined repairs inside the existing mapping shape.** Fix each demonstrated site where it is: split the display chain, compare the versions that are present before reporting coverage, separate the two presence checks in `pinnedCorrespondence`, add the plan's tile-request minimum and the sample/count reconciliation, port the Python `undeclared` rule, and rebuild the CLI read-set. Add one test per case. Cost: lowest. Demonstrated defect elimination: it removes every case reproduced above. Residual risk: it is the third application of the same strategy. Round 1 repaired six families and the reviewer found four more in Round 2, three of them in files that Round 1 had already touched or reviewed; the family is a property of how checks are written, so a per-site repair is only as good as the next reviewer's sweep, and nothing prevents the next mapping from gating a check behind a sibling's success.

**Option B — one focused seam that accumulates independently decidable findings before reduction.** Add a small check inventory per requirement and a total driver: each check is evaluated unconditionally, appends its own failure or gap through the existing `Findings` class, and declares which assertion ids it decides and which observation leaves it reads. The driver merges every check's findings into the existing reduction, and reports any declared assertion that no check decided as an explicit gap, so a declaration can no longer be "passed but never read" and an assertion can no longer be silently `inconclusive` by omission. Option A's fixes become the *content* of the migration, and the extra structural elements are a totality check (every contract assertion decided by at least one check), a per-check negative fixture, and a retention sweep driven by the declared reads (mutating a leaf a check does not read must not change that check's outcome). Cost: one new module, an additive field on `MappingResult`, a mapping-by-mapping migration, and two new test drivers. Review cost: lower than A's for the next change, because each requirement's decided facts become one short enumerable list instead of control flow distributed over a file.

Recommendation: **Option B**, on demonstrated defect elimination and review cost rather than elegance or line count. Four of the seven demonstrated cases (R2-A, R2-B, N-1, N-2) are the same reachability mistake in different syntaxes, and R2-C is a *missing* check that no per-site repair would have enumerated; the inventory makes both visible in one place and gives the retention invariant a mechanical expression. The codebase already contains the target shape in miniature (`lifecycle.ts`'s three declared lists) and the accumulation primitives (`Findings`, `worse`, `combine`, `allNamed`, and `reduce.ts`'s budget loop), so B is a generalisation of accepted patterns rather than a new architecture. Honest trade-off: B costs more than A up front, and it changes files whose evidence semantics are load-bearing, so the migration must be validated by per-requirement decision-document comparison, not only by the new tests. A partial migration is safe in the other direction — the driver with no migrated mapping changes nothing.

Rejected: a wholesale rewrite, because it would discard 177 TypeScript tests, 261 retained Python tests that still encode stricter rules this migration dropped, and the admission/verdict semantics that are demonstrably correct; a generic validation DSL, because the inventory is data plus one total driver and no evidence of a need for a general expression language has been produced.

## Reuse inventory

| Module | Disposition | Reason |
| --- | --- | --- |
| `sources.ts` | reuse unchanged | read-once, digest of the exact bytes, absent ≠ corrupt is the correct boundary and the only read of evidence |
| `report.ts` | reuse unchanged | container/leaf strictness and the problems-versus-gaps split already separate malformed input from missing evidence |
| `admit.ts` | reuse; adapt only the leaf vocabulary | admission, identity comparison and the negative-control scope rule are correct and must not be relaxed; the seam needs the leaf paths checks declare |
| `decide.ts` | reuse; adapt minimally | `prepare`/`decideRequirement` keep ownership of admission and reduction; add the check-driver hook and undecided-assertion reporting, delete the dead `void gap` loop and the unused `assertionVerdicts` local |
| `verdict.ts` | reuse unchanged | `Findings`, `reduce`, `worse`, `combine` are the single reduction and the sink for accumulated per-check findings |
| `reduce.ts` | reuse unchanged as the model | its per-record budget loop is the retention discipline the seam generalises |
| `qualification.ts` | reuse unchanged | routing, synthetic-control exclusion and unmapped-requirement handling stay; add the evaluated check inventory to the decision document |
| `cli.ts` | adapt | extract the read-set derivation and publish only against it, for both documents |
| `evidence/display.ts` | adapt | the demonstrated R2-A and R2-C sites |
| `evidence/artifactCorrespondence.ts` | adapt | the demonstrated R2-B sites; keep the three-point correspondence comparison |
| `evidence/resources.ts` | adapt | the demonstrated N-1 site; port the retained `undeclared` rule and keep the unconditional plan-bound gaps |
| `evidence/numericTransport.ts` | adapt lightly | keep `allNamed`/`named` as the accumulation helpers; record skipped non-measured window records |
| `evidence/preparation.ts`, `host.ts` | adapt lightly | independent-fact checks; `COMBINED_SOURCE_NAMES` is already the "more severe of contributors" shape |
| `evidence/values.ts`, `members.ts`, `crs.ts`, `lifecycle.ts` | reuse; declare as-is | already the target shape; the migration is declarative for these |
| `evidence/registry.ts`, `mapping.ts` | adapt additively | one mapping per requirement is correct; `MappingResult` gains the evaluated check ids |
| `assertion_evidence_map.md` | adapt | becomes the reviewable inventory the code cites; rows gain check ids and the missing `pageErrors`/`tileRequests`/tile-minimum evidence |

## Proposed interfaces and ownership

Proposed, not implemented. The seam is one module and one additive field.

```ts
// scripts/raster-qualification/ts/src/evidence/checks.ts (proposed)
export interface CheckInput {
  readonly byRole: ReadonlyMap<string, SourceView>;
  /** Per-check findings sink; the driver attributes them to `decides`. */
  readonly findings: Findings;
  readonly observations: Record<string, unknown>;
}

export interface Check {
  /** Stable id, cited by tests, the evidence map and the decision document. */
  readonly id: string;
  /** Contract assertion ids this check contributes a finding to. */
  readonly decides: readonly string[];
  /** Observation leaves this check reads, e.g. `trace.runs[].pageErrors`. */
  readonly reads: readonly string[];
  /** Evaluated unconditionally by the driver; never returns a verdict. */
  run(input: CheckInput): void;
}

/** Evaluate every check; report assertions no check decided. */
export function runChecks(
  checks: readonly Check[],
  declared: readonly string[],
  input: CheckInput,
): { readonly evaluated: readonly string[] };
```

Driver contract: checks are invoked in declaration order, unconditionally, with a `Findings` whose entries are attributed to every id in `decides`; verdicts come only from `Findings.verdict()`; a declared assertion id that no check decided produces an explicit gap naming the id; a check that throws is a build defect and is reported, not swallowed. Ownership stays where it is: `decide.ts` owns admission and reduction, each mapping owns its declarations and does not read another mapping's findings, and no module gains a second read of a source.

The `MappingResult` change is additive: it keeps `assertions`, `observations`, `failures`, `gaps` and the provenance fields, and adds `checks: readonly string[]` (the evaluated ids) for the decision document. Requirement ids, assertion ids, contract tolerances, engine pins, declared budgets and the decision document's existing fields are unchanged; the only intended decision changes are the enumerated assertion-level flips recorded in the migration table for each slice.

## Deterministic verification coverage and omissions

Coverage the proposed implementation must add, in the order it earns it:

1. one CLI-level counterexample per demonstrated family, with the failure-plus-gap variant asserted on the named reason, not on the overall exit code — the transcripts in this document are the fixtures;
2. one positive control per migrated requirement, asserting that the coherent corpus still passes at assertion level;
3. totality, enforced by the driver rather than only tested: every contract assertion id from [`requirements.json`](../../../scripts/raster-qualification/requirements.json) is decided by at least one check, and an undecided assertion is a reported gap;
4. one negative fixture per check id (the check produces a failure) and, for checks whose verdict can be a gap, one absent-observation fixture;
5. the retention sweep: for each check and each mutated leaf the check does not declare in `reads`, that check's verdict and reason set must be unchanged from the control;
6. publication cases as pairs: rejected input with `--out` on a source (refuse and preserve) and valid input with the same destination (refuse and preserve) in both CLI modes, plus the unparseable-request case writing only the sibling diagnostic;
7. a migration oracle: per-requirement decision-document comparison against the pre-migration revision on the synthetic corpus, with every difference enumerated and justified in the slice's commit.

Omissions, stated so a later reviewer does not read silence as proof: the sweep is finite and does not prove the unmodified mappings correct; declared `reads` lists are review artifacts and a check that should read a leaf but does not will pass the retention sweep (negative fixtures are the guard for that direction); no producer observation is created, so `Q-RES-1`'s producer-vocabulary mismatch and every permanent gap stay exactly as they are; the 512 MiB display disk-cache bound, the staging/free-space policy, the local-bridge measurement and the Desktop WebView observation remain unestablished; no private reconciliation, benchmark or engine build is run; and this reassessment cannot tell whether the runner's existing report set would newly fail under the added checks — that is the point of the migration table, and it is why the first slices must report the decision diff per requirement rather than only a green suite.

## Ordered implementation and rollback proposal

Test-first, one vertical slice per commit. Each slice: add the failing counterexample, confirm it fails for the expected reason, implement the smallest change that passes, then run the decision-document comparison for the affected requirement. No RED/GREEN claim is made here; this is a proposed sequence for a later authorized implementation.

| Slice | Content | Rollback |
| --- | --- | --- |
| S1 | `checks.ts` driver plus the coverage guard, no mapping migrated: pure addition, decision documents byte-identical | revert the commit; nothing depends on it |
| S2 | `display.ts` rendering facts as independent checks (R2-A), including the page-error and reconciliation facts the map omits | revert S2 only; the driver with the old mapping is inert |
| S3 | `display.ts` per-run sufficiency: the plan's ≥100 tile requests and rendered-versus-sample reconciliation (R2-C), with the declaration entry the plan states | revert S3; S2 stays |
| S4 | `resources.ts` route attribution: declared roles with an explicit undeclared bucket, ported from the retained Python rule and its test (N-1) | revert S4 |
| S5 | `artifactCorrespondence.ts`: split coverage, pin and built-revision comparisons so each is decided independently (R2-B) | revert S5 |
| S6 | `cli.ts` read-set derivation and the publication policy, in both modes, including the sibling diagnostic (R2-D, N-2) | revert S6; the guard reverts to its previous behaviour, which is the demonstrated defect |
| S7 | `assertion_evidence_map.md` rows updated to cite check ids and the added evidence, plus the inventory tie for `values.ts`, `members.ts`, `crs.ts`, `lifecycle.ts` | revert S7; documentation only |

Order rationale: S2 is the tracer bullet because it proves the seam against the family's clearest instance and its existing helper corpus; S6 is independent of S1–S5 and may be done first if the user prefers to close the evidence-destruction risk before the verdict work. Stop conditions for the implementation: any slice that changes a decision for a requirement it did not intend to touch, any slice that cannot express its counterexample at the CLI seam, and any slice whose decision diff cannot be enumerated.

## Decisions blocking implementation

Each needs the user's answer; recommendation and trade-off are stated so the answer can be a yes or a no.

| Decision | Recommendation | Trade-off |
| --- | --- | --- |
| D-A: check inventory declared in code (`checks.ts` per mapping) versus generated from a data file | declare in code | a data file becomes a DSL without evidence of need; code keeps the comparison logic reviewable next to its declarations |
| D-B: expose the evaluated check inventory in the decision document | add it as an additive field and keep `DECISION_VERSION` at 1 | additive and regenerated per run, but if any consumer treats the document as closed-schema the version should be bumped instead; this is a contract call, not an implementation detail |
| D-C: enforce the plan's ≥100 tile requests per cold/warm run as a declared bound | enforce it | the plan states it, so it is an existing obligation; enforcing it will newly fail runs that currently pass on samples alone, which is the intended effect but must be visible in the migration table |
| D-D: publication when the read-set cannot be recovered | never replace `--out`; write `<out>.rejected.json` | keeps C7 satisfied and cannot destroy evidence, but a caller that reads only `--out` will miss the diagnostic and must read stderr |
| D-E: assertion severity when a record carries no route role | gap, matching the retained Python rule | a fail would be stronger, but an unlabelled record may be valid evidence for another route, so refusal rather than condemnation is the honest verdict |
| D-F: whether a built-revision mismatch may be excused by recorded build evidence | do not adopt the excuse path now | the retained Python gate has it and tests it, but no producer in this checkout emits `builtArtifact` or `buildEvidence`, so adopting it would add an untested dead path; if the plan later requires it, it belongs in its own check |

## Approval requested

The user is asked to approve or reject, as independent design review of this document:

1. the structural conclusion — that the demonstrated defects are one family (a check whose reachability is decided by imperative control flow, a claim inferred from supplied data, and an output-safety rule derived after validation) rather than four unrelated bugs, and that the prose-only tie between `assertion_evidence_map.md` and the mappings is why the family survived two repair rounds;
2. Option B as the bounded change, with Option A's fixes as its content, and the rejection of a rewrite or a generic DSL;
3. the publication policy in full, including the sibling-diagnostic rule and the decision that overwriting a provably non-input destination stays allowed;
4. the ordering S1–S7 with per-slice decision-document comparison as the migration oracle, and the definition of success for the next authorized implementation: **fewer escaped invariant families at independent review**, not a higher test count;
5. the blocking decisions D-A to D-F.

Approval of this document authorizes nothing by itself: no implementation, no Q experiment, no remaining Python migration, no N1, no producer change, no requirement, tolerance, pin, budget or UI change, and no closure of `canopi-kqpp`. The scratch reproducer used here is deleted rather than committed.

## Limits of this reassessment

Inspected revision and build identity are recorded above and were verified by recompilation. Everything else is bounded by three limits: the audit swept the mappings and the decision path by reading them and by mutating one coherent synthetic corpus, so absence of a finding in a file is not evidence of correctness; no producer ran, so every producer-side statement here is read from tracked source rather than measured; and no independent review has examined this document yet, which is the next step rather than a completed one.
