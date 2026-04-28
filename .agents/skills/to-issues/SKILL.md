---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable bd beads using tracer-bullet vertical slices. Use when user wants to convert a plan into beads, create implementation tickets, or break down work into beads.
---

# To Issues

Break a plan into independently-grabbable bd beads using vertical slices (tracer bullets).

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a bd bead ID as an argument, fetch it with `bd show <id>`.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Create the bd beads

Build a JSON graph plan with all approved slices and create them in one batch using `bd create --graph`. This preserves dependencies natively.

If the user provided a parent bead ID (e.g. from a PRD epic), run `bd update <child-bead-id> --parent <parent-id>` for each child after creating the graph.

<graph-template>
```json
{
  "nodes": [
    {
      "key": "slice-1",
      "title": "<slice title>",
      "description": "## What to build\nA concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.\n\n## Acceptance criteria\n- [ ] Criterion 1\n- [ ] Criterion 2\n- [ ] Criterion 3",
      "type": "task",
      "priority": 2,
    },
    {
      "key": "slice-2",
      "title": "<slice title>",
      "description": "...",
      "type": "task",
      "priority": 2,
    }
  ],
  "edges": [
    {
      "from_key": "slice-1",
      "to_key": "slice-2",
      "type": "blocks"
    }
  ]
}
```
</graph-template>

Write the JSON to a file (e.g. `/tmp/slices.json`) and run:

```bash
bd create --graph /tmp/slices.json
```

`bd create --graph` resolves all dependencies in one shot. You do not need to create blockers first.

After creation, share the mapping of slice keys to bead IDs with the user.

Do NOT close or modify any parent bead.
