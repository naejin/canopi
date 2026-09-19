# Raster rework — user-mediated implementation and review

Status: active — local working agreement for this rework, not a replacement for repository rules.
Tracking: `canopi-j571`; execution state and follow-ups belong in bd.
Current guidance: [AGENTS.md](../../../AGENTS.md), [delivery](../../workflow/delivery.md), [debrief](review-and-debrief.md), [handoff index](README.md).

## Ownership and courier boundary

The main agent investigates, explains choices, settles design and acceptance criteria, prepares a bounded handoff, and independently reviews the delivered revision. The implementation agent (the user's subagent) implements that handoff, tests it, performs scoped self-review and records evidence. The user chooses whether to forward the handoff or review and retains product/engine/UI/scope authority. Calling the implementer a subagent does not authorize automatic spawning, direct messages or an unattended repair loop.

Forward the handoff path and commit, then return the delivery with commit/branch and receipt path. The repository artifacts must suffice without reconstructing chat history. A delivery is not acceptance; acceptance is not Q qualification, integration or release. Reviewer findings must cite an existing invariant, a reproducible observation, severity and the precise work it blocks. New requirements need user approval, not retroactive enforcement.

## One bounded loop

The main agent supplies outcome, baseline, retained work, interfaces, failure semantics, exclusions, proof and stop conditions. The implementer resolves routine coding choices locally and completes internal milestones without requesting approval for each test or defect. In-scope counterexamples are fixed before handoff. Material design conflicts return through the user with evidence and a recommended choice. Unknown optional cleanup is tracked separately, not used to reopen accepted work.

The reviewer tests the agreed risk boundaries and consolidates findings into one disposition: accepted, partial with named blockers, or unavailable evidence. Preserve independently accepted behaviors. Do not restart a broad architecture review merely because a focused defect appears. If a recurring family escapes again, explain the missing invariant/test dependency and settle that specific design choice; do not ask the implementer to rediscover architecture by trial and error. No unlimited automatic rounds.

## Delivery evidence and continuous improvement

Use one revision-labelled section in the existing receipt, not a new report per defect. Include: baseline/delivery commits; scope and deviations; implemented versus independently accepted versus genuinely measured; meaningful RED/GREEN and sensitivity evidence; exact gates/limitations; new real Q capabilities and product slices; Python replacements/deletions with remaining consumers; next blocked dependency and authority needed. State zero capability gain when the work is tooling-only. Test counts support verification, not productivity claims.

After each review, the main agent records the disposition in the standing review and adds only new, actionable process evidence to the debrief: escaped invariant family, self-review versus reviewer discovery, mistaken fixture/expectation, missing design decision, and review coverage limit. Record timing/cost/courier-cycle data only if actually observed. Do not infer model or language causes from one sequence of repairs.

For each proposed improvement, name the observed failure, a small change, the next slice on which it will be tested, and what evidence would show benefit. Adopt demonstrated lessons into a regression, focused guide or tooling; changes to skills/repo-wide workflow require their own authority. Retire old prompts, replace stale current guidance, and keep historical evidence revision-labelled. The final debrief compares accepted outcomes and measured effort across slices, not just message count.
