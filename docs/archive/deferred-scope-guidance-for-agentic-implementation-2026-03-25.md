# Deferred Scope Guidance For Agentic Implementation

Date: 2026-03-25

Purpose: document how to include ambitious deferred items in future plans without making the active implementation scope ambiguous for Claude Code or other agentic implementers.

## Core Rule

Be ambitious in the roadmap, not fuzzy in the executable scope.

Claude Code can handle a larger backlog than a human if the plan is explicit. It performs worse when a plan mixes:

- implement now
- implement later
- maybe implement if easy

Deferred work is good. Ambiguous work is not.

## Recommended Planning Structure

Each major plan should have three clearly separated sections:

1. Active implementation scope
2. Deferred / future scope
3. Readiness gates for deferred items

Do not bury deferred items inside implementation notes for active sub-phases.

## Rules For Deferred Items

Every deferred item should include:

- what the feature is
- why it is deferred
- the exact prerequisite
- what is currently missing
- what would make it ready
- whether it is blocked by schema, native infrastructure, external data, or performance risk

Good labels:

- `next`
- `blocked by schema`
- `blocked by native infra`
- `blocked by external data`
- `blocked by performance risk`

## What To Avoid

Do not write deferred items like this:

- "could be added later"
- "easy follow-up"
- "optional if time allows"
- "maybe in this phase if implementation goes smoothly"

Those phrases invite agentic scope creep.

## Good Deferred Item Template

Use this format:

```md
### Deferred: Shadow Projection

Status: blocked by feature prerequisite

Reason deferred:
- Requires celestial/sun-position infrastructure and plant-specific ray-casting

Missing foundation:
- Stable sun-position widget
- Per-plant canopy geometry assumptions
- Fast shadow intersection math

Ready when:
- Celestial dial exists
- Plant canopy/shadow model is defined
- Performance budget for shadow rendering is agreed

Not part of current implementation scope.
```

## Recommended Use In Phase Plans

For active implementation:

- keep acceptance criteria strict
- keep dependencies explicit
- keep schema changes explicit

For deferred implementation:

- document it well enough that a future agent can pick it up
- but mark it unambiguously as out of scope for the current session

## Good Candidates To Keep Deferred But Well-Specified

Examples from current Canopi planning:

- shadow projection
- growth timeline slider
- elevation/contour layer
- climate overlay
- relationship graph
- native high-DPI export
- PDF export
- native file watching

## Decision Standard

If an item cannot be started safely without inventing architecture, data semantics, or persistence rules during implementation, it should be deferred and documented with a readiness gate.

If an item is truly ready, it should move into active scope with:

- clear ownership
- explicit dependencies
- explicit acceptance criteria
- explicit verification

## Bottom Line

Future plans should be more ambitious in documenting the backlog, but not more ambiguous in defining the current implementation set.
