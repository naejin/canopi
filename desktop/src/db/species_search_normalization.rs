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

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct CorpusContract {
        corpus: Vec<CorpusCase>,
    }

    #[derive(Deserialize)]
    struct CorpusCase {
        name: String,
        input: String,
        normalized_text: String,
        tokens: Vec<String>,
        admission: String,
    }

    #[test]
    fn authored_corpus_matches_rust_normalization_and_admission() {
        let corpus: CorpusContract = serde_json::from_str(CONTRACT_SOURCE).unwrap();

        for case in corpus.corpus {
            let normalized = normalize_species_search(&case.input);
            assert_eq!(normalized.text, case.normalized_text, "{} text", case.name);
            assert_eq!(normalized.tokens, case.tokens, "{} tokens", case.name);

            let admission = match case.admission.as_str() {
                "browse" => SpeciesSearchAdmission::Browse,
                "too-short" => SpeciesSearchAdmission::TooShort,
                "active-text" => SpeciesSearchAdmission::ActiveText,
                unexpected => panic!("unexpected corpus admission {unexpected:?}"),
            };
            assert_eq!(
                species_search_admission(&case.input),
                admission,
                "{} admission",
                case.name
            );
        }
    }

    #[test]
    fn sqlite_normalization_function_uses_the_same_authority() {
        let connection = Connection::open_in_memory().unwrap();
        register_sqlite_function(&connection).unwrap();

        let normalized: Option<String> = connection
            .query_row(
                "SELECT canopi_normalize_species_search(?1)",
                [Some("Σίσυφος Straße")],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(normalized.as_deref(), Some("σισυφοσ strasse"));

        let normalized_null: Option<String> = connection
            .query_row("SELECT canopi_normalize_species_search(NULL)", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(normalized_null, None);
    }
}
