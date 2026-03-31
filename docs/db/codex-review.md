# Codex Review: Plant DB Filter Audit

## Summary

Comprehensive audit of every filter in the plant DB panel — FilterStrip (always-visible) and MoreFiltersPanel (dynamic fields). Covers scientific meaningfulness of values, translation coverage, readability, and case correctness.

## FilterStrip Filters (always visible)

### Stratum — OK
- Values: `emergent`, `high`, `low`, `medium` (DB-queried, lowercase)
- Translations: `translated_values` has entries, i18n keys `filters.stratum_${value}` in all 11 locales
- No issues

### Sun Tolerance — OK
- Values: `full_sun`, `semi_shade`, `full_shade` (hardcoded, mapped to boolean columns)
- i18n keys: `plantDb.sunTolerance_${value}` (note: `plantDb` namespace, not `filters` — inconsistent but functional)
- No issues

### Life Cycle — OK (newly added)
- Values: `Annual`, `Biennial`, `Perennial` (hardcoded in Rust, mapped to `is_annual`/`is_biennial`/`is_perennial` booleans)
- i18n keys: `filters.lifecycle` (label) + `filters.lifeCycle_${value}` (chips) in all 11 locales
- No issues

### Hardiness — OK
- Range: DB-queried `MIN(hardiness_zone_min)` to `MAX(hardiness_zone_max)`, defaults [1, 13]
- No issues

### Edibility — OK
- Range: hardcoded 0–5 threshold slider
- No issues

### Height — OK
- Range: hardcoded 0–50m, step 0.5
- Label format: `${v} m` (not i18n'd, but meters are universal)
- No issues

### Nitrogen Fixer — OK
- Boolean toggle, maps to `nitrogen_fixer = 1`
- No issues

### Not rendered in FilterStrip
- **Growth rate**: available in `FilterOptions.growth_rates` and `ActiveChips`, but no FilterStrip row. Rendered only in MoreFiltersPanel
- **Soil tolerances**: available in `FilterOptions.soil_tolerances`, rendered only in MoreFiltersPanel

## MoreFilters Dynamic Fields — Issues Found

### Issue A: habit contains life-cycle values (canopi-data)

**Status**: Documented, awaiting upstream fix

DB `habit` column contains `Annual`, `Biennial`, `Perennial` alongside growth-form values (`Tree`, `Shrub`, `Climber`, etc.). These are life-cycle classifications, not growth forms. The canopi-data `Habit` StrEnum defines these as lowercase (`"annual"`, `"tree"`), but the export produces Title Case (`"Annual"`, `"Tree"`). The app's boolean columns `is_annual`/`is_biennial`/`is_perennial` already capture life cycle correctly.

**Root cause**: canopi-data `Habit` enum conflates PFAF's mixed habit/life-cycle field. The export pipeline title-cases the enum values before writing to the export DB.

**Fix**: canopi-data — remove `annual`, `biennial`, `perennial` from `Habit` enum; assign real growth forms to affected species (usually `herb` or null). Also normalize the export to match the enum case consistently.

### Issue B: habit translation keys are Title Case — matches DB (app-side, verified correct)

**Status**: Verified correct after audit

`schema-contract.json` habit keys use Title Case (`"Annual"`, `"Tree"`) which matches the actual DB values. `translate_value()` does exact-match lookups. Previously changed to lowercase (incorrectly, based on canopi-data enum case) and reverted after DB audit confirmed Title Case.

**Key learning**: Always verify actual DB values with `SELECT DISTINCT` before changing translation keys. The canopi-data enum case does not necessarily match the export DB case.

### Issue C: deciduous_evergreen has a case mismatch for one value (canopi-data)

DB has `Semi-Evergreen` (capital E). `translated_values` has `Semi-evergreen` (lowercase e). `translate_value()` exact match fails for this one value — it falls back to raw English.

**Root cause**: canopi-data export has `"Semi-Evergreen"` but the schema-contract key is `"Semi-evergreen"`.

**Fix**: Either fix in schema-contract.json (change key to `"Semi-Evergreen"`) or fix in canopi-data (normalize to `"Semi-evergreen"`). Schema-contract fix is simpler and immediate.

### Issue D: bloom_period has duplicate case variants (canopi-data)

DB has 22 distinct values but 5 appear in both Title Case and lowercase: `Early Spring`/`early spring`, `Early Summer`/`early summer`, `Indeterminate`/`indeterminate`, `Late Spring`/`late spring`, `Late Summer`/`late summer`. Only the Title Case versions have translations (17 entries). The lowercase duplicates are untranslated.

**Root cause**: canopi-data normalization is inconsistent — some bloom period values are title-cased, others pass through as lowercase.

**Fix**: canopi-data — normalize all `bloom_period` values to consistent Title Case during export.

### Issue E: flower_color has composite values without translations (canopi-data + app)

DB has 25 distinct values. 11 are single colors with translations. 14 are composites like `Blue/Purple`, `White/Yellow/Purple` with no translations.

**Root cause**: canopi-data exports multi-value colors as slash-separated strings. The schema-contract only defines translations for individual colors.

**Fix (two options)**:
1. **canopi-data**: Split composite values into a normalized form, or store as a separate `species_flower_colors` table
2. **App-side workaround**: `translate_value()` could split on `/`, translate each part, and rejoin. This is a display-layer fix, not ideal

### Issue F: fruit_type has zero translations (app-side)

16 distinct values (`Berry`, `Capsule`, `Drupe`, `Legume`, `Nut`, `Pome`, etc.) — all scientifically meaningful. Zero entries in `translated_values`.

**Root cause**: `fruit_type` was never added to `schema-contract.json` translations section.

**Fix**: app-side — add `fruit_type` translations to `schema-contract.json` for all 16 values across 11 locales, then regenerate DB.

### Issue G: root_system_type has translations but zero DB values (canopi-data)

7 translation entries exist (`adventitious`, `bulbous`, `fibrous`, `rhizomatous`, `stoloniferous`, `tap`, `tuberous`) but the species table has no non-null `root_system_type` values.

**Root cause**: canopi-data does not populate this column from any source.

**Fix**: canopi-data — either populate from PFAF/TRY data sources or remove the column from the schema contract.

### Issue H: 92% of categorical fields have no translations

Only 4 of 48 categorical fields have translation entries: `habit`, `bloom_period`, `flower_color`, `active_growth_period`. The remaining 44 fields display raw English values in all locales.

**Classification**: Accepted limitation. `translate_value()` falls back to `value_en` gracefully. Most values are scientific terms (e.g., `Hermaphrodite`, `AM/ECM`, `CSR`) that are universal or untranslatable. Priority fields for future translation:

**High priority** (user-facing, non-scientific terms):
- `fruit_type` (Issue F above)
- `drought_tolerance` (High/Low/Medium/None)
- `fertility_requirement` (High/Low/Medium)
- `moisture_use` (High/Low/Medium)
- `anaerobic_tolerance` (High/Low/Medium/None)
- `fruit_seed_abundance` (High/Low/Medium/None)
- `toxicity` (Moderate/None/Severe/Slight)
- `invasive_potential` (Introduced/Invasive/Native/Naturalized/Potentially Invasive)
- `seed_dispersal_mechanism` (Animal/Ant/Ballistic/Gravity/Self/Water/Wind)
- `reproductive_type` (Seed/Seed and Vegetative/Vegetative)

**Low priority** (scientific terms, mostly universal):
- `mycorrhizal_type` (AM/ECM/NM — abbreviations)
- `grime_strategy` (C/R/S/CSR — Grime's universal codes)
- `sexual_system` (Hermaphrodite/Dioecious — Latin-derived, widely understood)
- `succession_stage` (already uses internal codes like `placenta_i`)
- `leaf_shape`, `leaf_compoundness`, `leaf_type` (botanical terms)

### Issue I: noxious_status and weed_potential are boolean INTs, not categoricals

DB stores these as `0`/`1` integers. Field registry correctly marks them as `type: 'boolean'`. No issue — just confirming the types are correct.

## Previously Fixed Issues (from earlier review rounds)

| # | Issue | Status |
|---|---|---|
| 1 | Dynamic filter cache not locale-aware | **Fixed** — locale-scoped `dynamicOptionsCache` |
| 2 | Language picker closes MoreFilters panel | **Fixed** — `data-preserve-overlays` pattern |
| 5 | Stale locale pattern affects all fields | **Fixed** — same locale-scoped cache |
| 6 | Inconsistent locale refresh | **Partially fixed** — sidebar lists reload on locale change |
| 9 | Life cycle filter section missing | **Fixed** — FilterStrip row added |

## Recommended Next Actions

### App-side (this repo)

1. **Fix deciduous_evergreen case** (Issue C): change `schema-contract.json` key from `"Semi-evergreen"` to `"Semi-Evergreen"`, regenerate DB
2. **Add fruit_type translations** (Issue F): add 16 entries to `schema-contract.json`, regenerate DB
3. **Add high-priority categorical translations** (Issue H): add entries for the 10 fields listed above
4. **Consider flower_color split** (Issue E): display-layer split of composite values before translation

### canopi-data side

1. **Remove life-cycle values from Habit enum** (Issue A): `annual`, `biennial`, `perennial` are not growth forms
2. **Normalize bloom_period case** (Issue D): deduplicate the 5 Title Case / lowercase pairs
3. **Normalize export case** (Issue A/B): ensure export values match enum case consistently
4. **Populate or remove root_system_type** (Issue G): column is empty
5. **Split flower_color composites** (Issue E): normalize multi-value entries

## Cross-Reference: Translation Coverage by Field

| Field | DB Values | Translations | Match Status |
|---|---|---|---|
| habit | 11 (Title Case) | 11 | OK |
| growth_habit | 8 | 8 | OK |
| deciduous_evergreen | 3 | 3 | 1 case mismatch (Issue C) |
| active_growth_period | 10 | 10 | OK |
| bloom_period | 22 | 17 | 5 lowercase duplicates untranslated (Issue D) |
| flower_color | 25 | 11 | 14 composites missing (Issue E) |
| drought_tolerance | 4 | 4 | OK |
| fertility_requirement | 3 | 3 | OK |
| moisture_use | 3 | 3 | OK |
| anaerobic_tolerance | 4 | 4 | OK |
| succession_stage | 7 | 7 | OK |
| mycorrhizal_type | 8 | 9 | 1 extra translation |
| grime_strategy | 10 | 10 | OK |
| root_system_type | 0 | 7 | Empty column (Issue G) |
| pollination_syndrome | 13 | 14 | 1 extra translation |
| reproductive_type | 3 | 3 | OK |
| sexual_system | 8 | 8 | OK |
| fruit_type | 16 | 0 | No translations (Issue F) |
| seed_dispersal_mechanism | 7 | 7 | OK |
| seed_storage_behaviour | 3 | 3 | OK |
| fruit_seed_abundance | 4 | 4 | OK |
| seed_dormancy_type | 10 | 10 | OK |
| leaf_type | 7 | 8 | 1 extra translation |
| leaf_compoundness | 5 | 6 | 1 extra translation |
| leaf_shape | 17 | 17 | OK |
| growth_form_type | 8 | 9 | 1 extra translation |
| canopy_position | 2 | 2 | OK |
| vegetative_spread_rate | 4 | 4 | OK |
| seed_spread_rate | 4 | 4 | OK |
| toxicity | 4 | 4 | OK |
| invasive_potential | 5 | 5 | OK |
| growth_rate | 3 | 3 | OK |
| stratum | 4 | 4 | OK |
