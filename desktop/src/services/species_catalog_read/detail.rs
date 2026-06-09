use common_types::species::SpeciesDetail;
use rusqlite::Connection;

pub(super) fn read_detail_projection(
    conn: &Connection,
    canonical_name: &str,
    locale: &str,
) -> Result<SpeciesDetail, String> {
    crate::db::plant_db::get_detail(conn, canonical_name, locale)
}

pub(super) fn read_detail_projections(
    conn: &Connection,
    canonical_names: &[String],
    locale: &str,
) -> Result<Vec<SpeciesDetail>, String> {
    let mut results = Vec::with_capacity(canonical_names.len());
    for name in canonical_names {
        if crate::db::plant_db::resolve_species_id(conn, name)?.is_none() {
            tracing::warn!("details_for_canonical_names: skipping missing species '{name}'");
            continue;
        }
        results.push(read_detail_projection(conn, name, locale)?);
    }
    Ok(results)
}
