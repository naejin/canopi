"""Boards: site data, planning, output, system, web, theme and language, states."""
from build import board, blob
from common import *  # noqa: F401,F403
import ds


# ============================================================ site data
def layer_row(name, count='', vis=True, lock=None, active=False, indent=0, sub=''):
    eye = ib('eye' if vis else 'eye-off', ('Hide ' if vis else 'Show ') + name, size='sm')
    if lock is None:
        lk = ''
    elif lock:
        lk = ib('lock', 'Unlock ' + name, size='sm', cls='soft')
    else:
        lk = ib('unlock', 'Lock ' + name, size='sm', cls='quiet')
    s = f'<span class="small muted">{esc(sub)}</span>' if sub else ''
    c = f'<span class="count">{esc(count)}</span>' if count else ''
    return (f'<div class="row{" sel" if active else ""}" style="min-height: 38px; padding-left: {6 + indent}px; gap: 6px;">{eye}'
            f'<button type="button" aria-current="{"true" if active else "false"}" style="flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; border: 0; background: transparent; font: inherit; color: {"var(--ink)" if vis else "var(--muted)"}; cursor: pointer; text-align: left; min-height: 36px; padding: 0;">'
            f'<span style="display: flex; flex-direction: column; min-width: 0; line-height: 1.2;"><span style="font-weight: {600 if active else 400};">{esc(name)}</span>{s}</span></button>{c}{lk}</div>')


def site_footer(which):
    if which == 'slope':
        head = '<b style="font-weight: 600;">Slope</b><span class="small muted">degrees</span>'
        legend = ('<div style="height: 10px; border-radius: 5px; background: linear-gradient(90deg,#FFF3C4,#F2A541,#B5402A);"></div>'
                  '<div class="small muted num" style="display: flex; justify-content: space-between;"><span>0°</span><span>8°</span><span>16° and more</span></div>')
        acts = (ib('fit', 'Fit to Slope', size='sm') + f'<button type="button" class="btn sm" aria-pressed="true">{icon("target", "s16")}Read values</button>'
                + '<span style="flex: 1 1 auto;"></span>' + btn('Remove from Design', 'link', size='sm'))
        op = 70
    else:
        head = '<b style="font-weight: 600;">Terrain · IGN 0.5 m</b><span class="small muted">Elevation</span>'
        legend = ('<div style="height: 10px; border-radius: 5px; background: linear-gradient(90deg,#2F4A5E,#7FA38A,#E9E0B3,#C9854A);"></div>'
                  '<div class="small muted num" style="display: flex; justify-content: space-between;"><span>112 m</span><span>131 m</span></div>')
        acts = (ib('fit', 'Fit to Terrain', size='sm') + f'<button type="button" class="btn sm" aria-pressed="false">{icon("target", "s16")}Read values</button>'
                + btn('Analyze…', size='sm') + '<span style="flex: 1 1 auto;"></span>' + btn('Remove from Design', 'link', size='sm', aria='Remove Terrain · IGN 0.5 m from this Design'))
        op = 80
    return (f'<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;"><div style="display: flex; justify-content: space-between; align-items: baseline;">{head}</div>'
            f'{legend}{slider("Opacity", op, "%")}<div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">{acts}</div></div>')


def layers_panel(active='terrain', add_menu=False, progress=None, web=False, details=True):
    rows = ((f'<div style="display: flex; align-items: center; justify-content: space-between; padding-right: 4px;">{sec("Design")}{btn("Add GeoJSON…", "link", "plus", "sm")}</div>') if web else sec('Design')) + layer_row('Plants', '2,201', lock=False) + layer_row('Zones', '3', lock=False) + layer_row('Notes and measurements', '5', lock=True)
    rows += (sec('Site data') if web else (f'<div style="display: flex; align-items: center; justify-content: space-between; padding-right: 4px;">{sec("Site data")}'
             f'<button type="button" class="btn link sm" aria-haspopup="menu" aria-expanded="{"true" if add_menu else "false"}">{icon("plus", "s16")}Add data</button></div>'))
    if web:
        rows += notice('info', 'Terrain and height data need Canopi Desktop. They stay in this Design and show again there.', 'desktop')
    elif progress:
        rows += layer_row('Terrain · IGN 0.5 m', sub='Elevation · 112–131 m') + layer_row('Slope', sub='from Terrain · degrees', indent=22) + layer_row('Hillshade', sub='from Terrain', indent=22, vis=False) + layer_row('Contours', sub='from Terrain · every 1 m', indent=22, vis=False)
        rows += (f'<div class="row" style="flex-direction: column; align-items: stretch; gap: 6px; padding: 8px 10px; background: var(--surface-2);">'
                 f'<div style="display: flex; justify-content: space-between; gap: 8px;"><span style="font-weight: 600;">Terrain · IGN 0.5 m · 2024</span><span class="small muted num">Processing · {progress}%</span></div>'
                 f'<div class="bar" role="progressbar" aria-valuenow="{progress}" aria-valuemin="0" aria-valuemax="100" aria-label="Import progress: Terrain · IGN 0.5 m · 2024"><i style="width: {progress}%;"></i></div>'
                 f'<div style="display: flex; gap: 6px; align-items: center;">{btn("Cancel import", size="sm")}<span class="small muted">You can keep working.</span></div></div>')
    else:
        rows += layer_row('Terrain · IGN 0.5 m', sub='Elevation · 112–131 m', active=(active == 'terrain'))
        rows += layer_row('Slope', sub='from Terrain · degrees', indent=22, active=(active == 'slope'))
        rows += layer_row('Hillshade', sub='from Terrain', indent=22, vis=False)
        rows += layer_row('Contours', sub='from Terrain · every 1 m', indent=22, vis=False)
    rows += sec('Background')
    rows += '<div role="radiogroup" aria-label="Background">' + radio('Satellite', True, 'bg', '<span class="small muted">Google</span>') + radio('Map', False, 'bg', '<span class="small muted">OpenFreeMap</span>') + radio('None', False, 'bg', '<span class="small muted">Plain paper</span>') + '</div>'
    foot = site_footer(active) if (details and not web and not progress) else ''
    p = panel('Layers', f'<div class="scroll" style="display: flex; flex-direction: column; gap: 2px; overflow-y: auto;">{rows}</div>', foot=foot,
              bottom=(64 if foot else None))
    m = ''
    if add_menu:
        m = menu([('#', 'Add to this Design'), ('Terrain or height from files…', '', 'ic:terrain desc:GeoTIFF_from_LiDAR_or_a_national_survey'), ('Design objects from GeoJSON…', '', 'ic:import desc:Plants,_zones,_notes'), '-',
                  ('#', 'From your library'), ('Terrain · IGN 0.5 m', 'In this Design', 'dis ic:terrain'), ('Canopy height · 2024', '', 'ic:terrain'), '-', ('Data library…', '', 'ic:folder')], 320,
                 ' position: absolute; right: 88px; top: 304px; z-index: 2;', label='Add data')
    return p + m


@board('Layers', title='Layers · design, site data and background in one list', group='sitedata')
def layers():
    return site_map() + layers_panel('terrain') + chrome(panel='layers')


@board('AddDataMenu', title='Add data · one entry point, library included', group='sitedata')
def add_data_menu():
    return site_map() + layers_panel('terrain', add_menu=True, details=False) + chrome(panel='layers')


@board('AddData', title='Import terrain data · coverage and name checked before import', group='sitedata')
def add_data():
    files = ''.join(f'<div class="row" style="min-height: 38px; gap: 6px; padding: 0 4px 0 8px;">{icon("file", "s16")}<span class="mono" style="font-size: 12.5px; flex: 1 1 auto;">{f}</span><span class="small muted">{s}</span>'
                    f'{ib("chev-u", "Move " + f + " up", size="sm", extra=" disabled" if i == 0 else "")}{ib("chev-d", "Move " + f + " down", size="sm", extra=" disabled" if i == 1 else "")}{ib("close", "Remove " + f, size="sm")}</div>'
                    for i, (f, s) in enumerate([('LHD_FXX_0470_6800_MNT_O_0M50.tif', '38 MB'), ('LHD_FXX_0470_6801_MNT_O_0M50.tif', '41 MB')]))
    body = (field('Name', textin('Terrain · IGN 0.5 m', aria='Name', err=True), 'Your library already has an item with this name. Choose another, for example “Terrain · IGN 0.5 m · 2024”.', err=True)
            + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;">'
            + field('What the values measure', dropdown('Elevation', 'What the values measure')) + field('Unit', dropdown('Meters', 'Unit')) + '</div>'
            + f'<div class="field"><span class="lbl">Files · 2</span><div class="card" style="padding: 4px;">{files}</div><span class="hint">Where files overlap, the first file wins.</span></div>'
            + notice('info', '<b style="font-weight: 600;">Covers your site.</b> The two tiles span 2 × 1 km around this Design.', 'check')
            + '<span class="hint">Imported data goes to your library, so any Design can use it.</span>')
    dlg = dialog('Import terrain data', body, btn('Cancel') + btn('Import 2 files', 'primary'), 540)
    return site_map() + layers_panel('terrain', details=False) + chrome(panel='layers') + '<div class="scrim"></div>' + f'<div style="position: absolute; left: 50%; top: 96px; transform: translateX(-50%);">{dlg}</div>'


@board('ImportProgress', title='Import in progress · you can keep working', group='sitedata')
def import_progress():
    return site_map() + layers_panel(progress=62) + chrome(panel='layers')


@board('SlopeAnalysis', title='Slope · result nested under its terrain, values on hover', group='sitedata')
def slope():
    card = (f'<div class="float" role="status" style="position: absolute; left: 704px; top: 470px; padding: 8px 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; font-size: 14px;">'
            f'<span class="small muted num">48.2201° N, 0.0350° E</span><span>Elevation <b class="num" style="font-weight: 600;">118.4 m</b></span><span>Slope <b class="num" style="font-weight: 600;">6.2°</b></span></div>'
            '<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true"><circle cx="690" cy="462" r="7" fill="none" stroke="#1A160F" stroke-width="4"></circle><circle cx="690" cy="462" r="7" fill="none" stroke="#FFFFFF" stroke-width="2"></circle><circle cx="690" cy="462" r="1.5" fill="#FFFFFF"></circle></svg>')
    return (f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard"></div><img src="{blob("slope-overlay")}" alt="Slope overlay" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px; opacity: 0.7;">'
            f'<img src="{blob("plants-site")}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">'
            + card + layers_panel('slope') + chrome(panel='layers', attrib='© Google · IGN'))


@board('AnalyzeDialog', title='Analyze terrain · results nest under their source', group='sitedata')
def analyze():
    opts = ''.join(
        f'<label class="row{" tile-sel" if on else ""}" style="min-height: 58px; gap: 12px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer;">'
        f'<input type="radio" name="an" checked="{{{{ {"true" if on else "false"} }}}}"{" disabled" if dis else ""}><span style="display: flex; flex-direction: column; line-height: 1.3; flex: 1 1 auto;"><b style="font-weight: 600;{" color: var(--muted);" if dis else ""}">{a}</b><span class="small muted">{b}</span></span></label>'
        for a, b, on, dis in [('Slope', 'Already in Layers.', False, True),
                              ('Hillshade', 'Already in Layers.', False, True),
                              ('Contours', 'Lines of equal height. Every 1 m is already in Layers; add another interval.', True, False),
                              ('Aspect', 'Which way slopes face. Coming in a later version.', False, True)])
    body = (f'<p style="margin: 0;">From <b style="font-weight: 600;">Terrain · IGN 0.5 m</b>. The result is added under it in Layers and kept in your library.</p>'
            f'<div role="radiogroup" aria-label="Analysis" style="display: flex; flex-direction: column; gap: 6px;">{opts}</div>'
            f'<div style="width: 180px;">{field("Contour interval", dropdown("0.5 m", "Contour interval"))}</div>')
    dlg = dialog('Analyze terrain', body, btn('Cancel') + btn('Add contours', 'primary'), 500)
    return site_map() + layers_panel('terrain') + chrome(panel='layers') + '<div class="scrim"></div>' + f'<div style="position: absolute; left: 50%; top: 150px; transform: translateX(-50%);">{dlg}</div>'


@board('Library', title='Data library · shared by all your Designs', group='sitedata')
def library():
    items = [('Terrain · IGN 0.5 m', 'Elevation · 0.5 m · 112–131 m', 'In this Design'), ('Slope from Terrain · IGN 0.5 m', 'Slope · degrees', 'In this Design'),
             ('Canopy height · 2024', 'Height · 1 m · 0–24 m', ''), ('Terrain · Haie nord', 'Elevation · 0.5 m', '')]
    rows = ''.join(f'<div class="row" style="min-height: 60px; gap: 12px;"><span style="width: 56px; height: 42px; border-radius: 6px; flex-shrink: 0; background: linear-gradient(135deg,#2F4A5E,#7FA38A 45%,#E9E0B3 75%,#C9854A);" aria-hidden="true"></span>'
                   f'<span style="display: flex; flex-direction: column; flex: 1 1 auto; line-height: 1.25;"><b style="font-weight: 600;">{a}</b><span class="small muted">{b}</span></span>'
                   + (f'<span class="badge">{c}</span>' if c else btn('Add to Design', size='sm', aria=f'Add {a} to this Design')) + ib('more', 'More actions for ' + a, size='sm') + '</div>' for a, b, c in items[:2] + [('Hillshade from Terrain · IGN 0.5 m', 'Hillshade', 'In this Design'), ('Contours from Terrain · IGN 0.5 m', 'Contours · every 1 m', 'In this Design')])
    confirm = (f'<div class="row" role="alertdialog" aria-label="Delete from library" style="min-height: 60px; gap: 12px; padding: 10px; background: var(--danger-soft); box-shadow: inset 3px 0 0 var(--danger); flex-wrap: wrap;">'
               f'<span style="flex: 1 1 280px; font-size: 14px;">Delete “Canopy height · 2024” from the library? It is used by 2 Designs: Haie fruitière nord, Jardin de la mare. They will lose this layer.</span>'
               f'{btn("Cancel", size="sm")}{btn("Delete everywhere", "danger", size="sm")}</div>')
    rows += confirm + ''.join(f'<div class="row" style="min-height: 60px; gap: 12px;"><span style="width: 56px; height: 42px; border-radius: 6px; flex-shrink: 0; background: linear-gradient(135deg,#2F4A5E,#7FA38A 45%,#E9E0B3 75%,#C9854A);" aria-hidden="true"></span>'
                              f'<span style="display: flex; flex-direction: column; flex: 1 1 auto; line-height: 1.25;"><b style="font-weight: 600;">{a}</b><span class="small muted">{b}</span></span>'
                              + btn('Add to Design', size='sm', aria=f'Add {a} to this Design') + ib('more', 'More actions for ' + a, size='sm') + '</div>' for a, b, c in items[3:])
    body = (f'<div style="display: flex; gap: 8px;"><div style="flex: 1 1 auto;">{search("Search data")}</div>{dropdown("All types", "Type")}{btn("Import…", "", "import", "md")}</div>'
            f'<div style="display: flex; flex-direction: column; gap: 2px;">{rows}</div>'
            '<p class="hint" style="margin: 0;">Removing an item from one Design keeps it in the library. Deleting it here removes it from every Design.</p>')
    dlg = dialog('Data library', body, f'<span class="small muted" style="flex: 1 1 auto;">6 items · 1.2 GB on this computer</span>{btn("Show in folder", "ghost")}{btn("Done")}', 700)
    return site_map() + chrome() + '<div class="scrim"></div>' + f'<div style="position: absolute; left: 50%; top: 72px; transform: translateX(-50%);">{dlg}</div>'


# ============================================================ planning
def dock(title, body, active, foot='', head_extra='', sub='', wide=False, back=False):
    return site_map() + panel(title, body, foot=foot, head_extra=head_extra, sub=sub, wide=wide, back=back) + chrome(panel=active)


ACTIONS = [('Planting', '#3E7A3A', 'circle'), ('Pruning', '#7B4FA0', 'triangle'), ('Harvest', '#B0452F', 'square'),
           ('Watering', '#1F6F8B', 'drop'), ('Fertilizing', '#8A6D12', 'diamond'), ('Other', '#6E685E', 'ring')]
_SHAPE = {'circle': '<circle cx="6" cy="6" r="5"></circle>', 'triangle': '<path d="M6 1l5 9H1z"></path>', 'square': '<rect x="1.5" y="1.5" width="9" height="9" rx="1"></rect>',
          'drop': '<path d="M6 1s4 4.2 4 6.6A4 4 0 0 1 2 7.6C2 5.2 6 1 6 1z"></path>', 'diamond': '<path d="M6 .8l5.2 5.2L6 11.2.8 6z"></path>',
          'ring': '<circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="2"></circle>'}


def amark(kind, size=10):
    name, col, shp = next(a for a in ACTIONS if a[0] == kind)
    return f'<svg viewBox="0 0 12 12" aria-hidden="true" style="width: {size}px; height: {size}px; color: {col}; fill: currentColor; flex-shrink: 0;">{_SHAPE[shp]}</svg>'


@board('Calendar', title='Calendar · month with ranges, agenda for the selected day', group='planning')
def calendar():
    days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    head = ''.join(f'<span role="columnheader" class="small muted" style="text-align: center; font-weight: 600;">{d}</span>' for d in days)
    single = {3: ['Harvest'], 11: ['Watering', 'Harvest'], 17: ['Planting'], 26: ['Planting']}
    ranges = [('Pruning', 7, 10), ('Fertilizing', 21, 24)]
    cells, week = '', []
    for i in range(35):
        dnum = i - 1  # en-US weeks start on Sunday; September 1, 2026 is a Tuesday
        inm = 1 <= dnum <= 30
        n = dnum if inm else (31 + dnum if dnum < 1 else dnum - 30)
        marks = ''.join(amark(e, 9) for e in single.get(dnum, []))
        bars = ''.join(f'<span style="position: absolute; left: {0 if dnum > a else 6}px; right: {0 if dnum < b else 6}px; bottom: 5px; height: 5px; border-radius: 3px; background: {next(x[1] for x in ACTIONS if x[0] == k)};"></span>'
                       for k, a, b in ranges if a <= dnum <= b)
        today, sel = dnum == 26, dnum == 11
        acts = list(single.get(dnum, [])) + [k for k, a, b in ranges if a <= dnum <= b]
        month = 'September' if inm else ('August' if dnum < 1 else 'October')
        lab = f'{n} {month}' + (', today' if today else '') + (f', {len(acts)} action{"s" if len(acts) != 1 else ""}: ' + ', '.join(acts) if acts else '') + (', selected' if sel else '')
        week.append(f'<div role="gridcell" style="display: contents;"><button type="button" aria-label="{lab}" class="{"tile-sel" if sel else ""}" style="position: relative; height: 46px; border-radius: 8px; border: 1px solid transparent; background: transparent; '
                  f'font: inherit; font-size: 13px; color: {"var(--ink)" if inm else "var(--muted)"}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 6px; gap: 3px;">'
                  f'<span class="num" style="{"font-weight: 600; color: var(--accent-ink); text-decoration: underline; text-underline-offset: 3px;" if today else ""}">{n}</span><span style="display: flex; gap: 3px;">{marks}</span>{bars}</button></div>')
    rows_html = ''.join('<div role="row" style="display: contents;">' + ''.join(week[r * 7:(r + 1) * 7]) + '</div>' for r in range(5))
    legend = ''.join(f'<span class="small" style="display: flex; align-items: center; gap: 6px;">{amark(k, 11)}{k}</span>' for k, c, s in ACTIONS)
    agenda = ''.join(
        f'<div class="row" style="min-height: 52px; gap: 10px;"><input type="checkbox" aria-label="Mark {esc(t)} done" checked="{{{{ {"true" if done else "false"} }}}}" style="accent-color: var(--accent); width: 16px; height: 16px; margin: 0;">'
        f'{amark(k, 14)}<span style="display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; line-height: 1.25;"><b style="font-weight: 600;{" text-decoration: line-through; color: var(--muted);" if done else ""}">{esc(t)}</b><span class="small muted">{esc(k)} · {esc(tg)}</span></span>'
        f'{ib("edit", "Edit " + t, size="sm")}</div>'
        for t, k, tg, done in [('Water the young goji', 'Watering', '232 Goji', True), ('Harvest late raspberries', 'Harvest', '142 Framboisier', False)])
    body = f'''
  <div style="display: flex; align-items: center; gap: 6px; padding: 0 2px 8px;">{ib("chev-l", "Previous month", size="sm")}<h3 style="font-size: 15px; font-weight: 600; flex: 1 1 auto; text-align: center;">September 2026</h3>{ib("chev-r", "Next month", size="sm")}{btn("Today", size="sm")}</div>
  <div role="grid" aria-label="September 2026" style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; padding: 0 2px;"><div role="row" style="display: contents;">{head}</div>{rows_html}</div>
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; padding: 10px 6px;">{legend}</div>
  <div class="rule"></div>
  <div style="display: flex; align-items: baseline; justify-content: space-between; padding: 10px 6px 4px;"><h3 style="font-size: 14px; font-weight: 600;">Friday, September 11</h3><span class="small muted">2 actions</span></div>
  {agenda}
  <div style="padding: 6px;">{btn("Add action on September 11", "ghost", "plus", "sm")}</div>'''
    return dock('Calendar', body, 'calendar', head_extra=btn('Expand', 'ghost', 'expand', 'sm'),
                foot=f'<span class="small muted" style="flex: 1 1 auto;">3 actions without a date</span>{btn("Show", "link", size="sm")}')


@board('CalendarAction', title='Calendar · new action with a range, repeat and targets', group='planning')
def calendar_action():
    types = ''.join(f'<button type="button" role="radio" aria-checked="{"true" if k == "Pruning" else "false"}" class="chip">{amark(k, 11)}{k}</button>' for k, c, s in ACTIONS)
    picks = ''.join(f'<label role="option" aria-selected="{"true" if on else "false"}" class="row" style="min-height: 40px; gap: 10px; cursor: pointer;"><input type="checkbox" checked="{{{{ {"true" if on else "false"} }}}}" style="accent-color: var(--accent); width: 16px; height: 16px; margin: 0;">'
                    f'{glyph("apple", "#B06045", 20)}<span class="sp-name" style="flex: 1 1 auto;"><b>{cn}</b><i lang="la">{sci}</i></span><span class="code">{k}</span></label>'
                    for cn, sci, k, on in [('Prunier commun', '<mark>Pru</mark>nus domestica', 'PDO', True), ('Abricotier', '<mark>Pru</mark>nus armeniaca', 'PAR', False),
                                           ('Pêcher', '<mark>Pru</mark>nus persica', 'PPE', False), ('Merisier', '<mark>Pru</mark>nus avium', 'PAV', False)])
    tokens = ''.join(f'<span class="token">{glyph(g, c, 16)}{n}<button type="button" aria-label="Remove {n}">{icon("close", "s16")}</button></span>' for g, c, n in [("apple", "#B06045", "Pommier cultivé"), ("apple", "#B06045", "Poirier"), ("apple", "#B06045", "Prunier commun")])
    targets = ('<div class="segs" role="radiogroup" aria-label="Targets">'
               '<button type="button" role="radio" class="seg on" aria-checked="true">Species</button>'
               '<button type="button" role="radio" class="seg" aria-checked="false" aria-disabled="true" style="opacity: 0.5;">Selected plants</button>'
               '<button type="button" role="radio" class="seg" aria-checked="false">Zone</button>'
               '<button type="button" role="radio" class="seg" aria-checked="false">Whole Design</button></div>')
    body = f'''
  <div class="scroll" style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 2px 8px 8px;">
    {field("Title", textin("Winter pruning of the fruit trees", aria="Title"))}
    <div class="field"><span class="lbl" id="at">Action type</span><div role="radiogroup" aria-labelledby="at" style="display: flex; flex-wrap: wrap; gap: 6px;">{types}</div></div>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">{field("Start", textin("Jan 15, 2027", ic="calendar", aria="Start date"))}{field("End", textin("Feb 28, 2027", ic="calendar", aria="End date"))}</div>
    {check("Repeat every year", True)}
    <div class="field"><span class="lbl">Targets</span>{targets}</div>
    <div style="display: flex; justify-content: space-between; align-items: baseline;"><span class="small"><b style="font-weight: 600;">3 species chosen</b> <span class="muted">· 13 plants</span></span>{btn("Show chosen", "link", size="sm")}</div>
    <div style="position: relative;">{finder("pru", [], "", focus=True, placeholder="Add species: name, scientific name or code")}
      <div class="menu" role="listbox" aria-multiselectable="true" aria-label="Matching species" style="margin-top: 4px; padding: 5px; max-height: 214px; overflow-y: auto;">
        <div class="mhead" style="display: flex; justify-content: space-between; align-items: center;">6 species match “pru”{btn("Add all 6", "link", size="sm")}</div>
        {picks}
      </div></div>
  </div>'''
    return dock('New action', body, 'calendar', back=True, foot=f'<span style="flex: 1 1 auto;"></span>{btn("Cancel")}{btn("Add action", "primary")}')


@board('Budget', title='Budget · unit costs per species, totals always visible', group='planning')
def budget():
    rows = [('berry', '#AB5268', 'Goji', 'Lycium barbarum', 'LBA', 232, '4.50', True), ('herb', '#428063', 'Menthe verte', 'Mentha spicata', 'MSP', 257, '2.80', False),
            ('herb', '#428063', 'Consoude officinale', 'Symphytum officinale', 'SOF2', 202, '', False), ('herb', '#428063', 'Mélisse', 'Melissa officinalis', 'MOF', 148, '2.50', False),
            ('berry', '#AB5268', 'Framboisier', 'Rubus idaeus', 'RID', 142, '3.90', False), ('berry', '#AB5268', 'Groseillier rouge', 'Ribes rubrum', 'RRU', 120, '5.20', False),
            ('apple', '#B06045', 'Pommier cultivé', 'Malus domestica', 'MDO', 6, '28.00', False)]

    def price(v, focus, name):
        return (f'<span class="input{" focus" if focus else ""}" style="width: 88px; height: 32px; padding: 0 8px; flex-shrink: 0;"><span class="muted small">€</span>'
                f'<input type="text" inputmode="decimal" value="{v}" placeholder="—" aria-label="Unit cost for {esc(name)}" style="text-align: right;" class="num"></span>')
    body_rows = ''.join(
        f'<div class="row" style="min-height: 48px; gap: 8px; padding: 0 6px 0 8px;">{glyph(sy, c)}<span class="sp-name" style="flex: 1 1 auto;"><b>{esc(cn)}</b><i lang="la">{esc(ln)}</i></span>'
        f'<span class="code">{k}</span><span class="count" style="width: 36px; text-align: right; flex-shrink: 0;">{n}</span>{price(p, f, cn)}'
        f'<span class="num" style="flex: 0 0 84px; text-align: right; font-weight: 600;{" color: var(--muted); font-weight: 400;" if not p else ""}">{("€{:,.2f}".format(n * float(p))) if p else "No price"}</span></div>'
        for sy, c, cn, ln, k, n, p, f in rows)
    body = f'''
  <div style="padding: 0 2px 4px;">{finder("", [("Selected on map", False), ("Missing a price · 21", False), ("Stratum", "menu"), ("Sort: Total", "menu")])}</div>
  <div style="display: flex; justify-content: flex-end; gap: 0; padding: 2px 6px 4px;" class="small muted"><span style="width: 36px; text-align: right;">Plants</span><span style="width: 96px; text-align: right;">Unit cost</span><span style="width: 84px; text-align: right;">Total</span></div>
  <div class="scroll" style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 1px;">{body_rows}</div>'''
    foot = (f'<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">'
            f'<div style="display: flex; justify-content: space-between; align-items: baseline;"><span class="small muted">2,201 plants · 96 of 117 species priced</span><b class="disp num" style="font-size: 20px;">€6,482.30</b></div>'
            f'<button type="button" aria-label="96 of 117 species priced. Show species missing a price" style="border: 0; padding: 9px 0; background: transparent; width: 100%; cursor: pointer;"><span class="bar" role="meter" aria-valuenow="96" aria-valuemin="0" aria-valuemax="117" style="display: block;"><i style="width: 82%;"></i></span></button>'
            f'<div style="display: flex; gap: 6px; align-items: center;">{dropdown("Euro (EUR)", "Currency")}<span style="flex: 1 1 auto;"></span>{btn("Export CSV…", "", "export", "md")}</div>'
            f'<span class="hint">Changing the currency relabels prices; it does not convert them.</span></div>')
    return dock('Budget', body, 'budget', foot=foot, wide=True)


@board('Consortium', title='Consortium · strata across succession phases', group='planning')
def consortium():
    phases = [('Placenta', ['1', '2', '3'], ['90 days', '180 days', '1–3 years']), ('Secondary', ['1', '2', '3'], ['3–15 years', '15–25 years', '25–60 years']), ('Climax', [''], ['60+ years'])]
    strata = [('Emergent', [0, 0, 0, 2, 5, 7, 7]), ('High', [0, 0, 3, 9, 14, 12, 10]), ('Mid', [0, 4, 11, 18, 16, 13, 9]), ('Low', [14, 22, 26, 21, 15, 9, 6])]
    names = [f'{g} {n}'.strip() for g, ns, _ in phases for n in ns]
    durs = [d for _, _, ds in phases for d in ds]
    STEPS = [(0, 'transparent', 'var(--muted)'), (5, '#EFE9DF', '#27231D'), (10, '#DDD0BC', '#27231D'), (15, '#C4B091', '#27231D'), (20, '#9C8664', '#1D1A14'), (99, '#5E4B32', '#FFFFFF')]
    thead = ('<tr><th scope="col" style="width: 76px;"></th>' + ''.join(f'<th scope="colgroup" colspan="{len(ns)}" class="small" style="font-weight: 600; border-bottom: 1px solid var(--line); padding-bottom: 2px;">{g}</th>' for g, ns, _ in phases) + '</tr>'
             '<tr><th></th>' + ''.join(f'<th scope="col" style="font-weight: 400; padding: 2px 0 4px;"><span class="small" style="display: block; font-weight: 600;">{n or "&nbsp;"}</span><span class="small muted" style="display: block; line-height: 1.15;">{d}</span></th>'
                                       for (g, ns, ds) in phases for n, d in zip(ns, ds)) + '</tr>')
    tbody = ''
    for s, vals in strata:
        tds = ''
        for i, v in enumerate(vals):
            bg, fg = next((b, f) for lim, b, f in STEPS if v <= lim)
            sel = False
            hit = s == 'High' and i >= 3
            dot = '<span aria-hidden="true" style="position: absolute; right: 4px; top: 4px; width: 8px; height: 8px; border-radius: 4px; background: #D6AA28; box-shadow: 0 0 0 1.5px #27231D;"></span>' if hit else ''
            tds += (f'<td style="padding: 1.5px;"><button type="button" aria-pressed="{"true" if sel else "false"}" aria-label="{s} stratum, {names[i]} ({durs[i]}): {v} species{", includes a match" if hit else ""}" class="num{" cell-sel" if sel else ""}" '
                    f'style="position: relative; width: 100%; height: 38px; border-radius: 6px; border: 1px solid var(--line); background: {bg}; font: inherit; font-size: 13px; font-weight: 600; color: {fg}; cursor: pointer;">{v if v else "·"}{dot}</button></td>')
        tbody += f'<tr><th scope="row" class="small" style="text-align: left; font-weight: 600; vertical-align: middle;">{s}</th>{tds}</tr>'
    table = f'<table style="width: 100%; border-collapse: collapse; table-layout: fixed; text-align: center;"><caption class="sr">Species per stratum and succession phase</caption><thead>{thead}</thead><tbody>{tbody}</tbody></table>'
    high = [x for x in ORCH['species'] if x['k'] in ('MDO', 'MSY')]
    lst = (f'<div class="small muted" style="display: flex; justify-content: flex-end; gap: 0; padding: 0 12px 2px;"><span style="width: 40px; text-align: right;">Plants</span><span style="width: 128px; text-align: right;">Phases</span></div>'
           + ''.join(species_row(x['s'], x['c'], x['cn'], x['n'], x['k'], x['count'], trail='<span class="small muted" style="width: 120px; text-align: right; line-height: 1.2;">Secondary 1 → Climax</span>', verb='Show on map:')
                     for x in high)).replace('<b>Pommier', '<b><mark>Pommier</mark>')
    body = f'''
  <div style="padding: 0 2px 8px;">{finder("pommier", [("Selected on map", False), ("Form", "menu")], "2 species · found in 4 cells, marked with a dot")}</div>
  <div style="padding: 0 4px 6px;">{table}</div>
  <p class="hint" style="margin: 0 6px 8px;">Each cell counts the species present in that stratum and phase. Choose a cell to list them.</p>
  <div class="rule"></div>
  <div style="display: flex; align-items: baseline; justify-content: space-between; padding: 10px 6px 4px;"><h3 style="font-size: 14px; font-weight: 600;">Matching “pommier” · 2 species</h3>{btn("Clear", "link", size="sm")}</div>
  <div class="scroll" style="flex: 1 1 0; min-height: 0; overflow-y: auto;">{lst}</div>'''
    sub = f'117 species · <button type="button" class="btn link sm" style="height: 24px; padding: 0;">9 have no stratum yet</button>'
    return dock('Consortium', body, 'consortium', wide=True, sub=sub, head_extra=btn('Expand', 'ghost', 'expand', 'sm'))


@board('Notebook', title='Design notebook · all your Designs, in sections', group='planning')
def notebook():
    def drow(n, meta, active=False):
        return (f'<div class="row{" sel" if active else ""}" style="min-height: 56px; gap: 6px; padding: 6px 6px 6px 2px;">{ib("grip", "Reorder " + n + " (Alt ↑ or ↓)", size="sm", cls="quiet")}'
                f'<button type="button" style="flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; padding: 0; cursor: pointer;"{" aria-current=" + chr(34) + "true" + chr(34) if active else ""}>'
                f'{icon("file")}<span style="display: flex; flex-direction: column; min-width: 0; line-height: 1.25;"><b style="font-weight: 600;">{esc(n)}</b><span class="small muted">{esc(meta)}{" · <b style=font-weight:600;color:var(--accent-ink)>Open now</b>" if active else ""}</span></span></button>'
                f'{ib("more", "More actions for " + n, size="sm")}</div>')
    body = (f'<div style="display: flex; gap: 6px; align-items: center; padding: 0 2px 8px;"><span class="badge">{icon("check", "s16")}This Design is in the notebook</span><span style="flex: 1 1 auto;"></span>{btn("New section", "ghost", "plus", "sm")}</div>'
            + sec('Clients · 2026') + drow(ORCHARD, '2,201 plants · today', True).replace('<b style=font-weight:600;color:var(--accent-ink)>', '<b style="font-weight: 600; color: var(--accent-ink);">') + drow('Jardin de la mare', '180 plants · Sep 12')
            + sec('Ideas') + drow('Haie fruitière nord', '64 plants · yesterday') + drow('Forêt comestible, version A', '412 plants · Aug 3')
            + sec('Not in a section') + drow('Essai guildes pommier', '22 plants · Jun 30'))
    return dock('Design notebook', body, 'notebook', sub='Shortcuts to Designs saved on this computer. Removing one here never deletes the file.')


@board('Favorites', title='Favorites and saved stamps', group='planning')
def favorites():
    def frow(sy, c, cn, ln, k=''):
        return species_row(sy, c, cn, ln, k, lead=ib('star', f'Remove {cn} from favorites', size='sm', cls='fav'),
                           trail=btn('Place', size='sm', aria=f'Place {cn}') + ib('more', 'More actions for ' + cn, size='sm'), verb='Details for')
    fav = frow('apple', '#B06045', 'Pommier cultivé', 'Malus domestica', 'MDO') + frow('pod', '#70814B', 'Chalef ombellifère', 'Elaeagnus umbellata', 'EUM') + frow('berry', '#AB5268', 'Goji', 'Lycium barbarum', 'LBA')
    stamps = ''.join(f'<div class="row" style="min-height: 52px; gap: 8px; padding: 0 6px 0 4px;">{ib("grip", "Reorder " + n + " (Alt ↑ or ↓)", size="sm", cls="quiet")}<span style="display: flex; gap: 2px; width: 62px; flex-shrink: 0;">{"".join(glyph(g, c, 18) for g, c in gl)}</span>'
                     f'<span style="display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; line-height: 1.25;"><b style="font-weight: 600;">{esc(n)}</b><span class="small muted">{esc(m)}</span></span>'
                     f'{btn("Place", size="sm", aria="Place stamp " + n)}{ib("more", "More actions for " + n, size="sm")}</div>'
                     for n, m, gl in [('Guilde pommier', '10 plants · 4 species', [('apple', '#B06045'), ('pod', '#70814B'), ('herb', '#428063')]),
                                      ('Rang petits fruits', '12 plants · 2 species', [('berry', '#AB5268'), ('berry', '#805878')])])
    body = (f'{search("Search favorites and stamps")}<div style="display: flex; align-items: center; justify-content: space-between;">{sec("Plants")}<span class="count" style="padding-right: 10px;">3</span></div>{fav}'
            f'<div class="rule" style="margin: 8px 0;"></div><div style="display: flex; align-items: center; justify-content: space-between; padding-right: 4px;">{sec("Saved stamps")}{btn("Import…", "link", size="sm")}</div>{stamps}'
            f'<div style="padding: 6px 4px;">{btn("Save as stamp…", "", "stamp", "sm")}</div>')
    return dock('Favorites and stamps', body, 'star')


# ============================================================ output
EN_FALLBACK = {'Pineapple guava', 'Russian sage', 'Corymb Fuchsia', 'Japanese helwingia', 'Acute buckwheat', 'Purple chokeberry', 'Madeira vine', 'Chinese magnolia vine', 'Oleaster'}
_LOWER = {'Vert', 'De', 'Du', 'Des', 'La', 'Le', 'À', 'Aux'}


def _cn(name):
    if not name:
        return ''
    words = name.split(' ')
    out = [words[0]] + [w.lower() if w in _LOWER else w for w in words[1:]]
    n = ' '.join(out)
    return n + ' (en)' if name in EN_FALLBACK else n


def _key_rows(group, font=9.2, lh=12.6):
    sp = [s for s in ORCH['species'] if s['l'] == group]
    rows = ''.join(f'<div style="display: flex; align-items: flex-start; gap: 5px; font-size: {font}px; line-height: {lh / font:.3f}; padding: 1px 0; break-inside: avoid;">'
                   f'<svg viewBox="0 0 24 24" aria-hidden="true" style="width: 11px; height: 11px; flex-shrink: 0; margin-top: 1px; color: {s["c"]}; --ko: #FFFFFF;"><use href="#p-{s["s"]}"></use></svg>'
                   f'<span class="mono" style="font-weight: 600; width: 26px; flex-shrink: 0;">{esc(s["k"])}</span>'
                   f'<span style="flex: 1 1 auto;">{esc(_cn(s["cn"]))} · <i lang="la">{esc(s["n"])}</i></span>'
                   f'<span class="num" style="width: 22px; text-align: right; flex-shrink: 0;">{s["count"]}</span></div>' for s in sp)
    title = 'No stratum yet' if group == 'None' else f'{group} stratum'
    return (f'<div style="break-inside: avoid-column; font-family: Literata, Georgia, serif; font-weight: 600; font-size: 11px; border-bottom: 0.75px solid #27231D; margin: 6px 0 3px; padding-bottom: 1px;">{title} '
            f'<span style="font-family: \'Source Sans 3\'; font-weight: 400; font-size: 9.2px;">· {len(sp)} species</span></div>{rows}', len(sp))


@board('PdfExport', w=1680, h=1040, title='Export planting plan · A3, plan on page 1, species key on page 2', group='output')
def pdf_export():
    opts = f'''
<aside class="sheet" aria-labelledby="pdf-t" style="position: absolute; left: 32px; top: 32px; width: 310px; padding: 18px 16px; display: flex; flex-direction: column; gap: 14px;">
  <h2 class="disp" id="pdf-t" style="font-size: 20px;">Export planting plan</h2>
  {field("Title on the sheet", textin(ORCHARD, aria="Title on the sheet"))}
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">{field("Paper", dropdown("A3 landscape", "Paper"))}{field("Scale", dropdown("1:120", "Scale"))}</div>
  {field("Area", dropdown("Whole Design", "Area"))}
  {field("Background", seg(["None", "Map", "Satellite"], "Satellite", "Background"))}
  {check("Fade the background", True)}
  {field("Plant colors", seg(["As in the Design", "Grayscale", "Black"], "As in the Design", "Plant colors"))}
  {field("Map orientation", seg(["North up", "As on screen"], "North up", "Map orientation"))}
  {slider("Symbol size on paper", "4.5", " mm", 3, 10)}
  <div style="display: flex; flex-direction: column; gap: 2px;"><span class="lbl">Include</span>{check("Species codes beside symbols", False)}{check("Zones and notes", True)}{check("Slope from Terrain", False)}{check("North arrow and scale bar", True)}</div>
  {field("Species key", seg(["On the plan", "On page 2"], "On page 2", "Species key"), "117 species: page 2 keeps the key readable.")}
  <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">{btn("Cancel")}{btn("Save PDF…", "primary")}</div>
</aside>'''
    used = sorted({s['s'] for s in ORCH['species']})
    NAMES = {'canopy': 'Canopy tree', 'shrub': 'Shrub', 'herb': 'Herb', 'fern': 'Fern', 'climber': 'Climber', 'groundcover': 'Groundcover', 'apple': 'Fruit', 'nut': 'Nuts',
             'berry': 'Berries', 'grape': 'Grapes', 'flower': 'Flowers', 'pod': 'N-fixer'}
    legend = ''.join(f'<span style="display: flex; align-items: center; gap: 5px; font-size: 10px;"><svg viewBox="0 0 24 24" aria-hidden="true" style="width: 14px; height: 14px; color: #27231D; --ko: #FFFFFF;"><use href="#p-{u}"></use></svg>{NAMES.get(u, u)}</span>' for u in used)
    k = 1.2
    sheet = f'''
<div class="print" role="img" aria-label="Page 1 preview: planting plan" style="position: absolute; left: 374px; top: 32px; width: 1276px; height: 902px; background: #FFFFFF; color: #27231D; box-shadow: 0 10px 30px rgba(30,22,10,0.25); padding: 30px; display: flex; gap: 22px; box-sizing: border-box;">
  <div style="width: 900px; height: 842px; position: relative; overflow: hidden; border: 1px solid #27231D; flex-shrink: 0;">
    <img src="{blob("orchard-sat")}" alt="" style="position: absolute; left: {450 - 640 * k}px; top: {421 - 470 * k}px; width: {1440 * k}px; height: {900 * k}px; opacity: 0.35; filter: grayscale(0.6);">
    <img src="{blob("plants-site")}" alt="" style="position: absolute; left: {450 - 640 * k}px; top: {421 - 470 * k}px; width: {1440 * k}px; height: {900 * k}px;">
    <div style="position: absolute; left: 12px; bottom: 10px; display: flex; align-items: flex-end; gap: 12px; background: rgba(255,255,255,0.92); padding: 6px 8px; border-radius: 3px; font-size: 10px;">
      <svg viewBox="0 0 24 32" style="width: 16px; height: 22px;" role="img" aria-label="North"><path d="M12 2l7 20-7-5-7 5z" fill="#27231D"></path></svg>
      <span style="display: flex; flex-direction: column; gap: 2px;"><span style="display: flex; width: 120px; height: 5px; border: 0.75px solid #27231D;"><i style="flex: 1; background: #27231D;"></i><i style="flex: 1;"></i><i style="flex: 1; background: #27231D;"></i><i style="flex: 1;"></i><i style="flex: 1; background: #27231D;"></i></span><span style="display: flex; justify-content: space-between;"><span>0</span><span>5 m</span></span></span>
      <span>1:120</span></div>
    <svg width="900" height="842" style="position: absolute; left: 0; top: 0;" aria-hidden="true"><polygon points="131,60 769,60 769,781 131,781" fill="none" stroke="#8A6D12" stroke-width="1.6" stroke-dasharray="6 4"></polygon></svg>
    <span style="position: absolute; left: 136px; top: 48px; font-size: 11px; font-weight: 600; color: #27231D; background: rgba(255,255,255,0.85); padding: 0 4px;">Verger syntropique · 1.07 ha</span>
    <span style="position: absolute; left: 560px; top: 520px; width: 150px; font-size: 10px; line-height: 1.3; color: #27231D; background: rgba(255,255,255,0.9); border: 0.75px solid #27231D; padding: 3px 5px;">Paillage BRF à renouveler en novembre</span>
    <span style="position: absolute; right: 8px; bottom: 6px; font-size: 9px;">Imagery © Google</span>
  </div>
  <div style="flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 12px;">
    <div style="border-bottom: 1.5px solid #27231D; padding-bottom: 8px;"><div style="font-family: Literata, Georgia, serif; font-weight: 600; font-size: 17px; line-height: 1.2;">{esc(ORCHARD)}</div>
      <div style="font-size: 11px; margin-top: 3px;">Planting plan · 2,201 plants · 117 species · September 26, 2026</div></div>
    <div style="font-family: Literata, Georgia, serif; font-weight: 600; font-size: 12px;">Symbols</div>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px;">{legend}</div>
    <div style="font-size: 10.5px; line-height: 1.4; border-top: 0.75px solid #27231D; padding-top: 8px;">Each species keeps its own color. The full species key, with codes and counts, is on page 2.</div>
    <div style="flex: 1 1 auto;"></div>
    <div style="font-size: 9.5px; color: #4A4237;">Page 1 of 2 · Made with Canopi</div>
  </div>
</div>
<nav aria-label="Pages" style="position: absolute; left: 374px; top: 950px; display: flex; gap: 10px; align-items: center;"><span class="small muted">Pages</span>
  <button type="button" aria-current="page" aria-label="Page 1: planting plan" class="tile-sel" style="width: 72px; height: 51px; border-radius: 5px; border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; color: var(--ink); display: flex; align-items: flex-end; justify-content: flex-start; padding: 4px 6px;">1 · Plan</button>
  <button type="button" aria-label="Page 2: species key" style="width: 72px; height: 51px; border-radius: 5px; background: #FFFFFF; border: 1px solid var(--line-strong); cursor: pointer; font: inherit; font-size: 12px; color: #27231D; display: flex; align-items: flex-end; justify-content: flex-start; padding: 4px 6px;">2 · Key</button></nav>'''
    return opts + sheet


@board('PdfKeyPage', w=1340, h=966, title='Export planting plan · page 2, the species key', group='output')
def pdf_key():
    lines = []
    for g in STRATA + ['None']:
        sp = [x for x in ORCH['species'] if x['l'] == g]
        title = 'No stratum yet' if g == 'None' else f'{g} stratum'
        lines.append(('h', title, len(sp)))
        lines += [('r', x) for x in sp]
    cap, cols, cur, last = 46, [], [], None
    for ln in lines:
        if ln[0] == 'h':
            last = ln
        if len(cur) >= cap or (ln[0] == 'h' and len(cur) >= cap - 2):
            cols.append(cur)
            cur = [('h', last[1] + ' (continued)', last[2])] if ln[0] == 'r' else []
        cur.append(ln)
    cols.append(cur)

    def render(ln):
        if ln[0] == 'h':
            return (f'<div style="font-family: Literata, Georgia, serif; font-weight: 600; font-size: 11px; border-bottom: 0.75px solid #27231D; margin: 6px 0 3px; padding-bottom: 1px;">{esc(ln[1])} '
                    f'<span style="font-family: \'Source Sans 3\'; font-weight: 400; font-size: 9.2px;">· {ln[2]} species</span></div>')
        x = ln[1]
        return (f'<div style="display: flex; align-items: flex-start; gap: 5px; font-size: 9.2px; line-height: 1.37; padding: 1px 0;">'
                f'<svg viewBox="0 0 24 24" aria-hidden="true" style="width: 11px; height: 11px; flex-shrink: 0; margin-top: 1px; color: {x["c"]}; --ko: #FFFFFF;"><use href="#p-{x["s"]}"></use></svg>'
                f'<span class="mono" style="font-weight: 600; width: 26px; flex-shrink: 0;">{esc(x["k"])}</span>'
                f'<span style="flex: 1 1 auto;">{esc(_cn(x["cn"]))} · <i lang="la">{esc(x["n"])}</i></span>'
                f'<span class="num" style="width: 22px; text-align: right; flex-shrink: 0;">{x["count"]}</span></div>')
    body = ''.join(f'<div style="flex: 1 1 0; min-width: 0;">{"".join(render(l) for l in col)}</div>' for col in cols)
    return f'''
<div class="print" role="img" aria-label="Page 2 preview: species key" style="position: absolute; left: 32px; top: 32px; width: 1276px; height: 902px; background: #FFFFFF; color: #27231D; box-shadow: 0 10px 30px rgba(30,22,10,0.25); padding: 30px 34px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px;">
  <div style="border-bottom: 1.5px solid #27231D; padding-bottom: 6px; display: flex; justify-content: space-between; align-items: baseline;"><span style="font-family: Literata, Georgia, serif; font-weight: 600; font-size: 15px;">Species key · {esc(ORCHARD)}</span><span style="font-size: 10px;">Code · common name · scientific name · plants · (en) = no name in French yet</span></div>
  <div style="display: flex; gap: 22px; flex: 1 1 auto;">{body}</div>
  <div style="font-size: 9.5px; color: #4A4237;">Page 2 of 2 · Made with Canopi</div>
</div>'''


# ============================================================ system
@board('Menus', w=1760, h=1040, title='Menus · every command, with its shortcut', group='system')
def menus():
    f = menu([('New Design', 'Ctrl N'), ('Open Design…', 'Ctrl O'), ('Open recent', '', 'sub'), '-', ('Rename…', 'F2'), ('Save as…', 'Ctrl Shift S'), ('Revert to the version when opened…', ''), '-',
              ('Add data…', ''), ('Data library…', ''), ('Import GeoJSON…', ''), ('Export', '', 'sub hot'), '-', ('Settings…', 'Ctrl ,'), '-', ('Close Design', 'Ctrl W'), ('Quit Canopi', 'Ctrl Q')], 300, label='File')
    exp = menu([('Planting plan (PDF)…', 'Ctrl P'), ('GeoJSON…', ''), ('Budget as CSV…', '')], 240, ' margin-top: 335px; margin-left: -10px;', label='Export')
    e = menu([('Undo', 'Ctrl Z'), ('Redo', 'Ctrl Shift Z'), '-', ('Cut', 'Ctrl X'), ('Copy', 'Ctrl C'), ('Paste', 'Ctrl V'), ('Duplicate', 'Ctrl D'), ('Delete', 'Del'), '-',
              ('Select all', 'Ctrl A'), ('Select all of this species', 'Ctrl Shift A'), ('Deselect', 'Esc'), '-', ('Symbol and color…', ''), ('Species details', ''), ('Add to calendar…', ''), ('Set unit cost…', ''), '-', ('Group', 'Ctrl G'), ('Ungroup', 'Ctrl Shift G'), ('Arrange', '', 'sub'), ('Rotate…', 'Ctrl Alt R'), '-',
              ('Lock', 'Ctrl Shift L'), ('Unlock all', ''), ('Save as stamp…', '')], 290, label='Edit')
    v = menu([('Zoom in', 'Ctrl +'), ('Zoom out', 'Ctrl −'), ('Fit to Design', 'Shift F'), ('Zoom to selection', 'Shift 2'), ('Search a place…', 'Ctrl K'), '-',
              ('Reset north', 'N'), ('Turn view left 15°', 'Shift ←'), ('Turn view right 15°', 'Shift →'), ('Pan', 'H'), '-',
              ('Grid', 'Shift G', 'nochk'), ('Snap to grid', 'Shift S', 'chk'), ('Labels', 'Shift L', 'sub'), ('Tool names', '', 'chk'), '-',
              ('Layers', 'Ctrl 1'), ('Plants in this Design', 'Ctrl 2'), ('Plant catalog', 'Ctrl 3'), ('Favorites and stamps', 'Ctrl 4'), ('Calendar', 'Ctrl 5'), ('Budget', 'Ctrl 6'), ('Consortium', 'Ctrl 7'), ('Design notebook', 'Ctrl 8'), '-',
              ('Background', '', 'sub'), ('Theme', '', 'sub')], 290, label='View')
    t = menu([('Select', 'V'), ('Pan', 'H'), '-', ('Place plants', 'P'), ('Plant a row', 'W'), ('Place a stamp', 'K'), '-', ('Polygon zone', 'Z'), ('Rectangle zone', 'R'), ('Ellipse zone', 'E'), ('Line zone', 'L'), '-', ('Text note', 'T'), ('Measure', 'M')], 240, label='Tools')
    h = menu([('Keyboard shortcuts', 'F1'), ('Getting started', ''), '-', ('Report a problem…', ''), ('About Canopi', '')], 240, label='Help')
    col = lambda title, m: f'<div style="display: flex; flex-direction: column; gap: 10px;"><h2 class="lbl">{title}</h2>{m}</div>'
    return (f'<div style="position: absolute; inset: 0; padding: 40px 48px; display: flex; flex-direction: column; gap: 22px;">'
            + H('Menus', 'Every command lives in a menu with its shortcut, so nothing depends on an icon or a gesture. On macOS these are the native menus.')
            + f'<div style="display: flex; gap: 22px; align-items: flex-start;">{col("File", f)}{exp}{col("Edit", e)}{col("View", v)}{col("Tools", t)}{col("Help", h)}</div></div>')


@board('SaveStates', w=1440, h=940, title='Saving · status in the title bar, problems explained', group='system')
def save_states():
    def bar(status, kind, extra=''):
        return (f'<div class="float" style="height: 50px; display: flex; align-items: center; gap: 10px; padding: 0 12px; max-width: 760px;">'
                f'<span class="disp" style="font-size: 17px; white-space: nowrap;">{esc(ORCHARD)}</span>{save_status(status, kind)}{extra}</div>')
    rows = [('Saved', bar('Saved', 'ok')), ('Saving', bar('Saving…', 'saving')),
            ('Draft (never saved to a file)', bar('Draft', 'draft', btn('Save as…', size='sm'))),
            ("Couldn't save", bar("Couldn’t save", 'err', btn('Details…', size='sm'))),
            ('Changed outside Canopi', bar('Changed outside Canopi', 'err', btn('Resolve…', size='sm')))]
    stack = ''.join(f'<div style="display: flex; flex-direction: column; gap: 6px;"><span class="lbl">{esc(a)}</span>{b}</div>' for a, b in rows)
    pop = (f'<div class="sheet" role="dialog" aria-label="Couldn’t save" style="width: 400px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; margin-top: -8px;">'
           f'<b style="font-weight: 600;">Couldn’t save your latest changes</b><span class="small" style="color: var(--ink-2);">The disk is full. Your work is safe in Canopi while it stays open. Free some space and retry, or save to another place.</span>'
           f'<div style="display: flex; gap: 8px; justify-content: flex-end;">{btn("Save as…", size="sm")}{btn("Retry", "primary", size="sm")}</div></div>')
    dlg = dialog('Changed outside Canopi',
                 '<p style="margin: 0;">Another program changed this file at 10:42 AM, after Canopi last saved it. Choose which version to keep.</p>'
                 '<div class="card" style="padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;"><span class="small muted">This file</span><span class="mono" style="font-size: 12.5px;">~/Designs/Verger syntropique v3.canopi</span></div>'
                 '<p class="small" style="margin: 0;">Using the file’s version discards your latest changes; Ctrl Z brings them back until you close the Design. Overwriting replaces the other program’s changes. Saving a copy keeps both.</p>',
                 btn('Save mine as a copy…', 'ghost') + '<span style="flex: 1 1 auto;"></span>' + btn("Use the file’s version") + btn('Overwrite with my version', 'danger'), 580)
    dlg2 = dialog('Revert to the version when opened?', '<p style="margin: 0;">Every change since you opened this Design at 9:12 AM will be replaced. You can undo this with Ctrl Z.</p>',
                  btn('Cancel') + btn('Revert', 'danger'), 580)
    return (f'<div style="position: absolute; inset: 0; padding: 40px 48px; display: grid; grid-template-columns: 760px minmax(0, 1fr); gap: 36px;">'
            f'<div style="display: flex; flex-direction: column; gap: 14px;">{H("Saving", "Canopi saves as you work. The title bar says what happened in plain words; problems open an explanation.")}{stack}{pop}</div>'
            f'<div style="padding-top: 90px; display: flex; flex-direction: column; gap: 28px;">{dlg}{dlg2}</div></div>')


SETTINGS_SECTIONS = [('sun', 'Appearance', 'appearance'), ('image', 'Map and imagery', 'map'), ('fit', 'Canvas', 'canvas'), ('plants', 'New Designs', 'new'),
                     ('keyboard', 'Keyboard', 'keyboard'), ('folder-open', 'Files and data', 'files'), ('info', 'About', 'about')]


def settings_content(section):
    if section == 'canvas':
        return f'''
    <h3 class="disp" id="st-sec" style="font-size: 20px;">Canvas</h3>
    {field("Pointing device", seg(["Mouse: the wheel zooms", "Trackpad: two fingers pan"], "Mouse: the wheel zooms", "Pointing device"), "Pinch and Ctrl + wheel always zoom. Shift + wheel pans.")}'''
    return f'''
    <h3 class="disp" id="st-sec" style="font-size: 20px;">Map and imagery</h3>
    {field("Satellite imagery", seg(["Free imagery", "My Google key"], "My Google key", "Satellite imagery"), "The free imagery needs no account. A Google Maps Platform key gives sharper, more recent imagery through the Map Tiles API.")}
    <div class="field"><label class="lbl" for="gk">Google Maps API key</label><div style="display: flex; gap: 6px; align-items: center;"><span class="input" style="flex: 1 1 auto;"><input id="gk" type="password" value="AIzaSyD-canopi-demo-key-Q4" aria-describedby="gk-s"></span>{btn("Show", "", size="md", aria="Show API key", extra=' aria-pressed="false"')}{btn("Remove key", "ghost", size="md")}</div></div>
    <div id="gk-s">{notice("info", "Key accepted. Canopi keeps it on this computer and never writes it into Designs, exports or problem reports.", "check")}</div>
    <div class="rule"></div>
    {field("Map style", dropdown("OpenFreeMap · Liberty", "Map style"))}
    <span class="hint">Whether new Designs open on satellite or on the map is set in New Designs.</span>'''


def settings_dialog(section='map'):
    nav = ''.join(f'<button type="button" class="row{" sel" if sid == section else ""}"{" aria-current=" + chr(34) + "page" + chr(34) if sid == section else ""} style="border: 0; width: 100%; font: inherit; color: inherit; cursor: pointer; min-height: 38px;{" font-weight: 600;" if sid == section else " background: transparent;"}">{icon(ic, "s18")}{t}</button>'
                  for ic, t, sid in SETTINGS_SECTIONS)
    return (f'<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="st-t" style="width: 840px; height: 580px; flex-direction: row; overflow: hidden;">'
            f'<nav aria-label="Settings sections" style="width: 220px; background: var(--surface-2); border-right: 1px solid var(--line); padding: 20px 10px; display: flex; flex-direction: column; gap: 2px;">'
            f'<h2 class="disp" id="st-t" style="margin: 0 8px 12px; font-size: 20px; line-height: 28px;">Settings</h2>{nav}</nav>'
            f'<div style="flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; position: relative;"><div style="position: absolute; right: 10px; top: 10px;">{ib("close", "Close settings", size="sm")}</div>'
            f'<div style="padding: 20px 28px 24px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;">{settings_content(section)}</div></div></div>')


@board('Settings', title='Settings · map and imagery', group='system')
def settings():
    return site_map() + chrome() + '<div class="scrim"></div>' + f'<div style="position: absolute; left: 50%; top: 140px; transform: translateX(-50%);">{settings_dialog("map")}</div>'


@board('ProblemReport', title='Report a problem', group='system')
def problem_report():
    body = ('<p style="margin: 0;">Canopi saves a summary and a diagnostic bundle in a folder you choose. Nothing is sent from here: attach them to an email or a forum post.</p>'
            + field('What happened?', '<textarea class="ta" aria-label="What happened?" placeholder="What you were doing, what went wrong, and whether you can repeat it.">After importing the second LiDAR tile, the slope layer stayed at 62% and Cancel import did nothing.</textarea>')
            + check('Attach a copy of this Design', False)
            + '<span class="hint" style="margin-top: -8px; padding-left: 25px;">Adds the Design with its coordinates, notes, calendar and budget.</span>'
            + notice('info', 'By default the bundle leaves out your Design, its coordinates, screenshots and file paths.', 'lock'))
    dlg = dialog('Report a problem', body, btn('Cancel') + btn('Save report…', 'primary'), 560)
    return site_map() + chrome() + '<div class="scrim"></div>' + f'<div style="position: absolute; left: 50%; top: 120px; transform: translateX(-50%);">{dlg}</div>'


@board('Shortcuts', h=1240, title='Keyboard shortcuts · keys and gestures', group='system')
def shortcuts():
    groups = [('Tools (anywhere except text fields)', [('Select', 'V'), ('Pan', 'H'), ('Place plants', 'P'), ('Plant a row', 'W'), ('Place a stamp', 'K'), ('Polygon · rectangle · ellipse · line zone', 'Z · R · E · L'), ('Text note', 'T'), ('Measure', 'M')]),
              ('Edit', [('Undo · Redo', 'Ctrl Z · Ctrl Shift Z'), ('Cut · Copy · Paste', 'Ctrl X · Ctrl C · Ctrl V'), ('Duplicate', 'Ctrl D'), ('Delete', 'Del'), ('Select all', 'Ctrl A'), ('Select all of this species', 'Ctrl Shift A'), ('Group · Ungroup', 'Ctrl G · Ctrl Shift G'), ('Rotate…', 'Ctrl Alt R'), ('Lock', 'Ctrl Shift L'),
                        ('Nudge 10 cm on screen', 'Arrows'), ('Nudge 1 m', 'Ctrl Arrows'), ('Reorder in a list', 'Alt ↑ · Alt ↓')]),
              ('View', [('Zoom in · out', '+ · − · Ctrl + · Ctrl −'), ('Fit the Design', 'Home · Shift F · Ctrl 0'), ('Zoom to selection', 'Shift 2'), ('Turn the view 15°', 'Shift ← · Shift →'), ('Reset north', 'N · Shift N · Shift ↑'),
                        ('Search a place', 'Ctrl K'), ('Search in the open panel', 'Ctrl F'), ('Labels: none, codes, names', 'Shift L'), ('Grid · Snap to grid', 'Shift G · Shift S'),
                        ('Layers · Plants · Catalog · Favorites', 'Ctrl 1 · 2 · 3 · 4'), ('Calendar · Budget · Consortium · Notebook', 'Ctrl 5 · 6 · 7 · 8')]),
              ('Mouse, trackpad and pen', [('Pan the map', 'Right-drag · Middle-drag · Space + drag'), ('Turn the view; add Ctrl (Cmd on Mac) for 15° steps', 'Shift + right-drag · Shift + middle-drag'),
                                           ('Click to reset north, drag to turn the view', 'Compass'), ('Open the menu', 'Right-click'), ('Zoom', 'Scroll wheel · Pinch · Ctrl + wheel'), ('Remove from the selection', 'Alt + click')]),
              ('File and help', [('New Design', 'Ctrl N'), ('Open Design', 'Ctrl O'), ('Rename', 'F2'), ('Save as', 'Ctrl Shift S'), ('Export planting plan', 'Ctrl P'), ('Settings', 'Ctrl ,'), ('Keyboard shortcuts', 'F1')])]
    cols = ''.join(f'<section style="display: flex; flex-direction: column; gap: 2px;"><h3 class="lbl" style="padding: 0 0 6px;">{g}</h3>'
                   + ''.join(f'<div style="display: flex; justify-content: space-between; gap: 12px; min-height: 30px; align-items: center; border-bottom: 1px solid var(--line);"><span>{a}</span><span style="display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end;">{"".join(kbd(x) for x in b.split(" · "))}</span></div>' for a, b in items)
                   + '</section>' for g, items in groups)
    esc_order = ('<div class="card" style="padding: 10px 12px; font-size: 13.5px; color: var(--ink-2); line-height: 1.45;"><b style="font-weight: 600; color: var(--ink);">Esc</b> does one thing at a time: close a menu or dialog, cancel what you are drawing, return to Select, clear the selection.</div>')
    dlg = dialog('Keyboard shortcuts', f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 32px;">{cols}</div>{esc_order}',
                 f'<span class="small muted" style="flex: 1 1 auto;">Tool keys work anywhere except text fields. Shift N works even when single-key shortcuts are off. macOS shows ⌘ ⌥ ⇧.</span>{btn("Close")}', 900, extra=' max-height: 1110px;')
    dlg = dlg.replace('<div class="dbody">', '<div class="dbody scroll" style="overflow-y: auto; min-height: 0;">', 1)
    return site_map() + chrome() + '<div class="scrim"></div>' + f'<div style="position: absolute; left: 50%; top: 72px; transform: translateX(-50%);">{dlg}</div>'


@board('ErrorStates', w=1440, h=1180, title='When something goes wrong', group='system')
def error_states():
    d1 = dialog("This Design can’t be opened", '<p style="margin: 0;">“Verger 2023.canopi” was made with an earlier version of Canopi. This version opens Designs made with Canopi 2 only.</p>'
                '<p style="margin: 0;">The file is unchanged. Open it in the version that made it, export it as GeoJSON, then import that here.</p>',
                btn('Show in folder', 'ghost') + btn('OK', 'primary'), 480)
    d2 = dialog('File moved or deleted', '<p style="margin: 0;">The file this Design was saved in is gone:</p><span class="mono" style="font-size: 12.5px;">~/Designs/Verger syntropique v3.canopi</span>'
                '<p style="margin: 0;">Your work is safe in Canopi. Save it again at that place, or choose another.</p>',
                btn('Save as…') + btn('Save to original location', 'primary'), 480)
    notes = ''.join(f'<div style="display: flex; flex-direction: column; gap: 6px;"><span class="lbl">{a}</span>{b}</div>' for a, b in [
        ('Plant catalog missing (Desktop)', notice('err', 'The plant catalog is missing. Reinstall Canopi to restore it. Your Designs are not affected.', 'alert', btn('How to fix', size='sm'))),
        ('Satellite key refused', notice('warn', 'Google refused the API key, so Canopi is showing the free imagery.', 'key', btn('Check key', size='sm'))),
        ('No connection', notice('info', 'Offline. The map shows imagery already on this computer. Your work is saved.', 'cloud-off')),
        ('Web: storage not available', notice('warn', 'This browser won’t keep your work (private browsing). Download a .canopi copy before closing the tab.', 'alert', btn('Download', size='sm'))),
        ('Place search found nothing', f'<div class="card" style="padding: 14px; display: flex; flex-direction: column; gap: 6px;">{search("Search a place or coordinates", "Epineux le chevreil")}<span class="small muted">No places found. Check the spelling, try a nearby town, or paste coordinates such as 48.2201, 0.0351.</span></div>'),
        ('Import failed', f'<div class="card" role="alert" style="padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; justify-content: space-between;"><b style="font-weight: 600;">Canopy height · 2024</b><span class="small" style="color: var(--danger); font-weight: 600;">Import failed</span></div><span class="small muted">This GeoTIFF is compressed in a format Canopi can’t read. Save it with LZW or no compression and import it again.</span><div style="display: flex; gap: 6px;">{btn("Choose another file", size="sm")}{btn("Dismiss", "ghost", size="sm")}</div></div>'),
        ('GeoJSON partly imported', f'<div style="align-self: flex-start;">{toast("Imported 60 of 64 features from haie-nord.geojson. 4 had no geometry.", "Details")}</div>'),
        ('PDF could not be saved', notice('err', 'The PDF could not be saved: the folder is read-only.', 'alert', btn('Choose another folder…', size='sm'))),
        ('Unexpected error', f'<div class="card" role="alert" style="padding: 14px; display: flex; flex-direction: column; gap: 8px;"><b class="disp" style="font-size: 17px;">Something went wrong</b><span class="small">Canopi hit an unexpected error. Your last changes were saved. Restart Canopi to continue.</span><div style="display: flex; gap: 6px;">{btn("Restart Canopi", "primary", size="sm")}{btn("Report a problem…", size="sm")}</div></div>')])
    return (f'<div style="position: absolute; inset: 0; padding: 40px 48px; display: flex; flex-direction: column; gap: 22px;">'
            + H('When something goes wrong', 'Say what happened, what is safe, and the one thing to do next.')
            + f'<div style="display: grid; grid-template-columns: 480px minmax(0, 1fr); gap: 36px;"><div style="display: flex; flex-direction: column; gap: 20px;">{d1}{d2}</div>'
            f'<div style="display: flex; flex-direction: column; gap: 14px;">{notes}</div></div></div>')


@board('EmptyStates', w=1440, h=900, title='Empty states · say what goes here and how to start', group='system')
def empty_states():
    def card(title, text, action, ic):
        return (f'<div class="card" style="padding: 18px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start;"><span class="lbl">{title}</span>'
                f'<div style="display: flex; gap: 12px; align-items: flex-start;"><span style="color: var(--muted);">{icon(ic)}</span><span style="font-size: 14.5px; color: var(--ink-2); line-height: 1.45;">{text}</span></div>{action}</div>')
    cards = [card('Plants in this Design', 'No plants yet. Find species in the Plant catalog, then click Place or drag them onto the map.', btn('Open plant catalog', size='sm'), 'plants'),
             card('Plant catalog · no results', 'No species match “Malus” with these 3 filters.', btn('Clear filters', size='sm'), 'catalog'),
             card('Favorites and stamps', 'Star a species in the catalog to keep it here. Select plants on the map and save them as a stamp to reuse a group.', btn('Open plant catalog', size='sm'), 'star'),
             card('Calendar · empty month', 'Nothing planned in September.', btn('Add action', size='sm'), 'calendar'),
             card('Budget', 'Place plants first; each species then gets a line for its unit cost.', btn('Open plant catalog', size='sm'), 'budget'),
             card('Consortium', 'Place plants to see which strata and succession phases your Design covers.', btn('Open plant catalog', size='sm'), 'consortium'),
             card('Data library', 'No data yet. Import terrain or height files once, then add them to any Design.', btn('Import…', size='sm'), 'terrain'),
             card('Design notebook', 'Saved Designs you add appear here, grouped in sections.', btn('Add this Design', size='sm'), 'notebook')]
    return (f'<div style="position: absolute; inset: 0; padding: 40px 48px; display: flex; flex-direction: column; gap: 22px;">' + H('Empty states')
            + f'<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px;">{"".join(cards)}</div></div>')


@board('LoadingStates', w=1440, h=860, title='Loading states · keep the frame, show progress where it happens', group='system')
def loading_states():
    skel = ''.join(f'<div style="display: flex; gap: 10px; align-items: center; padding: 8px;"><span style="width: 26px; height: 26px; border-radius: 13px; background: var(--surface-2);"></span>'
                   f'<span style="flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px;"><span style="height: 10px; width: {w}%; border-radius: 5px; background: var(--surface-2);"></span><span style="height: 8px; width: {w - 20}%; border-radius: 4px; background: var(--surface-2);"></span></span></div>' for w in (70, 55, 80, 62))
    items = [('Place search', f'<div class="card" style="padding: 12px; display: flex; flex-direction: column; gap: 8px;">{search("Search a place or coordinates", "Ballon")}<span role="status" class="small muted" style="display: flex; gap: 6px; align-items: center;">{icon("clock", "s16")}Searching…</span></div>'),
             ('Plant catalog query', f'<div class="card" aria-busy="true" style="padding: 6px;">{skel}</div>'),
             ('Opening a large Design', f'<div class="card" style="padding: 14px; display: flex; flex-direction: column; gap: 8px;"><b style="font-weight: 600;">Opening {esc(ORCHARD)}</b><div class="bar" role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100" aria-label="Opening Design"><i style="width: 40%;"></i></div><span class="small muted">2,201 plants · placing symbols</span></div>'),
             ('Map imagery', notice('info', 'Loading imagery for this area…', 'clock'))]
    cols = ''.join(f'<div style="display: flex; flex-direction: column; gap: 8px;"><span class="lbl">{a}</span>{b}</div>' for a, b in items)
    return (f'<div style="position: absolute; inset: 0; padding: 40px 48px; display: flex; flex-direction: column; gap: 22px;">' + H('Loading states')
            + f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; max-width: 1000px;">{cols}</div></div>')


# ============================================================ web edition
@board('WebWorkspace', title='Web Edition · same workspace, file actions as icons', group='web')
def web_workspace():
    t = topbar(ORCHARD, 'Saved in this browser', 'web', web=True, search_label='Search a place', status_action=btn('Download a copy', 'link', size='sm'))
    return site_map() + layers_panel(web=True) + t + toolrail() + panelrail('layers') + viewchip() + zoombar()


@board('WebPhone', w=390, h=844, title='Web Edition on a phone · map first, panels in a sheet', group='web')
def web_phone():
    rows = ''.join(species_row(sy, c, cn, ln, k, n) for sy, c, cn, ln, k, n in [
        ('herb', '#428063', 'Menthe verte', 'Mentha spicata', 'MSP', '257'), ('berry', '#AB5268', 'Goji', 'Lycium barbarum', 'LBA', '232'),
        ('herb', '#428063', 'Consoude officinale', 'Symphytum officinale', 'SOF2', '202'), ('herb', '#428063', 'Mélisse', 'Melissa officinalis', 'MOF', '148')])
    tabs = ''.join(f'<button type="button" role="tab" aria-selected="{"true" if t == "Plants" else "false"}" class="chip" style="min-height: 44px; flex-shrink: 0;">{t}</button>' for t in ['Layers', 'Plants', 'Catalog', 'Calendar', 'More'])
    return f'''
<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard" style="left: -445px; top: -80px; width: 1440px; height: 900px;"></div>
<div style="position: absolute; inset: 0; overflow: hidden;"><img src="{blob("plants-site")}" alt="" style="position: absolute; left: -445px; top: -80px; width: 1440px; height: 900px;"></div>
<header class="float" style="position: absolute; left: 8px; right: 8px; top: 8px; height: 56px; display: flex; align-items: center; gap: 2px; padding: 0 4px;">
  {ib("menu", "Menu", size="touch")}<div style="flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; line-height: 1.2;"><span class="disp" style="font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{esc(ORCHARD)}</span>{save_status("Saved in this browser", "web")}</div>
  {ib("undo", "Undo", size="touch")}{ib("search", "Search a place", size="touch")}
</header>
<div class="float" role="toolbar" aria-label="Tools" style="position: absolute; left: 8px; top: 72px; display: flex; flex-direction: column; gap: 2px; padding: 4px;">{ib("select", "Select", True, "touch")}{ib("hand", "Pan", size="touch")}{ib("plant", "Place plants", size="touch")}{ib("polygon", "Polygon zone", size="touch")}{ib("more", "More tools", size="touch")}</div>
<div class="float" role="group" aria-label="Zoom" style="position: absolute; right: 8px; top: 256px; display: flex; flex-direction: column; gap: 2px; padding: 4px;">{ib("plus", "Zoom in", size="touch")}{ib("minus", "Zoom out", size="touch")}{ib("fit", "Fit to Design", size="touch")}{compass(0, size="touch")}</div>
<span class="attrib" style="position: absolute; right: 8px; bottom: 400px;">© Google</span>
<span class="float num" style="position: absolute; left: 8px; bottom: 404px; padding: 2px 8px; border-radius: 8px; font-size: 12.5px;">1:190</span>
<section class="float" aria-label="Panels" style="position: absolute; left: 0; right: 0; bottom: 0; height: 392px; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; padding: 4px 10px 0; padding-bottom: env(safe-area-inset-bottom);">
  <button type="button" aria-label="Expand sheet" aria-expanded="false" style="align-self: center; width: 88px; height: 44px; margin: -10px 0 -10px; border: 0; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span style="width: 40px; height: 5px; border-radius: 3px; background: var(--line-strong);"></span></button>
  <div role="tablist" aria-label="Panels" style="display: flex; gap: 4px; overflow-x: auto; padding-bottom: 8px;">{tabs}</div>
  <div style="display: flex; align-items: baseline; justify-content: space-between; padding: 0 4px 6px;"><h2 class="disp" style="font-size: 18px;">Plants in this Design</h2><span class="count">2,201</span></div>
  {search("Search names or codes", touch=True)}
  <div style="display: flex; flex-direction: column; margin-top: 6px;">{rows}</div>
</section>'''


@board('WebPhoneSearch', w=390, h=844, title='Web Edition on a phone · finding the site', group='web')
def web_phone_search():
    res = [('Ballon-Saint-Mars', 'Sarthe, Pays de la Loire, France'), ('Saint-Mars-sous-Ballon', 'Ballon-Saint-Mars, Sarthe'), ('Ballon', 'Le Mans, Sarthe, France'), ('Ballon-en-Sarthe', 'Sarthe, France')]
    results = ''.join(f'<div role="option" aria-selected="{"true" if i == 0 else "false"}" class="mi{" hot" if i == 0 else ""}" style="min-height: 56px; gap: 12px;">{icon("pin")}<span style="display: flex; flex-direction: column; line-height: 1.25; min-width: 0;"><b style="font-weight: 600;">{a}</b><span class="small" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{b}</span></span></div>'
                      for i, (a, b) in enumerate(res))
    return f'''
{mapbg(blob("world-z3"), 0.35)}
<div class="float" role="dialog" aria-labelledby="wps-t" style="position: absolute; inset: 8px 8px auto 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
  <div style="display: flex; align-items: center; gap: 4px;">{ib("chev-l", "Back", size="touch")}<h1 class="disp" id="wps-t" style="font-size: 20px;">Where is your site?</h1></div>
  <label class="input touch focus">{icon("search")}<input type="search" role="combobox" aria-expanded="true" aria-controls="wps-l" value="Ballon" aria-label="Place name or coordinates"></label>
  <div role="listbox" id="wps-l" aria-label="Places" style="display: flex; flex-direction: column;">{results}</div>
  <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;"><span class="small muted">Place names © OpenStreetMap contributors</span>{btn("Skip", "link", extra=' style="min-height: 44px;"')}</div>
</div>'''


# ============================================================ theme and language
from boards_a import catalog as _catalog  # noqa: E402

board('CatalogDark', title='Dark theme · plant catalog', group='theme', dark=True)(lambda: _catalog())
board('LayersDark', title='Dark theme · layers with slope', group='theme', dark=True)(lambda: slope())
board('SettingsDark', title='Dark theme · settings', group='theme', dark=True)(lambda: settings())


@board('French', title='Français · long labels in menus and tools', group='theme')
def french():
    m = menu([('#', '3 plantes · Framboisier'), ('Couper', 'Ctrl X'), ('Copier', 'Ctrl C'), ('Coller', 'Ctrl V', 'dis'), ('Dupliquer', 'Ctrl D'), '-',
              ('Symbole et couleur…', '', 'hot'), ('Afficher les noms de l’espèce', '', 'nochk'), ('Sélectionner toute l’espèce', 'Ctrl Maj A'), ('Fiche de l’espèce', ''), '-',
              ('Ajouter au calendrier…', ''), ('Définir le prix unitaire…', ''), '-',
              ('Grouper', 'Ctrl G'), ('Disposition', '', 'sub'), ('Pivoter…', 'Ctrl Alt R'), ('Enregistrer comme tampon…', ''), '-', ('Verrouiller', 'Ctrl Maj L'), ('Supprimer', 'Suppr', 'danger')], 300,
             ' position: absolute; left: 622px; top: 150px;', label='Sélection')
    names = {'Select': 'Sélection', 'Pan': 'Déplacer la vue', 'Place plants': 'Placer des plantes', 'Plant a row': 'Planter une rangée', 'Place a stamp': 'Placer un tampon',
             'Zones': 'Zones', 'Polygon zone': 'Zone polygone', 'Rectangle zone': 'Zone rectangle', 'Ellipse zone': 'Zone ellipse', 'Line zone': 'Zone linéaire', 'Text note': 'Note texte',
             'Measure': 'Mesurer', 'Undo': 'Annuler', 'Redo': 'Rétablir', 'Ctrl Shift Z': 'Ctrl Maj Z'}
    t = topbar(ORCHARD, 'Enregistré', 'ok', menus=('Fichier', 'Édition', 'Affichage', 'Outils', 'Aide'), search_label='Lieu ou coordonnées')
    t = t.replace('Help and keyboard shortcuts (F1)', 'Aide et raccourcis (F1)').replace('Settings (Ctrl ,)', 'Réglages (Ctrl ,)')
    return (close_map() + selbox(574, 258, 38, 86) + t + toolrail('select', labelled=True, names=names) + panelrail(None) + m
            + viewchip(names=('Grille', 'Aimanter à la grille')) + zoombar('1:75', '1 m', 52))


@board('FrenchDialogs', w=1440, h=900, title='Français · dialogs and footers that must wrap', group='theme')
def french_dialogs():
    d = dialog('Modifié en dehors de Canopi',
               '<p style="margin: 0;">Un autre programme a modifié ce fichier à 10 h 42, après le dernier enregistrement de Canopi. Choisissez la version à garder.</p>'
               '<div class="card" style="padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;"><span class="small muted">Ce fichier</span><span class="mono" style="font-size: 12.5px;">~/Designs/Verger syntropique v3.canopi</span></div>'
               '<p class="small" style="margin: 0;">Utiliser la version du fichier annule vos dernières modifications ; Ctrl Z les rétablit tant que le Design reste ouvert. Écraser remplace les modifications de l’autre programme. Enregistrer une copie garde les deux.</p>',
               btn('Enregistrer ma version comme copie…', 'ghost') + '<span style="flex: 1 1 auto;"></span>' + btn('Utiliser la version du fichier') + btn('Écraser avec ma version', 'danger'), 580)
    budget_foot = (f'<div class="card" style="padding: 12px 14px; width: 440px; display: flex; flex-direction: column; gap: 8px;">'
                   f'<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap;"><span class="small muted">2 201 plantes · 96 espèces sur 117 avec un prix</span><b class="disp num" style="font-size: 20px;">6 482,30 €</b></div>'
                   f'<div class="bar"><i style="width: 82%;"></i></div><div style="display: flex; gap: 6px; flex-wrap: wrap;">{dropdown("Euro (EUR)", "Devise")}<span style="flex: 1 1 auto;"></span>{btn("Exporter en CSV…", "", "export", "md")}</div>'
                   f'<span class="hint">Changer de devise renomme les prix ; cela ne les convertit pas.</span></div>')
    appear = (f'<div class="card" style="width: 424px; padding: 12px 14px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between;">'
              f'{btn("Seulement ces 3 plantes")}{btn("Les 142 plantes de l’espèce", "primary")}</div>')
    pdfseg = f'<div style="width: 300px;">{field("Couleurs des plantes", seg(["Espèce", "Niveaux de gris", "Noir"], "Espèce", "Couleurs des plantes"))}</div>'
    return (f'<div style="position: absolute; inset: 0; padding: 40px 48px; display: flex; flex-direction: column; gap: 22px;" lang="fr">'
            + H('Français · textes longs', 'Les pieds de boîte de dialogue passent à la ligne, les segments aussi. Nombres et devises au format français.')
            + f'<div style="display: grid; grid-template-columns: 600px minmax(0, 1fr); gap: 36px;"><div>{d}</div><div style="display: flex; flex-direction: column; gap: 20px;">{budget_foot}{appear}{pdfseg}</div></div></div>')


# ============================================================ stories
def _step_thumb(pos, zoom=1.0, sel=False):
    return (f'<span aria-hidden="true" style="width: 64px; height: 40px; border-radius: 6px; flex-shrink: 0; border: 1px solid var(--line); '
            f'background: url({blob("orchard-sat")}) {pos} / {int(1440 * 0.1 * zoom)}px {int(900 * 0.1 * zoom)}px;"></span>')


STEPS = [('The site', 'Where the orchard sits and how water moves', '-30px -18px', 1.0),
         ('Rows and strata', 'Twenty rows, from emergent trees to groundcover', '-40px -26px', 1.4),
         ('Berry hedges', '232 goji and 142 raspberries feed the market stall', '-100px -60px', 2.6),
         ('Year one planting', 'What goes in this winter, and in what order', '-60px -40px', 1.8)]


@board('StoryAuthor', title='Stories · build a story from views of the map, beside the live map', group='stories')
def story_author():
    rows = ''.join(
        f'<div class="row{" sel" if i == 2 else ""}" style="min-height: 60px; gap: 8px; padding: 6px 6px 6px 2px;">{ib("grip", "Reorder step " + str(i + 1) + " (Alt ↑ or ↓)", size="sm", cls="quiet")}'
        f'<button type="button" style="flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; padding: 0; cursor: pointer;"{" aria-current=" + chr(34) + "step" + chr(34) if i == 2 else ""}>'
        f'<span class="num small muted" style="width: 14px;">{i + 1}</span>{_step_thumb(pos, z)}<span style="display: flex; flex-direction: column; min-width: 0; line-height: 1.25;"><b style="font-weight: 600;">{esc(t)}</b><span class="small muted" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{esc(d)}</span></span></button>'
        f'{ib("more", "More actions for step " + str(i + 1), size="sm")}</div>' for i, (t, d, pos, z) in enumerate(STEPS))
    editor = f'''
  <div class="card" style="padding: 12px; display: flex; flex-direction: column; gap: 10px; margin: 6px 2px 0;">
    <div style="display: flex; align-items: center; justify-content: space-between;"><h3 style="font-size: 14px; font-weight: 600;">Step 3</h3><span class="small muted">Shown as the map is now</span></div>
    {field("Title", textin("Berry hedges", aria="Step title"))}
    <div class="field"><span class="lbl">Text</span>
      <div role="toolbar" aria-label="Text formatting" style="display: flex; gap: 2px; padding: 2px; border: 1px solid var(--line-strong); border-bottom: 0; border-radius: 8px 8px 0 0; background: var(--surface-2);">
        <button type="button" class="ib sm" aria-label="Bold" style="font-weight: 600;">B</button><button type="button" class="ib sm" aria-label="Italic" style="font-style: italic; font-family: Literata, serif;">I</button>{ib("list", "Bulleted list", size="sm") if "list" in ds.IC else ""}{ib("image", "Add image", size="sm")}{ib("external", "Add link", size="sm") if "external" in ds.IC else ""}</div>
      <textarea class="ta" aria-label="Step text" style="border-radius: 0 0 8px 8px; min-height: 96px;">Two hedges of goji and raspberry run along the drip line of the fruit trees. They crop from year two and shelter the young trees from the west wind.</textarea></div>
    <div style="display: flex; flex-direction: column; gap: 6px;"><span class="lbl">This step shows</span>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;"><span class="tag">{icon("camera", "s16")}&nbsp;View 1:75</span><span class="tag">Satellite</span><span class="tag">{glyph("berry", "#AB5268", 16)}&nbsp;Goji highlighted</span><span class="tag">Labels: names</span></div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">{btn("Use the current map view", "", "camera", "sm")}{btn("Go to this view", "ghost", size="sm")}</div></div>
  </div>'''
    body = (f'<div style="display: flex; gap: 6px; align-items: center; padding: 0 2px 8px;">{dropdown("Verger · visite client", "Story")}<span style="flex: 1 1 auto;"></span>{btn("New story", "ghost", "plus", "sm")}</div>'
            f'<div class="scroll" style="flex: 1 1 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1px;">{rows}'
            f'<div style="padding: 4px 6px;">{btn("Add the current view as a step", "", "plus", "sm")}</div>{editor}</div>')
    foot = f'<span class="small muted" style="flex: 1 1 auto;">4 steps · saved with the Design</span>{btn("Export…", "", size="md")}{btn("Present", "primary", "play", "md")}'
    return close_map('plants-close-goji') + panel('Stories', body, foot=foot, wide=True) + chrome(panel='story', scale=CLOSE)


@board('StoryPresent', title='Stories · present full-window inside Canopi', group='stories')
def story_present():
    dots = ''.join(f'<button type="button" aria-label="Step {i + 1}: {esc(t)}"{" aria-current=" + chr(34) + "step" + chr(34) if i == 2 else ""} style="width: 32px; height: 28px; border: 0; padding: 0; cursor: pointer; background: transparent; display: inline-flex; align-items: center; justify-content: center;"><span aria-hidden="true" style="width: {28 if i == 2 else 10}px; height: 10px; border-radius: 5px; background: {"var(--accent)" if i == 2 else "var(--line-strong)"};"></span></button>'
                   for i, (t, d, pos, z) in enumerate(STEPS))
    card = f'''
<article class="float" aria-labelledby="sp-t" style="position: absolute; left: 32px; top: 32px; width: 420px; padding: 28px 28px 20px; display: flex; flex-direction: column; gap: 16px; border-radius: 18px;">
  <span class="small muted" style="letter-spacing: 0.04em;">Verger · visite client · Step 3 of 4</span>
  <h1 class="disp" id="sp-t" style="font-size: 32px; line-height: 1.15;">Berry hedges</h1>
  <p style="margin: 0; font-size: 17px; line-height: 1.55; color: var(--ink-2);">Two hedges of goji and raspberry run along the drip line of the fruit trees. They crop from year two and shelter the young trees from the west wind.</p>
  <div style="display: flex; gap: 10px; flex-wrap: wrap;"><span class="tag">{glyph("berry", "#AB5268", 16)}&nbsp;Goji · 232 plants</span><span class="tag">{glyph("berry", "#AB5268", 16)}&nbsp;Framboisier · 142 plants</span></div>
  <nav aria-label="Story steps" style="margin-top: 8px; display: flex; align-items: center; gap: 10px;">
    {btn("Previous", "", "chev-l", "md")}<div style="display: flex; gap: 6px; align-items: center; flex: 1 1 auto; justify-content: center;">{dots}</div>{btn("Next", "primary", size="md", icon_right="chev-r")}
  </nav>
  <span class="small muted" style="text-align: center;">← → or Space to move · Esc to leave</span>
</article>'''
    top = (f'<div class="float" style="position: absolute; right: 24px; top: 24px; height: 44px; display: flex; align-items: center; gap: 4px; padding: 0 6px 0 14px; border-radius: 22px;">'
           f'<span class="small" style="font-weight: 600;">{esc(ORCHARD)}</span>{ib("expand", "Full screen (F)")}{ib("close", "Leave presentation (Esc)")}</div>')
    return close_map('plants-close-goji') + card + top + '<span class="attrib" style="position: absolute; right: 24px; bottom: 24px;">© Google</span>'


@board('StoryPhone', w=390, h=844, title='Stories · presenting on a phone (Web)', group='stories')
def story_phone():
    dots = ''.join(f'<span aria-hidden="true" style="width: {22 if i == 2 else 8}px; height: 8px; border-radius: 4px; background: {"var(--accent)" if i == 2 else "var(--line-strong)"};"></span>' for i in range(4))
    return f'''
<div class="map"><div style="position: absolute; left: -350px; top: -40px; width: 1440px; height: 900px;"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px; transform-origin: 640px 470px; transform: scale(2.6);"><img src="{blob("plants-close-goji")}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;"></div></div>
<div class="float" style="position: absolute; left: 8px; right: 8px; top: 8px; height: 52px; display: flex; align-items: center; gap: 6px; padding: 0 4px 0 14px;"><span class="small" style="font-weight: 600; flex: 1 1 auto;">Step 3 of 4</span><span style="display: flex; gap: 4px;">{dots}</span>{ib("close", "Leave presentation", size="touch")}</div>
<article class="float" aria-labelledby="spp-t" style="position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 18px 14px; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; gap: 10px; padding-bottom: env(safe-area-inset-bottom);">
  <h1 class="disp" id="spp-t" style="font-size: 24px;">Berry hedges</h1>
  <p style="margin: 0; font-size: 16px; line-height: 1.5; color: var(--ink-2);">Two hedges of goji and raspberry run along the drip line of the fruit trees. They crop from year two and shelter the young trees from the west wind.</p>
  <div style="display: flex; gap: 8px;">{btn("Previous", "", "chev-l", "lg").replace('class="btn lg"', 'class="btn lg" style="flex: 1 1 0;"')}{btn("Next", "primary", "", "lg", icon_right="chev-r").replace('class="btn primary lg"', 'class="btn primary lg" style="flex: 1 1 0;"')}</div>
  <span class="small muted" style="text-align: center;">Swipe left or right to move</span>
</article>'''


# ============================================================ analyses: water and canopy
def _site_layers(rows_html, foot=''):
    body = (sec('Design') + layer_row('Plants', '2,201', lock=False) + layer_row('Zones', '3', lock=False)
            + f'<div style="display: flex; align-items: center; justify-content: space-between; padding-right: 4px;">{sec("Site data")}<button type="button" class="btn link sm" aria-haspopup="menu">{icon("plus", "s16")}Add data</button></div>'
            + rows_html + sec('Background') + '<div role="radiogroup" aria-label="Background">' + radio('Satellite', True, 'bg', '<span class="small muted">Google</span>') + radio('Map', False, 'bg') + radio('None', False, 'bg') + '</div>')
    return panel('Layers', f'<div class="scroll" style="display: flex; flex-direction: column; gap: 2px; overflow-y: auto;">{body}</div>', foot=foot, bottom=(64 if foot else None))


@board('WaterFlow', title='Water flow · streams and wetness under their terrain, readable on hover', group='analyses')
def water_flow():
    rows = (layer_row('Terrain · IGN 0.5 m', sub='Elevation · 108–131 m') + layer_row('Slope', sub='from Terrain · degrees', indent=22, vis=False)
            + layer_row('Water flow', sub='from Terrain · breach, streams from 1 ha', indent=22)
            + layer_row('Streams', sub='lines · order 1–4', indent=44, active=True) + layer_row('Wetness index', sub='raster', indent=44)
            + layer_row('Upslope area', sub='raster · m²', indent=44, vis=False))
    legend = ''.join(f'<span style="display: flex; align-items: center; gap: 8px;" class="small"><span style="width: 36px; height: {w}px; border-radius: 3px; background: #3E8CC0;"></span>Order {o}</span>' for o, w in [(1, 2), (2, 3), (3, 5), (4, 7)])
    foot = (f'<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;"><div style="display: flex; justify-content: space-between;"><b style="font-weight: 600;">Streams</b><span class="small muted">from Water flow</span></div>'
            f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px;">{legend}</div>{slider("Opacity", 100, "%")}'
            f'<div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">{ib("fit", "Fit to Streams", size="sm")}{btn("Details", size="sm")}<span style="flex: 1 1 auto;"></span>{btn("Remove from Design", "link", size="sm")}</div></div>')
    card = (f'<div class="float" role="status" style="position: absolute; left: 610px; top: 520px; padding: 8px 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; font-size: 14px;">'
            f'<span class="small muted num">48.2197° N, 0.0346° E</span><span>Stream, order <b style="font-weight: 600;">3</b></span><span>Upslope area <b class="num" style="font-weight: 600;">4.8 ha</b></span><span>Wetness index <b class="num" style="font-weight: 600;">11.2</b> <span class="muted">(wet)</span></span></div>'
            '<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true"><circle cx="598" cy="512" r="7" fill="none" stroke="#1A160F" stroke-width="4"></circle><circle cx="598" cy="512" r="7" fill="none" stroke="#FFFFFF" stroke-width="2"></circle></svg>')
    return (z18_map() + f'<img src="{blob("wetness")}" alt="Wetness index" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px; opacity: 0.55;">'
            + f'<img src="{blob("streams")}" alt="Streams" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">'
            + card + _site_layers(rows, foot) + chrome(panel='layers', name='Untitled Design', status='Draft', kind='draft', scale=('1:1,500', '50 m', 126), attrib='© Google · IGN'))


@board('AnalyzeWater', title='Analyze terrain · water flow, generated from the analysis list', group='analyses')
def analyze_water():
    groups = ''
    for g, items in [('Terrain', [('Slope', 'Already in Layers.', False, True), ('Hillshade', 'Relief shading to read the shape of the land.', False, False), ('Contours', 'Lines of equal height.', False, False)]),
                     ('Water', [('Water flow', 'Where water collects and runs: upslope area, streams, wetness and ponding.', True, False), ('Catchments', 'The land that drains to points you pick on the map.', False, False)]),
                     ('Vegetation', [('Tree tops, crowns and gaps', 'Needs a canopy height layer (above-ground height).', False, True)])]:
        opts = ''.join(f'<label class="row{" tile-sel" if on else ""}" style="min-height: 52px; gap: 12px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer;"><input type="radio" name="an" checked="{{{{ {"true" if on else "false"} }}}}"{" disabled" if dis else ""}>'
                       f'<span style="display: flex; flex-direction: column; line-height: 1.3;"><b style="font-weight: 600;{" color: var(--muted);" if dis else ""}">{a}</b><span class="small muted">{b}</span></span></label>' for a, b, on, dis in items)
        groups += f'<div role="group" aria-label="{g}" style="display: flex; flex-direction: column; gap: 6px;"><h3 class="sec" style="padding: 4px 0 0;">{g}</h3>{opts}</div>'
    params = (f'<div class="card" style="padding: 12px; display: flex; flex-direction: column; gap: 12px;"><h3 style="font-size: 14px; font-weight: 600;">Water flow settings</h3>'
              + field('Depressions', seg(['Breach (recommended)', 'Fill'], 'Breach (recommended)', 'Depressions'), 'Breaching cuts through small dams such as roads and keeps the valley floor.')
              + field('Streams start where the upslope area reaches', textin('1', aria='Minimum upslope area for streams', trail='<span class="muted">ha</span>'), 'Smaller values draw more, shorter streams.')
              + '<div style="display: flex; flex-direction: column; gap: 4px;"><span class="lbl">Results to add</span>' + check('Streams (lines)', True) + check('Upslope area', True) + check('Wetness index', True) + check('Ponding depth', False) + '</div>'
              + f'<button type="button" class="btn ghost sm" aria-expanded="false" style="align-self: flex-start;">{icon("chev-r", "s16")}Advanced · maximum breach distance 50 m</button></div>')
    body = (f'<p style="margin: 0;">From <b style="font-weight: 600;">Terrain · IGN 0.5 m</b> (4.1 million cells, within the limit). Results are added under it in Layers and kept in your library.</p>'
            f'<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start;"><div style="display: flex; flex-direction: column; gap: 10px;">{groups}</div>{params}</div>')
    dlg = dialog('Analyze terrain', body, btn('Cancel') + btn('Calculate water flow', 'primary'), 860)
    rows = layer_row('Terrain · IGN 0.5 m', sub='Elevation · 108–131 m', active=True) + layer_row('Slope', sub='from Terrain · degrees', indent=22, vis=False)
    return (z18_map() + _site_layers(rows) + chrome(panel='layers', name='Untitled Design', status='Draft', kind='draft', scale=('1:1,500', '50 m', 126))
            + '<div class="scrim"></div>' + f'<div style="position: absolute; left: 50%; top: 80px; transform: translateX(-50%);">{dlg}</div>')


@board('CanopyAnalysis', title='Canopy · tree tops, crowns and gaps from canopy height', group='analyses')
def canopy():
    st = {'trees': 140, 'mean_h': 15.4}
    rows = (layer_row('Canopy height · IGN MNH 0.5 m', sub='Above-ground height · 0–26 m') + layer_row('Tree tops', sub=f'points · {st["trees"]} trees', indent=22, active=True)
            + layer_row('Crowns', sub='polygons · 5.1 ha in total', indent=22) + layer_row('Canopy gaps', sub='polygons · 38 gaps', indent=22, vis=False))
    foot = (f'<div style="display: flex; flex-direction: column; gap: 8px; width: 100%;"><div style="display: flex; justify-content: space-between;"><b style="font-weight: 600;">Tree tops</b><span class="small muted">from Canopy height</span></div>'
            f'<div class="small" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px;"><span><b class="num" style="font-weight: 600; font-size: 16px; display: block;">{st["trees"]}</b>trees</span><span><b class="num" style="font-weight: 600; font-size: 16px; display: block;">{st["mean_h"]} m</b>mean height</span><span><b class="num" style="font-weight: 600; font-size: 16px; display: block;">26.0 m</b>tallest</span></div>'
            f'{notice("info", "Detected from the height raster; check a few trees in the field before relying on counts.", "info")}'
            f'<div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">{ib("fit", "Fit to Tree tops", size="sm")}{btn("Details", size="sm")}{btn("Export GeoJSON…", size="sm")}<span style="flex: 1 1 auto;"></span>{btn("Remove from Design", "link", size="sm")}</div></div>')
    card = (f'<div class="float" role="tooltip" style="position: absolute; left: 1000px; top: 170px; padding: 8px 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; font-size: 14px;">'
            f'<b style="font-weight: 600;">Tree</b><span>Height <b class="num" style="font-weight: 600;">17.4 m</b></span><span>Crown <b class="num" style="font-weight: 600;">72 m²</b> <span class="muted">· ≈ 9.6 m wide</span></span></div>')
    return (z18_map() + f'<img src="{blob("crowns")}" alt="Tree crowns" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">'
            + card + _site_layers(rows, foot) + chrome(panel='layers', name='Untitled Design', status='Draft', kind='draft', scale=('1:1,500', '50 m', 126), attrib='© Google · IGN'))


@board('ResultDetails', title='Result details · provenance, out of date, refresh and history', group='analyses')
def result_details():
    facts = [('Analysis', 'Water flow · version 1'), ('From', 'Terrain · IGN 0.5 m (imported Sep 24)'), ('Settings', 'Breach depressions · streams from 1 ha · maximum breach 50 m'),
             ('Tool', 'GeoLibre 1.5.3 (aac2b74) · Whitebox hydrology'), ('Created', 'Sep 26, 2026, 5:41 PM'), ('Covers', '2.1 km² · 4.1 million cells')]
    grid = ''.join(f'<div style="display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line);"><span class="small muted" style="width: 84px; flex-shrink: 0;">{a}</span><span class="small" style="color: var(--ink);">{esc(b)}</span></div>' for a, b in facts)
    runs = ''.join(f'<div class="row" style="min-height: 44px; gap: 10px;"><span style="width: 8px; height: 8px; border-radius: 4px; background: {c};" aria-hidden="true"></span><span style="display: flex; flex-direction: column; flex: 1 1 auto; line-height: 1.25;"><span class="small" style="color: var(--ink); font-weight: 600;">{a}</span><span class="small muted">{b}</span></span></div>'
                   for a, b, c in [('Refreshed · current', 'Sep 26, 5:41 PM · 38 s · 3 results', '#3E7A3A'), ('Cancelled', 'Sep 26, 5:39 PM · after 12 s', '#8C8579'), ('Created', 'Sep 25, 11:02 AM · 41 s · 3 results', '#3E7A3A')])
    body = f'''
  <div class="scroll" style="flex: 1 1 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 2px 6px 8px;">
    {notice("warn", "<b style='font-weight: 600;'>Out of date.</b> Terrain · IGN 0.5 m was updated after this ran.", "alert", btn("Refresh", "primary", size="sm"))}
    <div>{grid}</div>
    <div style="display: flex; gap: 6px; flex-wrap: wrap;">{btn("Run again with changes…", size="sm")}{btn("Rename…", "ghost", size="sm")}</div>
    <div style="display: flex; flex-direction: column; gap: 4px;"><h3 class="sec" style="padding: 4px 0;">Processing history</h3>{runs}</div>
    <p class="hint" style="margin: 0;">Refresh replaces the result everywhere it is used; this history keeps the record of every run.</p>
  </div>'''
    p = panel('Water flow', body, back=True, sub='3 results · used in 2 Designs')
    return (z18_map() + f'<img src="{blob("wetness")}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px; opacity: 0.45;"><img src="{blob("streams")}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">'
            + p + chrome(panel='layers', name='Untitled Design', status='Draft', kind='draft', scale=('1:1,500', '50 m', 126), attrib='© Google · IGN'))
