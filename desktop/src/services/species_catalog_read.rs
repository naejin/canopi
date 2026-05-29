use std::collections::HashMap;

use rusqlite::Connection;

pub(crate) struct SpeciesCatalogRead<'conn> {
    conn: &'conn Connection,
}

impl<'conn> SpeciesCatalogRead<'conn> {
    pub(crate) fn new(conn: &'conn Connection) -> Self {
        Self { conn }
    }

    pub(crate) fn common_name_for_species_id(
        &self,
        species_id: &str,
        locale: &str,
    ) -> Option<String> {
        crate::db::plant_db::get_common_name(self.conn, species_id, locale)
    }

    pub(crate) fn common_names_for_canonical_names(
        &self,
        canonical_names: &[String],
        locale: &str,
    ) -> Result<HashMap<String, String>, String> {
        crate::db::plant_db::get_common_names_batch(self.conn, canonical_names, locale)
    }
}
