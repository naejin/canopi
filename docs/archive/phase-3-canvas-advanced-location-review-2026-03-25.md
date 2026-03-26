# Review — Phase 3 Canvas Advanced + Location Plan

Date: 2026-03-25

Reviewer: Codex

Subject: Fourth-round review of `/home/daylon/.claude/plans/warm-moseying-pebble.md`

## Executive Summary

This plan is now effectively implementation-ready for Claude Code.

The major architecture problems from earlier drafts are resolved:

- persistent plant identity is an explicit prerequisite
- grouping no longer overloads `Zone`
- consortiums now use placed-plant IDs
- Plant DB sidebar work is out of scope
- GeoJSON ownership is clear
- Konva-vs-MapLibre authority is clear
- the interactive timeline now has staged completion criteria

At this point, the remaining issues are small consistency errors, not blockers.

## Bottom Line

I would approve this plan for implementation after one final consistency cleanup pass.

The cleanup is short:

1. fix the stale `3k` feature sentence that still says the celestial dial is driven by "design start date"
2. align AD-3 with `3h` so both describe the same canopy-spread behavior
3. resolve the `write_file` vs existing `export_file` command naming mismatch

If those are cleaned up, the plan is ready to hand to Claude Code.

## What Now Looks Good

### 1. The dependency structure is finally solid

`3-pre` is the right prerequisite and it is placed correctly.

That now gives a safe base for:

- `3g` dimension attachments
- `3l` consortium membership
- future cross-object references

This matches the actual repo problem in:

- [`desktop/web/src/canvas/serializer.ts`](/home/daylon/projects/canopi/desktop/web/src/canvas/serializer.ts)
- [`common-types/src/design.rs`](/home/daylon/projects/canopi/common-types/src/design.rs)
- [`desktop/web/src/types/design.ts`](/home/daylon/projects/canopi/desktop/web/src/types/design.ts)

### 2. Grouping is now modeled as a canvas feature, not a fake zone type

The move to top-level `ObjectGroup[]` records is the right correction.

The added Phase 3 rule that only zones and plant groups are groupable also closes the earlier ID ambiguity.

That is detailed enough for an implementation agent to follow safely.

### 3. Consortium persistence is now coherent

The new consortium shape:

- `id`
- `name`
- `plant_ids`
- `notes`

is the first version that actually supports the intended behavior.

That aligns with the current codebase and fixes the prior schema mismatch:

- [`desktop/web/src/components/canvas/ConsortiumTab.tsx`](/home/daylon/projects/canopi/desktop/web/src/components/canvas/ConsortiumTab.tsx)

### 4. The timeline now has a good execution boundary

The `must-have` / `can-follow` split is exactly the kind of staging an agentic implementer needs.

`3m` is still large, but it is now decomposed well enough to prevent uncontrolled sprawl.

### 5. GeoJSON import is now specific enough

The new constraints section fixes the earlier ambiguity:

- supported geometry types are defined
- hole handling is defined
- missing-location behavior is defined
- property mapping is defined

That is sufficient for a first implementation pass.

## Remaining Findings

### 1. `3k` still contains one stale feature sentence

In the `3k` features list, the plan still says the celestial dial is driven by:

- design location
- design start date
- selected timeline action date

But the implementation notes correctly say:

- there is no design-start-date fallback
- the dial only appears for a selected dated timeline action

This is now just an internal contradiction.

Recommendation:

- remove `design start date` from the `3k` feature list so the section is self-consistent

### 2. AD-3 and `3h` still describe canopy spread differently

AD-3 still says:

- group counter-scale temporarily adjusted so circles show real coverage

But `3h` correctly says:

- do not disable group counter-scale
- scale the circle radius to compensate while keeping labels readable

The `3h` version is the right one.

Recommendation:

- update AD-3 to match the `3h` implementation notes

### 3. The new Rust command naming does not match the existing repo pattern

The plan says:

- extend `commands/design.rs` with `write_file`

But the repo already has a generic text export writer in:

- [`desktop/src/commands/export.rs`](/home/daylon/projects/canopi/desktop/src/commands/export.rs)

and the frontend already uses:

- [`desktop/web/src/ipc/design.ts`](/home/daylon/projects/canopi/desktop/web/src/ipc/design.ts)

through `export_file`.

So the plan currently creates unnecessary ambiguity:

- should the implementation reuse `export_file`
- or add a new `write_file`

Recommendation:

- prefer reusing/extending `export_file` unless there is a strong reason not to
- if a new command is truly needed, explain why the existing one is insufficient

## Final Assessment

Earlier drafts were not safe to implement directly.

This draft is.

The remaining issues are minor enough that they should be fixed in the plan text, but they are no longer reasons to reject the plan.
