use common_types::species::{SpeciesFilter, SpeciesListItem, SpeciesSearchRequest};
use rusqlite::types::Value;

use super::pagination::{SpeciesSearchPagePlan, cursor_clause};
use super::predicates::PredicatePlan;
use super::projection::{species_list_common_name_join_sql, species_list_select_sql};
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
        let count = if request.search.include_total {
            Some(build_count_statement(
                search_text.fts_term(),
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

fn search_text_input(text: &str) -> Option<&str> {
    (!text.trim().is_empty()).then_some(text)
}

fn build_count_statement(search_term: Option<&str>, filters: &SpeciesFilter) -> SqlStatementPlan {
    let mut sql_builder = SqlBuilder::default();
    let predicates = PredicatePlan::for_search(search_term, filters, &mut sql_builder);
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
    let fallback_locale_placeholder = sql_builder.bind_text("en");
    let common_name_join =
        species_list_common_name_join_sql(&locale_placeholder, &fallback_locale_placeholder);

    let relevance_plan = match page {
        SpeciesSearchPagePlan::RelevanceOffset { .. } => Some(CommonNameRelevancePlan::build(
            search_text.common_name_query(),
            request.use_common_name_token_index,
            &locale_placeholder,
            &fallback_locale_placeholder,
            &request.search.locale,
            &mut sql_builder,
        )),
        SpeciesSearchPagePlan::Keyset { .. } => None,
    };

    let mut predicates = PredicatePlan::for_search(
        search_text.fts_term(),
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
    let select_sql = species_list_select_sql(&locale_placeholder);
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
