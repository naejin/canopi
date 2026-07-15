const FTS_META_CHARS: &str = r#""()*+-^:\"#;

use crate::db::species_search_normalization::{
    is_admitted_species_search_token, normalize_species_search, normalized_species_search_sql,
};

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
    let normalized = normalize_species_search(text);
    let tokens = indexed_common_name_tokens(&normalized.tokens);
    if normalized.tokens.is_empty() {
        None
    } else {
        Some(CommonNameQuery {
            phrase: (normalized.tokens.len() > 1).then_some(normalized.text),
            tokens,
        })
    }
}

fn indexed_common_name_tokens(normalized_tokens: &[String]) -> Vec<String> {
    let mut tokens = Vec::new();
    for token in normalized_tokens {
        if is_admitted_species_search_token(token) && !tokens.contains(token) {
            tokens.push(token.clone());
        }
    }
    tokens
}

pub(super) fn normalized_common_name_sql(expr: &str) -> String {
    normalized_species_search_sql(expr)
}
