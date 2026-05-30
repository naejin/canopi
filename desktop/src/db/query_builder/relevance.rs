use super::sql::SqlBuilder;
use super::text::CommonNameQuery;

pub(super) struct CommonNameRelevancePlan {
    pub(super) join_sql: String,
    active_token_aliases: Vec<String>,
    fallback_token_aliases: Vec<String>,
}

impl CommonNameRelevancePlan {
    pub(super) fn build(
        query: Option<&CommonNameQuery>,
        use_token_index: bool,
        locale_placeholder: &str,
        fallback_locale_placeholder: &str,
        locale: &str,
        sql_builder: &mut SqlBuilder,
    ) -> Self {
        let tokens = query.map(|query| query.tokens.as_slice()).unwrap_or(&[]);
        let (active_join, active_token_aliases) = common_name_token_joins(
            tokens,
            use_token_index,
            locale_placeholder,
            "scnt",
            sql_builder,
        );
        let (fallback_join, fallback_token_aliases) = common_name_token_joins(
            tokens,
            use_token_index && locale != "en",
            fallback_locale_placeholder,
            "scnt_fb",
            sql_builder,
        );
        let join_sql = [active_join, fallback_join]
            .into_iter()
            .filter(|join| !join.is_empty())
            .collect::<Vec<_>>()
            .join("\n");

        Self {
            join_sql,
            active_token_aliases,
            fallback_token_aliases,
        }
    }
}

fn common_name_token_joins(
    tokens: &[String],
    enabled: bool,
    locale_placeholder: &str,
    alias_prefix: &str,
    sql_builder: &mut SqlBuilder,
) -> (String, Vec<String>) {
    if !enabled || tokens.is_empty() {
        return (String::new(), Vec::new());
    }

    let mut joins = Vec::with_capacity(tokens.len());
    let mut aliases = Vec::with_capacity(tokens.len());
    for (index, token) in tokens.iter().enumerate() {
        let alias = format!("{alias_prefix}{index}");
        let token_placeholder = sql_builder.bind_text(token.to_owned());
        joins.push(format!(
            "LEFT JOIN species_search_common_name_tokens {alias}
             ON {alias}.species_id = s.id
            AND {alias}.language = {locale_placeholder}
            AND {alias}.token = {token_placeholder}",
            alias = alias
        ));
        aliases.push(alias);
    }

    (joins.join("\n"), aliases)
}

pub(super) fn relevance_order_by(
    query: Option<&CommonNameQuery>,
    plan: &CommonNameRelevancePlan,
    sql_builder: &mut SqlBuilder,
) -> String {
    let token_aliases = &plan.active_token_aliases;
    let fallback_token_aliases = &plan.fallback_token_aliases;

    if !token_aliases.is_empty() || !fallback_token_aliases.is_empty() {
        let phrase_condition = query.and_then(|query| query.phrase.as_ref()).map(|phrase| {
            let phrase_placeholder = sql_builder.bind_text(phrase.to_owned());
            format!("bcn_loc.common_name = {phrase_placeholder} COLLATE NOCASE")
        });
        let fallback_phrase_condition = (!fallback_token_aliases.is_empty())
            .then_some(())
            .and_then(|()| {
                query.and_then(|query| query.phrase.as_ref()).map(|phrase| {
                    let phrase_placeholder = sql_builder.bind_text(phrase.to_owned());
                    format!("bcn_en.common_name = {phrase_placeholder} COLLATE NOCASE")
                })
            });
        let all_tokens_condition = token_aliases
            .iter()
            .map(|alias| format!("{alias}.species_id IS NOT NULL"))
            .collect::<Vec<_>>()
            .join(" AND ");
        let fallback_all_tokens_condition = fallback_token_aliases
            .iter()
            .map(|alias| format!("{alias}.species_id IS NOT NULL"))
            .collect::<Vec<_>>()
            .join(" AND ");
        let active_all_tokens_tier = if phrase_condition.is_some() { 1 } else { 0 };
        let fallback_phrase_tier = active_all_tokens_tier + 1;
        let fallback_all_tokens_tier = fallback_phrase_tier
            + if fallback_phrase_condition.is_some() {
                1
            } else {
                0
            };
        let token_positions = token_aliases
            .iter()
            .chain(fallback_token_aliases.iter())
            .map(|alias| format!("COALESCE({alias}.first_token_position, 2147483647)"))
            .collect::<Vec<_>>()
            .join(" + ");

        let mut cases = Vec::new();
        if let Some(condition) = phrase_condition {
            cases.push(format!("WHEN {condition} THEN 0"));
        }
        if !all_tokens_condition.is_empty() {
            cases.push(format!(
                "WHEN {all_tokens_condition} THEN {active_all_tokens_tier}"
            ));
        }
        if let Some(condition) = fallback_phrase_condition {
            cases.push(format!("WHEN {condition} THEN {fallback_phrase_tier}"));
        }
        if !fallback_all_tokens_condition.is_empty() {
            cases.push(format!(
                "WHEN {fallback_all_tokens_condition} THEN {fallback_all_tokens_tier}"
            ));
        }

        return format!(
            "ORDER BY CASE {} ELSE {} END,
                {token_positions},
                bm25(species_search_fts, 8, 10, 5, 1, 1),
                s.canonical_name",
            cases.join(" "),
            fallback_all_tokens_tier + 1,
        );
    }

    let Some(query) = query else {
        return "ORDER BY bm25(species_search_fts, 8, 10, 5, 1, 1), s.canonical_name".to_owned();
    };

    if let Some(phrase) = &query.phrase {
        let phrase_placeholder = sql_builder.bind_text(phrase.to_owned());
        return format!(
            "ORDER BY CASE
                 WHEN bcn_loc.common_name = {phrase_placeholder} COLLATE NOCASE THEN 0 ELSE 1
             END,
             bm25(species_search_fts, 8, 10, 5, 1, 1),
             s.canonical_name"
        );
    }

    let Some(token) = query.tokens.first() else {
        return "ORDER BY bm25(species_search_fts, 8, 10, 5, 1, 1), s.canonical_name".to_owned();
    };

    let exact_placeholder = sql_builder.bind_text(token.to_owned());
    let starts_placeholder = sql_builder.bind_text(format!("{token} %"));
    let contains_placeholder = sql_builder.bind_text(format!("% {token} %"));
    let ends_placeholder = sql_builder.bind_text(format!("% {token}"));

    format!(
        "ORDER BY CASE
             WHEN bcn_loc.common_name IS NOT NULL
              AND (
                bcn_loc.common_name = {exact_placeholder} COLLATE NOCASE
                OR bcn_loc.common_name LIKE {starts_placeholder}
                OR bcn_loc.common_name LIKE {contains_placeholder}
                OR bcn_loc.common_name LIKE {ends_placeholder}
              )
             THEN 0 ELSE 1
         END,
         bm25(species_search_fts, 8, 10, 5, 1, 1),
         s.canonical_name"
    )
}
