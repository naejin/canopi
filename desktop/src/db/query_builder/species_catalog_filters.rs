use rusqlite::types::Value;

pub(super) fn append_text_list_filter(
    where_clauses: &mut Vec<String>,
    _params: &mut Vec<Value>,
    filter_key: &str,
    values: &[String],
) {
    if values.is_empty() {
        return;
    }

    if filter_key == "life_cycle" {
        append_life_cycle_filter(where_clauses, values);
    }
}

fn append_life_cycle_filter(where_clauses: &mut Vec<String>, cycles: &[String]) {
    let clauses: Vec<&'static str> = cycles
        .iter()
        .filter_map(|cycle| match cycle.as_str() {
            "Annual" => Some("s.is_annual = 1"),
            "Biennial" => Some("s.is_biennial = 1"),
            "Perennial" => Some("s.is_perennial = 1"),
            _ => None,
        })
        .collect();

    if !clauses.is_empty() {
        where_clauses.push(format!("({})", clauses.join(" OR ")));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn life_cycle_filter_maps_known_values_to_boolean_columns() {
        let mut clauses = Vec::new();
        let mut params = Vec::new();

        append_text_list_filter(
            &mut clauses,
            &mut params,
            "life_cycle",
            &["Annual".to_owned(), "Perennial".to_owned()],
        );

        assert_eq!(clauses, ["(s.is_annual = 1 OR s.is_perennial = 1)"]);
        assert!(params.is_empty());
    }

    #[test]
    fn life_cycle_filter_ignores_unknown_values() {
        let mut clauses = Vec::new();
        let mut params = Vec::new();

        append_text_list_filter(
            &mut clauses,
            &mut params,
            "life_cycle",
            &["Unknown".to_owned()],
        );

        assert!(clauses.is_empty());
        assert!(params.is_empty());
    }
}
