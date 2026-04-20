#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render a Tauri release config with committed updater public key.")
    parser.add_argument("--base-config", required=True, help="Path to the base Tauri release config JSON.")
    parser.add_argument("--public-key", required=True, help="Path to the committed updater public key file.")
    parser.add_argument("--output", required=True, help="Path to write the rendered Tauri release config JSON.")
    parser.add_argument("--version", required=True, help="Release version to inject.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = json.loads(Path(args.base_config).read_text())
    pubkey = Path(args.public_key).read_text().strip()
    if not pubkey:
        raise SystemExit(f"Updater public key file '{args.public_key}' is empty.")

    config["version"] = args.version
    plugins = config.setdefault("plugins", {})
    updater = plugins.setdefault("updater", {})
    updater["pubkey"] = pubkey

    Path(args.output).write_text(json.dumps(config, indent=2) + "\n")


if __name__ == "__main__":
    main()
