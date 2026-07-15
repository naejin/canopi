use super::sql::{SqlBuilder, escape_like_literal, like_predicate};
use super::text::{CommonNameQuery, normalized_common_name_sql};

pub(super) struct CommonNameRelevancePlan {
    pub(super) join_sql: String,
    active_token_aliases: Vec<String>,
}

impl CommonNameRelevancePlan {
    pub(super) fn build(
        query: Option<&CommonNameQuery>,
        use_token_index: bool,
        locale_placeholder: &str,
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

        Self {
            join_sql: active_join,
            active_token_aliases,
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
        let token_placeholder = sql_builder.bind_text(format!("{}%", escape_like_literal(token)));
        let token_condition = like_predicate("token", &token_placeholder);
        joins.push(format!(
            "LEFT JOIN (
                SELECT species_id, MIN(first_token_position) AS first_token_position
                FROM species_search_common_name_tokens
                WHERE language = {locale_placeholder}
                  AND {token_condition}
                GROUP BY species_id
            ) {alias} ON {alias}.species_id = s.id",
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
    let display_name = normalized_common_name_sql("bcn_loc.common_name");

    if !token_aliases.is_empty() {
        let display_query = query
            .map(display_query_text)
            .filter(|query| !query.is_empty());
        let exact_display_condition = display_query.as_ref().map(|query| {
            let exact_placeholder = sql_builder.bind_text(query.to_owned());
            format!("{display_name} = {exact_placeholder}")
        });
        let prefix_display_condition = display_query.as_ref().map(|query| {
            let prefix_placeholder =
                sql_builder.bind_text(format!("{}%", escape_like_literal(query)));
            like_predicate(&display_name, &prefix_placeholder)
        });
        let contains_display_condition = query.and_then(|query| {
            displayed_contains_all_tokens_condition(&display_name, query, sql_builder)
        });
        let all_tokens_condition = token_aliases
            .iter()
            .map(|alias| format!("{alias}.species_id IS NOT NULL"))
            .collect::<Vec<_>>()
            .join(" AND ");
        let mut next_tier = 0;
        let token_positions = token_aliases
            .iter()
            .map(|alias| format!("COALESCE({alias}.first_token_position, 2147483647)"))
            .collect::<Vec<_>>()
            .join(" + ");

        let mut cases = Vec::new();
        if let Some(condition) = exact_display_condition {
            cases.push(format!("WHEN {condition} THEN {next_tier}"));
            next_tier += 1;
        }
        if let Some(condition) = prefix_display_condition {
            cases.push(format!("WHEN {condition} THEN {next_tier}"));
            next_tier += 1;
        }
        if let Some(condition) = contains_display_condition {
            cases.push(format!("WHEN {condition} THEN {next_tier}"));
            next_tier += 1;
        }
        if !all_tokens_condition.is_empty() {
            cases.push(format!("WHEN {all_tokens_condition} THEN {next_tier}"));
            next_tier += 1;
        }

        return format!(
            "ORDER BY CASE {} ELSE {} END,
                {token_positions},
                COALESCE(LENGTH(bcn_loc.common_name), 2147483647),
                bm25(species_search_fts, 8, 10, 5, 1, 1),
                s.canonical_name",
            cases.join(" "),
            next_tier,
        );
    }

    let Some(query) = query else {
        return "ORDER BY bm25(species_search_fts, 8, 10, 5, 1, 1), s.canonical_name".to_owned();
    };

    if let Some(phrase) = &query.phrase {
        let phrase_placeholder = sql_builder.bind_text(phrase.to_owned());
        return format!(
            "ORDER BY CASE
                 WHEN {display_name} = {phrase_placeholder} THEN 0 ELSE 1
             END,
             bm25(species_search_fts, 8, 10, 5, 1, 1),
             s.canonical_name"
        );
    }

    let Some(token) = query.tokens.first() else {
        return "ORDER BY bm25(species_search_fts, 8, 10, 5, 1, 1), s.canonical_name".to_owned();
    };

    let exact_placeholder = sql_builder.bind_text(token.to_owned());
    let escaped_token = escape_like_literal(token);
    let starts_placeholder = sql_builder.bind_text(format!("{escaped_token} %"));
    let contains_placeholder = sql_builder.bind_text(format!("% {escaped_token} %"));
    let ends_placeholder = sql_builder.bind_text(format!("% {escaped_token}"));
    let starts_condition = like_predicate(&display_name, &starts_placeholder);
    let contains_condition = like_predicate(&display_name, &contains_placeholder);
    let ends_condition = like_predicate(&display_name, &ends_placeholder);

    format!(
        "ORDER BY CASE
             WHEN bcn_loc.common_name IS NOT NULL
              AND (
                {display_name} = {exact_placeholder}
                OR {starts_condition}
                OR {contains_condition}
                OR {ends_condition}
              )
             THEN 0 ELSE 1
         END,
         bm25(species_search_fts, 8, 10, 5, 1, 1),
         s.canonical_name"
    )
}

fn display_query_text(query: &CommonNameQuery) -> String {
    if query.tokens.is_empty() {
        return query.phrase.clone().unwrap_or_default();
    }
    query.tokens.join(" ")
}

fn displayed_contains_all_tokens_condition(
    display_name: &str,
    query: &CommonNameQuery,
    sql_builder: &mut SqlBuilder,
) -> Option<String> {
    if query.tokens.is_empty() {
        return None;
    }

    Some(
        query
            .tokens
            .iter()
            .map(|token| {
                let token_placeholder =
                    sql_builder.bind_text(format!("% {}%", escape_like_literal(token)));
                like_predicate(display_name, &token_placeholder)
            })
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}
