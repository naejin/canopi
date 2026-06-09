use std::collections::HashMap;

use common_types::species::CommonNameEntry;
use rusqlite::Connection;

pub(super) fn localized_name_for_species_id(
    conn: &Connection,
    species_id: &str,
    locale: &str,
) -> Option<String> {
    crate::db::plant_db::get_common_name(conn, species_id, locale)
}

pub(super) fn localized_names_for_canonical_names(
    conn: &Connection,
    canonical_names: &[String],
    locale: &str,
) -> Result<HashMap<String, String>, String> {
    crate::db::plant_db::get_common_names_batch(conn, canonical_names, locale)
}

pub(super) fn locale_common_names_for_canonical_name(
    conn: &Connection,
    canonical_name: &str,
    locale: &str,
) -> Result<Vec<CommonNameEntry>, String> {
    crate::db::plant_db::get_locale_common_names(conn, canonical_name, locale)
}
