use common_types::species::{DynamicFilter, FilterOp, SpeciesFilter};
use rusqlite::types::Value;

use super::columns::validated_column;
use super::species_catalog_filters;
use super::{PlantFilterFieldKind, filter_field_kind};

pub(super) fn append_structured_filters(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    filters: &SpeciesFilter,
) {
    species_catalog_filters::append_fixed_filters(where_clauses, params, filters);

    if let Some(ref extras) = filters.extra {
        for extra in extras {
            append_dynamic_filter(where_clauses, params, extra);
        }
    }
}

fn append_dynamic_filter(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    extra: &DynamicFilter,
) {
    let Some(column) = validated_column(&extra.field) else {
        return;
    };
    let Some(field_kind) = filter_field_kind(&extra.field) else {
        return;
    };

    match (field_kind, &extra.op) {
        (PlantFilterFieldKind::Boolean, FilterOp::IsTrue) => {
            where_clauses.push(format!("{column} = 1"));
        }
        (PlantFilterFieldKind::Categorical, FilterOp::Equals) => {
            append_text_equals_clause(where_clauses, params, column, extra.values.first());
        }
        (PlantFilterFieldKind::Categorical, FilterOp::In) => {
            append_text_in_clause(where_clauses, params, column, &extra.values);
        }
        (PlantFilterFieldKind::Numeric, FilterOp::Equals) => {
            append_scalar_comparison(where_clauses, params, column, "=", extra.values.first());
        }
        (PlantFilterFieldKind::Numeric, FilterOp::Gte) => {
            append_scalar_comparison(where_clauses, params, column, ">=", extra.values.first());
        }
        (PlantFilterFieldKind::Numeric, FilterOp::Lte) => {
            append_scalar_comparison(where_clauses, params, column, "<=", extra.values.first());
        }
        (PlantFilterFieldKind::Numeric, FilterOp::Between) => {
            append_scalar_between_clause(where_clauses, params, column, &extra.values);
        }
        _ => {}
    }
}

fn append_text_in_clause(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    column: &str,
    values: &[String],
) {
    if values.is_empty() {
        return;
    }

    let placeholders: Vec<String> = values
        .iter()
        .enumerate()
        .map(|(index, _)| format!("?{}", params.len() + 1 + index))
        .collect();
    where_clauses.push(format!("{column} IN ({})", placeholders.join(", ")));
    for value in values {
        params.push(Value::Text(value.clone()));
    }
}

fn append_text_equals_clause(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    column: &str,
    value: Option<&String>,
) {
    if let Some(value) = value {
        where_clauses.push(format!("{column} = ?{}", params.len() + 1));
        params.push(Value::Text(value.clone()));
    }
}

fn append_scalar_comparison(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    column: &str,
    operator: &str,
    value: Option<&String>,
) {
    if let Some(value) = value {
        where_clauses.push(format!("{column} {operator} ?{}", params.len() + 1));
        push_best_effort_value(params, value);
    }
}

fn append_scalar_between_clause(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    column: &str,
    values: &[String],
) {
    if values.len() >= 2 {
        where_clauses.push(format!(
            "{column} BETWEEN ?{} AND ?{}",
            params.len() + 1,
            params.len() + 2
        ));
        push_best_effort_value(params, &values[0]);
        push_best_effort_value(params, &values[1]);
    }
}

fn push_best_effort_value(params: &mut Vec<Value>, value: &str) {
    if let Ok(number) = value.parse::<f64>() {
        params.push(Value::Real(number));
    } else {
        params.push(Value::Text(value.to_owned()));
    }
}
