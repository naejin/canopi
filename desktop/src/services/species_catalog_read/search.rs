use common_types::species::{PaginatedResult, SpeciesListItem, SpeciesSearchRequest};
use rusqlite::Connection;

pub(super) fn read_projection(
    conn: &Connection,
    request: SpeciesSearchRequest,
) -> Result<PaginatedResult<SpeciesListItem>, String> {
    crate::db::plant_db::search(conn, request)
}
