# Implementation prompt

Copy the following prompt into a new agent session with this repository checked out.

```text
Implement the Desktop/Web development-convergence specification in
/home/daylon/projects/canopi/docs/design/edition-convergence/handoff.md.

Read AGENTS.md first, then the handoff completely. Use craft and codebase-design.
Inspect the current checkout and tests independently: the specification baseline
is cfa16e8c, and neither past completion reports nor passing tests establish the
current behavior. Preserve all dirty/untracked user work. Do not use subagents.

This is an implementation request. Create or reuse a bd epic with scoped,
dependent slices and claim work before coding. The closed canopi-0d0q bead is
for authoring the handoff, not for implementing it. Use description/design/
acceptance fields and link the spec; keep progress in bd rather than markdown
task lists. Follow repository branch, validation, export, commit, and push rules.

Deliver in this order:
1. Reliable dev commands and CI validation for both editions and the UI gallery.
2. Shared workspace/dock/panel composition using existing command capabilities.
3. A bounded canvas-host lifecycle assessment and justified extraction.
4. A bounded catalog-presentation assessment and justified consolidation.

For 3 and 4, a source-backed decision to retain separate adapters is acceptable
when unification increases complexity. Complete and record the assessment; do
not silently defer it. Prioritize fewer policy owners and simpler callers.

Preserve the existing shared command catalog, Design Session replacement and
persistence coordinators, SceneStore/Design Edit authority, and catalog workbench.
Keep compile-time infrastructure adapters. Do not add a generic application
factory, duplicate feature-flag authority, database migration, richer Web catalog,
Web Location/Notebook/Problem Reports, or an unrelated UI redesign. Preserve
native Save versus browser Download/Draft semantics and all unsupported data.

Documentation is a required implementation deliverable. In each code slice,
replace stale ownership/command/gate instructions in affected operating guides.
Deliver docs/agent/edition-development.md with a practical, verified daily agent
workflow: entry-point/owner map, safe setup, exact working directories and dev
commands/URLs/ports, fixture/reset/isolation behavior, focused-to-integration
testing, change-to-check routing, and commit/push handoff. Link it from AGENTS.md,
frontend routing, and docs/README.md. Update all docs identified by the handoff,
including Browser Edition, lifecycle, build/release, validation, gallery README,
and relevant design/ADR references. Do not advertise planned commands as shipped.
When finished, retire or mark this handoff completed and point to durable guides.

Use deterministic synthetic fixtures and the memory-only gallery. Exercise actual
clicks, keyboard/focus, panel changes, resize/scroll, Design replacement with
repeated IDs, and lifecycle cleanup/retry/HMR. Preserve unknown/deferred Design
data and regression assertions. Use isolated browser/WebView sessions; do not
touch the user's active Desktop, saved Designs, settings, or Downloads files.

Run focused tests while editing, then all applicable AGENTS.md gates and the
handoff's combined frontend/build/generated checks. Verify actual Web bundles,
not just config assertions. Preserve native-import, asset-size, and architecture
guards. Distinguish deterministic packaging fixtures from release catalog data.
Record exact commands, revisions, outcomes, baseline failures, and platform gaps.
The PDF WebView probe does not prove shell/popup or native save-dialog behavior.

Continue through implementation, verification, documentation coherence, bead
export, commits, and branch pushes. Verify the delivered checkout contains every
required fix. Do not deploy or publish a release. Finish with a concise handoff
covering delivered behavior, remaining justified differences, documentation,
beads, commits/branches, checks, limitations, and user work left untouched.
```
