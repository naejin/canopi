pub(crate) fn species_list_select_sql(locale_placeholder: &str) -> String {
    format!(
        "SELECT s.canonical_name AS canonical_name,
                s.slug AS slug,
                COALESCE(bcn_loc.common_name, bcn_en.common_name, s.common_name) AS common_name,
                CASE WHEN bcn_loc.common_name IS NOT NULL
                     THEN (
                       SELECT scn.common_name
                       FROM species_common_names scn
                       WHERE scn.species_id = s.id
                         AND scn.language = {locale_placeholder}
                         AND scn.common_name != bcn_loc.common_name
                         AND scn.common_name != s.canonical_name
                       ORDER BY (scn.source = 'llm') DESC, scn.is_primary DESC, LENGTH(scn.common_name) ASC
                       LIMIT 1
                     )
                     ELSE NULL
                END AS common_name_2,
                CASE WHEN bcn_loc.common_name IS NULL THEN 1 ELSE 0 END AS is_name_fallback,
                s.family AS family,
                s.genus AS genus,
                s.height_max_m AS height_max_m,
                s.hardiness_zone_min AS hardiness_zone_min,
                s.hardiness_zone_max AS hardiness_zone_max,
                s.growth_rate AS growth_rate,
                s.stratum AS stratum,
                s.edibility_rating AS edibility_rating,
                s.medicinal_rating AS medicinal_rating,
                s.width_max_m AS width_max_m"
    )
}

pub(crate) fn species_list_common_name_join_sql(
    locale_placeholder: &str,
    fallback_locale_placeholder: &str,
) -> String {
    format!(
        "LEFT JOIN best_common_names bcn_loc \
             ON bcn_loc.species_id = s.id AND bcn_loc.language = {locale_placeholder} \
         LEFT JOIN best_common_names bcn_en \
             ON bcn_en.species_id = s.id AND bcn_en.language = {fallback_locale_placeholder}"
    )
}
