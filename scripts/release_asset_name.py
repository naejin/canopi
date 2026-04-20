#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def canonical_asset_name(version: str, artifact_path: str) -> str:
    path = Path(artifact_path)
    name = path.name
    path_text = str(path)

    if name not in {"Canopi.app.tar.gz", "Canopi.app.tar.gz.sig"}:
        return name

    if "aarch64-apple-darwin" in path_text:
        arch = "aarch64"
    elif "x86_64-apple-darwin" in path_text:
        arch = "x64"
    else:
        raise ValueError(f"Cannot determine macOS architecture for updater asset: {artifact_path}")

    canonical_name = f"Canopi_{version}_{arch}.app.tar.gz"
    if name.endswith(".sig"):
        canonical_name += ".sig"
    return canonical_name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Return the canonical release asset name for a packaged artifact.")
    parser.add_argument("--version", required=True, help="Release version, e.g. 0.5.0-beta.1")
    parser.add_argument("--path", required=True, help="Artifact path used to infer the canonical release asset name")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    print(canonical_asset_name(args.version, args.path))


if __name__ == "__main__":
    main()
