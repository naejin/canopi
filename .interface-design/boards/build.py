"""Render the design boards to static HTML.

python3 .interface-design/boards/build.py            → out/<Board>.html for every board, out/index.html, out/assets/
python3 .interface-design/boards/build.py Name ...   → only those boards (assets and index are always refreshed)

Boards are registered by importing boards_a, boards_site, boards_b and boards_nav. Everything under out/ is generated and ignored by git.
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
sys.path.insert(0, HERE)
import ds  # noqa: E402

DEFS = open(os.path.join(HERE, 'defs-v3.svg.part')).read()

# Board rows on the index page, in reading order.
ROWS = [
    ('Foundations: tokens, components, icons and behavior rules', ['DesignSystem', 'DesignSystemDark', 'Rules']),
    ('Start a Design and find the site', ['Start', 'LocateSite', 'SiteFound', 'Overview']),
    ('The workspace on your orchard', ['Workspace', 'FindPlants', 'SelectedToList', 'NamesOnMap']),
    ('Moving and turning the map: compass, pointing device', ['Navigation', 'NavigationSettings', 'NavigationPhone']),
    ('Designing: catalog and placing', ['Catalog', 'CatalogFilters', 'SpeciesDetail', 'PlacePlants', 'PlantRow', 'StampPlace']),
    ('Designing: selection, appearance, zones, notes', ['Selection', 'Appearance', 'ZoneDraw', 'ZoneSelected', 'MeasureText']),
    ('Layers', ['Layers']),
    ('Site data: panel, values, profile, import, analysis, library', ['SiteData', 'SiteDataValues', 'SiteDataMissing', 'SiteDataProfile', 'Import', 'AnalyzeDialog', 'Library']),
    ('Planned analyses', ['WaterFlow']),
    ('Planning', ['Calendar', 'CalendarAction', 'Budget', 'Consortium', 'Notebook', 'Favorites']),
    ('Output and system', ['PdfExport', 'PdfKeyPage', 'Menus', 'SaveStates', 'Settings', 'ProblemReport', 'Shortcuts']),
    ('Empty, loading and error states', ['EmptyStates', 'LoadingStates', 'ErrorStates']),
    ('Stories: saved views told as a story, inside Canopi', ['StoryAuthor', 'StoryPresent', 'StoryPhone']),
    ('Web Edition and phones', ['WebWorkspace', 'WebPhone', 'WebPhoneLayers', 'WebPhoneSearch']),
    ('Dark theme and French', ['CatalogDark', 'LayersDark', 'SiteDataDark', 'LibraryDark', 'SettingsDark', 'French', 'FrenchDialogs']),
]


def blob(name):
    """URL of a generated asset, relative to the board page (see assets.py)."""
    return f'assets/{name}.{"json" if name == "orchard-json" else "svg"}'


BOARDS = {}  # name -> dict(w, h, title, group, fn, dark, script, props, interactive, root_class)


def board(name, w=1440, h=900, title='', group='', dark=False, script=None, props=None, interactive=False, root_class=None):
    def deco(fn):
        BOARDS[name] = dict(w=w, h=h, title=title or name, group=group, fn=fn, dark=dark, script=script, props=props,
                            interactive=interactive, root_class=root_class)
        return fn
    return deco


STATIC_SCRIPT = 'class Component extends DCLogic {\n  renderVals() { return {}; }\n}'


def render(name):
    b = BOARDS[name]
    body = b['fn']()
    # Templated resource attributes are renamed so the browser does not fetch "{{...}}" from the inert template;
    # runtime.js sets them under their real name once evaluated.
    body = body.replace(' href="{{', ' :href="{{').replace(' src="{{', ' :src="{{')
    symbols = f'<svg width="0" height="0" style="position: absolute;" aria-hidden="true"><defs>\n{DEFS}\n</defs></svg>' if ('#p-' in body or '#p-' in (b['script'] or '')) else ''
    props = {k: v.get('default') if isinstance(v, dict) else v for k, v in (b['props'] or {}).items()}
    script = b['script'] or STATIC_SCRIPT
    root_cls = b['root_class'] or ('th dark' if b['dark'] else 'th')
    doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{ds.esc(b['title'])}</title>
{ds.FONTS}
<style>
{ds.css()}
body{{display:flex;justify-content:center;padding:24px 0}}
</style>
<script src="./runtime.js" defer></script>
</head>
<body>
<template id="board">
<div class="{root_cls}" style="width: {b['w']}px; height: {b['h']}px; position: relative; overflow: hidden; background: var(--paper); flex: none;">
{symbols}
{body}
</div>
</template>
<script type="application/json" id="board-props">{json.dumps(props)}</script>
<script type="text/x-board-logic" id="board-logic">
{script}
</script>
</body>
</html>
'''
    with open(os.path.join(OUT, f'{name}.html'), 'w') as f:
        f.write(doc)


def write_index():
    rows = ''
    for title, names in ROWS:
        items = ''.join(f'<li><a href="{n}.html">{ds.esc(BOARDS[n]["title"])}</a> <span class="muted">{n} · {BOARDS[n]["w"]}×{BOARDS[n]["h"]}'
                        f'{" · interactive" if BOARDS[n]["interactive"] else ""}</span></li>' for n in names if n in BOARDS)
        rows += f'<section><h2>{ds.esc(title)}</h2><ul>{items}</ul></section>'
    listed = {n for _, names in ROWS for n in names}
    rest = ''.join(f'<li><a href="{n}.html">{ds.esc(BOARDS[n]["title"])}</a> <span class="muted">{n}</span></li>' for n in BOARDS if n not in listed)
    if rest:
        rows += f'<section><h2>Other boards</h2><ul>{rest}</ul></section>'
    doc = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Canopi v2 design boards</title>{ds.FONTS}
<style>body{{margin:0;padding:32px;background:#EFE9DD;color:#27231D;font:15px/1.5 'Source Sans 3',system-ui,sans-serif;max-width:900px}}
h1{{font-family:Literata,Georgia,serif;font-weight:600;font-size:28px;margin:0 0 4px}}h2{{font-family:Literata,Georgia,serif;font-weight:600;font-size:18px;margin:28px 0 6px}}
ul{{margin:0;padding-left:20px}}li{{margin:2px 0}}a{{color:#8A4E12}}.muted{{color:#645A4C;font-size:13px}}</style></head>
<body><h1>Canopi v2 design boards</h1><p class="muted">The agreed target for the v2 interface. Generated by <code>.interface-design/boards/build.py</code>; rules live in <code>.interface-design/system.md</code> and its pattern files.</p>
{rows}</body></html>
'''
    with open(os.path.join(OUT, 'index.html'), 'w') as f:
        f.write(doc)


def main(names):
    os.makedirs(OUT, exist_ok=True)
    import assets
    assets.write_all(os.path.join(OUT, 'assets'))
    shutil.copy(os.path.join(HERE, 'runtime.js'), os.path.join(OUT, 'runtime.js'))
    import boards_a  # noqa: F401  (registers boards on this module)
    import boards_site  # noqa: F401
    import boards_b  # noqa: F401
    import boards_nav  # noqa: F401
    unknown = [n for n in names if n not in BOARDS]
    if unknown:
        sys.exit(f'unknown board(s): {" ".join(unknown)}; known: {" ".join(BOARDS)}')
    for n in names or list(BOARDS):
        render(n)
    write_index()
    with open(os.path.join(OUT, 'boards.json'), 'w') as f:
        json.dump({n: {'w': b['w'], 'h': b['h'], 'title': b['title'], 'interactive': b['interactive']} for n, b in BOARDS.items()}, f, indent=1)
    print(' '.join(f"{n}:{BOARDS[n]['w']}x{BOARDS[n]['h']}" for n in names or BOARDS))
    print(f'{len(names or BOARDS)} board(s) written to {os.path.relpath(OUT)}')


if __name__ == '__main__':
    import build as _self  # the board modules import "build", so register on that module object
    _self.main(sys.argv[1:])
