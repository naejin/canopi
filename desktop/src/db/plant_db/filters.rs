use common_types::species::{DynamicFilterOptions, FilterOptions, FilterValue};
use rusqlite::Connection;

use super::lookup::translate_composite_value;

pub fn get_filter_options(conn: &Connection) -> Result<FilterOptions, String> {
    let families: Vec<String> = distinct_text_values(
        conn,
        "SELECT DISTINCT family FROM species WHERE family IS NOT NULL ORDER BY family",
        "families",
    )?;
    let growth_rates: Vec<String> = distinct_text_values(
        conn,
        "SELECT DISTINCT growth_rate FROM species WHERE growth_rate IS NOT NULL ORDER BY growth_rate",
        "growth rates",
    )?;
    let climate_zones = vec![
        "Tropical".to_owned(),
        "Arid".to_owned(),
        "Mediterranean".to_owned(),
        "Subtropical".to_owned(),
        "Temperate".to_owned(),
        "Continental".to_owned(),
        "Boreal".to_owned(),
    ];

    let habits = vec![
        "Tree".to_owned(),
        "Shrub".to_owned(),
        "Herbaceous".to_owned(),
        "Climber".to_owned(),
    ];

    let life_cycles = vec![
        "Annual".to_owned(),
        "Biennial".to_owned(),
        "Perennial".to_owned(),
    ];
    let soil_tolerances = vec![
        "light".to_owned(),
        "medium".to_owned(),
        "heavy".to_owned(),
        "well_drained".to_owned(),
        "heavy_clay".to_owned(),
    ];

    let mut sun_tolerances = Vec::new();
    if boolean_exists(conn, "tolerates_full_sun") {
        sun_tolerances.push("full_sun".to_owned());
    }
    if boolean_exists(conn, "tolerates_semi_shade") {
        sun_tolerances.push("semi_shade".to_owned());
    }
    if boolean_exists(conn, "tolerates_full_shade") {
        sun_tolerances.push("full_shade".to_owned());
    }

    Ok(FilterOptions {
        families,
        growth_rates,
        climate_zones,
        habits,
        life_cycles,
        sun_tolerances,
        soil_tolerances,
    })
}

pub fn get_dynamic_filter_options(
    conn: &Connection,
    fields: &[String],
    locale: &str,
) -> Result<Vec<DynamicFilterOptions>, String> {
    let mut results = Vec::with_capacity(fields.len());

    for field in fields {
        let Some(column) = crate::db::query_builder::validated_column(field) else {
            tracing::warn!(
                "Dynamic filter field is not allowlisted in this backend build: {field}"
            );
            continue;
        };
        let column_name = column.strip_prefix("s.").unwrap_or(column);

        if is_boolean_field(field) {
            results.push(DynamicFilterOptions {
                field: field.clone(),
                field_type: "boolean".to_owned(),
                values: None,
                range: None,
            });
            continue;
        }

        if is_numeric_field(field) {
            // Safety: column_name comes from validated_column() allowlist — not user input.
            // Column identifiers cannot be bound as SQL parameters.
            let range_result: Result<Option<(f64, f64)>, _> = conn
                .query_row(
                    &format!(
                        "SELECT MIN(CAST({column_name} AS REAL)), MAX(CAST({column_name} AS REAL)) \
                         FROM species WHERE {column_name} IS NOT NULL AND typeof({column_name}) IN ('integer', 'real')"
                    ),
                    [],
                    |row| {
                        let min: Option<f64> = row.get(0)?;
                        let max: Option<f64> = row.get(1)?;
                        Ok(min.zip(max))
                    },
                )
                .map_err(|e| format!("Failed to query range for {field}: {e}"));

            results.push(DynamicFilterOptions {
                field: field.clone(),
                field_type: "numeric".to_owned(),
                values: None,
                range: range_result.ok().flatten(),
            });
            continue;
        }

        // Safety: column_name comes from validated_column() allowlist — not user input.
        let sql = format!(
            "SELECT DISTINCT {column_name} FROM species \
             WHERE {column_name} IS NOT NULL AND {column_name} != '' \
             ORDER BY {column_name} LIMIT 100"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare distinct query for {field}: {e}"))?;
        let values: Vec<FilterValue> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to fetch values for {field}: {e}"))?
            .filter_map(|result| result.ok())
            .map(|value| FilterValue {
                label: translate_composite_value(conn, field, &value, locale),
                value,
            })
            .collect();

        results.push(DynamicFilterOptions {
            field: field.clone(),
            field_type: "categorical".to_owned(),
            values: Some(values),
            range: None,
        });
    }

    Ok(results)
}

fn distinct_text_values(conn: &Connection, sql: &str, label: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Failed to prepare {label} query: {e}"))?;
    Ok(stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Failed to fetch {label}: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped {label} row: {error}");
                None
            }
        })
        .collect())
}

/// Safety: column_name is a hardcoded value from get_filter_options — not user input.
fn boolean_exists(conn: &Connection, column_name: &str) -> bool {
    conn.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM species WHERE {column_name} = 1)"),
        [],
        |row| row.get(0),
    )
    .unwrap_or(false)
}

fn is_boolean_field(field: &str) -> bool {
    matches!(
        field,
        "woody"
            | "frost_tender"
            | "allelopathic"
            | "attracts_wildlife"
            | "scented"
            | "self_fertile"
            | "noxious_status"
            | "invasive_usda"
            | "weed_potential"
            | "fire_resistant"
            | "resprout_ability"
            | "coppice_potential"
            | "tolerates_acid"
            | "tolerates_alkaline"
            | "tolerates_saline"
            | "tolerates_wind"
            | "tolerates_pollution"
            | "tolerates_nutritionally_poor"
            | "propagated_by_seed"
            | "propagated_by_cuttings"
            | "cold_stratification_required"
            | "serotinous"
    )
}

fn is_numeric_field(field: &str) -> bool {
    matches!(
        field,
        "soil_ph_min"
            | "soil_ph_max"
            | "root_depth_min_cm"
            | "frost_free_days_min"
            | "precip_min_inches"
            | "precip_max_inches"
            | "medicinal_rating"
            | "other_uses_rating"
            | "hardiness_zone_min"
            | "hardiness_zone_max"
            | "height_max_m"
            | "ellenberg_light"
            | "ellenberg_temperature"
            | "ellenberg_moisture"
            | "ellenberg_reaction"
            | "ellenberg_nitrogen"
            | "ellenberg_salt"
    )
}
