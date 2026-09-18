#!/usr/bin/env python3
"""Merge two browser probe reports into one evidence report.

The display experiment needs two different probe runs: one over the synthetic
tiled COGs for tile rendering, and one over the disk-backed prepared derivative
for local transport and stride sampling. This combines them without discarding
either, so a single verdict can assert on both.

Usage::

    python3 scripts/raster-qualification/merge_probe_reports.py \
        --tiles <probe.json> --local <probe.json> --out <merged.json>
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiles", required=True, type=Path)
    parser.add_argument("--local", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    tiles = json.loads(args.tiles.read_text())
    local = json.loads(args.local.read_text())
    merged = dict(tiles)
    merged["mergedFrom"] = [args.tiles.name, args.local.name]
    for engine, entry in (merged.get("engines") or {}).items():
        other = (local.get("engines") or {}).get(engine) or {}
        scenarios = entry.setdefault("scenarios", {})
        for name, value in (other.get("scenarios") or {}).items():
            # A scenario present in both runs is kept from the tiles run; the
            # local run contributes only what it uniquely measured.
            scenarios.setdefault(name, value)
        entry["console"] = list(entry.get("console", [])) + list(other.get("console", []))
        if other.get("ok") is not True:
            entry["ok"] = False
    merged["transportLedger"] = local.get("transportLedger")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(merged, indent=2, sort_keys=True) + "\n")
    scenarios = merged.get("engines", {}).get("chromium", {}).get("scenarios", {})
    print(json.dumps({"out": str(args.out), "scenarios": sorted(scenarios),
                      "ledger": merged.get("transportLedger") is not None}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
