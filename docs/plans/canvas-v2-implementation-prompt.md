Status: in progress. Phases 0, F, 1, 2, 3 and R, the 2.0 bug fixes, the 2.0 cleanup, the U-crs redesign, the 2.0 polish batch, the Layers redesign and the step "2.0 live bugs, guards and location" are done (2026-10-02 to 2026-10-10). Next (U57): the step "2.0 plant along a path" (canopi-f47t.54), then the release close (plan section 4); 2.0 ships the week after 12 October. The architecture refactors (U52) are the first step of 2.1, planned after 2.0 ships. Deleted with the plan at the release close.

# Canvas v2: session brief

Trimmed at the docs cleanup of 2026-10-09 to what the next session needs; the text before it, with the sections now owned elsewhere, is at `fc4f556f` (earlier trims: `7f3baadd`, `f2db5e1a`, `c453bb21`, `bfbdf053`, `e45053ea`, `62a5bacb`, `7d92abf5`).

You are the main agent finishing Canopi's canvas v2 in the integration worktree. What remains is the step "2.0 plant along a path" (U57), the release close, then the hand-over to the release. Everything ships together as 2.0 (U1); no step is a release candidate on its own.

## 1. Where the rules live

One owner per rule; point agents at these instead of restating them.

- [`AGENTS.md`](../../AGENTS.md): the operating contract, the gates table, data and locale rules, the handoff.
- [`docs/guides/agentic-delivery.md`](../guides/agentic-delivery.md): Canopi's places, gate commands, review triggers, live and Web checks, tracker, models and tools.
- The user-level `phased-agentic-delivery` skill: the procedure (design check, one question batch, amendment, commit 0, streams, verified reviews, serial merges, real-environment check, pre-push review, usefulness pass, receipt and retrospective) and the workflow templates and gotchas.
- [`canvas-v2-plan.md`](canvas-v2-plan.md): section 1 indexes the user's decisions (U1–U56) and where each lives; section 4 holds each step's goal, items and exit; section 7 the open beads.
- ADRs 0015–0020 (canvas) and 0021 (stored data); [`canvas-v2-spec.md`](canvas-v2-spec.md) for contracts, read by section only when a step touches it.

## 2. Read path for the 2.0 plant along a path step

About 12k tokens; nothing else is read up front.

1. `AGENTS.md`.
2. `docs/guides/agentic-delivery.md`.
3. The `phased-agentic-delivery` skill (`SKILL.md`, then `references/workflow-step.js`, `references/gotchas.md`, and `references/review-protocol.md` when the step reaches it).
4. Plan section 1, the lines for U39, U53, U54, U55 and U57.
5. Plan section 4, "2.0 plant along a path": goal, agreed UX, the questions it carries, procedure, exit; `bd show canopi-f47t.54` (the full agreed design).
6. The current Plant a row (`desktop/web/src/canvas/runtime/tools/plant-row.ts`, `plant-spacing-sequence.ts` and their tests) and ADRs 0002 and 0015–0021 by section when the design check reaches them.

The release close's read path (plan section 4, "2.0 release close", with U33, U41 and its question-batch adds) is read after this step closes. Plan section 4, "2.1 architecture", waits for 2.1's planning.

## 3. Phase order

```
phase 0 ─▶ F ─▶ 1 ─▶ 2.0 bug fixes ─▶ 2.0 cleanup ─▶ U-crs ─▶ 2 ─▶ 3 ─▶ R ─▶ polish (f47t.30) ─▶ Layers (f47t.42)   all done
  ─▶ 2.0 live bugs, guards and location (.52.1–.52.4, .52.17, canopi-f47t.53)   done ─▶ 2.0 release close ─▶ hand-over to canopi-2v5a, canopi-fxil.12
  ─▶ (2.1) 2.1 architecture (.52.5–.52.16, canopi-f47t.37) ─▶ hydrology (canopi-5ys2.1), P5 with its prototype and canopi-j9ry, canopi-224j
```

What each done step shipped and changed for users is in plan section 4 under its name.

## 4. Open beads

Read with `bd show`, `bd dep tree canopi-f47t`, `bd list --parent canopi-f47t` and `bd ready`; the slots are plan section 7. Subagents make no `bd` writes.

- **2.1 architecture (first step of 2.1):** canopi-f47t.52 with .52.5–.52.16, .52.18–.52.22 and canopi-f47t.37 (S16); each item kept or dropped by its planning against the target ADR; canopi-f47t.13, .15, .16 and .31 (U54); canopi-a1n2 (Desktop location).
- **Release close:** canopi-f47t.29 (1) and (4); canopi-k94s with P10; P34 asked in its question batch; canopi-f47t.11 gets spec §6's last paragraph (R3); canopi-f47t.52.23 (the exception ratchet, or 2.1) and canopi-er58 (touch flake).
- **Done, close if still open:** canopi-f47t.42 and .43 (the Layers receipt).
- **In progress:** canopi-f47t.19, the usefulness items placed per step in plan section 4.
- **Gate nothing:** canopi-f47t.6.2 (Windows panel drops, U20); the phone or tablet hand check (U41), the user's when possible.
- **After 2.0:** canopi-f47t.9, .10, .32–.36, .38, .44–.47, .49, .50; canopi-p32r and canopi-wx8w (a production-build measurement and profiling); canopi-j9ry with P5 (U43), plus its known-issue line in the 2.0 release notes; canopi-3uaj; the U-crs follow-ups canopi-yox6, canopi-bhwt, canopi-yyjq, canopi-9m01, canopi-qh03, canopi-1aj4 (a later bug batch); canopi-x6qc, canopi-7ve0, canopi-h4ec; hydrology 2.1 (canopi-5ys2.1); canopi-224j.

## 5. What to do first

1. **Plan and build "2.0 plant along a path"** (plan section 4; canopi-f47t.54, U57) with the skill's loop, starting from its design check; then **run the release close** (plan section 4, "2.0 release close"). Orientation, read-only in the user's checkout: `git -C /home/daylon/projects/canopi status --short --branch` (the user's `.beads.gate.lock` is expected), `df -h /`. In the integration worktree: `git status --short --branch` (clean), `git fetch`, rebase if behind (the guide's Places); check CI on the last pushed commit (`gh run list --branch feature/geolibre-adoption --limit 3`).
   Then read section 2's path, and run the design check, one question batch (P34 among them), the amendment, its steps 1–10 and the definition of done; the hand-over to canopi-2v5a and canopi-fxil.12 is its last step.
2. **2.1 architecture comes after 2.0 ships** (plan section 4, "2.1 architecture"); the user reviews the list of future changes first.

At each close: the receipt and retrospective of the skill, with Canopi's additions below; merged worktrees and review profiles removed; the finished parts of the plan, the spec and this brief trimmed.

**Receipt additions** (Canopi, on top of `AGENTS.md`'s handoff): the unused-code check's result; the conventions and "(spec)" details shipped; any amendment to an ADR or the spec; the inventory rows cleared; the Web-check engines and limits; the step's entries for the release close (Web steps, docs to check, gallery, release-note lines).
