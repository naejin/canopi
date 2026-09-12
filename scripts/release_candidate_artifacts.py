"""Admit only manifest-listed release packages, optionally snapshotting local bytes."""

import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import shutil


PACKAGE_SUFFIXES = {".deb", ".AppImage", ".dmg", ".msi", ".exe"}

# Artifact roots come from the Release Candidate target matrix. Public names
# are a website contract: changing a build filename must not change these URLs.
STABLE_PACKAGES = {
    ("canopi-x86_64-unknown-linux-gnu", ".deb"): "canopi-linux-x64.deb",
    ("canopi-x86_64-unknown-linux-gnu", ".AppImage"): "canopi-linux-x64.AppImage",
    ("canopi-aarch64-apple-darwin", ".dmg"): "canopi-macos-arm64.dmg",
    ("canopi-x86_64-apple-darwin", ".dmg"): "canopi-macos-x64.dmg",
    ("canopi-x86_64-pc-windows-msvc", ".exe"): "canopi-windows-x64.exe",
    ("canopi-x86_64-pc-windows-msvc", ".msi"): "canopi-windows-x64.msi",
}


def release_packages(manifest: Path, source_root: Path, release_root: Path):
    packages = manifest_packages(manifest)
    aliases = {}
    original_names = {relative.name for relative, _ in packages}
    for relative, _ in packages:
        alias = STABLE_PACKAGES.get((relative.parts[0], relative.suffix))
        if alias is None:
            raise ValueError(f"Unsupported release package target or format: {relative}")
        if alias in aliases or alias in original_names:
            raise ValueError(f"Duplicate or colliding stable release asset: {alias}")
        aliases[alias] = relative
    missing = set(STABLE_PACKAGES.values()) - aliases.keys()
    if missing:
        raise ValueError(f"Missing required release packages: {', '.join(sorted(missing))}")

    # Always snapshot before making public copies, including --artifact-dir.
    originals = verified_packages(manifest, source_root, release_root / "originals")
    public_root = release_root / "downloads"
    public_root.mkdir(parents=True)
    files = list(originals)
    checksums = []
    for (relative, digest), original in zip(packages, originals):
        alias = STABLE_PACKAGES[(relative.parts[0], relative.suffix)]
        target = public_root / alias
        shutil.copyfile(original, target)
        files.append(target)
        checksums.extend([f"{digest}  {original.name}\n", f"{digest}  {alias}\n"])
    checksum_path = release_root / "RELEASE-SHA256SUMS.txt"
    checksum_path.write_text("".join(sorted(checksums)))
    return files + [checksum_path]


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
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--stage-dir", type=Path)
    output.add_argument("--release-dir", type=Path,
                        help="Stage a complete desktop release with stable copies and public checksums")
    args = parser.parse_args()
    try:
        if args.release_dir:
            files = release_packages(args.manifest, args.source_dir, args.release_dir)
        else:
            files = verified_packages(args.manifest, args.source_dir, args.stage_dir)
    except (OSError, ValueError) as error:
        parser.exit(1, f"ERROR: Cannot prepare candidate packages: {error}\n")
    for path in files:
        print(path)


if __name__ == "__main__":
    main()
