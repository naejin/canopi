"""Boards: moving and turning the map (canvas navigation). Rules: ../patterns/canvas-navigation.md."""
import math

from build import board, blob
from common import *  # noqa: F401,F403
from boards_b import settings_dialog

BEARING = 30  # the view turned 30° clockwise from north
TURNED_SCALE = ('1:100', '2 m', 76)  # the turned boards are 1.9 × the site boards (5 m = 190 px)
ORIGIN = (640, 470)


def turn(x, y, ox=ORIGIN[0], oy=ORIGIN[1]):
    """A ground point (board px, north up) as it appears on the turned map, zoomed like plants-turned."""
    a = math.radians(-BEARING)
    dx, dy = (x - ox) * 1.9, (y - oy) * 1.9
    return ox + dx * math.cos(a) - dy * math.sin(a), oy + dx * math.sin(a) + dy * math.cos(a)


def turned_map(left=0, top=0):
    """Imagery and plants turned with the map; plant symbols stay upright (drawn by overlay.py with a bearing)."""
    pos = f'left: {left}px; top: {top}px; width: 1440px; height: 900px;'
    return (f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard, turned {BEARING}° from north" '
            f'style="{pos} transform-origin: {ORIGIN[0]}px {ORIGIN[1]}px; transform: rotate(-{BEARING}deg) scale(1.9);"></div>'
            f'<div style="position: absolute; inset: 0; overflow: hidden;"><img src="{blob("plants-turned")}" alt="" style="position: absolute; {pos}"></div>')


def turned_grid(step=190):
    """The grid stays on true east and north, so it turns with the map."""
    lines = ''.join(f'<line x1="{v}" y1="-1400" x2="{v}" y2="2400" stroke="#FFF8EC" stroke-opacity="0.35" stroke-width="1"></line>'
                    f'<line x1="-1400" y1="{v}" x2="2800" y2="{v}" stroke="#FFF8EC" stroke-opacity="0.35" stroke-width="1"></line>'
                    for v in range(ORIGIN[0] - 10 * step, ORIGIN[0] + 11 * step, step))
    return (f'<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true">'
            f'<g transform="rotate(-{BEARING} {ORIGIN[0]} {ORIGIN[1]})">{lines}</g></svg>')


def rulers_hint(bottom=60):
    return (f'<div class="float" role="status" style="position: absolute; left: 12px; bottom: {bottom}px; height: 36px; display: flex; align-items: center; gap: 8px; '
            f'padding: 0 4px 0 10px; border-radius: 11px; font-size: 12.5px; color: var(--ink-2);">{icon("ruler", "s16")}Rulers show when north is up'
            f'{btn("Reset north", "link", size="sm")}</div>')


@board('Navigation', title='Navigation · the map turned 30°: compass, rulers hint, Turn view to this edge', group='navigation')
def navigation():
    # A zone drawn north up (a ground rectangle), seen on the turned map; its south edge is the one right-clicked.
    corners = [turn(x, y) for x, y in [(620, 300), (760, 300), (760, 360), (620, 360)]]
    pts = ' '.join(f'{x:.1f},{y:.1f}' for x, y in corners)
    (ax, ay), (bx, by) = corners[3], corners[2]
    # No edge highlight while "Turn view to this edge" is in the menu (user, 2026-10-01).
    zone = (f'<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true">'
            f'<polygon points="{pts}" fill="#FFF8EC" fill-opacity="0.08" stroke="#FFF8EC" stroke-width="5"></polygon>'
            f'<polygon points="{pts}" fill="none" stroke="#9C5A16" stroke-width="2"></polygon></svg>')
    cx = sum(x for x, _ in corners) / 4
    cy = sum(y for _, y in corners) / 4
    label = mname(cx, cy, 'Verger nord')  # zone names stay upright
    nx, ny = turn(470, 560)
    note = (f'<span class="mname maplabel" style="left: {nx:.0f}px; top: {ny:.0f}px; transform: translate(-50%, -50%) rotate(-{BEARING}deg);">'
            f'Paillage BRF en novembre</span>')  # a note written north up turns with the map
    px, py = (ax + bx) / 2, (ay + by) / 2  # the pointer, on the edge
    m = menu([('#', 'Zone · Z04 · 118 m² · 46 m'), ('Cut', 'Ctrl X'), ('Copy', 'Ctrl C'), ('Paste', 'Ctrl V', 'dis'), ('Duplicate', 'Ctrl D'), ('Rename zone…', ''), '-',
              ('Arrange', '', 'sub'), ('Rotate…', 'Ctrl Alt R'), ('Save as stamp…', ''), '-',
              ('Turn view to this edge', '', 'hot'), '-',
              ('Lock', 'Ctrl Shift L'), '-', ('Delete', 'Del', 'danger')], 280,
             f' position: absolute; left: {px + 4:.0f}px; top: {py + 4:.0f}px;', label='Zone · Z04')
    card = toolcard('Select', ['Drag to select · Shift-click adds · Alt-click removes · right-drag pans · wheel zooms'])
    chip = statuschip(f'<span>Zone · Z04 · 118 m² · 46 m</span>{btn("Rename…", "ghost", size="sm")}{ib("close", "Clear selection", size="sm")}', 'Selection')
    return (turned_map() + turned_grid() + zone + label + note + card + chip + rulers_hint()
            + chrome(scale=TURNED_SCALE, bearing=BEARING, grid=True, rulers=True) + m)


@board('NavigationSettings', title='Settings › Canvas · one choice: mouse or trackpad', group='navigation')
def navigation_settings():
    return (turned_map() + turned_grid() + rulers_hint() + chrome(scale=TURNED_SCALE, bearing=BEARING, grid=True, rulers=True)
            + '<div class="scrim"></div>' + f'<div style="position: absolute; left: 50%; top: 140px; transform: translateX(-50%);">{settings_dialog("canvas")}</div>')


@board('NavigationPhone', w=390, h=844, title='Web Edition on a phone · the map turned, Fit and the compass in the zoom column', group='navigation')
def navigation_phone():
    tabs = ''.join(f'<button type="button" role="tab" aria-selected="false" class="chip" style="min-height: 44px; flex-shrink: 0;">{t}</button>' for t in ['Layers', 'Plants', 'Catalog', 'Calendar', 'More'])
    return f'''
{turned_map(-445, -80)}
<header class="float" style="position: absolute; left: 8px; right: 8px; top: 8px; height: 56px; display: flex; align-items: center; gap: 2px; padding: 0 4px;">
  {ib("menu", "Menu", size="touch")}<div style="flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; line-height: 1.2;"><span class="disp" style="font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{esc(ORCHARD)}</span>{save_status("Saved in this browser", "web")}</div>
  {ib("undo", "Undo", size="touch")}{ib("search", "Search a place", size="touch")}
</header>
<div class="float" role="toolbar" aria-label="Tools" style="position: absolute; left: 8px; top: 72px; display: flex; flex-direction: column; gap: 2px; padding: 4px;">{ib("select", "Select", True, "touch")}{ib("hand", "Pan", size="touch")}{ib("plant", "Place plants", size="touch")}{ib("polygon", "Polygon zone", size="touch")}{ib("more", "More tools", size="touch")}</div>
<div class="float" role="group" aria-label="Zoom" style="position: absolute; right: 8px; top: 280px; display: flex; flex-direction: column; gap: 2px; padding: 4px;">{ib("plus", "Zoom in", size="touch")}{ib("minus", "Zoom out", size="touch")}{ib("fit", "Fit to Design", size="touch")}<div class="rule" role="separator" style="margin: 2px 4px;"></div>{compass(BEARING, size="touch")}</div>
<span class="attrib" style="position: absolute; right: 8px; bottom: 124px;">© Google</span>
<span class="float num" style="position: absolute; left: 8px; bottom: 128px; padding: 2px 8px; border-radius: 8px; font-size: 12.5px;">1:100</span>
<section class="float" aria-label="Panels" style="position: absolute; left: 0; right: 0; bottom: 0; height: 112px; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; padding: 4px 10px 0; padding-bottom: env(safe-area-inset-bottom);">
  <button type="button" aria-label="Expand sheet" aria-expanded="false" style="align-self: center; width: 88px; height: 44px; margin: -10px 0 -6px; border: 0; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span style="width: 40px; height: 5px; border-radius: 3px; background: var(--line-strong);"></span></button>
  <div role="tablist" aria-label="Panels" style="display: flex; gap: 4px; overflow-x: auto; padding-bottom: 8px;">{tabs}</div>
</section>'''
