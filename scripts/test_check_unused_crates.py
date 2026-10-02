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
    def test_paths_uses_macros_and_extern_crate_name_a_crate(self):
        self.assertTrue(names_crate("let x = serde_json::Value::Null;", "serde_json"))
        self.assertTrue(names_crate("use sha2;", "sha2"))
        self.assertTrue(names_crate("use { tracing, serde };", "serde"))
        self.assertTrue(names_crate("extern crate libc;", "libc"))
        self.assertTrue(names_crate("lazy_static! { }", "lazy_static"))

    def test_a_suffix_a_module_path_or_a_comment_is_not_the_crate(self):
        self.assertFalse(names_crate("use my_serde::Thing;", "serde"))
        self.assertFalse(names_crate("crate::serde::helper()", "serde"))
        self.assertFalse(names_crate(strip_comments("// serde::Serialize\n/* use serde; */"), "serde"))


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
