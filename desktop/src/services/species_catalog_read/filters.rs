use common_types::species::{DynamicFilterOptions, FilterOptions};
use rusqlite::Connection;

pub(super) fn read_filter_options(conn: &Connection) -> Result<FilterOptions, String> {
    crate::db::plant_db::get_filter_options(conn)
}

pub(super) fn read_dynamic_filter_options(
    conn: &Connection,
    fields: &[String],
    locale: &str,
) -> Result<Vec<DynamicFilterOptions>, String> {
    crate::db::plant_db::get_dynamic_filter_options(conn, fields, locale)
}
