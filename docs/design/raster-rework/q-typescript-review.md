# TypeScript qualification — standing independent review

Status: evidence — baseline review at `abf502b6` / `df54b314`; complete decision path not accepted.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns work status.
Current guidance: [standing prompt](q-typescript-repair-agent-prompt.md), [C1–C8 contract](q-admission-acceptance.md), [migration receipt](q-typescript-receipt.md), [debrief](review-and-debrief.md).

This is the single review record for the bounded TypeScript repair. Update it in place after each user-forwarded independent review. Implementers may append responses with revision/test references, but must not mark their own changes independently accepted. Preserve revision-linked findings; use bd for execution tracking rather than adding Markdown task lists.

## Baseline evidence and retained work

The reviewer independently verified the TypeScript build, 74 emitted tests, 14 stub-runner checks, documentation validation and diff checks. The initial sandboxed test run failed because child-process stderr capture returned `EPERM`; an authorized unrestricted rerun passed all 74. Record environment failures separately from code failures; never weaken stderr assertions to accommodate the sandbox.

Retain TypeScript, source-byte parsing, recomputation instead of bundle trust, the runner's TypeScript decision routing, the strict boolean/JSON regressions and previously accepted R5 behaviors. Passing these checks is not acceptance of every invariant. No private qualification experiment or read-only private reconciliation was independently rerun in this review. The 261 retained Python tests were reported by the implementer, not rerun in this TypeScript review.

## Blocking families within C1–C8

All examples used the emitted real CLI with fresh small temporary reports. Start from `roleReports()`, `SOURCE_ROLES`, `NOW`, the real contract and fixture/pin declarations in `ts/tests/{contractFixture,fixtures}.ts`, and `TempRoot`/`runCli` in `helpers.ts`. Assert the target requirement and reason, not just overall exit 1: permanent gaps already prevent overall qualification.

| Family / contract | Reproduction at baseline | Required behavior and family scope |
| --- | --- | --- |
| T1 — keyed identity, C1/C8 | Add a second `q2` source: a failed source before a passing source yields `Q-LOCAL-1=pass`; reversing order yields fail. `decide.ts` constructs `byRole` with last-write-wins | Identical and conflicting duplicate source roles are invalid, independent of order. Check every keyed source/run/artifact/declaration collection before indexing, with failure reasons retained. Do not merely reverse which duplicate wins |
| T2 — per-run completeness and precedence, C5/C8 | Append an otherwise complete candidate run without `incrementalPeakRssMiB`: `Q-RES-1` passes. Set decoded cache to 1 GiB and remove `sampleCount`: a known 128 MiB violation becomes inconclusive | Missing mandatory memory for any applicable run is a gap; any independently recorded over-limit value remains fail despite sampling gaps. Check all per-run fields, sampling, invalid values, attribution and permutations. A shared reduction cannot repair evidence silently discarded before it reaches the reduction |
| T3 — required artifact coverage, C3/C4 | Delete `integrity:cog-tiler-wasm`, or replace integrity assertions with only `integrity:unrelated`: `Q-ART-1` passes. Set preparation's recorded artifact to `{name: "unrelated-engine", version: "999"}`: `Q-PREP-1` passes | Required sets come from declarations, not the supplied prefix matches. Every required artifact needs applicable integrity/version/license/correspondence evidence. Native preparation/slope/CRS roles also need declared applicable identity checks; an unpinned source revision does not mean any engine identity is acceptable |
| T4 — sidecar evidence, C2/C4 | Declare measured sidecar with `{expectedSha256: "x", sha256: "x"}` and no survival observation: `Q-PREP-1` passes | Malformed digests fail; missing survival/before-after evidence is a gap, and false survival or conflicting hashes fail. Check measured/not-applicable/unmeasured policies and all consumed nested leaves without promoting arbitrary equality into preservation evidence |

Additional T2 scope already required by C5: display disk-cache compliance (512 MiB) and the plan's staging/free-space policy are not established by the current reducer. Supplying an extra `displayDiskCacheBytes=1 GiB` leaves the baseline passing; this is not proof that the producer defines that field. Establish and validate the actual observation contract, or return inconclusive if unsupported. Do not invent a universal temporary-disk cap or run a new producer experiment. Missing policy evidence must not yield a resource pass.

These are false **individual requirement** passes and lost failures, not an observed overall Q pass. Source locations at the reviewed revision: `ts/src/decide.ts`, `reduce.ts`, `declared/route.ts`, and `evidence/{resources,artifactCorrespondence,preparation}.ts`. Recover exact baseline code with `git show abf502b6:<path>`; line numbers may change.

## Review protocol and round record

The user remains the courier and approval point. No direct implementation/reviewer delegation is authorized. The [standing prompt](q-typescript-repair-agent-prompt.md) defines the two-round limit and self-review requirements. This baseline discovery review is round 0; the next user-authorized repair delivery and its independent review form round 1. No repair round has been delivered under this protocol yet.

For each reviewed delivery, append a compact evidence entry: starting/final commit; family-level response; commands actually run; independently accepted behaviors; remaining blockers with C IDs, minimal input and expected/observed result; optional follow-ups; environment and unavailable evidence. Review all C1–C8 boundaries in one pass before handoff and explicitly identify unreviewed portions. New blocker examples must cite an existing invariant; changing the acceptance contract requires user approval. Never imply exhaustive proof from a finite sweep.

## Round 1 implementation response (implementer, not acceptance)

Delivered from `abf502b6`/`df54b314`; section appended to the [migration receipt](q-typescript-receipt.md#round-1--repair-against-the-standing-review-at-abf502b6) and the reproduction/mutation log is [q-typescript-repair-round1.txt](evidence/q-typescript-repair-round1.txt). Awaiting independent review; nothing below is accepted on the implementer's authority.

| Family | Family-level response | Evidence |
| --- | --- | --- |
| T1 | Source roles are counted before indexing; a role claimed more than once is rejected outright and omitted from the index, and the ambiguity reaches the requirement as a failure rather than a gap. Order no longer decides the verdict. | `t1DuplicateRoles.test.ts`; Q-VALUE-1's two-source case in `adversarialRound1.test.ts` |
| T2 | Memory became a mandatory per-run observation; every leaf is classified usable / present-but-unusable / absent; the budget check reads every record that recorded the counter, so a measured over-limit value survives a sampling gap in the same record. | `t2RunReduction.test.ts` |
| T3 | Required sets come from the declarations: each required artifact's own version, integrity and license record is looked up by name, and the retained-engine roles declare native GDAL with the name compared and the version recorded. | `t3ArtifactCoverage.test.ts` |
| T4 | Malformed digests fail, absent ones are gaps; hash equality is no longer treated as survival evidence, so a measured record must observe presence before and after. | `t4Sidecar.test.ts` |

Two review notes are answered explicitly rather than deferred. The plan's 512 MiB display disk-cache bound and its staging/free-space policy have no producer observation, so the requirement now carries an unconditional gap and a caller cannot move it by inventing a field name; `Q-RES-1` moved out of the fixture's supported set as a recorded consequence. The reviewer's environment note did not recur: child-process capture worked for every case in this round.

Reported honestly for review: eleven guard-removal probes were run, and **one (G4) was a genuine gap in the implementer's tests** — reverting the budget check to sampled records left the suite green because every over-limit case had a second healthy run. Two cases were added and the re-probe now fails. The sweep and adversarial pass also surfaced three defects in the implementer's own expectations and two in its fixtures, all recorded in the log. No claim of exhaustive coverage is made from a 32-mutation sweep.
