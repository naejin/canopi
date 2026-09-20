# Isolated Desktop qualification host

Review status at `f9b5c10c`: partial, not accepted. The documented lifecycle/exit rules below are intended contracts; independent review found remaining cancellation, process/output-limit and final-result violations. See the [disposition](../../../docs/design/raster-rework/q-typescript-review.md#instrument-completion-independent-disposition) and the user-forwarded [completion assignment](../../../docs/design/raster-rework/q-desktop-lifecycle-agent-prompt.md). Do not infer safe completion from a green pilot result alone.

A measurement instrument, not a product surface. This directory is its own Cargo
workspace and is deliberately outside the production workspace: it does not register a
Tauri command, change a Desktop manifest or touch application data.

It exists to observe the transport the plan proposes — a bundled Desktop WebView starts a
bundled worker, and the worker decodes numeric windows from bounded reads taken through
opaque native handles. Its first results and their limits are recorded in the
[Q receipt](../../../docs/design/raster-rework/q-typescript-receipt.md).

## What each part owns

| Path | Owns |
| --- | --- |
| `src/bridge.rs` | Fixture admission (canonical path, hash, retained descriptor), run-scoped opaque handles, the bounded read seam with structured refusals, and the native read ledger. Plain Rust, so it is tested without a window or an engine |
| `src/main.rs` | The Tauri host: launcher-supplied run spec, `pilot_input`/`admit_fixtures`/`read`/`close`/`finish`, embedded-asset verification, and raw evidence. It writes no report and accepts no path from the renderer |
| `web/src/main.ts` | Relays native reads to the worker and transfers buffers back. It does not decode rasters |
| `web/src/worker.ts` | Plans reads from the COG header, asks for exactly those intervals, decodes them with the candidate, and keeps its own counters separate from the host ledger |
| `tools/makePilotFixture.mjs` | The generated pilot fixture: a 2048×2048 Float32 plane `z(column,row)=column-row` with two nodata holes, prepared to an uncompressed tiled COG by GDAL |
| `tools/runPilot.mjs` | The single reproducible command: build, bundle, launch, compare and evaluate |

`desktop/src/native_operation.rs` is reused **by path** so the harness has one blocking
policy rather than a second one. That production module is not modified here.

## Running it

```bash
# From this directory. The run directory must not exist; the launcher creates it and
# refuses to reuse, clean or overwrite one. Writes everything under .qrun/, ignored.
node tools/runPilot.mjs --run-dir .qrun/pilot
```

The command is a bootstrap: it compiles the current producer and evaluator TypeScript into a fresh build directory
and runs that exact output, so an absent `ts/dist` is irrelevant and a stale one can never be measured. Its exit
code is the pilot's own, not the evaluator's whole-Q result:

| Exit | Meaning |
| --- | --- |
| 0 | The bounded pilot completed, a current-run decision was published and cites this run's reports, Q-LOCAL-1 and Q-HOST-1 pass, and no requirement fails. Other requirements may stay inconclusive |
| 1 | A pilot measurement or required check failed, or required positive evidence is incomplete |
| 2 | Instrument failure: build, input, host launch, timeout, cancellation, malformed evidence, publication or evaluator |

The launcher needs the bench engine assets at `.rq-scratch/bench` (override with
`--bench <dir>`) and a local display. It performs, in order: TypeScript typecheck of the
frontend, frontend bundle build, engine-asset copy into the bundle, hashing of every
bundled file, `cargo build --offline`, fixture generation when absent, launch under a
network namespace, window comparison against the analytic expectation, report writing,
and the real evaluator over those reports with the `desktop-local` profile.

Useful flags: `--bench <dir>`, `--no-network-deny` (records the denial as not exercised),
`QUAL_HOST_VISIBLE=1` to show the window.

### Ownership and lifecycle invariants

* One owned run root, created exclusively; an existing directory of any shape is refused untouched.
* Every artifact is staged and hard-linked into place: complete or absent, never partial, never replacing.
* `host-evidence.json` is published by the host itself, atomically and once; `finish` is single-shot and every
  command validates the caller's run nonce.
* Read requests reserve their identity before any work is queued (two running, 32 waiting, excess refused), and the
  read itself is positional through the reservation's own descriptor with no state lock held.
* Read labels are host-owned: a renderer request is always a candidate read.
* Teardown revokes handles, refuses new work, cancels unstarted reservations and drops descriptors only once
  nothing is outstanding; fixture identity survives for the evidence.

### Three properties that are easy to get wrong

* **The bundle is embedded at compile time.** `tauri::generate_context!` bakes
  `web/dist` into the binary, so a frontend edit without a `cargo build` measures the
  previous bundle. The launcher always builds, and the host re-hashes every embedded file
  against the launcher's declaration, so a stale bundle fails the run instead of being
  measured.
* **The run spec crosses the bridge in snake_case.** Tauri does not rename command
  return values; the WebView reads the authored key names (`asset_base`, `header_bytes`)
  and the worker message is the only place with camelCase names.
* **A network namespace also isolates the X11 abstract socket.** Network denial via
  `unshare -rn` therefore needs the local pathname-socket relay the launcher starts; the
  relay is local-only and uses no network transport.

## Evidence produced per run

| File | Content |
| --- | --- |
| `host-evidence.json` | The host's raw record: native ledger, admitted fixture identities, embedded-asset checks, revoked handles, WebView origin, and the worker's returned result |
| `native-ledger.json` | The native read ledger on its own, including refusal outcomes |
| `reports/q2-numeric.json`, `reports/host.json` | The producer reports the evaluator reads |
| `fixture-manifest.json` | The declared fixture set for this run, hashes included |
| `decision.json` | The real evaluator's decision, with `--profile desktop-local` |
| `pilot-result.json` | The launcher's own summary: window comparisons, ledger reconciliation, refusal controls, asset checks, network denial, and the decision path |
| `host.log` | The host's stdout/stderr, so a failed run is diagnosable |

Nothing here is committed: the run directory is scratch. `cargo fmt --check`,
`cargo clippy --offline --all-targets -- -D warnings` and `cargo test --offline` in this
directory are the harness's own gates; `rustfmt` on this crate only, because the reused
production file has a pre-existing formatting difference under this toolchain.
