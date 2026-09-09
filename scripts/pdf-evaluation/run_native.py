"""Serve the built fixture on loopback and own one native probe process."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import platform
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parent
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'output' / platform.system().lower()
assert not output.exists(), 'Use a fresh test output directory'
assert (ROOT / 'dist/index.html').is_file(), 'Run npm run build first'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=ROOT / 'dist'))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
url = f'http://127.0.0.1:{server.server_port}/'
arguments = [url, str(output), str(ROOT / 'native/run-fixture.js')]
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
