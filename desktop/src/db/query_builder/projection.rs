pub(super) fn species_list_select_sql(locale_position: usize) -> String {
    format!(
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
                s.width_max_m"
    )
}
