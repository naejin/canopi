#!/usr/bin/env python3
"""Install the pinned candidate artifacts into an isolated bench directory.

Candidate packages are **never** added to a production manifest. This creates a
throwaway bench with exact, non-floating versions taken from
``candidates.json`` so the qualification run is reproducible and the repository's
own dependency graph is untouched.

The npm cache is redirected inside the bench, so the command works on a host
whose home directory is not writable.

Usage::

    python3 scripts/raster-qualification/bootstrap_bench.py --bench /path/to/bench
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parent


def sha512_base64(path: Path) -> str:
    digest = hashlib.sha512(path.read_bytes()).digest()
    import base64
    return "sha512-" + base64.b64encode(digest).decode()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bench", required=True, type=Path,
                        help="bench directory to create or refresh")
    parser.add_argument("--candidates", type=Path,
                        default=HARNESS / "candidates.json")
    parser.add_argument("--skip-browser", action="store_true",
                        help="do not install the playwright driver")
    args = parser.parse_args()

    spec = json.loads(args.candidates.read_text())
    bench = args.bench.resolve()
    bench.mkdir(parents=True, exist_ok=True)
    cache = bench.parent / "npm-cache"

    # Exact versions only: a floating range would silently reintroduce the
    # artifact/peer mismatches this qualification exists to detect.
    packages = [f"{a['name']}@{a['version']}" for a in spec["artifacts"]]
    dev_packages = [] if args.skip_browser else [
        f"{d['name']}@{d['version']}" for d in spec.get("devOnly", [])]

    (bench / "package.json").write_text(json.dumps({
        "name": "canopi-raster-qual-bench",
        "private": True,
        "type": "module",
        "version": "0.0.0",
        "description": "Isolated bench for raster qualification (Q). Not a production manifest.",
    }, indent=2) + "\n")

    command = ["npm", "install", "--no-audit", "--no-fund", "--save-exact"]
    command += packages
    if dev_packages:
        command += ["--save-dev"] + dev_packages
    print(" ".join(command), file=sys.stderr, flush=True)
    result = subprocess.run(command, cwd=bench, env={
        **__import__("os").environ, "npm_config_cache": str(cache),
    })
    if result.returncode != 0:
        print("ERROR: bench install failed", file=sys.stderr)
        return result.returncode

    # Verify every declared artifact against its recorded integrity digest.
    lock = json.loads((bench / "package-lock.json").read_text())
    problems: list[str] = []
    verified: list[dict] = []
    for artifact in spec["artifacts"]:
        entry = lock["packages"].get(f"node_modules/{artifact['name']}")
        if not entry:
            problems.append(f"{artifact['name']}: not installed")
            continue
        if entry.get("version") != artifact["version"]:
            problems.append(
                f"{artifact['name']}: installed {entry.get('version')}, "
                f"expected {artifact['version']}")
            continue
        if entry.get("integrity") != artifact["integrity"]:
            problems.append(
                f"{artifact['name']}: integrity {entry.get('integrity')} != recorded "
                f"{artifact['integrity']}")
            continue
        verified.append({"name": artifact["name"], "version": artifact["version"],
                         "integrity": artifact["integrity"]})

    # Record the actual on-disk artifact hashes for the receipt.
    on_disk = []
    for artifact in spec["artifacts"]:
        directory = bench / "node_modules" / artifact["name"]
        files = sorted(p for p in directory.rglob("*") if p.is_file())
        on_disk.append({
            "name": artifact["name"],
            "version": artifact["version"],
            "files": len(files),
            "bytes": sum(p.stat().st_size for p in files),
            "wasm": [
                {"path": str(p.relative_to(directory)), "bytes": p.stat().st_size,
                 "sha256": sha256(p)}
                for p in files if p.suffix == ".wasm"
            ],
        })

    summary = {
        "bench": str(bench),
        "verifiedArtifacts": verified,
        "onDisk": on_disk,
        "problems": problems,
        "lockfile": str(bench / "package-lock.json"),
        "lockfileSha256": sha256(bench / "package-lock.json"),
    }
    (bench / "bootstrap-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "onDisk"},
                     indent=2, sort_keys=True))
    if problems:
        print("ERROR: artifact verification failed", file=sys.stderr)
        return 1
    print(f"OK: {len(verified)} artifacts verified", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
