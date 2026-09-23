# Source import without collection-wide preparation

Status: active — partially implemented at `26eca68a`; source-only publication is present, resource admission and lifecycle corrections remain.
Tracking: `canopi-j571.1` under `canopi-j571`.
Current guidance: [current corrections](completion-correction-design.md), [completion contract](completion-design.md), [prompt](completion-agent-prompt.md), [review](completion-review-5d0a5e0b.md), [LiDAR](../../agent/lidar.md).

## Decision and scope

Users choose numeric GeoTIFFs, declare their interpretation and import them into
a reusable Data Layer. Canopi prepares each source independently as a managed,
validated COG, publishes ordered membership, and reads requested windows for
display. Import, reorder, remove, Undo and Restore do not require preview imagery
or an exact full-composition scan. There is no application policy ceiling on a
source's bytes, selected bytes, source count or total active cells on this route.
This supersedes the original completion C1's 24-file/2-GiB/400M policy and the
ordered route's compulsory review/measurement step. It does not promise that
every input is supported or that every analysis fits the available machine.

Retain native GDAL conversion, the pinned native TIFF reader, Float32 scientific
semantics, topmost-valid ordered composition, source-specific NoData, aligned
north-up single-band admission, original preservation and immutable history.
No reprojection/resampling, new engine/service/dependency, RGB import, automatic
precision change, generic scheduler, asset reclamation or new analysis type.
This decision changes preparation and derived metadata, not raster values.

## Reuse and implementation seams

Baseline is candidate `5d0a5e0b`, including foundation `34e4ded4` and main
integration `f61f8494`. Inspect these actual modules before editing:

| Owner | Reuse | Change |
| --- | --- | --- |
| `services/lidar/import.rs`, `paths.rs`, `raster_assets.rs`, `prepared_raster.rs` | Original copy/hash, probe, controlled COG, source facts/regions, owned staging and promotion | Remove preview/composed-review dependency; stream source preparation and its metadata |
| `collection.rs`, `catalogue.rs`, `generation.rs` | Atomic ordered snapshots, expected-head edits, compatibility members/readers, history | Publish from member metadata; no `collection::measure` call required for a new head |
| `tiles.rs`, `presentation.rs`, `mod.rs` | Bounded numeric windows, library summaries, generation identity | Distinguish display range from exact statistics; support unknown exact coverage |
| `analysis.rs` | Existing slope job, sparse results and source-head fencing | Independent resource admission and truthful stale/previous result state |
| `app/lidar/{actions,library-store}.ts`, Data/Layers panels | Library job ownership and Design Edit presentation | One Data-owned import interaction; remove obsolete review UI and transport consumers |
| `common-types/src/lidar.rs`, generated bindings | Existing typed commands, summaries and job states | Import completion and nullable exact source-generation metadata; regenerate outputs |

Private helper organization and SQL migration mechanics are delegated. The
observable data and lifetime contracts below are fixed.

## User flow and job boundary

Data's primary Import sources opens the chooser first. Cancelling it creates
nothing. After selection, an inline form confirms dataset name (editable,
suggested from the first filename) and explicitly chosen measurement kind/units;
there is no guessed scientific interpretation. Existing-layer Add sources reuses
its interpretation and shows the selected files. Import is the explicit commit
intent; there is no second before/after review or Apply decision.

On submission use the existing library job owner for
prepare → validate → publish → complete, with per-file progress, Cancel, terminal
success/error and Retry reachable in Data. Preparing can take time proportional
to the new input. It must not decode old collection values. Closing Data leaves
the submitted job running; reopening shows it. Library work survives Design
replacement; automatic presentation attachment occurs only in the submitting
Design session after successful publication. Existing Add to Design remains
available afterward. A newly created empty dataset may remain after failure or
cancellation once submission created it; show it as empty/retryable, not Ready.

Prepare selected sources sequentially under the existing library-wide heavy-job
lease. Persist/iterate batch metadata without one worker/future per source. Keep
the current busy outcome for competing heavy work; no new unbounded pending-job
queue. Reuse the existing display budget (two active, 32 queued), cancellation
and decoded cache owners. Inspection shares bounded read admission. Never hold
a catalogue mutex while waiting for GDAL or another executor/lease.

The batch is atomic: every selected occurrence is compatible and validated before
the new head is visible. Invalid/all-NoData input names its file and leaves the
old head/results intact. Preserve selection order deterministically using the
existing ordered import convention, inserting the batch above accepted members;
show priority in Data. Identical content can reuse an asset while remaining
distinct occurrences. No partial batch success masquerades as completion.

Capture the target head at submission and compare inside the publication
transaction. A changed/deleted target refuses publication as a conflict; do not
silently append to a different head. Retry uses the then-current head and may
reuse validated assets. A precommit cancel/failure publishes nothing. Once the
transaction commits, completion reports success even if cancellation arrived
late. Keep existing restart recovery and durable promotion ordering; only remove
scratch proven owned by the job. An interruption must not damage reused assets.

Expose `lidar_import_sources(layer_id, paths) -> job_id` through the existing
executor-backed import job owner. Native submission captures the expected head
before preparation; the job publishes only against that head. Replace the
production `lidar_stage_import`/`lidar_apply_import` sequence with this operation;
reuse job-status and explicit cancel operations. Existing internal Staging/Applying
states may remain, with Preparing/Publishing user labels; AwaitingReview is not
entered on the new route. One frontend import action owns dataset creation when
needed, job tracking and session-fenced attachment after completion. Remove the
old create-layer action's automatic attachment from this flow, so a failed import
does not silently add an empty presentation. Regenerate shared adapters.

Do not maintain two production entry routes. Retire preview/review/Apply consumers
and commands when unused. In-flight pre-upgrade staging jobs are not a
compatibility promise: existing startup recovery may mark them interrupted and
offer retry. Published libraries, originals, history and Designs are compatible.

## Metadata: exact facts versus display hints

Source-level valid-cell count, range and region aggregates remain exact under
that source's own validity rule, computed in bounded windows during preparation.
Reuse existing admitted facts; paginate/spool growing region records to the
catalogue/job storage rather than collecting all raster blocks in RAM. No
preparation cache may allocate by the whole decoded source/union. Combining the
source fact and region passes is a local choice, not a new performance project.

For a new composed source generation:

- Membership, order, lattice, CRS, leases and provenance are authoritative.
- Navigation bounds are the conservative envelope of active member footprints,
  derived from stored metadata with checked coordinates. They are not covered
  area. Transparent gaps/holes are decided by the existing bounded reader.
- Exact composed `coverage_cells` and exact `value_range` are unknown unless
  derivable without reading composed pixels (empty composition: zero/no range;
  one unchanged member: its known exact facts may be reused). Never sum member
  cell counts as union coverage or call an envelope an exact area.
- Add a separate optional display range with basis `Exact` or `SourceEnvelope`.
  Use the union of stored member ranges for the latter, including ranges of
  preserved compatibility members. It may include fully occluded extremes.
  It is a stable colour domain for this immutable generation, not a scientific
  statistic. Empty/no valid range renders transparently; retain constant-domain
  handling. Changing priority can change pixels without changing this domain.

Make source-generation exact coverage nullable in catalogue reads/storage and
all affected typed summaries/history entries. Preserve every old exact value
through migration. Keep `value_range` as exact-or-null and add the separately
labelled display range; do not overload it. Native tile styling and UI legends
consume the display range consistently. Analysis summaries/results remain exact
as today, in their own units. Per-source exact coverage stays numeric.

Data/History show “Not calculated” for unknown composed coverage, not zero
hectares; known empty coverage remains zero. Legends identify a source-derived
display range when applicable. Extent navigation remains usable. These states
must survive restart and Undo/Restore. No eager/lazy automatic full-composition
statistics job or new Calculate statistics feature is part of this slice:
inspection and slope read physical pixels and do not need it. A consumer that
actually requires exact coverage must return a material counterexample rather
than invent an estimate. The inspected summary/tile consumers can use this split.

Use the existing additive versioned catalogue migration mechanism; a transactional
table rebuild to allow NULL is permitted where SQLite requires it. No existing
generation raster/manifest is rewritten or recomputed. Old readers are not
promised forward compatibility with the upgraded catalogue: retain schema-version
rejection and require a backup to downgrade. Test interrupted migration rollback.
The `.canopi` format and unavailable/unknown reference round-trip do not change.

## Capacity, disk and analysis admission

Delete obsolete policy ceilings only after all new-route callers use bounded
reads/copy/hash/conversion/metadata iteration. Retain checked dimensions, offsets,
addressability and supported layout/codec checks. Keep legacy dense allocation
guards on genuinely dense compatibility paths; a large source must not fall
back to such a path. Public callers may refuse unsupported formats or a real
resource shortage with a named reason, not a hidden replacement cell limit.

Preflight the operation's actual storage obligations: retained original and
sidecars, output COG, overviews, GDAL scratch, any promotion copies and the retained
256 MiB free-space reserve. Use conservative checked uncompressed estimates and
the selected conversion mode; avoid assuming a favourable compression ratio.
Place GDAL temporary output in owned job scratch. Recheck at allocation/promotion
boundaries and propagate actual write failures because free space can change.
Do not count “zero scratch after cleanup” as peak capacity evidence.

Use an explicit BigTIFF-capable controlled output when classic TIFF may overflow;
forcing BigTIFF for the controlled source route is permitted after pinned-reader
compatibility is verified. Do not rely solely on compressed `IF_NEEDED` guesses.
The [GDAL COG documentation](https://gdal.org/en/stable/drivers/raster/cog.html)
describes BigTIFF and temporary overview storage; verify against the installed
GDAL version without upgrading it merely for this assignment.

Keep the combined incremental raster workload within 1 GiB, decoded caches
within the existing 128 MiB budget and reproducible disk cache within 512 MiB.
These are working-resource bounds, not input-size caps. Count the app increment,
simultaneous children, reader/index metadata and caches. Cancellation must stop
scheduling promptly and settle owned fixture work within five seconds, including
stalled-child termination. For the long source conversion only, total elapsed
time is not an admission ceiling: the existing process owner may run it until
completion or explicit cancellation, with progress and bounded termination on
cancel/shutdown. Retain finite timeouts for probes, coordinate transforms and
other short requests, plus bounded stdout/stderr and process cleanup. Test a
stalled conversion cancelled by its owner. Do not introduce a generic process
watchdog or disable timeouts globally to support this one long operation.

Slope uses its own checked working/storage estimate under the existing heavy
lease; metadata size admission is not a source registration requirement. If a
slope job cannot fit, show its resource reason while retaining the viewable source
and previous valid result. On source edits, keep latest-head refresh semantics:
coalesce superseded refreshes, never publish a result under the wrong input head,
and distinguish a failed/unavailable refresh from a current result. Do not require
analysis success before publishing an imported source or metadata edit.

## Acceptance examples and evidence

| Start/event | Required observation |
| --- | --- |
| Select files, cancel chooser | No dataset/job/assets created |
| Valid batch, explicit interpretation, Import | Data shows progress then accepted ordered sources, without review/preview/Apply navigation |
| Last file invalid or write fails before commit | Entire old head and previous result remain; named error and retry; owned scratch removed |
| Cancel during copy, conversion or indexing; restart | No partial head; child settled within bound; no referenced bytes removed; retry succeeds |
| Import while another head wins or layer is deleted | Atomic conflict, no silently rebased publication or misattachment |
| Add a source, reorder/remove/Undo/Restore | No prior-composition pixel scan; bounded metadata traversal; correct topmost-valid display/read and history |
| Overlapping sources with occluded extreme and holes | SourceEnvelope range labelled; exact union coverage unknown; physical inspection/slope still correct |
| Old dense/chunked/ordered library upgraded | Same values, masks, exact historical stats and history; no full raster rewrite; interrupted migration rolls back |
| Source above old caps, >24 selected files, cumulative active cells above 400M | Production route admits when supported/resources suffice; no test-only bypass or hidden cap |
| BigTIFF source/output, block beyond 4 GiB | Pinned reader obtains correct independently known value; reopening and bounded display work |
| Analysis requires unavailable working space | Source stays usable, last good result retained and honestly marked; actionable failure |

Retain the real 48M MNH batch, ground MNT and existing 400M analytical plane as
regressions. Add a boundedly generated analytical input above the retired 2 GiB
limit and a real beyond-4-GiB offset case; generation itself must stream and be
preflighted. Reuse GDAL/native fixture helpers and keep private originals read-only.
Measure peak live scratch separately from durable bytes and post-settlement
residue. Measure no-prior-pixel-read assertions at the import/edit publication
boundary; separately scheduled dependent slope may legitimately read the input
after that commit and must not be disabled to make the assertion pass.
Exercise concurrent display/inspection during heavy work, the actual
queue refusal/cancel boundary, one cold and three warm display runs, and resource
failures at the real write/publication seam. Median/p95 timing is diagnostic;
correctness, bounded resources, no >50 ms UI raster compute and cancellation are
gates. Missing disk/fixtures blocks only the corresponding evidence, not small
regressions or other corrections. Report it explicitly rather than inventing a
production bypass or claiming unmeasured unlimited capacity.
