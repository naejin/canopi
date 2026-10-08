"""Boards: Layers, the Site data panel (rows, values on rows, the pinned point, the profile), import, analysis, the Data
library, and the planned water-flow rows. Colours come from ds tokens, RAMPS and MAPINK only."""
import math

from build import board, blob
from common import *  # noqa: F401,F403

COORDS = '48.220142° N, 0.035087° E'
HINT = 'Point at the map to read values · click to pin'


# ============================================================ shared pieces
def swatch(rmp, vis=True, rev=False, missing=False):
    """A row's 16 × 10 ramp swatch with a strong edge; 40 % when hidden, empty when missing. rmp may be ('html', markup)."""
    if isinstance(rmp, tuple):
        return rmp[1]
    bg = 'transparent' if missing else ramp(rmp, 90, rev)
    return (f'<span aria-hidden="true" style="width: 16px; height: 10px; border-radius: 2px; flex-shrink: 0; border: 1px solid var(--line-strong); '
            f'background: {bg};{"" if vis else " opacity: 0.4;"}"></span>')


def line_swatch(colour, w=3):
    return ('html', f'<span aria-hidden="true" style="width: 16px; height: 10px; flex-shrink: 0; display: inline-flex; align-items: center;">'
                    f'<span style="width: 16px; height: {w}px; border-radius: 2px; background: {colour};"></span></span>')


def legend(rmp, lo, hi, rev=False):
    return (f'<div role="group" aria-label="Legend" class="small muted num" style="display: flex; align-items: center; gap: 8px; min-height: 20px;"><span>{esc(lo)}</span>'
            f'<span aria-hidden="true" style="flex: 1 1 auto; height: 10px; border-radius: 3px; border: 1px solid var(--line-strong); background: {ramp(rmp, 90, rev)};"></span><span>{esc(hi)}</span></div>')


def opacity(name, value, label_w=56):
    return (f'<label style="display: flex; align-items: center; gap: 10px; min-height: 28px;"><span class="lbl" style="width: {label_w}px; flex-shrink: 0;">Opacity</span>'
            f'<input type="range" min="0" max="100" value="{value}" aria-label="Opacity: {esc(name)}" style="flex: 1 1 auto; min-width: 0;">'
            f'<span class="small muted num" style="width: 36px; text-align: right;">{value}%</span></label>')


def remove(name, keeps=True):
    note = '<span class="small muted">Your library keeps the data.</span>' if keeps else ''
    return (f'<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0;">'
            f'{btn("Remove from Design", "link", size="sm", aria=f"Remove {name} from this Design", extra=chr(32) + "style=" + chr(34) + "padding: 0;" + chr(34))}{note}</div>')


def inset(caption, inner, left, top, width):
    return (f'<figure class="sheet" style="position: absolute; left: {left}px; top: {top}px; width: {width}px; margin: 0; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px;">'
            f'<figcaption class="small muted">{esc(caption)}</figcaption>{inner}</figure>')


def terrain(op=1.0):
    """A smooth ground-elevation field in the Terrain ramp's 112–148 m band, standing in for the map's raster."""
    s = RAMPS['schwarzwald']
    a, b, c, d, e, f = s[10], s[14], s[18], s[24], s[28], s[31]
    return (f'<div aria-hidden="true" style="position: absolute; inset: 0; opacity: {op}; background: '
            f'radial-gradient(ellipse 430px 300px at 74% 26%, {f} 0%, {e} 38%, transparent 72%), '
            f'radial-gradient(ellipse 380px 280px at 26% 74%, {a} 0%, transparent 70%), '
            f'linear-gradient(160deg, {b} 0%, {c} 38%, {d} 72%, {e} 100%);"></div>')


def plants_over():
    return f'<img src="{blob("plants-site")}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">'


def map_svg(inner):
    return f'<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true">{inner}</svg>'


def pin_dot(x, y):
    """The pinned point: an ink core (radius 5) inside a 2 px white ring; never blue, never a selection."""
    return f'<circle cx="{x}" cy="{y}" r="7" fill="{MAPINK["ring"]}"></circle><circle cx="{x}" cy="{y}" r="5" fill="{MAPINK["ink"]}"></circle>'


def cursor(x, y):
    return (f'<path d="{IC["select"]}" transform="translate({x - 6} {y - 4}) scale(1.3)" fill="{MAPINK["ink"]}" stroke="{MAPINK["ring"]}" '
            'stroke-width="1.1" stroke-linejoin="round"></path>')


def contour_lines():
    """Online contour lines: light, thin, theme-independent."""
    paths = ''.join(f'<path d="M-20 {y} C 300 {y - 60}, 520 {y + 50}, 800 {y - 20} S 1200 {y - 90}, 1460 {y - 40}" fill="none" stroke="{MAPINK["contour"]}" stroke-opacity="0.55" stroke-width="1.2"></path>'
                    for y in range(140, 900, 70))
    return map_svg(paths)


# ============================================================ Layers
def lrow(name, ic, cap='', vis=True, trail='', body=None, eye=True, touch=False, opener=None):
    """One Layers row: eye, 16 px icon, name over caption, trailing controls. body: the open row's settings (None = closed).
    opener: (tooltip, keys) when the name opens a panel instead of settings; False when the name is plain text."""
    t = 'touch' if touch else 'sm'
    slot = 44 if touch else 28
    hit = 44 if touch else 30
    lead = ib('eye' if vis else 'eye-off', ('Hide ' if vis else 'Show ') + name, size=t) if eye else f'<span aria-hidden="true" style="width: {slot}px; flex-shrink: 0;"></span>'
    opened = body is not None
    inner = (f'<span aria-hidden="true" style="display: inline-flex; color: var(--ink-2);{"" if vis else " opacity: 0.45;"}">{icon(ic, "s16")}</span>'
             f'<span style="display: flex; flex-direction: column; min-width: 0; line-height: 1.25;"><span style="font-weight: {600 if opened else 400}; color: {"var(--ink)" if vis else "var(--muted)"};">{esc(name)}</span>'
             + (f'<span class="small muted">{esc(cap)}</span>' if cap else '') + '</span>')
    style = (f'flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; min-height: {hit}px; padding: 2px 0; border: 0; background: transparent; '
             'font: inherit; color: inherit; text-align: left; cursor: pointer;')
    bid = uid('lr')
    if opener is False:
        name_html = f'<span style="{style} cursor: default;">{inner}</span>'
    elif opener:
        name_html = f'<button type="button" title="{esc(opener[0])}" aria-keyshortcuts="{opener[1]}" style="{style}">{inner}</button>'
    else:
        ctl = f' aria-controls="{bid}"' if opened else ''
        name_html = f'<button type="button" aria-expanded="{"true" if opened else "false"}"{ctl} style="{style}">{inner}</button>'
    row = f'<div class="row" style="min-height: {hit}px; gap: 6px; padding: 0 4px;">{lead}{name_html}{trail}</div>'
    if not opened:
        return row
    return (f'<div style="box-shadow: inset 3px 0 0 var(--accent); border-radius: 3px;">{row}'
            f'<div id="{bid}" style="display: flex; flex-direction: column; gap: 4px; padding: 0 8px 8px {slot + 10}px;">{body}</div></div>')


def count(n):
    return f'<span class="count" style="padding: 0 2px;">{n}</span>'


def lock(name, locked, touch=False):
    t = 'touch' if touch else 'sm'
    return ib('lock', 'Unlock layer: ' + name, size=t, cls='soft') if locked else ib('unlock', 'Lock layer: ' + name, size=t, cls='quiet')


DESIGN = [('Annotations', 'text', '5', False), ('Plants', 'plant', '2,201', False), ('Measurement guides', 'measure', '2', True), ('Zones', 'polygon', '3', False)]


def design_rows(open_row=None, touch=False):
    return ''.join(lrow(n, ic, trail=count(c) + lock(n, lk, touch), body=(opacity(n, 80) if open_row == n else None), touch=touch)
                   for n, ic, c, lk in DESIGN)


def site_summary(shown=4, total=6, on=True, web=False, touch=False):
    """The one Site data row in Layers: an eye for all site data, "N of M shown", › to the panel. Web: a count, no eye, opens nothing."""
    if web:
        noun = 'terrain or height layer' if total == 1 else 'terrain or height layers'
        return lrow('Site data', 'sitedata', f'{total} {noun} in this Design · Needs Canopi Desktop', eye=False, opener=False, touch=touch)
    more = ib('chev-r', 'Open Site data', size='touch' if touch else 'sm')
    if total == 0:
        return lrow('Site data', 'sitedata', 'None yet', eye=False, trail=more, opener=('Site data (Ctrl 2)', 'Control+2'), touch=touch)
    return lrow('Site data', 'sitedata', f'{shown} of {total} shown', vis=on, trail=more, opener=('Site data (Ctrl 2)', 'Control+2'), touch=touch)


def interval_body(name):
    return (opacity(name, 60, 108) + f'<label style="display: flex; align-items: center; gap: 10px;"><span class="lbl" style="width: 108px; flex-shrink: 0;">Contour interval</span>'
            f'<span class="input" style="width: 84px; height: 30px;"><input type="number" min="0" step="1" value="1" aria-label="Contour interval" class="num"><span class="muted small">m</span></span></label>')


def map_rows(open_row=None, touch=False):
    return (lrow('Contour lines', 'contours', 'from online elevation · every 1 m', touch=touch,
                 body=(interval_body('Contour lines') if open_row == 'Contour lines' else None))
            + lrow('Hillshading', 'hillshade', 'from online elevation', vis=False, touch=touch,
                   body=(opacity('Hillshading', 40) if open_row == 'Hillshading' else None)))


def bg_settings(choice):
    """The chosen background's settings, always shown under it."""
    if choice == 'Street map':
        top = (f'<div style="display: flex; align-items: center; gap: 10px;"><span class="lbl" style="width: 56px;">Style</span>'
               f'<span style="flex: 1 1 auto; display: flex; flex-direction: column;">{dropdown("Liberty", "Style")}</span></div>')
    else:
        top = (field('Google Maps API key (optional)', '<span class="input" style="height: 32px;"><input type="password" value="" aria-label="Google Maps API key (optional)"></span>')
               + '<span class="hint">Without a key, Canopi uses Google’s public satellite tiles. Add your Google Maps API key to use the official Map Tiles API.</span>')
    return (f'<div role="group" aria-label="{choice} settings" style="display: flex; flex-direction: column; gap: 4px; padding: 0 8px 6px 36px;">'
            f'{top}{opacity(choice, 100)}{switch_row("Soften background", False, "Dims the map or satellite under plants. Kept on this device.")}</div>')


def background(choice='Satellite', touch=False):
    out = '<div role="radiogroup" aria-labelledby="bg-h">'
    for label, src in [('Satellite', 'Google'), ('Street map', 'OpenFreeMap'), ('None', 'Plain paper')]:
        r = radio(label, label == choice, 'bg', f'<span class="small muted">{src}</span>')
        r = r.replace('min-height: 34px;', 'min-height: 44px;' if touch else 'min-height: 30px;')
        out += r + (bg_settings(choice) if label == choice and choice != 'None' else '')
    return out + '</div>'


def layers_list(open_row='Zones', web=False, bg='Satellite', touch=False, shown=4, total=6, anchor=False):
    a = ' data-anchor="site"' if anchor else ''
    return (sec('Design', 'padding-top: 4px;') + design_rows(open_row, touch)
            + f'<div{a} style="border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); margin: 6px 0; padding: 2px 0;">'
            + site_summary(shown, total, web=web, touch=touch) + '</div>'
            + sec('Map', 'padding-top: 4px;') + map_rows(open_row, touch)
            + '<h4 class="lbl" id="bg-h" style="margin: 0; padding: 8px 10px 2px;">Background</h4>' + background(bg, touch))


def layers_panel(open_row='Zones', web=False, bg='Satellite'):
    body = f'<div class="scroll" style="flex: 1 1 auto; min-height: 0; overflow-y: auto;">{layers_list(open_row, web, bg)}</div>'
    return panel('Layers', body)


def layers_board(bg='Satellite'):
    if bg == 'Satellite':
        base, attrib = site_map(), '© Google'
    else:
        base, attrib = z18_map() + plants_over(), '© OpenFreeMap'
    one_open = (f'<div class="card" style="padding: 4px 0;">{sec("Map", "padding-top: 2px;")}{map_rows("Contour lines")}</div>')
    note = inset('Another moment: Contour lines open, so Zones closed. One row is open at a time.', one_open, 560, 520, 380)
    none_yet = inset('A Design without site data: the row has no eye and still opens the panel.',
                     f'<div class="card" style="padding: 2px 0;">{site_summary(total=0)}</div>', 560, 400, 380)
    return base + contour_lines() + layers_panel('Zones', bg=bg) + chrome(panel='layers', attrib=attrib) + none_yet + note


@board('Layers', title='Layers · Design, one Site data row, Map; the open row\'s settings under it', group='sitedata')
def layers():
    return layers_board('Satellite')


board('LayersDark', title='Dark theme · Layers with Street map chosen, its style under it', group='theme', dark=True)(lambda: layers_board('Street map'))


# ============================================================ Site data panel
def srow(name, rmp='schwarzwald', depth=0, vis=True, rev=False, chev=None, trail='', body=None, grip=True, eye='self',
         pending=None, opens=True):
    """One Site data row, 32 px: grip, indent, chevron slot, eye, swatch, name, one trailing item; body = the open item's settings.
    eye: 'self' | 'missing' | 'none'. pending: (aria label, percent) draws an import's progress line along the bottom."""
    g = (f'<button type="button" class="ib sm" aria-label="Reorder {esc(name)}" title="Drag, or Alt ↑ and Alt ↓" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" '
         f'style="width: 24px; color: var(--muted); cursor: grab;">{icon("grip", "s16")}</button>') if grip else '<span aria-hidden="true" style="width: 24px; flex-shrink: 0;"></span>'
    ind = f'<span aria-hidden="true" style="width: {16 * depth - 4}px; flex-shrink: 0;"></span>' if depth else ''
    if chev:
        o = chev == 'open'
        c = (f'<button type="button" class="ib sm" aria-label="{"Collapse" if o else "Expand"} {esc(name)}" aria-expanded="{"true" if o else "false"}" '
             f'style="width: 24px; margin: 0 -4px;">{icon("chev-d" if o else "chev-r", "s16")}</button>')
    else:
        c = '<span aria-hidden="true" style="width: 16px; flex-shrink: 0;"></span>'
    if eye == 'self':
        e = ib('eye' if vis else 'eye-off', ('Hide ' if vis else 'Show ') + name, size='sm')
    elif eye == 'missing':
        e = f'<span role="img" aria-label="Missing" style="width: 28px; height: 28px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; color: var(--warn);">{icon("alert", "s18")}</span>'
    else:
        e = '<span aria-hidden="true" style="width: 28px; flex-shrink: 0;"></span>'
    sw = swatch(rmp, vis, rev, missing=(eye == 'missing')) if rmp else '<span aria-hidden="true" style="width: 16px; flex-shrink: 0;"></span>'
    opened = body is not None
    colour = 'var(--ink)' if vis else 'var(--muted)'
    nstyle = (f'flex: 1 1 auto; min-width: 0; height: 28px; border: 0; background: transparent; font: inherit; color: {colour}; text-align: left; padding: 0 2px; '
              f'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: {600 if opened else 400};')
    bid = uid('sd')
    if opens:
        ctl = f' aria-controls="{bid}"' if opened else ''
        nm = f'<button type="button" title="{esc(name)}" aria-expanded="{"true" if opened else "false"}"{ctl} style="{nstyle} cursor: pointer;">{esc(name)}</button>'
    else:
        nm = f'<span title="{esc(name)}" style="{nstyle} line-height: 28px;">{esc(name)}</span>'
    tr = f'<span style="min-width: 8ch; display: inline-flex; align-items: center; justify-content: flex-end; gap: 2px; flex-shrink: 0;">{trail}</span>'
    row = f'<div class="row" style="min-height: 32px; gap: 4px; padding: 0 6px 0 0; border-radius: 6px;">{g}{ind}{c}{e}{sw}{nm}{tr}</div>'
    prog = ''
    if pending:
        label, pct = pending
        prog = (f'<div role="progressbar" aria-label="{esc(label)}" aria-valuenow="{pct}" aria-valuemin="0" aria-valuemax="100" style="position: absolute; left: 4px; right: 4px; bottom: 1px; height: 2px; background: var(--line); border-radius: 1px;">'
                f'<i style="display: block; width: {pct}%; height: 2px; background: var(--accent); border-radius: 1px;"></i></div>')
    li = 'position: relative;' + (' box-shadow: inset 3px 0 0 var(--accent); border-radius: 3px;' if opened else '')
    left = 48 + (16 * depth if depth else 0)
    b = f'<div id="{bid}" style="display: flex; flex-direction: column; gap: 8px; padding: 2px 8px 12px {left}px;">{body}</div>' if opened else ''
    return f'<li style="{li}">{row}{prog}{b}</li>'


def val(text):
    return f'<span class="num" style="font-size: 13px;">{esc(text)}</span>'


NODATA = '<span class="muted" style="font-size: 13px;"><span aria-hidden="true">—</span><span class="sr">No data</span></span>'


def state(text, warn=False):
    return f'<span style="font-size: 12.5px; color: var(--{"warn" if warn else "muted"});{" font-weight: 600;" if warn else ""} white-space: nowrap;">{esc(text)}</span>'


def refresh_chip(name):
    return (f'<button type="button" class="btn sm" aria-label="Refresh {esc(name)}" title="Out of date" '
            'style="height: 24px; padding: 0 8px; font-size: 12.5px; background: var(--warn-soft); border-color: var(--warn-line); color: var(--warn);">Refresh</button>')


def prow(label, control):
    return (f'<div style="display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 10px; align-items: start;"><span class="lbl" style="padding-top: 6px;">{label}</span>'
            f'<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0;">{control}</div></div>')


def ramp_choice(kind, chosen, rev=False):
    opts = ''
    for r in KIND_RAMPS[kind]:
        on = r == chosen
        opts += (f'<button type="button" role="radio" aria-checked="{"true" if on else "false"}" aria-label="{RAMP_NAMES[r]}" title="{RAMP_NAMES[r]}" '
                 'style="width: 48px; height: 28px; padding: 0; border: 0; background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;">'
                 f'<span class="{"sw-sel" if on else ""}" style="width: 40px; height: 16px; border-radius: 3px; border: 1px solid var(--line-strong); background: {ramp(r, 90, rev)};"></span></button>')
    rv = f'<button type="button" class="btn sm" aria-pressed="{"true" if rev else "false"}">Reverse</button>'
    return f'<div style="display: flex; align-items: center; gap: 4px;"><div role="radiogroup" aria-label="Colors" style="display: flex; gap: 2px;">{opts}</div><span style="flex: 1 1 auto;"></span>{rv}</div>'


def range_ctl(mode, lo, hi, unit, reset=False):
    s = seg(['Data range', 'Cut outliers', 'Custom'], mode, 'Range').replace('">Cut outliers</button>', '" title="Leaves out the lowest and highest 2% of values">Cut outliers</button>')

    def f(v, a):
        return (f'<span class="input" style="height: 30px; width: 108px; padding: 0 8px;"><input type="text" inputmode="decimal" value="{v}" aria-label="{a}" class="num" style="text-align: right;">'
                f'<span class="muted small">{unit}</span></span>')
    r = btn('Reset', 'link', size='sm') if reset else ''
    return s + f'<div style="display: flex; align-items: center; gap: 6px;">{f(lo, "Minimum")}<span class="muted" aria-hidden="true">–</span>{f(hi, "Maximum")}<span style="flex: 1 1 auto;"></span>{r}</div>'


def item_body(name, caption, kind, chosen, legend_lo, legend_hi, mode, lo, hi, unit, op=100, rev=False, reset=False, stale=''):
    """An open raster item, in order: caption, out-of-date notice, Colors (ramps, Reverse, legend), Range, Opacity, actions."""
    return (f'<span class="small muted">{esc(caption)}</span>{stale}'
            + prow('Colors', ramp_choice(kind, chosen, rev) + legend(chosen, legend_lo, legend_hi, rev))
            + prow('Range', range_ctl(mode, lo, hi, unit, reset))
            + opacity(name, op)
            + f'<div style="display: flex; align-items: flex-start; gap: 6px;">{btn("Fit to data", size="sm")}{btn("Details", size="sm")}<span style="flex: 1 1 auto;"></span>{remove(name)}</div>')


def missing_body(name, reason='Not in this computer’s Data library'):
    return f'<span style="color: var(--ink-2);">{esc(reason)}</span><div style="display: flex;">{remove(name, keeps=False)}</div>'


def site_toolbar(profile=False, analyze=True, profile_ok=True):
    a = '' if analyze else ' disabled title="Add terrain or height data first"'
    p = '' if profile_ok else ' disabled title="Show an elevation or height layer to draw a profile"'
    return (f'<div role="toolbar" aria-label="Site data tools" style="display: flex; gap: 6px; padding: 0 16px 8px;">'
            f'{btn("Import…", size="sm", ic="import")}<button type="button" class="btn sm"{a}>Analyze…</button>'
            f'<button type="button" class="btn sm" aria-pressed="{"true" if profile else "false"}"{p}>{icon("profile", "s18")}Profile</button></div>')


def pin_line(coords=COORDS):
    return (f'<div style="display: flex; align-items: center; gap: 6px; padding: 0 10px 8px 16px; min-height: 28px;">'
            f'<span aria-hidden="true" style="display: inline-flex; color: var(--ink-2);">{icon("pin", "s16")}</span>'
            f'<span class="num" style="font-size: 13px; user-select: text;">{esc(coords)}</span>{btn("Unpin", "link", size="sm")}</div>')


def hint_line(text=HINT):
    return f'<p class="small muted" style="margin: 0; padding: 0 16px 8px; min-height: 28px; display: flex; align-items: center;">{esc(text)}</p>'


def site_panel(rows, head='hint', above='', chart='', toolbar=None):
    """The Site data panel (440 px): header (title, Library, close), the pin or hint line, toolbar, rows; a profile chart pinned to the bottom."""
    i = uid('pt')
    line = pin_line() if head == 'pin' else (hint_line() if head == 'hint' else '')
    return (f'<aside class="float panel" aria-labelledby="{i}" style="position: absolute; right: 76px; top: 72px; bottom: 64px; width: 440px;">'
            f'<div class="phead"><h2 class="ptitle" id="{i}">Site data</h2>{ib("library", "Data library", size="sm", extra=" title=" + chr(34) + "Data library" + chr(34))}{ib("close", "Close panel", size="sm")}</div>'
            f'{line}{toolbar if toolbar is not None else site_toolbar()}'
            f'<div class="pbody"><div class="scroll" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">{above}'
            f'<ul aria-label="Site data, front to back" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;">{rows}</ul></div></div>{chart}</aside>')


def mnt_body(op=100):
    return item_body('MNT · IGN 0.5 m', 'Ground elevation (DTM) · 0.5 m · 112.3 – 147.9 m', 'elevation', 'schwarzwald', '112 m', '148 m',
                     'Data range', '112.30', '147.85', 'm', op)


def slope_body():
    return item_body('Slope', 'from MNT · IGN 0.5 m · degrees', 'slope', 'ylorrd', '0°', '≥ 30°', 'Custom', '0.0', '30.0', '°', 70)


def orchard_rows(open_item=None, values=None, mnh=False):
    """The orchard's site data, front to back: MNT with its Slope, MNS, MNH (hidden), Drone survey (collapsed).
    values: name -> trailing html (None = nothing)."""
    v = values or {}
    return (srow('MNT · IGN 0.5 m', 'schwarzwald', chev='open', trail=v.get('MNT', ''), body=mnt_body() if open_item == 'MNT' else None)
            + srow('Slope', 'ylorrd', depth=1, trail=v.get('Slope', ''), body=slope_body() if open_item == 'Slope' else None)
            + srow('MNS · IGN 0.5 m', 'turbid', trail=v.get('MNS', ''))
            + srow('MNH · IGN 0.5 m', 'greens', vis=mnh, trail=v.get('MNH', ''))
            + srow('Drone survey · 2023', 'schwarzwald', chev='closed', trail=v.get('Drone', '')))


VALUES = {'MNT': val('142.37 m'), 'Slope': val('23.4°'), 'MNS': val('151.02 m'), 'Drone': NODATA}


def site_base(op=1.0, slope=0.0):
    s = f'<img src="{blob("slope-overlay")}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px; opacity: {slope};">' if slope else ''
    return f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard"></div>' + terrain(op) + s + plants_over()


def site_chrome():
    return chrome(panel='sitedata', attrib='© Google · IGN')


@board('SiteData', title='Site data · its own panel; the open item\'s colors, range and opacity under its row', group='sitedata')
def site_data():
    return site_base() + site_panel(orchard_rows('MNT')) + site_chrome()


@board('SiteDataValues', title='Site data · each visible row reads the value under the pointer; a pinned point in the header', group='sitedata')
def site_data_values():
    marks = map_svg(pin_dot(690, 462) + cursor(842, 318))
    return site_base() + marks + site_panel(orchard_rows(values=VALUES), head='pin') + site_chrome()


@board('SiteDataMissing', title='Site data · pending, out-of-date and missing rows; all site data hidden from Layers', group='sitedata')
def site_data_missing():
    hidden = notice('info', 'Site data is hidden from the map', 'eye-off', btn('Show', 'link', size='sm', aria='Show Site data'))
    rows = (srow('MNT · IGN 2025', None, grip=False, eye='none', opens=False, pending=('Import progress for MNT · IGN 2025', 42),
                 trail=state('Importing · 42%') + ib('close', 'Cancel import', size='sm', extra=' title="Cancel import"'))
            + srow('MNT · IGN 0.5 m', 'schwarzwald', chev='open')
            + srow('Slope in percent', None, depth=1, grip=False, eye='none', opens=False,
                   trail=state('Calculating') + ib('close', 'Cancel calculation', size='sm', extra=' title="Cancel calculation"'))
            + srow('Slope', 'ylorrd', depth=1, trail=refresh_chip('Slope'))
            + srow('MNS · IGN 0.5 m', 'turbid', trail=state('Preparing'))
            + srow('MNT · Haie nord', 'schwarzwald', eye='missing', vis=True, trail=state('Missing', warn=True), body=missing_body('MNT · Haie nord'))
            + srow('MNH · IGN 0.5 m', 'greens', vis=False)
            + srow('Drone survey · 2023', 'schwarzwald', chev='closed', trail=state('Display failed', warn=True)))
    # Every swatch dims while Layers hides all site data (the rows keep their own eyes).
    rows = rows.replace('border: 1px solid var(--line-strong); background: linear', 'opacity: 0.4; border: 1px solid var(--line-strong); background: linear')
    # Another moment: more than 8 items bring the filter; a match keeps its source, and the grips hide while filtering.
    found = (srow('MNT · IGN 0.5 m', 'schwarzwald', chev='open', grip=False) + srow('Slope', 'ylorrd', depth=1, grip=False)
             + srow('Drone survey · 2023', 'schwarzwald', chev='open', grip=False) + srow('Slope in percent', 'ylorrd', depth=1, grip=False))
    filt = (f'<div class="card" style="padding: 8px 4px 6px; display: flex; flex-direction: column; gap: 6px;"><div style="padding: 0 6px;">'
            f'{search("Filter by name", "slope", aria="Filter site data")}</div>'
            f'<ul aria-label="Site data, front to back" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;">{found}</ul></div>')
    note = inset('Another Design, 14 items: the filter keeps each match’s source; reordering waits until it is cleared.', filt, 96, 96, 440)
    return (f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard"></div>' + plants_over()
            + site_panel(rows, head='', above=hidden) + site_chrome() + note)


@board('SiteDataDark', title='Dark theme · Site data with values; the Slope row open, range Custom 0–30°', group='theme', dark=True)
def site_data_dark():
    return site_base(slope=0.7) + map_svg(cursor(842, 318)) + site_panel(orchard_rows('Slope', VALUES), head='') + site_chrome()


# ============================================================ profile
PROFILE_M = 184
PTS = [(380, 600), (560, 470), (790, 400)]  # board pixels at 1:1,500 (2.52 px per metre): 183 m


def _mnt(d):
    return 128.1 + 2.4 * d / PROFILE_M + 0.8 / (1 + math.exp(-(d - 104) / 1.5)) + 0.9 * math.sin(3 * math.pi * d / PROFILE_M)


TREES = [(30, 9.0, 6), (62, 14.2, 8), (140, 11.0, 7), (166, 6.0, 5)]


def _chm(d):
    h = max(t * math.exp(-((d - c) / w) ** 2) for c, t, w in TREES)
    return h if h > 0.3 else 0.0


def _mns(d):
    return None if 148 <= d <= 156 else _mnt(d) + _chm(d)


DIST = list(range(0, PROFILE_M + 1, 2))
CURVES = [('MNT · IGN 0.5 m', 'elev', [_mnt(d) for d in DIST], 'var(--curve-1)'),
          ('MNS · IGN 0.5 m', 'elev', [_mns(d) for d in DIST], 'var(--curve-2)'),
          ('MNH · IGN 0.5 m', 'height', [_chm(d) for d in DIST], 'var(--curve-3)')]


def _stats(vals):
    ok = [v for v in vals if v is not None]
    steep = max((abs(b - a) / 2 * 100, DIST[i]) for i, (a, b) in enumerate(zip(vals, vals[1:])) if a is not None and b is not None)
    return ok[-1] - ok[0], steep


def _fmt_rise(r):
    return f'Rise {"+" if r >= 0 else "−"}{abs(r):.1f} m'


def profile_chart(at=74, hover=True, width=408):
    """The profile section pinned to the bottom of the panel: header, two stacked plots sharing distance and cursor, legend."""
    x0, x1 = 54, width - 6
    sx = lambda d: x0 + (x1 - x0) * d / PROFILE_M  # noqa: E731
    elev = [v for _, k, vals, _ in CURVES if k == 'elev' for v in vals if v is not None]
    lo, hi = min(elev), max(elev)
    ey0, ey1 = 6, 112
    hy0, hy1 = 124, 172
    hmax = max(v for _, k, vals, _ in CURVES if k == 'height' for v in vals)

    def path(vals, y0, y1, vlo, vhi):
        out, pen = '', False
        for d, v in zip(DIST, vals):
            if v is None:
                pen = False
                continue
            y = y1 - (y1 - y0) * (v - vlo) / (vhi - vlo)
            out += f'{"L" if pen else "M"}{sx(d):.1f} {y:.1f}'
            pen = True
        return out
    svg = ''
    for y in (ey1, hy1):
        svg += f'<line x1="{x0}" x2="{x1}" y1="{y}" y2="{y}" style="stroke: var(--line-strong);" stroke-width="1"></line>'
    lab = 'font-size: 12px; fill: var(--muted);'
    svg += (f'<text x="{x0 - 6}" y="{ey0 + 9}" text-anchor="end" style="{lab}">{hi:.1f} m</text><text x="{x0 - 6}" y="{ey1}" text-anchor="end" style="{lab}">{lo:.1f} m</text>'
            f'<text x="{x0 - 6}" y="{hy0 + 9}" text-anchor="end" style="{lab}">{hmax:.1f} m</text><text x="{x0 - 6}" y="{hy1}" text-anchor="end" style="{lab}">0 m</text>')
    for t in (0, 50, 100, 150):
        svg += (f'<line x1="{sx(t):.1f}" x2="{sx(t):.1f}" y1="{hy1}" y2="{hy1 + 4}" style="stroke: var(--line-strong);"></line>'
                f'<text x="{sx(t):.1f}" y="{hy1 + 17}" text-anchor="{"start" if t == 0 else "middle"}" style="{lab}">{t} m</text>')
    for name, k, vals, col in CURVES:
        y0, y1, vlo, vhi = (ey0, ey1, lo, hi) if k == 'elev' else (hy0, hy1, 0, hmax)
        svg += f'<path d="{path(vals, y0, y1, vlo, vhi)}" fill="none" style="stroke: {col};" stroke-width="1.8" stroke-linejoin="round"></path>'
    readings = {}
    if hover:
        cx = sx(at)
        svg += f'<line x1="{cx:.1f}" x2="{cx:.1f}" y1="{ey0}" y2="{hy1}" style="stroke: var(--ink-2);" stroke-width="1"></line>'
        i = DIST.index(at)
        for name, k, vals, col in CURVES:
            v = vals[i]
            readings[name] = v
            if v is None:
                continue
            y0, y1, vlo, vhi = (ey0, ey1, lo, hi) if k == 'elev' else (hy0, hy1, 0, hmax)
            y = y1 - (y1 - y0) * (v - vlo) / (vhi - vlo)
            svg += f'<circle cx="{cx:.1f}" cy="{y:.1f}" r="3.5" style="fill: {col}; stroke: var(--surface);" stroke-width="1.5"></circle>'
    plot = (f'<svg role="img" aria-label="Profile chart: elevation of MNT and MNS, height of MNH, along {PROFILE_M} m" width="{width}" height="{hy1 + 22}" '
            f'style="display: block; touch-action: none; cursor: crosshair;">{svg}</svg>')
    leg = ''
    for name, k, vals, col in CURVES:
        sw = f'<span aria-hidden="true" style="width: 16px; height: 3px; border-radius: 2px; background: {col}; flex-shrink: 0;"></span>'
        if hover:
            v = readings[name]
            right = val(f'{v:.2f} m') if v is not None else NODATA
        elif k == 'elev':
            rise, (steep, where) = _stats(vals)
            right = (f'<span class="small" style="color: var(--ink-2);">{_fmt_rise(rise)} · </span>'
                     + btn(f'Steepest {steep:.0f}% over 2 m', 'link', size='sm', aria=f'Steepest {steep:.0f}% over 2 m, at {where} m: move the cursor there', extra=' style="padding: 0 2px; height: 24px; font-size: 12.5px;"'))
        else:
            right = f'<span class="small" style="color: var(--ink-2);">Highest {max(vals):.1f} m</span>'
        leg += (f'<div style="display: flex; align-items: center; gap: 8px; min-height: 24px;">{sw}<span style="flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{esc(name)}</span>'
                f'<span style="display: inline-flex; align-items: center; flex-shrink: 0;">{right}</span></div>')
    i = uid('pf')
    at_html = f'<span class="small num" role="status" style="color: var(--ink-2);">At {at} m</span>' if hover else '<span role="status"></span>'
    head = (f'<div style="display: flex; align-items: center; gap: 8px;"><h3 id="{i}" style="font-size: 14px; font-weight: 600;">Profile</h3>'
            f'<span class="small muted num">{PROFILE_M} m</span>{at_html}<span style="flex: 1 1 auto;"></span>'
            f'{btn("Copy values", size="sm", ic="copy")}{ib("close", "Close profile", size="sm")}</div>')
    return (f'<section aria-labelledby="{i}" style="flex: none; border-top: 1px solid var(--line); padding: 8px 10px 10px 16px; display: flex; flex-direction: column; gap: 4px;">'
            f'{head}{plot}<div style="display: flex; flex-direction: column;">{leg}</div></section>')


def profile_line(at=74):
    pts = ' '.join(f'{x},{y}' for x, y in PTS)
    seg_len = [math.dist(a, b) for a, b in zip(PTS, PTS[1:])]
    target = sum(seg_len) * at / PROFILE_M
    (ax, ay), (bx, by) = PTS[0], PTS[1]
    for i, L in enumerate(seg_len):
        if target <= L:
            (ax, ay), (bx, by) = PTS[i], PTS[i + 1]
            break
        target -= L
    t = target / math.dist((ax, ay), (bx, by))
    hx, hy = ax + (bx - ax) * t, ay + (by - ay) * t
    dots = ''.join(f'<circle cx="{x}" cy="{y}" r="4" fill="{MAPINK["line"]}" stroke="{MAPINK["casing"]}" stroke-width="2"></circle>' for x, y in PTS)
    return map_svg(f'<polyline points="{pts}" fill="none" stroke="{MAPINK["casing"]}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"></polyline>'
                   f'<polyline points="{pts}" fill="none" stroke="{MAPINK["line"]}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></polyline>{dots}'
                   f'<circle cx="{hx:.1f}" cy="{hy:.1f}" r="7" fill="none" stroke="{MAPINK["ink"]}" stroke-width="4"></circle>'
                   f'<circle cx="{hx:.1f}" cy="{hy:.1f}" r="7" fill="none" stroke="{MAPINK["ring"]}" stroke-width="2"></circle>')


@board('SiteDataProfile', title='Profile · a drawn line, its curves pinned under the rows, the cursor mirrored on the map', group='sitedata')
def site_data_profile():
    rows = (srow('MNT · IGN 0.5 m', 'schwarzwald', chev='open') + srow('Slope', 'ylorrd', depth=1, vis=False)
            + srow('MNS · IGN 0.5 m', 'turbid') + srow('MNH · IGN 0.5 m', 'greens') + srow('Drone survey · 2023', 'schwarzwald', chev='closed', vis=False))
    card = toolcard('Profile', ['Click to add points. Double-click or press Enter to finish.', 'Backspace removes the last point · Shift keeps 45° angles · Esc to cancel'])
    card = card.replace('position: absolute; left: 76px; top: 72px; width: 320px;', 'width: 100%;').replace('class="float"', 'class="card"')
    rest = f'<div class="card" style="padding: 8px 10px; display: flex; flex-direction: column;">{_legend_at_rest()}</div>'
    line_menu = menu([('#', 'Line zone · L02 · 46 m'), ('Cut', 'Ctrl X'), ('Copy', 'Ctrl C'), ('Duplicate', 'Ctrl D'), ('Rename zone…', ''), '-',
                      ('Profile this line', '', 'hot'), '-', ('Lock', 'Ctrl Shift L'), '-', ('Delete', 'Del', 'danger')], 260, label='Line zone · L02')
    return (z18_map() + terrain(0.85) + profile_line() + site_panel(rows, chart=profile_chart())
            + chrome(panel='sitedata', name='Untitled Design', status='Draft', kind='draft', scale=('1:1,500', '50 m', 126), attrib='© OpenFreeMap · IGN')
            + inset('While drawing: the tool card', card, 76, 640, 344)
            + inset('At rest, the legend gives each curve’s rise and steepest slope', rest, 440, 640, 452)
            + inset('A Line zone’s or Measure guide’s menu: Profile this line draws its profile', line_menu, 96, 96, 284))


def _legend_at_rest():
    html = profile_chart(hover=False)
    start = html.index('<div style="display: flex; flex-direction: column;">')
    return html[start:html.rindex('</section>')]


# ============================================================ import and analyze (over the Site data panel)
def over_site(dlg, top=96):
    return (site_base() + site_panel(orchard_rows()) + site_chrome() + '<div class="scrim"></div>'
            + f'<div style="position: absolute; left: 50%; top: {top}px; transform: translateX(-50%);">{dlg}</div>')


@board('Import', title='Import terrain or height data · name, what the values measure, ordered files, coverage', group='sitedata')
def import_dialog():
    files = ''.join(f'<div class="row" style="min-height: 38px; gap: 6px; padding: 0 4px 0 8px;">{icon("file", "s16")}<span class="mono" style="font-size: 12.5px; flex: 1 1 auto;">{f}</span><span class="small muted">{s}</span>'
                    f'{ib("chev-u", "Move " + f + " up", size="sm", extra=" disabled" if i == 0 else "")}{ib("chev-d", "Move " + f + " down", size="sm", extra=" disabled" if i == 1 else "")}{ib("close", "Remove " + f, size="sm")}</div>'
                    for i, (f, s) in enumerate([('LHD_FXX_0470_6800_MNT_O_0M50.tif', '38 MB'), ('LHD_FXX_0470_6801_MNT_O_0M50.tif', '41 MB')]))
    body = ('<p style="margin: 0;"><b style="font-weight: 600; color: var(--ink);">Single-band GeoTIFF rasters.</b> Ground elevation (a terrain model such as IGN LiDAR HD MNT tiles), '
            'surface elevation (IGN MNS) or height above ground (IGN MNH), in a projected grid. Tiles that share one grid become one item.</p>'
            + field('Name', textin('MNT · IGN 0.5 m', aria='Name', err=True), 'Your library already has data named “MNT · IGN 0.5 m”. Choose another name, for example “MNT · IGN 0.5 m · 2”.', err=True)
            + field('What the values measure', dropdown('Ground elevation (DTM)', 'What the values measure'), 'Values are read in metres.')
            + f'<div class="field"><span class="lbl">Files · 2</span><div class="card" style="padding: 4px;">{files}</div><span class="hint">Where files overlap, the first file in the list wins.</span></div>'
            + notice('info', '<b style="font-weight: 600;">Covers your site.</b> The files span 2 × 1 km.', 'check')
            + '<span class="hint">Imported data goes to your library and is added to this Design when it is ready.</span>')
    return over_site(dialog('Import terrain or height data', body, btn('Cancel') + btn('Import 2 files', 'primary'), 560), 80)


@board('AnalyzeDialog', title='Analyze · from the Site data toolbar; the source defaults to the open item', group='sitedata')
def analyze():
    opt = ('<label class="row tile-sel" style="min-height: 58px; gap: 12px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer;">'
           '<input type="radio" name="an" checked="{{ true }}"><span style="display: flex; flex-direction: column; line-height: 1.3; flex: 1 1 auto;">'
           '<b style="font-weight: 600; color: var(--ink);">Slope</b><span class="small muted">Steepness of the ground, from ground elevation.</span></span></label>')
    body = (field('Source', dropdown('MNT · IGN 0.5 m', 'Source'))
            + '<p style="margin: 0;">Results are added under their source in Site data and kept in your library.</p>'
            + f'<fieldset style="border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;"><legend class="sec" style="padding: 0 0 4px;">Terrain</legend>{opt}</fieldset>'
            + field('Unit', seg(['Degrees', 'Percent'], 'Degrees', 'Unit'), 'Degrees from level (0–90°), or rise over run in percent.')
            + field('Result name', textin('Slope', aria='Result name'))
            + notice('info', 'Already in Site data.', 'check'))
    return over_site(dialog('Analyze', body, btn('Cancel') + btn('Show in Site data', 'primary'), 500), 112)


# ============================================================ Data library (a large sheet)
LIB = [  # key, name, caption, ramp, depth, in this Design, state
    ('drone', 'Drone survey · 2023', 'Ground elevation (DTM) · 0.1 m', 'schwarzwald', 0, True, ''),
    ('dslope', 'Slope in percent', 'Slope · percent', 'ylorrd', 1, True, ''),
    ('mnh', 'MNH · IGN 0.5 m', 'Height above ground (CHM) · 0.5 m', 'greens', 0, True, ''),
    ('mns', 'MNS · IGN 0.5 m', 'Surface elevation (DSM) · 0.5 m', 'schwarzwald', 0, True, ''),
    ('mnt', 'MNT · IGN 0.5 m', 'Ground elevation (DTM) · 0.5 m', 'schwarzwald', 0, True, ''),
    ('slope', 'Slope', 'Slope · degrees', 'ylorrd', 1, True, ''),
    ('ign25', 'MNT · IGN 2025', 'Ground elevation (DTM) · 0.5 m', None, 0, False, 'Preparing'),
    ('ferte', 'MNT · La Ferté 2022', 'Ground elevation (DTM) · 1 m', 'schwarzwald', 0, False, ''),
    ('soil', 'Soil moisture · 2024', 'Other values · %', 'magma', 0, False, ''),
]


def thumb(rmp, w=56, h=42):
    if rmp is None:
        return f'<span aria-hidden="true" style="width: {w}px; height: {h}px; border-radius: 6px; flex-shrink: 0; border: 1px solid var(--line-strong); background: var(--surface-2);"></span>'
    return f'<span aria-hidden="true" style="width: {w}px; height: {h}px; border-radius: 6px; flex-shrink: 0; border: 1px solid var(--line-strong); background: {ramp(rmp, 135)};"></span>'


def _lib_list(selected):
    rows = ''
    for key, name, cap, rmp, depth, here, st in LIB:
        on = key == selected
        suffix = ' · In this Design' if here else ''
        state_html = f'<span class="small muted">{esc(st)}</span>' if st else ''
        rows += (f'<div role="option" aria-selected="{"true" if on else "false"}" tabindex="{0 if on else -1}" class="row{" sel" if on else ""}" '
                 f'style="min-height: 58px; gap: 12px; padding: 0 10px 0 {10 + depth * 22}px; cursor: pointer;">{thumb(rmp)}'
                 f'<span style="display: flex; flex-direction: column; min-width: 0; line-height: 1.25;"><b style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{esc(name)}</b>'
                 f'<span class="small muted">{esc(cap)}{suffix}</span>{state_html}</span></div>')
    return f'<div role="listbox" aria-label="Data in your library" style="display: flex; flex-direction: column; gap: 2px;">{rows}</div>'


def _facts(items):
    dl = ''.join(f'<dt class="small muted" style="padding: 6px 0; border-bottom: 1px solid var(--line);">{a}</dt>'
                 f'<dd class="small" style="margin: 0; padding: 6px 0; border-bottom: 1px solid var(--line); color: var(--ink);">{b}</dd>' for a, b in items)
    return f'<dl style="margin: 0; display: grid; grid-template-columns: 150px minmax(0, 1fr);">{dl}</dl>'


def _link(text):
    return btn(text, 'link', size='sm', extra=' style="padding: 0; height: 24px;"')


def _history(runs):
    items = ''.join(f'<div style="display: flex; flex-direction: column; line-height: 1.3;"><b class="small" style="font-weight: 600; color: var(--ink);">{a}</b><span class="small muted">{b}</span></div>' for a, b in runs)
    return f'<div style="display: flex; flex-direction: column; gap: 6px;"><h4 class="sec" style="padding: 4px 0 0;">Processing history</h4>{items}</div>'


def _disclosure(text):
    return f'<button type="button" class="btn ghost sm" aria-expanded="false" style="align-self: flex-start; margin-left: -10px;">{icon("chev-r", "s16")}{esc(text)}</button>'


def _details(key, actions=None):
    """One item's details: name and Rename…, preview, facts, provenance, files and history, actions."""
    if key == 'slope':
        name, rmp = 'Slope', 'ylorrd'
        facts = [('Type', 'Slope'), ('Units', '°'), ('Resolution', '0.5 m'), ('Value range', '0 – 41°'), ('Status', 'Ready'), ('Added', 'Oct 7, 2026'),
                 ('Analysis', 'Slope · Version 1'), ('Calculated from', _link('MNT · IGN 0.5 m')), ('Unit', 'Degrees'),
                 ('Engine', 'GeoLibre 1.5.3 (aac2b74)'), ('Created', 'Oct 7, 2026, 5:41 PM')]
        extra = _history([('Completed · current', 'Oct 7, 5:41 PM · 4,120,000 cells published')])
        acts = btn('Show in Site data', 'primary', size='sm') + btn('Run again with changes…', size='sm')
    else:
        name, rmp = 'MNT · IGN 0.5 m', 'schwarzwald'
        facts = [('Type', 'Ground elevation (DTM)'), ('Units', 'm'), ('Resolution', '0.5 m'), ('Value range', '112.3 – 147.9 m'), ('Status', 'Ready'), ('Added', 'Oct 2, 2026'),
                 ('Saved results', _link('Slope'))]
        extra = _disclosure('Source files (2)') + _history([('Completed', 'Oct 2, 4:12 PM · 2 files · 8,240,000 cells')])
        acts = btn('Show in Site data', 'primary', size='sm')
    acts = actions if actions is not None else f'{acts}{btn("Delete everywhere", "danger-ghost", size="sm")}'
    return (f'<div style="display: flex; flex-direction: column; gap: 12px; max-width: 640px;">'
            f'<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;"><h3 class="disp" style="font-size: 20px;">{esc(name)}</h3>{btn("Rename…", "link", size="sm")}'
            f'<span style="flex: 1 1 auto;"></span>{acts}</div>'
            f'<div role="img" aria-label="Preview of {esc(name)}" style="width: 640px; height: 328px; border-radius: 8px; border: 1px solid var(--line-strong); background: {ramp(rmp, 160)};"></div>'
            f'{_facts(facts)}{extra}</div>')


def library_sheet(selected='mnt', w=1200, h=852):
    i = uid('lib')
    head = (f'<div style="display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px 22px; border-bottom: 1px solid var(--line);">'
            f'<h2 class="dtitle" id="{i}" style="flex: 0 0 auto;">Data library</h2><span style="flex: 1 1 auto;"></span>'
            f'<div style="width: 280px;">{search("Search data")}</div><div style="width: 170px; display: flex; flex-direction: column;">{dropdown("All types", "Type")}</div>'
            f'<div style="width: 190px; display: flex; align-items: center; gap: 8px;"><span class="lbl" aria-hidden="true">Sort</span>'
            f'<span style="flex: 1 1 auto; display: flex; flex-direction: column;">{dropdown("Name", "Sort")}</span></div>{ib("close", "Close", size="sm")}</div>')
    body = (f'<div style="flex: 1 1 auto; min-height: 0; display: flex;">'
            f'<div class="scroll" style="width: 360px; flex-shrink: 0; border-right: 1px solid var(--line); padding: 8px; overflow-y: auto;">{_lib_list(selected)}</div>'
            f'<div class="scroll" style="flex: 1 1 auto; min-width: 0; padding: 20px 28px; overflow-y: auto;">{_details(selected)}</div></div>')
    foot = (f'<div class="dfoot" style="justify-content: space-between;"><span class="small muted">9 items · 1.2 GB on this computer</span>{btn("Show in folder", "ghost")}</div>')
    return (f'<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="{i}" style="position: absolute; left: {(1440 - w) // 2}px; top: {(900 - h) // 2}px; '
            f'width: {w}px; height: {h}px; overflow: hidden;">{head}{body}{foot}</div>')


def _confirm(title, body, actions):
    return (f'<div role="alertdialog" aria-label="{esc(title)}" class="card" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; width: 520px;">'
            f'<h3 style="font-size: 15px; font-weight: 600;">{esc(title)}</h3>{body}<div style="display: flex; gap: 8px; justify-content: flex-end;">{actions}</div></div>')


def library_board(selected):
    return (site_base() + site_panel(orchard_rows()) + site_chrome() + '<div class="scrim"></div>' + library_sheet(selected))


@board('Library', h=1240, title='Data library · a large sheet: list and details; delete is confirmed in place of the actions', group='sitedata')
def library():
    top = f'<div style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px; overflow: hidden;">{library_board("mnt")}</div>'
    ok = _confirm('Delete MNT · La Ferté 2022?',
                  '<p style="margin: 0;">The data will be removed from the library.</p><p class="small muted" style="margin: 0;">Canopi doesn’t keep track of which other Designs use it. Any that do will show it as unavailable.</p>'
                  '<p class="small muted" style="margin: 0;">This cannot be undone.</p>', btn('Keep', size='sm') + btn('Delete everywhere', 'danger', size='sm'))
    blocked = _confirm('Delete MNT · IGN 0.5 m?', '<p style="margin: 0;">Saved results depend on this data (1). Delete them first.</p>', btn('Keep', size='sm'))
    low = (f'<div style="position: absolute; left: 0; top: 900px; width: 1440px; height: 340px; padding: 28px 48px; display: flex; flex-direction: column; gap: 16px; border-top: 1px solid var(--line);">'
           + H('Delete everywhere, confirmed in place', 'The confirmation replaces the action row beside the name in the details pane. An item with saved results cannot be deleted until they are.')
           + f'<div style="display: flex; gap: 32px; align-items: flex-start;">{ok}{blocked}</div></div>')
    return top + low


board('LibraryDark', title='Dark theme · Data library with a result selected: provenance links, Run again with changes…', group='theme', dark=True)(lambda: library_board('slope'))


# ============================================================ planned: water flow (2.1)
@board('WaterFlow', title='Water flow (2.1 preview) · streams and wetness under their source, blue for water only', group='analyses')
def water_flow():
    leg = ''.join(f'<span style="display: flex; align-items: center; gap: 8px;" class="small"><span style="width: 36px; height: {w}px; border-radius: 3px; background: {WATER};"></span>Order {o}</span>'
                  for o, w in [(1, 2), (2, 3), (3, 5), (4, 7)])
    body = (f'<span class="small muted">from MNT · IGN 0.5 m · lines · order 1–4</span>'
            f'<div role="img" aria-label="Legend: stream order 1 to 4" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px;">{leg}</div>{opacity("Streams", 100)}'
            f'<div style="display: flex; align-items: flex-start; gap: 6px;">{btn("Fit to data", size="sm")}{btn("Details", size="sm")}<span style="flex: 1 1 auto;"></span>{remove("Streams")}</div>')
    rows = (srow('MNT · IGN 0.5 m', 'schwarzwald', chev='open', vis=False)
            + srow('Slope', 'ylorrd', depth=1, vis=False)
            + srow('Water flow', None, depth=1, chev='open', grip=False, eye='none', opens=False)
            + srow('Streams', line_swatch(WATER), depth=2, trail=val('Order 3'), body=body)
            + srow('Wetness index', 'blues', depth=2, trail=val('11.20'))
            + srow('Upslope area', 'blues', depth=2, vis=False))
    return (z18_map() + f'<img src="{blob("wetness")}" alt="Wetness index" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px; opacity: 0.55;">'
            + f'<img src="{blob("streams")}" alt="Streams" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">'
            + map_svg(cursor(604, 516)) + site_panel(rows, head='')
            + chrome(panel='sitedata', name='Untitled Design', status='Draft', kind='draft', scale=('1:1,500', '50 m', 126), attrib='© OpenFreeMap · IGN'))
