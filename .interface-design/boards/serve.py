"""Serve the rendered boards: python3 .interface-design/boards/serve.py [port]  (default 47213), then open http://127.0.0.1:47213/"""
import http.server
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=OUT, **kw)

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    if not os.path.isdir(OUT):
        sys.exit('nothing rendered yet: run python3 .interface-design/boards/build.py first')
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 47213
    print(f'http://127.0.0.1:{port}/')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
