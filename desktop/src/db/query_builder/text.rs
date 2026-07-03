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
    let terms = sanitized
        .split_whitespace()
        .map(|term| format!("{term}*"))
        .collect::<Vec<_>>();
    if terms.is_empty() {
        None
    } else {
        Some(format!(
            "{{canonical_name family_genus uses_text other_text}}: {}",
            terms.join(" ")
        ))
    }
}

fn active_locale_common_name_query(text: Option<&str>) -> Option<CommonNameQuery> {
    let text = text?;
    let sanitized = text.replace(|c: char| FTS_META_CHARS.contains(c), " ");
    let raw_tokens = sanitized.split_whitespace().collect::<Vec<_>>();
    let tokens = indexed_common_name_tokens(text);
    if raw_tokens.is_empty() && tokens.is_empty() {
        None
    } else {
        Some(CommonNameQuery {
            phrase: (raw_tokens.len() > 1).then(|| raw_tokens.join(" ").to_lowercase()),
            tokens,
        })
    }
}

fn indexed_common_name_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut raw_token = String::new();

    for ch in text.chars() {
        if ch == '_' || ch.is_alphanumeric() {
            raw_token.push(ch);
        } else if !raw_token.is_empty() {
            push_indexed_common_name_token(&mut tokens, &raw_token);
            raw_token.clear();
        }
    }

    if !raw_token.is_empty() {
        push_indexed_common_name_token(&mut tokens, &raw_token);
    }

    tokens
}

fn push_indexed_common_name_token(tokens: &mut Vec<String>, raw_token: &str) {
    let token = normalize_common_name_token(raw_token);
    if token.chars().count() >= 2 && !tokens.contains(&token) {
        tokens.push(token);
    }
}

fn normalize_common_name_token(raw: &str) -> String {
    let mut normalized = String::new();
    for ch in raw.chars() {
        match ch {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'À' | 'Á' | 'Â' | 'Ã' | 'Ä'
            | 'Å' | 'Ā' | 'Ă' | 'Ą' => normalized.push('a'),
            'ç' | 'ć' | 'č' | 'Ç' | 'Ć' | 'Č' => normalized.push('c'),
            'ď' | 'Ď' => normalized.push('d'),
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' | 'È' | 'É' | 'Ê' | 'Ë' | 'Ē' | 'Ė'
            | 'Ę' | 'Ě' => normalized.push('e'),
            'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' | 'İ' | 'Ì' | 'Í' | 'Î' | 'Ï' | 'Ī' | 'Į' => {
                normalized.push('i')
            }
            'ñ' | 'ń' | 'ň' | 'Ñ' | 'Ń' | 'Ň' => normalized.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ō' | 'ő' | 'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ō' | 'Ő' => {
                normalized.push('o')
            }
            'ŕ' | 'ř' | 'Ŕ' | 'Ř' => normalized.push('r'),
            'ś' | 'š' | 'ş' | 'Ś' | 'Š' | 'Ş' => normalized.push('s'),
            'ť' | 'Ť' => normalized.push('t'),
            'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' | 'ų' | 'Ù' | 'Ú' | 'Û' | 'Ü' | 'Ū' | 'Ů'
            | 'Ű' | 'Ų' => normalized.push('u'),
            'ý' | 'ÿ' | 'Ý' => normalized.push('y'),
            'ź' | 'ż' | 'ž' | 'Ź' | 'Ż' | 'Ž' => normalized.push('z'),
            'ß' | 'ẞ' => normalized.push_str("ss"),
            'ﬀ' => normalized.push_str("ff"),
            'ﬁ' => normalized.push_str("fi"),
            'ﬂ' => normalized.push_str("fl"),
            'ﬃ' => normalized.push_str("ffi"),
            'ﬄ' => normalized.push_str("ffl"),
            'ﬅ' | 'ﬆ' => normalized.push_str("st"),
            _ => normalized.extend(ch.to_lowercase()),
        }
    }
    normalized
}

pub(super) fn normalized_common_name_sql(expr: &str) -> String {
    let mut sql = format!("lower({expr})");
    for (from, to) in [
        ("à", "a"),
        ("á", "a"),
        ("â", "a"),
        ("ã", "a"),
        ("ä", "a"),
        ("å", "a"),
        ("ā", "a"),
        ("ă", "a"),
        ("ą", "a"),
        ("À", "a"),
        ("Á", "a"),
        ("Â", "a"),
        ("Ã", "a"),
        ("Ä", "a"),
        ("Å", "a"),
        ("Ā", "a"),
        ("Ă", "a"),
        ("Ą", "a"),
        ("ç", "c"),
        ("ć", "c"),
        ("č", "c"),
        ("Ç", "c"),
        ("Ć", "c"),
        ("Č", "c"),
        ("è", "e"),
        ("é", "e"),
        ("ê", "e"),
        ("ë", "e"),
        ("ē", "e"),
        ("ė", "e"),
        ("ę", "e"),
        ("ě", "e"),
        ("È", "e"),
        ("É", "e"),
        ("Ê", "e"),
        ("Ë", "e"),
        ("Ē", "e"),
        ("Ė", "e"),
        ("Ę", "e"),
        ("Ě", "e"),
        ("ì", "i"),
        ("í", "i"),
        ("î", "i"),
        ("ï", "i"),
        ("ī", "i"),
        ("į", "i"),
        ("İ", "i"),
        ("Ì", "i"),
        ("Í", "i"),
        ("Î", "i"),
        ("Ï", "i"),
        ("Ī", "i"),
        ("Į", "i"),
        ("ñ", "n"),
        ("ń", "n"),
        ("ň", "n"),
        ("Ñ", "n"),
        ("Ń", "n"),
        ("Ň", "n"),
        ("ò", "o"),
        ("ó", "o"),
        ("ô", "o"),
        ("õ", "o"),
        ("ö", "o"),
        ("ō", "o"),
        ("ő", "o"),
        ("Ò", "o"),
        ("Ó", "o"),
        ("Ô", "o"),
        ("Õ", "o"),
        ("Ö", "o"),
        ("Ō", "o"),
        ("Ő", "o"),
        ("ù", "u"),
        ("ú", "u"),
        ("û", "u"),
        ("ü", "u"),
        ("ū", "u"),
        ("ů", "u"),
        ("ű", "u"),
        ("ų", "u"),
        ("Ù", "u"),
        ("Ú", "u"),
        ("Û", "u"),
        ("Ü", "u"),
        ("Ū", "u"),
        ("Ů", "u"),
        ("Ű", "u"),
        ("Ų", "u"),
        ("ý", "y"),
        ("ÿ", "y"),
        ("Ý", "y"),
    ] {
        sql = format!("replace({sql}, '{from}', '{to}')");
    }
    sql
}
