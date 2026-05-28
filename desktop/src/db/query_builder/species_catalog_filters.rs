use common_types::species::SpeciesFilter;
use rusqlite::types::Value;

use super::columns::validated_column;
use super::{PlantFilterFieldKind, filter_field_kind};

const SUN_TOLERANCE_COLUMNS: &[(&str, &str)] = &[
    ("full_sun", "s.tolerates_full_sun = 1"),
    ("semi_shade", "s.tolerates_semi_shade = 1"),
    ("full_shade", "s.tolerates_full_shade = 1"),
];

const SOIL_TOLERANCE_COLUMNS: &[(&str, &str)] = &[
    ("light", "s.tolerates_light_soil = 1"),
    ("medium", "s.tolerates_medium_soil = 1"),
    ("heavy", "s.tolerates_heavy_soil = 1"),
    ("well_drained", "s.well_drained = 1"),
    ("heavy_clay", "s.heavy_clay = 1"),
];

const LIFE_CYCLE_COLUMNS: &[(&str, &str)] = &[
    ("Annual", "s.is_annual = 1"),
    ("Biennial", "s.is_biennial = 1"),
    ("Perennial", "s.is_perennial = 1"),
];

pub(super) fn append_fixed_filters(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    filters: &SpeciesFilter,
) {
    append_mapped_boolean_list_filter(
        where_clauses,
        filters.sun_tolerances.as_deref(),
        SUN_TOLERANCE_COLUMNS,
    );
    append_mapped_boolean_list_filter(
        where_clauses,
        filters.soil_tolerances.as_deref(),
        SOIL_TOLERANCE_COLUMNS,
    );

    if let Some(ref growth_rates) = filters.growth_rate {
        append_text_in_clause(where_clauses, params, "s.growth_rate", growth_rates);
    }

    append_mapped_boolean_list_filter(
        where_clauses,
        filters.life_cycle.as_deref(),
        LIFE_CYCLE_COLUMNS,
    );

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

    if let Some(ref zones) = filters.climate_zones {
        append_climate_zone_filter(where_clauses, params, zones);
    }

    if let Some(ref habits) = filters.habit {
        append_schema_text_in_clause(where_clauses, params, "habit", habits);
    }

    if let Some(woody) = filters.woody {
        append_schema_boolean_true_clause(where_clauses, "woody", woody);
    }

    if let Some(min_rating) = filters.edibility_min {
        where_clauses.push(format!("s.edibility_rating >= ?{}", params.len() + 1));
        params.push(Value::Integer(min_rating as i64));
    }
}

fn append_mapped_boolean_list_filter(
    where_clauses: &mut Vec<String>,
    values: Option<&[String]>,
    mapping: &[(&str, &str)],
) {
    let Some(values) = values else {
        return;
    };
    if values.is_empty() {
        return;
    }

    let clauses: Vec<&str> = values
        .iter()
        .filter_map(|value| {
            mapping
                .iter()
                .find_map(|(known, clause)| (*known == value).then_some(*clause))
        })
        .collect();

    if !clauses.is_empty() {
        where_clauses.push(format!("({})", clauses.join(" OR ")));
    }
}

fn append_climate_zone_filter(
    where_clauses: &mut Vec<String>,
    params: &mut Vec<Value>,
    zones: &[String],
) {
    if zones.is_empty() {
        return;
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn life_cycle_filter_maps_known_values_to_boolean_columns() {
        let mut clauses = Vec::new();
        let cycles = vec!["Annual".to_owned(), "Perennial".to_owned()];

        append_mapped_boolean_list_filter(
            &mut clauses,
            Some(cycles.as_slice()),
            LIFE_CYCLE_COLUMNS,
        );

        assert_eq!(clauses, ["(s.is_annual = 1 OR s.is_perennial = 1)"]);
    }

    #[test]
    fn life_cycle_filter_ignores_unknown_values() {
        let mut clauses = Vec::new();
        let cycles = vec!["Unknown".to_owned()];

        append_mapped_boolean_list_filter(
            &mut clauses,
            Some(cycles.as_slice()),
            LIFE_CYCLE_COLUMNS,
        );

        assert!(clauses.is_empty());
    }

    #[test]
    fn fixed_filters_route_schema_and_bespoke_predicates_through_one_adapter() {
        let mut clauses = Vec::new();
        let mut params = Vec::new();
        let filters = SpeciesFilter {
            sun_tolerances: Some(vec!["full_sun".to_owned(), "full_shade".to_owned()]),
            soil_tolerances: Some(vec!["heavy_clay".to_owned()]),
            growth_rate: Some(vec!["Fast".to_owned()]),
            life_cycle: Some(vec!["Perennial".to_owned()]),
            edible: Some(true),
            edibility_min: Some(3),
            nitrogen_fixer: Some(true),
            climate_zones: Some(vec!["Temperate".to_owned()]),
            habit: Some(vec!["Tree".to_owned()]),
            woody: Some(true),
            ..SpeciesFilter::default()
        };

        append_fixed_filters(&mut clauses, &mut params, &filters);

        let sql = clauses.join(" AND ");
        assert!(sql.contains("tolerates_full_sun = 1"));
        assert!(sql.contains("heavy_clay = 1"));
        assert!(sql.contains("s.growth_rate IN"));
        assert!(sql.contains("is_perennial = 1"));
        assert!(sql.contains("s.edibility_rating > 0"));
        assert!(sql.contains("s.edibility_rating >="));
        assert!(sql.contains("s.nitrogen_fixer = 1"));
        assert!(sql.contains("species_climate_zones cz"));
        assert!(sql.contains("s.habit IN"));
        assert!(sql.contains("s.woody = 1"));
        assert_eq!(params.len(), 4);
    }
}
