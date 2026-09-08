# Canopi issue tracking

Canopi uses `bd` with Dolt as the live issue store. The tracked
`issues.jsonl` is an exported recovery/interoperability snapshot; local Dolt
files and runtime state are ignored by Git.

Read [the issue-tracker guide](../docs/agents/issue-tracker.md) for the project
workflow and [AGENTS.md](../AGENTS.md) for implementation and handoff rules.

```bash
bd ready
bd show <id>
bd update <id> --claim
bd close <id> --reason "Shipped outcome and verification"
bd export -o .beads/issues.jsonl
```

Export after the final bead updates and commit the snapshot with the code.
Use `bd dolt push` to sync the live issue store separately from `git push`.
Run `bd prime` for the installed CLI workflow reference.
