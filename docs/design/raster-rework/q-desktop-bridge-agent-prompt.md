# Q Desktop bridge — first positive transport slice (retired)

Status: retired — executed and delivered at `fab0c381`; retained only as the assignment record.
Tracking: `canopi-kqpp`, parent `canopi-j571`.
Current guidance: [migration receipt](q-typescript-receipt.md#desktop-bridge-transport-slice-implementation-response), [standing review](q-typescript-review.md#desktop-bridge-transport-slice-at-fab0c381-implementer-not-acceptance), [collaboration protocol](collaboration-protocol.md), [LiDAR guide](../../agent/lidar.md).

The assignment is complete and its evidence is in the receipt. This prompt no longer
authorizes work, and the isolated harness it scoped now carries its own operating
instructions in [desktop-host/README.md](../../../scripts/raster-qualification/desktop-host/README.md).

What it asked for, and where the result is recorded:

| Assignment | Outcome |
| --- | --- |
| Isolated Tauri Desktop host with its own workspace, lock, config and bundled frontend | `scripts/raster-qualification/desktop-host/`; the production executor is reused by path and no production manifest changed |
| Opaque run-scoped handles, bounded reads, structured refusals, host-owned ledger | Implemented with 16 Rust tests, including refusal ordering, idempotent close, teardown revocation and capacity bounds |
| Bundled worker decoding numeric windows with the existing candidate | Five level-zero windows, 81 920 cells, no value or validity mismatch; four declared refusal controls refused with the declared codes |
| One small generated-fixture pilot on the local Desktop host, with network denial | Two repeatable runs, ~5 s each: Q-LOCAL-1 and Q-HOST-1 pass, ten requirements inconclusive, `synthetic: false` |
| Fixed `desktop-local` profile, host role, explicit launcher selection | Declared and threaded through role validation, expectations, directory paths and CLI parity; unknown and conflicting selections are refused |
| `import_map.py` replaced by TypeScript, callers migrated, helper deleted | `ts/src/importMap.ts` with byte-identical output and 8 tests; three callers migrated; Python helper deleted; the rest of the consumed Python is untouched |

Not delivered, and not authorized by this prompt: the pinned artifact and the managed
private fixtures, so Q remains unqualified and the published-engine/source-pin
correspondence failure is preserved rather than resolved. A qualification claim needs a
separately authorized slice; the receipt records the exact remaining obligations.
