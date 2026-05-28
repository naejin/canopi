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
    if let Some(ref tolerances) = filters.sun_tolerances
        && !tolerances.is_empty()
    {
        let mut clauses: Vec<String> = Vec::new();
        for tolerance in tolerances {
            match tolerance.as_str() {
                "full_sun" => clauses.push("s.tolerates_full_sun = 1".to_owned()),
                "semi_shade" => clauses.push("s.tolerates_semi_shade = 1".to_owned()),
                "full_shade" => clauses.push("s.tolerates_full_shade = 1".to_owned()),
                _ => {}
            }
        }
        if !clauses.is_empty() {
            where_clauses.push(format!("({})", clauses.join(" OR ")));
        }
    }

    if let Some(ref soil_tolerances) = filters.soil_tolerances
        && !soil_tolerances.is_empty()
    {
        let conditions: Vec<String> = soil_tolerances
            .iter()
            .filter_map(|value| match value.as_str() {
                "light" => Some("s.tolerates_light_soil = 1".to_owned()),
                "medium" => Some("s.tolerates_medium_soil = 1".to_owned()),
                "heavy" => Some("s.tolerates_heavy_soil = 1".to_owned()),
                "well_drained" => Some("s.well_drained = 1".to_owned()),
                "heavy_clay" => Some("s.heavy_clay = 1".to_owned()),
                _ => None,
            })
            .collect();
        if !conditions.is_empty() {
            where_clauses.push(format!("({})", conditions.join(" OR ")));
        }
    }

    if let Some(ref growth_rates) = filters.growth_rate {
        append_text_in_clause(where_clauses, params, "s.growth_rate", growth_rates);
    }

    if let Some(ref cycles) = filters.life_cycle
        && !cycles.is_empty()
    {
        species_catalog_filters::append_text_list_filter(
            where_clauses,
            params,
            "life_cycle",
            cycles,
        );
    }

    if let Some(ref family) = filters.family {
        where_clauses.push(format!("s.family = ?{}", params.len() + 1));
        params.push(Value::Text(family.clone()));
    }

    if let Some(edible) = filters.edible
        && edible
    {
        where_clauses.push("s.edibility_rating > 0".to_owned());
    }

    if let Some(fixer) = filters.nitrogen_fixer
        && fixer
    {
        where_clauses.push("s.nitrogen_fixer = 1".to_owned());
    }

    if let Some(ref zones) = filters.climate_zones
        && !zones.is_empty()
    {
        let placeholders: Vec<String> = zones
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", params.len() + 1 + i))
            .collect();
        where_clauses.push(format!(
            "EXISTS (SELECT 1 FROM species_climate_zones cz WHERE cz.species_id = s.id AND cz.climate_zone IN ({}))",
            placeholders.join(", ")
        ));
        for zone in zones {
            params.push(Value::Text(zone.clone()));
        }
    }

    if let Some(ref types) = filters.habit {
        append_schema_text_in_clause(where_clauses, params, "habit", types);
    }

    if let Some(woody) = filters.woody {
        append_schema_boolean_true_clause(where_clauses, "woody", woody);
    }

    if let Some(min_rating) = filters.edibility_min {
        where_clauses.push(format!("s.edibility_rating >= ?{}", params.len() + 1));
        params.push(Value::Integer(min_rating as i64));
    }

    if let Some(ref extras) = filters.extra {
        for extra in extras {
            append_dynamic_filter(where_clauses, params, extra);
        }
    }
}

fn append_schema_text_in_clause(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    field_key: &str,
    values: &[String],
) {
    if values.is_empty() {
        return;
    }

    if let (Some(column), Some(PlantFilterFieldKind::Categorical)) =
        (validated_column(field_key), filter_field_kind(field_key))
    {
        append_text_in_clause(where_clauses, params, column, values);
    }
}

fn append_schema_boolean_true_clause(
    where_clauses: &mut Vec<String>,
    field_key: &str,
    value: bool,
) {
    if !value {
        return;
    }

    if let (Some(column), Some(PlantFilterFieldKind::Boolean)) =
        (validated_column(field_key), filter_field_kind(field_key))
    {
        where_clauses.push(format!("{column} = 1"));
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
