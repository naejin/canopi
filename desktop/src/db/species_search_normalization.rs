use rusqlite::{Connection, functions::FunctionFlags};
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::OnceLock;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

const CONTRACT_SOURCE: &str =
    include_str!("../../../common-types/species-search-normalization.json");
const SQLITE_FUNCTION_NAME: &str = "canopi_normalize_species_search";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NormalizationContract {
    contract_format_version: u32,
    normalization_version: u32,
    algorithm: NormalizationAlgorithm,
    corpus: Vec<CorpusCase>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NormalizationAlgorithm {
    compatibility_decomposition: String,
    stripped_general_categories: Vec<String>,
    token_character_classes: Vec<String>,
    case_folds: Vec<CaseFold>,
    minimum_admitted_scalar_count: usize,
    query_token_policy: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CaseFold {
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CorpusCase {
    name: String,
    input: String,
    normalized_text: String,
    tokens: Vec<String>,
    query_tokens: Vec<String>,
    admission: String,
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
        let contract = parse_contract(CONTRACT_SOURCE)
            .expect("authored Species Search normalization contract must be valid");
        assert_eq!(
            contract.normalization_version,
            crate::db::schema_contract::SPECIES_SEARCH_NORMALIZATION_VERSION,
            "storage and Species Search normalization versions must match"
        );
        contract
    })
}

fn parse_contract(source: &str) -> Result<NormalizationContract, String> {
    let contract: NormalizationContract =
        serde_json::from_str(source).map_err(|error| error.to_string())?;
    if contract.contract_format_version != 1 {
        return Err("contract format version must equal 1".to_owned());
    }
    if contract.normalization_version == 0 {
        return Err("normalization version must be positive".to_owned());
    }
    if contract.algorithm.compatibility_decomposition != "NFKD"
        || contract.algorithm.stripped_general_categories != ["Mn", "Mc", "Me"]
        || contract.algorithm.token_character_classes != ["Letter", "Number", "Underscore"]
        || contract.algorithm.minimum_admitted_scalar_count == 0
        || contract.algorithm.query_token_policy != "unique-admitted-or-all-when-active"
    {
        return Err("normalization algorithm uses unsupported semantics".to_owned());
    }
    let mut fold_sources = HashSet::new();
    for case_fold in &contract.algorithm.case_folds {
        if case_fold.from.is_empty()
            || case_fold.to.is_empty()
            || !fold_sources.insert(case_fold.from.as_str())
        {
            return Err("case-fold sources must be nonempty and unique".to_owned());
        }
    }
    let mut corpus_names = HashSet::new();
    for case in &contract.corpus {
        if case.name.is_empty()
            || !corpus_names.insert(case.name.as_str())
            || case.tokens.iter().any(String::is_empty)
            || case.query_tokens.iter().any(String::is_empty)
            || !matches!(
                case.admission.as_str(),
                "browse" | "too-short" | "active-text"
            )
        {
            return Err("normalization corpus is malformed".to_owned());
        }
        let _semantic_case_fields = (&case.input, &case.normalized_text);
    }
    if contract.corpus.is_empty() {
        return Err("normalization corpus must not be empty".to_owned());
    }
    Ok(contract)
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

pub(crate) fn species_search_query_tokens(normalized: &NormalizedSpeciesSearch) -> Vec<String> {
    let minimum = contract().algorithm.minimum_admitted_scalar_count;
    if normalized.scalar_count < minimum {
        return Vec::new();
    }
    let mut unique_tokens = Vec::new();
    for token in &normalized.tokens {
        if !unique_tokens.contains(token) {
            unique_tokens.push(token.clone());
        }
    }
    let admitted_tokens = unique_tokens
        .iter()
        .filter(|token| token.chars().count() >= minimum)
        .cloned()
        .collect::<Vec<_>>();
    if admitted_tokens.is_empty() {
        unique_tokens
    } else {
        admitted_tokens
    }
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
    use sha2::{Digest, Sha256};

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
        query_tokens: Vec<String>,
        admission: String,
    }

    #[test]
    fn authored_corpus_matches_rust_normalization_and_admission() {
        let corpus: CorpusContract = serde_json::from_str(CONTRACT_SOURCE).unwrap();

        for case in corpus.corpus {
            let normalized = normalize_species_search(&case.input);
            assert_eq!(normalized.text, case.normalized_text, "{} text", case.name);
            assert_eq!(normalized.tokens, case.tokens, "{} tokens", case.name);
            assert_eq!(
                species_search_query_tokens(&normalized),
                case.query_tokens,
                "{} query tokens",
                case.name
            );

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

    #[test]
    fn runtime_authority_parser_rejects_unknown_semantic_fields() {
        let mut raw: serde_json::Value = serde_json::from_str(CONTRACT_SOURCE).unwrap();
        raw["algorithm"]["accidental_new_rule"] = serde_json::json!(true);

        let error = parse_contract(&serde_json::to_string(&raw).unwrap()).unwrap_err();

        assert!(
            error.contains("unknown field `accidental_new_rule`"),
            "{error}"
        );
    }

    #[test]
    fn rust_and_python_compilers_fingerprint_the_same_canonical_json() {
        let raw: serde_json::Value = serde_json::from_str(CONTRACT_SOURCE).unwrap();
        let rust_fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(&raw).unwrap()));

        assert_eq!(
            rust_fingerprint,
            crate::db::schema_contract::SPECIES_SEARCH_NORMALIZATION_FINGERPRINT
        );
    }
}
