use common_types::species::{Sort, SpeciesListItem};
use rusqlite::types::Value;

use super::columns::sort_column;
use super::cursor::{decode_cursor, encode_cursor};
use super::sql::SqlBuilder;

#[derive(Debug, Clone)]
pub(super) enum SpeciesSearchPagePlan {
    RelevanceOffset { current_offset: u32 },
    Keyset { sort: Sort },
}

impl SpeciesSearchPagePlan {
    pub(super) fn for_request(sort: &Sort, cursor: Option<&str>, has_search_term: bool) -> Self {
        if matches!(sort, Sort::Relevance) && has_search_term {
            return Self::RelevanceOffset {
                current_offset: decode_relevance_offset(cursor).unwrap_or(0),
            };
        }

        Self::Keyset { sort: sort.clone() }
    }

    pub(super) fn is_keyset(&self) -> bool {
        matches!(self, Self::Keyset { .. })
    }

    pub(super) fn order_by(&self, request_sort: &Sort) -> String {
        match self {
            Self::RelevanceOffset { .. } => unreachable!("relevance offset ordering is tiered"),
            Self::Keyset { .. } => {
                format!("ORDER BY {}, s.canonical_name", sort_column(request_sort))
            }
        }
    }

    pub(super) fn limit_clause(&self, limit: u32, sql_builder: &mut SqlBuilder) -> String {
        let limit_placeholder = sql_builder.bind_integer((limit + 1) as i64);
        let offset_clause = match self {
            Self::RelevanceOffset { current_offset } if *current_offset > 0 => {
                let offset_placeholder = sql_builder.bind_integer(*current_offset as i64);
                format!(" OFFSET {offset_placeholder}")
            }
            _ => String::new(),
        };
        format!("LIMIT {limit_placeholder}{offset_clause}")
    }

    pub(super) fn result_window_end(&self, limit: u32) -> u32 {
        let offset = match self {
            Self::RelevanceOffset { current_offset } => *current_offset,
            Self::Keyset { .. } => 0,
        };
        offset.saturating_add(limit).saturating_add(1)
    }

    pub(super) fn next_cursor(&self, items: &[SpeciesListItem], has_next: bool) -> Option<String> {
        if !has_next {
            return None;
        }

        match self {
            Self::RelevanceOffset { current_offset } => {
                Some(format!("offset:{}", current_offset + items.len() as u32))
            }
            Self::Keyset { sort } => items.last().map(|last| {
                let sort_value = item_sort_value(sort, last);
                encode_cursor(&sort_value, &last.canonical_name)
            }),
        }
    }
}

pub(super) fn cursor_clause(
    cursor: &Option<String>,
    sort: &Sort,
    sql_builder: &mut SqlBuilder,
) -> Option<String> {
    let cursor = cursor.as_ref()?;
    let (sort_value, cursor_name) = decode_cursor(cursor)?;
    let column = sort_column(sort);

    if matches!(sort, Sort::Name | Sort::Relevance) {
        let cursor_name_placeholder = sql_builder.bind_text(cursor_name);
        let clause = format!("s.canonical_name > {cursor_name_placeholder}");
        return Some(clause);
    }

    let sort_placeholder = match sort {
        Sort::Height => sort_value
            .parse::<f64>()
            .map(|value| sql_builder.bind_real(value))
            .unwrap_or_else(|_| sql_builder.bind(Value::Null)),
        Sort::Hardiness => sort_value
            .parse::<i64>()
            .map(|value| sql_builder.bind_integer(value))
            .unwrap_or_else(|_| sql_builder.bind(Value::Null)),
        _ => sql_builder.bind_text(sort_value),
    };
    let cursor_name_placeholder = sql_builder.bind_text(cursor_name);
    let clause = format!(
        "({}, s.canonical_name) > ({sort_placeholder}, {cursor_name_placeholder})",
        column
    );
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
