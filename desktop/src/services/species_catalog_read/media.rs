use common_types::species::{SpeciesExternalLink, SpeciesImage};
use rusqlite::Connection;

pub(super) fn read_images_projection(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<SpeciesImage>, String> {
    super::detail::get_species_images(conn, canonical_name)
}

pub(super) fn read_external_links_projection(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<SpeciesExternalLink>, String> {
    super::detail::get_species_external_links(conn, canonical_name)
}
