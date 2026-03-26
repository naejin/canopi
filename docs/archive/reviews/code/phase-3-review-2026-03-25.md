# Phase 3 Code Review

Date: 2026-03-25

Scope reviewed:
- Current working tree for the Phase 3 canvas/location changes, including the new Phase 3 modules.
- Verification run: `cargo check --workspace`
- Verification run: `npm run build` in `desktop/web`
- Verification run: `npm test` in `desktop/web`

## Findings

### 1. Medium: the new Phase 3 regression test file overclaims coverage and does not actually protect the highest-risk behaviors

`phase3-regression.test.ts` says it validates grouped plant round-trip, absolute-transform GeoJSON export, and persistent plant ID round-trip ([desktop/web/src/__tests__/phase3-regression.test.ts:2](/home/daylon/projects/canopi/desktop/web/src/__tests__/phase3-regression.test.ts#L2), [desktop/web/src/__tests__/phase3-regression.test.ts:5](/home/daylon/projects/canopi/desktop/web/src/__tests__/phase3-regression.test.ts#L5), [desktop/web/src/__tests__/phase3-regression.test.ts:7](/home/daylon/projects/canopi/desktop/web/src/__tests__/phase3-regression.test.ts#L7)). But the actual tests only cover:

- `extractExtra()` behavior ([desktop/web/src/__tests__/phase3-regression.test.ts:16](/home/daylon/projects/canopi/desktop/web/src/__tests__/phase3-regression.test.ts#L16))
- pattern math helpers ([desktop/web/src/__tests__/phase3-regression.test.ts:30](/home/daylon/projects/canopi/desktop/web/src/__tests__/phase3-regression.test.ts#L30))
- projection math ([desktop/web/src/__tests__/phase3-regression.test.ts:90](/home/daylon/projects/canopi/desktop/web/src/__tests__/phase3-regression.test.ts#L90))
- budget CSV export ([desktop/web/src/__tests__/phase3-regression.test.ts:124](/home/daylon/projects/canopi/desktop/web/src/__tests__/phase3-regression.test.ts#L124))

There are no tests invoking `toCanopi()`, `fromCanopi()`, `buildGeoJSON()`, `getPlacedPlants()`, or any map-toggle/lazy-init path ([desktop/web/src/canvas/serializer.ts:36](/home/daylon/projects/canopi/desktop/web/src/canvas/serializer.ts#L36), [desktop/web/src/canvas/serializer.ts:154](/home/daylon/projects/canopi/desktop/web/src/canvas/serializer.ts#L154), [desktop/web/src/canvas/geojson.ts:29](/home/daylon/projects/canopi/desktop/web/src/canvas/geojson.ts#L29), [desktop/web/src/canvas/engine.ts:1271](/home/daylon/projects/canopi/desktop/web/src/canvas/engine.ts#L1271), [desktop/web/src/canvas/engine.ts:363](/home/daylon/projects/canopi/desktop/web/src/canvas/engine.ts#L363)).

This is not a runtime bug, but it is a real maintenance risk: the file currently communicates stronger regression protection than it actually provides.

## Resolved Since Prior Round

- Map code is now split behind a lazy boundary at build time. The production output contains a small `map-layer` chunk plus a separate `maplibre-gl` chunk, instead of folding all map code into the main path.
- The added test suite runs and passes: `3` test files, `31` tests total.
- The prior runtime correctness issues remain closed:
  - Map viewport sync is on the normal redraw/zoom paths.
  - Consortium hulls use absolute plant positions and rerender from plant drag and consortium edits.
  - Attached dimensions update after transformer-based edits.
  - Grouped-plant serialization, GeoJSON transform handling, and location-input resync remain intact.

## Verification Notes

- `cargo check --workspace` passed.
- `npm run build` passed.
- `npm test` passed.

## Residual Risk

- The main production chunk is still large and Vite still emits chunk-size warnings. The MapLibre split helps, but the build is not yet within a clearly enforced performance budget.
- I did not run interactive/manual canvas scenarios, so this review is based on code-path inspection plus build/test verification rather than direct UI reproduction.

## Recommendations

### 1. Make the regression tests match their stated purpose

- Add a real serializer round-trip test that exercises `toCanopi()` and `fromCanopi()` with grouped plants and stable IDs.
- Add a `buildGeoJSON()` test with transformed/grouped geometry and assert exported coordinates come from absolute transforms.
- Add at least one smoke test around map enable/location state, even if it only verifies the lazy path is entered and the sync function is called with the expected state.
- Rename the current test file or narrow its header comment until those higher-value cases actually exist.

### 2. Finish the performance-governance part of the bundling work

- Add an explicit size budget script or CI check so future chunk growth is caught automatically.
- Decide whether the current `index` chunk size is acceptable for Phase 3; if not, keep splitting secondary feature codepaths until the budget is met.
