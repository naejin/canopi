# Independent review of the consolidated raster candidate

Status: evidence — changes required at `26eca68a`; not independently accepted.
Tracking: `canopi-j571.1` under `canopi-j571`; findings remain inside the existing completion scope.
Current guidance: [prompt](completion-agent-prompt.md), [correction decisions](completion-correction-design.md), [completion contract](completion-design.md), [source import](source-import-design.md), [receipt](completion-receipt.md).

## Disposition and evidence

The 2026-09-23 review inspected the delivered `feature/raster-rework-completion`
candidate, its actual callers, accepted contracts and reported evidence. Functional
defects and incomplete accepted requirements remain; this is not a candidate
waiting only for an external host or Google account. The user accepted repair
on this branch, followed by independent review, then separately authorized
integration into the normal development checkout. No code was changed by review.

An isolated archive at `/tmp/canopi-review-26eca68a` contains diagnostic additions.
From its `desktop/web`, the following run produced **10 failing diagnostic
assertions and 44 passing tests** (54 total, six files, 3.04 s):

```bash
npx vitest run src/__tests__/basemap-settings.test.tsx src/__tests__/review-provider-regressions.test.ts src/__tests__/basemap-provider-session.test.ts src/__tests__/lidar-library-store.test.ts src/__tests__/lidar-inspection.test.ts src/__tests__/basemap-contribution.test.ts
```

The log is `review-probes.log` at that archive's root. This temporary archive is
optional evidence, not a dependency: the examples below suffice to recreate
ordinary committed regressions. The original provider-session tests all passed;
the settings probe strengthened the existing key-clear test with its visible
prompt expectation. Review did not repeat the full native, ignored-GDAL or
platform gates. Source-traced findings are distinguished from reproduced tests.
Line numbers below refer to `26eca68a`, with paths relative to the repository.

## Findings

R27–R43 continue the earlier finding IDs. They do not introduce a new product
scope or replace R15–R26's retained regressions. The correction design settles
implementation decisions; this table records what failed and its impact.

| ID / severity | Evidence at the delivered revision | Required observable correction |
| --- | --- | --- |
| R27 / P1 — old source ceilings remain | Source trace: `desktop/src/services/lidar/admission.rs:32`, import selection/copy/publication callers still enforce 24 files, 2 GiB per file/selection and 400M processing cells. The source-import amendment explicitly supersedes those policies. | After bounding all new-route consumers, supported sources above the old limits succeed through production admission. Genuine resource/format refusals name their reason. Do not just delete constants. |
| R28 / P1 — copy/hash cancellation missing | Source trace: `import.rs:690` (`stage_managed_original`), `hash_file_limited` and `raster_assets::hash_file` have no cancellation input. A cancelled import continues copying/hashing and holds the heavy lease. The 101 ms GDAL-child test does not exercise these phases. | Cancel during original copy, reused-original verification and retained-COG hashing stops the real loop, publishes nothing, preserves reused bytes and releases owned work; healthy retry succeeds. |
| R29 / P1 — catalogue lock crosses GDAL | Source trace: `collection.rs:508` retains its catalogue guard through `coverage_bounds` at line 551, which runs a GDAL transform. Slow transforms block unrelated catalogue operations. | Metadata reads release the guard before subprocess/reader work. A held transform must not prevent another library/status read. |
| R30 / P2 — conversion has elapsed-time ceiling | Source trace: `engine.rs:128` passes the common 600-second timeout to source conversion, contrary to the explicit long-conversion exception. | Only controlled source conversion may outlive that elapsed limit; explicit cancel/shutdown still terminates and reaps it. Probe/transform deadlines stay finite. |
| R31 / P2 — slope uses the wrong admission measure | Source trace: `analysis.rs:728` applies the 25M dense grid guard before choosing sparse work. A large single input fails, while many members beyond a small original lattice escape that check. | Sparse slope is admitted using its own actual checked working/storage estimate; dense compatibility keeps its guard. Refusal leaves the viewable source and previous result intact and honestly labelled. |
| R32 / P2 — import never attaches on completion | Source trace: frontend `app/lidar/actions.ts:102` submits and tracks without retaining the submitting Design identity; the polling owner never attaches the successful layer. | Successful import attaches once in its submitting Design only; failed/cancelled imports do not attach. Closing Data must not lose completion; changing Design prevents attachment there. |
| R33 / P2 — reopening Data freezes progress | Reproduced: `app/lidar/library-store.ts:112` stops polling on observer disposal; installation only refreshes the library. Start Staging, close Data, settle backend to Complete, reopen and advance time: job stays Staging. | Panel navigation cannot stop active-job settlement; reopening shows current progress/terminal state and permits the next action. |
| R34 / P1 — completed inspection becomes silently stale | Reproduced: `app/lidar/inspection.ts:202`. Sample gen-1 successfully, change library head to gen-2, even call reconciliation: old value remains `value`. Only in-flight head changes are fenced. | Already displayed answers become stale on a head change. In-flight work cancels; response publication and native completion both validate current identity. |
| R35 / P2 — re-aim drops cancellation handle | Reproduced: `inspection.ts:147`. Begin, submit a pending sample, begin inspection again: no cancellation call names the previous request. | Cancel the old request before replacing the session, including same-target re-entry. Late results cannot restore old state. |
| R36 / P1 — provider config does not replace sessions | Source trace: Canvas/Location/WorldMap owners observe style but not key/locale. Reproduced separately in `basemap-provider-session.ts:222`: establish key A, update to key B, no second session request; the old token is paired with the new key. | Actual settings changes reach every mounted owner and invalidate incompatible session/viewport/credential state. Key clearing, key replacement and locale changes require no map recreation. |
| R37 / P1 — latest viewport is lost | Reproduced: `basemap-provider-session.ts:420`. Hold viewport A's metadata request, move to B, resolve A: no B request follows. A's copyright/availability can describe B. | Bound/coalesce requests while retaining the latest viewport; stale viewport metadata never publishes as current. |
| R38 / P1 — imagery ready before metadata | Reproduced: `basemap-provider-session.ts:316`. Resolve the session while leaving viewport metadata pending: state is already Ready with installed tile credentials. | Official imagery is available only with a current valid session and usable viewport metadata. Missing/malformed copyright or availability is not established metadata. |
| R39 / P2 — metadata failure cannot recover | Reproduced: `basemap-provider-session.ts:452`. Fail viewport metadata, then succeed on a new viewport: Ready-only guard leaves Unavailable and cleared credentials. | A valid next request can restore credentials, renewal and Ready. Error-specific retry stays bounded; no silent fallback to keyless tiles. |
| R40 / P2 — zoom availability only decreases | Reproduced: `basemap-provider-session.ts:458`. Move from metadata max zoom 15 to 20: descriptor remains 15 because it is clamped against its already-clamped predecessor. | Current metadata is evaluated against the base provider ceiling, permitting increases and decreases without stale restrictions. |
| R41 / P2 — metadata destroys the tile source | Reproduced: `basemap-contribution.ts:111`. Publish an identical ready state twice: second publication removes the source. Viewport updates discard loaded source state and reload imagery. | Unchanged tile configuration retains the source; copyright updates reach attribution without resetting it. Preserve order, opacity, camera and overlays. |
| R42 / P2 — settings feedback stays cached | Reproduced: `components/canvas/BasemapSettings.tsx:41` captures plain values inside `useComputed`. Clear the saved key: signal clears but required keyless prompt does not appear. | Visible availability/prompt follows actual settings changes, not just initial mount. |
| R43 / P1 acceptance gap — residue claimed as peak storage | Source trace: `e2e.rs:49` and its callers measure directory bytes after settlement. Receipt calls this peak live scratch. Low-space/write-failure and concurrent queue evidence remain unverified. | Report live peak, durable bytes and settled residue distinctly. Complete real admission/write/publication fault and concurrent-read evidence; retain explicit external limits. |

The official provider's attribution requirement was checked against
[Google's policies](https://developers.google.com/maps/documentation/tile/policies):
the viewport response supplies the required data attribution. This source does
not establish live access with a restricted key or correctness of the keyless path.

## Review limits and responsibility

This is bounded independent review, not proof that the remaining code is free of
defects. The executor must audit all C0–C5 acceptance, not equate seventeen repaired
examples with complete delivery. In particular retain the accepted same-definition
Analysis Retry, native post-read head fence, live workflow, historical compatibility
and source-import failure requirements even where this review added no new probe.

R27–R42 primarily expose implementation and test gaps against existing decisions;
R43 is also a claim/evidence error. Earlier reviews missed parts of these same
lifecycle families; the main agent owns that review limitation and any decision
omissions. Do not infer a model/language cause from these observations. Record
the next repair's actual self-review discoveries and detector improvements in the
[existing debrief](review-and-debrief.md#whole-rework-delivery-and-improvement).
