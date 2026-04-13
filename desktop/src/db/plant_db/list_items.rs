use common_types::species::SpeciesListItem;
use rusqlite::{Connection, OptionalExtension};

use super::lookup::{get_common_name, get_locale_best_common_name, get_secondary_common_name};

pub fn hydrate_species_list_items(
    conn: &Connection,
    canonical_names: &[String],
    locale: &str,
    all_favorites: bool,
) -> Result<Vec<SpeciesListItem>, String> {
    let mut items = Vec::with_capacity(canonical_names.len());

    for canonical_name in canonical_names {
        let row: Option<SpeciesListItem> = conn
            .query_row(
                "SELECT s.canonical_name,
                        s.slug,
                        s.common_name,
                        s.family,
                        s.genus,
                        s.height_max_m,
                        s.hardiness_zone_min,
                        s.hardiness_zone_max,
                        s.growth_rate,
                        s.stratum,
                        s.edibility_rating,
                        s.medicinal_rating,
                        s.width_max_m,
                        s.id
                 FROM species s
                 WHERE s.canonical_name = ?1
                 LIMIT 1",
                [canonical_name],
                |row| {
                    Ok((
                        SpeciesListItem {
                            canonical_name: row.get(0)?,
                            slug: row.get(1)?,
                            common_name: row.get(2)?,
                            common_name_2: None,
                            is_name_fallback: false,
                            family: row.get(3)?,
                            genus: row.get(4)?,
                            height_max_m: row.get(5)?,
                            hardiness_zone_min: row.get(6)?,
                            hardiness_zone_max: row.get(7)?,
                            growth_rate: row.get(8)?,
                            stratum: row.get(9)?,
                            edibility_rating: row.get(10)?,
                            medicinal_rating: row.get(11)?,
                            width_max_m: row.get(12)?,
                            is_favorite: all_favorites,
                        },
                        row.get::<_, String>(13)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to hydrate species '{canonical_name}': {e}"))?
            .map(|(mut item, species_id)| {
                if let Some(common_name) = get_locale_best_common_name(conn, &species_id, locale) {
                    item.common_name_2 = get_secondary_common_name(
                        conn,
                        &species_id,
                        locale,
                        &common_name,
                        &item.canonical_name,
                    );
                    item.common_name = Some(common_name);
                } else {
                    item.common_name = get_common_name(conn, &species_id, locale).or(item.common_name);
                    item.is_name_fallback = locale != "en";
                }
                item
            });

        if let Some(item) = row {
            items.push(item);
        }
    }

    Ok(items)
}
