#!/usr/bin/env python3
"""Fails for a crate a workspace member declares and its sources never name.

    python3 scripts/check_unused_crates.py          check the workspace
    python3 -m unittest scripts.test_check_unused_crates

A crate is named when a source file outside comments has `name::`, `use name`,
`extern crate name` or `name!` (hyphens read as underscores, a `package =`
rename read by its key). Normal, target and dev-dependencies are looked for in
the member's src/, tests/, benches/ and examples/, build-dependencies in its
build script. A crate reached only
through a macro, a feature or the build system goes in ALLOWED with the
reason; an ALLOWED entry that is no longer declared, or is named after all,
fails too, so the list cannot rot. Stdlib only: cargo-machete stays an
optional tool, never a dependency of the gate.
"""

from __future__ import annotations

import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (member directory, dependency key) -> why its sources never name it.
ALLOWED: dict[tuple[str, str], str] = {}

DEPENDENCY_TABLES = ("dependencies", "dev-dependencies", "build-dependencies")
# Cargo's source folders; a member's other folders (desktop/web's node_modules) are not Rust.
SOURCE_FOLDERS = ("src", "tests", "benches", "examples")


@dataclass(frozen=True)
class Dependency:
    member: str
    key: str
    table: str

    @property
    def ident(self) -> str:
        return self.key.replace("-", "_")


def declared_dependencies(member: str, manifest: dict) -> list[Dependency]:
    tables: list[tuple[str, dict]] = [(name, manifest.get(name, {})) for name in DEPENDENCY_TABLES]
    for target in manifest.get("target", {}).values():
        tables.extend((name, target.get(name, {})) for name in DEPENDENCY_TABLES)
    found: dict[tuple[str, str], Dependency] = {}
    for table, entries in tables:
        for key in entries:
            found.setdefault((key, table), Dependency(member, key, table))
    return sorted(found.values(), key=lambda dependency: (dependency.table, dependency.key))


_COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.DOTALL)


def strip_comments(source: str) -> str:
    return _COMMENT.sub("", source)


def names_crate(source: str, ident: str) -> bool:
    name = re.escape(ident)
    pattern = rf"(?<![\w:]){name}\s*(::|!)|\buse\s+{name}\b|\bextern\s+crate\s+{name}\b|\buse\s*\{{[^}}]*(?<![\w:]){name}\b"
    return re.search(pattern, source) is not None


def member_sources(member_dir: Path, manifest: dict) -> tuple[str, str]:
    """(every Rust file but the build script, the build script) with comments removed."""
    build_setting = manifest.get("package", {}).get("build")
    build_script = member_dir / (build_setting if isinstance(build_setting, str) else "build.rs")
    code, build = [], []
    paths = [path for folder in SOURCE_FOLDERS for path in sorted((member_dir / folder).rglob("*.rs"))]
    for path in paths:
        code.append(strip_comments(path.read_text(encoding="utf-8")))
    if build_script.is_file():
        build.append(strip_comments(build_script.read_text(encoding="utf-8")))
    return "\n".join(code), "\n".join(build)


def workspace_members(root: Path) -> list[str]:
    manifest = tomllib.loads((root / "Cargo.toml").read_text(encoding="utf-8"))
    return list(manifest["workspace"]["members"])


def check(root: Path, allowed: dict[tuple[str, str], str]) -> list[str]:
    errors: list[str] = []
    declared: set[tuple[str, str]] = set()
    named: set[tuple[str, str]] = set()
    for member in workspace_members(root):
        member_dir = root / member
        manifest = tomllib.loads((member_dir / "Cargo.toml").read_text(encoding="utf-8"))
        code, build = member_sources(member_dir, manifest)
        for dependency in declared_dependencies(member, manifest):
            declared.add((member, dependency.key))
            source = build if dependency.table == "build-dependencies" else code
            if names_crate(source, dependency.ident):
                named.add((member, dependency.key))
            elif (member, dependency.key) not in allowed:
                errors.append(
                    f"{member}/Cargo.toml: [{dependency.table}] {dependency.key} is never named in its sources;"
                    " remove it, or add it to ALLOWED in scripts/check_unused_crates.py with the reason"
                )
    for entry in sorted(allowed):
        member, key = entry
        if entry not in declared:
            errors.append(f"ALLOWED names {member}:{key}, which {member}/Cargo.toml no longer declares")
        elif entry in named:
            errors.append(f"ALLOWED names {member}:{key}, which its sources now name; remove the entry")
    return errors


def main() -> int:
    errors = check(ROOT, ALLOWED)
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    print("check_unused_crates: every declared crate is named")
    return 0


if __name__ == "__main__":
    sys.exit(main())
