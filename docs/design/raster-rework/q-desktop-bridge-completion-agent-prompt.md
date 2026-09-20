# Q Desktop bridge — bounded instrument completion (retired)

Status: retired — executed as DB1–DB4; delivery reported in the [migration receipt](q-typescript-receipt.md#desktop-bridge-instrument-completion-db1db4-implementation-response).
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [migration receipt](q-typescript-receipt.md), [standing review](q-typescript-review.md#db1db4-instrument-completion-implementer-not-acceptance), [host guide](../../../scripts/raster-qualification/desktop-host/README.md), [collaboration protocol](collaboration-protocol.md).

This assignment no longer authorizes work. Its durable design decisions — one owned run root, atomic no-replace
publication, host-owned read labels, reservation before queuing, single-shot finish, one worker terminal path, and
launcher exits independent of the evaluator's whole-Q code — are maintained in the
[host guide](../../../scripts/raster-qualification/desktop-host/README.md) and the receipt. A retired assignment is
not proof that its work is accepted. Delivery `f9b5c10c` was independently reviewed as partial;
see the [disposition](q-typescript-review.md#instrument-completion-independent-disposition).
The [lifecycle handoff](q-desktop-lifecycle-agent-prompt.md) supersedes this assignment when forwarded by the user. Q remains unqualified.
