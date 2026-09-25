# Domain Docs

Canopi uses a single-context domain-doc layout.

## Read Before Writing

- Relevant terms in `CONTEXT.md` for product and domain vocabulary; search its headings before loading unrelated glossary entries.
- Relevant accepted records under `docs/adr/` for architectural decisions; do not read every historical ADR by default.
- `docs/agent/` for subsystem-specific implementation guidance.
- `AGENTS.md` for repo-wide operating rules.

## Write Rules

- Update `CONTEXT.md` only when a project-specific term or ambiguity is resolved.
- Create ADRs in `docs/adr/` only for decisions that are hard to reverse, surprising without context, and the result of a real trade-off.
- Keep subsystem guidance in `docs/agent/`.
- Separate implemented behavior, accepted future direction, and historical evidence explicitly. An accepted ADR does not by itself mean its feature has shipped.
- Keep ADRs focused on decisions, trade-offs, and supersession; link to subsystem guides for current module inventories and commands. Rewrite or delete an ADR when its decision changes.
- When code violates an accepted rule, track the defect in `bd` and distinguish current behavior from the intended contract; do not silently weaken the rule to match the defect.
- Keep skill workflow context in `docs/workflow/`; old `docs/agents/` paths are redirects.
- Keep skill docs focused on agent behavior; do not add auxiliary READMEs inside individual skill folders.
- Use terms from `CONTEXT.md` in bead titles, skill descriptions, workflow docs, and architecture proposals.
