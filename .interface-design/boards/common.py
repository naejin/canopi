"""Shared pieces for board modules: data, map backgrounds, map annotations."""
import assets
from build import blob
from ds import *  # noqa: F401,F403

ORCHARD = "Le Sanctuaire d'Aylin – Verger Syntropique"
ORCH = assets.orchard()
STRATA = ['Emergent', 'High', 'Mid', 'Low']
STRATUM_COLOR = {'Emergent': '#5A3E1B', 'High': '#B5462F', 'Mid': '#1F6F8B', 'Low': '#7A8B2A'}
CLOSE = ('1:75', '1 m', 52)
SITE = ('1:190', '5 m', 100)


def H(text, sub=''):
    s = f'<p style="margin: 4px 0 0; font-size: 15px; color: var(--muted); max-width: 860px;">{sub}</p>' if sub else ''
    return f'<div><h1 class="disp" style="font-size: 28px;">{esc(text)}</h1>{s}</div>'


def section(title, inner, extra=''):
    return f'<section style="display: flex; flex-direction: column; gap: 12px;{extra}"><h2 class="disp" style="font-size: 18px;">{esc(title)}</h2>{inner}</section>'


def close_map(overlay='plants-close', dim=0.0):
    d = f'<div style="position: absolute; inset: 0; background: var(--paper); opacity: {dim};"></div>' if dim else ''
    return (f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view, close up" style="transform-origin: 640px 470px; transform: scale(2.6);"></div>{d}'
            f'<img src="{blob(overlay)}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">')


def site_map(overlay='plants-site'):
    return (f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard"></div>'
            f'<img src="{blob(overlay)}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">')


def z18_map():
    return f'<div class="map"><img src="{blob("site-z18")}" alt="Satellite view of the site"></div>'


def tag(x, y, text, live=False):
    return f'<span class="mtag{" live" if live else ""}" style="left: {x}px; top: {y}px;">{esc(text)}</span>'


def mname(x, y, text):
    return f'<span class="mname maplabel" style="left: {x}px; top: {y}px;">{esc(text)}</span>'


def cased(el):
    """An SVG overlay element drawn twice: a dark casing underneath so it reads on any imagery."""
    under = el.replace('stroke="#FFF3D6"', 'stroke="rgba(20,16,10,0.6)"').replace('stroke-width="2"', 'stroke-width="4"').replace('stroke-width="1.6"', 'stroke-width="3.6"').replace('stroke-width="2.2"', 'stroke-width="4.2"')
    return under + el


def selbox(x, y, w, h, rotate=True):
    """The selection box: 2 px ochre over a 5 px cream casing, no corner handles; one rotate handle above."""
    rot = ''
    if rotate:
        cx = x + w / 2
        rot = (f'<line x1="{cx}" y1="{y}" x2="{cx}" y2="{y - 22}" stroke="#9C5A16" stroke-width="2"></line>')
    svg = (f'<svg width="1440" height="900" style="position: absolute; inset: 0; overflow: visible;" aria-hidden="true">'
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="none" stroke="#FFF8EC" stroke-width="5"></rect>'
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="none" stroke="#9C5A16" stroke-width="2"></rect>{rot}</svg>')
    if rotate:
        svg += (f'<button type="button" class="ib sm" aria-label="Rotate selection (drag, or Ctrl Alt R to type an angle)" style="position: absolute; left: {x + w / 2 - 14}px; top: {y - 50}px; width: 28px; height: 28px; border-radius: 14px; '
                f'background: var(--surface); color: var(--accent-ink); border: 2px solid var(--accent); box-shadow: var(--shadow-sm);">{icon("rotate", "s16")}</button>')
    return svg


def statuschip(inner, label='Selection'):
    return (f'<div class="float" role="status" aria-label="{esc(label)}" style="position: absolute; left: 50%; transform: translateX(-50%); bottom: 12px; height: 40px; display: flex; align-items: center; gap: 10px; padding: 0 6px 0 12px; border-radius: 11px; font-size: 14px;">{inner}</div>')


def topchip(inner):
    return (f'<div class="float" style="position: absolute; left: 50%; transform: translateX(-50%); top: 72px; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 5px 0 14px; border-radius: 20px; font-size: 14px;">{inner}</div>')


def chrome(active_tool='select', panel=None, name=ORCHARD, status='Saved', kind='ok', scale=SITE, labelled=False, hot=None, attrib='© Google',
           bearing=0, grid=False, rulers=False, **tb):
    return (topbar(name, status, kind, hot=hot, **tb) + toolrail(active_tool, labelled=labelled) + panelrail(panel)
            + viewchip(grid=grid, rulers=rulers) + zoombar(*scale, attrib=attrib, bearing=bearing))


SWATCHES = [('#AB5268', 'Raspberry'), ('#805878', 'Plum'), ('#B06045', 'Brick'), ('#B07A32', 'Ochre'), ('#887044', 'Bark'), ('#70814B', 'Olive'),
            ('#428063', 'Sage'), ('#398379', 'Teal'), ('#507F9B', 'Slate blue'), ('#82629B', 'Lavender'), ('#27231D', 'Ink'), ('#8C8579', 'Stone')]
