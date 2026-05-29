use common_types::species::{Sort, SpeciesFilter, SpeciesListItem};
use rusqlite::types::Value;

use super::columns::sort_column;
use super::cursor::{decode_cursor, encode_cursor};
use super::filters::append_structured_filters;

const FTS_META_CHARS: &str = r#""()*+-^:\"#;

/// Sanitize text for FTS5 MATCH, returning `None` if nothing useful remains.
pub(crate) fn sanitize_fts_text(text: &str) -> Option<String> {
    let sanitized = text.replace(|c: char| FTS_META_CHARS.contains(c), "");
    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(format!("{trimmed}*"))
    }
}

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
enum SpeciesSearchPagePlan {
    RelevanceOffset { current_offset: u32 },
    Keyset { sort: Sort },
}

#[derive(Debug, Clone)]
pub struct SpeciesSearchPlan {
    list: SqlStatementPlan,
    count: Option<SqlStatementPlan>,
    page: SpeciesSearchPagePlan,
}

impl SpeciesSearchPlan {
    pub fn build(request: SpeciesSearchRequest) -> Self {
        let search_term = request.text.as_deref().and_then(sanitize_fts_text);
        let uses_relevance_offset =
            matches!(&request.sort, Sort::Relevance) && search_term.is_some();
        let current_offset = if uses_relevance_offset {
            decode_relevance_offset(request.cursor.as_deref()).unwrap_or(0)
        } else {
            0
        };
        let page = if uses_relevance_offset {
            SpeciesSearchPagePlan::RelevanceOffset { current_offset }
        } else {
            SpeciesSearchPagePlan::Keyset {
                sort: request.sort.clone(),
            }
        };
        let count = if request.include_total {
            Some(build_count_statement(
                search_term.as_deref(),
                &request.filters,
            ))
        } else {
            None
        };
        let list = build_list_statement(&request, search_term.as_deref(), &page);

        Self { list, count, page }
    }

    pub fn list(&self) -> &SqlStatementPlan {
        &self.list
    }

    pub fn count(&self) -> Option<&SqlStatementPlan> {
        self.count.as_ref()
    }

    pub fn next_cursor(&self, items: &[SpeciesListItem], has_next: bool) -> Option<String> {
        if !has_next {
            return None;
        }

        match &self.page {
            SpeciesSearchPagePlan::RelevanceOffset { current_offset } => {
                Some(format!("offset:{}", current_offset + items.len() as u32))
            }
            SpeciesSearchPagePlan::Keyset { sort } => items.last().map(|last| {
                let sort_value = item_sort_value(sort, last);
                encode_cursor(&sort_value, &last.canonical_name)
            }),
        }
    }
}

fn build_count_statement(search_term: Option<&str>, filters: &SpeciesFilter) -> SqlStatementPlan {
    let mut params: Vec<Value> = Vec::new();
    let mut where_clauses: Vec<String> = Vec::new();
    let fts_join = append_search_conditions(&mut where_clauses, &mut params, search_term, filters)
        .unwrap_or("");
    let where_sql = where_sql(&where_clauses);
    let sql = format!("SELECT COUNT(*) FROM species s {fts_join} {where_sql}");

    SqlStatementPlan::new(sql, params)
}

fn build_list_statement(
    request: &SpeciesSearchRequest,
    search_term: Option<&str>,
    page: &SpeciesSearchPagePlan,
) -> SqlStatementPlan {
    let mut params: Vec<Value> = Vec::new();
    let mut where_clauses: Vec<String> = Vec::new();

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

    let common_name_token = active_locale_common_name_whole_token(request.text.as_deref());
    let (common_name_token_join, has_indexed_common_name_token) = common_name_token_join(
        common_name_token.as_deref(),
        request.use_common_name_token_index,
        locale_position,
        &mut params,
    );

    let fts_join = append_search_conditions(
        &mut where_clauses,
        &mut params,
        search_term,
        &request.filters,
    );

    if matches!(page, SpeciesSearchPagePlan::Keyset { .. })
        && let Some(clause) = cursor_clause(&request.cursor, &request.sort, &mut params)
    {
        where_clauses.push(clause);
    }

    let order_by = match page {
        SpeciesSearchPagePlan::RelevanceOffset { .. } => relevance_order_by(
            common_name_token.as_deref(),
            has_indexed_common_name_token,
            &mut params,
        ),
        SpeciesSearchPagePlan::Keyset { .. } => {
            format!("ORDER BY {}, s.canonical_name", sort_column(&request.sort))
        }
    };

    let limit_position = params.len() + 1;
    params.push(Value::Integer((request.limit + 1) as i64));
    let offset_clause = match page {
        SpeciesSearchPagePlan::RelevanceOffset { current_offset } if *current_offset > 0 => {
            let offset_position = params.len() + 1;
            params.push(Value::Integer(*current_offset as i64));
            format!(" OFFSET ?{offset_position}")
        }
        _ => String::new(),
    };
    let limit_clause = format!("LIMIT ?{limit_position}{offset_clause}");

    let where_sql = where_sql(&where_clauses);
    let fts_join_sql = fts_join.unwrap_or("");

    let sql = format!(
        "SELECT s.canonical_name,
                s.slug,
                COALESCE(bcn_loc.common_name, bcn_en.common_name, s.common_name) AS display_name,
                CASE WHEN bcn_loc.common_name IS NOT NULL
                     THEN (
                       SELECT scn.common_name
                       FROM species_common_names scn
                       WHERE scn.species_id = s.id
                         AND scn.language = ?{locale_position}
                         AND scn.common_name != bcn_loc.common_name
                         AND scn.common_name != s.canonical_name
                       ORDER BY (scn.source = 'llm') DESC, scn.is_primary DESC, LENGTH(scn.common_name) ASC
                       LIMIT 1
                     )
                     ELSE NULL
                END AS display_name_2,
                CASE WHEN bcn_loc.common_name IS NULL THEN 1 ELSE 0 END AS is_name_fallback,
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
         {token_join}
         {where_sql}
         {order_by}
         {limit_clause}",
        fts_join = fts_join_sql,
        cn_join = common_name_join,
        token_join = common_name_token_join,
        where_sql = where_sql,
        order_by = order_by,
        limit_clause = limit_clause,
    );

    SqlStatementPlan::new(sql, params)
}

fn common_name_token_join(
    token: Option<&str>,
    enabled: bool,
    locale_position: usize,
    params: &mut Vec<Value>,
) -> (String, bool) {
    if !enabled {
        return (String::new(), false);
    }

    let Some(token) = token else {
        return (String::new(), false);
    };

    let token_position = params.len() + 1;
    params.push(Value::Text(token.to_owned()));
    (
        format!(
            "LEFT JOIN species_search_common_name_tokens scnt
             ON scnt.species_id = s.id
            AND scnt.language = ?{locale_position}
            AND scnt.token = ?{token_position}"
        ),
        true,
    )
}

fn relevance_order_by(
    token: Option<&str>,
    has_indexed_common_name_token: bool,
    params: &mut Vec<Value>,
) -> String {
    if has_indexed_common_name_token {
        return "ORDER BY CASE WHEN scnt.species_id IS NOT NULL THEN 0 ELSE 1 END,
                COALESCE(scnt.first_token_position, 2147483647),
                bm25(species_search_fts, 8, 10, 5, 1, 1),
                s.canonical_name"
            .to_owned();
    }

    let Some(token) = token else {
        return "ORDER BY bm25(species_search_fts, 8, 10, 5, 1, 1), s.canonical_name".to_owned();
    };

    let exact_position = params.len() + 1;
    let starts_position = params.len() + 2;
    let contains_position = params.len() + 3;
    let ends_position = params.len() + 4;
    params.push(Value::Text(token.to_owned()));
    params.push(Value::Text(format!("{token} %")));
    params.push(Value::Text(format!("% {token} %")));
    params.push(Value::Text(format!("% {token}")));

    format!(
        "ORDER BY CASE
             WHEN bcn_loc.common_name IS NOT NULL
              AND (
                bcn_loc.common_name = ?{exact_position} COLLATE NOCASE
                OR bcn_loc.common_name LIKE ?{starts_position}
                OR bcn_loc.common_name LIKE ?{contains_position}
                OR bcn_loc.common_name LIKE ?{ends_position}
              )
             THEN 0 ELSE 1
         END,
         bm25(species_search_fts, 8, 10, 5, 1, 1),
         s.canonical_name"
    )
}

fn active_locale_common_name_whole_token(text: Option<&str>) -> Option<String> {
    let sanitized = text?.replace(|c: char| FTS_META_CHARS.contains(c), " ");
    let mut tokens = sanitized.split_whitespace();
    let token = tokens.next()?.to_lowercase();
    if token.is_empty() || tokens.next().is_some() {
        None
    } else {
        Some(token)
    }
}

fn append_search_conditions(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    search_term: Option<&str>,
    filters: &SpeciesFilter,
) -> Option<&'static str> {
    let fts_join = search_term.map(|term| {
        where_clauses.push(format!("species_search_fts MATCH ?{}", params.len() + 1));
        params.push(Value::Text(term.to_owned()));
        "JOIN species_search_fts ON species_search_fts.rowid = s.rowid"
    });

    append_structured_filters(where_clauses, params, filters);
    fts_join
}

fn where_sql(where_clauses: &[String]) -> String {
    if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    }
}

fn cursor_clause(cursor: &Option<String>, sort: &Sort, params: &mut Vec<Value>) -> Option<String> {
    let cursor = cursor.as_ref()?;
    let (sort_value, cursor_name) = decode_cursor(cursor)?;
    let column = sort_column(sort);

    if matches!(sort, Sort::Name | Sort::Relevance) {
        let clause = format!("s.canonical_name > ?{}", params.len() + 1);
        params.push(Value::Text(cursor_name));
        return Some(clause);
    }

    let clause = format!(
        "({}, s.canonical_name) > (?{}, ?{})",
        column,
        params.len() + 1,
        params.len() + 2
    );
    let typed_value = match sort {
        Sort::Height => sort_value
            .parse::<f64>()
            .map(Value::Real)
            .unwrap_or(Value::Null),
        Sort::Hardiness => sort_value
            .parse::<i64>()
            .map(Value::Integer)
            .unwrap_or(Value::Null),
        _ => Value::Text(sort_value),
    };
    params.push(typed_value);
    params.push(Value::Text(cursor_name));
    Some(clause)
}

fn decode_relevance_offset(cursor: Option<&str>) -> Option<u32> {
    let raw = cursor?;
    raw.strip_prefix("offset:")
        .unwrap_or(raw)
        .parse::<u32>()
        .ok()
}

fn item_sort_value(sort: &Sort, item: &SpeciesListItem) -> String {
    match sort {
        Sort::Family => item.family.clone().unwrap_or_default(),
        Sort::Height => item
            .height_max_m
            .map(|height| height.to_string())
            .unwrap_or_default(),
        Sort::Hardiness => item
            .hardiness_zone_min
            .map(|zone| zone.to_string())
            .unwrap_or_default(),
        Sort::GrowthRate => item.growth_rate.clone().unwrap_or_default(),
        Sort::Name | Sort::Relevance => item.canonical_name.clone(),
    }
}
