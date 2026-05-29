use common_types::species::{Sort, SpeciesFilter, SpeciesListItem};
use rusqlite::types::Value;

use super::pagination::{SpeciesSearchPagePlan, cursor_clause};
use super::predicates::PredicatePlan;
use super::projection::species_list_select_sql;
use super::relevance::{CommonNameRelevancePlan, relevance_order_by};
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
pub struct SpeciesSearchRequest {
    pub text: Option<String>,
    pub filters: SpeciesFilter,
    pub cursor: Option<String>,
    pub sort: Sort,
    pub limit: u32,
    pub include_total: bool,
    pub locale: String,
    pub use_common_name_token_index: bool,
}

#[derive(Debug, Clone)]
pub struct SpeciesSearchPlan {
    list: SqlStatementPlan,
    count: Option<SqlStatementPlan>,
    page: SpeciesSearchPagePlan,
}

impl SpeciesSearchPlan {
    pub fn build(request: SpeciesSearchRequest) -> Self {
        let search_text = SearchText::from_raw(request.text.as_deref());
        let page = SpeciesSearchPagePlan::for_request(
            &request.sort,
            request.cursor.as_deref(),
            search_text.has_fts_term(),
        );
        let count = if request.include_total {
            Some(build_count_statement(
                search_text.fts_term(),
                &request.filters,
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

fn build_count_statement(search_term: Option<&str>, filters: &SpeciesFilter) -> SqlStatementPlan {
    let mut params: Vec<Value> = Vec::new();
    let predicates = PredicatePlan::for_search(search_term, filters, &mut params);
    let sql = format!(
        "SELECT COUNT(*) FROM species s {} {}",
        predicates.fts_join_sql(),
        predicates.where_sql()
    );

    SqlStatementPlan::new(sql, params)
}

fn build_list_statement(
    request: &SpeciesSearchRequest,
    search_text: &SearchText,
    page: &SpeciesSearchPagePlan,
) -> SqlStatementPlan {
    let mut params: Vec<Value> = Vec::new();

    let locale_position = params.len() + 1;
    let fallback_locale_position = params.len() + 2;
    let common_name_join = format!(
        "LEFT JOIN best_common_names bcn_loc \
             ON bcn_loc.species_id = s.id AND bcn_loc.language = ?{locale_position} \
         LEFT JOIN best_common_names bcn_en \
             ON bcn_en.species_id = s.id AND bcn_en.language = ?{fallback_locale_position}"
    );
    params.push(Value::Text(request.locale.clone()));
    params.push(Value::Text("en".to_owned()));

    let relevance_plan = match page {
        SpeciesSearchPagePlan::RelevanceOffset { .. } => Some(CommonNameRelevancePlan::build(
            search_text.common_name_query(),
            request.use_common_name_token_index,
            locale_position,
            fallback_locale_position,
            &request.locale,
            &mut params,
        )),
        SpeciesSearchPagePlan::Keyset { .. } => None,
    };

    let mut predicates =
        PredicatePlan::for_search(search_text.fts_term(), &request.filters, &mut params);
    if page.is_keyset()
        && let Some(clause) = cursor_clause(&request.cursor, &request.sort, &mut params)
    {
        predicates.push(clause);
    }

    let order_by = match page {
        SpeciesSearchPagePlan::RelevanceOffset { .. } => relevance_order_by(
            search_text.common_name_query(),
            relevance_plan
                .as_ref()
                .expect("relevance plan is built for relevance pages"),
            &mut params,
        ),
        SpeciesSearchPagePlan::Keyset { .. } => page.order_by(&request.sort),
    };

    let limit_clause = page.limit_clause(request.limit, &mut params);
    let select_sql = species_list_select_sql(locale_position);
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

    SqlStatementPlan::new(sql, params)
}
