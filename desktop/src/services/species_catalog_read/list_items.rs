use common_types::species::SpeciesListItem;
use rusqlite::Connection;

pub(super) fn read_projection(
    conn: &Connection,
    canonical_names: &[String],
    locale: &str,
) -> Result<Vec<SpeciesListItem>, String> {
    crate::db::plant_db::hydrate_species_list_items(conn, canonical_names, locale, false)
}
