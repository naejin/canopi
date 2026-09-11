"""Admit only manifest-listed release packages, optionally snapshotting local bytes."""

import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re


PACKAGE_SUFFIXES = {".deb", ".AppImage", ".dmg", ".msi", ".exe"}


def manifest_packages(manifest: Path):
    packages = []
    names = set()
    for line in manifest.read_text().splitlines():
        match = re.fullmatch(r"([0-9a-fA-F]{64}) [ *](.+)", line)
        if not match:
            raise ValueError("Invalid candidate checksum manifest entry")
        digest, name = match.groups()
        relative = PurePosixPath(name)
        if (relative.is_absolute() or ".." in relative.parts or "\\" in name or "#" in name
                or any(ord(char) < 32 for char in name)
                or relative.suffix not in PACKAGE_SUFFIXES):
            raise ValueError(f"Invalid candidate package path: {name}")
        if relative.name in names:
            raise ValueError(f"Duplicate release asset name: {relative.name}")
        names.add(relative.name)
        packages.append((relative, digest.lower()))
    if not packages:
        raise ValueError("Candidate checksum manifest contains no packages")
    return packages


def verified_packages(manifest: Path, source_root: Path, stage_root: Path | None):
    source_root = source_root.resolve(strict=True)
    if not source_root.is_dir():
        raise ValueError("Candidate artifact directory is not a directory")
    verified = []
    for relative, expected in manifest_packages(manifest):
        source = source_root.joinpath(*relative.parts)
        if (not source.is_file() or source.is_symlink()
                or not source.resolve().is_relative_to(source_root)):
            raise ValueError(f"Missing or unsafe candidate package: {relative}")
        target = stage_root.joinpath(*relative.parts) if stage_root else source
        digest = hashlib.sha256()
        # A private snapshot prevents later edits to the caller's files from
        # changing the bytes uploaded after verification.
        with source.open("rb") as incoming:
            if stage_root:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as outgoing:
                    while chunk := incoming.read(1024 * 1024):
                        digest.update(chunk)
                        outgoing.write(chunk)
            else:
                while chunk := incoming.read(1024 * 1024):
                    digest.update(chunk)
        if digest.hexdigest() != expected:
            raise ValueError(f"Checksum mismatch for candidate package: {relative}")
        verified.append(target)
    return verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--stage-dir", type=Path)
    args = parser.parse_args()
    try:
        files = verified_packages(args.manifest, args.source_dir, args.stage_dir)
    except (OSError, ValueError) as error:
        parser.exit(1, f"ERROR: Cannot prepare candidate packages: {error}\n")
    for path in files:
        print(path)


if __name__ == "__main__":
    main()
