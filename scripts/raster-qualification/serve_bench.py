#!/usr/bin/env python3
"""Static server for the qualification browser runner.

Everything the page loads comes from one of three local roots and nothing else:

* ``/runner/``  the harness sources in this directory,
* ``/wb/``, ``/ct/``, ``/nm/``  the installed candidate packages,
* ``/fx/``  the caller-supplied fixture root.

No network origin is reachable, which is what makes the probe a *local*
transport result rather than an HTTP-CDN demo.

Usage::

    python3 scripts/raster-qualification/serve_bench.py \
        --bench <dir> --fixtures <dir> --import-map <json> --port 8799
"""

from __future__ import annotations

import argparse
import http.server
import json
import signal
import socketserver
import sys
import threading
import tempfile
from pathlib import Path

MODULE_SUFFIXES = (".js", ".mjs", ".json")

# A browser enforces strict MIME checking on module scripts; the stdlib default
# for some of these extensions is application/octet-stream, which would make the
# probe fail for reasons unrelated to the candidate.
CONTENT_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".html": "text/html; charset=utf-8",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".png": "image/png",
}


class QualHandler(http.server.SimpleHTTPRequestHandler):
    """Shared behavior for the qualification static roots.

    Supports HTTP ``Range`` requests and records every byte it serves, so a
    probe that claims "bounded local transport" can be checked against what the
    transport actually handed over rather than against what the client chose to
    count. The ledger is the server's, not the client's.
    """

    #: Set by build_handler to a shared, mutable byte ledger.
    ledger: dict = {}

    def guess_type(self, path):  # noqa: D102 - stdlib hook
        suffix = Path(str(path)).suffix.lower()
        if suffix in CONTENT_TYPES:
            return CONTENT_TYPES[suffix]
        return super().guess_type(path)

    def _record(self, path: str, start: int, end: int, *, ranged: bool) -> None:
        length = max(0, end - start)
        self.ledger["bytes"] = self.ledger.get("bytes", 0) + length
        self.ledger["requests"] = self.ledger.get("requests", 0) + 1
        if ranged:
            self.ledger["ranged"] = self.ledger.get("ranged", 0) + 1
        else:
            self.ledger["full"] = self.ledger.get("full", 0) + 1
        per_file = self.ledger.setdefault("perFile", {})
        entry = per_file.setdefault(path, {"bytes": 0, "requests": 0, "ranges": []})
        entry["bytes"] += length
        entry["requests"] += 1
        entry["ranges"].append([start, end])

    def send_head(self):  # noqa: D102 - stdlib hook
        path = self.translate_path(self.path)
        if not Path(path).is_file():
            return super().send_head()
        size = Path(path).stat().st_size
        header = self.headers.get("Range")
        if not header or not header.startswith("bytes="):
            self._record(self.path, 0, size, ranged=False)
            return super().send_head()

        # Single-range form only, which is what the COG readers issue.
        spec = header[len("bytes="):].split(",")[0].strip()
        try:
            first, _, last = spec.partition("-")
            if first == "":
                start = max(0, size - int(last))
                end = size - 1
            else:
                start = int(first)
                end = int(last) if last else size - 1
        except ValueError:
            self.send_error(416, "Malformed Range header")
            return None
        if start >= size or start < 0:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        end = min(end, size - 1)

        handle = Path(path).open("rb")
        handle.seek(start)
        self._record(self.path, start, end + 1, ranged=True)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        return _RangeReader(handle, end - start + 1)

    def end_headers(self):
        if self.headers.get("Range") is None:
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


class _RangeReader:
    """File-like wrapper that yields at most ``length`` bytes to copyfile."""

    def __init__(self, handle, length: int) -> None:
        self.handle = handle
        self.remaining = length

    def read(self, amount: int = -1) -> bytes:
        if self.remaining <= 0:
            return b""
        if amount < 0 or amount > self.remaining:
            amount = self.remaining
        data = self.handle.read(amount)
        self.remaining -= len(data)
        return data

    def close(self) -> None:
        self.handle.close()


def build_handler(harness: Path, bench: Path, fixtures: Path, import_map: Path,
                  ledger: dict):
    payload = json.loads(import_map.read_text())
    runner_html = (harness / "runner.html").read_text().replace(
        "__QUAL_IMPORT_MAP__",
        '<script type="importmap">' + json.dumps(payload, sort_keys=True) + "</script>",
    )
    overlay = Path(tempfile.mkdtemp(prefix="qual-runner-"))
    (overlay / "runner.html").write_text(runner_html)
    # Inert stubs for Node builtins pulled in by a candidate's ESM entry point.
    stub_root = import_map.parent / "stubs"

    class Handler(QualHandler):
        def __init__(self, *args, **kwargs):
            self.ledger = ledger
            super().__init__(*args, **kwargs)

        def translate_path(self, path: str) -> str:
            clean = path.split("?", 1)[0].split("#", 1)[0]
            roots = (
                ("/runner/", harness),
                ("/stub/", stub_root),
                ("/wb/", bench / "node_modules" / "whitebox-wasm"),
                ("/ct/", bench / "node_modules" / "cog-tiler-wasm"),
                ("/nm/", bench / "node_modules"),
                ("/fx/", fixtures),
            )
            if clean in ("", "/", "/runner.html"):
                return str(overlay / "runner.html")
            resolved: Path | None = None
            for prefix, root in roots:
                if clean.startswith(prefix):
                    resolved = root / clean[len(prefix):]
                    break
            if resolved is None:
                resolved = overlay / "runner.html"
            if not resolved.is_file():
                # Candidate peers use extensionless relative imports, which a
                # plain static server does not resolve.
                for suffix in MODULE_SUFFIXES:
                    candidate = Path(str(resolved) + suffix)
                    if candidate.is_file():
                        resolved = candidate
                        break
            if not resolved.is_file():
                # Name the specifier that failed so a browser 404 is diagnosable
                # instead of guessed at.
                print(f"MISS {clean} -> {resolved}", file=sys.stderr, flush=True)
            return str(resolved)

        def log_message(self, fmt, *args):
            pass

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bench", required=True, type=Path,
                        help="directory containing node_modules with the candidate packages")
    parser.add_argument("--fixtures", required=True, type=Path,
                        help="fixture root exposed read-only at /fx/")
    parser.add_argument("--import-map", required=True, type=Path,
                        help="import map generated by ts/dist/src/importMap.js")
    parser.add_argument("--port", type=int, default=8799)
    parser.add_argument("--ledger", type=Path,
                        help="write the served-byte ledger here when the server stops")
    args = parser.parse_args()

    harness = Path(__file__).resolve().parent
    bench, fixtures = args.bench.resolve(), args.fixtures.resolve()
    for required in (bench / "node_modules" / "whitebox-wasm" / "whitebox_wasm.js",
                     bench / "node_modules" / "cog-tiler-wasm" / "cog-tiler.js"):
        if not required.is_file():
            print(f"ERROR: missing candidate file {required}", file=sys.stderr)
            return 2
    if not fixtures.is_dir():
        print(f"ERROR: fixture root {fixtures} is not a directory", file=sys.stderr)
        return 2

    ledger: dict = {"bytes": 0, "requests": 0, "ranged": 0, "full": 0, "perFile": {}}
    handler = build_handler(harness, bench, fixtures, args.import_map.resolve(), ledger)
    socketserver.TCPServer.allow_reuse_address = True

    def shutdown(_signum, _frame):
        # serve_forever() returns once shutdown() is requested from another
        # thread; do that so the ledger write in `finally` always runs.
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"serving on http://127.0.0.1:{args.port}/", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            # The ledger is the transport's own record of what it served. It is
            # emitted on a marked line so the driver can attach it to the run
            # without trusting any client-side counter.
            if args.ledger:
                args.ledger.write_text(json.dumps(ledger, sort_keys=True) + "\n")
                print(f"LEDGER {args.ledger}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
