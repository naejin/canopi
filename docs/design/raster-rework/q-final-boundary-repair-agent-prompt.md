# Qualification tooling — bounded boundary repair

Status: retired — delivered through `933fb593` and independently reviewed; original examples repaired, NC1–NC2 remain. The [numeric completion handoff](q-numeric-counter-repair-agent-prompt.md) supersedes this assignment. It authorizes nothing further.
Current guidance: [repair receipt](q-typescript-receipt.md#b1b3-boundary-repair-implementation-response), [measurement-readiness handoff](q-typescript-receipt.md#measurement-readiness-handoff), [standing review](q-typescript-review.md#b1b3-implementation-response-at-95028481-implementer-not-acceptance), [settled design](q-typescript-reassessment.md).
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
## Assignment and first action

The text below is the historical assignment, not a current instruction. Delivered under it: the B1–B3
repair, a bounded same-family sweep, seven guard-removal probes in isolated copies, the settled design's
final gates (266 TypeScript tests in place and from a fresh output directory, 261 retained Python tests,
18 runner checks, syntax, docs and diff checks), and a measurement-readiness handoff. Q remains
unqualified and `canopi-kqpp` stays open.

Repair the three confirmed families B1–B3 in the linked independent disposition. Complete the existing D1–D5 design, not a new architecture or language migration. The user remains the courier; the reviewer owns design and independent acceptance. One consolidated delivery, not a handoff after each case.

Read AGENTS.md, the linked guides/design/review and the **tdd**, **craft** and **codebase-design** skills with their required references. Inspect git status, `bd show canopi-kqpp`, and intervening changes; claim and record this bounded scope before coding. Preserve the branch stack through `d6b3f8e1`, design `ac68fb64`, and approved UI `0e696722`. Continue the user's existing feature branch; do not reset to main. No subagents or direct reviewer contact.

Authorized surfaces: `scripts/raster-qualification/ts/src/publication.ts`, `evidence/{numericTransport,preparation,resources}.ts`, focused supporting helpers only where needed for these defects, associated TypeScript/CLI tests, and affected documentation. Retain the explicit check driver, single decision authority, decision version 2, immutable publication, existing assertions, pins, tolerances and budgets. No dependencies, generic validation framework, new evaluator, producer changes, Python changes/deletion, engine build/download, private experiment, production Rust/frontend/N1, integration or release.

## Fixed behavior

The standing review owns the exact baseline mutations and expected results. Implement these decisions without asking for another design round:

| Family | Required repair and proof |
| --- | --- |
| B1 — absent-input aliases | Canonicalize absent input paths using their existing ancestors, then append the unresolved suffix; compare consistently with output paths. Only genuine absence permits that treatment: other resolution errors refuse publication. Do not create input directories or follow an unsafe fallback. Test both entry modes, valid and rejected requests, alias on either side, absent leaf and missing intermediate directories, plus a distinct fresh output control. A protected absent input stays absent; refusal exits 2 and retains the existing owned-diagnostic policy. Preserve existing-file, dangling-link and creation-race guards. Concurrent malicious directory replacement remains outside D3. |
| B2 — independent failures | Numeric dimensions and ledger counters must be parsed and checked individually before any cross-field comparison. Width above the edge limit fails even without height; negative bytes fail even without request count. Area/corroboration comparisons lacking operands gap without erasing those failures. Sidecar disappearance observed after recorded presence remains failure even without policy; policy absence is also recorded as a gap. A genuinely not-applicable control without contradictory observations retains its behavior. Preserve all independently known failure reasons at assertion and requirement levels. |
| B3 — malformed versus absent | Absent required leaves gap; present unusable leaves fail. In particular, window width `"bad"` and `routeRole: null` fail, rather than becoming gaps. Exercise null, wrong primitive/container types, non-finite/invalid numeric representations where admissible through parsing, and valid boundary controls. Do not use coercion or truthiness. Preserve explicit candidate/reference attribution and unsupported resource-policy gaps. |

Routine implementation choices remain yours. Split a check or accumulate its independent findings locally where appropriate; merely wrapping the same early return in another helper does not repair B2. No blanket `inconclusive` → `fail` conversion: missing evidence is still missing evidence.

## Execution and acceptance

Use vertical RED → GREEN → refactor cycles from physically coherent controls. Drive domain and publication cases through raw reports and the real emitted CLI. Assert target assertion, target requirement, identifying failure and gap reasons, unaffected requirements, exit class and file preservation as applicable. Overall exit 1 alone is insufficient because unsupported requirements already block Q.

Perform one bounded same-family sweep across the changed checks and their shared helpers: individual malformed/absent leaves, failure alone then failure-plus-gap, record permutations where applicable, and both CLI publication entry modes. Fix counterexamples within B1–B3 before delivery. Do not audit or redesign every subsystem again. Newly found threats to verdict validity or input preservation are blockers: record concrete reproduction and fix only if within this scope; otherwise stop with the exact required expansion. Cosmetic cleanup and speculative hardening go to follow-up beads, not acceptance blockers.

Use isolated guard-removal probes for alias normalization, independent failure retention and malformed-leaf classification. Prove each detects the intended behavior, not an unrelated permanent gap; report redundancy or zero results honestly. Retain the previous display/artifact failure-plus-gap regressions. Existing Python tests remain frozen references, not the verdict oracle.

Run the settled design's final gate commands, including fresh-output compilation/tests, retained Python regressions, runner stubs, syntax, docs and diff checks. Do not run `run_all_experiments.sh` against real/private evidence. Do not fabricate identities for old reports. Record unavailable environments instead of inferring coverage.

Acceptance for this slice: B1–B3 and their bounded sweep have no known remaining counterexample; required checks pass; independent reviewer confirms the repaired boundaries. Tooling acceptance does **not** qualify Q. There is no requirement to increase test counts or deliver a new abstraction.

## Delivery, next milestone and stop

Update the existing migration receipt and standing review with a revision-labelled implementation response, not self-acceptance. Update index/debrief and affected Q/LiDAR guidance; retire this prompt after delivery. Keep cycle/reproduction evidence compact and reproducible, using the existing evidence folder. Do not create another receipt or per-defect prompt. Record actual commands, findings, controls corrected, limitations and semantic changes. Keep `canopi-kqpp` open; commit/push/sync according to repository delivery rules while preserving user work.

Include a short **measurement-readiness handoff**, not an experiment implementation: map the existing mandatory Q gaps to their current producer/host availability; identify prerequisites for measuring the scoped local bridge in Desktop WebView, then remaining correctness/lifecycle/resource obligations. Distinguish a missing producer from a missing run or environment. Cite existing requirement IDs and contracts; do not change acceptance limits or claim a measurement. This gives the reviewer a concrete basis for the next user-authorized experiment scope.

Stop after this consolidated delivery for independent review through the user. After tooling acceptance, the intended next milestone is fresh bounded qualification evidence, prioritizing local transport and Desktop hosting before expensive runs. That milestone needs a separate explicit execution assignment. No automatic experiment, producer migration, Python retirement, engine substitution or N1 follows. UI prototype approval and engine-route decisions remain with the user.
