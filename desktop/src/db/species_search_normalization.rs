use rusqlite::{Connection, functions::FunctionFlags};
use serde::Deserialize;
use std::sync::OnceLock;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

const CONTRACT_SOURCE: &str =
    include_str!("../../../common-types/species-search-normalization.json");
const SQLITE_FUNCTION_NAME: &str = "canopi_normalize_species_search";

#[derive(Debug, Deserialize)]
struct NormalizationContract {
    algorithm: NormalizationAlgorithm,
}

#[derive(Debug, Deserialize)]
struct NormalizationAlgorithm {
    case_folds: Vec<CaseFold>,
    minimum_admitted_scalar_count: usize,
}

#[derive(Debug, Deserialize)]
struct CaseFold {
    from: String,
    to: String,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct NormalizedSpeciesSearch {
    pub(crate) text: String,
    pub(crate) tokens: Vec<String>,
    pub(crate) scalar_count: usize,
}

#[derive(Debug, Eq, PartialEq)]
#[cfg(test)]
pub(crate) enum SpeciesSearchAdmission {
    Browse,
    TooShort,
    ActiveText,
}

fn contract() -> &'static NormalizationContract {
    static CONTRACT: OnceLock<NormalizationContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(CONTRACT_SOURCE)
            .expect("authored Species Search normalization contract must be valid")
    })
}

pub(crate) fn normalize_species_search(raw: &str) -> NormalizedSpeciesSearch {
    let mut folded = raw
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(char::to_lowercase)
        .collect::<String>();
    for replacement in &contract().algorithm.case_folds {
        folded = folded.replace(&replacement.from, &replacement.to);
    }

    let mut tokens = Vec::new();
    let mut token = String::new();
    for character in folded.chars() {
        if character == '_' || character.is_alphanumeric() {
            token.push(character);
        } else if !token.is_empty() {
            tokens.push(std::mem::take(&mut token));
        }
    }
    if !token.is_empty() {
        tokens.push(token);
    }

    let scalar_count = tokens.iter().map(|token| token.chars().count()).sum();
    NormalizedSpeciesSearch {
        text: tokens.join(" "),
        tokens,
        scalar_count,
    }
}

pub(crate) fn is_admitted_species_search_token(token: &str) -> bool {
    token.chars().count() >= contract().algorithm.minimum_admitted_scalar_count
}

#[cfg(test)]
pub(crate) fn species_search_admission(raw: &str) -> SpeciesSearchAdmission {
    match normalize_species_search(raw).scalar_count {
        0 => SpeciesSearchAdmission::Browse,
        count if count < contract().algorithm.minimum_admitted_scalar_count => {
            SpeciesSearchAdmission::TooShort
        }
        _ => SpeciesSearchAdmission::ActiveText,
    }
}

pub(crate) fn register_sqlite_function(connection: &Connection) -> rusqlite::Result<()> {
    connection.create_scalar_function(
        SQLITE_FUNCTION_NAME,
        1,
        FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS,
        |context| {
            let raw = context.get::<Option<String>>(0)?;
            Ok(raw.map(|value| normalize_species_search(&value).text))
        },
    )
}

pub(crate) fn normalized_species_search_sql(expression: &str) -> String {
    format!("{SQLITE_FUNCTION_NAME}({expression})")
}
