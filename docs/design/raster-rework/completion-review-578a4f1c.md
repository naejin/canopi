# Completion review and fixed repair decisions at 578a4f1c

Status: active — partial delivery; remaining R44–R51 repairs and evidence are not accepted.
Tracking: `canopi-j571.1` under `canopi-j571`; retain existing finding IDs.
Current guidance: [sole prompt](completion-agent-prompt.md), [C0–C5](completion-design.md), [source import](source-import-design.md), [receipt](completion-receipt.md), [debrief](review-and-debrief.md#whole-rework-delivery-and-improvement).

## Evidence, authority and scope

Reviewed `9208c930..578a4f1c`, including implementation `b3c39729`, `ac7f04f5`
and `51511c90`. Five existing frontend files passed independently: 44 tests in
`review-provider-regressions`, `basemap-provider-binding`, `basemap-contribution`,
`lidar-import-attachment` and `lidar-library-store`. Temporary probes against the
delivered modules reproduced wrong coverage, parser nontermination, retained
attribution and attachment before a fresh snapshot. Native findings below are
source-traced, not independently reproduced native races/faults. Full/native/live
gates were not rerun by the reviewer. Primary and candidate files were unchanged.

This addendum refines the [R44–R51 decisions](completion-review-9208c930.md), not
the product scope. Its specific repair decisions take precedence for these seams.
All findings are P2. Preserve working late-cancel attachment, Loading visibility,
finite chunk conversion, retry service identity and the main post-read check.
R27/R43 and remaining C0–C5 still require completion; named cases are minimum
detectors, not the entire acceptance contract. Optional cleanup is not a blocker.

## R47 — normalize actual coverage and bound parser work

`basemap-provider-session.ts::exactCoverageCeiling` splits inverted rectangles at
viewport edges, inventing coverage, and shifts ordinary rectangles in a way that
loses their second world copy. Repeated `±360` loops never terminate for some
finite inputs (`1e20 - 360 === 1e20`). Rectangle count also has no bound before the
partition scan. The executable examples below reproduce coverage defects.

Fixed decisions: normalize wrapped provider rectangles into actual intervals
split at ±180, then intersect them with normalized viewport intervals. Preserve
full-world coverage; a viewport spanning at least 360 degrees queries one complete
world. Ordinary unwrapped MapLibre bounds (e.g. 170..190) are supported. Zero-width
viewports and malformed metadata are unavailable. Use constant-time modulo
normalization; no iterative shifting or sampling fallback. Validate numeric finite
provider coordinates in geographic ranges, ordered latitude and positive finite
zoom. Keep the maximum-over-overlap/minimum-over-partitions rule and base zoom cap.

Bound this supported metadata format to 64 input rectangles before partitioning;
larger responses are unavailable under the existing metadata error/retry policy.
This is a conservative local parser support bound, not a claimed Google API
guarantee. Do not truncate and accept partial metadata. Test at the bound and just
above it. No geometry dependency or universal spatial index is needed.

Selective reuse inspected at GeoLibre `bb18f8abaf89211aef68a7b6aed8460cec033f4c`:
`apps/geolibre-desktop/src/lib/offline-tiles.ts::splitAntimeridian` shows the actual
±180 split; `packages/map/src/globe-fit-bounds.ts::longitudeSpan` shows modulo and
explicit full-world handling. The optional local checkout is `.rq-scratch/geo`;
otherwise inspect those paths at that revision in the upstream repository.
Adapt these small patterns, retaining MIT notice if copying code. They do not
solve rectangle-union coverage on their own. Canopi's provider module owns the
adaptation and its tests. Keep pinned `wbgeotiff` and GDAL; no broader GeoLibre
integration is required. Stop reuse research once these cases are understood.

### Executable coverage counterexamples

From the candidate's `desktop/web`, this uses its installed esbuild and Node;
it writes only a unique temporary directory. All rectangle latitudes are 0..10,
viewport latitudes 1..9, rectangle zooms 18, base cap 22. Geographic interval
intersection, not the implementation, supplies the expected results. At the
reviewed tip the four defect cases mismatch and the healthy case passes.

```bash
node --input-type=module <<'JS'
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'canopi-coverage-'));
try {
  const outfile = join(dir, 'provider.mjs');
  await build({entryPoints:['src/maplibre/basemap-provider-session.ts'],
    bundle:true, platform:'node', format:'esm', outfile});
  const { readViewportMetadata } = await import(pathToFileURL(outfile).href);
  const cases = [
    ['uncovered Greenwich', -10, 10, 170, -170, null],
    ['partial wrapped coverage', 175, -175, 178, -178, null],
    ['world covers wrapped view', 175, -175, -180, 180, 18],
    ['world covers unwrapped view', 170, 190, -180, 180, 18],
    ['healthy wrapped coverage', 175, -175, 170, -170, 18],
  ];
  let failures = 0;
  for (const [name, west, east, rw, re, expected] of cases) {
    const result = readViewportMetadata({copyright:'credit', maxZoomRects:[
      {west:rw, east:re, south:0, north:10, maxZoom:18}
    ]}, {west, east, south:1, north:9, zoom:12});
    const actual = result?.maxZoom ?? null;
    const pass = actual === expected;
    if (!pass) failures++;
    console.log({name, expected, actual, pass});
  }
  process.exitCode = failures ? 1 : 0;
} finally { await rm(dir, {recursive:true, force:true}); }
JS
```

Convert the cases into ordinary tests in `review-provider-regressions.test.ts`.
Retain gap/interior-ceiling/broad-overlap and zoom-recovery controls. Test malformed
large finite coordinates through a terminable child or worker when reproducing
the old loop; do not freeze the test runner to establish red. Once the rejection
guard exists, ordinary parser assertions suffice. The review killed its isolated
`1e20` case after two seconds; that timeout is evidence of nontermination, not a
new production deadline.

## R44 — settlement needs a read that starts after the terminal observation

`library-store.ts::refreshLidarLibrary` joins an earlier in-flight read. Waiting
for it does not make its snapshot fresh. The real workflow consumed attachment
against an empty old snapshot; polling corrected the snapshot afterward. This
violates attachment ordering, not evidence of permanent import loss.

Keep passive read coalescing. Add the smallest freshness option/entry in the same
store so settlement waits for a read started after Complete was observed. One
shared follow-up read can satisfy overlapping settlement callers; no job registry
or scheduler. Workflow owns settlement and Design Edit. Move attachment intent
state/access into the existing library state owner so leaf `actions.ts` no longer
imports higher `workflow.ts`. Capture Design identity before async submission.

Deterministic regression setup: use the real library store and workflow, mock
only IPC and Design Edit. Start a library read A and hold its pre-commit snapshot;
record intent for layer L in Design D; publish tracked Complete; release A with
no L. Hold fresh read B: **no attachment yet**. Release B with published L:
exactly one attachment in D, existing order/opacity/visibility preserved. Replace
D while B is pending: none in the replacement. Repeated terminal observation must
not attach twice. Keep late-cancel success and genuine Failed/Cancelled controls.
On B failure retain the error and pending intent; retry settlement on the next
normal poll/reopen refresh, without attaching against A or adding a tight retry
loop. If a successful fresh read confirms the layer has been deleted, consume
the intent without attachment and report the unavailable target; do not keep a
permanent pending attachment. Successful settlement must allow polling to become idle.

## R45/R46 — attribution lifecycle through the real adapter

`basemap-contribution.ts::removeContribution` leaves custom credit after removing
imagery. Reproduction: Ready with credit A → Idle/Unavailable; source/layer gone,
credit A still present. Clear the basemap-owned credit on withdrawal, retaining
credits belonging to other sources. Identical state is a no-op for controls too.

Use `createAttributionControls` through actual binding setup and disposal. The
maps already enable default attribution: coordinate that ownership so adding a
custom control does not duplicate other-source credits or compact controls.
Choose the smallest public MapLibre-control solution; no private mutations.
Canvas uses the adapter's real `maplibre` getter: the review's initial suspicion
that this property was absent was withdrawn and is not a defect to repair.

Test control construction and owner wiring, not only a fake
`replaceBasemapAttribution`: A → B with unchanged tile source; B → unavailable
removes B; other-source credit survives once; unchanged publication does not
recreate controls; teardown releases ownership. Drive one real mounted control
using the available isolated map recipe. Preserve R46 Ready → Loading → Ready,
user hide/show during Loading and delayed style readiness. Missing a live Google
key does not block testing public control behavior with deterministic metadata.

## R50 — Retry belongs to the chosen failed definition

`AnalysisPanel.tsx` still chooses `results.find(Failed)` and changes the primary
create button into Retry. Form name/units are ignored while any failure exists.
Keep Create using the form. Give each failed result row a Retry action identifying
that row's definition (display its available name/kind and result units using
existing UI patterns). Retry uses saved parameters/name and the currently observed
source head; it does not read create-form values or guess another result. If a
head is unavailable, explain why retry cannot start rather than send an empty ID.
No analysis editor or new selection framework. Preserve presentation identity.

Use the existing command/service; test two failed definitions on one layer and a
different create-form name/unit. Retrying the second twice must submit its ID,
preserve parameters/name and definition count, create new job IDs, and retain a
previous published result on failure. Create still creates the explicit new
definition. Test changed-head refusal, cancellation and successful publication
through panel, IPC and native service boundaries; assert actual command arguments.
Regenerate/verify shared bindings and native command policy as required.

## R48/R49 — finish resource and process evidence

Sparse slope preflights once then writes all blocks without another capacity
observation. Recheck before bounded output/allocation boundaries using the existing
capacity seam and remaining-output estimate plus reserve; do not charge already
written output twice. Include metadata and actual temporary overlap using checked
arithmetic. Another process consuming space must produce a named failure while
keeping source/previous result intact and removing only job-owned staging.
General published-asset reclamation remains excluded; preserve reused COGs.

Use `paths.rs`'s test capacity seam: sufficient preflight → reduced capacity before
a later block refuses that block; actual injected mid-write failure leaves old
heads/results readable; restoring capacity allows retry. Also cover initial
refusal before output, estimate overflow and widely separated small members.
Exercise production publication rather than only the estimate helper.

R49's `write_cog_asset → engine.run` routing looks corrected; retain it. Prove a
stalled bounded conversion times out and is killed/reaped, while whole-source
conversion can outlive that deadline and still cancels/settles. Reuse the process
owner and controllable child/deadline seam (small private test injection if needed).
No 600-second test or generic watchdog; no new process owner.

## R51 — all successful inspection exits recheck currency

The main read path now rechecks, but `inspection.rs::sample` returns early NoData
when `containing_pixel` cannot represent the coordinate, after slow transform and
before the new check. This is the unrepresentable-index branch, not every ordinary
point outside coverage. Route every Value/NoData return through the same short
currency check; do not hold the catalogue during transform or reads.

Gate a real service read: change head or delete target before releasing it; expect
StaleGeneration or MissingGeneration, never old Value/NoData. Include the early
NoData branch with a transform gate and the unchanged-head Value/NoData controls.
A small private test gate is delegated; frontend-only fencing does not prove this.

## Closure

The [receipt](completion-receipt.md#current-correction-acceptance) owns disposition,
and [C5](completion-design.md#c5--final-candidate-independent-review-and-debrief)
owns final gates. Passing the examples here does not waive R27/R43, native fault
tests, edition builds or driven workflows. Missing fixture environment variables
alone do not establish unavailable fixtures: inspect existing owned evidence and
documented generators. Finish all available work before one consolidated handoff.
The [debrief](review-and-debrief.md#final-correction-debrief-to-deliver) evaluates
both implementation and this handoff; no new general tooling project is required.
