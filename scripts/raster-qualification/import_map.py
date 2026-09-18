#!/usr/bin/env python3
"""Generate the browser import map for the qualification runner.

The candidate display artifact and its peers declare bare specifiers for their
codec and projection dependencies. Rather than hand-maintaining a list, this
resolves every installed package's browser-facing entry point from its own
``package.json`` and emits an import map covering all of them.

This keeps the probe honest: the browser loads the exact installed package entry
points with no bundler rewriting, and no specifier is invented by the harness.

Usage::

    python3 scripts/raster-qualification/import_map.py --bench <scratch>/bench \
        --out <scratch>/import-map.json [--print]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Preferred conditions, in order, for the entry point.
#
# "import" is preferred over "browser" deliberately. Some browser bundles drop
# APIs that are only meaningful for local files (geotiff's `browser` build omits
# `fromBlob`, which is exactly how a local COG is opened), so resolving to the
# browser bundle would silently make the local-transport probe impossible rather
# than reporting the real capability.
CONDITIONS = ("import", "module", "browser", "bun", "default")


def _pick(target, package_dir: Path) -> str | None:
    """Choose a usable file from an exports target (string or conditions)."""
    if isinstance(target, str):
        return target if (package_dir / target).is_file() else None
    if isinstance(target, dict):
        for condition in CONDITIONS:
            value = target.get(condition)
            chosen = _pick(value, package_dir)
            if chosen:
                return chosen
    return None


def resolve_entries(package_dir: Path) -> dict[str, str]:
    """Map every exported subpath of a package to its browser-facing file."""
    manifest_path = package_dir / "package.json"
    if not manifest_path.is_file():
        return {}
    try:
        manifest = json.loads(manifest_path.read_text())
    except json.JSONDecodeError:
        return {}

    entries: dict[str, str] = {}
    exports = manifest.get("exports")
    if isinstance(exports, str):
        entries["."] = exports
    elif isinstance(exports, dict):
        subpaths = {key: value for key, value in exports.items() if key.startswith(".")}
        # An exports object with no "." or "./sub" keys is a condition map for
        # the package root, not a set of subpaths.
        if subpaths:
            for subpath, target in subpaths.items():
                chosen = _pick(target, package_dir)
                if chosen:
                    entries[subpath] = chosen
        else:
            chosen = _pick(exports, package_dir)
            if chosen:
                entries["."] = chosen
    if "." not in entries:
        for field in ("module", "main"):
            value = manifest.get(field)
            if isinstance(value, str) and (package_dir / value).is_file():
                entries["."] = value
                break
        else:
            index = package_dir / "index.js"
            if index.is_file():
                entries["."] = "index.js"
    # A subpath-less package still needs its root file to exist.
    return {key: value for key, value in entries.items() if (package_dir / value).is_file()}


def discover(bench: Path) -> dict[str, str]:
    modules = bench / "node_modules"
    if not modules.is_dir():
        raise SystemExit(f"ERROR: {modules} is not a directory")
    imports: dict[str, str] = {}
    packages: list[tuple[str, Path]] = []
    for entry in sorted(modules.iterdir()):
        if entry.name.startswith("."):
            continue
        if entry.name.startswith("@"):
            if entry.is_dir():
                for scoped in sorted(entry.iterdir()):
                    packages.append((f"{entry.name}/{scoped.name}", scoped))
            continue
        if entry.is_dir():
            packages.append((entry.name, entry))
    for name, directory in packages:
        for subpath, target in resolve_entries(directory).items():
            specifier = name if subpath == "." else f"{name}/{subpath[2:]}"
            imports[specifier] = f"/nm/{name}/{target}"
    return imports


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bench", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--extra-map", type=Path,
                        help="JSON file of additional specifier -> URL mappings, applied last")
    parser.add_argument("--print", action="store_true", dest="print_map")
    args = parser.parse_args()

    imports = discover(args.bench.resolve())
    if args.extra_map:
        imports.update(json.loads(args.extra_map.read_text()).get("imports", {}))
    payload = {"imports": imports}
    if args.out:
        args.out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    if args.print_map or not args.out:
        print(json.dumps(payload, indent=2, sort_keys=True))
    print(f"resolved {len(imports)} package entry points", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
