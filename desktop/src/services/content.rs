use common_types::content::Topic;

pub fn list_learning_topics(_locale: String) -> Result<Vec<Topic>, String> {
    // TODO: implement in Phase 5
    Ok(vec![])
}

#[cfg(test)]
mod tests {
    use super::list_learning_topics;

    #[test]
    fn returns_empty_catalog_for_now() {
        let topics = list_learning_topics("en".to_string()).unwrap();
        assert!(topics.is_empty());
    }
}
