use common_types::species::{PaginatedResult, SpeciesFilter, SpeciesListItem};

#[tauri::command]
pub fn search_species(
    _text: String,
    _filters: SpeciesFilter,
    _cursor: Option<String>,
    _limit: u32,
    _locale: String,
) -> Result<PaginatedResult<SpeciesListItem>, String> {
    // TODO: implement in Phase 1 with plant DB
    Ok(PaginatedResult {
        items: vec![],
        next_cursor: None,
        total_estimate: 0,
    })
}
