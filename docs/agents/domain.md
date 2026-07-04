# Domain Docs

Canopi uses a single-context domain-doc layout.

## Read Before Writing

- `CONTEXT.md` for product and domain vocabulary.
- `docs/adr/` for architectural and workflow decisions.
- `docs/agent/` for subsystem-specific implementation guidance.
- `AGENTS.md` for repo-wide operating rules.
- Category READMEs when changing catalog entries.

## Write Rules

- Update `CONTEXT.md` only when a project-specific term or ambiguity is resolved.
- Create ADRs in `docs/adr/` only for decisions that are hard to reverse, surprising without context, and the result of a real trade-off.
- Keep subsystem guidance in `docs/agent/`.
- Keep skill workflow context in `docs/agents/`.
- Keep skill docs focused on agent behavior; do not add auxiliary READMEs inside individual skill folders.
- Use terms from `CONTEXT.md` in bead titles, skill descriptions, workflow docs, and architecture proposals.
