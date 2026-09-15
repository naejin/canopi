# LiDAR foundation review and implementation report

Date: 2026-09-15. Baseline reviewed: `feature/lidar-library-prototype` at `7c91af9af53adcdb26089701b7ad0a590125713f`. Repair issue: `canopi-cldf`. Repair branch: `fix/lidar-foundation-audit`.

## Outcome

The original review rejected slices 1 and 2 as complete after a real Desktop run found persistence, tile placement, coordinate, cache, preview, replay, stale-publication, deletion and job-state failures. The repair preserves the useful catalogue/original/prepared/display/document boundaries and replaces each observed failure at its owning boundary.

The corrected isolated lifecycle now passes with the extensionless IGN `0446_6807` MNT fixture and GDAL 3.8.4. It stages 4,000,000 valid cells, renders readable shared-scale previews, publishes visible XYZ tiles, computes a persisted slope, retains numeric and display files after restart, previews and applies an overlap-only identical reimport, undoes only that second operation, and deletes the complete source/analysis graph. A separate five-by-five plane with one metre rise per horizontal metre produces 45° at its centre.

La Maignannerie remains the synthetic Design Location at `48.220272, 0.033854`. The IGN footprint is approximately 35 km away, so the implemented inspector reports out-of-view coverage and offers **View coverage** plus **Return to Design Location**. The Location gate remains truthful: the map mounts only after a Design has a saved Location.

## Finding disposition

| Original finding | Implemented disposition |
| --- | --- |
| Design normalization discarded LiDAR | Load/save normalization preserves the additive `lidar` section, including presentation order, visibility, opacity and future entry fields. |
| XYZ pyramid used the wrong world grid | Tile counts use `1 << zoom`, coordinates use the western Web Mercator origin, and a known-world grid test owns the equations. The real test decodes a generated PNG and requires nonzero alpha. |
| MapLibre received metre bounds | The native presentation boundary converts EPSG:3857 catalogue bounds to WGS84 degrees. |
| Restart cleanup deleted live tiles | Cleanup compares exact `kind/entity/generation` ownership keys; restart tests require referenced PNG files and visible pixels. |
| Preview assets returned 403 and did not match decisions | Tauri exposes only fixed preview PNG patterns. Default and changed decisions render from staged numeric data, Before and After share one scale, and Apply stays disabled until the current decision preview settles. |
| Persisted grids deserialized as zeros | Geotransforms use validated typed JSON with an explicit legacy reader; missing and non-finite values fail. |
| Replay lost decision semantics and order | `add`, `replace`, and `replace-overlap` remain distinct ordered member roles. Schema v4 ties each member occurrence to its import job, so identical reimports and multi-file undo preserve operation identity. |
| Stale checks had publication races | Import and analysis compare expected heads inside the publishing transaction. Stale reviews restage; stale analysis work queues the current snapshot. |
| Source and analysis deletion failed | Transactional deletion follows foreign-key ownership and is covered with complete row graphs. |
| UI polling/cancellation could stop early | One session job coordinator includes imports, stops on terminal failure/incomplete states, persists review/apply/cancel outcomes and monotonic publication progress, reports errors, and guards Design identity across asynchronous mutations. Ready is published only after display registration succeeds. |

## Implemented Layers dock proposal

The production Layers dock now uses the existing compact ruled-row language. A source row has disclosure, the shared visibility icon, a wrapping identity block and one `ActionMenu`; analysis rows indent beneath it with independent visibility. The complete list stays visible while the selected source or result inspector owns opacity and contextual actions.

The import workbench is a dock subview with persistent staging/applying/terminal states, Escape cancellation, source facts, area summaries plus exact counts, independent uncovered/replacement choices, shared-scale Before/After tabs, and a sticky action footer. Applying shows a localized phase and durable percentage driven by completed backend work, including display-pyramid operations; source staging remains honestly indeterminate. Returning to Layers does not cancel work. Changed decisions request a backend preview revision; stale responses are ignored and Apply remains unavailable until the matching preview is ready.

Deletion impact is visible with an explicit cancel path. History identifies import operations and offers targeted undo. Deterministic gallery states cover La Maignannerie, the remote Normandy footprint, long French content, light/dark themes and the import review at 352 px and the 320 px minimum without horizontal overflow.

## Storage, performance and integrity hardening

- Source copying and hashing stream through a bounded buffer. Existing content-addressed originals are rehashed before reuse.
- Admission allows at most 16 files, 512 MiB per source and 1 GiB per import. A dense union may contain at most 25 million cells; distant extent explosions fail before allocation.
- Composition reads Float32 samples directly from validated raw bytes instead of allocating a duplicate sample vector. Mask construction, remap, composition, statistics, erosion and head expansion carry cancellation checkpoints.
- Every GDAL program, including `gdaltransform`, runs through one adapter with timeout, cancellation and bounded stdin/captured/temp output. Process and scratch cleanup share that owner.
- Prepared member assets publish through staging and are size/hash/metadata checked before reuse. Catalogue migrations and schema version changes commit atomically.
- Numeric generation files and display pyramids finish before a short compare-and-publish transaction advances a source or result head. Failed publication removes unowned files and leaves the previous head intact.
- Admission rejects currently unqualified complex values, rotated/reflected/south-up grids, scale/offset metadata, dataset masks, incompatible units and unaligned grids instead of producing plausible but wrong results.

The current raster compositor remains dense and the display pyramid still launches multiple GDAL processes. These explicit limits are safety boundaries, not an out-of-core or drone-scale claim. `canopi-kqpp` owns the 3×3 IGN domain, genuine drone fixture, resource measurements, disk quotas and packaged Windows/macOS qualification. `canopi-j8mp` owns the existing-library picker and remaining multi-Design integration.

## Verification

Commands run from the repository root unless a command names `desktop/web`:

```sh
env CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop services::lidar:: --no-fail-fast
# 30 passed; real-fixture test ignored.

env CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop services::lidar::e2e::e2e_import_publish_slope_restart_reuse -- --ignored --exact --nocapture
# 1 passed in 81.21 s.

cd desktop/web
npx vitest run src/__tests__/lidar-actions.test.ts src/__tests__/lidar-library-store.test.ts src/__tests__/lidar-map-presentation.test.ts src/__tests__/design-edit-lidar.test.ts src/__tests__/canvas-map-surface-lifecycle.test.ts src/__tests__/ui-gallery-canvas-surface.test.tsx
# 6 files, 32 tests passed.

npx tsc --noEmit
npm run check:ui

cd ../..
cargo fmt --all -- --check
env CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace
env CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings
env CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace
# 331 tests passed; 3 manual/fixture tests ignored.

cd desktop/web
npm run check:types
npm run check:web-catalog-artifact
npm test
# 254 files, 2,328 tests passed.
npm run check:editions
# TypeScript, UI gallery, Desktop bundle and Web Edition bundle passed.
```

The implemented dock was inspected in fresh temporary browser profiles at 352 px light, 320 px French dark, and 320 px French dark import-review states. The real native run uses temporary library and Design data and reads the fixture in `~/Downloads`; it does not use saved Designs, settings or Downloads output.

Windows/macOS engine packaging, physical keyboard-only Desktop interaction, large drone rasters and hydrological analyses were not qualified by this repair. Their existing slice beads remain the release authority for those claims.
