use common_types::content::Topic;

#[tauri::command]
pub fn list_learning_topics(_locale: String) -> Result<Vec<Topic>, String> {
    // TODO: implement in Phase 5
    Ok(vec![])
}
