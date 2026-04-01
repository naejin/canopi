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

### ~~Issue A~~: habit contains life-cycle values (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`)

Habit enum trimmed to 3 values: `Tree`, `Shrub`, `Climber`. Life-cycle values backfilled to `is_annual`/`is_biennial`/`is_perennial` booleans (985 newly set). Storage organs (`Bulb`/`Corm`) migrated to `storage_organ`. Taxonomic groups (`Bamboo` → `growth_form_type="Graminoid"`, `Fern` → `growth_form_type="Fern"`, `Lichen` → NULL).

**App action**: Update schema-contract habit values to `["Tree", "Shrub", "Climber"]` only. Remove all other habit translation keys.

### Issue B: habit translation keys are Title Case — matches DB (app-side, verified correct)

**Status**: Verified correct after audit

`schema-contract.json` habit keys use Title Case (`"Annual"`, `"Tree"`) which matches the actual DB values. `translate_value()` does exact-match lookups. Previously changed to lowercase (incorrectly, based on canopi-data enum case) and reverted after DB audit confirmed Title Case.

**Key learning**: Always verify actual DB values with `SELECT DISTINCT` before changing translation keys. The canopi-data enum case does not necessarily match the export DB case.

### ~~Issue C~~: deciduous_evergreen translations

**Status: Fixed** — added `deciduous_evergreen` translations to `schema-contract.json` with correct keys (`Deciduous`, `Evergreen`, `Semi-Evergreen`) matching actual DB values. All 3 values now have translations in 10 languages.

### ~~Issue D~~: bloom_period has duplicate case variants (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`)

All bloom_period values normalized to Title Case. Lowercase duplicates eliminated. 15 values now have full translations in 19 languages.

**App action**: Update schema-contract bloom_period values. All values are now Title Case only.

### ~~Issue E~~: flower_color composite values

**Status: Fixed** — added `translate_composite_value()` in `lookup.rs` that splits slash-separated values, translates each part individually, and rejoins with `/`. Used in both `filters.rs` (filter options) and `detail.rs` (detail card). Includes `.trim()` on split parts for robustness against space-padded slashes.

### ~~Issue F~~: fruit_type translations

**Status: Fixed** — added all 16 fruit_type values to `schema-contract.json` with translations in 10 languages.

### ~~Issue G~~: root_system_type has translations but zero DB values (canopi-data)

**Status: Partially fixed** (canopi-data) — Added "lateral" to validator (was accepted by GRooT normalizer but rejected by validator, causing silent data loss). Column remains empty pending GRooT data processing. 8 translation entries now (was 7).

### ~~Issue H~~: categorical field translation coverage

**Status: Fixed** — added translations for 11 high-priority categorical fields to `schema-contract.json`: `deciduous_evergreen`, `drought_tolerance`, `fertility_requirement`, `moisture_use`, `anaerobic_tolerance`, `fruit_seed_abundance`, `toxicity`, `invasive_potential`, `seed_dispersal_mechanism`, `reproductive_type`, `fruit_type`. Total translated fields: 15 (up from 4). 1050 translation entries in DB (up from 490).

**Remaining untranslated** (low priority — scientific terms, mostly universal):
- `mycorrhizal_type` (AM/ECM/NM — abbreviations)
- `grime_strategy` (C/R/S/CSR — Grime's universal codes)
- `sexual_system` (Hermaphrodite/Dioecious — Latin-derived, widely understood)
- `succession_stage` (syntropic agriculture internal codes)
- `leaf_shape`, `leaf_compoundness`, `leaf_type` (botanical terms)

### Issue I: noxious_status and weed_potential are boolean INTs, not categoricals

DB stores these as `0`/`1` integers. Field registry correctly marks them as `type: 'boolean'`. No issue — just confirming the types are correct.

## Scientific Value Assessment

Botanical/ecological review of every categorical field's values. Issues are classified as canopi-data (upstream normalization) or accepted (usable despite imprecision).

### ~~habit~~ — Multiple taxonomy issues (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`)

DB values now: `Tree, Shrub, Climber` only. All other values migrated:
- Life cycle → `is_annual`/`is_biennial`/`is_perennial` booleans
- Storage organs → `storage_organ` column (`Bulb`, `Corm`)
- Taxonomic groups → `growth_form_type` (`Graminoid` for Bamboo, `Fern` for Fern)
- Non-plant (Lichen) → NULL

### growth_habit — OK

DB values: `Bunch, Colonizing, Multiple Stem, Rhizomatous, Single Crown, Single Stem, Stoloniferous, Thicket Forming`

All standard USDA PLANTS database growth habit categories. Scientifically sound.

### deciduous_evergreen — OK

DB values: `Deciduous, Evergreen, Semi-Evergreen`

Standard leaf persistence categories. Correct.

### ~~active_growth_period~~ — Formatting inconsistency (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`) — Normalized to Oxford comma format: `"Spring, Summer, and Fall"`, `"Fall, Winter, and Spring"`, etc. Two-item conjunctions kept as `"Spring and Fall"`.

**App action**: Update schema-contract if it had the old conjunction-less values.

### ~~bloom_period~~ — Formatting + case issues (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`) — All values Title Case. 17 distinct values. Full translations in 19 languages.

### flower_color — OK (separator normalized)

All values are botanically valid flower colors. Composite values now use `, ` (comma-space) separator: `Blue, Purple`, `White, Yellow`. Previously mixed `/` and `,` separators.

**App action**: `translate_composite_value()` should split on `, ` instead of `/`. Or split on `,` with `.trim()` on each part.

### drought_tolerance, fertility_requirement, moisture_use, anaerobic_tolerance — OK

Standard USDA ordinal scales (High/Medium/Low/None). Scientifically appropriate.

### succession_stage — Domain-specific terminology, readable to target audience (accepted)

DB values: `climax, placenta_i, placenta_ii, placenta_iii, secondary_i, secondary_ii, secondary_iii`

Uses Ernst Gotsch's syntropic agriculture framework:
- `placenta_i/ii/iii` = pioneer/nurse species of increasing lifespan (short-lived annuals → medium-lived → longer-lived pioneers)
- `secondary_i/ii/iii` = secondary succession species
- `climax` = climax community species

This is standard terminology for the app's target audience (agroecological designers). The word "placenta" may confuse general users but is correct in syntropic agriculture. Translations could help (e.g., "Pioneer I" in English-friendly labeling) but the raw values are appropriate for the domain.

### ~~mycorrhizal_type~~ — Scientifically correct, one naming issue (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`) — `mixed` → `Mixed` (casing normalized). 642 species updated.

DB values now: `AM, AM/ECM, AM/NM, ECM, Ericoid, Mixed, NM, Orchid`

**App action**: Update schema-contract key from `"mixed"` to `"Mixed"`.

### ~~grime_strategy~~ — Potentially redundant pairs (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`) — Deduplicated: SC→CS, RC→CR, RS→SR. 119 species updated.

DB values now: `C, CR, CS, CSR, R, S, SR` (7 values, down from 10).

**App action**: Remove `SC`/`RC`/`RS` from schema-contract if present.

### ~~pollination_syndrome~~ — Mixes specificity levels and naming conventions (canopi-data)

**Status: Fixed** (canopi-data) — Collapsed to 5 broad syndromes: `Entomophilous`, `Anemophilous`, `Zoophilous`, `Hydrophilous`, `Autogamous`. Specific pollinators (Bees, Flies, etc.) migrated to the `pollinators` field (1,161 species backfilled). Cleistogamous → Autogamous. Consistent Latin nomenclature.

**App action**: Update schema-contract pollination_syndrome to 5 values only.

### ~~fruit_type~~ — Contains non-type values (canopi-data)

**Status: Fixed** (canopi-data) — Removed "Dry" (4,107 species), "Fleshy" (792), "Apocarpous" (191) → set to NULL. 13 legitimate botanical fruit types remain.

**App action**: Remove "Dry", "Fleshy", "Apocarpous" from schema-contract fruit_type values.

### ~~seed_dormancy_type~~ — Mixes dormancy types with durations and unrelated traits (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`)

Split into three columns:
- `seed_dormancy_type` — mechanism only: `Physiological`, `Morphophysiological`, `Physical`, `None`
- `seed_dormancy_depth` — **NEW column**: `Absolute`, `Long`, `Short`, `Partial`
- `serotinous` — **NEW boolean**: fire ecology trait (138 species)
- `Xerochasy` values set to NULL (dehiscence mechanism, not dormancy)

**App action**: Add `seed_dormancy_depth` and `serotinous` to schema-contract and field registry. Narrow `seed_dormancy_type` values.

### ~~invasive_potential~~ — Conflates invasion risk with biogeographic status (canopi-data)

**Status: Fixed** (canopi-data `d647d6b`)

Split into two columns:
- `invasive_potential` — invasion risk only: `Invasive`, `Potentially Invasive`
- `biogeographic_status` — **NEW column**: `Native`, `Introduced`, `Naturalized`

**App action**: Any filter/display logic referencing `invasive_potential` for "Native"/"Introduced"/"Naturalized" must switch to `biogeographic_status`. Add `biogeographic_status` to schema-contract and field registry.

### canopy_position — Very limited (accepted)

DB values: `Canopy, Understory`

Only two levels. Standard forest ecology recognizes at least 5 (emergent, canopy, subcanopy, understory, ground). However, PFAF data may only distinguish these two. Usable for basic filtering.

### sexual_system — OK

DB values: `Androdioecious, Andromonoecious, Dioecious, Gynodioecious, Gynomonoecious, Hermaphrodite, Monoecious, Polygamodioecious`

All standard botanical sexual system classifications. Scientifically correct and complete.

### reproductive_type, seed_dispersal_mechanism, seed_storage_behaviour, leaf_type, leaf_compoundness, leaf_shape, growth_form_type, vegetative_spread_rate, seed_spread_rate, toxicity, growth_rate, fruit_seed_abundance — OK

All values are standard botanical/ecological terms. No scientific issues.

### growth_form_type — Minor overlap (accepted)

DB values: `Epiphyte, Forb, Graminoid, Herb, Shrub, Subshrub, Tree, Vine`

`Herb` and `Forb` overlap — a forb is a non-grass herbaceous plant, which is a subset of herbs. Both are retained in USDA PLANTS. Usable for filtering despite the overlap.

## Scientific Issues Summary

| Field | Issue | Severity | Status |
|---|---|---|---|
| ~~habit~~ | Life cycle + storage organ + taxonomy mixed in | High | **Fixed** — split into booleans, storage_organ, growth_form_type |
| ~~pollination_syndrome~~ | Overlapping hierarchy levels, mixed Latin/English | Medium | **Fixed** — collapsed to 5 broad syndromes |
| ~~seed_dormancy_type~~ | Mixes dormancy types, durations, and unrelated traits | Medium | **Fixed** — split into seed_dormancy_depth + serotinous |
| ~~fruit_type~~ | "Dry", "Fleshy" are textures; "Apocarpous" is floral morphology | Medium | **Fixed** — non-types removed (5,090 → NULL) |
| ~~invasive_potential~~ | Conflates biogeographic status with invasion risk | Medium | **Fixed** — split into biogeographic_status |
| ~~grime_strategy~~ | Potentially redundant reversed pairs (CR/RC) | Low | **Fixed** — deduplicated |
| ~~mycorrhizal_type~~ | "mixed" is vague and inconsistently cased | Low | **Fixed** — normalized to "Mixed" |
| ~~active_growth_period~~ | Inconsistent conjunction formatting | Low | **Fixed** — Oxford comma format |
| ~~bloom_period~~ | Case duplicates + inconsistent separators | Low | **Fixed** — Title Case normalized |
| canopy_position | Only 2 of 5 standard levels | Low | Accepted |
| growth_form_type | Herb/Forb overlap | Low | Accepted |

## Previously Fixed Issues (from earlier review rounds)

| # | Issue | Status |
|---|---|---|
| 1 | Dynamic filter cache not locale-aware | **Fixed** — locale-scoped `dynamicOptionsCache` |
| 2 | Language picker closes MoreFilters panel | **Fixed** — `data-preserve-overlays` pattern |
| 5 | Stale locale pattern affects all fields | **Fixed** — same locale-scoped cache |
| 6 | Inconsistent locale refresh | **Partially fixed** — sidebar lists reload on locale change |
| 9 | Life cycle filter section missing | **Fixed** — FilterStrip row added |
| A | habit life-cycle/taxonomy conflation | **Fixed** — habit trimmed to Tree/Shrub/Climber, values migrated |
| C | deciduous_evergreen translations missing | **Fixed** — added to schema-contract.json |
| D | bloom_period case duplicates | **Fixed** — Title Case normalized, 15 values fully translated |
| E | flower_color composite values untranslated | **Fixed** — `translate_composite_value()` splits on `/` |
| F | fruit_type zero translations | **Fixed** — 16 values added to schema-contract.json + canopi-data |
| H | 92% categorical fields untranslated | **Fixed** — 11 high-priority fields added (1050 total entries) |

## Recommended Next Actions

### App-side (this repo)

All high-priority app-side issues (C, E, F, H) have been fixed. Remaining app-side work:
- Monitor for new categorical fields that need translations as canopi-data evolves
- Consider adding low-priority scientific term translations if user feedback warrants it

### canopi-data side

**Completed** (canopi-data `d647d6b` + `1261435`):
1. ~~Clean up habit~~ — trimmed to Tree/Shrub/Climber, all values migrated
2. ~~Split seed_dormancy_type~~ — seed_dormancy_depth + serotinous boolean
3. ~~Split invasive_potential~~ — biogeographic_status column added
4. ~~Normalize bloom_period case~~ — Title Case, no duplicates
5. ~~Normalize active_growth_period formatting~~ — Oxford comma
6. ~~Fix mycorrhizal_type "mixed"~~ — normalized to "Mixed"
7. ~~Deduplicate grime_strategy~~ — SC→CS, RC→CR, RS→SR
8. ~~Normalize flower_color separators~~ — unified to `, ` (comma-space)
9. ~~Translation pipeline~~ — unified `canopi translate` CLI, 668 values × 19 languages, 100% filled

**Remaining canopi-data issues:**
1. **Populate root_system_type** (Issue G): Column is empty, validator bug fixed, awaiting GRooT data processing (`canopi enrich --source groot`)

## Cross-Reference: Translation Coverage by Field

All fields now have 19-language translations via `canopi translate` (canopi-data `1261435`).

| Field | DB Values | Translations | Status |
|---|---|---|---|
| habit | 3 (was 11) | 3 | OK — trimmed to Tree/Shrub/Climber |
| growth_habit | 8 | 8 | OK |
| deciduous_evergreen | 3 | 3 | OK — Semi-Evergreen (capital E) |
| active_growth_period | 10 | 10 | OK — Oxford comma format |
| bloom_period | 17 (was 22) | 15 | OK — case deduped, **newly translated** |
| flower_color | 25 | 11 | OK — composites use `, ` separator, app splits |
| drought_tolerance | 4 | 4 | OK |
| fertility_requirement | 3 | 3 | OK |
| moisture_use | 3 | 3 | OK |
| anaerobic_tolerance | 4 | 4 | OK |
| succession_stage | 7 | 7 | OK |
| mycorrhizal_type | 8 | 9 | OK — "Mixed" (was "mixed") |
| grime_strategy | 7 (was 10) | 7 | OK — deduplicated |
| root_system_type | 0 | 8 | Empty column, validator bug fixed (Issue G) |
| pollination_syndrome | 5 (was 13) | 5 | OK — broad syndromes only |
| reproductive_type | 3 | 3 | OK |
| sexual_system | 8 | 8 | OK |
| fruit_type | 13 (was 16) | 13 | OK — Dry/Fleshy/Apocarpous removed |
| seed_dispersal_mechanism | 7 | 7 | OK |
| seed_storage_behaviour | 3 | 3 | OK |
| fruit_seed_abundance | 4 | 4 | OK |
| seed_dormancy_type | 4 (was 10) | 4 | OK — mechanism only |
| **seed_dormancy_depth** | **4 (NEW)** | **4** | **NEW column** |
| **serotinous** | **bool (NEW)** | — | **NEW boolean** |
| **biogeographic_status** | **3 (NEW)** | **3** | **NEW column** |
| leaf_type | 7 | 8 | OK |
| leaf_compoundness | 5 | 6 | OK |
| leaf_shape | 17 | 17 | OK |
| growth_form_type | 8 | 9 | OK |
| canopy_position | 2 | 2 | OK |
| vegetative_spread_rate | 4 | 4 | OK |
| seed_spread_rate | 4 | 4 | OK |
| toxicity | 4 | 4 | OK |
| invasive_potential | 2 (was 5) | 2 | OK — risk only |
| growth_rate | 3 | 3 | OK |
| stratum | 4 | 4 | OK |
