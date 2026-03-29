/// Encodes a cursor from a sort value and the canonical_name tiebreaker.
/// Format (base64 of): `<sort_value>\x00<canonical_name>`
pub fn encode_cursor(sort_value: &str, canonical_name: &str) -> String {
    let raw = format!("{}\x00{}", sort_value, canonical_name);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, raw)
}

/// Decodes a cursor back into (sort_value, canonical_name).
pub fn decode_cursor(cursor: &str) -> Option<(String, String)> {
    let bytes =
        base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, cursor).ok()?;
    let s = String::from_utf8(bytes).ok()?;
    let mut parts = s.splitn(2, '\x00');
    let sort_val = parts.next()?.to_owned();
    let canonical = parts.next()?.to_owned();
    Some((sort_val, canonical))
}
