# TypeScript qualification — decision-complete design

Status: partial — design retained; delivery `933fb593` independently reviewed with original B1–B3 examples repaired and NC1–NC2 still blocking acceptance.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
Current guidance: [numeric completion handoff](q-numeric-counter-repair-agent-prompt.md), [C1–C8 contract](q-admission-acceptance.md), [standing review](q-typescript-review.md), [main plan](../raster-data-analysis-rework.md#qualification-tooling-language-and-migration), [LiDAR guide](../../agent/lidar.md).

## Authority, outcome and baseline

The user delegated design ownership to the reviewing agent after independent review of the reassessment delivered in `55d6f485`. This document replaces that proposal's unresolved D-A–D-F choices and S1–S7 sequence. Its historical investigation remains recoverable at that commit; [Round 2 findings and reassessment discoveries](q-typescript-review.md#round-2-independent-disposition) remain evidence, not superseded facts.

Outcome: the single TypeScript decision path preserves every independently decidable failure and reason, requires affirmative evidence for success, and cannot overwrite input files on either successful or rejected requests. Implement against unchanged C1–C8, not against a target count of tests or a prescribed distribution of private verdicts. Complete the bounded implementation and stop for independent review via the user. Harness acceptance is not Q qualification, integration, release or permission for N1.

Inspected baseline: `55d6f485`; TypeScript implementation is still `c76d1b2e`. Preserve the full branch stack, prior fixes and approved UI `0e696722`. Relevant sources: `scripts/raster-qualification/ts/src/`, its tests, `requirements.json`, `candidates.json`, the runner and retained Python regression cases. No requirement, pin, scientific tolerance, resource budget or approved UI changes.

Fixed scope: TypeScript decision code/tests, the thin shell runner and stub tests, assertion evidence map and affected docs. No new dependencies, second evaluator, general-purpose validation DSL, engine experiment/build/download, production frontend/Rust work, private-evidence regeneration, Python repair/deletion or producer migration. TypeScript remains tooling authority; native raster operations remain Rust/native GDAL. Keep frozen Python as reference material, never as the acceptance oracle. No user product decision remains open for this slice.

## Evidence and structural diagnosis

The reviewer independently ran the existing 177 TypeScript tests, 261 Python tests and 14 runner checks at Round 2; they passed despite these real-CLI counterexamples:

| Family | Failure to eliminate |
| --- | --- |
| R2-A | A failed tile becomes inconclusive when `ok` is missing; a page error disappears when a render count is missing |
| R2-B | Missing coverage hides another artifact's wrong version; missing built revision hides a present wrong pin |
| R2-C | One requested/rendered tile plus 100 latency samples passes display qualification |
| R2-D / N-2 | Rejection overwrites an input in request mode with invalid `now`, or directory mode with unreadable contract |
| N-1 | An absent `routeRole` is classified as a separately labelled reference measurement |

N-1/N-2 were demonstrated by the reassessment agent; the standing review distinguishes that attribution. Its build-identity verification and Python comparisons are reported evidence, not newly rerun measurements here. No real engine or platform run supports this design.

There are three mechanisms, not one universal cause: independent comparisons are skipped before reduction; observations lack required relationships/coverage; publication lacks ownership on rejection paths. A central precedence function fixes none of these alone. Choose a focused check-execution seam plus a separate publication module, preserving existing parsing/admission/reduction. More visible checks are a review aid, not proof of semantic correctness. The claim that this will reduce review cost remains a hypothesis for the debrief.

## D1 — explicit check outcomes and one verdict owner

Use `evidence/checks.ts` as a small internal seam; this is ordinary TypeScript, not a schema interpreter. Each requirement owns its declared check inventory. Each check has a stable id, exactly one contract assertion id, and a pure evaluation over the already-read source snapshots and declared expectations. A check evaluates one independently decidable fact (for example a run's failed-tile count, not its entire rendering verdict). Checks may share pure parsing helpers, never another check's mutable findings.

The evaluator returns a required `CheckOutcome` with these semantics:

- `satisfied`: strict boolean, explicitly stating whether affirmative applicable evidence established this fact;
- `evidence`: source role, snapshot digest and concrete field/record references supporting the result, plus declaration references where a comparison uses them;
- `failures` and `gaps`: separate lists of attributed reasons; both may exist and neither discards the other.

There is **no default success**. A pass requires `satisfied=true`, nonempty applicable evidence, and no failures or gaps. Unsupported obligations return `satisfied=false` plus their specific gap. A deliberate not-applicable policy needs its supporting declaration/observations; it is not an empty success. An omitted/undefined/malformed outcome, a thrown check, or contradictory success-plus-failure is a structured internal-check defect: fail closed, retain other findings, continue other independently executable checks, exit nonzero. Do not call it a measured engine failure. A well-formed unsatisfied outcome with no explanation becomes an explicit gap, never pass. Validate evidence references against the same snapshots; caller-supplied strings or an evaluated check id alone cannot establish support.

The driver owns execution, outcome validation, attribution, coverage and conversion to the existing `Findings`/precedence helpers. It returns derived assertion verdicts, reasons and check receipts; mappings no longer write independent verdicts for migrated assertions. `decide.ts` combines those results with existing source admission. An unadmitted source cannot qualify a requirement, but its readable failures remain observable. No mutable aggregate findings object is passed between checks.

Define mandatory check ids before inspecting supplied observations. Every contract assertion has at least one required check or an explicit unsupported check. Reject duplicate/unknown ids and missing implementations; absence of coverage is a named gap. Cover the declaration's required artifact/fixture set, not just supplied entries. Per-run/per-record facts evaluate **all** records without stop-on-first-gap; preserve indices/keys for diagnostics and reject ambiguous duplicates. Empty required observations cannot pass. Required-set coverage is a separate check from comparisons against present records.

Registering one check for an assertion does not establish semantic completeness: the independently authored acceptance cases below and C1–C8 still govern which facts must exist. The check inventory is reviewable code; the evidence map cites it but does not generate expected test outcomes. `reads` metadata is optional documentation, not execution authority or a sufficient test oracle.

### Same-record and cross-record retention

A check may stop a comparison only when one of **that comparison's** operands is unusable. For example:

- Compare a present claimed pin to the declared pin even if built revision is missing.
- Compare each present version even if another required artifact is absent.
- Read a recorded failed-tile count and page errors even if `ok` or other counts are missing.
- Retain a budget violation in an unsampled record and when a separate record is malformed.
- Keep raw recorded failures even when admission/provenance has a gap.

Malformed present values fail; absent values gap, subject only to documented unavailable-value exceptions. Do not coerce booleans, counters or role labels. Readable independent contradictions still fail alongside malformed/missing siblings.

## D2 — domain checks and compatibility

All 12 requirements and their 68 existing assertion ids remain in scope. Do not invent passing host/lifecycle/cache observations. Migrate unsupported assertions as explicit gaps with their reasons. Preserve the additional display-disk-cache and staging-policy gaps attached to Q-RES-1 even though they are not new assertion ids.

| Area | Required decisions |
| --- | --- |
| Display | Independently evaluate run outcome, failed tiles, page errors, counters and their reconciliation. Each required cold/warm run needs at least 100 requests and 100 finite nonnegative individual latencies; sample count equals successfully rendered tile count for this producer, and rendered + failed equals requested. Retain recomputed median/p95/max, cache state and 50 ms UI bound. Fix positive fixtures to match these relationships: the old 128-render/100-sample control is not an oracle |
| Resources | Accept only explicit `candidate`/`reference` role labels consistent with the existing route contract. Absent role is a gap; null, invalid role or contradictory identity fails. Never infer reference from “not candidate”. A reference-label assertion cannot pass on unlabelled data; missing reference evidence remains a gap under the existing contract. Check each applicable counter/budget independently across every candidate record |
| Artifacts | Independently check declared coverage, each version, claimed pin, observed revision and build evidence. D-F below preserves the reproducible-build route. Do not use prose notes or a boolean as correspondence |
| Numeric/preparation | Preserve strict window limits, transport identity, ledger corroboration, both tiling and block-bound checks, cell/metadata preservation and before/after sidecar observations. Missing sibling operands cannot hide a known violation; do not infer additional real capabilities from adjacent named assertions |
| Members/values/CRS/lifecycle/host | Reuse relevant named-check helpers and admitted evidence semantics, but return explicit outcomes through the same driver. Required sources and unsupported facts remain mandatory. Negative-control success never proves a positive capability |

### D-F — reproducible-build correspondence is retained

The main plan already permits obtainable published artifacts **or** reproducible pinned builds. Absence of a producer for build evidence does not remove that admission path. Use the retained Python cases to identify regressions, not to copy weaknesses.

For each declared artifact/version, accept either a recorded published revision matching the declared pin, or a fully evidenced replacement built from that pin. Preserve the existing recorded vocabulary: `builtArtifact.{name,version,sha256}`, `sourceRevision`, `buildEvidence.{command,sha256}` (retain optional log reference), and strict `buildReproduced=true`. The claimed pin must still match the independent declaration; build evidence cannot excuse a wrong claimed pin.

For the replacement route, require a matching name/version and valid SHA-256 in the q1 `verifiedArtifacts` entry, equal to `builtArtifact.sha256`. Cross-check that digest against `identity.artifact.sha256` on every declared consuming source using that artifact. Add these optional digest leaves to the existing admission vocabulary if absent; their presence is mandatory **only for qualifying this build route**. Compare all available identities even if another is missing. No declaration or digest is fabricated for legacy reports.

Wrong source revision, wrong name/version/digest, false reproduction, malformed present build fields or boolean-only “proof” fails. Missing proof alone gaps when no independent violation is established. A recorded published mismatch without a valid replacement remains fail; a complete pinned replacement explains that published mismatch, but never other identity conflicts. The build receipt's command and digest establish recorded correspondence, not cryptographic attestation that a build occurred. Preserve current pin/registry-integrity requirements. Validate with small synthetic controls only; do not run an engine build or read arbitrary log paths from reports.

### Decision document and consumers

Bump only `DECISION_VERSION` to **2** because explicit check receipts and publication behavior are a deliberate tooling contract change. Keep authored `requirements.json` version and all scientific ids unchanged. Existing decision fields remain; add per-requirement check receipts with check id, assertion id, derived verdict, evidence references and separate failure/gap reasons. These receipts are outputs, never admissible input. Preserve programmatic `runQualification` and CLI entry modes; update relevant tests and operating commands together.

Inspect consumers in the runner, stub tests, TypeScript helpers and documentation; update version expectations where present. Do not build a v1 bundle reader or maintain two evaluator authorities. Version-1 historical documents stay historical. Missing legacy provenance remains unknown. During migration compare known affected outcomes and unrelated requirements, normalizing version/check receipts, times and temporary paths; old output is a regression baseline, not expected scientific truth.

## D3 — publication that never overwrites

Choose immutable outputs: **an existing destination is never replaced**, regardless of whether its contents resemble a prior decision. There is no `--force` and no “safe-looking sibling” exception. This strengthens the plan's existing fresh-output-root rule. A caller may re-evaluate unchanged reports into a fresh decision path; it must not delete reports or old decisions to make this invocation work.

Use one `publication.ts` module for successful decisions and rejected-input diagnostics:

1. Collect argument inputs immediately. In directory mode include every `REPORT_FILES` path before validating any file. In request mode recover all structurally available source paths before semantic validation; retain them even when `now`, contract or another entry fails. A partial read-set stays explicitly partial. Reuse parsed snapshots; do not re-read request bytes to make a different safety decision.
2. Refuse a destination matching any known input, even when that input is absent; compare resolved paths and existing canonical aliases. Treat alias-resolution errors as inability to establish safety, not as permission. Refuse existing files/directories/symlinks (including dangling links) without modifying them. No need to prove all unknown aliases: the no-overwrite rule also protects existing hard-linked inputs.
3. With a complete read-set and absent non-input destination, serialize once into an exclusively created staging file in a new helper-owned directory beneath the destination parent. Close the complete file, then publish atomically **without replacement** (a same-filesystem hard-link operation followed by unlinking the owned staging name is the selected Node implementation). A competing creator causes failure, never truncation. Do not fall back to overwriting rename/write if the filesystem cannot support publication.
4. For a collision, existing output, partial/unrecoverable read-set or rejected request with unsafe requested output, create a fresh exclusive diagnostic directory under the requested output's parent. Write a non-qualifying `kind:"rejected-input"` document there using the same safe publisher; report its actual path on stderr. Never choose a fixed `<out>.rejected.json` name. No qualification verdict/requirement array is published as a substitute success.
5. If the parent cannot be used or diagnostic creation/write fails, emit actionable stderr, exit 2 and explicitly state that no diagnostic was saved. Do not claim a path before successful publication. Clean only staging paths created by this invocation; leave existing paths and completed fallback diagnostics untouched.

Known malformed inputs yield structured diagnostics and nonzero exits, not stack traces. Successful publication exits 0 only for full eligibility, 1 for an ordinary nonqualifying decision. Input/internal-check/publication defects exit 2; independent measured failures remain recorded. Programmatic decisions report internal defects consistently even without file publication.

Interruption before publication leaves no final file; after publication the final file is complete. Best-effort cleanup removes only owned staging paths; abrupt termination may leave an owned staging directory, which is not a decision and is never scanned as evidence. No claim of power-loss durability or defense against malicious concurrent directory replacement. Output creation races and ordinary aliases are in scope. A failed or interrupted process cannot be treated as qualification by the runner.

The runner must preflight its final output's freshness **before launching producer steps**, then use the same fixed `$OUT/q-decision.json` path in a fresh run root. Existing output is a nonzero refusal, not automatic deletion. Final CLI status remains authoritative; no stale decision can rescue a failed step. Verify only with stubs; no private run.

## D4 — independent verification contract

C1–C8 are unchanged. Add a test-only acceptance-case inventory derived from those obligations, the main plan and the findings—not by importing production check ids, `reads`, success lists or the Python evaluator. Each case identifies the obligation, fixture/control, independently expected assertion/requirement outcome, expected reason and unaffected requirements. Relate it to check ids only for traceability after deriving expectations.

Use vertical TDD cycles, not all tests first. The inventory specifies cases; implement one behavior and observe its intended RED before its GREEN. Existing tests are retained or replaced only when the old expectation contradicts the accepted contract, with that correction documented. No deletion of Python tests in this work.

| Acceptance case | Required observable outcome |
| --- | --- |
| No-op, undefined/malformed result, nonexistent evidence reference, duplicate check id or thrown check | No pass; structured internal defect or explicit coverage gap as defined by D1; unrelated independent checks and reasons retained |
| Deliberate unsupported check | Specific gap persists; no invented failing-engine control or positive fixture required |
| Failure alone, then same failure plus an independent gap | Same failure and identifying reason survive at assertion and requirement levels; gap also recorded; test same record, another record in both orders, another source and partial declaration where applicable |
| Missing a true comparison operand | Only that comparison gaps; independently executable comparisons still run |
| Samples and counters | Coherent 100/100/100 control passes applicable display checks; 1 request/1 render/100 samples fails; negative sample fails; each counter removed/malformed/contradictory independently blocks or fails correctly |
| Artifact/build alternatives | Direct match passes; full pinned replacement tied to actual measured digests passes correspondence; wrong pin plus missing revision fails; missing artifact plus another wrong version fails; unsupported boolean-only build claim and mismatched consuming digest fail |
| Role attribution | Correctly labelled candidate/reference control; label removal cannot create a reference pass; invalid labels fail; reference memory never substitutes for candidate memory |
| Publication | Both entry modes, valid and rejected requests, existing input/output, malformed/truncated request, partial source list, aliases, dangling symlink, creation race, write failure and interruption: existing bytes unchanged; only complete newly owned documents published; no zero exit on defects |
| Driver coverage and final integration | Every current requirement/assertion covered by explicit outcomes or explicit unsupported gaps; no old direct-verdict mapping remains; no full-Q synthetic qualifying bypass |
| Regression sensitivity | Independently remove outcome requirement, skip a comparison, suppress a failure reason, infer a reference label, and bypass no-clobber in isolated copies; each applicable test detects the behavior change, or documented redundancy is tested as a group |

The retention matrix must cover missing/malformed leaves **within** each check's inputs as well as unrelated leaves, and distinct records matching the same wildcard path. Do not merely enumerate mutations outside declared `reads`. Use the narrower interface for driver defects and filesystem fault injection, plus real raw-report → CLI coverage for each domain/publication family. Never mock admission, mappings or reduction to establish their correctness.

Passing controls must be physically coherent and supported by producer semantics. Unsupported requirements need no fabricated overall pass. Validate negative controls only against rejection obligations. Limits/platform gaps are reported honestly; zero-result sensitivity probes do not count as coverage. Finite coverage is not proof of absence of all defects.

## D5 — implementation sequence and module ownership

One implementation agent owns this slice; no subagents. Preserve the current branch and accepted stack. Each phase is an internal milestone, **not another user approval or courier round**. Use focused reversible commits; update evidence-map rows and relevant docs in the same phase as behavior.

| Phase | Scope and owner | Exit evidence |
| --- | --- | --- |
| S1 — protect publication | New `publication.ts`; `cli.ts` / `request.ts`; runner freshness guard and stub tests; decision version 2 routing | Valid/rejected collision controls, no-clobber/diagnostic/fault tests pass; runner never invokes producers with a stale output; no evaluator semantics changed |
| S2 — first complete requirement | `evidence/checks.ts`, `mapping.ts`, `registry.ts`, `decide.ts`, `qualification.ts`; migrate **all display assertions** and R2-A/R2-C, not just the failing branches | Explicit outcome and no-op/throw guards proven; coherent display controls and retention matrix pass; only documented display/output-schema changes |
| S3 — identity/resource families | Fully migrate `artifactCorrespondence.ts`, `resources.ts` and supporting admission checks for D-F | R2-B/N-1, direct and reproduced-build controls, per-run budget retention and unsupported resource gaps verified |
| S4 — remaining mappings | Fully migrate `numericTransport.ts`, `preparation.ts`, `members.ts`, `values.ts`, `crs.ts`, all three `lifecycle.ts` mappings and `host.ts` | All remaining assertion outcomes registered and explicit; required source/fixture coverage and same-family retention checks pass; missing real observations remain gaps |
| S5 — remove transition and verify | Remove the legacy mapping adapter/direct verdict writers; finish map/drift coverage, CLI/API parity and full suite; update one existing receipt/review/debrief | All 12 requirements/68 assertions use the driver, no competing results; C1–C8 evidence and limitations delivered for independent review |

During S2–S4 a tagged registry entry is either legacy or checked, never both; only checked entries use the new driver. The tag is internal and temporary, never a user bypass. Migrate a whole requirement atomically; do not mix two writers for its assertions. Legacy tags are removed by S5 and final coverage tests forbid them. Existing admission and required-source logic remain active for both branches. Helpers may be reused; do not duplicate a second evaluator. `sources.ts`, strict JSON/declaration parsing and `verdict.ts` are retained unless a demonstrated in-scope contract violation requires a focused regression repair.

Use source snapshots rather than new filesystem reads in mappings. `reduce.ts` may supply leaf parsing/budget helpers but no competing final assertion authority. Keep decision provenance/reasons readable throughout migration. No blank “coverage” registration around an unmodified large mapping: its independently decidable facts must actually become independent checks.

Rollback is a targeted revert of the affected migration commits and their dependants, never a reset of the accepted branch or deletion of evidence. Reverting a safety fix restores an unaccepted state, not a qualified baseline. Do not integrate partial migration as accepted delivery.

## Gates, stop conditions and handoff

Run from the repository root after completing code changes:

```sh
desktop/web/node_modules/.bin/tsc -p scripts/raster-qualification/ts/tsconfig.json
node --test 'scripts/raster-qualification/ts/dist/tests/*.test.js'
python3 -m unittest discover -s scripts/raster-qualification/tests
bash scripts/raster-qualification/tests/test_runner_exit.sh
bash -n scripts/raster-qualification/run_all_experiments.sh
python3 scripts/check_docs.py
git diff --check
```

Also compile into a fresh temporary output directory and run its emitted tests, so ignored/stale dist cannot supply success. Record actual prerequisites and commands. Existing frontend compiler/types are reused; no dependency install is authorized. Sandbox-only subprocess capture failures use the normal approval route; never weaken diagnostic tests. No Rust/frontend feature gates are needed unless scope is separately expanded. Never run the private experiment runner.

Fix in-scope counterexamples during this assignment before handoff; do not stop at each phase merely because a new example was found. Stop for a genuine scope/authority conflict (scientific policy, engine, dependency, new producer/experiment, incompatible external consumer) and name the exact decision needed. Unknown optional cleanup is not a blocker. No silent budget/tolerance changes or invented measurements.

Deliver one revision-labelled section in `q-typescript-receipt.md`, update the single standing review with implementation responses (not self-acceptance), and update index, LiDAR/Q guidance and debrief. Record expected semantic changes versus actual decision diffs, RED/GREEN commands, independently derived cases, guard-removal results including zero results, unavailable environments and remaining real-Q gaps. Keep `canopi-kqpp` open. Follow repository delivery/sync rules without overwriting user work.

The user forwards the consolidated delivery for independent review; no automatic repair loop or direct agent-to-agent exchange. Do not start experiments, producer migration, engine selection, Python deletion, production N1 or integration. Success for acceptance is **zero known C1–C8 blockers in the delivered scope**; fewer escaped invariant families and user handoffs are debrief metrics, not permission to ship residual defects.
