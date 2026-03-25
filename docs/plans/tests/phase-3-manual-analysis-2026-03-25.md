# Phase 3 Manual Test Analysis

Date: 2026-03-25

## Bottom Line

My honest opinion: the project is not fundamentally doomed, but the current Phase 3 execution model is fundamentally wrong.

The broad architecture is still reasonable:

- Rust for persistence and file I/O
- Preact for shell/state
- Konva as an imperative canvas subsystem

What is failing is the way Phase 3 was built and validated. Too many high-interaction features were added at once, too many of them were treated as "done" while still behaving like isolated demos, and the automated tests do not cover the workflows that are actually breaking in manual use.

With the new information that a Tauri MCP server is now installed, the verification gap is more serious, not less. UI-level regression checking is no longer just a future infrastructure idea; it is an immediate tool we should be using during stabilization.

Your updated manual results show failure clusters across grouping, prompt-driven tools, callouts, dimensions, display modes, minimap, map, timeline UX, GeoJSON validation, and product-fit for consortium/budget ([phase-3-manual-tests.md](/home/daylon/projects/canopi/docs/plans/tests/phase-3-manual-tests.md#L43), [phase-3-manual-tests.md](/home/daylon/projects/canopi/docs/plans/tests/phase-3-manual-tests.md#L69), [phase-3-manual-tests.md](/home/daylon/projects/canopi/docs/plans/tests/phase-3-manual-tests.md#L94), [phase-3-manual-tests.md](/home/daylon/projects/canopi/docs/plans/tests/phase-3-manual-tests.md#L145), [phase-3-manual-tests.md](/home/daylon/projects/canopi/docs/plans/tests/phase-3-manual-tests.md#L159), [phase-3-manual-tests.md](/home/daylon/projects/canopi/docs/plans/tests/phase-3-manual-tests.md#L202), [phase-3-manual-tests.md](/home/daylon/projects/canopi/docs/plans/tests/phase-3-manual-tests.md#L231), [phase-3-manual-tests.md](/home/daylon/projects/canopi/docs/plans/tests/phase-3-manual-tests.md#L261)).

## Findings

### 1. High Severity: Phase 3 scope exceeded the project's integration capacity

Phase 3 added 15 units of work spanning guides, grouping, plant stamping, pattern fill, dimensions, display modes, minimap, MapLibre, celestial dial, consortiums, timeline, and export ([phase-3-canvas-advanced-location.md](/home/daylon/projects/canopi/docs/plans/phase-3-canvas-advanced-location.md#L42)). That is too much surface area for a canvas app whose interaction model was still stabilizing.

This is why the failures feel "basic": the problem is not one bad widget. The problem is that too many interdependent editing behaviors were layered on top of each other before the selection, transform, overlay, and persistence loops were hardened.

### 2. High Severity: several features are implemented as disconnected demos, not as coherent user workflows

Pattern fill and spacing rely on `window.prompt()` instead of integrated UI flows ([pattern-fill.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/tools/pattern-fill.ts#L36), [spacing.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/tools/spacing.ts#L50)). That is a strong smell in a design tool. Even if they technically worked, they would still feel bolted on.

Multi-select is `Shift`-based only; there is no `Ctrl`/`Cmd` additive selection path in the select tool ([select.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/tools/select.ts#L101), [select.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/tools/select.ts#L134)). Your complaint about core selection UX is consistent with the implementation.

The bottom panel fully disappears when collapsed, leaving only a floating reopen button ([CanvasPanel.tsx](/home/daylon/projects/canopi/desktop/web/src/components/panels/CanvasPanel.tsx#L149), [BottomPanel.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/BottomPanel.tsx#L41)). That matches your discovery complaint.

Location/map controls live in a separate world-map panel instead of in the main design workflow ([WorldMapPanel.tsx](/home/daylon/projects/canopi/desktop/web/src/components/panels/WorldMapPanel.tsx#L10)). That is not a runtime bug, but it is bad product structure for a canvas-first tool.

### 3. High Severity: state ownership is still split across multiple authorities, which keeps generating sync bugs

`state/document.ts` explicitly calls itself a transitional boundary and still delegates to serializer/engine composition ([document.ts](/home/daylon/projects/canopi/desktop/web/src/state/document.ts#L1)). At the same time, `state/canvas.ts` mirrors document state like `designLocation`, `currentConsortiums`, map visibility, minimap visibility, bottom-panel state, and display-mode state into separate signals ([canvas.ts](/home/daylon/projects/canopi/desktop/web/src/state/canvas.ts#L75), [canvas.ts](/home/daylon/projects/canopi/desktop/web/src/state/canvas.ts#L87), [canvas.ts](/home/daylon/projects/canopi/desktop/web/src/state/canvas.ts#L91)).

That pattern is exactly the kind of setup that produces "toggle says on, UI says off, canvas did something else" bugs.

Two concrete examples:

- Minimap visibility is just a signal flip in the toolbar ([CanvasToolbar.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/CanvasToolbar.tsx#L226)), but the minimap only updates when the engine redraw path runs ([engine.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/engine.ts#L347), [minimap.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/minimap.ts#L80)). That makes the toggle wiring brittle.
- Display-mode coloring fetches species data asynchronously ([CanvasToolbar.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/CanvasToolbar.tsx#L244), [engine.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/engine.ts#L1246)), but the render effect only reacts to signals, not to cache completion ([engine.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/engine.ts#L270)). That makes your "By Stratum" failure entirely believable.

### 4. High Severity: grouping and transform math are fragile

Grouping is implemented by manually reparenting nodes and recomputing child positions from `node.x()`/`node.y()` ([grouping.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/grouping.ts#L37), [grouping.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/grouping.ts#L163)). That is fragile in any canvas app, and especially risky here because plants already use group-based transforms and counter-scaling.

Serialization collects plant positions via absolute positions ([engine.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/engine.ts#L1279)), while dimension updates resolve attachment points via local `node.x()`/`node.y()` ([dimensions.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/dimensions.ts#L143)). That mismatch is exactly the kind of transform inconsistency that causes "it attaches, but not to the same point anymore" bugs.

This is the strongest candidate for the repeated "display issue every time we add a new canvas feature" pattern. The transform model is not yet robust enough to be the base for so many secondary features.

### 5. Medium Severity: overlay features are wired imperatively and fail badly when the sync chain breaks

The minimap, rulers, timeline, and map are all extra HTML layers or canvases around the stage, not first-class canvas objects ([minimap.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/minimap.ts#L6), [InteractiveTimeline.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/InteractiveTimeline.tsx#L31), [map-layer.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/map-layer.ts#L25)).

That can work, but only if the redraw/sync contract is extremely disciplined. Right now it is not.

The map path is especially brittle: turning the map on can make the canvas background transparent before the map is successfully available ([engine.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/engine.ts#L692), [engine.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/engine.ts#L703), [map-layer.ts](/home/daylon/projects/canopi/desktop/web/src/canvas/map-layer.ts#L66)). That matches your "canvas becomes blank" report.

### 6. Medium Severity: some Phase 3 features do not match the real product model

The timeline editor is still mostly a form + table with a canvas strip above it, not a mature Gantt workflow ([TimelineTab.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/TimelineTab.tsx#L152), [InteractiveTimeline.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/InteractiveTimeline.tsx#L71), [BottomPanel.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/BottomPanel.tsx#L88)).

The consortium feature is still a CRUD form that asks users to type plant IDs by hand ([ConsortiumTab.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/ConsortiumTab.tsx#L54), [ConsortiumTab.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/ConsortiumTab.tsx#L137)). That is not a credible end-user flow.

The budget tab is a generic spreadsheet-style CRUD list disconnected from placed plants ([BudgetTab.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/BudgetTab.tsx#L82), [BudgetTab.tsx](/home/daylon/projects/canopi/desktop/web/src/components/canvas/BudgetTab.tsx#L151)). Your feedback that this is not the right model is correct.

This matters because even bug-free code would still feel wrong here.

### 7. High Severity: the automated feedback loop is not protecting the risky behaviors

I ran `cargo check --workspace` and it passed. I ran `npm test` in `desktop/web` and all 31 tests passed. That is exactly the problem.

The main Phase 3 test file explicitly covers pure-function math/helpers and does not cover the actual workflow risks: serializer round-trip, grouped transforms, interactive map activation, selection/grouping behavior, or tool interaction paths ([phase3-regression.test.ts](/home/daylon/projects/canopi/desktop/web/src/__tests__/phase3-regression.test.ts#L1)).

So the project can be "green" while the manual experience is still badly broken.

The new Tauri MCP capability changes the recommendation here. It does not replace proper Playwright/CI coverage, but it removes a major excuse for not exercising the desktop app at the interaction layer while we stabilize it. In other words: app-level regression checks are now operationally feasible enough that we should treat the current blind spot as a process failure, not just a tooling gap.

## Honest Opinion

I do not think the core app architecture is the fundamental mistake.

I do think the current implementation process is.

The team treated a large batch of advanced canvas features as implementable in one pass without forcing each one through a strict interaction-quality gate. The result is a stack of partially integrated behaviors. That is why the project feels untrustworthy.

If development continues in the same pattern, quality will keep getting worse even if more checkboxes turn green.

If the project stops feature expansion now and refocuses on a smaller core, it is still very salvageable.

## What I Would Do Next

1. Freeze Phase 3 expansion immediately. Do not add new features until the existing interaction model is stable.
2. Cut or placeholder the weakest-fit features for now: consortium and current budget model first. I would also stop pushing timeline sophistication until the base editor behavior is clean.
3. Rebuild around a small acceptance bar:
   - place/select/multi-select
   - move/transform/delete
   - group/ungroup
   - save/load round-trip
   - map toggle without blanking
   - export correctness
4. Make one source of truth for document-backed state. Reduce mirrored canvas/document signals where possible.
5. Add real integration coverage for the risky paths before calling Phase 3 stable:
   - group/save/load
   - display-mode recolor after async fetch
   - minimap toggle + viewport sync
   - map enable/disable + redraw
   - dimension attachment after move/transform
6. Use the Tauri MCP server immediately for repeatable desktop smoke runs of the broken flows. At minimum, automate: tool switching, multi-select/group/ungroup, map toggle, minimap toggle, timeline selection, and GeoJSON export initiation.
7. Keep Playwright/CI as the longer-term target, but stop treating UI automation as deferred. Tauri MCP gives us enough leverage now to catch interactive regressions while we refactor.
8. Revisit product-fit before implementation for timeline, consortium, and budget. Right now those areas are not only buggy; some are conceptually off-target.

## Final Judgment

You are not imagining it. The lack of confidence is justified.

The project is not fundamentally wrong at the technology-choice level.

It is fundamentally wrong at the current Phase 3 scope, workflow design, and verification level. That is fixable, but only if the next step is consolidation, not more feature delivery.

The Tauri MCP server changes the recovery path: from this point forward, stabilization should include repeatable UI-driven verification, not just code inspection plus manual spot checks.
