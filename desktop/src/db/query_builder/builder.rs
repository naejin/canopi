use common_types::species::{SpeciesFilter, SpeciesListItem, SpeciesSearchRequest};
use rusqlite::types::Value;

use super::pagination::{SpeciesSearchPagePlan, cursor_clause};
use super::predicates::PredicatePlan;
use super::projection::{
    species_list_common_name_join_sql, species_list_matched_common_name_sql,
    species_list_select_sql_with_matched_common_name,
};
use super::relevance::{CommonNameRelevancePlan, relevance_order_by};
use super::sql::SqlBuilder;
use super::text::SearchText;

#[derive(Debug, Clone)]
pub struct SqlStatementPlan {
    sql: String,
    params: Vec<Value>,
}

impl SqlStatementPlan {
    fn new(sql: String, params: Vec<Value>) -> Self {
        Self { sql, params }
    }

    pub fn sql(&self) -> &str {
        &self.sql
    }

    pub fn params(&self) -> &[Value] {
        &self.params
    }
}

#[derive(Debug, Clone)]
pub struct SpeciesSearchPlanRequest {
    pub search: SpeciesSearchRequest,
    pub use_common_name_token_index: bool,
    pub use_search_name_entry_index: bool,
}

#[derive(Debug, Clone)]
pub struct SpeciesSearchPlan {
    list: SqlStatementPlan,
    count: Option<SqlStatementPlan>,
    page: SpeciesSearchPagePlan,
}

impl SpeciesSearchPlan {
    pub fn build(request: SpeciesSearchPlanRequest) -> Self {
        let search_text = SearchText::from_raw(search_text_input(&request.search.text));
        let page = SpeciesSearchPagePlan::for_request(
            &request.search.sort,
            request.search.cursor.as_deref(),
            search_text.has_fts_term(),
        );
        let use_indexed_name_search = should_use_indexed_name_search(&request, &search_text, &page);
        if use_indexed_name_search {
            let count = if request.search.include_total {
                Some(build_indexed_count_statement(
                    &request,
                    &search_text,
                    &request.search.filters,
                ))
            } else {
                None
            };
            let list = build_indexed_list_statement(&request, &search_text, &page);
            return Self { list, count, page };
        }

        let count = if request.search.include_total {
            Some(build_count_statement(
                &request,
                &search_text,
                &request.search.filters,
            ))
        } else {
            None
        };
        let list = build_list_statement(&request, &search_text, &page);

        Self { list, count, page }
    }

    pub fn list(&self) -> &SqlStatementPlan {
        &self.list
    }

    pub fn count(&self) -> Option<&SqlStatementPlan> {
        self.count.as_ref()
    }

    pub fn next_cursor(&self, items: &[SpeciesListItem], has_next: bool) -> Option<String> {
        self.page.next_cursor(items, has_next)
    }
}

fn should_use_indexed_name_search(
    request: &SpeciesSearchPlanRequest,
    search_text: &SearchText,
    page: &SpeciesSearchPagePlan,
) -> bool {
    request.use_search_name_entry_index
        && matches!(page, SpeciesSearchPagePlan::RelevanceOffset { .. })
        && search_text
            .common_name_query()
            .is_some_and(|query| !query.tokens.is_empty())
}

fn search_text_input(text: &str) -> Option<&str> {
    (!text.trim().is_empty()).then_some(text)
}

fn build_count_statement(
    request: &SpeciesSearchPlanRequest,
    search_text: &SearchText,
    filters: &SpeciesFilter,
) -> SqlStatementPlan {
    let mut sql_builder = SqlBuilder::default();
    let locale_placeholder = search_text
        .common_name_query()
        .map(|_| sql_builder.bind_text(request.search.locale.clone()));
    let predicates = PredicatePlan::for_search(
        search_text.fts_term(),
        search_text.common_name_query(),
        locale_placeholder.as_deref(),
        request.use_common_name_token_index,
        filters,
        &mut sql_builder,
    );
    let sql = format!(
        "SELECT COUNT(*) FROM species s {} {}",
        predicates.fts_join_sql(),
        predicates.where_sql()
    );

    SqlStatementPlan::new(sql, sql_builder.into_params())
}

fn build_list_statement(
    request: &SpeciesSearchPlanRequest,
    search_text: &SearchText,
    page: &SpeciesSearchPagePlan,
) -> SqlStatementPlan {
    let mut sql_builder = SqlBuilder::default();

    let locale_placeholder = sql_builder.bind_text(request.search.locale.clone());
    let common_name_join = species_list_common_name_join_sql(&locale_placeholder);

    let relevance_plan = match page {
        SpeciesSearchPagePlan::RelevanceOffset { .. } => Some(CommonNameRelevancePlan::build(
            search_text.common_name_query(),
            request.use_common_name_token_index,
            &locale_placeholder,
            &mut sql_builder,
        )),
        SpeciesSearchPagePlan::Keyset { .. } => None,
    };

    let mut predicates = PredicatePlan::for_search(
        search_text.fts_term(),
        search_text.common_name_query(),
        Some(&locale_placeholder),
        request.use_common_name_token_index,
        &request.search.filters,
        &mut sql_builder,
    );
    if page.is_keyset()
        && let Some(clause) = cursor_clause(
            &request.search.cursor,
            &request.search.sort,
            &mut sql_builder,
        )
    {
        predicates.push(clause);
    }

    let order_by = match page {
        SpeciesSearchPagePlan::RelevanceOffset { .. } => relevance_order_by(
            search_text.common_name_query(),
            relevance_plan
                .as_ref()
                .expect("relevance plan is built for relevance pages"),
            &mut sql_builder,
        ),
        SpeciesSearchPagePlan::Keyset { .. } => page.order_by(&request.search.sort),
    };

    let limit_clause = page.limit_clause(request.search.limit, &mut sql_builder);
    let matched_common_name_sql = species_list_matched_common_name_sql(
        search_text.common_name_query(),
        &locale_placeholder,
        &mut sql_builder,
    );
    let select_sql = species_list_select_sql_with_matched_common_name(
        &locale_placeholder,
        &matched_common_name_sql,
    );
    let where_sql = predicates.where_sql();

    let sql = format!(
        "{select_sql}
         FROM species s
         {fts_join}
         {cn_join}
         {token_join}
         {where_sql}
         {order_by}
         {limit_clause}",
        fts_join = predicates.fts_join_sql(),
        cn_join = common_name_join,
        token_join = relevance_plan
            .as_ref()
            .map(|plan| plan.join_sql.as_str())
            .unwrap_or(""),
        where_sql = where_sql,
        order_by = order_by,
        limit_clause = limit_clause,
    );

    SqlStatementPlan::new(sql, sql_builder.into_params())
}

fn build_indexed_count_statement(
    request: &SpeciesSearchPlanRequest,
    search_text: &SearchText,
    filters: &SpeciesFilter,
) -> SqlStatementPlan {
    let mut sql_builder = SqlBuilder::default();
    let locale_placeholder = sql_builder.bind_text(request.search.locale.clone());
    let indexed_search =
        indexed_name_search_cte(search_text, &locale_placeholder, &mut sql_builder);
    let predicates = PredicatePlan::for_search(None, None, None, false, filters, &mut sql_builder);
    let sql = format!(
        "WITH {cte}
         SELECT COUNT(*)
         FROM candidate_scores c
         JOIN species s ON s.id = c.species_id
         {where_sql}",
        cte = indexed_search.cte_sql,
        where_sql = predicates.where_sql(),
    );

    SqlStatementPlan::new(sql, sql_builder.into_params())
}

fn build_indexed_list_statement(
    request: &SpeciesSearchPlanRequest,
    search_text: &SearchText,
    page: &SpeciesSearchPagePlan,
) -> SqlStatementPlan {
    let mut sql_builder = SqlBuilder::default();
    let locale_placeholder = sql_builder.bind_text(request.search.locale.clone());
    let indexed_search =
        indexed_name_search_cte(search_text, &locale_placeholder, &mut sql_builder);
    let common_name_join = species_list_common_name_join_sql(&locale_placeholder);
    let predicates = PredicatePlan::for_search(
        None,
        None,
        None,
        false,
        &request.search.filters,
        &mut sql_builder,
    );
    let page_order_by = "c.relevance_rank,
                  c.token_position_sum,
                  c.display_name_length,
                  c.bm25_rank,
                  s.canonical_name";
    let limit_clause = page.limit_clause(request.search.limit, &mut sql_builder);
    let matched_common_name_sql = indexed_matched_common_name_sql(
        search_text
            .common_name_query()
            .expect("indexed list requires Common Name query tokens"),
        "s.id",
        &locale_placeholder,
        &mut sql_builder,
    );
    let cte_sql = format!(
        "{base_cte},
         ranked_page AS MATERIALIZED (
             SELECT c.species_id,
                    c.relevance_rank,
                    c.token_position_sum,
                    c.display_name_length,
                    c.bm25_rank,
                    s.canonical_name
             FROM candidate_scores c
             JOIN species s ON s.id = c.species_id
             {where_sql}
             ORDER BY {page_order_by}
             {limit_clause}
         )",
        base_cte = indexed_search.cte_sql,
        where_sql = predicates.where_sql(),
    );
    let select_sql = species_list_select_sql_with_matched_common_name(
        &locale_placeholder,
        &matched_common_name_sql,
    );
    let sql = format!(
        "WITH {cte}
         {select_sql}
         FROM ranked_page page
         JOIN species s ON s.id = page.species_id
         {cn_join}
         ORDER BY page.relevance_rank,
                  page.token_position_sum,
                  page.display_name_length,
                  page.bm25_rank,
                  page.canonical_name",
        cte = cte_sql,
        select_sql = select_sql,
        cn_join = common_name_join,
    );

    SqlStatementPlan::new(sql, sql_builder.into_params())
}

struct IndexedNameSearchCte {
    cte_sql: String,
}

fn indexed_name_search_cte(
    search_text: &SearchText,
    locale_placeholder: &str,
    sql_builder: &mut SqlBuilder,
) -> IndexedNameSearchCte {
    let query = search_text
        .common_name_query()
        .expect("indexed name search requires Common Name query tokens");
    let token_ctes = query
        .tokens
        .iter()
        .enumerate()
        .map(|(index, token)| {
            let token_placeholder = sql_builder.bind_text(format!("{token}*"));
            format!(
                "name_token_{index} AS (
                    SELECT entry_id, first_token_position
                    FROM species_search_name_entry_tokens
                    WHERE language IN ({locale_placeholder}, '__canonical__', '__taxonomy__')
                      AND token GLOB {token_placeholder}
                )"
            )
        })
        .collect::<Vec<_>>();
    let first_token = "name_token_0";
    let token_joins = (1..query.tokens.len())
        .map(|index| {
            format!(
                "JOIN name_token_{index} nt{index}
                   ON nt{index}.entry_id = nt0.entry_id"
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let token_position_sum = (0..query.tokens.len())
        .map(|index| format!("nt{index}.first_token_position"))
        .collect::<Vec<_>>()
        .join(" + ");
    let display_query = query.tokens.join(" ");
    let exact_display_placeholder = sql_builder.bind_text(display_query.clone());
    let prefix_display_placeholder = sql_builder.bind_text(format!("{display_query}*"));
    let mut ctes = token_ctes;
    ctes.push(format!(
        "name_entry_matches AS (
            SELECT e.species_id,
                   e.language,
                   e.entry_kind,
                   e.common_name,
                   e.normalized_name,
                   e.is_display_name,
                   e.is_primary,
                   e.source_rank,
                   e.name_length,
                   {token_position_sum} AS token_position_sum
            FROM {first_token} nt0
            {token_joins}
            JOIN species_search_name_entries e ON e.entry_id = nt0.entry_id
            WHERE e.language IN ({locale_placeholder}, '__canonical__', '__taxonomy__')
        )"
    ));
    ctes.push(format!(
        "ranked_name_entries AS (
            SELECT *,
                   CASE
                     WHEN language = {locale_placeholder}
                      AND entry_kind = 'common_name'
                      AND is_display_name = 1
                      AND normalized_name = {exact_display_placeholder}
                     THEN 0
                     WHEN language = {locale_placeholder}
                      AND entry_kind = 'common_name'
                      AND is_display_name = 1
                      AND normalized_name GLOB {prefix_display_placeholder}
                     THEN 1
                     WHEN language = {locale_placeholder}
                      AND entry_kind = 'common_name'
                      AND is_display_name = 1 THEN 2
                     WHEN language = {locale_placeholder}
                      AND entry_kind = 'common_name' THEN 3
                     ELSE 4
                   END AS name_rank
            FROM name_entry_matches
        )"
    ));
    ctes.push(
        "name_scores AS (
            SELECT species_id,
                   MIN(name_rank) AS name_rank,
                   MIN(token_position_sum) AS token_position_sum,
                   MIN(CASE
                       WHEN entry_kind = 'common_name' AND is_display_name = 1
                       THEN name_length
                       ELSE 2147483647
                   END)
                       AS display_name_length
            FROM ranked_name_entries
            GROUP BY species_id
        )"
        .to_owned(),
    );
    ctes.push(
        "candidate_scores AS MATERIALIZED (
            SELECT species_id,
                   name_rank AS relevance_rank,
                   token_position_sum,
                   display_name_length,
                   1000000.0 AS bm25_rank
            FROM name_scores
        )"
        .to_owned(),
    );

    IndexedNameSearchCte {
        cte_sql: ctes.join(",\n"),
    }
}

fn indexed_matched_common_name_sql(
    query: &super::text::CommonNameQuery,
    species_id_sql: &str,
    locale_placeholder: &str,
    sql_builder: &mut SqlBuilder,
) -> String {
    let exact_placeholder = sql_builder.bind_text(query.tokens.join(" "));
    let prefix_placeholder = sql_builder.bind_text(format!("{}*", query.tokens.join(" ")));
    let entry_token_conditions =
        indexed_entry_token_conditions("entry", query, locale_placeholder, sql_builder);
    let display_token_conditions =
        indexed_entry_token_conditions("display", query, locale_placeholder, sql_builder);

    format!(
        "(
            SELECT entry.common_name
            FROM species_search_name_entries entry
            WHERE entry.species_id = {species_id_sql}
              AND entry.language = {locale_placeholder}
              AND entry.entry_kind = 'common_name'
              AND entry.is_display_name = 0
              AND {entry_token_conditions}
              AND NOT EXISTS (
                  SELECT 1
                  FROM species_search_name_entries display
                  WHERE display.species_id = {species_id_sql}
                    AND display.language = {locale_placeholder}
                    AND display.entry_kind = 'common_name'
                    AND display.is_display_name = 1
                    AND {display_token_conditions}
              )
            ORDER BY
              CASE
                WHEN entry.normalized_name = {exact_placeholder} THEN 0
                WHEN entry.normalized_name GLOB {prefix_placeholder} THEN 1
                ELSE 2
              END,
              entry.is_primary DESC,
              entry.source_rank ASC,
              entry.name_length ASC,
              entry.common_name ASC
            LIMIT 1
        )"
    )
}

fn indexed_entry_token_conditions(
    entry_alias: &str,
    query: &super::text::CommonNameQuery,
    locale_placeholder: &str,
    sql_builder: &mut SqlBuilder,
) -> String {
    query
        .tokens
        .iter()
        .map(|token| {
            let token_placeholder = sql_builder.bind_text(format!("{token}*"));
            format!(
                "EXISTS (
                    SELECT 1
                    FROM species_search_name_entry_tokens token_match
                    WHERE token_match.entry_id = {entry_alias}.entry_id
                      AND token_match.language = {locale_placeholder}
                      AND token_match.token GLOB {token_placeholder}
                )"
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}
