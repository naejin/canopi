use common_types::species::Relationship;
use rusqlite::Connection;

pub(super) fn read_projection(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<Relationship>, String> {
    let species_id = super::detail::resolve_species_id(conn, canonical_name)?
        .ok_or_else(|| format!("Species '{canonical_name}' not found"))?;

    super::detail::get_relationships(conn, &species_id)
}
