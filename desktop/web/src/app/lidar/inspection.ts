// app/lidar/inspection.ts
//
// Read values is deleted (canopi-f47t.42, stream C): Site data rows show values and the pin instead (site-values.ts).
// Only this no-op stays, because `app/lidar/actions.ts` (stream A's file) still calls it after a presentation change;
// the main agent deletes the call and this file at stream C's merge.

/** Nothing to reconcile: row values follow the presentation by themselves. */
export function reconcileInspectionWithPresentation(): void {}
