# TypeScript qualification decision path — agent prompt

Status: retired — migration delivered in `df54b314` / `abf502b6`; independent review found remaining blockers. See the [standing review](q-typescript-review.md) and [repair prompt](q-typescript-repair-agent-prompt.md). Do not re-execute this migration prompt; its instructions below are historical.
Tracking: parent `canopi-j571`, qualification `canopi-kqpp`; bd owns execution status.
Current guidance: [main plan](../raster-data-analysis-rework.md#qualification-tooling-language-and-migration), [acceptance contract](q-admission-acceptance.md), [review/debrief](review-and-debrief.md), [LiDAR guide](../../agent/lidar.md).

## Assignment and boundaries

Replace the raster qualification **decision path** with TypeScript: raw report/declaration bytes → runtime parsing and admission → assertion evidence → requirement verdict → CLI exit. Deliver a complete, independently reviewable replacement, not a line-by-line port. C1–C8 remain the acceptance contract. Q stays unqualified and N1 unstarted. Harness acceptance does not qualify an engine.

Read AGENTS.md, the linked guidance and the relevant local skills before coding. Apply **tdd**, **craft**, and **codebase-design**, including their required references. Record how they changed actual work; do not modify skills or use subagents. Inspect git status and `bd show canopi-kqpp`; record this bounded scope and claim it before coding. Preserve the current accepted stack through `3a7ec9eb`/`a874dec0`, the independently accepted R5 behaviors and approved UI `0e696722`. Use the existing qualification branch; do not reset to main or discard preceding fixes. Follow repository delivery rules.

Owned surfaces: new TypeScript source/tests/configuration under `scripts/raster-qualification/ts/`, thin CLI/build wrappers alongside the harness, the requirement-gate routing in `run_all_experiments.sh`, assertion evidence documentation, and directly affected design/operating docs. Do not change scientific requirement IDs, candidate pins, tolerances, budgets, production Rust/frontend, shared types, UI, or engine selection. No new dependencies or production-manifest changes are authorized. Unrelated Python tooling is out of scope.

The Python admission/evaluator is frozen for comparison, not an oracle. Do not repair or delete it in this slice. Existing Python generators, native reference measurements, server/bootstrap and experiment commands remain legacy tools pending later replacement. Existing `.mjs` probes are reusable producers; do not rewrite them or generate new engine evidence here. No private benchmark runs, engine downloads/builds, new worker/host experiments or network qualification. Small synthetic report tests and read-only reconciliation of available old reports are allowed.

## Fixed implementation decisions

- Use the existing compiler installed for `desktop/web`, with an isolated strict TypeScript configuration and emitted Node CLI/tests. The inspected checkout has TypeScript 5.9.3 and Node types installed there; verify availability before use. Use Node's test runner for emitted tests so this tool does not depend on browser application composition. Keep emitted files ignored and disposable; commit source/configuration only. No app import of harness code. If clean-checkout reproducibility requires an added dependency, stop with the specific dependency need rather than silently adding it.
- Keep `requirements.json` and `candidates.json` authoritative and unchanged. The existing assertion map is an inventory to audit, not proof that every mapping is scientifically sufficient. Preserve every required assertion; unsupported observations must remain explicit gaps.
- Parse external bytes as unknown data. Validate declarations, reports, bundles and all nested consumed fields before using them. Reject duplicate object keys before ordinary JSON decoding loses them; reject nonfinite numbers, wrong booleans, fractional/negative counters and unsupported versions. Missing and malformed remain distinct. Read each source once, hash those bytes, and retain its identity and findings through the reduction. Type assertions are not runtime validation.
- Expose one authoritative qualification operation over declared expectations and raw source snapshots. Both the programmatic API and CLI invoke it. Serialized bundles are diagnostic outputs, not trusted claims of admission. If a bundle is supplied for evaluation, resolve explicitly supplied original sources and declarations and recompute admission/verdicts; unavailable originals block qualification. Never trust `admission.verdict`, `sourceAdmitted`, or an assertions map as proof. Do not follow arbitrary file paths embedded in an untrusted bundle.
- Use one failure/gap reduction: known failure outranks independent gaps at every layer. Preserve diagnostic reasons. Synthetic controls exercise the same real path with complete internally coherent evidence, are explicitly marked, and cannot publish a qualifying CLI result. Internal test-only permission must not be a CLI qualification switch.
- Reduce measurements per required run and then across runs. Require coverage, finite units and complete attribution for each run; never union counters from incomplete runs or take first-record sampling. Enforce every applicable C5 budget, including display disk cache and the plan's staging/free-space policy. Missing support means inconclusive, not an invented cap or a pass. Keep measured failures even in incomplete runs.
- CLI writes a versioned diagnostic decision when output is writable and exits zero only on full eligibility. Malformed input is a structured diagnostic, not a traceback. Output failure is nonzero with clear stderr and no saved-output claim. Keep source files immutable and write only to an explicit fresh output root. Do not modify old evidence to add provenance or refresh run times.

## Ordered work and acceptance

1. **Baseline and behavioral inventory.** Run existing focused tests without experiments. Map C1–C8 and each required assertion to the current producer fields, independently specified expected behavior and replacement test. Inventory old CLI callers and choose explicit legacy rejection/compatibility messages. Record existing test defects; preserve useful regressions, not incorrect assertions or the Python output as an oracle.
2. **First vertical slice.** Build one complete raw-report-to-CLI requirement path with valid, missing, malformed, conflicting and known-failure-plus-gap controls. A green internal test alone is insufficient: exercise emitted CLI with real small temporary inputs. Then extend that same path across all requirements; no second evaluator or generic schema platform.
3. **Complete contract and adversarial review.** Parameterize boundary families and combinations, not just the prior examples. Cover the reviewed counterexamples below and all C1–C8 rows. Audit each evidence mapping for adequacy, not merely matching assertion names. Keep unavailable capabilities blocked. Use isolated reversible guard-removal checks for the material invariants and record zero-result checks honestly.
4. **Runner integration.** Route the runner's final qualification decision to TypeScript, retaining experiment comparison as diagnostic only. Test with deterministic command stubs in fresh roots: eligible/ineligible aggregate, failing step despite eligible aggregate, missing/corrupt sources, unwritable output and no alternate path bypassing the gate. Do not execute the private experiment pipeline. Production acceptance requires no Python import/subprocess anywhere in the new admission/evaluation path; legacy measurement commands may still use Python and must be labelled as such.
5. **Independent-review handoff.** Run all gates, reconcile documentation and produce one `q-typescript-migration-receipt.md` in this folder. Stop for independent review. Do not delete Python, begin another migration phase, run Q experiments or start N1 on your own authority.

### Required counterexamples from review at `3a7ec9eb`

These are additions to regression coverage within the existing matrix, not replacement acceptance criteria:

| Input / operation | Required result |
| --- | --- |
| Old `passing_evidence()` control with only admission labels and no supporting provenance/declarations | Must not qualify through the normal public path |
| Admission says `fail`, `sourceAdmitted: true`, all assertion labels say pass | Must not become pass; recompute from sources and preserve the known failure |
| Bundle timestamp is NaN; unadmitted entry has `observed: ["bad"]` | Invalid input diagnostic, nonzero, no crash |
| Two candidate records each omit a different mandatory counter | Inconclusive for missing per-run evidence, not a fictional complete run |
| First run sampled at 100 ms, second at 900 ms | Fail the 100 ms sampling bound, regardless of ordering |

Use positive controls that establish the actual contract before perturbing one input. Add failure-plus-gap cases on distinct paths so one failure cannot mask whether another guard works. Do not claim whole-family coverage merely because one example passes.

## Verification, delivery and debrief

At implementation time, document and execute exact build/typecheck/test/CLI commands from the repository root. Intended toolchain: `desktop/web/node_modules/.bin/tsc` with the isolated configuration, then `node --test` over emitted tests and real emitted CLI subprocess checks. These are planned entry points, not existing verified scripts. Verify a clean build has no dependence on old emitted files or a global compiler. Run the retained Python regression suite, stub runner tests, `python3 scripts/check_docs.py`, `git diff --check`, applicable shell/JavaScript syntax checks and all repository gates triggered by changed files. No Rust tests are required if Rust remains untouched.

The receipt must link each C row and required assertion to actual tests/source evidence; list deliberate semantic corrections and unsupported capabilities; record exact commands, exit codes, starting/final revisions, source digests for any read-only reconciliation, and unavailable evidence. No prescribed verdict distribution for old reports. Capture sanitized RED/GREEN and adversarial-review results, including defects in the agent's own fixtures. Do not commit raw private pixels, sensitive paths or large outputs.

Update bd, the index, debrief and affected Q/LiDAR guidance. Record source/test size, direct dependencies, evaluator entry points, independent-review rounds, escaped invariant failures and elapsed effort when actually measured. Compare with the Python baseline; missing cost/time data stays unknown. Separate language/toolchain benefits from architecture and review-process benefits. File deferred migration work in bd; do not create a Markdown task tracker.

Deliver one consolidated receipt and stop. Fix same-class contract violations autonomously within this assignment; do not request a new prompt per failing case. Escalate only material authority changes (scientific/engine decisions, new dependencies or experiments, unavailable required tools). Cosmetic follow-ups cannot block acceptance. Review acceptance, Q qualification, integration and release remain separate decisions.
