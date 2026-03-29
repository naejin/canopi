use serde::{Deserialize, Serialize};

/// Result of checking a single species against a target hardiness zone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatibilityResult {
    pub species_id: String,
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub hardiness_min: Option<i32>,
    pub hardiness_max: Option<i32>,
    pub is_compatible: bool,
    /// How many zones the plant is outside the target (0 = compatible).
    pub zone_diff: i32,
}

/// A lighter species record used for replacement suggestions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplacementSuggestion {
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub hardiness_min: Option<i32>,
    pub hardiness_max: Option<i32>,
    pub stratum: Option<String>,
    pub height_max_m: Option<f32>,
}

/// Check a batch of species against a target hardiness zone.
///
/// A plant is compatible when the target zone falls within
/// `[hardiness_zone_min, hardiness_zone_max]`. Zone diff is the
/// minimum distance to the compatible range (0 when inside).
#[tauri::command]
pub fn check_plant_compatibility(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_names: Vec<String>,
    target_hardiness: i32,
    locale: String,
) -> Result<Vec<CompatibilityResult>, String> {
    if canonical_names.is_empty() {
        return Ok(Vec::new());
    }
    if canonical_names.len() > 500 {
        return Err("Batch size exceeds maximum of 500 names".into());
    }

    let conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());

    let placeholders: String = canonical_names
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT s.id, s.canonical_name, s.hardiness_zone_min, s.hardiness_zone_max
         FROM species s
         WHERE s.canonical_name IN ({placeholders})"
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare compatibility query: {e}"))?;

    let params: Vec<&dyn rusqlite::types::ToSql> = canonical_names
        .iter()
        .map(|n| n as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt
        .query_map(params.as_slice(), |row| {
            let species_id: String = row.get(0)?;
            let canonical_name: String = row.get(1)?;
            let hardiness_min: Option<i32> = row.get(2)?;
            let hardiness_max: Option<i32> = row.get(3)?;
            Ok((species_id, canonical_name, hardiness_min, hardiness_max))
        })
        .map_err(|e| format!("Failed to query compatibility: {e}"))?;

    let mut results = Vec::with_capacity(canonical_names.len());

    for row_result in rows {
        let (species_id, canonical_name, hardiness_min, hardiness_max) =
            row_result.map_err(|e| format!("Failed to read row: {e}"))?;

        let common_name = crate::db::plant_db::get_common_name(&conn, &species_id, &locale);

        let (is_compatible, zone_diff) =
            compute_zone_diff(hardiness_min, hardiness_max, target_hardiness);

        results.push(CompatibilityResult {
            species_id,
            canonical_name,
            common_name,
            hardiness_min,
            hardiness_max,
            is_compatible,
            zone_diff,
        });
    }

    Ok(results)
}

/// Suggest replacement species for one that is incompatible at a target zone.
///
/// Finds species with the same stratum (if known) and similar height (within
/// +/- 50%) that are compatible with the target hardiness zone.
#[tauri::command]
pub fn suggest_replacements(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_name: String,
    target_hardiness: i32,
    limit: u32,
    locale: String,
) -> Result<Vec<ReplacementSuggestion>, String> {
    let conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());

    // First, look up the original species to get its stratum and height
    let source: Option<(Option<String>, Option<f32>)> = conn
        .query_row(
            "SELECT s.stratum, s.height_max_m FROM species s WHERE s.canonical_name = ?1",
            [&canonical_name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Failed to look up source species: {e}"))
        .ok();

    let (stratum, height) = source.unwrap_or((None, None));

    // Build a query for compatible replacements
    let mut where_clauses: Vec<String> = vec![
        "s.canonical_name != ?1".to_owned(),
        "s.hardiness_zone_min IS NOT NULL".to_owned(),
        "s.hardiness_zone_max IS NOT NULL".to_owned(),
        format!("s.hardiness_zone_min <= ?2"),
        format!("s.hardiness_zone_max >= ?2"),
    ];

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
        vec![Box::new(canonical_name.clone()), Box::new(target_hardiness)];

    // Prefer same stratum
    if let Some(ref s) = stratum {
        params.push(Box::new(s.clone()));
        where_clauses.push(format!("s.stratum = ?{}", params.len()));
    }

    // Prefer similar height (+/- 50%)
    if let Some(h) = height {
        let h_min = h * 0.5;
        let h_max = h * 1.5;
        params.push(Box::new(h_min));
        where_clauses.push(format!("s.height_max_m >= ?{}", params.len()));
        params.push(Box::new(h_max));
        where_clauses.push(format!("s.height_max_m <= ?{}", params.len()));
    }

    params.push(Box::new(limit.min(20)));
    let limit_idx = params.len();

    let sql = format!(
        "SELECT s.id, s.canonical_name, s.hardiness_zone_min, s.hardiness_zone_max,
                s.stratum, s.height_max_m
         FROM species s
         WHERE {}
         ORDER BY ABS(s.hardiness_zone_min - ?2) ASC, s.canonical_name ASC
         LIMIT ?{limit_idx}",
        where_clauses.join(" AND ")
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params
        .iter()
        .map(|p| p.as_ref() as &dyn rusqlite::types::ToSql)
        .collect();

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare replacements query: {e}"))?;

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let species_id: String = row.get(0)?;
            let canonical_name: String = row.get(1)?;
            let hardiness_min: Option<i32> = row.get(2)?;
            let hardiness_max: Option<i32> = row.get(3)?;
            let stratum: Option<String> = row.get(4)?;
            let height_max_m: Option<f32> = row.get(5)?;
            Ok((
                species_id,
                canonical_name,
                hardiness_min,
                hardiness_max,
                stratum,
                height_max_m,
            ))
        })
        .map_err(|e| format!("Failed to query replacements: {e}"))?;

    let mut suggestions = Vec::new();

    for row_result in rows {
        let (species_id, cn, h_min, h_max, strat, height_m) =
            row_result.map_err(|e| format!("Failed to read replacement row: {e}"))?;

        let common_name = crate::db::plant_db::get_common_name(&conn, &species_id, &locale);

        suggestions.push(ReplacementSuggestion {
            canonical_name: cn,
            common_name,
            hardiness_min: h_min,
            hardiness_max: h_max,
            stratum: strat,
            height_max_m: height_m,
        });
    }

    Ok(suggestions)
}

/// Compute compatibility and zone difference.
///
/// Returns `(is_compatible, zone_diff)` where `zone_diff` is the minimum
/// distance from `target` to `[min, max]`. A plant with unknown hardiness
/// is treated as compatible with zone_diff = 0.
fn compute_zone_diff(
    hardiness_min: Option<i32>,
    hardiness_max: Option<i32>,
    target: i32,
) -> (bool, i32) {
    match (hardiness_min, hardiness_max) {
        (Some(min), Some(max)) => {
            if target >= min && target <= max {
                (true, 0)
            } else if target < min {
                let diff = min - target;
                (diff <= 2, diff)
            } else {
                let diff = target - max;
                (diff <= 2, diff)
            }
        }
        // If only one bound is known, check against that
        (Some(min), None) => {
            if target >= min {
                (true, 0)
            } else {
                let diff = min - target;
                (diff <= 2, diff)
            }
        }
        (None, Some(max)) => {
            if target <= max {
                (true, 0)
            } else {
                let diff = target - max;
                (diff <= 2, diff)
            }
        }
        // Unknown hardiness — assume compatible
        (None, None) => (true, 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zone_diff_compatible() {
        assert_eq!(compute_zone_diff(Some(3), Some(8), 5), (true, 0));
        assert_eq!(compute_zone_diff(Some(3), Some(8), 3), (true, 0));
        assert_eq!(compute_zone_diff(Some(3), Some(8), 8), (true, 0));
    }

    #[test]
    fn test_zone_diff_marginal() {
        // 1 zone off — still "compatible" (diff <= 2)
        assert_eq!(compute_zone_diff(Some(3), Some(8), 2), (true, 1));
        assert_eq!(compute_zone_diff(Some(3), Some(8), 10), (true, 2));
    }

    #[test]
    fn test_zone_diff_incompatible() {
        assert_eq!(compute_zone_diff(Some(3), Some(8), 11), (false, 3));
        assert_eq!(compute_zone_diff(Some(5), Some(7), 1), (false, 4));
    }

    #[test]
    fn test_zone_diff_unknown() {
        assert_eq!(compute_zone_diff(None, None, 5), (true, 0));
    }

    #[test]
    fn test_zone_diff_partial() {
        assert_eq!(compute_zone_diff(Some(4), None, 6), (true, 0));
        assert_eq!(compute_zone_diff(Some(4), None, 2), (true, 2));
        assert_eq!(compute_zone_diff(None, Some(7), 9), (true, 2));
        assert_eq!(compute_zone_diff(None, Some(7), 10), (false, 3));
    }
}
