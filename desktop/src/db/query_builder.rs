use rusqlite::types::Value;
use common_types::species::{Sort, SpeciesFilter, FilterOp};

/// Encodes a cursor from a sort value and the canonical_name tiebreaker.
/// Format (base64 of): `<sort_value>\x00<canonical_name>`
pub fn encode_cursor(sort_value: &str, canonical_name: &str) -> String {
    let raw = format!("{}\x00{}", sort_value, canonical_name);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, raw)
}

/// Decodes a cursor back into (sort_value, canonical_name).
pub fn decode_cursor(cursor: &str) -> Option<(String, String)> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        cursor,
    )
    .ok()?;
    let s = String::from_utf8(bytes).ok()?;
    let mut parts = s.splitn(2, '\x00');
    let sort_val = parts.next()?.to_owned();
    let canonical = parts.next()?.to_owned();
    Some((sort_val, canonical))
}

/// Returns the SQL column expression for a given Sort variant.
pub fn sort_column(sort: &Sort) -> &'static str {
    match sort {
        Sort::Name | Sort::Relevance => "s.canonical_name",
        Sort::Family => "s.family",
        Sort::Height => "s.height_max_m",
        Sort::Hardiness => "s.hardiness_zone_min",
        Sort::GrowthRate => "s.growth_rate",
    }
}

/// Maps a frontend field name to a validated SQL column expression.
/// This is the security boundary — only allow-listed fields can be filtered dynamically.
pub(crate) fn validated_column(field: &str) -> Option<&'static str> {
    match field {
        // Growth & Form
        "woody" => Some("s.woody"),
        "habit" => Some("s.habit"),
        "growth_form_type" => Some("s.growth_form_type"),
        "growth_form_shape" => Some("s.growth_form_shape"),
        "growth_habit" => Some("s.growth_habit"),
        "canopy_position" => Some("s.canopy_position"),
        "deciduous_evergreen" => Some("s.deciduous_evergreen"),
        "resprout_ability" => Some("s.resprout_ability"),
        "coppice_potential" => Some("s.coppice_potential"),
        // Climate & Soil
        "frost_tender" => Some("s.frost_tender"),
        "drought_tolerance" => Some("s.drought_tolerance"),
        "soil_ph_min" => Some("s.soil_ph_min"),
        "soil_ph_max" => Some("s.soil_ph_max"),
        "tolerates_acid" => Some("s.tolerates_acid"),
        "tolerates_alkaline" => Some("s.tolerates_alkaline"),
        "tolerates_saline" => Some("s.tolerates_saline"),
        "tolerates_wind" => Some("s.tolerates_wind"),
        "tolerates_pollution" => Some("s.tolerates_pollution"),
        "tolerates_nutritionally_poor" => Some("s.tolerates_nutritionally_poor"),
        "fertility_requirement" => Some("s.fertility_requirement"),
        "moisture_use" => Some("s.moisture_use"),
        "anaerobic_tolerance" => Some("s.anaerobic_tolerance"),
        "root_depth_min_cm" => Some("s.root_depth_min_cm"),
        "frost_free_days_min" => Some("s.frost_free_days_min"),
        "precip_min_inches" => Some("s.precip_min_inches"),
        "precip_max_inches" => Some("s.precip_max_inches"),
        // Ecology
        "succession_stage" => Some("s.succession_stage"),
        "ecological_system" => Some("s.ecological_system"),
        "mycorrhizal_type" => Some("s.mycorrhizal_type"),
        "grime_strategy" => Some("s.grime_strategy"),
        "allelopathic" => Some("s.allelopathic"),
        "root_system_type" => Some("s.root_system_type"),
        "attracts_wildlife" => Some("s.attracts_wildlife"),
        "cn_ratio" => Some("s.cn_ratio"),
        // Reproduction
        "pollination_syndrome" => Some("s.pollination_syndrome"),
        "self_fertile" => Some("s.self_fertile"),
        "reproductive_type" => Some("s.reproductive_type"),
        "sexual_system" => Some("s.sexual_system"),
        "mating_system" => Some("s.mating_system"),
        "vegetative_spread_rate" => Some("s.vegetative_spread_rate"),
        "seed_spread_rate" => Some("s.seed_spread_rate"),
        // Fruit & Seed
        "fruit_type" => Some("s.fruit_type"),
        "seed_dispersal_mechanism" => Some("s.seed_dispersal_mechanism"),
        "seed_storage_behaviour" => Some("s.seed_storage_behaviour"),
        "fruit_seed_abundance" => Some("s.fruit_seed_abundance"),
        "seed_dormancy_type" => Some("s.seed_dormancy_type"),
        // Leaf
        "leaf_type" => Some("s.leaf_type"),
        "leaf_compoundness" => Some("s.leaf_compoundness"),
        "leaf_shape" => Some("s.leaf_shape"),
        // Bloom
        "bloom_period" => Some("s.bloom_period"),
        "flower_color" => Some("s.flower_color"),
        // Risk
        "toxicity" => Some("s.toxicity"),
        "invasive_potential" => Some("s.invasive_potential"),
        "noxious_status" => Some("s.noxious_status"),
        "invasive_usda" => Some("s.invasive_usda"),
        "weed_potential" => Some("s.weed_potential"),
        "fire_resistant" => Some("s.fire_resistant"),
        "fire_tolerance" => Some("s.fire_tolerance"),
        // Uses
        "medicinal_rating" => Some("s.medicinal_rating"),
        "other_uses_rating" => Some("s.other_uses_rating"),
        "scented" => Some("s.scented"),
        // Propagation
        "propagated_by_seed" => Some("s.propagated_by_seed"),
        "propagated_by_cuttings" => Some("s.propagated_by_cuttings"),
        "cold_stratification_required" => Some("s.cold_stratification_required"),
        // Data quality
        "active_growth_period" => Some("s.active_growth_period"),
        _ => None,
    }
}

/// Builds the complete search SQL and its bound parameter list.
///
/// Returns `(sql, params)` ready for `conn.prepare(&sql)` followed by
/// `stmt.query_map(rusqlite::params_from_iter(params.iter()), ...)`.
pub struct QueryBuilder {
    text: Option<String>,
    filters: SpeciesFilter,
    cursor: Option<String>,
    sort: Sort,
    limit: u32,
    locale: String,
}

impl QueryBuilder {
    pub fn new(
        text: Option<String>,
        filters: SpeciesFilter,
        cursor: Option<String>,
        sort: Sort,
        limit: u32,
        locale: String,
    ) -> Self {
        Self { text, filters, cursor, sort, limit, locale }
    }

    /// Builds the query, returning `(sql, params)`.
    pub fn build(self) -> (String, Vec<Value>) {
        let mut params: Vec<Value> = Vec::new();
        let mut where_clauses: Vec<String> = Vec::new();

        // ── Common-name JOINs (locale with English fallback) ─────────────────
        // Uses precomputed best_common_names table — simple indexed lookups.
        let p_locale = params.len() + 1;
        let p_en = params.len() + 2;
        let common_name_join = format!(
            "LEFT JOIN best_common_names bcn_loc \
                 ON bcn_loc.species_id = s.id AND bcn_loc.language = ?{p_locale} \
             LEFT JOIN best_common_names bcn_en \
                 ON bcn_en.species_id = s.id AND bcn_en.language = ?{p_en}"
        );
        params.push(Value::Text(self.locale));
        params.push(Value::Text("en".to_owned()));

        // ── FTS5 search (only when text is provided) ──────────────────────────
        // Uses the unified species_search_fts index which contains all searchable
        // text (canonical names, common names in all languages, family, genus, uses).
        // Single JOIN, no subqueries — fast for any query.
        let fts_join = if let Some(ref text) = self.text {
            // Strip all FTS5 metacharacters to prevent query syntax errors.
            // Characters with special meaning in FTS5 queries: " ( ) * + - ^ : \
            let sanitized = text.replace(|c: char| r#""()*+-^:\"#.contains(c), "");
            if sanitized.trim().is_empty() {
                // Input reduced to nothing after sanitization — skip FTS entirely
                // and return unfiltered results rather than a syntax error.
                None
            } else {
                let search_term = format!("{}*", sanitized.trim());
                let join = "JOIN species_search_fts ON species_search_fts.rowid = s.rowid"
                    .to_string();
                where_clauses.push(format!(
                    "species_search_fts MATCH ?{}",
                    params.len() + 1
                ));
                params.push(Value::Text(search_term));
                Some(join)
            }
        } else {
            None
        };

        // ── Structured filters ───────────────────────────────────────────────
        let f = &self.filters;

        if let Some(min) = f.hardiness_min {
            where_clauses.push(format!(
                "s.hardiness_zone_min >= ?{}",
                params.len() + 1
            ));
            params.push(Value::Integer(min as i64));
        }

        if let Some(max) = f.hardiness_max {
            where_clauses.push(format!(
                "s.hardiness_zone_max <= ?{}",
                params.len() + 1
            ));
            params.push(Value::Integer(max as i64));
        }

        if let Some(h) = f.height_max {
            where_clauses.push(format!("s.height_max_m <= ?{}", params.len() + 1));
            params.push(Value::Real(h as f64));
        }

        if let Some(ref tolerances) = f.sun_tolerances {
            if !tolerances.is_empty() {
                let mut sun_clauses: Vec<String> = Vec::new();
                for tol in tolerances {
                    match tol.as_str() {
                        "full_sun" => sun_clauses.push("s.tolerates_full_sun = 1".to_owned()),
                        "semi_shade" => {
                            sun_clauses.push("s.tolerates_semi_shade = 1".to_owned())
                        }
                        "full_shade" => {
                            sun_clauses.push("s.tolerates_full_shade = 1".to_owned())
                        }
                        _ => {}
                    }
                }
                if !sun_clauses.is_empty() {
                    where_clauses.push(format!("({})", sun_clauses.join(" OR ")));
                }
            }
        }

        if let Some(ref soil_tols) = f.soil_tolerances {
            if !soil_tols.is_empty() {
                let conditions: Vec<String> = soil_tols.iter().filter_map(|s| {
                    match s.as_str() {
                        "light" => Some("s.tolerates_light_soil = 1".to_owned()),
                        "medium" => Some("s.tolerates_medium_soil = 1".to_owned()),
                        "heavy" => Some("s.tolerates_heavy_soil = 1".to_owned()),
                        "well_drained" => Some("s.well_drained = 1".to_owned()),
                        "heavy_clay" => Some("s.heavy_clay = 1".to_owned()),
                        _ => None,
                    }
                }).collect();
                if !conditions.is_empty() {
                    where_clauses.push(format!("({})", conditions.join(" OR ")));
                }
            }
        }

        if let Some(ref rates) = f.growth_rate {
            if !rates.is_empty() {
                let placeholders: Vec<String> = rates
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", params.len() + 1 + i))
                    .collect();
                where_clauses.push(format!(
                    "s.growth_rate IN ({})",
                    placeholders.join(", ")
                ));
                for v in rates {
                    params.push(Value::Text(v.clone()));
                }
            }
        }

        if let Some(ref cycles) = f.life_cycle {
            if !cycles.is_empty() {
                // Map string values to boolean column checks with OR logic.
                // e.g. ["Annual", "Perennial"] → (s.is_annual = 1 OR s.is_perennial = 1)
                let mut cycle_clauses: Vec<String> = Vec::new();
                for cycle in cycles {
                    match cycle.as_str() {
                        "Annual" => cycle_clauses.push("s.is_annual = 1".to_owned()),
                        "Biennial" => cycle_clauses.push("s.is_biennial = 1".to_owned()),
                        "Perennial" => cycle_clauses.push("s.is_perennial = 1".to_owned()),
                        _ => {}
                    }
                }
                if !cycle_clauses.is_empty() {
                    where_clauses.push(format!("({})", cycle_clauses.join(" OR ")));
                }
            }
        }

        if let Some(ref strata) = f.stratum {
            if !strata.is_empty() {
                let placeholders: Vec<String> = strata
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", params.len() + 1 + i))
                    .collect();
                where_clauses.push(format!(
                    "s.stratum IN ({})",
                    placeholders.join(", ")
                ));
                for v in strata {
                    params.push(Value::Text(v.clone()));
                }
            }
        }

        if let Some(ref family) = f.family {
            where_clauses.push(format!("s.family = ?{}", params.len() + 1));
            params.push(Value::Text(family.clone()));
        }

        if let Some(edible) = f.edible {
            if edible {
                where_clauses.push("s.edibility_rating > 0".to_owned());
            }
            // false is a no-op: "not filtering by edibility" is the same as Some(false).
            // There is no "non-edible only" filter in the UI.
        }

        if let Some(fixer) = f.nitrogen_fixer {
            if fixer {
                where_clauses.push("s.nitrogen_fixer = 1".to_owned());
            }
        }

        if let Some(min) = f.height_min {
            where_clauses.push(format!("s.height_max_m >= ?{}", params.len() + 1));
            params.push(Value::Real(min as f64));
        }

        if let Some(min_rating) = f.edibility_min {
            where_clauses.push(format!("s.edibility_rating >= ?{}", params.len() + 1));
            params.push(Value::Integer(min_rating as i64));
        }

        if let Some(ref extras) = f.extra {
            for ef in extras {
                if let Some(col) = validated_column(&ef.field) {
                    match ef.op {
                        FilterOp::IsTrue => {
                            where_clauses.push(format!("{col} = 1"));
                        }
                        FilterOp::Equals => {
                            if let Some(v) = ef.values.first() {
                                where_clauses.push(format!("{col} = ?{}", params.len() + 1));
                                params.push(Value::Text(v.clone()));
                            }
                        }
                        FilterOp::In => {
                            if !ef.values.is_empty() {
                                let placeholders: Vec<String> = ef.values.iter()
                                    .enumerate()
                                    .map(|(i, _)| format!("?{}", params.len() + 1 + i))
                                    .collect();
                                where_clauses.push(format!("{col} IN ({})", placeholders.join(", ")));
                                for v in &ef.values {
                                    params.push(Value::Text(v.clone()));
                                }
                            }
                        }
                        FilterOp::Gte => {
                            if let Some(v) = ef.values.first() {
                                where_clauses.push(format!("{col} >= ?{}", params.len() + 1));
                                if let Ok(n) = v.parse::<f64>() {
                                    params.push(Value::Real(n));
                                } else {
                                    params.push(Value::Text(v.clone()));
                                }
                            }
                        }
                        FilterOp::Lte => {
                            if let Some(v) = ef.values.first() {
                                where_clauses.push(format!("{col} <= ?{}", params.len() + 1));
                                if let Ok(n) = v.parse::<f64>() {
                                    params.push(Value::Real(n));
                                } else {
                                    params.push(Value::Text(v.clone()));
                                }
                            }
                        }
                        FilterOp::Between => {
                            if ef.values.len() >= 2 {
                                where_clauses.push(format!(
                                    "{col} BETWEEN ?{} AND ?{}",
                                    params.len() + 1,
                                    params.len() + 2
                                ));
                                for v in &ef.values[..2] {
                                    if let Ok(n) = v.parse::<f64>() {
                                        params.push(Value::Real(n));
                                    } else {
                                        params.push(Value::Text(v.clone()));
                                    }
                                }
                            }
                        }
                    }
                }
                // Unknown fields silently ignored — defensive against stale frontend registry
            }
        }

        // ── Cursor-based pagination ──────────────────────────────────────────
        // For Relevance sort (FTS only), we fall back to canonical_name ordering
        // since rank is not stable across pages.
        let cursor_clause = if let Some(ref cursor_str) = self.cursor {
            if let Some((sort_val, cursor_name)) = decode_cursor(cursor_str) {
                let col = sort_column(&self.sort);
                if matches!(self.sort, Sort::Name | Sort::Relevance) {
                    // Single-column tiebreaker: canonical_name > ?
                    let clause = format!("s.canonical_name > ?{}", params.len() + 1);
                    params.push(Value::Text(cursor_name));
                    Some(clause)
                } else {
                    // Row-value comparison: (sort_col, canonical_name) > (?, ?)
                    let clause = format!(
                        "({}, s.canonical_name) > (?{}, ?{})",
                        col,
                        params.len() + 1,
                        params.len() + 2
                    );
                    // Push typed value matching the column type so SQLite
                    // comparisons use the correct affinity.
                    let typed_val = match self.sort {
                        Sort::Height => sort_val.parse::<f64>()
                            .map(Value::Real).unwrap_or(Value::Null),
                        Sort::Hardiness => sort_val.parse::<i64>()
                            .map(Value::Integer).unwrap_or(Value::Null),
                        _ => Value::Text(sort_val),
                    };
                    params.push(typed_val);
                    params.push(Value::Text(cursor_name));
                    Some(clause)
                }
            } else {
                None
            }
        } else {
            None
        };

        if let Some(clause) = cursor_clause {
            where_clauses.push(clause);
        }

        // ── ORDER BY ─────────────────────────────────────────────────────────
        // BM25 weights: canonical_name=10, common_names=8, family_genus=5, uses_text=1, other_text=1
        // BM25 returns negative values (more negative = more relevant), so ASC ordering is correct.
        let order_by = match self.sort {
            Sort::Relevance if fts_join.is_some() => {
                "ORDER BY bm25(species_search_fts, 10, 8, 5, 1, 1), s.canonical_name".to_owned()
            }
            _ => format!("ORDER BY {}, s.canonical_name", sort_column(&self.sort)),
        };

        // ── LIMIT ────────────────────────────────────────────────────────────
        // Fetch limit+1 to detect whether a next page exists.
        let limit_clause = format!("LIMIT ?{}", params.len() + 1);
        params.push(Value::Integer((self.limit + 1) as i64));

        // ── Assemble SQL ─────────────────────────────────────────────────────
        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        let fts_join_sql = fts_join.as_deref().unwrap_or("");

        let sql = format!(
            "SELECT s.canonical_name,
                    s.slug,
                    COALESCE(bcn_loc.common_name, bcn_en.common_name, s.common_name) AS display_name,
                    s.family,
                    s.genus,
                    s.height_max_m,
                    s.hardiness_zone_min,
                    s.hardiness_zone_max,
                    s.growth_rate,
                    s.stratum,
                    s.edibility_rating,
                    s.medicinal_rating,
                    s.width_max_m
             FROM species s
             {fts_join}
             {cn_join}
             {where_sql}
             {order_by}
             {limit_clause}",
            fts_join = fts_join_sql,
            cn_join = common_name_join,
            where_sql = where_sql,
            order_by = order_by,
            limit_clause = limit_clause,
        );

        (sql, params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use common_types::species::SpeciesFilter;

    fn default_filter() -> SpeciesFilter {
        SpeciesFilter::default()
    }

    #[test]
    fn test_cursor_round_trip() {
        let encoded = encode_cursor("Lamiaceae", "Lavandula angustifolia");
        let decoded = decode_cursor(&encoded).unwrap();
        assert_eq!(decoded.0, "Lamiaceae");
        assert_eq!(decoded.1, "Lavandula angustifolia");
    }

    #[test]
    fn test_cursor_invalid_returns_none() {
        assert!(decode_cursor("not-valid-base64!!!").is_none());
    }

    #[test]
    fn test_empty_query_produces_valid_sql() {
        let qb = QueryBuilder::new(
            None,
            default_filter(),
            None,
            Sort::Name,
            20,
            "en".to_owned(),
        );
        let (sql, params) = qb.build();
        assert!(sql.contains("FROM species s"));
        assert!(!sql.contains("species_search_fts"));
        // locale param + "en" fallback param + limit param
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn test_text_search_includes_fts_join() {
        let qb = QueryBuilder::new(
            Some("lavender".to_owned()),
            default_filter(),
            None,
            Sort::Relevance,
            20,
            "en".to_owned(),
        );
        let (sql, _params) = qb.build();
        assert!(sql.contains("species_search_fts"));
        assert!(sql.contains("species_search_fts MATCH"));
    }

    #[test]
    fn test_fts_search_term_has_prefix_wildcard() {
        let qb = QueryBuilder::new(
            Some("lav".to_owned()),
            default_filter(),
            None,
            Sort::Relevance,
            20,
            "en".to_owned(),
        );
        let (_sql, params) = qb.build();
        // params[0] = locale, params[1] = "en" fallback, params[2] = search term
        let search_term = match &params[2] {
            Value::Text(s) => s.clone(),
            _ => panic!("expected text"),
        };
        assert_eq!(search_term, "lav*");
    }

    #[test]
    fn test_nitrogen_fixer_true_filter() {
        let mut f = default_filter();
        f.nitrogen_fixer = Some(true);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(sql.contains("nitrogen_fixer = 1"));
    }

    #[test]
    fn test_nitrogen_fixer_false_is_noop() {
        let mut f = default_filter();
        f.nitrogen_fixer = Some(false);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(!sql.contains("nitrogen_fixer"));
    }

    #[test]
    fn test_life_cycle_filter_maps_to_boolean_columns() {
        let mut f = default_filter();
        f.life_cycle = Some(vec!["Annual".to_owned(), "Perennial".to_owned()]);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(sql.contains("is_annual = 1"));
        assert!(sql.contains("is_perennial = 1"));
        assert!(sql.contains(" OR "));
    }

    #[test]
    fn test_edible_filter() {
        let mut f = default_filter();
        f.edible = Some(true);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(sql.contains("edibility_rating > 0"));
    }

    #[test]
    fn test_soil_tolerances_filter_uses_boolean_columns() {
        let mut f = default_filter();
        f.soil_tolerances = Some(vec!["light".to_owned(), "heavy_clay".to_owned()]);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(sql.contains("tolerates_light_soil = 1"));
        assert!(sql.contains("heavy_clay = 1"));
        assert!(sql.contains(" OR "));
    }

    #[test]
    fn test_cursor_clause_name_sort() {
        let cursor = encode_cursor("Lavandula angustifolia", "Lavandula angustifolia");
        let qb = QueryBuilder::new(
            None,
            default_filter(),
            Some(cursor),
            Sort::Name,
            20,
            "en".to_owned(),
        );
        let (sql, _) = qb.build();
        assert!(sql.contains("s.canonical_name >"));
    }

    #[test]
    fn test_cursor_clause_family_sort_uses_row_value() {
        let cursor = encode_cursor("Lamiaceae", "Lavandula angustifolia");
        let qb = QueryBuilder::new(
            None,
            default_filter(),
            Some(cursor),
            Sort::Family,
            20,
            "en".to_owned(),
        );
        let (sql, _) = qb.build();
        assert!(sql.contains("(s.family, s.canonical_name) >"));
    }

    #[test]
    fn test_limit_is_incremented_by_one() {
        let qb = QueryBuilder::new(
            None,
            default_filter(),
            None,
            Sort::Name,
            20,
            "en".to_owned(),
        );
        let (_sql, params) = qb.build();
        let limit_val = match params.last().unwrap() {
            Value::Integer(n) => *n,
            _ => panic!("expected integer limit"),
        };
        assert_eq!(limit_val, 21);
    }
}
