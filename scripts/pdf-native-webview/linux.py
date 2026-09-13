"""Run the fixed fixture in an actual GTK3/WebKitGTK 4.1 WebView."""
import base64
import json
import os
from pathlib import Path
import platform
import sys
from urllib.parse import urlparse

os.environ.setdefault('WEBKIT_DISABLE_DMABUF_RENDERER', '1')  # Canopi's Linux startup setting.
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2

url, destination, script_path = sys.argv[1:]
assert urlparse(url).hostname == '127.0.0.1'
output = Path(destination)
output.mkdir(parents=True, exist_ok=False)
code = Path(script_path).read_text()
status = 1
finished = False


def fail(message):
    global finished
    if not finished:
        finished = True
        print(message, file=sys.stderr)
        Gtk.main_quit()
    return False


def received(_manager, result):
    global status, finished
    try:
        message = result.get_js_value().to_string()
        assert len(message) < 10_000_000, 'Oversized fixture result'
        data = json.loads(message)
        if 'error' in data:
            raise RuntimeError(data['error'])
        (output / 'pdfkit.pdf').write_bytes(base64.b64decode(data['pdf'], validate=True))
        (output / 'pdfkit.json').write_text(json.dumps(data['report'], ensure_ascii=False, indent=2) + '\n')
        assert 1 <= len(data['previews']) <= 3, 'Expected one to three previews'
        for index, png in enumerate(data['previews'], 1):
            (output / f'preview-{index}.png').write_bytes(base64.b64decode(png, validate=True))
        (output / 'runtime.json').write_text(json.dumps({
            'host': 'GTK3 WebKitGTK 4.1', 'os': platform.platform(),
            'engine': '.'.join(str(f()) for f in [WebKit2.get_major_version, WebKit2.get_minor_version, WebKit2.get_micro_version]),
            'delivery': 'Native fixed-path binary write; no save dialog',
        }, indent=2) + '\n')
        status = 0
        finished = True
        Gtk.main_quit()
    except Exception as error:
        fail(str(error))


def evaluated(view, result):
    try:
        view.evaluate_javascript_finish(result)
    except GLib.Error as error:
        fail(str(error))


def loaded(view, event):
    if event == WebKit2.LoadEvent.FINISHED:
        view.evaluate_javascript(code, -1, None, None, None, evaluated)


manager = WebKit2.UserContentManager()
manager.register_script_message_handler('canopiEvaluation')
manager.connect('script-message-received::canopiEvaluation', received)
view = WebKit2.WebView.new_with_user_content_manager(manager)
view.connect('load-changed', loaded)
view.connect('load-failed', lambda _view, _event, _uri, error: fail(str(error)))
window = Gtk.Window(title='Canopi PDF native runtime probe')
window.set_default_size(1100, 800)
window.add(view)
window.connect('destroy', lambda _window: fail('Probe window closed before completion'))
deadline = GLib.timeout_add_seconds(120, lambda: fail('Native PDF probe timed out'))
window.show_all()
view.load_uri(url)
try:
    Gtk.main()
finally:
    if GLib.MainContext.default().find_source_by_id(deadline):
        GLib.source_remove(deadline)
    manager.unregister_script_message_handler('canopiEvaluation')
    window.destroy()
sys.exit(status)
