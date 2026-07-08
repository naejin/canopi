import importlib.util
import json
import sqlite3
import tempfile
from pathlib import Path
import unittest


def load_generator_module():
    module_path = Path(__file__).with_name("generate-web-catalog.py")
    spec = importlib.util.spec_from_file_location("generate_web_catalog", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


generator = load_generator_module()


class GenerateWebCatalogTests(unittest.TestCase):
    def test_generates_reduced_duckdb_compatible_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            export_path = root / "canopi-export-test.db"
            output_dir = root / "catalog"
            create_export_fixture(export_path)

            manifest = generator.generate_web_catalog(
                export_path=export_path,
                output_dir=output_dir,
                species_shard_count=2,
                image_shard_count=2,
                max_asset_bytes=25 * 1024 * 1024,
            )

            self.assertEqual(manifest["asset_format"], "parquet")
            self.assertEqual(manifest["duckdb"]["reader"], "read_parquet")
            self.assertEqual(manifest["locales"], generator.UI_LOCALES)
            self.assertEqual(
                manifest["schema"]["species_fields"],
                [
                    "id",
                    "slug",
                    "canonical_name",
                    "common_name",
                    "climate_zones",
                    "habit",
                    "growth_form",
                    "life_cycles",
                ],
            )
            self.assertEqual(
                sorted(asset["path"] for asset in manifest["assets"]["species"]),
                ["species/species-0000.parquet", "species/species-0001.parquet"],
            )
            for asset in manifest["assets"]["species"]:
                species_asset = output_dir / asset["path"]
                self.assertEqual(species_asset.read_bytes()[:4], b"PAR1")
                self.assertEqual(species_asset.read_bytes()[-4:], b"PAR1")
            self.assertEqual(
                sorted(manifest["assets"]["names"].keys()),
                sorted(generator.UI_LOCALES),
            )

            species_rows = read_manifest_rows(
                output_dir,
                manifest["assets"]["species"],
                fields=manifest["schema"]["species_fields"],
            )
            apple = next(row for row in species_rows if row["slug"] == "malus-domestica")
            self.assertEqual(apple["canonical_name"], "Malus domestica")
            self.assertEqual(apple["common_name"], "Apple")
            self.assertEqual(apple["climate_zones"], ["Boreal", "Temperate"])
            self.assertEqual(apple["habit"], "Tree")
            self.assertEqual(apple["growth_form"], "Tree")
            self.assertEqual(apple["life_cycles"], ["Perennial"])

            forbidden = json.dumps(species_rows)
            for field in [
                "edibility",
                "hardiness",
                "height",
                "stratum",
                "soil_ph",
                "native_distribution",
            ]:
                self.assertNotIn(field, forbidden)

            french_names = read_jsonl(output_dir / manifest["assets"]["names"]["fr"]["path"])
            self.assertEqual(french_names, [{
                "species_id": "species-apple",
                "language": "fr",
                "common_name": "Pommier",
                "normalized_name": "pommier",
                "is_primary": True,
                "display_order": 0,
            }])
            japanese_names = read_jsonl(output_dir / manifest["assets"]["names"]["ja"]["path"])
            self.assertEqual(japanese_names, [])

            image_rows = read_manifest_rows(output_dir, manifest["assets"]["images"])
            self.assertEqual(
                next(row for row in image_rows if row["species_id"] == "species-apple"),
                {
                    "species_id": "species-apple",
                    "url": "https://example.test/apple-primary.jpg",
                    "source": None,
                    "source_page_url": None,
                    "credit": None,
                    "license": None,
                },
            )
            self.assertEqual(
                next(row for row in image_rows if row["species_id"] == "species-balm")["source"],
                None,
            )

    def test_asset_size_check_fails_for_oversized_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            oversized = output_dir / "catalog-worker.wasm"
            oversized.write_bytes(b"123456")

            with self.assertRaises(generator.AssetSizeError):
                generator.assert_asset_sizes(output_dir, max_asset_bytes=5)


def create_export_fixture(path: Path):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.execute("INSERT INTO _metadata (key, value) VALUES ('schema_version', '14')")
    conn.execute("""
        CREATE TABLE species (
            id TEXT PRIMARY KEY,
            slug TEXT NOT NULL,
            canonical_name TEXT NOT NULL,
            common_name TEXT,
            habit TEXT,
            growth_form_type TEXT,
            growth_form_shape TEXT,
            growth_habit TEXT,
            is_annual INTEGER,
            is_biennial INTEGER,
            is_perennial INTEGER,
            climate_zones TEXT,
            height_max_m REAL,
            hardiness_zone_min INTEGER,
            hardiness_zone_max INTEGER,
            stratum TEXT,
            edibility_rating INTEGER,
            native_distribution TEXT,
            image_urls TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE species_common_names (
            id TEXT PRIMARY KEY,
            species_id TEXT NOT NULL,
            language TEXT NOT NULL,
            common_name TEXT NOT NULL,
            is_primary INTEGER NOT NULL DEFAULT 0,
            display_order INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE species_climate_zones (
            id TEXT PRIMARY KEY,
            species_id TEXT NOT NULL,
            climate_zone TEXT NOT NULL,
            confidence REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE species_images (
            id TEXT PRIMARY KEY,
            species_id TEXT NOT NULL,
            url TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        )
    """)
    conn.executemany(
        """
        INSERT INTO species (
            id, slug, canonical_name, common_name, habit, growth_form_type,
            growth_form_shape, growth_habit, is_annual, is_biennial, is_perennial,
            climate_zones, height_max_m, hardiness_zone_min, hardiness_zone_max,
            stratum, edibility_rating, native_distribution, image_urls
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "species-apple",
                "malus-domestica",
                "Malus domestica",
                "Apple",
                "Tree",
                "Tree",
                None,
                None,
                0,
                0,
                1,
                '["Ignored zone"]',
                8.0,
                5,
                9,
                "Canopy",
                5,
                "Europe",
                None,
            ),
            (
                "species-balm",
                "melissa-officinalis",
                "Melissa officinalis",
                "Lemon balm",
                "Herbaceous",
                None,
                "Forb",
                None,
                0,
                0,
                1,
                '["Temperate"]',
                0.7,
                4,
                9,
                "Herb",
                4,
                "Europe",
                '["https://example.test/balm.jpg", "https://example.test/balm-2.jpg"]',
            ),
        ],
    )
    conn.executemany(
        """
        INSERT INTO species_common_names (
            id, species_id, language, common_name, is_primary, display_order
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            ("cn-apple-en", "species-apple", "en", "Apple", 1, 0),
            ("cn-apple-fr", "species-apple", "fr", "Pommier", 1, 0),
            ("cn-balm-en", "species-balm", "en", "Lemon balm", 1, 0),
        ],
    )
    conn.executemany(
        """
        INSERT INTO species_climate_zones (
            id, species_id, climate_zone, confidence
        ) VALUES (?, ?, ?, ?)
        """,
        [
            ("cz-apple-1", "species-apple", "Temperate", 0.95),
            ("cz-apple-2", "species-apple", "Boreal", 0.8),
        ],
    )
    conn.executemany(
        """
        INSERT INTO species_images (id, species_id, url, sort_order)
        VALUES (?, ?, ?, ?)
        """,
        [
            ("img-apple-secondary", "species-apple", "https://example.test/apple-secondary.jpg", 1),
            ("img-apple-primary", "species-apple", "https://example.test/apple-primary.jpg", 0),
        ],
    )
    conn.commit()
    conn.close()


def read_manifest_rows(output_dir: Path, assets, fields=None):
    rows = []
    for asset in assets:
        path = output_dir / asset["path"]
        if path.suffix == ".parquet":
            if fields is None:
                raise AssertionError("Parquet test reads require schema fields.")
            rows.extend(read_simple_parquet_rows(path, fields))
        else:
            rows.extend(read_jsonl(path))
    return rows


def read_jsonl(path: Path):
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def read_simple_parquet_rows(path: Path, fields):
    data = path.read_bytes()
    if data[:4] != b"PAR1" or data[-4:] != b"PAR1":
        raise AssertionError(f"{path} is not framed as Parquet")
    rows = None
    offset = 4
    columns = []
    for field in fields:
        header = parse_page_header(data, offset)
        offset = header["end"]
        values = []
        for _ in range(header["num_values"]):
            size = int.from_bytes(data[offset:offset + 4], "little")
            offset += 4
            values.append(data[offset:offset + size].decode("utf-8"))
            offset += size
        columns.append((field, values))
        rows = header["num_values"] if rows is None else rows
    result = [dict() for _ in range(rows or 0)]
    for field, values in columns:
        for index, value in enumerate(values):
            if field in ("climate_zones", "life_cycles"):
                result[index][field] = json.loads(value or "[]")
            else:
                result[index][field] = value or None
    return result


def parse_page_header(data: bytes, offset: int):
    header_end, fields = parse_compact_struct(data, offset)
    compressed_size = fields[3]
    data_page = fields[5]
    return {
        "end": header_end,
        "compressed_size": compressed_size,
        "num_values": data_page[1],
    }


def parse_compact_struct(data: bytes, offset: int):
    fields = {}
    field_id = 0
    while True:
        header = data[offset]
        offset += 1
        field_type = header & 0x0F
        if field_type == 0:
            return offset, fields
        delta = header >> 4
        if delta == 0:
            field_id, offset = read_compact_int(data, offset)
        else:
            field_id += delta
        if field_type in (5, 6):
            value, offset = read_compact_int(data, offset)
        elif field_type == 8:
            size, offset = read_varint(data, offset)
            value = data[offset:offset + size].decode("utf-8")
            offset += size
        elif field_type == 12:
            offset, value = parse_compact_struct(data, offset)
        else:
            raise AssertionError(f"Unsupported compact field type {field_type}")
        fields[field_id] = value


def read_compact_int(data: bytes, offset: int):
    raw, offset = read_varint(data, offset)
    return ((raw >> 1) ^ -(raw & 1)), offset


def read_varint(data: bytes, offset: int):
    shift = 0
    value = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte & 0x80 == 0:
            return value, offset
        shift += 7


if __name__ == "__main__":
    unittest.main()
