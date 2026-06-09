use common_types::species::FlowerColorResolution;
use rusqlite::Connection;

pub(super) fn read_projection(
    conn: &Connection,
    canonical_names: &[String],
) -> Result<Vec<FlowerColorResolution>, String> {
    crate::db::plant_db::get_flower_color_batch(conn, canonical_names)
}
