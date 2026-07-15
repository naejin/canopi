"""Versioned Species Search normalization shared by catalog builders."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import hashlib
import json
from pathlib import Path
import unicodedata
from typing import Any


AUTHORITY_PATH = (
    Path(__file__).resolve().parent.parent
    / "common-types/species-search-normalization.json"
)


class SpeciesSearchAdmission(str, Enum):
    BROWSE = "browse"
    TOO_SHORT = "too-short"
    ACTIVE_TEXT = "active-text"


@dataclass(frozen=True)
class SpeciesSearchNormalizationContract:
    version: int
    fingerprint: str
    case_folds: tuple[tuple[str, str], ...]
    minimum_admitted_scalar_count: int
    query_token_policy: str


@dataclass(frozen=True)
class NormalizedSpeciesSearch:
    text: str
    tokens: tuple[str, ...]
    scalar_count: int


def load_contract(
    *,
    root: Path | None = None,
) -> SpeciesSearchNormalizationContract:
    authority_path = (
        AUTHORITY_PATH
        if root is None
        else root / "common-types/species-search-normalization.json"
    )
    try:
        raw: Any = json.loads(authority_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(
            f"failed to read Species Search normalization authority {authority_path}: {error}"
        ) from error
    if not isinstance(raw, dict):
        raise RuntimeError("Species Search normalization authority root must be an object")

    expected_root_keys = {
        "contract_format_version",
        "normalization_version",
        "algorithm",
        "corpus",
    }
    missing_root_keys = sorted(expected_root_keys - raw.keys())
    unknown_root_keys = sorted(raw.keys() - expected_root_keys)
    if missing_root_keys:
        raise RuntimeError(
            f"root: missing required property {missing_root_keys[0]!r}"
        )
    if unknown_root_keys:
        raise RuntimeError(f"root: unknown property {unknown_root_keys[0]!r}")
    if raw["contract_format_version"] != 1:
        raise RuntimeError("contract_format_version must equal 1")

    version = raw.get("normalization_version")
    algorithm = raw.get("algorithm")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise RuntimeError("normalization_version must be a positive integer")
    if not isinstance(algorithm, dict):
        raise RuntimeError("algorithm must be an object")
    expected_algorithm_keys = {
        "compatibility_decomposition",
        "stripped_general_categories",
        "token_character_classes",
        "case_folds",
        "minimum_admitted_scalar_count",
        "query_token_policy",
    }
    missing_algorithm_keys = sorted(expected_algorithm_keys - algorithm.keys())
    unknown_algorithm_keys = sorted(algorithm.keys() - expected_algorithm_keys)
    if missing_algorithm_keys:
        raise RuntimeError(
            f"algorithm: missing required property {missing_algorithm_keys[0]!r}"
        )
    if unknown_algorithm_keys:
        raise RuntimeError(
            f"algorithm: unknown property {unknown_algorithm_keys[0]!r}"
        )
    expected_algorithm = {
        "compatibility_decomposition": "NFKD",
        "stripped_general_categories": ["Mn", "Mc", "Me"],
        "token_character_classes": ["Letter", "Number", "Underscore"],
        "query_token_policy": "unique-admitted-or-all-when-active",
    }
    for key, expected in expected_algorithm.items():
        if algorithm.get(key) != expected:
            raise RuntimeError(f"algorithm.{key} must equal {expected!r}")

    raw_case_folds = algorithm.get("case_folds")
    if not isinstance(raw_case_folds, list) or not raw_case_folds:
        raise RuntimeError("algorithm.case_folds must be a nonempty array")
    case_folds: list[tuple[str, str]] = []
    seen_sources: set[str] = set()
    for index, raw_case_fold in enumerate(raw_case_folds):
        if not isinstance(raw_case_fold, dict) or set(raw_case_fold) != {"from", "to"}:
            raise RuntimeError(
                f"algorithm.case_folds[{index}] must contain only 'from' and 'to'"
            )
        source = raw_case_fold["from"]
        target = raw_case_fold["to"]
        if not isinstance(source, str) or not source:
            raise RuntimeError(f"algorithm.case_folds[{index}].from must be nonempty text")
        if not isinstance(target, str) or not target:
            raise RuntimeError(f"algorithm.case_folds[{index}].to must be nonempty text")
        if source in seen_sources:
            raise RuntimeError(f"algorithm.case_folds has duplicate source {source!r}")
        seen_sources.add(source)
        case_folds.append((source, target))

    minimum = algorithm.get("minimum_admitted_scalar_count")
    if isinstance(minimum, bool) or not isinstance(minimum, int) or minimum < 1:
        raise RuntimeError(
            "algorithm.minimum_admitted_scalar_count must be a positive integer"
        )

    corpus = raw.get("corpus")
    if not isinstance(corpus, list) or not corpus:
        raise RuntimeError("corpus must be a nonempty array")
    expected_case_keys = {
        "name",
        "input",
        "normalized_text",
        "tokens",
        "query_tokens",
        "admission",
    }
    seen_case_names: set[str] = set()
    for index, case in enumerate(corpus):
        if not isinstance(case, dict):
            raise RuntimeError(f"corpus[{index}] must be an object")
        if set(case) != expected_case_keys:
            missing = sorted(expected_case_keys - case.keys())
            unknown = sorted(case.keys() - expected_case_keys)
            detail = (
                f"missing required property {missing[0]!r}"
                if missing
                else f"unknown property {unknown[0]!r}"
            )
            raise RuntimeError(f"corpus[{index}]: {detail}")
        name = case["name"]
        if not isinstance(name, str) or not name or name in seen_case_names:
            raise RuntimeError(f"corpus[{index}].name must be nonempty and unique")
        seen_case_names.add(name)
        if not isinstance(case["input"], str):
            raise RuntimeError(f"corpus[{index}].input must be text")
        if not isinstance(case["normalized_text"], str):
            raise RuntimeError(f"corpus[{index}].normalized_text must be text")
        if not isinstance(case["tokens"], list) or not all(
            isinstance(token, str) and token for token in case["tokens"]
        ):
            raise RuntimeError(
                f"corpus[{index}].tokens must be an array of nonempty text"
            )
        if not isinstance(case["query_tokens"], list) or not all(
            isinstance(token, str) and token for token in case["query_tokens"]
        ):
            raise RuntimeError(
                f"corpus[{index}].query_tokens must be an array of nonempty text"
            )
        if case["admission"] not in {admission.value for admission in SpeciesSearchAdmission}:
            raise RuntimeError(f"corpus[{index}].admission is unsupported")

    canonical = json.dumps(
        raw,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return SpeciesSearchNormalizationContract(
        version=version,
        fingerprint=hashlib.sha256(canonical).hexdigest(),
        case_folds=tuple(case_folds),
        minimum_admitted_scalar_count=minimum,
        query_token_policy=algorithm["query_token_policy"],
    )


CONTRACT = load_contract()


def normalize_species_search(raw: str) -> NormalizedSpeciesSearch:
    decomposed = unicodedata.normalize("NFKD", raw)
    folded = "".join(
        character.lower()
        for character in decomposed
        if not unicodedata.category(character).startswith("M")
    )
    for source, target in CONTRACT.case_folds:
        folded = folded.replace(source, target)

    tokens: list[str] = []
    token: list[str] = []
    for character in folded:
        if character == "_" or character.isalnum():
            token.append(character)
        elif token:
            tokens.append("".join(token))
            token.clear()
    if token:
        tokens.append("".join(token))

    return NormalizedSpeciesSearch(
        text=" ".join(tokens),
        tokens=tuple(tokens),
        scalar_count=sum(len(token) for token in tokens),
    )


def common_name_tokens(name: str) -> list[tuple[str, int]]:
    return [
        (token, index)
        for index, token in enumerate(normalize_species_search(name).tokens)
    ]


def normalize_search_name(name: str) -> str:
    return normalize_species_search(name).text


def normalize_search_token(token: str) -> str:
    return normalize_search_name(token)


def species_search_admission(raw: str) -> SpeciesSearchAdmission:
    scalar_count = normalize_species_search(raw).scalar_count
    if scalar_count == 0:
        return SpeciesSearchAdmission.BROWSE
    if scalar_count < CONTRACT.minimum_admitted_scalar_count:
        return SpeciesSearchAdmission.TOO_SHORT
    return SpeciesSearchAdmission.ACTIVE_TEXT


def species_search_query_tokens(raw: str) -> tuple[str, ...]:
    normalized = normalize_species_search(raw)
    if normalized.scalar_count < CONTRACT.minimum_admitted_scalar_count:
        return ()
    unique_tokens = tuple(dict.fromkeys(normalized.tokens))
    admitted_tokens = tuple(
        token
        for token in unique_tokens
        if len(token) >= CONTRACT.minimum_admitted_scalar_count
    )
    return admitted_tokens or unique_tokens
