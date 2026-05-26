**Describe the bug**
The `attempt_completion` tool fails with a `400` error stating `thinking is enabled but reasoning_content is missing in assistant tool call message at index 2`. This occurs when an agent completes a task and tries to submit the result via `attempt_completion`. The error is reproducible across multiple retry attempts and appears to be a platform-level issue rather than a user-code issue. The underlying task work (file changes, commits) succeeds, but the final handoff via `attempt_completion` is blocked.

**To Reproduce**
Steps to reproduce the behavior:
1. Complete a task that requires file edits and a final `attempt_completion` call
2. Call `attempt_completion` with a valid `result` string
3. Observe the tool returns `Verification Subagent Failed: 400 thinking is enabled but reasoning_content is missing in assistant tool call message at index 2`
4. Retry the same `attempt_completion` call — the error persists

**Expected behavior**
`attempt_completion` should accept the result and complete the task handoff successfully, or provide a meaningful error related to the task content rather than an internal platform `thinking`/`reasoning_content` mismatch.

**Screenshots**
N/A — error is returned as a tool result message.

**Surface and Version:**
- IDE: VSCode with Dirac extension
- Dirac extension version: 0.3.29
- LLM API provider: Anthropic (Claude) — indicated by `@anthropic-ai/sdk` dependency and the `thinking` feature referenced in the error message
- Model: Likely Claude 3.7 Sonnet or Claude 4 (models that support the `thinking`/`reasoning` feature)

**Additional context**
- The error appears to originate from a verification subagent that inspects the assistant's tool call message.
- The `thinking is enabled` part suggests the subagent expects a `reasoning_content` field in the assistant message when that mode is active, but the field is absent.
- The error index (`at index 2`) may refer to the third message in the conversation context passed to the verification subagent.
- This blocks task completion even though all actual work (file writes, git commits) was completed successfully.
