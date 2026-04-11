use common_types::species::{Sort, SpeciesFilter};
use rusqlite::types::Value;

use super::columns::sort_column;
use super::cursor::decode_cursor;
use super::filters::append_structured_filters;

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
        Self {
            text,
            filters,
            cursor,
            sort,
            limit,
            locale,
        }
    }

    /// Builds the query, returning `(sql, params)`.
    pub fn build(self) -> (String, Vec<Value>) {
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
        params.push(Value::Text(self.locale));
        params.push(Value::Text("en".to_owned()));

        let fts_join = if let Some(ref text) = self.text {
            let sanitized = text.replace(|character: char| r#""()*+-^:\"#.contains(character), "");
            if sanitized.trim().is_empty() {
                None
            } else {
                let search_term = format!("{}*", sanitized.trim());
                where_clauses.push(format!("species_search_fts MATCH ?{}", params.len() + 1));
                params.push(Value::Text(search_term));
                Some("JOIN species_search_fts ON species_search_fts.rowid = s.rowid".to_owned())
            }
        } else {
            None
        };

        let uses_relevance_offset = matches!(self.sort, Sort::Relevance) && fts_join.is_some();

        append_structured_filters(&mut where_clauses, &mut params, &self.filters);

        if let Some(clause) =
            cursor_clause(&self.cursor, &self.sort, &mut params, uses_relevance_offset)
        {
            where_clauses.push(clause);
        }

        let order_by = match self.sort {
            Sort::Relevance if fts_join.is_some() => {
                "ORDER BY bm25(species_search_fts, 8, 10, 5, 1, 1), s.canonical_name".to_owned()
            }
            _ => format!("ORDER BY {}, s.canonical_name", sort_column(&self.sort)),
        };

        let limit_position = params.len() + 1;
        params.push(Value::Integer((self.limit + 1) as i64));
        let offset_clause = if uses_relevance_offset {
            match decode_relevance_offset(self.cursor.as_deref()) {
                Some(offset) if offset > 0 => {
                    let offset_position = params.len() + 1;
                    params.push(Value::Integer(offset as i64));
                    format!(" OFFSET ?{offset_position}")
                }
                _ => String::new(),
            }
        } else {
            String::new()
        };
        let limit_clause = format!("LIMIT ?{limit_position}{offset_clause}");

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

fn cursor_clause(
    cursor: &Option<String>,
    sort: &Sort,
    params: &mut Vec<Value>,
    uses_relevance_offset: bool,
) -> Option<String> {
    if uses_relevance_offset {
        return None;
    }

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

pub(crate) fn decode_relevance_offset(cursor: Option<&str>) -> Option<u32> {
    let raw = cursor?;
    raw.strip_prefix("offset:")
        .unwrap_or(raw)
        .parse::<u32>()
        .ok()
}
