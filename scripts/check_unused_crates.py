#!/usr/bin/env python3
"""Fails for a crate a workspace member declares and its sources never name.

    python3 scripts/check_unused_crates.py          check the workspace
    python3 -m unittest scripts.test_check_unused_crates

A crate is named by an external path in a source file, outside comments and
strings (hyphens read as underscores, a `package =` rename read by its key):
`use name::…` or `use name;` at the root of a use tree, `extern crate name`,
`::name::…`, or `name::…` where the file declares no module and imports no
name `name` (so `crate::db::`, `std::time::` and a local `mod db` never name a
crate). A bare `name!` macro names the crate only when MACRO_CRATES lists it
with the reason. Normal and target dependencies must be named in src/ or the
build script's sources; one named only in tests/, benches/ or examples/ is
dev-only and fails until it moves to [dev-dependencies]. Dev-dependencies are
looked for in every source folder, build-dependencies in the build script. A
crate reached only through a feature or the build system goes in ALLOWED
with the reason; an ALLOWED or MACRO_CRATES entry that is no longer declared,
or no longer needed, fails too, so the lists cannot rot. Stdlib only:
cargo-machete stays an optional tool, never a dependency of the gate.
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

# Crate identifier -> why a bare `name!` (a #[macro_use] or prelude macro) names it.
MACRO_CRATES: dict[str, str] = {}

DEPENDENCY_TABLES = ("dependencies", "dev-dependencies", "build-dependencies")
# Cargo's source folders; a member's other folders (desktop/web's node_modules) are not Rust.
SOURCE_FOLDERS = ("src", "tests", "benches", "examples")
# Folders only `cargo test`, `cargo bench` and examples build: what only they name is dev-only.
DEV_FOLDERS = ("tests", "benches", "examples")
# Path roots that are never an external crate.
LOCAL_ROOTS = frozenset({"crate", "self", "super", "Self", "std", "core", "alloc"})


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


# Comments, then string and char literals (raw strings first), in one pass so a
# `//` inside a string or a quote inside a comment is read correctly.
_NOISE = re.compile(
    r"//[^\n]*|/\*.*?\*/"
    r"|b?r(?P<hashes>#*)\"(?:.|\n)*?\"(?P=hashes)"
    r"|b?\"(?:\\.|[^\"\\])*\""
    r"|b?'(?:\\.|[^'\\\n])'",
    re.DOTALL,
)


def strip_comments(source: str) -> str:
    """The source without comments, and with every string and char literal emptied."""
    def blank(match: re.Match[str]) -> str:
        text = match.group(0)
        return "" if text.startswith("/") else '""'
    return _NOISE.sub(blank, source)


_USE = re.compile(r"\buse\s+([^;]+);")
_MOD = re.compile(r"\bmod\s+(?:r#)?(\w+)")
_USE_TOKEN = re.compile(r"::|[{},*]|(?:r#)?\w+")


def _use_tree(tokens: list[str], at: int, prefix: tuple[str, ...], roots: set[str], bound: dict[str, str]) -> int:
    """Reads one use tree from tokens[at]; records its root segments and each name it binds, by root."""
    segments = list(prefix)
    if at < len(tokens) and tokens[at] == "::":
        at += 1
    while at < len(tokens):
        token = tokens[at]
        if token == "{":
            at += 1
            while at < len(tokens) and tokens[at] != "}":
                at = _use_tree(tokens, at, tuple(segments), roots, bound)
                if at < len(tokens) and tokens[at] == ",":
                    at += 1
            return at + 1
        if token in ("*", ",", "}", "::"):
            return at + (token == "*")
        name = token.removeprefix("r#")
        at += 1
        if not segments:
            roots.add(name)
        segments.append(name)
        if at < len(tokens) and tokens[at] == "::":
            at += 1
            continue
        if at + 1 < len(tokens) and tokens[at] == "as":
            bound.setdefault(tokens[at + 1].removeprefix("r#"), segments[0])
            return at + 2
        leaf = segments[-2] if name == "self" and len(segments) > 1 else name
        bound.setdefault(leaf, segments[0])
        return at
    return at


@dataclass(frozen=True)
class FileNames:
    """One source file: its code without use statements, comments and literals; its use roots; local names."""
    code: str
    use_roots: frozenset[str]
    # Names a `mod` declares or a use statement binds from another root (`use crate::db;` binds db).
    local: frozenset[str]


def file_names(source: str) -> FileNames:
    clean = strip_comments(source)
    roots: set[str] = set()
    bound: dict[str, str] = {}
    for match in _USE.finditer(clean):
        _use_tree(_USE_TOKEN.findall(match.group(1)), 0, (), roots, bound)
    local = {name for name, root in bound.items() if root != name} | set(_MOD.findall(clean))
    return FileNames(_USE.sub(" ", clean), frozenset(roots), frozenset(local))


def names_crate(source: str | FileNames, ident: str, macro_crate: bool = False) -> bool:
    """True when `source` (one file) names the crate `ident` through an external path."""
    names = file_names(source) if isinstance(source, str) else source
    if ident in LOCAL_ROOTS:
        return False
    external = ident not in names.local
    if external and ident in names.use_roots:
        return True
    name = re.escape(ident)
    if re.search(rf"\bextern\s+crate\s+{name}\b", names.code):
        return True
    for match in re.finditer(rf"(?<![\w:])(::\s*)?{name}\s*::", names.code):
        if match.group(1) or external:
            return True
    return macro_crate and external and re.search(rf"(?<![\w:]){name}\s*!", names.code) is not None


@dataclass(frozen=True)
class MemberSources:
    main: tuple[FileNames, ...]
    dev: tuple[FileNames, ...]
    build: tuple[FileNames, ...]


def member_sources(member_dir: Path, manifest: dict) -> MemberSources:
    """The member's files by role: src/, the dev folders, the build script."""
    build_setting = manifest.get("package", {}).get("build")
    build_script = member_dir / (build_setting if isinstance(build_setting, str) else "build.rs")
    read = lambda path: file_names(path.read_text(encoding="utf-8"))  # noqa: E731
    main = tuple(read(path) for path in sorted((member_dir / "src").rglob("*.rs")))
    dev = tuple(read(path) for folder in DEV_FOLDERS for path in sorted((member_dir / folder).rglob("*.rs")))
    build = (read(build_script),) if build_script.is_file() else ()
    return MemberSources(main, dev, build)


def workspace_members(root: Path) -> list[str]:
    manifest = tomllib.loads((root / "Cargo.toml").read_text(encoding="utf-8"))
    return list(manifest["workspace"]["members"])


def check(
    root: Path,
    allowed: dict[tuple[str, str], str],
    macro_crates: dict[str, str] | None = None,
) -> list[str]:
    macro_crates = macro_crates or {}
    errors: list[str] = []
    declared: set[tuple[str, str]] = set()
    named: set[tuple[str, str]] = set()
    declared_idents: set[str] = set()
    macro_needed: set[str] = set()
    for member in workspace_members(root):
        member_dir = root / member
        manifest = tomllib.loads((member_dir / "Cargo.toml").read_text(encoding="utf-8"))
        sources = member_sources(member_dir, manifest)
        for dependency in declared_dependencies(member, manifest):
            declared.add((member, dependency.key))
            declared_idents.add(dependency.ident)
            macro = dependency.ident in macro_crates

            def named_in(files: tuple[FileNames, ...]) -> bool:
                if any(names_crate(names, dependency.ident) for names in files):
                    return True
                if macro and any(names_crate(names, dependency.ident, True) for names in files):
                    macro_needed.add(dependency.ident)
                    return True
                return False

            if dependency.table == "build-dependencies":
                found, dev_only = named_in(sources.build), False
            elif dependency.table == "dev-dependencies":
                found, dev_only = named_in(sources.main + sources.dev + sources.build), False
            else:
                found = named_in(sources.main + sources.build)
                dev_only = not found and named_in(sources.dev)
            if found:
                named.add((member, dependency.key))
            elif (member, dependency.key) in allowed:
                continue
            elif dev_only:
                errors.append(
                    f"{member}/Cargo.toml: [{dependency.table}] {dependency.key} is named only in tests/, benches/"
                    " or examples/; move it to [dev-dependencies]"
                )
            else:
                errors.append(
                    f"{member}/Cargo.toml: [{dependency.table}] {dependency.key} is never named in its sources;"
                    " remove it, or add it to ALLOWED in scripts/check_unused_crates.py with the reason"
                )
    for ident in sorted(macro_crates):
        if ident not in declared_idents:
            errors.append(f"MACRO_CRATES names {ident}, which no member declares")
        elif ident not in macro_needed:
            errors.append(f"MACRO_CRATES names {ident}, which is named without its bare macro; remove the entry")
    for entry in sorted(allowed):
        member, key = entry
        if entry not in declared:
            errors.append(f"ALLOWED names {member}:{key}, which {member}/Cargo.toml no longer declares")
        elif entry in named:
            errors.append(f"ALLOWED names {member}:{key}, which its sources now name; remove the entry")
    return errors


def main() -> int:
    errors = check(ROOT, ALLOWED, MACRO_CRATES)
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    print("check_unused_crates: every declared crate is named")
    return 0


if __name__ == "__main__":
    sys.exit(main())
