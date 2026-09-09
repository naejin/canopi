"""Serve the built fixture on loopback and own one native probe process."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import platform
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('output', nargs='?', type=Path, default=ROOT / 'output' / platform.system().lower())
parser.add_argument('--fixture', type=Path, default=ROOT / 'dist')
parser.add_argument('--script', type=Path, default=ROOT / 'native/run-fixture.js')
args = parser.parse_args()
output = args.output.resolve()
fixture = args.fixture.resolve()
assert not output.exists(), 'Use a fresh test output directory'
assert (fixture / 'index.html').is_file(), 'Run npm run build first'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=fixture))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
url = f'http://127.0.0.1:{server.server_port}/'
arguments = [url, str(output), str(args.script.resolve())]
system = platform.system()
try:
    if system == 'Linux':
        command = [sys.executable, str(ROOT / 'native/linux.py'), *arguments]
    elif system == 'Darwin':
        command = ['swift', str(ROOT / 'native/macos.swift'), *arguments]
    elif system == 'Windows':
        project = ROOT / 'native/windows/Probe.csproj'
        subprocess.run(['dotnet', 'build', str(project), '--configuration', 'Release'], check=True, timeout=180)
        command = [str(project.parent / 'bin/Release/net8.0-windows/Probe.exe'), *arguments]
    else:
        raise RuntimeError(f'Unsupported native host: {system}')
    subprocess.run(command, check=True, timeout=180)
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
print(f'Native output: {output}')
