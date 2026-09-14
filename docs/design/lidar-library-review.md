# LiDAR plan review — decisions for selection

2026-09-14. Review of [the current plan](lidar-library.md), prototype, and existing app seams. **Recorded user decisions:** R2 revised to remove Fit entirely; R1, R3 and R6–R13 accepted; R4/R5 discarded. R5b is replaced by silent LiDAR omission while all other content continues. This is a decision record, not an implementation task tracker. Bead `canopi-j571` remains the implementation authority. Custom numeric types are already incorporated into the plan/prototype as requested. No production feature is implemented.

## Assessment

The central direction is sound: one selected type, automatically shared accepted coverage, explicit import replacement approval, immutable sources, indexed window reads, and a fixed background layer. Keep those requirements. A physically merged TIFF, a row per pixel, or a database per Design would make growth and reuse harder.

The plan is not yet ready for a broad implementation handoff. Its biggest unresolved risks are exact mask/resampling semantics, durable publication across files and SQLite, numeric compatibility, and resource competition with normal app work. The prototype validates an interaction model, not those properties. Restricting the first release to continuous numeric raster import is helpful, but “one LiDAR service” and several numeric performance budgets are not enough to settle ownership or throughput.

## Decision menu

Effort is relative additional engineering, not a time estimate. Accepted items are now incorporated into the baseline. R1 is the chosen layout; R4/R5 are historical rejected rationale. No review decisions remain pending.

| ID | Area | Recommendation | Main weakness addressed | Cost / tradeoff | User decision |
| --- | --- | --- | --- | --- | --- |
| R1 | UI | Use A's Layers inspector, with a compact product inventory drill-in from B; retire C after review | Three competing permanent surfaces would duplicate state and maintenance | Less persistent library visibility | Accepted |
| R2 | UX | Remove every LiDAR Fit control and automatic extent fitting; preserve the camera | Global types can span continents; automatic fitting was disruptive | Removes controls and preserves ordinary pan/zoom | Revised: no Fit |
| R3 | UX | Guided import with simple compatible-file path, and map-linked selectable regions plus an accessible list for conflicts | Four fixed A–D regions do not explain real selection granularity or thousands of fragments | Significant geometry/interaction work; constrain initial selection tools | Accepted |
| R4 | UX / correctness | Add source-at-point inspection and comparison metadata to first release | A convincing image can conceal wrong units, date, alignment or coarse replacement | Numeric probe API and focused fixtures | Discarded |
| R5 | UX | Quiet shared-library change receipt when reopening affected Designs; explicit relink for missing custom IDs | Auto-follow can surprise returning users; copied Designs lack custom definitions | Replaced by silent LiDAR omission; other content continues | Discarded |
| R6 | Domain / backend | Formal compatibility rules and immutable measurement definitions | Free-form names, units and reference text do not establish comparability | Controlled unit/reference identifiers plus readable labels | Accepted |
| R7 | Backend | Isolate catalogue in a dedicated `lidar-library.sqlite` with independent recovery | Proposed UserDb coupling expands startup, migration and contention impact | Another migration/backup owner; no cross-DB atomic transaction | Accepted |
| R8 | Backend | Specify durable, idempotent publication and test every interruption boundary | “Rename then commit” does not fully define acknowledged durability | Journal/receipt protocol and crash-injection tests | Accepted |
| R9 | Performance | One explicit raster scheduler with measured interactive reservation under the Native Operation Executor | Four requested tiles plus imports do not fit the current two-running Local budget automatically | Admission design and packaged workload spike | Accepted |
| R10 | Architecture | Deterministic spatial chunks for accepted masks, history and invalidation | Fragmented masks and copying a whole generation on every import may scale poorly | Partition/index complexity; validate rather than assume | Accepted |
| R11 | Architecture | Separate caller interfaces for library inventory, import decisions and live raster views | A large catch-all service can spread lifecycle and transaction ordering into UI callers | Small internal modules; resist generic GIS framework | Accepted |
| R12 | Operations | Explicit storage accounting, recovery and history cleanup flow | Keeping every original forever eventually fills disks; cache eviction cannot solve it | Additional library management UX | Accepted |
| R13 | Delivery | Require a packaged vertical slice with real custom fixtures before expanding | Current PNG/synthetic evidence leaves engine, projection, durability and custom data unproven | Delays breadth; reduces integration uncertainty | Accepted |

## UI and UX details

### R1 — one everyday control surface

Accepted: use A’s inspector: the existing Layers panel owns visibility, type and style. B contributes inventory/search/history as a drill-in. C is useful evidence of a competing layout, but consumes canvas height and duplicates controls; the current prototype now removes the variant chooser and shelf, retaining the library as a drill-in. Keep the label LiDAR for this feature now. If imagery/categorical maps are later admitted, revisit an umbrella “Raster references” label then, without renaming today’s feature speculatively.

Acceptance: users can select another type without scrolling past every imported file; a library visit returns to the same canvas and inspector state. Accepted production components replace the throwaway layer list. Localization must cover long custom names, translated built-in labels and keyboard focus.

### R2 — no LiDAR Fit feature (revised and accepted)

Remove Fit coverage, Fit nearby, Fit all and automatic extent fitting/recentering. Import and type selection leave pan/zoom unchanged. Ordinary canvas pan/zoom remains. No “View added areas” shortcut is introduced as a renamed Fit action. The prototype Fit controls and automatic `fit()` call are removed.

### R3 — make area selection concrete and scalable

The prototype now illustrates A–D groups with irregular paths, holes and disconnected islands; these remain schematic masks. Production should link highlighted map regions and an accessible list: hover/focus identifies the same area; selecting it updates the proposed After surface and accepted area totals. Group tiny fragments for presentation, while retaining exact server-owned acceptance masks. Valid source coverage must support arbitrary irregular outlines, concavities, ragged boundaries, thin strips, holes and disconnected islands. The raster storage is rectangular but its valid samples need not fill that rectangle. Selection gestures always clip to exact valid-data masks; simplified enclosing geometry must never authorize holes. Do not constrain imported coverage to regular geometric shapes. Freehand/polygon editing remains optional, independent of arbitrary source-mask support.

Compatible adjacent imports can use one concise summary/Apply. Overlaps always retain Before/After and explicit replacement approval. Do not manufacture extra confirmation pages for ordinary imports; show metadata questions only where inspection cannot establish meaning/position/compatibility. A million disconnected valid islands must not create a million checkboxes. Complexity limits should produce a coarser selection workflow, never implicitly admit discarded pixels.

### R4 — inspect values, not only colors

**Discarded by user:** do not promote interactive source/value-at-point inspection into this release. The following is retained as rejected rationale, not a requirement.

Original proposal: promote basic source-at-point from “later probes” to initial import review: value, unit/reference, source, acquisition date, native spacing and validity for Before and After. Keep a shared display stretch/camera; flag coarser resolution and mixed dates. A numeric delta is meaningful only after compatible units/references are verified. Do not disguise uncertainty with a precise-looking difference.

The supplied MNT/MNS are two different products, not two epochs. Their difference cannot validate same-type replacement. Existing synthetic overlays also cannot validate interpolation or sample changes. Add small committed, explicitly synthetic numerical rasters with known expected values for those tests.

### R5 — discarded; silently omit unavailable LiDAR

No reopening change notice, last-seen bookkeeping for notices, missing-type warning, automatic restore prompt or relinking UI. Keep the selected stable ID/settings and silently leave the unavailable LiDAR contribution transparent. Basemap, grid, Design objects, editing and load/save continue normally. Do not silently substitute another type or survey. Contain errors within LiDAR; keep bounded local diagnostics without a user-facing error flow.

User-initiated library backup/restore remains part of accepted R12. Explicit import/replacement approval and direct import outcomes remain unchanged. The silent rule covers passive loading/rendering, not dishonest success reporting for an import operation.

## Domain, architecture and backend details

### R6 — make compatibility a domain rule

A definition needs controlled meaning, physical dimension, units, reference and calibration context; a user name remains presentation. Source interpretations record band, raw numeric type, scale/offset, masks, and the evidence for the chosen interpretation. Intensity values from different instruments/settings may be incomparable despite sharing a name and nominal unit. Different vertical datums need a verified transform. Unknown means unverified, not equal to another unknown.

Specify admission outcomes: compatible, convertible through a supported verified recipe, needs interpretation, or incompatible. A custom type must not bypass validation. Semantic changes create an explicit migration/new definition; a rename leaves identity untouched. Preserve unknown definitions/settings in older and Web clients without pretending to render them. These are application recommendations built on GDAL's distinct band/unit/scale/reference metadata, not a capability automatically provided by GDAL. [Raster model](https://gdal.org/en/stable/user/raster_data_model.html).

### R7 — isolate catalogue failure from personal data

The previous baseline put catalogue tables in UserDb; the accepted baseline now uses a dedicated LiDAR catalogue. Existing startup opens UserDb before proceeding, and errors propagate out of setup: [startup](../../desktop/src/lib.rs). It also contains Favorites, Notebook and settings-related data. LiDAR schema/index recovery should not make those unavailable.

Recommend a service-owned `Mutex<Connection>` for a separate catalogue with its own schema version, integrity checks and recoverable unavailable state. UserDb may retain a small library location preference, but no transaction should need to commit simultaneously across the two DBs. Preserve SQLite + immutable COG files and a disposable cache. Import receipts, exact masks and product heads must live within the same catalogue authority. This accepted decision supersedes the previous UserDb table placement.

### R8 — acknowledge only durable publications

Define the protocol precisely: stage and hash, prepare immutable masks/assets, persist required file/directory state using supported platform guarantees, commit catalogue membership/head/receipt, then notify listeners and acknowledge success. If the reply is lost after commit, retry with the same request ID returns the original receipt rather than importing twice. Crash recovery differentiates unacknowledged staged content from committed assets. A SQLite transaction covers its database files, not arbitrary managed TIFFs; this is why application-level ordering matters. [SQLite atomic commit](https://www.sqlite.org/atomiccommit.html).

Inject failure before/after each publication boundary, including disk full and a lost response. Cancel has an explicit commit boundary: before it, no publication; after it, return the receipt and offer library undo. Backup must include mutually consistent definitions, assignments, masks and source identities, not just copy a database while imports are changing files.

### R9 — budget actual native work

The current executor’s Local class admits six operations and runs two; UserData runs one: [executor limits](../../desktop/src/native_operation.rs). A background import can consume half the Local running capacity. A persistent worker does not make that scheduling interaction disappear.

Benchmark tile latency while an import, file save and other local work compete. Use deduplicated bounded queues, cancel stale camera jobs, yield preparation in bounded chunks, and reserve measurable interactive capacity without nested executor permits or a parallel unbounded pool. Decide during the spike whether existing Local admission is sufficient or a reviewed raster class is necessary. Count worker/process/GDAL block caches and GPU memory, not just a JavaScript queue. Do not assume shared dataset handles are safe: GDAL documents constraints and version-dependent thread-safe read support. [GDAL threading](https://gdal.org/en/stable/user/multithreading.html).

### R10 — exact masks and generations that scale

Choose a deterministic metric comparison grid per compatible reference region, with explicit edge/pixel-center rules and resampling semantics. Do not require one physical worldwide raster. Partition effective assignments and reusable numeric aggregates into immutable spatial chunks; a new product generation can share unchanged chunks instead of copying every source/mask row.

Apply acceptance/validity before interpolation and aggregation so a rejected neighboring pixel cannot leak into an accepted display tile through a filter kernel. Define the expected behavior at mask boundaries and NoData holes; preserve source-at-point provenance. Query footprints as broad phase, then acceptance masks as authority. Prototype real rotated/misaligned grids and heavily fragmented masks before choosing chunk dimensions. This is a correctness and scale hypothesis, not an excuse to design a universal spatial engine upfront.

### R11 — small caller interfaces, explicit owners

Keep one LiDAR subsystem but expose three coherent roles: library inventory/definitions; staged import planning/review/publication; live product view/tile lifecycle (interactive probes excluded under R4). Configure the engine/storage/executor once at construction. A tile caller should not orchestrate SQL, GDAL, masks or publication readiness. An import caller receives an opaque review identity and area identities, then a receipt or stale-review result.

Internally separate numerical resolution from durable publication and from scheduling/cache ownership. Test through these interfaces using real temporary SQLite/files and small numerical fixtures; use a deterministic slow/failing engine adapter only where it exercises real cancellation/failure behavior. Share contracts through `common-types`/specta and edition capability composition. Avoid public methods for every internal step, global signals as backend authority, and a new framework of providers with only one real implementation.

## Operations and delivery

### R12 — make retained history sustainable

Separate retained originals, prepared artifacts and display cache in usage reporting. Estimate required space before import; reserve enough working space to avoid consuming the entire disk mid-publication. Offer clear cache, inspect retained history, and explicit history cleanup with the active/undo implications visible. Never purge by bounding-box coverage alone.

Backup/restore should be a supported library operation that preserves custom IDs and masks. After recovery, keep missing/corrupt-member diagnostics local and silently skip affected raster contributions while keeping other content usable; do not silently substitute another source. The default retention duration/space policy remains a product choice. Unlimited invisible retention is not a complete long-term policy.

### R13 — earn the architecture with one vertical slice

Before broad UI implementation, package one supported engine path and exercise original extensionless MNT/MNS plus custom elevation, height and intensity fixtures. Prove import → interpretation → review → durable publication → actual viewport tile → restart → shared selection, with exact opaque layer order. Also prove one interrupted import and one missing-source recovery.

Run supported OS/WebView checks; benchmark on named lower-end hardware with datasets exceeding RAM and fragmented overlaps, while other app work runs. Record frame latency, reads, queue depth, mask complexity, memory and disk allocation. Use privacy-safe local diagnostics; source paths or raster values should not leave the machine implicitly. Derive production budgets from these results. Delete the gallery prototype when accepted behavior is rebuilt; do not promote its singleton signals, placeholder masks, camera math or English-only copy into production.

## Selection and evidence limits

All review decisions are recorded in the baseline. R1 chooses Layers + Library drill-in; R2 removes Fit; R3 preserves arbitrary valid-data shapes; R4/R5 are discarded; R6–R13 are accepted. bd owns subsequent implementation work. No production infrastructure has been added.

Confirmed locally: UserDb startup/migration coupling and executor limits cited above; the prototype still uses four schematic irregular region groups, in-memory state, PNG overviews and synthetic incoming/custom values; Fit controls/automatic fitting are removed. Therefore persistence, arbitrary TIFF admission, geospatial correctness, failure isolation and scale remain unproven. Sources describe primitive behavior; the proposed module boundaries, UI choices and database split are engineering judgments.
