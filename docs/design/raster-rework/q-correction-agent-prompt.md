# Q correction agent prompt

Status: retired — executed in `cfbb0c35`; independent review did not accept Q. Retained for debrief evidence.
Tracking: `canopi-kqpp`, parent `canopi-j571`; related follow-up `canopi-a9uy`.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [LiDAR guide](../../agent/lidar.md), and [repository contract](../../../AGENTS.md).

Prepared after independent review of `fd86de68`; the resulting correction is `cfbb0c35`. Do not execute this historical prompt again. Use the narrower [gate repair prompt](q-gate-repair-agent-prompt.md) next and consult the [review/debrief record](review-and-debrief.md). The original text below is retained for the user-requested methodology debrief; execution status remains in bd.

## Agent prompt

Correct and complete qualification slice Q only.

Read:

- AGENTS.md
- docs/design/raster-data-analysis-rework.md
- docs/design/raster-qualification-q.md
- Relevant current-guidance links
- Existing scripts/raster-qualification/ implementation

Baseline:

- Prior Q work is commit fd86de68.
- UI reference revision 0e696722 is user-approved; approval was recorded in ab2f7d25.
- Preserve those commits and all user-owned changes.
- Inspect current git status and bd state before editing.
- Continue canopi-kqpp under canopi-j571; inspect related follow-up canopi-a9uy.
- Follow repository branch, tracking, validation, and delivery rules. No subagents.

### Mandate

The independent review did NOT accept Q as qualified. The existing work contains useful artifact findings, but several reported passes do not establish the required behavior.

Repair the harness, leverage relevant GeoLibre integration patterns, rerun meaningful experiments, and produce an honest revised receipt.

Do not start N1 or any downstream production slice, even if Q passes. Stop for independent review.

### 1. Repair qualification verdicts first

Add small automated regression tests proving that the harness fails closed:

- Required decoder initialization failures cannot produce a pass.
- Unexpected window-read errors cannot be skipped into a pass.
- Zero tested windows or missing required fixtures/scenarios cannot produce a pass.
- Unavailable, inconclusive, malformed, missing, or failed required reports cannot combine into an overall pass.
- Browser startup/runner failures must affect machine-readable results and exit status.
- Expected negative controls must be explicitly identified and asserted; do not treat every exception as either success or failure indiscriminately.
- Missing or mismatched fixture hashes fail before qualification.
- The combined report must require the complete experiment set, not merely summarize whichever reports the caller supplies.

Review findings reproduced:

- cmd_q2_numeric returned exit 0 / pass when the decoder failed and no windows were tested.
- cmd_compare returned exit 0 / pass for an inconclusive input report.

Show these regression tests failing before the fixes and passing afterward. Keep the test setup small, deterministic, and independent of private fixtures.

### 2. Inspect GeoLibre before inventing integration machinery

Reference: https://github.com/opengeos/GeoLibre

Inspect the plan’s pinned revision first. If relevant improvements exist only at a newer revision, record the exact newer commit and the reason for consulting it. Do not silently change candidate pins.

Trace actual source paths:
local file access → preparation → numeric decoding → worker execution → display → disposal.

Prioritize:

- packages/processing/src/wasm-tool-runner.ts
- packages/processing/src/wasm-tool.worker.ts
- packages/processing/src/cog-convert.ts
- packages/processing/src/raster-client.ts
- packages/processing/src/raster-subset.ts
- Relevant MapLibre/COG adapters
- Dependency lock, package exports, bundler configuration, and WASM asset loading
- Relevant upstream tests

Verify paths at the selected revision; follow actual callers rather than guessing behavior from filenames.

Produce a compact reuse inventory:

- Exact source revision and module
- Behavior relevant to Q
- Reuse / adapt / reject
- Reason and Canopi-specific changes
- License/attribution obligations
- Verification needed

Useful patterns to inspect include worker ownership, dead-worker detection, error/messageerror handling, asset resolution, and listener cleanup.

Do not copy upstream behavior blindly. The inspected worker runner structured-clones input buffers, limits idle rather than total active workers, and has no run timeout. Those choices do not establish Canopi’s bounded-memory or cancellation guarantees.

Preserve Canopi’s architecture:

- No React/Zustand shell adoption.
- No DuckDB migration or replacement document/catalog authority.
- No broad GeoLibre fork or wholesale deferred geolibre-wasm adoption.
- No globe, plugin framework, extra processing catalog, or UI redesign.
- No upstream success claim substitutes for measurements of the proposed Canopi route.

### 3. Replace proxy measurements with route-level evidence

Numeric access / local transport:

- The current cogstream_windows probe fetches the entire fixture and then counts slices from its resident buffer. This does not qualify bounded file access.
- Exercise actual ranged reads through the intended scoped Desktop/native/worker transport.
- Measure header reads, tile reads, all materialized buffers, and relevant allocations from the beginning of the operation.
- Do not preload the complete fixture and exclude that preload from accounting.
- The separate disk-backed File display probe is useful evidence, but is not proof of the numeric Desktop bridge.
- Compare values and validity against independent bounded reference reads, including NoData, valid zero/negative values, boundaries, and unsupported metadata.

Preparation and generation resolution:

- Test bounded preparation of stripped originals into prepared tiled derivatives while preserving original and sidecar identities.
- Exercise overlapping members, replacement precedence, NoData, separated coverage, and the specified large gap through the proposed generation resolver.
- Verify that reduced-resolution display does not resurrect overwritten source pixels.
- Measure the selected implementation, not only a standalone reference resolver.

Slope:

- The existing large-plane seam checks only read 8×8 windows and report samples. They do not compute or assert slope across processing boundaries.
- Run actual block processing with halos through the proposed route.
- Assert both degree and percent values, exact validity, holes, outer edges, and cross-member/block seams.
- Do not compare only the intersection of valid outputs while ignoring validity disagreements.
- Distinguish analytical/reference implementation checks from qualification of the candidate processing path.
- Keep large-fixture execution bounded; establish correctness and boundedness on small fixtures first.

CRS:

- The existing CRS check round-trips GDAL against itself. Candidate coordinates do not determine its verdict.
- Compare the actual proposed route’s coordinates against independently configured reference control points within the plan’s tolerance.
- Record which component resolves CRS and how that interpretation reaches the decoder/display route.
- Missing candidate output is not a pass. Do not silently repair ambiguous CRS from filenames.

Cancellation and lifecycle:

- The existing cancellation probe aborts before a loop starts, then exits the loop. Its timing does not measure cancellation of active work.
- Cancel active copy, read, preparation, and slope operations at controlled checkpoints.
- Force a stalled worker/child and verify termination and resource settlement within the specified bound.
- Assert that cancellation stops new scheduling and that owned resources are released.
- Exercise decode failure, disk-write failure, partial initialization, and repeated adapter disposal.
- A third-party free() need not itself be idempotent; the owning adapter must make repeated teardown safe and prove it.
- Do not claim publication rollback from a harness that has no publication boundary.

Resources and hosting:

- The reported 18.3 MiB measurement exercises the Python reference reader, not the proposed WASM/native route.
- Measure the selected route’s host, workers, children, WASM heap, queues, caches, active reads, and temporary storage using the plan’s accounting rules.
- Separate reference-reader measurements from candidate-route measurements.
- Run the specified display trace and cold/warm measurements.
- Exercise the intended bundled worker/assets in the local Desktop WebView without network.
- Chromium-only browser evidence is not Desktop WebView qualification.
- Do not move explicit Q requirements to D/F merely because they remain unimplemented.
- Distinguish genuine later production/release gates from feasibility evidence explicitly required in Q.

### 4. Correct the decision framing

Native GDAL preparation and slope are already allowed by the plan. Do not ask the user whether slope must move to WASM; that is not an unresolved requirement.

Prepared derivatives and lazy prepared-cache conversion are already part of the plan. CogStream rejecting stripped input is a capability limitation, not by itself proof that the planned architecture fails. Establish whether bounded preparation plus the required bounded legacy reader satisfies the existing contract.

Do not introduce a capped whole-file fallback or weaken legacy readability/memory guarantees.

The whitebox-wasm source/artifact mismatch remains unresolved:

- Investigate a reproducible build of the pinned source, as allowed by Q.
- If proposing a different artifact, document exact correspondence, behavior differences, licensing, packaging, and evidence.
- Do not silently promote an alternate artifact to the accepted production route.

If a required WASM role genuinely fails, needs unbounded processing, or requires a broad fork/new transport architecture:

- Stop dependent work.
- Present concrete evidence and bounded options to the user.
- Do not automatically select an all-native GDAL replacement.

### 5. Scope and safety

Keep work isolated to the qualification harness, necessary qualification fixtures/tests, evidence, and narrowly relevant documentation.

No production engine switch, schema migration, IPC rollout, production dependency installation, or downstream feature work.

Keep private source pixels, credentials, private absolute paths, and large generated artifacts out of Git. Use explicit fixture paths and verify hashes. Never silently substitute fixtures.

For canopi-a9uy, inspect the existing test assumptions before deciding what explicit fixture selection requires. A different tile name alone does not establish that parameterization is impossible. Do not change expected scientific values or substitute a fixture without an explicit, documented basis.

Retain useful prior evidence, but replace misleading conclusions. Current operating guides must not present unqualified candidate observations as established production constraints.

### 6. Revised receipt and stopping condition

For every Q experiment, report:

- Required behavior
- Actual implementation exercised
- Exact reproducible commands
- Fixture/artifact identities
- Assertions and raw measurement locations
- Pass / fail / inconclusive / not run
- Remaining limitations and effect on Q eligibility

Provide:

- Fail-closed harness regression results
- GeoLibre reuse inventory
- Role-to-artifact table and exact adapter interfaces
- Supported and tested numeric-type/CRS matrix
- Explicitly unsupported or untested inputs
- Resource and scientific evidence
- Worker/cache/transport lifecycle
- Engine-specific derivative format and manifest contract
- Any actual user decision required

Run repository-required gates for every changed surface. If native or frontend host code is needed for isolated qualification, run its applicable Rust/frontend gates; do not classify executable harness changes as docs-only.

Record bead, branch, commits, delivery status, tests, documentation updates, and unavailable evidence. Do not claim integration or release merely because a branch was pushed.

Q passes only when its required evidence genuinely passes. Otherwise leave it blocked/open with an accurate receipt.

Stop after the corrected Q handoff for independent review. Do not begin N1.
