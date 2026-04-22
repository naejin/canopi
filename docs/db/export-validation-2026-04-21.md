# DB Export Validation — 2026-04-21 export

Source export: `../canopi-data/data/exports/canopi-export-2026-04-21.db`

Related upstream docs:
- `../canopi-data/data/exports/changelog.md`
- `../canopi-data/data/exports/climate-zone-rebuild-audit-2026-04-21.md`

Date: 2026-04-22
Branch: `fix/issues`

## Regeneration

Command:

```bash
python3 scripts/prepare-db.py --export-path ../canopi-data/data/exports/canopi-export-2026-04-21.db
```

Output artifact:
- `desktop/resources/canopi-core.db`
- Size: `655M` (`686,579,712` bytes)
- Local SHA256: `8dfdc182a049604714f8ce9b92db8023da573a57d183a1bbbb9090ea0fe27ade`

## Contract + integrity checks

Validated against `desktop/resources/canopi-core.db`.

- `PRAGMA user_version`: `8`
- Required tables present:
  - `species`
  - `translated_values`
  - `species_distributions`
  - `species_climate_zones`

Climate checks:
- `species_climate_zones` rows: `329,290`
- species with any climate zone: `160,319`
- distinct labels: `7`
- labels: `Arid`, `Boreal`, `Continental`, `Mediterranean`, `Subtropical`, `Temperate`, `Tropical`
- duplicate `(species_id, climate_zone)` rows: `0`
- orphan `species_id` rows: `0`

Representative species spot checks (`species.climate_zones`):
- `Malus domestica`: `["Continental", "Temperate", "Subtropical", "Arid", "Mediterranean"]`
- `Coffea arabica`: `["Tropical", "Subtropical"]`
- `Theobroma cacao`: `["Tropical"]`
- `Juglans regia`: `["Temperate", "Arid", "Mediterranean", "Continental", "Subtropical"]`
- `Mangifera indica`: `["Tropical", "Subtropical", "Arid"]`
- `Leucaena leucocephala`: `["Tropical", "Subtropical", "Arid"]`

Result: counts and spot checks match changelog expectations; no mismatch investigation required.

## App regression checks

- `CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace` ✅
- `cd desktop/web && npx tsc --noEmit` ✅
- `cd desktop/web && npm test` ✅ (`96` files, `495` tests)
- `cargo tauri dev` startup smoke ✅ (Vite + desktop process reached running state)

## DB release asset publication

Command:

```bash
scripts/publish-db-release.sh --export-path ../canopi-data/data/exports/canopi-export-2026-04-21.db
```

Published to:
- Repo/tag: `naejin/canopi@canopi-core-db`
- Release URL: <https://github.com/naejin/canopi/releases/tag/canopi-core-db>
- Asset: `canopi-core.db` (digest `sha256:f44fbb745d57d6285fe2785e23de3892c2852f2146e237422a039d94b8ec41cb`)
- Asset: `canopi-core.db.sha256` (digest `sha256:555a565b269e9151e9c895070a21fbdbe1eda7a3ba2d3bf44f8fd39243f90751`)

Notes:
- The published DB digest differs from the local regenerated file digest due to separate regeneration runs.
- Release-candidate/beta promotion steps remain separate release operations.