pub fn updater_public_key() -> Option<&'static str> {
    let value = include_str!("../updater-public.key").trim();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
