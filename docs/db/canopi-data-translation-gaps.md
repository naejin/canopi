# canopi-data Translation Gaps

Audit date: 2026-04-04. Source: canopi app French locale testing of the plant detail card.

The canopi app's plant detail card displays species field values via the `translated_values` table in canopi-core.db. Several fields are either missing translation rows entirely, have low-quality translations, or store structured data that the current categorical translation system cannot handle.

All issues below must be resolved in **canopi-data** (the export pipeline). The canopi app's Rust backend already passes these fields through `translate_composite_value()` — it will pick up new/corrected rows automatically after a DB regeneration.

---

## 1. Missing `translated_values` rows

### 1a. `fruit_seed_color`

No rows exist for `field_name = 'fruit_seed_color'`. The DB values are identical to `flower_color`:

```
Black, Blue, Brown, Green, Orange, Purple, Red, White, Yellow
```

`flower_color` already has full 10-language translations in the export. Duplicate the same color map under `field_name = 'fruit_seed_color'`.

### 1b. `fruit_seed_period_begin` and `fruit_seed_period_end`

No rows exist for either field. The DB values are:

```
Fall, Spring, Summer, Winter, Year Round
```

These are a subset of the `bloom_period` vocabulary, which is already translated. Duplicate the matching entries under `field_name = 'fruit_seed_period_begin'` and `field_name = 'fruit_seed_period_end'`.

---

## 2. Low-quality translations (rows exist but need improvement)

### 2a. `stratum`

Rows exist but the translations are bare lowercase adjectives. Compare current vs. expected:

| value_en | current value_fr | expected value_fr |
|----------|-----------------|-------------------|
| emergent | émergent | Émergent |
| high | haut | Canopée haute |
| low | bas | Bas / sol |
| medium | moyen | Canopée moyenne |

The canopi app frontend already uses higher-quality labels for these in its i18n filter keys (`filters.stratum_*`). The `translated_values` entries should match that quality level across all 10 non-English languages.

Reference labels (from canopi app `desktop/web/src/i18n/`):

| value_en | en label | fr | es | de | it | pt | zh | ja | ko | nl | ru |
|----------|----------|----|----|----|----|----|----|----|----|----|----|
| emergent | Emergent | Émergent | Emergente | Überragend | Emergente | Emergente | 超冠层 | 超高木層 | 초관층 | Oprijzend | Эмерджентный |
| high | High canopy | Canopée haute | Dosel alto | Obere Baumschicht | Volta alta | Copa alta | 高冠层 | 高木層 | 상층림 | Hoog bladerdak | Верхний ярус |
| low | Low / ground | Bas / sol | Bajo / suelo | Niedrig / Boden | Basso / suolo | Baixo / solo | 低层/地被 | 低木・地被層 | 저층/지피 | Laag / grond | Нижний / почвенный |
| medium | Mid canopy | Canopée moyenne | Dosel medio | Mittlere Baumschicht | Volta media | Copa média | 中冠层 | 中木層 | 중층림 | Midden bladerdak | Средний ярус |

### 2b. `succession_stage`

Rows exist. Current translations are functional but should be reviewed for proper capitalization and terminology. Current state:

| value_en | current value_fr |
|----------|-----------------|
| climax | climax |
| placenta_i | placenta I |
| placenta_ii | placenta II |
| placenta_iii | placenta III |
| secondary_i | secondaire I |
| secondary_ii | secondaire II |
| secondary_iii | secondaire III |

Recommended: title-case and ensure all 10 non-English languages have proper botanical succession terminology (e.g., fr: "Placenta I" instead of "placenta I", "Secondaire I" instead of "secondaire I", "Climax" instead of "climax").

---

## 3. Structured data — not translatable via categorical lookup

### 3a. `native_distribution` and `introduced_distribution`

These columns store **JSON arrays of geographic region names** (English):

```json
["China", "India", "Indonesia", "Malaysia", "Australia"]
["Alaska", "British Columbia", "California", "Oregon", "Washington"]
```

The canopi app's `translate_composite_value()` handles comma-separated categorical values, not JSON arrays. These fields cannot be translated with the current mechanism.

Proposed solutions (pick one):

**Option A — Localized region name table**: Create a `region_translations` table mapping English region names to localized equivalents. The canopi app would parse the JSON array and translate each element.

**Option B — Pre-localized JSON columns**: Add `native_distribution_fr`, `native_distribution_es`, etc. columns to the species table (same pattern as `best_common_names`). The canopi app would select the appropriate locale column.

**Option C — Accept English-only**: Geographic proper nouns are often left untranslated. Mark these fields as English-only in the contract and let the canopi app render them as-is.

---

## Verification

After fixing, regenerate canopi-core.db and verify with:

```sql
-- Should return 9 rows (one per color)
SELECT value_en, value_fr FROM translated_values
WHERE field_name = 'fruit_seed_color' AND value_fr IS NOT NULL;

-- Should return 5 rows each
SELECT value_en, value_fr FROM translated_values
WHERE field_name = 'fruit_seed_period_begin' AND value_fr IS NOT NULL;

SELECT value_en, value_fr FROM translated_values
WHERE field_name = 'fruit_seed_period_end' AND value_fr IS NOT NULL;

-- Should return proper labels, not bare adjectives
SELECT value_en, value_fr FROM translated_values
WHERE field_name = 'stratum';

-- Should return title-cased translations
SELECT value_en, value_fr FROM translated_values
WHERE field_name = 'succession_stage';
```
