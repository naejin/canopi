use std::time::Duration;

pub fn build_get_request(
    url: &str,
    user_agent: &str,
    timeout: Duration,
) -> ureq::RequestBuilder<ureq::typestate::WithoutBody> {
    ureq::get(url)
        .header("User-Agent", user_agent)
        .config()
        .timeout_global(Some(timeout))
        .build()
}

pub fn read_limited_bytes(
    response: &mut ureq::http::Response<ureq::Body>,
    max_bytes: u64,
    label: &str,
) -> Result<Vec<u8>, String> {
    reject_if_content_length_exceeds_limit(response, max_bytes, label)?;
    response
        .body_mut()
        .with_config()
        .limit(max_bytes)
        .read_to_vec()
        .map_err(|e| format!("Failed to read {label}: {e}"))
}

pub fn read_limited_string(
    response: &mut ureq::http::Response<ureq::Body>,
    max_bytes: u64,
    label: &str,
) -> Result<String, String> {
    reject_if_content_length_exceeds_limit(response, max_bytes, label)?;
    response
        .body_mut()
        .with_config()
        .limit(max_bytes)
        .read_to_string()
        .map_err(|e| format!("Failed to read {label}: {e}"))
}

pub fn reject_if_content_length_exceeds_limit(
    response: &ureq::http::Response<ureq::Body>,
    max_bytes: u64,
    label: &str,
) -> Result<(), String> {
    if let Some(content_length) = response.headers().get("content-length")
        && let Some(length) = parse_content_length(content_length.to_str().ok())
        && length > max_bytes
    {
        return Err(format!(
            "{label} too large ({length} bytes, max {max_bytes})"
        ));
    }

    Ok(())
}

fn parse_content_length(value: Option<&str>) -> Option<u64> {
    value?.parse::<u64>().ok()
}

#[cfg(test)]
mod tests {
    use super::parse_content_length;

    #[test]
    fn parse_content_length_accepts_valid_numbers() {
        assert_eq!(parse_content_length(Some("42")), Some(42));
    }

    #[test]
    fn parse_content_length_rejects_invalid_values() {
        assert_eq!(parse_content_length(Some("abc")), None);
        assert_eq!(parse_content_length(None), None);
    }
}
