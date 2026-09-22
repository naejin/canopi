# Raster rework — implementation, review and improvement

Status: active — raster-specific execution and evidence rules for the ordered COG assignment.
Tracking: `canopi-j571`; current execution `canopi-jv8a.4`; bd owns task state and follow-ups.
Current guidance: [architecture ownership](../../workflow/architecture-ownership.md), [current prompt](ordered-cog-agent-prompt.md), [design](ordered-cog-design.md), [debrief](review-and-debrief.md#ordered-cog-delivery-and-final-debrief), [delivery](../../workflow/delivery.md).

## Ownership and courier boundary

The main user-facing agent owns project architecture, decision-complete handoffs and independent acceptance. The implementation agent owns execution, tests, routine local decisions, diagnosis/fixes within the accepted scope and evidence. The user owns product, priority and consequential risk, and remains courier. No subagent delegation, direct agent messaging, integration or release is implied. The [project-wide agreement](../../workflow/architecture-ownership.md) remains authoritative.

The user selected independent ordered COGs and asked that the implementation agent carry as much of the work as possible. Do not reopen the architecture choice, request permission to continue routine work, or transfer discoverable repository facts to the user. The fixed design, including its repair contract after `783e31e3`, settles ordering, history migration, edit completion, legacy compatibility, source ownership and slope refresh. The eleven review groups are one correction assignment; they do not require eleven handoffs. Return material conflicts through the user with evidence and a recommended resolution; continue safe independent work.

## One bounded loop

Read the current prompt/design and necessary guides, inspect the real baseline, claim/re-scope the bead, then implement through all internal dependency gates. Checkpoints record last verified commit, remaining work and next action in bd; they are resumable state, not final delivery or requests for a new prompt. Time/context boundaries do not retire the original required outcomes.

Use one implementation branch and preserve the accepted predecessor stack and user changes. Complete source preparation, persistence, display, slope, UI and real Desktop evidence together. Fix normal-workflow failures in scope. A changed internal module shape, test strategy or contract-preserving simplification is delegated; a different scientific/compatibility/ownership rule is not.

Before forwarding, the implementer performs a separate final diff/contract review and repairs its findings. One concise receipt carries revision, capabilities, exact gates, limitations and unresolved decisions. The main agent then reviews changed risk boundaries and live-workflow evidence proportionally. A new requirement is not a retroactive blocker; a known broken normal workflow is not cosmetic merely because its local fix touches another file.

## Product closure policy

The `6a5130b3` source-merge architecture freeze is retired. It led to C1/C2 repairs and real Desktop evidence at `0696bd3d`, but product closure remained partial. The current ordered COG prompt supersedes that assignment and includes the observed stale map/History/analysis behavior after Undo.

Block delivery acceptance for demonstrated data loss, wrong scientific results, broken required workflows, violated resource/compatibility guarantees, missing required evidence or materially false claims. Tie findings to a concrete accepted rule, reachable case and impact. Cosmetics, speculative hardening, unrelated refactoring and unmeasured optimization become bd follow-ups. Keep scope and status honest: unavailable Desktop/platform evidence is pending, not a substitute success.

Run focused tests while changing code and required broad gates on the final candidate. Rerun affected gates after code/rebase changes; do not rerun identical code for a prose-only edit. No mandatory mutation count, transcript volume, harness replacement or model-comparison exercise. Use the existing isolated Desktop and gallery setup; stop only owned app processes.

## Delivery evidence and continuous improvement

Make claims at the boundary actually observed: numeric helper, production caller, job settlement, library reopen, live UI, packaged platform. A passing helper cannot prove downstream publication or refresh. Fixture descriptions must match bytes and assertions; receipts cannot infer RED-before-GREEN or performance from final code. Useful sensitivity checks name the removed guard, intended failure and healthy control.

Record observations while working in the existing bead/receipt: a repeated failed command, missing handoff decision, misleading fixture, incorrect tool success or avoidable resumption request. Do not keep a separate diary or task tracker. At delivery, add one compact outcome to the [debrief](review-and-debrief.md#ordered-cog-delivery-and-final-debrief); the reviewer adds acceptance/escapes after inspection. Historical evidence stays revision-labelled and does not accumulate as contradictory current guidance.

A demonstrated task-local tooling problem may be fixed during this assignment when the repair is small, reversible and tested, uses existing dependencies, and directly improves implementation or trustworthy verification. Prefer the smallest regression or existing-script correction. Verify the failing case and healthy control, then return to product work; do not turn tool repair into a new framework project. Keep command failures visible and compare experiment restoration against the saved starting bytes, not HEAD when the starting file was dirty.

Broader skills, shared workflow automation, dependency changes and unrelated tool projects require a separately scoped proposal/bead. The implementer may describe and prioritize them with evidence, not silently install or redesign them. Continuous improvement means applying proven local fixes and retaining actionable proposals; it does not mean repeatedly adding instructions to every failure.

For each improvement record: observed failure and revision, whether existing instructions already covered it, classification/owner, smallest intervention, test/use evidence, recurrence or still-unmeasured benefit, and keep/revise/drop recommendation. Categories are design omission, implementation deviation, test/oracle gap, reviewer oversight and environment/tool limitation; allow overlap. The main agent owns unnecessary design complexity and omitted decisions as well as review misses.

At final debrief, compare accepted user capability, retained versus removed machinery, correction effort and necessary versus avoidable courier exchanges. Use time/cost only when recorded; otherwise unknown. Test count, code/doc volume and assumed model pricing do not prove productivity. Promote demonstrated lessons into the narrowest regression, guide or tool, with verification and an owner; do not invent a causal ranking of models or languages.
