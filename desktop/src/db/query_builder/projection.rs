use super::sql::SqlBuilder;
use super::text::{CommonNameQuery, normalized_common_name_sql};

pub(crate) fn species_list_select_sql(locale_placeholder: &str) -> String {
    species_list_select_sql_with_matched_common_name(locale_placeholder, "NULL")
}

pub(crate) fn species_list_select_sql_with_matched_common_name(
    locale_placeholder: &str,
    matched_common_name_sql: &str,
) -> String {
    let common_name_sql = display_common_name_sql(locale_placeholder);
    let common_name_2_sql = secondary_common_name_sql(locale_placeholder);

    format!(
        "SELECT s.canonical_name AS canonical_name,
                s.slug AS slug,
                {common_name_sql} AS common_name,
                {common_name_2_sql} AS common_name_2,
                {matched_common_name_sql} AS matched_common_name,
                0 AS is_name_fallback,
                s.family AS family,
                s.genus AS genus,
                s.height_max_m AS height_max_m,
                s.hardiness_zone_min AS hardiness_zone_min,
                s.hardiness_zone_max AS hardiness_zone_max,
                s.growth_rate AS growth_rate,
                s.stratum AS stratum,
                s.climate_zones AS climate_zones,
                s.is_annual AS is_annual,
                s.is_biennial AS is_biennial,
                s.is_perennial AS is_perennial,
                s.edibility_rating AS edibility_rating,
                s.medicinal_rating AS medicinal_rating,
                s.width_max_m AS width_max_m"
    )
}

pub(crate) fn species_list_matched_common_name_sql(
    query: Option<&CommonNameQuery>,
    locale_placeholder: &str,
    sql_builder: &mut SqlBuilder,
) -> String {
    let Some(query) = query else {
        return "NULL".to_owned();
    };
    if query.tokens.is_empty() {
        return "NULL".to_owned();
    }

    let common_name_sql = display_common_name_sql(locale_placeholder);
    let normalized_candidate = normalized_common_name_sql("scn_match.common_name");
    let normalized_display_name = normalized_common_name_sql(&common_name_sql);
    let query_text = query.tokens.join(" ");
    let exact_placeholder = sql_builder.bind_text(query_text.clone());
    let prefix_placeholder = sql_builder.bind_text(format!("{query_text}%"));
    let token_conditions =
        common_name_token_prefix_conditions(&normalized_candidate, query, sql_builder);
    let display_token_conditions =
        common_name_token_prefix_conditions(&normalized_display_name, query, sql_builder);

    format!(
        "(
            SELECT scn_match.common_name
            FROM species_common_names scn_match
            WHERE scn_match.species_id = s.id
              AND scn_match.language = {locale_placeholder}
              AND scn_match.common_name != s.canonical_name
              AND ({common_name_sql} IS NULL OR scn_match.common_name != {common_name_sql})
              AND ({common_name_sql} IS NULL OR NOT ({display_token_conditions}))
              AND {token_conditions}
            ORDER BY
              CASE
                WHEN {normalized_candidate} = {exact_placeholder} THEN 0
                WHEN {normalized_candidate} LIKE {prefix_placeholder} THEN 1
                ELSE 2
              END,
              scn_match.is_primary DESC,
              LENGTH(scn_match.common_name) ASC,
              scn_match.common_name
            LIMIT 1
        )"
    )
}

fn common_name_token_prefix_conditions(
    normalized_name_sql: &str,
    query: &CommonNameQuery,
    sql_builder: &mut SqlBuilder,
) -> String {
    query
        .tokens
        .iter()
        .map(|token| {
            let starts_placeholder = sql_builder.bind_text(format!("{token}%"));
            let word_starts_placeholder = sql_builder.bind_text(format!("% {token}%"));
            format!(
                "({normalized_name_sql} LIKE {starts_placeholder}
                  OR {normalized_name_sql} LIKE {word_starts_placeholder})"
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

pub(crate) fn species_list_common_name_join_sql(locale_placeholder: &str) -> String {
    format!(
        "LEFT JOIN best_common_names bcn_loc \
             ON bcn_loc.species_id = s.id AND bcn_loc.language = {locale_placeholder}"
    )
}

fn display_common_name_sql(locale_placeholder: &str) -> String {
    format!(
        "COALESCE(
            bcn_loc.common_name,
            (
              SELECT scn_primary.common_name
              FROM species_common_names scn_primary
              WHERE scn_primary.species_id = s.id
                AND scn_primary.language = {locale_placeholder}
                AND scn_primary.is_primary = 1
              ORDER BY LENGTH(scn_primary.common_name) ASC
              LIMIT 1
            ),
            CASE WHEN {locale_placeholder} = 'en' THEN s.common_name ELSE NULL END
        )"
    )
}

fn secondary_common_name_sql(locale_placeholder: &str) -> String {
    format!(
        "CASE WHEN bcn_loc.common_name IS NOT NULL
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
        END"
    )
}
