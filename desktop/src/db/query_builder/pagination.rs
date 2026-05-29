use common_types::species::{Sort, SpeciesListItem};
use rusqlite::types::Value;

use super::columns::sort_column;
use super::cursor::{decode_cursor, encode_cursor};

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

    pub(super) fn limit_clause(&self, limit: u32, params: &mut Vec<Value>) -> String {
        let limit_position = params.len() + 1;
        params.push(Value::Integer((limit + 1) as i64));
        let offset_clause = match self {
            Self::RelevanceOffset { current_offset } if *current_offset > 0 => {
                let offset_position = params.len() + 1;
                params.push(Value::Integer(*current_offset as i64));
                format!(" OFFSET ?{offset_position}")
            }
            _ => String::new(),
        };
        format!("LIMIT ?{limit_position}{offset_clause}")
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
    params: &mut Vec<Value>,
) -> Option<String> {
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
