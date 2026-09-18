# Q admission completeness — agent prompt

Status: proposed — bounded repair following independent review of `2c830b0d` at `d963f755`.
Tracking: `canopi-kqpp`, parent `canopi-j571`; bd owns execution status.
Current guidance: [implementation plan](../raster-data-analysis-rework.md), [review/debrief](review-and-debrief.md), [repository contract](../../../AGENTS.md).

Sending this prompt authorizes only the repair below. It supersedes the [evidence integrity prompt](q-evidence-integrity-agent-prompt.md). Q remains unqualified; N1 must not start.

## Start and scope

Read AGENTS.md, the plan's six Q experiments and exit contract, the LiDAR guide, the latest review/debrief and evidence-integrity receipt. Inspect `git status --short --branch` and `bd show canopi-kqpp`. Preserve the current branch stack through `d963f755`, including repair `2c830b0d`, prompt `0cc3b8fa`, earlier fixes and approved UI `0e696722`. Record this bounded scope and claim before coding. Continue the existing Q branch under repository rules; do not reset to main.

Read and apply **tdd** and **craft**, including required routed references; use **codebase-design** if changing the admission seam. Announce the concrete constraints. No subagents or skill edits. Report unavailable skills honestly.

Own only the qualification admission/evaluation/CLI seam, small tests and directly affected documentation. Reuse `Admission`, `admit_report`, `_fixture_problems`, `_source_correspondence`, `assemble`, and `evaluate`; do not replace the harness or build a generic schema framework. No dependencies, production code, engine/pin selection, source builds, new qualification runs, UI changes or private evidence regeneration. Native GDAL preparation/slope and prepared derivatives are already allowed; the user's engine-decision and prototype-approval gates remain intact.

## Required behavior

The four R4 findings in the review record are independently reproduced defects, not new scientific requirements. Required sets come from the declared experiment/role contract, never from whichever observations happen to be supplied. Missing evidence is inconclusive; conflicting evidence or measured failure is fail; pass requires all applicable evidence. **Adding a gap must never erase a known failure.** Preserve partial measurements separately from qualification.

### R4-01 — fixture membership and coverage

Compare observed fixture identities against the required fixtures for that report/role, not an undifferentiated global list. A report may intentionally cover a declared subset of the overall suite, but that subset must be explicit before admission. Reject an unexpected fixture as a conflict; missing required fixtures are inconclusive. Matching names require matching valid SHA-256 values. Reject duplicate identities rather than collapsing them in a dict. Missing expected raster manifest is inconclusive, not permission to trust the observed set. Artifact-only reports retain their explicit no-raster policy.

Wire the normal assembler CLI to the declared per-report manifest; currently supplying an empty fixture list cannot establish correspondence. Do not infer the expected manifest from the report being checked. A small explicit input manifest is sufficient; do not invent fixture identities for existing evidence.

### R4-02 — artifact correspondence coverage

Iterate the required measured artifacts and roles. Require correspondence for each exact artifact/version against its declared source pin. Unrelated correspondence cannot satisfy a required artifact; duplicate/conflicting records fail. A source pin claimed only by the measured report is not an independent expected pin. Read the existing candidate manifest/declared route; do not change its pins.

Retained native tools may use the existing explicit plan-authorized unpinned policy, never a broad escape hatch. A reproducible-build alternative needs the built artifact's identity/digest, source revision and recorded build evidence tied to the measured artifact; a boolean flag alone cannot excuse a revision mismatch. Do not run a build in this task. Missing evidence remains inconclusive; an observed mismatch fails unless valid evidence establishes that the measured artifact is the approved pinned build.

### R4-03 — source-run provenance

Require a nonempty source run identity and a finite, non-boolean recorded timestamp. Validate source age using the existing seven-day freshness limit, with one injectable evaluation time shared by assembly/admission/gate. Missing run/time is inconclusive; malformed or future time fails; expired evidence fails under the existing freshness policy. Equality at the age limit is accepted; greater age is rejected. Do not refresh source age when assembling a new bundle. Record the source's actual digest from the bytes read; do not treat a nonempty arbitrary digest string as proof of correspondence. Keep digest semantics explicit to avoid self-referential hashing.

This is a consistency boundary, not cryptographic attestation or proof measurements are truthful. Do not fabricate provenance for legacy reports. No production CLI flag may bypass freshness or supply a fake historical clock to qualify stale evidence; tests may inject time through an internal seam.

### R4-04 — failure precedence before identity gaps

Evaluate the report's known result, positive failures, malformed structure and failed preconditions even when identity is missing. Accumulate both failures and gaps, then apply `fail > inconclusive > pass`. Legacy reports stay readable, but explicit failures remain failures. Keep declared negative-control scope separate; do not promote expected rejection to positive capability evidence. A failure in one source must reach every requirement using that source, including requirements combining multiple reports, without failing unrelated requirements.

## Acceptance and test sequence

Use vertical RED → GREEN → refactor, one behavior at a time. Start each negative from a scientifically coherent passing control for the affected requirement through **raw report → real assembler → real gate**. Other unmeasured requirements may remain inconclusive; do not fabricate them to get an overall pass. Expected values and set membership must be independent of the implementation under test.

| Family | Isolated changes from valid control | Expected result |
| --- | --- | --- |
| Fixtures | Replace required fixture with another name/hash; remove one of two required fixtures; duplicate an identity; omit expected manifest | Conflict fails; missing coverage/manifest is inconclusive. No case passes. A valid declared per-report subset still passes. |
| Artifacts | Replace correspondence with an unrelated artifact; remove one of two required artifact records; wrong version/pin; duplicate record; revision mismatch plus only `buildReproduced: true` | None passes. Test the matching-source and fully evidenced pinned-build controls separately. |
| Provenance | `recordedAt: 1`; remove runId/time separately; NaN/infinity/bool timestamp; future timestamp; exactly-at/just-over age limit | Apply the explicit provenance policy above using fixed test time. Reassembly into a fresh bundle cannot change eligibility. |
| Precedence | Failed report + missing identity; failed precondition + missing fixture hash; source fail + stale timestamp; legacy passing report with no identity | Known failures stay fail with their reason retained; gap-only legacy case is inconclusive. Unrelated requirements are unchanged. |

Add compact table-driven invariants: deleting evidence never improves eligibility; adding unrelated evidence never satisfies a required member; adding a provenance gap never downgrades a failure. These are metamorphic tests over the bounded fixture/artifact/provenance fields, not permission for a general fuzzing project. Include malformed/duplicate source identity cases at JSON admission, where dict conversion could hide a conflict.

Test the actual normal CLI with small reports in a fresh temporary root, including expected manifest loading, nonzero verdict exits and emitted explanations. No mocked assembler/gate in these integration tests. Preserve synthetic publication restrictions and existing display, sidecar, lifecycle and runner regressions.

For each R4 family, capture a concise RED command/output, GREEN result and isolated guard-removal sensitivity result. Store a sanitized evidence excerpt in the receipt or a linked small text artifact; do not merely report that no transcript was saved again. Tests need fresh independent controls; avoid shared mutable manifests and test helpers shadowing unittest methods. Do not reconstruct past execution history.

## Gates, evidence reconciliation and stop

Run `python3 -m unittest discover -s scripts/raster-qualification/tests -v`, `bash scripts/raster-qualification/tests/test_runner_exit.sh`, `python3 scripts/check_docs.py`, and `git diff --check`, plus syntax/repository gates for changed files. No `run_all_experiments.sh` against the private evidence directory. Existing reports may be read-only inputs to evaluation in a fresh temporary output root. Record source digests and exact commands; if unavailable, state that limitation. Do not force the prior 12-inconclusive result: failures previously hidden by missing identity may legitimately reappear.

Add `q-admission-completeness-receipt.md` here, link it in the index and update the review/debrief with revision-linked outcomes. Mark repairs implemented/pending independent verification, not resolved. Reconcile stale statements in the Q receipt, LiDAR guide and bd notes. Retire this handoff after execution or supersession. Keep Q open, N1 unstarted and all engine decisions with the user. Follow repository commit/export/push rules and report exact delivery state.

Stop after this bounded repair for independent review. If completion needs an engine decision, scientific-contract change, new qualification experiment or broader architecture work, report the exact blocker rather than expanding scope. In the handoff, include tests, captured cycle evidence, source-evidence limitations, documentation changes and untouched user work. No green test count alone establishes qualification.
