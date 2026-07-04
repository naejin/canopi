# Model-Invoked vs User-Invoked Skills

Every `SKILL.md` in this repo-local catalog is a skill. The main catalog interface is invocation: who can reach it.

- **User-invoked** skills are reachable only when the human names the skill. Set `disable-model-invocation: true`. The `description` is human-facing.
- **Model-invoked** skills are reachable by the model or the human. Omit `disable-model-invocation`. The `description` is model-facing and keeps trigger phrasing such as "Use when..." so automatic invocation works.

Pick model invocation only when the agent should use the skill autonomously, or when another skill needs to invoke it as shared discipline. Pick user invocation for orchestration skills that should run only after the human chooses the flow.

Because user-invoked skills have no model-facing trigger, they should point the human at other user-invoked skills rather than claiming they can call them. User-invoked skills may rely on model-invoked shared disciplines such as `grilling`, `domain-modeling`, `codebase-design`, `craft`, `tdd`, and `diagnose`.

## Catalog Shape

Repo-local skills are installed as flat folders under `.agents/skills/`. Copy full skill folders, never only `SKILL.md`, because many skills rely on bundled reference files.

## bd-First Constraint

Invocation does not change the tracker rule. Any skill that creates, updates, triages, or closes work uses bd beads. Do not introduce GitHub, Linear, or markdown TODO issue flows into active engineering or productivity skills.

## Dependencies

Prefer prose skill references such as "use `domain-modeling`" for shared discipline. Use direct relative links only for bundled reference files that live inside the same skill folder or for stable repo docs such as `docs/agents/issue-tracker.md`.
