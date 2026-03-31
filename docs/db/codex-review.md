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

### ~~Issue C~~: deciduous_evergreen translations

**Status: Fixed** — added `deciduous_evergreen` translations to `schema-contract.json` with correct keys (`Deciduous`, `Evergreen`, `Semi-Evergreen`) matching actual DB values. All 3 values now have translations in 10 languages.

### Issue D: bloom_period has duplicate case variants (canopi-data)

DB has 22 distinct values but 5 appear in both Title Case and lowercase: `Early Spring`/`early spring`, `Early Summer`/`early summer`, `Indeterminate`/`indeterminate`, `Late Spring`/`late spring`, `Late Summer`/`late summer`. Only the Title Case versions have translations (17 entries). The lowercase duplicates are untranslated.

**Root cause**: canopi-data normalization is inconsistent — some bloom period values are title-cased, others pass through as lowercase.

**Fix**: canopi-data — normalize all `bloom_period` values to consistent Title Case during export.

### ~~Issue E~~: flower_color composite values

**Status: Fixed** — added `translate_composite_value()` in `lookup.rs` that splits slash-separated values, translates each part individually, and rejoins with `/`. Used in both `filters.rs` (filter options) and `detail.rs` (detail card). Includes `.trim()` on split parts for robustness against space-padded slashes.

### ~~Issue F~~: fruit_type translations

**Status: Fixed** — added all 16 fruit_type values to `schema-contract.json` with translations in 10 languages.

### Issue G: root_system_type has translations but zero DB values (canopi-data)

7 translation entries exist (`adventitious`, `bulbous`, `fibrous`, `rhizomatous`, `stoloniferous`, `tap`, `tuberous`) but the species table has no non-null `root_system_type` values.

**Root cause**: canopi-data does not populate this column from any source.

**Fix**: canopi-data — either populate from PFAF/TRY data sources or remove the column from the schema contract.

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

### habit — Multiple taxonomy issues (canopi-data)

DB values: `Annual, Bamboo, Biennial, Bulb, Climber, Corm, Fern, Lichen, Perennial, Shrub, Tree`

This field conflates four different classification axes from PFAF:
- **Life cycle** (Annual, Biennial, Perennial) — already flagged in Issue A
- **Growth form** (Shrub, Tree, Climber) — correct usage
- **Storage organ** (Bulb, Corm) — these describe underground morphology, not above-ground habit. A tulip (bulb) and a crocus (corm) are both herbaceous perennials by habit
- **Taxonomic group** (Bamboo, Fern) — bamboo is a grass subfamily (Bambusoideae), not a habit; fern is a division (Polypodiopsida)
- **Non-plant** (Lichen) — lichens are fungal-algal symbioses, not plants

**Severity**: Medium. PFAF's classifications are widely understood by gardeners even though botanically imprecise. The field is usable for filtering but scientifically misleading.

**Fix (canopi-data)**: Long-term, split into proper growth form (Herb, Shrub, Tree, Climber, Vine) + life cycle (annual/biennial/perennial booleans, already exist) + storage organ (separate column). Short-term, at minimum remove Annual/Biennial/Perennial (Issue A).

### growth_habit — OK

DB values: `Bunch, Colonizing, Multiple Stem, Rhizomatous, Single Crown, Single Stem, Stoloniferous, Thicket Forming`

All standard USDA PLANTS database growth habit categories. Scientifically sound.

### deciduous_evergreen — OK

DB values: `Deciduous, Evergreen, Semi-Evergreen`

Standard leaf persistence categories. Correct.

### active_growth_period — Formatting inconsistency (canopi-data)

DB values: `Fall, Fall Winter and Spring, Spring, Spring and Fall, Spring and Summer, Spring Summer Fall, Spring Summer and Fall, Summer, Summer and Fall, Year Round`

Scientifically valid seasonal categories. However, conjunction formatting is inconsistent: `"Spring Summer Fall"` (no conjunction) vs `"Spring Summer and Fall"` (with "and") vs `"Spring and Fall"` (with "and"). These represent the same logical pattern but are stored differently.

**Fix (canopi-data)**: Normalize to consistent format (e.g., always `"Spring, Summer, and Fall"`).

### bloom_period — Formatting + case issues (canopi-data)

Already documented in Issue D (duplicate case variants). Additionally: `"Spring-Summer"` uses a hyphen while `"Spring and Summer"` would use a conjunction — inconsistent separators.

### flower_color — OK (composite translation gap noted in Issue E)

All 25 values are botanically valid flower colors. Composite values (`Blue/Purple`, `White/Yellow`) correctly represent multi-colored flowers. Slash separator is standard.

### drought_tolerance, fertility_requirement, moisture_use, anaerobic_tolerance — OK

Standard USDA ordinal scales (High/Medium/Low/None). Scientifically appropriate.

### succession_stage — Domain-specific terminology, readable to target audience (accepted)

DB values: `climax, placenta_i, placenta_ii, placenta_iii, secondary_i, secondary_ii, secondary_iii`

Uses Ernst Gotsch's syntropic agriculture framework:
- `placenta_i/ii/iii` = pioneer/nurse species of increasing lifespan (short-lived annuals → medium-lived → longer-lived pioneers)
- `secondary_i/ii/iii` = secondary succession species
- `climax` = climax community species

This is standard terminology for the app's target audience (agroecological designers). The word "placenta" may confuse general users but is correct in syntropic agriculture. Translations could help (e.g., "Pioneer I" in English-friendly labeling) but the raw values are appropriate for the domain.

### mycorrhizal_type — Scientifically correct, one naming issue (canopi-data)

DB values: `AM, AM/ECM, AM/NM, ECM, Ericoid, NM, Orchid, mixed`

All values are legitimate mycorrhizal categories:
- **AM** (Arbuscular Mycorrhiza) — found in ~80% of plant species ✓
- **ECM** (Ectomycorrhiza) — found in many trees (oaks, pines, birch) ✓
- **AM/ECM** — dual mycorrhizal species (e.g., Populus, Salix, Eucalyptus) ✓
- **AM/NM** — species that are typically AM but can grow without mycorrhiza ✓
- **NM** (Non-Mycorrhizal) — e.g., Brassicaceae, Chenopodiaceae ✓
- **Ericoid** — specific to Ericaceae (heaths, blueberries, rhododendrons) ✓ **this is a real mycorrhizal type**
- **Orchid** — specific to Orchidaceae, essential for orchid germination ✓ **this is a real mycorrhizal type**
- **mixed** — vague and lowercase while all others are Title Case / uppercase

**Issue**: `mixed` is poorly defined (could mean AM/ECM or variable associations) and uses inconsistent casing.

**Fix (canopi-data)**: Replace `mixed` with specific dual types (e.g., `AM/ECM`) or clarify its definition. Normalize case.

### grime_strategy — Potentially redundant pairs (canopi-data)

DB values: `C, CR, CS, CSR, R, RC, RS, S, SC, SR`

Grime's CSR plant strategy theory — a fundamental concept in plant ecology. C = Competitor, S = Stress-tolerator, R = Ruderal. However, `CR` and `RC` are listed separately (same for `CS`/`SC` and `RS`/`SR`). In most ecological literature these pairs are treated as synonyms. Some interpretations assign meaning to order (primary vs secondary strategy), but this is uncommon.

**Fix (canopi-data)**: Either deduplicate (merge RC→CR, SC→CS, SR→RS) or document that order is meaningful in the data model.

### pollination_syndrome — Mixes specificity levels and naming conventions (canopi-data)

DB values: `Anemophilous, Autogamous, Bees, Beetles, Bumblebees, Cleistogamous, Entomophilous, Facultative Autogamous, Flies, Hydrophilous, Lepidoptera, Wasps, Zoophilous`

Scientific issues:
1. **Overlapping hierarchy**: `Entomophilous` (all insects) is a superset of `Bees`, `Beetles`, `Flies`, `Lepidoptera`, `Wasps`. `Zoophilous` (all animals) is a superset of all insect pollinators. A bee-pollinated plant is simultaneously Entomophilous and Zoophilous
2. **Mixed naming**: Latin terms (`Anemophilous`, `Entomophilous`, `Hydrophilous`) alongside English common names (`Bees`, `Flies`, `Wasps`). Should be consistent
3. **Cleistogamous** is a mating/reproductive strategy (self-pollination in closed flowers), not a pollination syndrome
4. **Missing categories**: No bird (ornithophilous) or bat (chiropterophilous) pollination

**Fix (canopi-data)**: Standardize naming (all Latin or all English). Separate hierarchy levels — either use broad categories only (Anemophilous, Entomophilous, Hydrophilous, Zoophilous) or specific pollinator groups only (Bees, Beetles, Wind, Water, etc.). Move Cleistogamous to reproductive_type or sexual_system.

### fruit_type — Contains non-type values (canopi-data)

DB values: `Aggregate Drupelets, Aggregate Follicles, Aggregate Nutlets, Apocarpous, Berry, Capsule, Drupe, Dry, Fleshy, Follicle, Legume, Lomentum, Nut, Pome, Schizocarp, Silique`

Most values are correct botanical fruit types. Three are not:
- **Dry** and **Fleshy** — these are fruit *texture categories*, not types. "Dry" could be an achene, caryopsis, samara, etc. Too vague for meaningful filtering
- **Apocarpous** — this describes *carpel arrangement* (separate carpels), not a fruit type. It's a floral morphology term

**Fix (canopi-data)**: Replace `Dry`/`Fleshy` with specific types (achene, samara, etc.) or remove. Reclassify `Apocarpous` into a floral morphology field.

### seed_dormancy_type — Mixes dormancy types with durations and unrelated traits (canopi-data)

DB values: `Absolute, Long, Morphophysiological, None, Partial, Physical, Physiological, Serotinous, Short, Xerochasy`

Three categories are mixed together:
- **Dormancy mechanisms** (correct): `Physical` (hard seed coat), `Physiological` (chemical/hormonal block), `Morphophysiological` (underdeveloped embryo + physiological block), `None`
- **Dormancy durations** (wrong field): `Long`, `Short`, `Absolute`, `Partial` — these describe duration/depth, not type
- **Unrelated traits**: `Serotinous` (seeds held in cones/fruits until fire — a seed *release* mechanism, not dormancy), `Xerochasy` (fruit opening when dry — a *dehiscence* mechanism)

**Fix (canopi-data)**: Separate into `seed_dormancy_type` (Physical/Physiological/Morphophysiological/None) and `seed_dormancy_depth` (Absolute/Long/Short/Partial/None). Move Serotinous to a fire-ecology trait and Xerochasy to a dehiscence field.

### invasive_potential — Conflates invasion risk with biogeographic status (canopi-data)

DB values: `Introduced, Invasive, Native, Naturalized, Potentially Invasive`

This field mixes two different concepts:
- **Biogeographic status**: `Introduced`, `Native`, `Naturalized` — describes establishment history
- **Invasion risk**: `Invasive`, `Potentially Invasive` — describes ecological threat level

A species can be `Introduced` and `non-invasive`, or `Naturalized` and `non-invasive`. These are independent axes. Additionally, these statuses are region-dependent — a species native to one region is introduced in another.

**Fix (canopi-data)**: Split into `biogeographic_status` (Native/Introduced/Naturalized) and `invasive_risk` (None/Potentially Invasive/Invasive). Ideally both would be region-qualified.

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

| Field | Issue | Severity | Owner |
|---|---|---|---|
| habit | Life cycle + storage organ + taxonomy mixed in | High | canopi-data |
| pollination_syndrome | Overlapping hierarchy levels, mixed Latin/English | Medium | canopi-data |
| seed_dormancy_type | Mixes dormancy types, durations, and unrelated traits | Medium | canopi-data |
| fruit_type | "Dry", "Fleshy" are textures; "Apocarpous" is floral morphology | Medium | canopi-data |
| invasive_potential | Conflates biogeographic status with invasion risk | Medium | canopi-data |
| grime_strategy | Potentially redundant reversed pairs (CR/RC) | Low | canopi-data |
| mycorrhizal_type | "mixed" is vague and inconsistently cased | Low | canopi-data |
| active_growth_period | Inconsistent conjunction formatting | Low | canopi-data |
| bloom_period | Case duplicates + inconsistent separators | Low | canopi-data |
| canopy_position | Only 2 of 5 standard levels | Low | accepted |
| growth_form_type | Herb/Forb overlap | Low | accepted |

## Previously Fixed Issues (from earlier review rounds)

| # | Issue | Status |
|---|---|---|
| 1 | Dynamic filter cache not locale-aware | **Fixed** — locale-scoped `dynamicOptionsCache` |
| 2 | Language picker closes MoreFilters panel | **Fixed** — `data-preserve-overlays` pattern |
| 5 | Stale locale pattern affects all fields | **Fixed** — same locale-scoped cache |
| 6 | Inconsistent locale refresh | **Partially fixed** — sidebar lists reload on locale change |
| 9 | Life cycle filter section missing | **Fixed** — FilterStrip row added |
| C | deciduous_evergreen translations missing | **Fixed** — added to schema-contract.json |
| E | flower_color composite values untranslated | **Fixed** — `translate_composite_value()` splits on `/` |
| F | fruit_type zero translations | **Fixed** — 16 values added to schema-contract.json |
| H | 92% categorical fields untranslated | **Fixed** — 11 high-priority fields added (1050 total entries) |

## Recommended Next Actions

### App-side (this repo)

All high-priority app-side issues (C, E, F, H) have been fixed. Remaining app-side work:
- Monitor for new categorical fields that need translations as canopi-data evolves
- Consider adding low-priority scientific term translations if user feedback warrants it

### canopi-data side

**Data model fixes (scientific correctness):**
1. **Clean up habit** (Issue A + scientific): Remove life-cycle values; long-term, split storage organs (Bulb/Corm) and taxonomic groups (Fern/Bamboo/Lichen) into proper fields
2. **Fix pollination_syndrome hierarchy**: Either use broad categories only or specific pollinator groups, not both. Move Cleistogamous to reproductive_type. Standardize Latin/English naming
3. **Fix seed_dormancy_type mixing**: Separate dormancy mechanisms from durations. Move Serotinous/Xerochasy to appropriate fields
4. **Fix fruit_type non-types**: Replace Dry/Fleshy with specific types, reclassify Apocarpous
5. **Split invasive_potential**: Separate biogeographic status (Native/Introduced/Naturalized) from invasion risk (None/Potentially Invasive/Invasive)

**Normalization fixes:**
6. **Normalize bloom_period case** (Issue D): deduplicate the 5 Title Case / lowercase pairs
7. **Normalize active_growth_period formatting**: consistent conjunctions
8. **Fix mycorrhizal_type "mixed"**: replace with specific dual types or clarify, normalize case
9. **Deduplicate grime_strategy**: merge CR/RC, CS/SC, RS/SR if order is not meaningful
10. **Normalize export case** (Issue A/B): ensure export values match enum case consistently
11. **Populate or remove root_system_type** (Issue G): column is empty
12. **Split flower_color composites** (Issue E): normalize multi-value entries

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
