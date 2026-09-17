# Delivery and integration

Use this guide when finishing a bead, integrating accepted work, or removing branches. Repository authorization and user-work preservation rules remain in [AGENTS.md](../../AGENTS.md).

| State | Evidence |
| --- | --- |
| Implemented | The requested behavior exists in named commits. |
| Verified | Required checks passed on the delivered tree; limitations are recorded. |
| Integrated | Those commits are ancestors of the intended integration branch, normally `main`. |
| Released | A separately authorized public release has actually been published. |

Closing a verified implementation bead does not establish integration or release. Record the commit/branch and any pending integration explicitly in its receipt. Plans marked completed describe implementation completion; they must not imply a published release.

Before closing, update current subsystem guides, mark completed design records, and retire launch prompts. Retain measurements and explicit scope decisions, including deferred optimization. Do not turn every diagnostic performance miss into new optimization work: the current product decision defers optimization until actual user reports warrant it. Integrity, cancellation, and bounded-resource requirements still apply.

Before integration, fetch the intended remote, inspect the dirty worktree and any other worktrees, verify all accepted branch tips are retained, and run checks appropriate to the integrated changes. Prefer a fast-forward when the entire accepted stack descends from `main`. If histories diverge, preserve accepted merges and reconcile deliberately. Do not stash or overwrite unrelated work implicitly.

After an authorized integration, verify the remote integration tip before deleting branches. Delete only explicitly inventoried topic branches whose exact tips are ancestors of the integrated commit; recheck both GitHub and Codeberg. Preserve infrastructure refs such as `__dolt_remote_info__`. Use ordinary local merged-branch deletion; detach an inactive worktree only after checking its status, preserving its files. A remote branch that changed since inspection must be reviewed again.

Finish with a status/ancestry receipt and any preserved user files. Branch deletion removes names, not commits retained by `main`; those names can be recreated from the recorded commits.
