# Plan: Timeline MVP Trim

## Context

The timeline panel is fully built (Gantt chart, CRUD, drag interactions) but hidden behind a placeholder BottomPanel. Before shipping it, we studied a real-world agroecological design document (Tortue Zebre) and identified that the current feature set is over-engineered for garden planning — it resembles a project management Gantt chart rather than a seasonal planner. This trim removes features that don't serve the domain, then enables the panel.

**Goal**: Ship the simplest timeline that helps agroecological designers plan seasonal work.

**Craft principle**: Correct > Clear > Simple. Each removal must not break round-trip serialization or create visual defects. The `completed` and `order` fields stay in the TypeScript/Rust types for schema compatibility — we only remove their UI surface.

---

## Trims (6 removals)

### 1. Drop Week view granularity

Garden planning happens at month/season/year scale, not day/week. Two zoom levels instead of three — less decision fatigue, cleaner header.

**`desktop/web/src/components/canvas/InteractiveTimeline.tsx`**:
- Line 30: Change type to `export type Granularity = 'month' | 'year'`
- Lines 32-36: Remove `week: 20` from `GRANULARITY_PX_PER_DAY`

**`desktop/web/src/components/canvas/TimelineTab.tsx`**:
- Line 21: Change to `const GRANULARITIES: Granularity[] = ['month', 'year']`

**i18n (11 files)**: Remove `"weekView"` key from `canvas.timeline` in en/fr/es/pt/it/zh/de/ja/ko/nl/ru `.json` files.

### 2. Drop edge resize on bars

Two drag modes (move vs resize) require invisible edge hit zones and cursor changes. One mode is enough — drag moves the whole bar, edit dates in the form.

**`desktop/web/src/components/canvas/InteractiveTimeline.tsx`**:
- Lines 54-61: Remove `'resize'` variant from `DragState` union type
- Lines 213-223: Remove the `if (hit.edge === 'left' || hit.edge === 'right')` block in `handleMouseDown`
- Lines 265-277: Remove the `if (drag?.type === 'resize')` block in `handleMouseMove`
- Line 290: Change cursor logic from `hit.edge ? 'ew-resize' : 'grab'` to just `'grab'`

**`desktop/web/src/canvas/timeline-renderer.ts`**:
- Line 13: Remove `EDGE_THRESHOLD` constant
- Line 423: Simplify `HitEdge` — can become just `'body' | null` or remove entirely
- Lines 469-471: Remove edge classification in `hitTestAction`, always return `edge: 'body'`

**i18n (11 files)**: Remove `"dragToResize"` key.

### 3. Drop auto-populate

Hardcoded Mar 15–Apr 15 planting / Aug 1–Sep 30 harvest for every species generates wrong data. A blank timeline with "+ Add action" is more inviting than garbage bars. Will revisit when species-specific planting data is available from the DB.

**`desktop/web/src/components/canvas/TimelineTab.tsx`**:
- Lines 10-11: Remove `appendAutoTimelineActions` and `buildDefaultTimelineActions` imports
- Lines 111-123: Remove `autoPopulate()` function
- Lines 146-148: Remove the auto-populate button from the header

**`desktop/web/src/state/timeline-actions.ts`**:
- Lines 66-69: Remove `appendAutoTimelineActions()`
- Lines 75-127: Remove `buildDefaultTimelineActions()`

**i18n (11 files)**: Remove `"prePopulate"`, `"acceptSuggestion"`, `"dismissSuggestion"` keys.

### 4. Drop Ctrl+scroll zoom

The canvas above owns Ctrl+scroll. Two zoom targets in one window is confusing. Granularity buttons (Month/Year) are the zoom control.

**`desktop/web/src/components/canvas/InteractiveTimeline.tsx`**:
- Lines 26-28: Remove `ZOOM_FACTOR`, `MIN_PX_PER_DAY`, `MAX_PX_PER_DAY` constants
- Lines 148-159: Remove the `if (event.ctrlKey || event.metaKey)` zoom block inside `handleWheel`. Keep the pan logic (lines 162-165) — horizontal and shift+vertical scroll stay.

### 5. Drop completed state (UI only)

Without recurrence, "completed" is a dead-end toggle. The schema field stays for round-trip safety; we remove the visual and interaction surface.

**`desktop/web/src/canvas/timeline-renderer.ts`**:
- Lines 341-347: Remove completed branch — always use the normal opacity/color path
- Line 372: Remove completed text color branch — always use `surfaceColor`
- Lines 382-390: Remove strikethrough rendering block

**`desktop/web/src/state/timeline-actions.ts`**:
- Lines 58-64: Remove `toggleTimelineActionCompleted()` export

**i18n (11 files)**: Remove `"completed"` and `"toggleCompleted"` keys.

**NOT changed**: `TimelineAction.completed` stays in `types/design.ts` and `common-types/src/design.rs`. New actions still set `completed: false` (line 103 in TimelineTab.tsx) for schema correctness.

### 6. Keep sub-lane stacking (revised from initial brainstorm)

On review, removing this creates a visual defect: overlapping bars in the same species row render on top of each other and become unreadable. The stacking code is 50 lines, self-contained in `computeLayout()`, and handles a real (if uncommon) scenario correctly. Craft hierarchy: Correct > Simple. **Keep it.**

---

## Enable: BottomPanel routing (prerequisite)

The BottomPanel currently renders a placeholder. Route it to the actual tab components.

**`desktop/web/src/components/canvas/BottomPanel.tsx`**:
- Add imports for `bottomPanelTab` signal and all three tab components
- Replace placeholder `<p>` (line 19) with conditional rendering:

```tsx
{bottomPanelTab.value === 'timeline' && <TimelineTab />}
{bottomPanelTab.value === 'budget' && <BudgetTab />}
{bottomPanelTab.value === 'consortium' && <ConsortiumTab />}
```

This incidentally enables BudgetTab and ConsortiumTab, which are also fully built and production-ready.

---

## Files modified (summary)

| File | Change |
|------|--------|
| `desktop/web/src/components/canvas/BottomPanel.tsx` | Route tabs to real components |
| `desktop/web/src/components/canvas/TimelineTab.tsx` | Remove week granularity, auto-populate button |
| `desktop/web/src/components/canvas/InteractiveTimeline.tsx` | Remove edge resize, Ctrl+scroll zoom, week from type |
| `desktop/web/src/canvas/timeline-renderer.ts` | Remove completed rendering, edge threshold, simplify HitEdge |
| `desktop/web/src/state/timeline-actions.ts` | Remove toggleCompleted, auto-populate functions |
| `desktop/web/src/i18n/*.json` (11 files) | Remove trimmed keys (weekView, dragToResize, prePopulate, acceptSuggestion, dismissSuggestion, completed, toggleCompleted) |

## Files NOT modified

| File | Reason |
|------|--------|
| `types/design.ts` | `completed`, `order` fields stay for schema round-trip |
| `common-types/src/design.rs` | Same — schema stability |
| `scene/codec.ts` | Serializes all fields including completed/order — no change |
| `timeline-math.ts` | Pure date math, nothing to trim |

---

## Execution order

1. **BottomPanel routing** — enables the panel so we can verify visually
2. **TimelineTab.tsx trims** — remove UI elements (week button, auto-populate button)
3. **InteractiveTimeline.tsx trims** — remove edge resize, zoom, week granularity
4. **timeline-renderer.ts trims** — remove completed rendering, edge hit detection
5. **timeline-actions.ts trims** — remove dead functions
6. **i18n cleanup** — remove orphaned keys from all 11 locale files

## Verification

1. `npx tsc --noEmit` from `desktop/web/` — no type errors
2. `cargo tauri dev` — launch app
3. `driver_session start` — connect MCP
4. Open the Tortue Zebre `.canopi` file (has 5 timeline actions)
5. Click timeline tab in bottom panel launcher — verify it renders
6. Verify header shows: **Month | Year | Today | count | + Add action** (no Week, no Auto-populate)
7. Add an action via form — verify it appears as a Gantt bar
8. Drag a bar — verify whole-bar move works, no edge resize cursor appears
9. Scroll wheel on timeline — verify horizontal pan only (no Ctrl+scroll zoom)
10. Verify no strikethrough or faded bars (completed rendering removed)
11. Switch to Budget tab — verify it renders (incidental enable)
12. Switch to Consortium tab — verify it renders (incidental enable)
13. Save and reopen the file — verify timeline actions round-trip with `completed` and `order` fields intact

## Craft review

| Checkpoint | Status |
|---|---|
| Blast radius traced | All removed exports only referenced in files being modified |
| Schema invariants preserved | `completed`, `order` stay in types/codec — round-trip safe |
| Tests checked | `scene-runtime.test.ts:126` uses `completed: false` in fixture — unaffected (type unchanged) |
| No new failure modes | Removals only |
| Codebase conventions matched | CSS Modules, `t()` i18n, signals — all maintained |
| Dead code audit | Removed functions have zero external callers. i18n keys have no remaining UI references |
