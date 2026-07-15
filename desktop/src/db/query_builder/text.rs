const FTS_META_CHARS: &str = r#""()*+-^:\"#;

use crate::db::species_search_normalization::{
    normalize_species_search, normalized_species_search_sql, species_search_query_tokens,
};

#[derive(Debug, Clone)]
pub(super) struct SearchText {
    fts_term: Option<String>,
    common_name_query: Option<CommonNameQuery>,
}

impl SearchText {
    pub(super) fn from_raw(text: Option<&str>) -> Self {
        let normalized = text.map(normalize_species_search);
        Self {
            fts_term: normalized.as_ref().and_then(sanitize_normalized_fts_text),
            common_name_query: normalized
                .as_ref()
                .and_then(active_locale_common_name_query),
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

fn sanitize_normalized_fts_text(
    normalized: &crate::db::species_search_normalization::NormalizedSpeciesSearch,
) -> Option<String> {
    let terms = species_search_query_tokens(normalized)
        .into_iter()
        .map(|term| {
            format!(
                "{}*",
                term.replace(|c: char| FTS_META_CHARS.contains(c), "")
            )
        })
        .filter(|term| term != "*")
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

fn active_locale_common_name_query(
    normalized: &crate::db::species_search_normalization::NormalizedSpeciesSearch,
) -> Option<CommonNameQuery> {
    let tokens = species_search_query_tokens(normalized);
    if tokens.is_empty() {
        None
    } else {
        Some(CommonNameQuery {
            phrase: (normalized.tokens.len() > 1).then_some(normalized.text.clone()),
            tokens,
        })
    }
}

pub(super) fn normalized_common_name_sql(expr: &str) -> String {
    normalized_species_search_sql(expr)
}
