/// Encodes a browse cursor from the phase index, the phase's sort key (empty
/// for Canonical Name phases) and the canonical_name tiebreaker.
/// Format (base64 of): `<phase>\x00<sort_key>\x00<canonical_name>`
pub fn encode_cursor(phase: usize, sort_key: Option<&str>, canonical_name: &str) -> String {
    let raw = format!("{phase}\x00{}\x00{canonical_name}", sort_key.unwrap_or(""));
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, raw)
}

/// Decodes a browse cursor back into (phase, sort_key, canonical_name).
pub fn decode_cursor(cursor: &str) -> Option<(usize, Option<String>, String)> {
    let bytes =
        base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, cursor).ok()?;
    let s = String::from_utf8(bytes).ok()?;
    let mut parts = s.splitn(3, '\x00');
    let phase = parts.next()?.parse::<usize>().ok()?;
    let sort_key = parts.next()?;
    let canonical = parts.next()?.to_owned();
    let sort_key = (!sort_key.is_empty()).then(|| sort_key.to_owned());
    Some((phase, sort_key, canonical))
}
