use common_types::content::Topic;

#[tauri::command]
pub fn list_learning_topics(locale: String) -> Result<Vec<Topic>, String> {
    crate::services::content::list_learning_topics(locale)
}

#[cfg(test)]
mod tests {
    use super::list_learning_topics;

    #[test]
    fn command_delegates_to_content_service() {
        let topics = list_learning_topics("fr".to_string()).unwrap();
        assert!(topics.is_empty());
    }
}
