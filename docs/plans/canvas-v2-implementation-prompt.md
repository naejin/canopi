Status: in progress. Phases 0, F, 1, 2, 3 and R, the 2.0 bug fixes, the 2.0 cleanup, the U-crs redesign, the 2.0 polish batch and the Layers redesign are done (2026-10-02 to 2026-10-09). Next: the 2.0 architecture step (canopi-f47t.52; U50, U52), planned in its own session, then built in a later one; then the release close. Deleted with the plan at the release close.

# Canvas v2: session brief

Trimmed at the docs cleanup of 2026-10-09 to what the next session needs; the text before it, with the sections now owned elsewhere, is at `fc4f556f` (earlier trims: `7f3baadd`, `f2db5e1a`, `c453bb21`, `bfbdf053`, `e45053ea`, `62a5bacb`).

You are the main agent finishing Canopi's canvas v2 in the integration worktree. What remains is the 2.0 architecture step (canopi-f47t.52) and the release close, then the hand-over to the release. Everything ships together as 2.0 (U1); no step is a release candidate on its own.

## 1. Where the rules live

One owner per rule; point agents at these instead of restating them.

- [`AGENTS.md`](../../AGENTS.md): the operating contract, the gates table, data and locale rules, the handoff.
- [`docs/guides/agentic-delivery.md`](../guides/agentic-delivery.md): Canopi's places, gate commands, review triggers, live and Web checks, tracker, models and tools.
- The user-level `phased-agentic-delivery` skill: the procedure (design check, one question batch, amendment, commit 0, streams, verified reviews, serial merges, real-environment check, pre-push review, usefulness pass, receipt and retrospective) and the workflow templates and gotchas.
- [`canvas-v2-plan.md`](canvas-v2-plan.md): section 1 indexes the user's decisions (U1–U52) and where each lives; section 4 holds each step's goal, items and exit; section 7 the open beads.
- ADRs 0015–0020 (canvas) and 0021 (stored data); [`canvas-v2-spec.md`](canvas-v2-spec.md) for contracts, read by section only when a step touches it.

## 2. Read path for planning the 2.0 architecture step

About 14k tokens; nothing else is read up front.

1. `AGENTS.md`.
2. `docs/guides/agentic-delivery.md`.
3. The `phased-agentic-delivery` skill (`SKILL.md`, then `references/planning.md` and `review-protocol.md` when the step reaches them).
4. Plan section 1, the lines for U50 and U52.
5. Plan section 4, "2.0 architecture": the approach (likely changes with one owner each, the scenario walk, change coupling from git history, the target ADR, the S-items mapped onto it, data contracts), the build order (fitness functions with ratchet lists first, one boundary per stream) and the stopping rule.

The S-items' area reports and the release review's synthesis are local evidence in `.rq-scratch/tools/release-arch-review/`; the plan's table and each bead carry what a stream needs.

## 3. Phase order

```
phase 0 ─▶ F ─▶ 1 ─▶ 2.0 bug fixes ─▶ 2.0 cleanup ─▶ U-crs ─▶ 2 ─▶ 3 ─▶ R ─▶ polish (f47t.30) ─▶ Layers (f47t.42)   all done
  ─▶ canopi-f47t.52 (2.0 architecture: plan, then build) ─▶ 2.0 release close ─▶ hand-over to canopi-2v5a, canopi-fxil.12
  ─▶ (after 2.0) hydrology 2.1 (canopi-5ys2.1), P5 with its prototype and canopi-j9ry, canopi-224j
```

What each done step shipped and changed for users is in plan section 4 under its name.

## 4. Open beads

Read with `bd show`, `bd dep tree canopi-f47t`, `bd list --parent canopi-f47t` and `bd ready`; the slots are plan section 7. Subagents make no `bd` writes.

- **2.0 architecture:** canopi-f47t.52 with .52.1–.52.17 and canopi-f47t.37 (S16); each item kept or dropped by the planning against the target ADR.
- **Release close:** canopi-f47t.29 (1) and (4); canopi-k94s with P10; P34 asked in its question batch; canopi-f47t.11 gets spec §6's last paragraph (R3).
- **Done, close if still open:** canopi-f47t.42 and .43 (the Layers receipt).
- **In progress:** canopi-f47t.19, the usefulness items placed per step in plan section 4.
- **No slot in the plan yet:** canopi-f47t.13, .14, .15, .16, .31 and .51 (a story step showing a hidden Site data item draws nothing); slot them in the architecture planning's question batch.
- **Gate nothing:** canopi-f47t.6.2 (Windows panel drops, U20); the phone or tablet hand check (U41), the user's when possible.
- **After 2.0:** canopi-f47t.9, .10, .32–.36, .38, .44–.47, .49, .50; canopi-p32r and canopi-wx8w (a production-build measurement and profiling); canopi-j9ry with P5 (U43), plus its known-issue line in the 2.0 release notes; canopi-3uaj; the U-crs follow-ups canopi-yox6, canopi-bhwt, canopi-yyjq, canopi-9m01, canopi-qh03, canopi-1aj4 (a later bug batch); canopi-x6qc, canopi-7ve0, canopi-h4ec; hydrology 2.1 (canopi-5ys2.1); canopi-224j.

## 5. What to do first

1. **Plan canopi-f47t.52 in a fresh session, planning only.** Orientation, read-only in the user's checkout: `git -C /home/daylon/projects/canopi status --short --branch` (the user's `.beads.gate.lock` is expected), `df -h /`, `bd show canopi-f47t.52`. In the integration worktree: `git status --short --branch` (clean), `git fetch`, rebase if behind (the guide's Places); check CI on the last pushed commit (`gh run list --branch feature/geolibre-adoption --limit 3`).
   Then read section 2's path, then run plan section 4's planning steps (1)–(6), the design check, one question batch and the amendment with the target ADR, the owners file, commit 0's failing user-path tests and the briefs. Build nothing.
2. **Build it in a later session** from the amended plan: commit 0 (the gate tooling the guide dates to it, the policy tests with their ratchet lists, the failing user-path tests), then one boundary per stream, reviews, serial merges with gates, the live and Web checks, the pre-push review, one push, and the close against the stopping rule.
3. **Then the release close** (plan section 4, "2.0 release close"): design check, one question batch (P34 among them), amendment, its steps 1–10 and the definition of done.

At each close: the receipt and retrospective of the skill, with Canopi's additions below; merged worktrees and review profiles removed; the finished parts of the plan, the spec and this brief trimmed.

**Receipt additions** (Canopi, on top of `AGENTS.md`'s handoff): the unused-code check's result; the conventions and "(spec)" details shipped; any amendment to an ADR or the spec; the inventory rows cleared; the Web-check engines and limits; the step's entries for the release close (Web steps, docs to check, gallery, release-note lines).
