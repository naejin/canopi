# Triage Workflow

Use this workflow for bd bead grooming and readiness management. Use `triage-issue` instead when the user wants root-cause bug investigation.

## Category And State

- Every triaged bead should have one bd `type` as its category.
- Every triaged bead should have exactly one readiness label as its state.
- If multiple readiness labels are present, resolve the conflict before doing anything else.
- Keep stored status aligned with the readiness state: triage states stay `open`; `wontfix` closes the bead.
- Unlabeled open beads normally move to `needs-triage` first.
- `needs-info` returns to `needs-triage` once the missing answer arrives.
- `ready-for-agent` and `ready-for-human` both require a durable brief.

## Canonical States

| Role | bd representation | Meaning |
| --- | --- | --- |
| `needs-triage` | `status=open`, label `needs-triage` | Maintainer needs to evaluate the bead. |
| `needs-info` | `status=open`, label `needs-info` | Waiting on a reporter or maintainer answer. |
| `ready-for-agent` | `status=open`, label `ready-for-agent` | Fully specified and safe for an AFK agent to pick up. |
| `ready-for-human` | `status=open`, label `ready-for-human` | Needs human judgment, access, or manual validation. |
| `wontfix` | `status=closed`, optional label `wontfix` | Will not be actioned. |

Use bd `type` for category: `bug`, `feature`, `task`, `epic`, `chore`, or `decision`.

## Applying A Role

For open roles, remove conflicting state labels, restore `status=open`, then add the new label:

```bash
bd update <id> --status open --remove-label needs-triage --remove-label needs-info --remove-label ready-for-agent --remove-label ready-for-human --remove-label wontfix --add-label <role>
```

For `wontfix`, remove the open-state labels, optionally add `wontfix`, then close the bead with a reason:

```bash
bd update <id> --remove-label needs-triage --remove-label needs-info --remove-label ready-for-agent --remove-label ready-for-human --add-label wontfix
bd close <id> --reason="..."
```

A readiness label without the matching stored status is inconsistent and will confuse queues such as `bd ready`.

Do not use `status=in_progress` as a triage state. `in_progress` means someone has claimed the bead.

## Ready For Agent Checklist

- The desired behavior or outcome is clear.
- Acceptance criteria are observable.
- Required dependencies or blockers are represented in bd.
- The bead does not require unresolved product, design, access, or policy decisions.
- Testing expectations are stated at the behavior level.

Write the durable brief into the bead `design` field and the completion checklist into the `acceptance` field.

## Rejection Memory

For rejected enhancements with lasting scope implications:

- Search for a similar `decision` bead with `bd search "<concept>" --type decision --status all`.
- Search `bd memories "<concept>"` for terse prior context.
- Reuse an existing decision when the concept is the same; otherwise create a new `decision` bead for the concept.
- Add a short `bd remember` entry only when the reasoning is useful across many future sessions.
- Close the rejected enhancement only after the durable decision record exists or is refreshed.
