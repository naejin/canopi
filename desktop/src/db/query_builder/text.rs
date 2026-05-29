const FTS_META_CHARS: &str = r#""()*+-^:\"#;

#[derive(Debug, Clone)]
pub(super) struct SearchText {
    fts_term: Option<String>,
    common_name_query: Option<CommonNameQuery>,
}

impl SearchText {
    pub(super) fn from_raw(text: Option<&str>) -> Self {
        Self {
            fts_term: text.and_then(sanitize_fts_text),
            common_name_query: active_locale_common_name_query(text),
        }
    }

    pub(super) fn fts_term(&self) -> Option<&str> {
        self.fts_term.as_deref()
    }

    pub(super) fn has_fts_term(&self) -> bool {
        self.fts_term.is_some()
    }

    pub(super) fn common_name_query(&self) -> Option<&CommonNameQuery> {
        self.common_name_query.as_ref()
    }
}

#[derive(Debug, Clone)]
pub(super) struct CommonNameQuery {
    pub(super) phrase: Option<String>,
    pub(super) tokens: Vec<String>,
}

/// Sanitize text for FTS5 MATCH, returning `None` if nothing useful remains.
pub(crate) fn sanitize_fts_text(text: &str) -> Option<String> {
    let sanitized = text.replace(|c: char| FTS_META_CHARS.contains(c), "");
    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(format!("{trimmed}*"))
    }
}

fn active_locale_common_name_query(text: Option<&str>) -> Option<CommonNameQuery> {
    let sanitized = text?.replace(|c: char| FTS_META_CHARS.contains(c), " ");
    let raw_tokens = sanitized.split_whitespace().collect::<Vec<_>>();
    if raw_tokens.is_empty() {
        None
    } else {
        let mut tokens = Vec::new();
        for raw_token in &raw_tokens {
            let token = normalize_common_name_token(raw_token);
            if !tokens.contains(&token) {
                tokens.push(token);
            }
        }
        Some(CommonNameQuery {
            phrase: (raw_tokens.len() > 1).then(|| raw_tokens.join(" ").to_lowercase()),
            tokens,
        })
    }
}

fn normalize_common_name_token(raw: &str) -> String {
    let mut normalized = String::new();
    for ch in raw.chars() {
        match ch {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'À' | 'Á' | 'Â' | 'Ã' | 'Ä'
            | 'Å' | 'Ā' | 'Ă' | 'Ą' => normalized.push('a'),
            'ç' | 'ć' | 'č' | 'Ç' | 'Ć' | 'Č' => normalized.push('c'),
            'ď' | 'đ' | 'Ð' | 'Ď' | 'Đ' => normalized.push('d'),
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' | 'È' | 'É' | 'Ê' | 'Ë' | 'Ē' | 'Ė'
            | 'Ę' | 'Ě' => normalized.push('e'),
            'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' | 'İ' | 'Ì' | 'Í' | 'Î' | 'Ï' | 'Ī' | 'Į' => {
                normalized.push('i')
            }
            'ł' | 'Ł' => normalized.push('l'),
            'ñ' | 'ń' | 'ň' | 'Ñ' | 'Ń' | 'Ň' => normalized.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' | 'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ø'
            | 'Ō' | 'Ő' => normalized.push('o'),
            'ŕ' | 'ř' | 'Ŕ' | 'Ř' => normalized.push('r'),
            'ś' | 'š' | 'ş' | 'Ś' | 'Š' | 'Ş' => normalized.push('s'),
            'ť' | 'þ' | 'Þ' | 'Ť' => normalized.push('t'),
            'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' | 'ų' | 'Ù' | 'Ú' | 'Û' | 'Ü' | 'Ū' | 'Ů'
            | 'Ű' | 'Ų' => normalized.push('u'),
            'ý' | 'ÿ' | 'Ý' => normalized.push('y'),
            'ź' | 'ż' | 'ž' | 'Ź' | 'Ż' | 'Ž' => normalized.push('z'),
            'æ' | 'Æ' => normalized.push_str("ae"),
            'œ' | 'Œ' => normalized.push_str("oe"),
            _ => normalized.extend(ch.to_lowercase()),
        }
    }
    normalized
}
