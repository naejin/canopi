# Architecture ownership and user-mediated delivery

The main agent owns architectural coherence across Canopi, not just review after implementation. This is responsibility for design quality and consistency, not permission to change product direction, expand scope or override the user. The user retains final authority over priorities, product behavior, risk, consequential trade-offs and authorization. Existing accepted contracts and repository safety rules remain binding.

## Responsibilities

| Role | Owns | Does not assume |
| --- | --- | --- |
| Main agent — architecture owner and reviewer | Investigates code and contracts; settles interfaces, data/resource ownership, lifecycle, failure and compatibility behavior; explains trade-offs; produces executable handoffs; independently reviews implementation against those contracts | Permission to change user choices, start implementation/experiments, integrate or release merely by approving a design |
| Implementation agent | Implements the authorized handoff; chooses routine internal details; maintains tests and affected guides; performs bounded self-review; delivers reproducible evidence | Authority to invent missing cross-subsystem contracts, silently redesign the plan, weaken acceptance or declare its own delivery independently accepted |
| User | Sets direction and priorities, approves consequential scope/product/risk decisions, forwards assignments and review results | Responsibility for reconciling conflicting technical instructions or supplying facts agents can inspect themselves |

The main agent is the user-facing design/review role, not a particular model or permanent process. An implementation agent can propose a better design, but material changes return through the user before implementation. Without an available architecture owner, record the precise unresolved decision and hold only the affected work; do not silently self-approve a different contract.

## When architectural review is needed

Settle the architecture before implementing changes to shared interfaces or IPC, persistence/schema or compatibility, authoritative state or resource ownership, lifecycle/concurrency across modules, dependency direction, runtime dependencies/engine choices, security/privacy boundaries, or cross-subsystem/edition behavior. Reusing an already settled design does not require approval at every internal milestone.

Routine local implementation remains delegated: internal naming and file organization, algorithms within fixed correctness/resource limits, test organization, and behavior-preserving refactors that do not change the boundaries above. For example, a private helper extraction needs no architecture checkpoint; moving document mutation authority or introducing a new native command does. If an apparently local choice changes a contract, stop that part and escalate with evidence.

Review is proportional to risk. Do not create an architecture committee for every function, a generic framework for an unproven future use, or a new ADR for every coding choice.

## Handoff contract

For architecture-sensitive work, the main agent inspects relevant code, callers, tests and accepted decisions before handing off. One current handoff must identify:

- Outcome, inspected revision, scope, existing work to preserve and explicit exclusions.
- Fixed decisions: interfaces and dependencies; data/resource owners; setup, update, cancellation and teardown; failures/recovery; handling of old data (refuse, set aside or delete; no migrations); applicable security and resource constraints.
- Delegated choices: what the implementer may decide locally without another courier exchange.
- Evidence: representative inputs, positive and failure cases, independently derived expected outcomes, required gates, unavailable environments and acceptance owner.
- Execution limits: first action, internal milestones, stop/escalation conditions and actions requiring separate user authorization.

Use the smallest artifact that closes these decisions: a focused bead brief or existing plan section can suffice. Mark genuinely unresolved decisions as blockers for the affected slice, not hidden implementation tasks. Architectural omissions in a handoff are the main agent's responsibility to resolve. Do not ask an implementer to discover the intended architecture through repeated failed deliveries.

Before prescribing consequential new machinery, include a short necessity/reuse check in that same handoff: the user capability unlocked; the inspected existing or standard solution; the concrete reason it cannot satisfy the contract unchanged; the new ownership/maintenance cost; and any uncertainty that could overturn the choice. Distinguish required behavior from replaceable implementation choices. An untested risk is not evidence that a standard solution is inadequate. When feasibility is uncertain, put the smallest decisive caller-level check first and continue automatically on success, rather than elaborating a framework or requiring another routine approval. Do not create a separate planning checklist/report for this check.

Implementation agents should challenge demonstrably unnecessary architecture before building it, with evidence and a simpler alternative. Behavior-preserving internal simplifications remain delegated; changing fixed persistence, ownership or scientific contracts still requires main-agent resolution through the user. The main agent reviews necessity and product progress before exhaustive hardening, and owns corrections to overprescribed designs. New requirements are not retroactive blockers. Measure the intervention through usable workflows, material decisions returned and escaped defects, not document detail or test totals.

If code and an accepted contract disagree, identify the discrepancy and track it in bd; neither agent may quietly weaken the contract to match the code. If an old plan conflicts with current guidance, the main agent reconciles authority before execution resumes. Do not make the user mediate incompatible technical instructions.

## Courier and review boundary

The user remains the courier between the main agent and implementation agent unless explicitly changing that arrangement. Forward a handoff path and revision; return a delivered revision and receipt. These artifacts must be understandable without recovering chat history. No direct agent-to-agent messaging or unattended continuation is implied by this agreement; subagents follow the repository's subagent rules.

The implementer completes authorized internal milestones and fixes in-scope findings before one consolidated delivery. A material conflict is escalated with the observed behavior, violated contract, alternatives, recommendation and the exact work blocked. Safe independent work may continue within scope. Optional cleanup goes to follow-up beads, not an expanded assignment.

The main agent reviews the agreed risk boundaries and produces one disposition: accepted for a named scope, partial with concrete blockers, or insufficient evidence with the missing proof named. Findings cite an existing invariant, reproduction/source evidence, impact and affected scope. New requirements require a revised design and user approval; they are not retroactive acceptance conditions. Preserve accepted work and distinguish known blockers from optional hardening. Review is not exhaustive proof, and acceptance does not imply integration or release; use the [delivery states](delivery.md).

## Evidence-based improvement

Classify material escapes without treating every defect as implementer failure:

| Category | Evidence to record | Response owner |
| --- | --- | --- |
| Design omission | Necessary behavior/ownership decision was absent or contradictory in the authorized contract | Main agent resolves the decision and updates the handoff |
| Implementation deviation | Delivered behavior violates an explicit accepted decision | Implementer repairs within authorized scope; main agent verifies |
| Test gap | A relevant behavior or fault combination escaped existing checks | Implementer adds a meaningful detector; main agent checks expectations and coverage |
| Reviewer oversight | Earlier review missed an existing relevant defect or overstated evidence | Main agent corrects the disposition and adjusts the bounded review method |

Categories can overlap; record uncertainty rather than inventing a cause. In the existing receipt/debrief, record baseline/delivery revisions, accepted outcomes, genuinely measured capabilities, escaped invariant families, self-review discoveries, corrected controls, coverage limits and authority needed next. Count elapsed effort/cost and courier cycles only when observed; test count and line count are not productivity measures. Do not infer a language/model cause from a sequence of repairs.

For a proposed process improvement, record the concrete failure, smallest change, next slice that tests it and evidence that would justify keeping it. Promote demonstrated lessons into focused tests, tooling or operating guidance; skill changes and broader automation need their own authorization.

If an explicit corrective handoff returns with the same acceptance boundary still unproved, reassess before sending another expanded prompt. Identify whether the missing piece is a decision, detector, fixture, environment or implementation. Supply the smallest executable proof when test authoring is authorized, narrow the assignment when necessary, or recommend a user-authorized change of execution owner. This grants no automatic takeover or delegation. Corrective handoffs state the changed finding, reproduction and exit condition, linking unchanged contracts instead of repeating the delivery history.

Evaluate this adjustment on the next comparable slice: did its first delivery cross the named production boundary, and did review uncover another escape in the same invariant family? Record observed courier cycles and effort when available; keep the change only if it improves acceptance quality or total delivery cost. Do not claim savings from shorter prompts or higher test counts alone.

## Documentation authority

This guide owns role allocation and escalation. `AGENTS.md` routes agents here. Keep executable scope/status in bd; current subsystem contracts in `docs/agent/`; implementation plans and revision-linked evidence in `docs/design/`. Record consequential architectural rationale in ADRs only under the [domain workflow's eligibility rules](domain.md). `CONTEXT.md` remains product vocabulary, not an agent-role glossary. Link to authorities rather than copying them into every prompt, and reconcile affected guides in the same delivery. This workflow agreement changes no software architecture or current implementation scope by itself.
