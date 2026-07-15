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


@dataclass(frozen=True)
class NormalizedSpeciesSearch:
    text: str
    tokens: tuple[str, ...]
    scalar_count: int


def _load_contract() -> SpeciesSearchNormalizationContract:
    try:
        raw: Any = json.loads(AUTHORITY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(
            f"failed to read Species Search normalization authority {AUTHORITY_PATH}: {error}"
        ) from error
    if not isinstance(raw, dict):
        raise RuntimeError("Species Search normalization authority root must be an object")

    version = raw.get("normalization_version")
    algorithm = raw.get("algorithm")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise RuntimeError("normalization_version must be a positive integer")
    if not isinstance(algorithm, dict):
        raise RuntimeError("algorithm must be an object")
    expected_algorithm = {
        "compatibility_decomposition": "NFKD",
        "stripped_general_categories": ["Mn", "Mc", "Me"],
        "token_character_classes": ["Letter", "Number", "Underscore"],
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
    )


CONTRACT = _load_contract()


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
