# Qualification tooling — numeric counter completion

Status: retired — executed and delivered at `e1f7ac95`; the delivery is recorded in the [receipt](q-typescript-receipt.md#nc1nc2-numeric-counter-completion-implementation-response) and awaits independent review. Kept for the assignment record; it authorizes nothing further.
Current guidance: [numeric completion receipt](q-typescript-receipt.md#nc1nc2-numeric-counter-completion-implementation-response), [standing review](q-typescript-review.md#nc1nc2-implementation-response-at-e1f7ac95-implementer-not-acceptance), [readiness handoff](q-typescript-receipt.md#measurement-readiness-handoff).
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [independent disposition](q-typescript-review.md#boundary-repair-independent-disposition), [settled design](q-typescript-reassessment.md), [C1–C8](q-admission-acceptance.md), [LiDAR guide](../../agent/lidar.md).

## Mandate and start

Finish the two remaining numeric defects NC1–NC2 in the linked disposition and reconcile the readiness correction MR1. No redesign or broader audit. The user remains the courier; stop for independent review after one consolidated delivery.

Read AGENTS.md, the linked design/review and relevant workflow guides. Read and apply **tdd**, **craft** and **codebase-design**, including required references; do not change skills. Inspect git status, intervening changes and `bd show canopi-kqpp`; claim and record scope before coding. Preserve the existing feature branch through `933fb593`, implementation `95028481`, design `ac68fb64`, all earlier fixes and approved UI `0e696722`. Do not reset to main or use subagents.

Code ownership: `scripts/raster-qualification/ts/src/evidence/numericTransport.ts` and its focused tests. Reuse existing raw-report/CLI fixtures and check outcomes. Change a shared helper only if necessary for these counter semantics and verify its callers; no new abstraction layer, dependency, evaluator or schema version. Documentation ownership: the existing receipt/readiness section, standing review, debrief, index and affected current-guidance links. No publication, resource or sidecar rewrite.

## Fixed semantics and acceptance cases

Let T be `testedWindows`, B be `serverLedger.fixtureBytesServed`, and R be `serverLedger.fixtureRequests`. All three count discrete things: supplied values must be finite nonnegative integers; fractions, negative values, null, strings, booleans and containers fail. Missing values gap. Zero is a valid counter value, not necessarily evidence of a successful experiment. Retain the existing rule that T=0 demonstrates no successful numeric read. Do not coerce or round.

Read each counter independently. Evaluate each relationship using only its actual operands; a third counter is not a prerequisite. Preserve failures and missing/malformed sibling findings together. Keep current positive controls and unsupported requirements unchanged.

| Case, from coherent raw-report control | Required observable result |
| --- | --- |
| Independently replace T, B or R with `0.5` | Relevant numeric assertion and Q-LOCAL-1 fail with the field/value identified; no pass based merely on finiteness |
| T=9, B=0; omit R | Ledger assertion and Q-LOCAL-1 fail for zero bytes despite validated reads; missing-R gap also retained |
| T=9, R=0; omit B | Symmetric failure for zero requests; missing-B gap retained |
| T=0, B>0 with R absent; T=0, R>0 with B absent | Existing contradiction between zero validated windows and recorded activity remains at the ledger assertion; unrelated missing counter also gaps |
| Positive whole counters with one missing counter but no independently known contradiction | Ledger remains inconclusive, not pass or fabricated failure |
| Genuine required comparison operand missing | Only that relationship is undecidable; other independent checks still run |
| Negative or malformed counter plus a missing sibling | Invalid supplied value fails and missing sibling gaps; invalid values never participate in arithmetic |
| Coherent positive whole counters, unchanged original B1–B3 regressions | Applicable positive assertions still pass; prior repairs stay effective |

The evidence source is the existing D1–D2/C1/C8 contract and counter units, not the old output distribution. No new byte/request ratio, required window count or scientific tolerance is introduced. Do not infer server-byte equality to a nonexistent client counter. Do not turn all incomplete evidence into failure.

## Work and verification

Use vertical RED → GREEN → refactor cycles. Reproduce NC1–NC2 with the actual emitted CLI from `roleReports()` and the real requirement/declaration fixtures. Prove target assertion and requirement verdicts, identifying reasons, retained gaps, unaffected requirements and exit class; overall exit 1 alone proves nothing because permanent gaps already block qualification.

Do one bounded matrix over these three counters: valid whole/zero/fractional/negative/malformed/absent values and the independent operand pairs above. Assert the ledger itself for T=0 cases so the separate no-window assertion cannot mask a skipped comparison. Preserve the existing boundary-repair tests. Use isolated guard-removal checks for integer validation and each independent relationship; detectors must fail on the intended assertion/reason, not an unrelated gap. Report redundancy or zero results honestly. Do not repeat a repository-wide adversarial review.

Run the settled design's final gates: TypeScript compile and tests, fresh-output compile/tests, frozen Python regressions, runner stubs, shell syntax, docs and diff checks. Use approved subprocess access where needed; never weaken tests for sandbox behavior. No real/private experiment runner invocation or fabricated provenance. Unavailable evidence stays explicit.

## Readiness correction and delivery

MR1 is a documentation correction, not producer authorization. The receipt has been corrected: `measure.py q2-local-bridge` checks stripped-layout rejection and prefix metadata; its name does not establish successful scoped Desktop transport. Retain that negative control as such. A later assignment must provide a positive producer actually exercising the scoped bridge on a readable prepared derivative, establish Desktop host provenance and align report wiring. Changing the filename, role, transport label or identity envelope alone cannot establish that capability. Verify the corrected statement against producer code and reconcile any remaining contradictory guidance; do not implement the producer now.

Update one revision-labelled section in the existing `q-typescript-receipt.md`, the standing review with implementation responses (not self-acceptance), and the debrief. Include exact RED/GREEN commands, bounded matrix coverage, sensitivity results, semantic changes and final checks. Record zero new real Q capabilities for this tooling-only slice. Do not create another receipt or per-defect prompt. Retire this prompt after delivery and point to its outcome.

Fix discoveries within these numeric semantics before handoff; stop and name the required authorization for an out-of-scope correctness blocker. Optional cleanup is a separate follow-up, not reason to expand this slice. Follow repository commit/push/tracker delivery rules, keep `canopi-kqpp` open, and preserve user work.

Stop after delivery through the user. No automatic continuation, experiment, producer/Python migration or deletion, engine substitution, production N1, integration or release. Tooling acceptance and Q acceptance remain separate; UI and engine choices remain with the user.
