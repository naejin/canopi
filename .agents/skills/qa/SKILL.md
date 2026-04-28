---
name: qa
description: Interactive QA session where user reports bugs or issues conversationally, and the agent files bd beads. Explores the codebase in the background for context and domain language. Use when user wants to report bugs, do QA, file issues conversationally, or mentions "QA session".
---

# QA Session

Run an interactive QA session. The user describes problems they're encountering. You clarify, explore the codebase for context, and file bd beads that are durable, user-focused, and use the project's domain language.

## For each issue the user raises

### 1. Listen and lightly clarify

Let the user describe the problem in their own words. Ask **at most 2-3 short clarifying questions** focused on:

- What they expected vs what actually happened
- Steps to reproduce (if not obvious)
- Whether it's consistent or intermittent

Do NOT over-interview. If the description is clear enough to file, move on.

### 2. Explore the codebase in the background

While talking to the user, kick off an Agent (subagent_type=Explore) in the background to understand the relevant area. The goal is NOT to find a fix — it's to:

- Learn the domain language used in that area (check UBIQUITOUS_LANGUAGE.md)
- Understand what the feature is supposed to do
- Identify the user-facing behavior boundary

This context helps you write a better issue — but the issue itself should NOT reference specific files, line numbers, or internal implementation details.

### 3. Assess scope: single issue or breakdown?

Before filing, decide whether this is a **single issue** or needs to be **broken down** into multiple issues.

Break down when:

- The fix spans multiple independent areas (e.g. "the form validation is wrong AND the success message is missing AND the redirect is broken")
- There are clearly separable concerns that different people could work on in parallel
- The user describes something that has multiple distinct failure modes or symptoms

Keep as a single issue when:

- It's one behavior that's wrong in one place
- The symptoms are all caused by the same root behavior

### 4. File the bd bead(s)

Create bd beads. Do NOT ask the user to review first — just file and share bead IDs.

Issues must be **durable** — they should still make sense after major refactors. Write from the user's perspective.

#### For a single issue

Use this template:

```
## What happened
[Describe the actual behavior the user experienced, in plain language]

## What I expected
[Describe the expected behavior]

## Steps to reproduce
1. [Concrete, numbered steps a developer can follow]
2. [Use domain terms from the codebase, not internal module names]
3. [Include relevant inputs, flags, or configuration]

## Additional context
[Any extra observations from the user or from codebase exploration that help frame the issue — use domain language but don't cite files]
```

Create the bead:

```bash
cat <<'EOF' > /tmp/qa.md
<completed issue body>
EOF
BEAD=$(bd create "Bug: <title>" --type bug --body-file /tmp/qa.md --silent)
echo "Created bead: $BEAD"
```

#### For a breakdown (multiple issues)

If the issue spans multiple independent areas, create a graph of beads:

<breakdown-template>
```json
{
  "nodes": [
    {
      "key": "qa-1",
      "title": "<title>",
      "description": "## What's wrong\n[Describe this specific behavior problem — just this slice, not the whole report]\n\n## What I expected\n[Expected behavior for this specific slice]\n\n## Steps to reproduce\n1. [Steps specific to THIS issue]\n\n## Additional context\n[Any extra observations relevant to this slice]",
      "type": "bug",
      "priority": 2
    }
  ],
  "edges": []
}
```
</breakdown-template>

If you created a tracking bead first, run `bd update <child-bead-id> --parent <tracking-bead-id>` for each child after creating the graph.
If issue B is blocked by issue A, add an edge: `{"from_key": "qa-A", "to_key": "qa-B", "type": "blocks"}`.

Write the JSON to a file and run:

```bash
bd create --graph /tmp/qa-breakdown.json
```

When creating a breakdown:
- **Prefer many thin issues over few thick ones** — each should be independently fixable and verifiable
- **Mark blocking relationships honestly** — use edges to capture real dependencies
- **Maximize parallelism** — the goal is that multiple people (or agents) can grab different beads simultaneously

#### Rules for all issue bodies
- **No file paths or line numbers** — these go stale
- **Use the project's domain language** (check UBIQUITOUS_LANGUAGE.md if it exists)
- **Describe behaviors, not code** — "the sync service fails to apply the patch" not "applyPatch() throws on line 42"
- **Reproduction steps are mandatory** — if you can't determine them, ask the user
- **Keep it concise** — a developer should be able to read the issue in 30 seconds

After filing, print all bead IDs (with blocking relationships summarized) and ask: "Next issue, or are we done?"
### 5. Continue the session

Keep going until the user says they're done. Each issue is independent — don't batch them.
