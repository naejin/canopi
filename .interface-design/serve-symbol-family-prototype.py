"""Local, read-only symbol review. No dependencies or writes.

Run: python3 .interface-design/serve-symbol-family-prototype.py [path/to/design.canopi]
Open http://127.0.0.1:4183. Without a path, use the page's file picker.
"""
import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("design", nargs="?", type=Path)
parser.add_argument("--port", type=int, default=4183)
args = parser.parse_args()
page = Path(__file__).with_name("plant-symbol-family-prototype.html")
design = args.design.read_bytes() if args.design else None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/plant-symbol-family-prototype.html"):
            payload, content_type = page.read_bytes(), "text/html; charset=utf-8"
        elif self.path == "/__review_design" and design:
            payload, content_type = design, "application/json"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass


print(f"Symbol study: http://127.0.0.1:{args.port}", flush=True)
HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
