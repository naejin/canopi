from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.check_unused_crates import check, names_crate, strip_comments


def write(root: Path, name: str, text: str) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def workspace(root: Path, manifest: str, files: dict[str, str]) -> None:
    write(root, "Cargo.toml", '[workspace]\nmembers = ["app"]\n')
    write(root, "app/Cargo.toml", '[package]\nname = "app"\n' + manifest)
    for name, text in files.items():
        write(root, f"app/{name}", text)


class NamesCrate(unittest.TestCase):
    def test_external_paths_uses_and_extern_crate_name_a_crate(self):
        self.assertTrue(names_crate("let x = serde_json::Value::Null;", "serde_json"))
        self.assertTrue(names_crate("use sha2;", "sha2"))
        self.assertTrue(names_crate("use sha2::{Digest, Sha256};", "sha2"))
        self.assertTrue(names_crate("pub(crate) use rayon::prelude::*;", "rayon"))
        self.assertTrue(names_crate("use { tracing, serde };", "serde"))
        self.assertTrue(names_crate("use serde as wire;", "serde"))
        self.assertTrue(names_crate("extern crate libc;", "libc"))
        self.assertTrue(names_crate("#[tokio::main]\nasync fn main() {}", "tokio"))
        self.assertTrue(names_crate("mod db;\nfn f() { ::db::open() }", "db"))

    def test_a_suffix_a_module_path_or_a_comment_is_not_the_crate(self):
        self.assertFalse(names_crate("use my_serde::Thing;", "serde"))
        self.assertFalse(names_crate("crate::serde::helper()", "serde"))
        self.assertFalse(names_crate(strip_comments("// serde::Serialize\n/* use serde; */"), "serde"))

    def test_a_local_module_or_a_std_path_is_not_the_crate(self):
        self.assertFalse(names_crate("mod db;\nfn f() { db::open() }", "db"))
        self.assertFalse(names_crate("mod db;\nuse db::open;", "db"))
        self.assertFalse(names_crate("use crate::db;\nfn f() { db::open() }", "db"))
        self.assertFalse(names_crate("use super::db::{self, Pool};\nfn f() { db::open() }", "db"))
        self.assertFalse(names_crate("let d = std::time::Duration::ZERO;", "time"))
        self.assertFalse(names_crate("use std::{fs, time::Duration};", "time"))
        self.assertFalse(names_crate("use std::time;\nfn f() { time::Instant::now() }", "time"))
        self.assertFalse(names_crate("self::time::now(); super::time::now();", "time"))

    def test_a_string_is_not_a_path(self):
        self.assertFalse(names_crate('let s = "serde::Serialize";', "serde"))
        self.assertFalse(names_crate('let s = r#"use serde;"#;', "serde"))

    def test_a_bare_macro_names_only_a_known_macro_crate(self):
        self.assertFalse(names_crate('let s = format!("{x}");', "format"))
        self.assertFalse(names_crate("let v = json!({});", "json"))
        self.assertFalse(names_crate("lazy_static! { }", "lazy_static"))
        self.assertTrue(names_crate("lazy_static! { }", "lazy_static", macro_crate=True))


class Check(unittest.TestCase):
    def test_a_declared_crate_the_sources_never_name_fails(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, (
                '[dependencies]\nserde-json = "1"\nunused-thing = "1"\n'
                '[target.\'cfg(unix)\'.dependencies]\nlibc = "0.2"\n'
                '[dev-dependencies]\nsyn = "2"\n'
                '[build-dependencies]\ntauri-build = "2"\n'
            ), {
                "src/lib.rs": "pub fn f() { let _ = serde_json::json!({}); unsafe { libc::getpid() }; }\n",
                "tests/parse.rs": "use syn::File;\n",
                "build.rs": "fn main() {}\n",
                "web/node_modules/pkg/lib.rs": "use unused_thing;\n",
            })
            errors = check(root, {})
            self.assertEqual(len(errors), 2, errors)
            self.assertIn("[build-dependencies] tauri-build", errors[0])
            self.assertIn("[dependencies] unused-thing", errors[1])

    def test_a_build_dependency_counts_only_in_the_build_script(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, '[build-dependencies]\ntauri-build = "2"\n', {
                "src/lib.rs": "fn f() { tauri_build::build() }\n",
                "build.rs": "fn main() {}\n",
            })
            self.assertEqual(len(check(root, {})), 1)
            write(root, "app/build.rs", "fn main() { tauri_build::build() }\n")
            self.assertEqual(check(root, {}), [])

    def test_a_dependency_only_tests_name_is_dev_only(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, '[dependencies]\ntempfile = "3"\nserde = "1"\n[dev-dependencies]\nproptest = "1"\n', {
                "src/lib.rs": "use serde::Serialize;\n",
                "tests/files.rs": "use tempfile::tempdir;\nuse proptest::prelude::*;\n",
            })
            errors = check(root, {})
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("[dependencies] tempfile is named only in tests/", errors[0])
            self.assertIn("move it to [dev-dependencies]", errors[0])

    def test_a_dev_dependency_counts_in_src_test_modules(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, '[dev-dependencies]\ntempfile = "3"\n', {
                "src/lib.rs": "#[cfg(test)]\nmod tests { use tempfile::tempdir; }\n",
            })
            self.assertEqual(check(root, {}), [])

    def test_a_local_module_does_not_keep_a_crate_declared(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, '[dependencies]\ndb = "1"\n', {
                "src/lib.rs": "mod db;\npub fn f() { db::open() }\n",
                "src/db.rs": "pub fn open() {}\n",
            })
            errors = check(root, {})
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("[dependencies] db is never named", errors[0])

    def test_macro_crates_admit_a_bare_macro_and_fail_closed_when_stale(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, '[dependencies]\nlazy-static = "1"\n', {
                "src/lib.rs": "lazy_static! { }\n",
            })
            self.assertEqual(len(check(root, {})), 1)
            self.assertEqual(check(root, {}, {"lazy_static": "#[macro_use] in lib.rs"}), [])
            errors = check(root, {}, {"lazy_static": "reason", "gone": "reason"})
            self.assertEqual(errors, ["MACRO_CRATES names gone, which no member declares"])
            write(root, "app/src/lib.rs", "lazy_static::lazy_static! { }\n")
            errors = check(root, {}, {"lazy_static": "reason"})
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("named without its bare macro", errors[0])

    def test_the_allowlist_admits_a_named_reason_and_fails_closed_when_stale(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, '[dependencies]\nopenssl-sys = "0.9"\nserde = "1"\n', {
                "src/lib.rs": "use serde::Serialize;\n",
            })
            self.assertEqual(check(root, {("app", "openssl-sys"): "linked for its feature"}), [])
            errors = check(root, {
                ("app", "openssl-sys"): "linked for its feature",
                ("app", "serde"): "stale",
                ("app", "gone"): "stale",
            })
            self.assertEqual(len(errors), 2, errors)
            self.assertIn("app:gone, which app/Cargo.toml no longer declares", errors[0])
            self.assertIn("app:serde, which its sources now name", errors[1])


if __name__ == "__main__":
    unittest.main()
