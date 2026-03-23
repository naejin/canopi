use common_types::design::CanopiFile;

#[tauri::command]
pub fn save_design(_path: Option<String>, _content: String) -> Result<String, String> {
    // TODO: implement in Phase 2
    Err("Not yet implemented".into())
}

#[tauri::command]
pub fn load_design(_path: String) -> Result<CanopiFile, String> {
    // TODO: implement in Phase 2
    Err("Not yet implemented".into())
}
