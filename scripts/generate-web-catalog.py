#!/usr/bin/env python3
"""Generate reduced Web Edition Species Catalog assets.

The primary Species rows are emitted as small uncompressed Parquet shards that
DuckDB-WASM can query with read_parquet(). Keeping generation in the Python
standard library avoids a native DuckDB or PyArrow dependency in the repository
while still producing DuckDB-queryable static assets for the browser adapter.
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
MIN_EXPORT_SCHEMA_VERSION = 14

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
NAME_FIELDS = ["species_id", "language", "common_name", "normalized_name", "is_primary", "display_order"]
IMAGE_FIELDS = ["species_id", "url", "source", "source_page_url", "credit", "license"]
WEB_SUPPORTED_FILTERS = [
    {
        "key": "climate_zones",
        "options_key": "climate_zones",
        "predicate": {
            "kind": "json_array_any",
            "columns": ["climate_zones"],
        },
    },
    {
        "key": "habit",
        "options_key": "habits",
        "predicate": {
            "kind": "text_any",
            "columns": ["habit", "growth_form"],
        },
    },
    {
        "key": "life_cycle",
        "options_key": "life_cycles",
        "predicate": {
            "kind": "json_array_any",
            "columns": ["life_cycles"],
        },
    },
]
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
    shards: list[list[dict[str, Any]]] = [[] for _ in range(shard_count)]
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
        shards[shard_index(species_id, shard_count)].append(payload)

    for index, shard_rows in enumerate(shards):
        write_simple_parquet(
            species_dir / f"species-{index:04d}.parquet",
            SPECIES_FIELDS,
            shard_rows,
        )
    return asset_entries(output_dir, species_dir.glob("*.parquet"))


def write_name_assets(conn: sqlite3.Connection, output_dir: Path) -> dict[str, dict[str, Any]]:
    names_dir = output_dir / "names"
    names_dir.mkdir(parents=True, exist_ok=True)
    assets: dict[str, dict[str, Any]] = {}
    has_common_names = table_exists(conn, "species_common_names")
    for locale in UI_LOCALES:
        path = names_dir / f"names-{locale}.parquet"
        locale_rows = []
        if has_common_names:
            rows = conn.execute(
                """
                SELECT scn.species_id,
                       scn.language,
                       scn.common_name,
                       COALESCE(scn.is_primary, 0) AS is_primary,
                       scn.display_order
                FROM species_common_names scn
                JOIN species s ON s.id = scn.species_id
                WHERE scn.language = ?
                  AND scn.common_name != s.canonical_name
                ORDER BY scn.species_id, scn.display_order,
                         scn.is_primary DESC,
                         LENGTH(scn.common_name), scn.common_name
                """,
                (locale,),
            )
            for row in rows:
                normalized_name = normalize_search_name(row["common_name"] or "")
                if not normalized_name:
                    continue
                locale_rows.append({
                    "species_id": row["species_id"],
                    "language": row["language"],
                    "common_name": row["common_name"],
                    "normalized_name": normalized_name,
                    "is_primary": bool(row["is_primary"]),
                    "display_order": int(row["display_order"] or 0),
                })
        write_simple_parquet(path, NAME_FIELDS, locale_rows)
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
    shards: list[list[dict[str, Any]]] = [[] for _ in range(shard_count)]
    species_with_images: set[str] = set()
    if table_exists(conn, "species_images"):
        image_columns = table_columns(conn, "species_images")
        source_expr = "source" if "source" in image_columns else "NULL AS source"
        rows = conn.execute(
            f"""
            SELECT species_id, url, {source_expr}
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
            append_image_row(shards, species_id, row["url"], row["source"], shard_count)

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
            append_image_row(shards, species_id, urls[0], None, shard_count)

    for index, shard_rows in enumerate(shards):
        write_simple_parquet(
            images_dir / f"images-{index:04d}.parquet",
            IMAGE_FIELDS,
            shard_rows,
        )
    return asset_entries(output_dir, images_dir.glob("*.parquet"))


def append_image_row(
    shards: list[list[dict[str, Any]]],
    species_id: str,
    url: str,
    source: str | None,
    shard_count: int,
) -> None:
    shards[shard_index(species_id, shard_count)].append(
        {
            "species_id": species_id,
            "url": url,
            "source": source,
            "source_page_url": None,
            "credit": None,
            "license": None,
        }
    )

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
        "asset_format": "parquet",
        "asset_formats": {
            "species": "parquet",
            "names": "parquet",
            "images": "parquet",
        },
        "source": {
            "export_file": export_path.name,
            "export_schema_version": export_schema_version,
        },
        "cloudflare_pages": {
            "max_asset_bytes": max_asset_bytes,
        },
        "locales": UI_LOCALES,
        "supported_filters": WEB_SUPPORTED_FILTERS,
        "schema": {
            "species_fields": SPECIES_FIELDS,
            "name_fields": NAME_FIELDS,
            "image_fields": IMAGE_FIELDS,
            "excluded_detail_fields": EXCLUDED_DETAIL_FIELDS,
        },
        "duckdb": {
            "reader": "read_parquet",
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


def write_simple_parquet(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    """Write a minimal uncompressed Parquet file with required UTF-8 columns.

    The reduced Web catalog schema is deliberately narrow. Lists are encoded as
    JSON strings so the browser reader can parse them back to arrays while
    DuckDB can still project columns from Parquet row groups.
    """
    body = bytearray(b"PAR1")
    column_chunks: list[dict[str, Any]] = []

    for column in columns:
        offset = len(body)
        values = b"".join(plain_byte_array(parquet_cell(row.get(column))) for row in rows)
        page_header = parquet_data_page_header(num_values=len(rows), data_size=len(values))
        page = page_header + values
        body.extend(page)
        column_chunks.append({
            "path": [column],
            "num_values": len(rows),
            "data_page_offset": offset,
            "total_size": len(page),
        })

    footer = parquet_file_metadata(
        columns=columns,
        column_chunks=column_chunks,
        num_rows=len(rows),
    )
    body.extend(footer)
    body.extend(len(footer).to_bytes(4, "little", signed=False))
    body.extend(b"PAR1")
    path.write_bytes(bytes(body))


def parquet_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return json.dumps(list(value), ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def plain_byte_array(value: str) -> bytes:
    data = value.encode("utf-8")
    return len(data).to_bytes(4, "little", signed=False) + data


def parquet_data_page_header(*, num_values: int, data_size: int) -> bytes:
    data_page_header = thrift_struct([
        thrift_i32_field(1, num_values),
        thrift_i32_field(2, 0),  # PLAIN
        thrift_i32_field(3, 3),  # RLE
        thrift_i32_field(4, 3),  # RLE
    ])
    return thrift_struct([
        thrift_i32_field(1, 0),  # DATA_PAGE
        thrift_i32_field(2, data_size),
        thrift_i32_field(3, data_size),
        thrift_struct_field(5, data_page_header),
    ])


def parquet_file_metadata(
    *,
    columns: list[str],
    column_chunks: list[dict[str, Any]],
    num_rows: int,
) -> bytes:
    schema = [
        parquet_schema_element(name="schema", num_children=len(columns)),
        *[
            parquet_schema_element(
                name=column,
                type_id=6,  # BYTE_ARRAY
                repetition_type=0,  # REQUIRED
                converted_type=0,  # UTF8
            )
            for column in columns
        ],
    ]
    row_groups = []
    if column_chunks:
        row_groups.append(thrift_struct([
            thrift_list_field(1, 12, [parquet_column_chunk(chunk) for chunk in column_chunks]),
            thrift_i64_field(2, sum(int(chunk["total_size"]) for chunk in column_chunks)),
            thrift_i64_field(3, num_rows),
        ]))

    return thrift_struct([
        thrift_i32_field(1, 1),
        thrift_list_field(2, 12, schema),
        thrift_i64_field(3, num_rows),
        thrift_list_field(4, 12, row_groups),
        thrift_binary_field(6, "canopi generate-web-catalog"),
    ])


def parquet_schema_element(
    *,
    name: str,
    type_id: int | None = None,
    repetition_type: int | None = None,
    num_children: int | None = None,
    converted_type: int | None = None,
) -> bytes:
    fields = []
    if type_id is not None:
        fields.append(thrift_i32_field(1, type_id))
    if repetition_type is not None:
        fields.append(thrift_i32_field(3, repetition_type))
    fields.append(thrift_binary_field(4, name))
    if num_children is not None:
        fields.append(thrift_i32_field(5, num_children))
    if converted_type is not None:
        fields.append(thrift_i32_field(6, converted_type))
    return thrift_struct(fields)


def parquet_column_chunk(chunk: dict[str, Any]) -> bytes:
    return thrift_struct([
        thrift_i64_field(2, int(chunk["data_page_offset"])),
        thrift_struct_field(3, parquet_column_metadata(chunk)),
    ])


def parquet_column_metadata(chunk: dict[str, Any]) -> bytes:
    total_size = int(chunk["total_size"])
    return thrift_struct([
        thrift_i32_field(1, 6),  # BYTE_ARRAY
        thrift_list_field(2, 5, [0]),  # PLAIN
        thrift_list_field(3, 8, chunk["path"]),
        thrift_i32_field(4, 0),  # UNCOMPRESSED
        thrift_i64_field(5, int(chunk["num_values"])),
        thrift_i64_field(6, total_size),
        thrift_i64_field(7, total_size),
        thrift_i64_field(9, int(chunk["data_page_offset"])),
    ])


THRIFT_STOP = 0
THRIFT_I32 = 5
THRIFT_I64 = 6
THRIFT_BINARY = 8
THRIFT_LIST = 9
THRIFT_STRUCT = 12


def thrift_struct(fields: list[tuple[int, int, bytes]]) -> bytes:
    output = bytearray()
    previous_field_id = 0
    for field_id, field_type, payload in fields:
        delta = field_id - previous_field_id
        if 0 < delta <= 15:
            output.append((delta << 4) | field_type)
        else:
            output.append(field_type)
            output.extend(varint(zigzag(field_id)))
        output.extend(payload)
        previous_field_id = field_id
    output.append(THRIFT_STOP)
    return bytes(output)


def thrift_i32_field(field_id: int, value: int) -> tuple[int, int, bytes]:
    return (field_id, THRIFT_I32, varint(zigzag(value)))


def thrift_i64_field(field_id: int, value: int) -> tuple[int, int, bytes]:
    return (field_id, THRIFT_I64, varint(zigzag(value)))


def thrift_binary_field(field_id: int, value: str) -> tuple[int, int, bytes]:
    data = value.encode("utf-8")
    return (field_id, THRIFT_BINARY, varint(len(data)) + data)


def thrift_struct_field(field_id: int, value: bytes) -> tuple[int, int, bytes]:
    return (field_id, THRIFT_STRUCT, value)


def thrift_list_field(field_id: int, element_type: int, values: list[Any]) -> tuple[int, int, bytes]:
    payload = bytearray()
    if len(values) < 15:
        payload.append((len(values) << 4) | element_type)
    else:
        payload.append((15 << 4) | element_type)
        payload.extend(varint(len(values)))

    for value in values:
        if element_type == THRIFT_STRUCT:
            payload.extend(value)
        elif element_type == THRIFT_BINARY:
            data = str(value).encode("utf-8")
            payload.extend(varint(len(data)))
            payload.extend(data)
        elif element_type == THRIFT_I32:
            payload.extend(varint(zigzag(int(value))))
        else:
            raise ValueError(f"Unsupported compact thrift list element type {element_type}.")
    return (field_id, THRIFT_LIST, bytes(payload))


def zigzag(value: int) -> int:
    return (value << 1) ^ (value >> 63)


def varint(value: int) -> bytes:
    output = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            output.append(byte | 0x80)
        else:
            output.append(byte)
            return bytes(output)


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
