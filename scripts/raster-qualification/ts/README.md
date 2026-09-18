# Qualification decision path (TypeScript)

This directory owns the raster qualification **decision path**: raw report and declaration bytes
through runtime parsing and admission, assertion evidence, requirement verdict and CLI exit.

It replaces no experiment. The `.mjs` probes, Python experiment commands, native reference
measurements and bootstrap/server helpers remain legacy producers; this code consumes their output
and decides eligibility from it.

## Layout

| Path | Role |
| --- | --- |
| `src/json.ts` | Duplicate-key-rejecting, non-finite-rejecting JSON parser. External bytes are unknown data. |
| `src/fields.ts` | Strict leaf readers. A TypeScript annotation is not runtime validation. |
| `src/sources.ts` | Reads each source once, hashes those exact bytes, retains absence versus corruption. |
| `src/declaration.ts` | Validates the requirement contract, fixture manifest and candidate pins before use. |
| `src/admit.ts` | One report's admission, with the single failure/gap reduction. |
| `src/evidence/*.ts` | Per-requirement mappings from producer observations to assertion evidence. |
| `src/decide.ts` | The one authoritative operation: declared expectations + raw sources -> decision. |
| `src/cli.ts` | Emitted Node CLI. Thin wrapper over `decide`. |

## Build and test

Emitted files go to `dist/`, which is disposable and ignored. Only source and configuration are
committed.

```sh
desktop/web/node_modules/.bin/tsc -p scripts/raster-qualification/ts/tsconfig.json
node --test "scripts/raster-qualification/ts/dist/tests/*.test.js"
```

No dependency is declared here: the compiler and Node type definitions are the ones already
installed for `desktop/web`, addressed through `typeRoots`.
