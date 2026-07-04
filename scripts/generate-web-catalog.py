#!/usr/bin/env python3
"""Generate reduced Web Edition Species Catalog assets.

The output is newline-delimited JSON that DuckDB-WASM can load with
read_ndjson_auto(). Keeping generation in the Python standard library avoids a
native DuckDB dependency in the repository while still producing DuckDB-loadable
static assets for the browser adapter.
"""

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import unicodedata
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_EXPORTS_DIR = Path.home() / "projects/canopi-data/data/exports"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "desktop/web/public/canopi-catalog"

UI_LOCALES = ["en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"]
CLOUDFLARE_PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024
MIN_EXPORT_SCHEMA_VERSION = 11

SPECIES_FIELDS = [
    "id",
    "slug",
    "canonical_name",
    "common_name",
    "climate_zones",
    "habit",
    "growth_form",
    "life_cycles",
]
NAME_FIELDS = ["species_id", "language", "common_name", "normalized_name", "is_primary"]
IMAGE_FIELDS = ["species_id", "url", "source", "source_page_url", "credit", "license"]
EXCLUDED_DETAIL_FIELDS = [
    "edibility",
    "hardiness",
    "height",
    "stratum",
    "soil",
    "ecology",
    "propagation",
    "risk",
    "taxonomy",
]


class AssetSizeError(RuntimeError):
    pass


def generate_web_catalog(
    export_path: Path | None = None,
    output_dir: Path | None = None,
    *,
    species_shard_count: int = 24,
    image_shard_count: int = 12,
    max_asset_bytes: int = CLOUDFLARE_PAGES_MAX_ASSET_BYTES,
) -> dict[str, Any]:
    export_path = export_path or find_latest_export(DEFAULT_EXPORTS_DIR)
    output_dir = output_dir or DEFAULT_OUTPUT_DIR
    if species_shard_count < 1 or image_shard_count < 1:
        raise ValueError("Shard counts must be positive.")

    conn = sqlite3.connect(export_path)
    conn.row_factory = sqlite3.Row
    try:
        export_schema_version = validate_export_schema(conn)
        prepare_output_dir(output_dir)
        climate_zones = load_climate_zones(conn)

        species_assets = write_species_assets(
            conn,
            output_dir,
            climate_zones,
            shard_count=species_shard_count,
        )
        name_assets = write_name_assets(conn, output_dir)
        image_assets = write_image_assets(
            conn,
            output_dir,
            shard_count=image_shard_count,
        )

        manifest = build_manifest(
            output_dir=output_dir,
            export_path=export_path,
            export_schema_version=export_schema_version,
            species_assets=species_assets,
            name_assets=name_assets,
            image_assets=image_assets,
            max_asset_bytes=max_asset_bytes,
        )
        write_json(output_dir / "manifest.json", manifest)
        assert_asset_sizes(output_dir, max_asset_bytes=max_asset_bytes)
        return manifest
    finally:
        conn.close()


def find_latest_export(exports_dir: Path) -> Path:
    db_files = sorted(exports_dir.glob("canopi-export-*.db"), reverse=True)
    if not db_files:
        raise FileNotFoundError(f"No canopi-export-*.db files found in {exports_dir}")
    return db_files[0]


def validate_export_schema(conn: sqlite3.Connection) -> int | None:
    if not table_exists(conn, "_metadata"):
        return None
    row = conn.execute("SELECT value FROM _metadata WHERE key = 'schema_version'").fetchone()
    if row is None:
        return None
    version = int(row["value"])
    if version < MIN_EXPORT_SCHEMA_VERSION:
        raise RuntimeError(
            f"Export schema version {version} is below minimum {MIN_EXPORT_SCHEMA_VERSION}."
        )
    return version


def prepare_output_dir(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for child in ["species", "names", "images"]:
        shutil.rmtree(output_dir / child, ignore_errors=True)
    manifest = output_dir / "manifest.json"
    if manifest.exists():
        manifest.unlink()


def write_species_assets(
    conn: sqlite3.Connection,
    output_dir: Path,
    climate_zones: dict[str, list[str]],
    *,
    shard_count: int,
) -> list[dict[str, Any]]:
    species_dir = output_dir / "species"
    species_dir.mkdir(parents=True, exist_ok=True)
    files = open_shard_files(species_dir, "species", shard_count)
    species_columns = table_columns(conn, "species")
    select_columns = [
        "id",
        "slug",
        "canonical_name",
        "common_name",
        "habit",
        "growth_form_type",
        "growth_form_shape",
        "growth_habit",
        "is_annual",
        "is_biennial",
        "is_perennial",
        "climate_zones",
    ]
    select_sql = ", ".join(select_expr(species_columns, column) for column in select_columns)
    try:
        rows = conn.execute(
            f"""
            SELECT {select_sql}
            FROM species
            ORDER BY canonical_name, id
            """
        )
        for row in rows:
            species_id = row["id"]
            payload = {
                "id": species_id,
                "slug": row["slug"],
                "canonical_name": row["canonical_name"],
                "common_name": row["common_name"],
                "climate_zones": climate_zones.get(species_id) or parse_list_field(row["climate_zones"]),
                "habit": row["habit"],
                "growth_form": first_present(
                    row["growth_form_type"],
                    row["growth_form_shape"],
                    row["growth_habit"],
                ),
                "life_cycles": life_cycles_from_flags(
                    row["is_annual"],
                    row["is_biennial"],
                    row["is_perennial"],
                ),
            }
            write_jsonl(files[shard_index(species_id, shard_count)], payload)
    finally:
        close_files(files)
    return asset_entries(output_dir, species_dir.glob("*.jsonl"))


def write_name_assets(conn: sqlite3.Connection, output_dir: Path) -> dict[str, dict[str, Any]]:
    names_dir = output_dir / "names"
    names_dir.mkdir(parents=True, exist_ok=True)
    assets: dict[str, dict[str, Any]] = {}
    has_common_names = table_exists(conn, "species_common_names")
    for locale in UI_LOCALES:
        path = names_dir / f"names-{locale}.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            if has_common_names:
                rows = conn.execute(
                    """
                    SELECT scn.species_id, scn.language, scn.common_name,
                           COALESCE(scn.is_primary, 0) AS is_primary
                    FROM species_common_names scn
                    JOIN species s ON s.id = scn.species_id
                    WHERE scn.language = ?
                      AND scn.common_name != s.canonical_name
                    ORDER BY scn.species_id, scn.is_primary DESC,
                             LENGTH(scn.common_name), scn.common_name
                    """,
                    (locale,),
                )
                for row in rows:
                    normalized_name = normalize_search_name(row["common_name"] or "")
                    if not normalized_name:
                        continue
                    write_jsonl(handle, {
                        "species_id": row["species_id"],
                        "language": row["language"],
                        "common_name": row["common_name"],
                        "normalized_name": normalized_name,
                        "is_primary": bool(row["is_primary"]),
                    })
        assets[locale] = asset_entry(output_dir, path)
    return assets


def write_image_assets(
    conn: sqlite3.Connection,
    output_dir: Path,
    *,
    shard_count: int,
) -> list[dict[str, Any]]:
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    files = open_shard_files(images_dir, "images", shard_count)
    species_with_images: set[str] = set()
    try:
        if table_exists(conn, "species_images"):
            rows = conn.execute(
                """
                SELECT species_id, url, source
                FROM species_images
                WHERE url IS NOT NULL AND url != ''
                ORDER BY species_id, sort_order, id
                """
            )
            for row in rows:
                species_id = row["species_id"]
                if species_id in species_with_images:
                    continue
                species_with_images.add(species_id)
                write_image_row(files, species_id, row["url"], row["source"], shard_count)

        species_columns = table_columns(conn, "species")
        if "image_urls" in species_columns:
            rows = conn.execute(
                """
                SELECT id, image_urls
                FROM species
                WHERE image_urls IS NOT NULL AND image_urls != ''
                ORDER BY id
                """
            )
            for row in rows:
                species_id = row["id"]
                if species_id in species_with_images:
                    continue
                urls = parse_list_field(row["image_urls"])
                if not urls:
                    continue
                species_with_images.add(species_id)
                write_image_row(files, species_id, urls[0], "species.image_urls", shard_count)
    finally:
        close_files(files)
    return asset_entries(output_dir, images_dir.glob("*.jsonl"))


def write_image_row(
    files: list[Any],
    species_id: str,
    url: str,
    source: str | None,
    shard_count: int,
) -> None:
    write_jsonl(files[shard_index(species_id, shard_count)], {
        "species_id": species_id,
        "url": url,
        "source": source,
        "source_page_url": None,
        "credit": None,
        "license": None,
    })


def load_climate_zones(conn: sqlite3.Connection) -> dict[str, list[str]]:
    if not table_exists(conn, "species_climate_zones"):
        return {}
    zones: dict[str, set[str]] = {}
    rows = conn.execute(
        """
        SELECT species_id, climate_zone
        FROM species_climate_zones
        WHERE climate_zone IS NOT NULL AND climate_zone != ''
        ORDER BY species_id, climate_zone
        """
    )
    for row in rows:
        zones.setdefault(row["species_id"], set()).add(row["climate_zone"])
    return {species_id: sorted(values) for species_id, values in zones.items()}


def build_manifest(
    *,
    output_dir: Path,
    export_path: Path,
    export_schema_version: int | None,
    species_assets: list[dict[str, Any]],
    name_assets: dict[str, dict[str, Any]],
    image_assets: list[dict[str, Any]],
    max_asset_bytes: int,
) -> dict[str, Any]:
    return {
        "version": 1,
        "asset_format": "ndjson",
        "source": {
            "export_file": export_path.name,
            "export_schema_version": export_schema_version,
        },
        "cloudflare_pages": {
            "max_asset_bytes": max_asset_bytes,
        },
        "locales": UI_LOCALES,
        "schema": {
            "species_fields": SPECIES_FIELDS,
            "name_fields": NAME_FIELDS,
            "image_fields": IMAGE_FIELDS,
            "excluded_detail_fields": EXCLUDED_DETAIL_FIELDS,
        },
        "duckdb": {
            "reader": "read_ndjson_auto",
            "tables": {
                "web_species": [asset["path"] for asset in species_assets],
                "web_species_names": [asset["path"] for asset in name_assets.values()],
                "web_species_images": [asset["path"] for asset in image_assets],
            },
        },
        "assets": {
            "species": species_assets,
            "names": name_assets,
            "images": image_assets,
        },
    }


def assert_asset_sizes(output_dir: Path, *, max_asset_bytes: int) -> None:
    oversized = [
        (path, path.stat().st_size)
        for path in sorted(output_dir.rglob("*"))
        if path.is_file() and path.stat().st_size > max_asset_bytes
    ]
    if oversized:
        details = ", ".join(
            f"{path.relative_to(output_dir).as_posix()}={size} bytes"
            for path, size in oversized
        )
        raise AssetSizeError(
            f"Generated Web Edition catalog assets exceed the {max_asset_bytes} byte limit: {details}"
        )


def open_shard_files(directory: Path, prefix: str, shard_count: int) -> list[Any]:
    width = max(4, len(str(shard_count - 1)))
    return [
        (directory / f"{prefix}-{index:0{width}d}.jsonl").open("w", encoding="utf-8")
        for index in range(shard_count)
    ]


def close_files(files: list[Any]) -> None:
    for handle in files:
        handle.close()


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_jsonl(handle: Any, value: dict[str, Any]) -> None:
    handle.write(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    handle.write("\n")


def asset_entries(output_dir: Path, paths: Any) -> list[dict[str, Any]]:
    return [asset_entry(output_dir, path) for path in sorted(paths)]


def asset_entry(output_dir: Path, path: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(output_dir).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def shard_index(key: str, shard_count: int) -> int:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % shard_count


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def select_expr(columns: set[str], column: str) -> str:
    if column in columns:
        return column
    return f"NULL AS {column}"


def first_present(*values: Any) -> str | None:
    for value in values:
        if value is not None and str(value).strip():
            return str(value)
    return None


def life_cycles_from_flags(is_annual: Any, is_biennial: Any, is_perennial: Any) -> list[str]:
    cycles = []
    if truthy_flag(is_annual):
        cycles.append("Annual")
    if truthy_flag(is_biennial):
        cycles.append("Biennial")
    if truthy_flag(is_perennial):
        cycles.append("Perennial")
    return cycles


def truthy_flag(value: Any) -> bool:
    return value in (1, True, "1", "true", "True")


def parse_list_field(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return sorted_unique_strings(value)
    text = str(value).strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return sorted_unique_strings(parsed)
    except json.JSONDecodeError:
        pass
    return sorted_unique_strings(part.strip() for part in text.split(","))


def sorted_unique_strings(values: Any) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value).strip()})


def normalize_search_token(token: str) -> str:
    decomposed = unicodedata.normalize("NFKD", token)
    without_diacritics = "".join(
        char for char in decomposed if not unicodedata.combining(char)
    )
    return without_diacritics.casefold()


def common_name_tokens(name: str) -> list[tuple[str, int]]:
    tokens: list[tuple[str, int]] = []
    for index, raw_token in enumerate(re.findall(r"\w+", name, flags=re.UNICODE)):
        token = normalize_search_token(raw_token)
        if token:
            tokens.append((token, index))
    return tokens


def normalize_search_name(name: str) -> str:
    return " ".join(token for token, _position in common_name_tokens(name))


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate reduced Web Edition catalog assets")
    parser.add_argument(
        "--export-path",
        type=Path,
        help=f"Path to canopi-data export DB (default: latest in {DEFAULT_EXPORTS_DIR})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument("--species-shard-count", type=int, default=24)
    parser.add_argument("--image-shard-count", type=int, default=12)
    parser.add_argument(
        "--max-asset-bytes",
        type=int,
        default=CLOUDFLARE_PAGES_MAX_ASSET_BYTES,
        help="Maximum bytes allowed for any generated asset.",
    )
    args = parser.parse_args()

    manifest = generate_web_catalog(
        export_path=args.export_path,
        output_dir=args.output_dir,
        species_shard_count=args.species_shard_count,
        image_shard_count=args.image_shard_count,
        max_asset_bytes=args.max_asset_bytes,
    )
    asset_count = sum(
        len(manifest["assets"][key]) if isinstance(manifest["assets"][key], list) else len(manifest["assets"][key])
        for key in ["species", "names", "images"]
    )
    print(
        f"Generated Web Edition catalog manifest with {asset_count} assets at "
        f"{args.output_dir / 'manifest.json'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
