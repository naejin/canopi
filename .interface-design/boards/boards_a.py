"""Boards: foundations, start, workspace, designing."""
import json
import os
from build import board, blob
from common import *  # noqa: F401,F403
import ds


# ============================================================ foundations
def _ds_body():
    toks = ['paper', 'surface', 'surface-2', 'ink', 'ink-2', 'muted', 'accent', 'accent-ink', 'accent-soft', 'warn', 'danger', 'focus']
    sw = ''.join(f'<div style="display: flex; flex-direction: column; gap: 6px;"><span style="height: 44px; border-radius: 8px; background: var(--{t}); border: 1px solid var(--line-strong);"></span>'
                 f'<span class="small mono">--{t}</span></div>' for t in toks)
    colours = f'<div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px;">{sw}</div>'
    type_ = ('<div style="display: flex; flex-direction: column; gap: 8px;">'
             '<span class="disp" style="font-size: 28px;">Display 28 · Literata 600</span>'
             '<span class="disp" style="font-size: 20px;">Dialog title 20 · Literata 600</span>'
             '<span class="disp" style="font-size: 18px;">Panel title 18 · Literata 600</span>'
             '<span style="font-size: 15px;">Body 15 · reading text in dialogs and help</span>'
             '<span style="font-size: 14px;">UI 14 · controls, rows and menus</span>'
             '<span style="font-size: 12.5px; color: var(--muted);">Caption 12.5 · hints, counts, metadata. Never below 12 (13 for CJK)</span>'
             '<span class="mono" style="font-size: 12px; font-weight: 600;">MSP LBA SOF2 · species codes, IBM Plex Mono 12</span></div>')
    buttons = ('<div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">'
               + btn('Save PDF…', 'primary') + btn('Cancel') + btn('Show in folder', 'ghost') + btn('Learn more', 'link')
               + btn('Delete', 'danger') + btn('Import…', '', 'import') + btn('Disabled', '', extra=' disabled')
               + '</div><div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">'
               + ib('select', 'Select', on=True) + ib('hand', 'Pan') + ib('eye', 'Hide layer') + ib('lock', 'Unlock layer', cls='soft') + ib('more', 'More actions', size='sm')
               + ib('star', 'Remove from favorites', size='sm', cls='fav')
               + f'<span class="ib focus-demo" style="display: inline-flex;" aria-hidden="true">{icon("layers")}</span><span class="small muted">Keyboard focus: 2 px blue ring, never ochre</span></div>'
               + '<div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">'
               + compass(0) + '<span class="small muted">North up</span>' + compass(30) + '<span class="small muted">Turned 30°</span>'
               + compass(30, cls='dragging') + '<span class="small muted">Turning</span>' + compass(30, cls='focus-demo')
               + '<span class="tip" role="tooltip" style="flex-direction: column; align-items: flex-start; white-space: normal; width: 250px; gap: 2px;">'
               + '<span>Reset north <span class="k">N</span></span><span class="k">Click to reset north. Drag the ring to turn the view; hold Shift for 15° steps.</span></span></div>')
    forms = ('<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">'
             + field('Design name', textin(ORCHARD, aria='Design name'))
             + field('Google Maps API key', textin('', 'Optional', 'key', aria='Google Maps API key'), 'Without a key Canopi uses the free imagery.')
             + field('Search', search('Search names or codes', focus=True))
             + field('Unit cost', textin('-2', '0.00', err=True, aria='Unit cost'), 'Enter a number of zero or more.', err=True)
             + field('Color by', seg(['Species', 'Stratum', 'One color'], 'Species', 'Color by'))
             + field('Currency', dropdown('Euro (EUR)', 'Currency'))
             + '<div style="display: flex; flex-direction: column; gap: 6px;">' + check('Show labels', True) + check('Snap to grid') + '</div>'
             + '<div style="display: flex; flex-direction: column; gap: 4px;">' + switch_row('Open new Designs on satellite', True) + switch_row('Single-key shortcuts', False) + slider('Opacity', 80, '%') + '</div></div>')
    menus = ('<div style="display: flex; gap: 20px; align-items: flex-start;">'
             + menu([('Cut', 'Ctrl X'), ('Copy', 'Ctrl C', 'hot'), ('Paste', 'Ctrl V', 'dis'), '-', ('Snap to grid', 'Shift S', 'chk'), ('Arrange', '', 'sub'), '-', ('Delete', 'Del', 'danger')], 230)
             + '<div style="display: flex; flex-direction: column; gap: 10px; align-items: flex-start;">' + tip('Zoom in', 'Ctrl +') + tip('Place plants', 'P')
             + '<span class="badge">3 selected</span><span class="chip" aria-pressed="true" role="button" tabindex="0">Pruning</span>'
             + '<span class="token">Hardy to −25 °C<button type="button" aria-label="Remove filter: Hardy to −25 °C">' + icon('close', 's16') + '</button></span><span class="tag">Edible fruit</span></div></div>')
    rows = ('<div class="card" style="padding: 6px; display: flex; flex-direction: column;">'
            + species_row('herb', '#428063', 'Menthe verte', 'Mentha spicata', 'MSP', '257')
            + species_row('berry', '#AB5268', 'Goji', 'Lycium barbarum', 'LBA', '232', sel=True)
            + species_row('apple', '#B06045', 'Pommier cultivé', 'Malus domestica', 'MDO', '6') + '</div>'
            + '<span class="small muted">Selected rows: soft fill and an ochre edge. Selected tiles and cells: soft fill and an ochre ring.</span>')
    notices = ('<div style="display: flex; flex-direction: column; gap: 8px;">'
               + notice('info', 'Imported data goes to the library. Add it to any Design.', 'info')
               + notice('warn', 'Google refused the API key. Canopi is showing the free imagery.', 'key', btn('Check key', size='sm'))
               + notice('err', "Couldn't save: the disk is full.", 'alert', btn('Retry', size='sm'))
               + f'<div style="align-self: flex-start;">{toast("6 plants deleted")}</div></div>')
    annos = (f'<div style="position: relative; height: 150px; border-radius: 12px; overflow: hidden;">{close_map()}'
             f'<span class="mtag" style="left: 110px; top: 40px;">6.3 m</span><span class="mtag live" style="left: 230px; top: 40px;">2.8 m</span>'
             f'<span class="mname maplabel" style="left: 380px; top: 40px;">Verger nord</span>'
             f'<svg width="600" height="150" style="position: absolute; left: 0; top: 0;" aria-hidden="true"><rect x="470" y="70" width="60" height="50" rx="3" fill="none" stroke="#FFF8EC" stroke-width="5"></rect><rect x="470" y="70" width="60" height="50" rx="3" fill="none" stroke="#9C5A16" stroke-width="2"></rect></svg>'
             f'<span class="mtag" style="left: 110px; top: 110px; font-weight: 400;">Measurement</span><span class="mtag live" style="left: 250px; top: 110px; font-weight: 400;">Live value</span></div>')
    icons = ''.join(f'<div style="display: flex; flex-direction: column; align-items: center; gap: 4px; width: 64px;">{icon(n)}<span style="font-size: 12px; color: var(--muted); text-align: center; word-break: break-word;">{n}</span></div>' for n in ds.IC)
    left = (section('Color', colours) + section('Type', type_) + section('Buttons and icon buttons', buttons)
            + section('Species rows and selection', rows) + section('Notices and feedback', notices))
    right = (section('Forms', forms) + section('Menus, tooltips, chips, tokens, tags', menus) + section('Map annotations', annos)
             + section('Icons · 20 px grid, 1.6 stroke, round caps', f'<div style="display: flex; flex-wrap: wrap; gap: 10px 4px;">{icons}</div>'))
    return (f'<div style="position: absolute; inset: 0; padding: 40px 48px; display: flex; flex-direction: column; gap: 28px;">'
            + H('Canopi design system', 'Parchment, ink and ochre. Literata for titles, Source Sans 3 for the interface, IBM Plex Mono for codes. '
                'Floating surfaces over the map. Ochre means selected or primary; blue means keyboard focus; amber means warning; red means error or destruction.')
            + f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 40px;"><div style="display: flex; flex-direction: column; gap: 26px;">{left}</div>'
            f'<div style="display: flex; flex-direction: column; gap: 26px;">{right}</div></div></div>')


board('DesignSystem', h=1700, title='Design system · light', group='foundations')(_ds_body)
board('DesignSystemDark', h=1700, title='Design system · dark', group='foundations', dark=True)(_ds_body)


@board('Rules', w=1440, h=1180, title='Behavior rules for implementation', group='foundations')
def rules():
    groups = [
        ('Keyboard', ['Every pointer action has a keyboard path: rows are buttons, drag-to-reorder has Move up/down (Alt ↑/↓), rotate has Rotate… (Ctrl Alt R), turning the map has Shift ← and Shift →, zone corners can be added with the arrow keys and Enter.',
                      'One keyboard owner routes every key. Single-letter shortcuts work anywhere except text fields and dialogs, never while an input method is composing. Settings › Keyboard turns them off; Shift N still resets north. Shortcuts cannot be remapped yet.',
                      'Match shortcuts on the key produced, then fall back to the physical key, so Cyrillic and CJK layouts work. Show shortcuts in the platform style: ⌘⇧Z on macOS, Ctrl Maj Z in French.',
                      'Esc does one thing at a time, the active tool first: close the open menu or dialog → cancel text entry → cancel the gesture in progress → drop a held stamp, row source or draft → return to Select → clear the selection.',
                      'Enter never commits while an input method is composing (Chinese, Japanese, Korean).',
                      'The Web Edition avoids keys browsers reserve (Ctrl N, W, Q, T).']),
        ('Moving and turning the map', ['Left click and left drag always select or draw. Right-drag, middle-drag and Space + drag pan in every tool; a right or middle press during a drawing, move or band drag is ignored; a still right-click opens the menu. Only the Pan tool (H) pans with a left drag.',
                                        'The map turns only on purpose: Shift + right-drag, Shift + middle-drag, the compass, Shift ← / →, two fingers, a trackpad twist. Add Ctrl (Cmd on Mac) during a turn drag for 15° steps. Within 7° of north a free turn settles on north.',
                                        'Plant symbols, names, measurements and chrome stay upright; zones, notes and the grid turn with the map.',
                                        'The compass is always in the zoom group: click to reset north, drag to turn. N, Shift N and Shift ↑ reset north too.']),
        ('Focus and announcements', ['A blue 2 px focus ring on every control, never removed. Dialogs trap focus and return it to the control that opened them.',
                                     'Save status is a live region: changes of state are announced once (Saved → Couldn’t save), “Saving…” is not. Errors use alert.',
                                     'Toasts stay until dismissed or replaced, pause on hover and focus, and Undo is always also Ctrl Z.',
                                     'Hover cards (plant card, value readout, tooltips) also appear on keyboard focus, can be dismissed with Esc and stay open while hovered.']),
        ('Language and formats', ['All numbers, dates, times, currency, percentages and file sizes are formatted with the UI locale (Intl). English: 2,201 · 20% · €6,482.30 · Sep 12. French: 2 201 · 20 % · 6 482,30 € · 12 sept.',
                                  'Price and interval fields accept the locale decimal separator. Coordinates accept 48.2201, 0.0351 · 48,2201; 0,0351 · and degrees-minutes-seconds.',
                                  'Plurals and species names use message formats, never string concatenation: “Select all of this species”, not “Select all Framboisier”.',
                                  'Page and content carry lang: the UI locale on the document, la on scientific names, the source language on common names.',
                                  'Labels wrap; controls grow. No fixed-width buttons, segments collapse to a vertical list when they do not fit. Test every surface with +40% pseudo-localisation.',
                                  'Fonts: Literata, Source Sans 3 and IBM Plex Mono bundled with Latin, Latin Extended and Cyrillic. CJK falls back to Noto Sans SC/JP/KR, PingFang, Hiragino, Apple SD Gothic Neo or Microsoft YaHei, without synthetic bold. The PDF embeds a CJK font when needed.',
                                  'Units: metric by default, imperial as a display preference. Hardiness zones name their system (USDA 4).']),
        ('Finding plants', ['Every list of plants (Plants in this Design, catalog, budget, consortium, calendar targets, favorites, PDF key) has the same finder at the top, focused with Ctrl F.',
                            'It matches common names in every language, scientific names, synonyms and codes; ignores accents and capitals; tolerates small typos and says what it searched for.',
                            'Matches are highlighted in the names, counted, and shown on the map with a ring; one action selects them all or zooms to them.',
                            'A selection on the map filters any open panel with “Selected on map”, so the list and the map always point at the same plants.',
                            'Large lists can be grouped by stratum or form and sorted by name, count or total; the choice is kept per panel.']),
        ('Motion and platform', ['Fly-to (place search, Fit to Design, Return to Design) jumps instead of animating when reduced motion is requested; turning the view always jumps.',
                                 'macOS uses the native menu bar; Windows and Linux show the in-window menus.',
                                 'Touch: 44 px targets, bottom sheet with peek, half and full heights, safe-area insets, a side sheet in landscape.']),
    ]
    cols = ''.join(f'<section style="display: flex; flex-direction: column; gap: 10px;"><h2 class="disp" style="font-size: 18px;">{g}</h2>'
                   f'<ul style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 14.5px; line-height: 1.45; color: var(--ink-2);">'
                   + ''.join(f'<li>{esc(x)}</li>' for x in items) + '</ul></section>' for g, items in groups)
    return (f'<div style="position: absolute; inset: 0; padding: 40px 48px; display: flex; flex-direction: column; gap: 24px;">'
            + H('Behavior rules', 'What a screenshot cannot show. These rules apply to every surface on this canvas.')
            + f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 30px 44px;">{cols}</div></div>')


# ============================================================ start and site
def _thumb(pos):
    return (f'<span aria-hidden="true" style="width: 72px; height: 52px; border-radius: 7px; flex-shrink: 0; border: 1px solid var(--line); '
            f'background: url({blob("site-z18")}) {pos} / 259px 162px;"></span>')


def _start_row(thumb, name, meta, when, hot=False):
    return (f'<div class="row{" sel" if hot else ""}" style="min-height: 72px; gap: 6px; padding: 8px 6px 8px 10px;">'
            f'<button type="button" style="flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 14px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; padding: 0; cursor: pointer; min-height: 52px;">'
            f'{thumb}<span style="display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0;"><b style="font-size: 15px; font-weight: 600;">{esc(name)}</b>'
            f'<span class="small muted">{esc(meta)}</span></span><span class="small muted" style="white-space: nowrap;">{esc(when)}</span></button>'
            f'{ib("more", "More actions for " + name, size="sm")}</div>')


@board('Start', title='Start', group='start')
def start():
    rows = (_start_row(_thumb('-110px -62px'), ORCHARD, 'Ballon-Saint-Mars, Sarthe · 2,201 plants · 117 species', 'Today, 2:05 PM')
            + _start_row(_thumb('-40px -20px'), 'Haie fruitière nord', 'Ballon-Saint-Mars, Sarthe · 64 plants · 12 species', 'Yesterday, 6:20 PM')
            + _start_row(_thumb('-170px -110px'), 'Jardin de la mare', 'Souligné-sous-Ballon, Sarthe · 180 plants · 31 species', 'Sep 12'))
    draft_tile = f'<span aria-hidden="true" style="width: 72px; height: 52px; border-radius: 7px; flex-shrink: 0; background: var(--surface-2); border: 1px dashed var(--line-strong); display: flex; align-items: center; justify-content: center; color: var(--muted);">{icon("draft")}</span>'
    drafts = _start_row(draft_tile, 'Untitled Design', 'Draft, never saved to a file · 14 plants', 'Sep 23') + _start_row(draft_tile, 'Haie sud, essai', 'Draft, never saved to a file · 3 plants', 'Sep 19')
    confirm = (f'<div class="row" role="alertdialog" aria-label="Delete draft" style="min-height: 56px; gap: 10px; padding: 8px 10px; background: var(--danger-soft); box-shadow: inset 3px 0 0 var(--danger);">'
               f'<span style="flex: 1 1 auto; font-size: 14px;">Delete “Haie sud, essai”? It was never saved to a file and can’t be recovered.</span>{btn("Cancel", size="sm")}{btn("Delete draft", "danger", size="sm")}</div>')
    return f'''
<div style="position: absolute; inset: 0; display: grid; grid-template-columns: 420px minmax(0, 1fr);">
  <div style="padding: 64px 48px; display: flex; flex-direction: column; gap: 28px; border-right: 1px solid var(--line); background: var(--surface-2);">
    <div style="display: flex; align-items: center; gap: 12px;">{LOGO.replace('width: 24px; height: 24px;', 'width: 44px; height: 44px;')}<h1 class="disp" style="font-size: 30px;">Canopi</h1></div>
    <p style="margin: 0; font-size: 16px; line-height: 1.5; color: var(--ink-2);">Design agroforestry and food forests on the map of your land.</p>
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <button type="button" class="btn primary lg" style="justify-content: space-between;">New Design<span class="kbd" style="background: transparent; color: var(--on-accent); border-color: currentColor;">Ctrl N</span></button>
      <button type="button" class="btn lg" style="justify-content: space-between;">Open Design…<span class="kbd">Ctrl O</span></button>
    </div>
    <p class="hint" style="margin: 0;">You can also drop a .canopi file anywhere on this window.</p>
    <div style="flex: 1 1 auto;"></div>
    <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px; margin-left: -10px;">{btn('Settings', 'ghost', 'gear', 'sm')}{btn('Keyboard shortcuts', 'ghost', 'keyboard', 'sm')}{btn('Report a problem…', 'ghost', 'bug', 'sm')}</div>
    <span class="small muted">Canopi 2.0 · Works offline. Your Designs stay on this computer.</span>
  </div>
  <div style="padding: 56px 56px; display: flex; flex-direction: column; gap: 28px; min-width: 0;">
    {search("Search your Designs")}
    <section style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: baseline; justify-content: space-between;"><h2 class="disp" style="font-size: 20px;">Recent Designs</h2>{btn('Show in folder', 'link', size='sm')}</div>
      <div style="display: flex; flex-direction: column; gap: 2px;">{rows}</div>
    </section>
    <section style="display: flex; flex-direction: column; gap: 8px;">
      <h2 class="disp" style="font-size: 20px;">Drafts</h2>
      <p class="hint" style="margin: 0;">Canopi keeps every change as you work. A Design you never saved to a file stays here until you save it or delete it.</p>
      <div style="display: flex; flex-direction: column; gap: 2px;">{_start_row(draft_tile, 'Untitled Design', 'Draft, never saved to a file · 14 plants', 'Sep 23')}{confirm}</div>
    </section>
  </div>
</div>'''


@board('LocateSite', title='New Design · find the site', group='start')
def locate():
    results = [('pin', '48.2201° N, 0.0351° E', 'Coordinates · go straight there', True), ('pin', 'Ballon-Saint-Mars', 'Sarthe, Pays de la Loire, France', False),
               ('pin', 'Saint-Mars-sous-Ballon', 'Ballon-Saint-Mars, Sarthe, France', False), ('pin', 'Ballon', 'Le Mans, Sarthe, France', False)]
    rs = ''.join(f'<div role="option" id="opt{i}" aria-selected="{"true" if hot else "false"}" class="mi{" hot" if hot else ""}" style="min-height: 52px; gap: 12px; padding: 0 12px;">{icon(ic)}'
                 f'<span style="display: flex; flex-direction: column; line-height: 1.25; min-width: 0;"><b style="font-weight: 600;">{esc(a)}</b>'
                 f'<span style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{esc(b)}</span></span></div>' for i, (ic, a, b, hot) in enumerate(results))
    return f'''
{mapbg(blob("world-z3"), 0.35)}
{topbar("Untitled Design", "Draft", "draft", show_search=False)}
<div class="float" role="dialog" aria-labelledby="loc-t" style="position: absolute; left: 50%; top: 150px; transform: translateX(-50%); width: 560px; padding: 22px 22px 14px; display: flex; flex-direction: column; gap: 14px;">
  <div><h1 class="disp" id="loc-t" style="font-size: 24px;">Where is your site?</h1>
  <p style="margin: 6px 0 0; color: var(--ink-2); font-size: 15px;">Search a place or paste coordinates. The map goes there; nothing is placed yet.</p></div>
  <label class="input focus" style="height: 46px; font-size: 16px;">{icon("search")}<input type="search" role="combobox" aria-expanded="true" aria-controls="loc-list" aria-activedescendant="opt0" value="48.2201, 0.0351" aria-label="Place name or coordinates" style="font-size: 16px;"><span class="kbd">Enter</span></label>
  <div role="listbox" id="loc-list" aria-label="Places" style="display: flex; flex-direction: column; gap: 2px;">{rs}</div>
  <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding-top: 10px;">
    <span class="small muted">Place names © OpenStreetMap contributors</span>{btn("Skip, I’ll find it on the map", "link", size="sm")}
  </div>
</div>
{zoombar("1:50,000,000", "2,000 km", 90, attrib="© OpenStreetMap contributors", show_compass=False)}
'''


@board('SiteFound', title='New Design · first steps, names shown until each tool is used', group='start')
def site_found():
    return f'''
{z18_map()}
{topbar("Untitled Design", "Draft", "draft")}
{toolrail("select", labelled=True)}
{panelrail(None, labelled=True)}
<div class="float" role="dialog" aria-labelledby="sf-t" style="position: absolute; left: 244px; top: 72px; width: 330px; padding: 16px 16px 12px; display: flex; flex-direction: column; gap: 10px;">
  <div style="display: flex; align-items: flex-start; gap: 8px;"><h2 class="disp" id="sf-t" style="font-size: 18px; flex: 1 1 auto;">Start your Design</h2>{ib("close", "Dismiss", size="sm")}</div>
  <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14.5px; color: var(--ink-2); line-height: 1.4;">
    <li>Draw the outline of your land with a <b style="font-weight: 600;">zone</b>.</li>
    <li>Find species in the <b style="font-weight: 600;">Plant catalog</b>, then click Place or drag one onto the map.</li>
    <li>Everything is kept as you work. Click the name at the top to rename the Design, and Save as… to keep it as a file.</li>
  </ol>
  <div style="display: flex; gap: 8px; justify-content: flex-end; padding-top: 4px;">{btn("Open plant catalog", "", "catalog")}{btn("Draw a zone", "primary", "polygon")}</div>
</div>
{topchip(icon("pin", "s16") + '<span>48.2201° N, 0.0351° E</span>' + btn("Search again", "link", size="sm"))}
{viewchip()}
{zoombar("1:1,500", "50 m", 126)}
'''


@board('Overview', title='Zoomed out · the Design stays findable, editing pauses', group='start')
def overview():
    marker = (f'<button type="button" class="float" style="position: absolute; left: 700px; top: 430px; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 14px 0 6px; border-radius: 20px; font: inherit; font-size: 14px; color: var(--ink); cursor: pointer;" aria-label="Return to {esc(ORCHARD)}">'
              f'<span style="width: 28px; height: 28px; border-radius: 14px; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center;">{icon("pin", "s16")}</span>'
              f'<b style="font-weight: 600;">{esc(ORCHARD)}</b></button>')
    note = topchip('<span role="status">Zoom in to edit. Plants are hidden at this scale.</span>' + btn("Return to Design", "primary", size="sm"))
    return (f'<div class="map"><img src="{blob("site-z16")}" alt="Satellite view of the surroundings"></div>' + marker + note
            + topbar(ORCHARD) + toolrail('select', disabled=True) + panelrail(None) + viewchip() + zoombar('1:6,000', '200 m', 126))


# ============================================================ workspace (interactive)
WS_SCRIPT = r'''class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { data: null, mode: 'species', size: 16, halo: 'light', labels: 'none', dim: false, single: '#27231D', ov: {}, layerOv: {}, hl: null, q: '', zoom: 1, open: true };
  }
  componentDidMount() {
    fetch('%JSON%').then((r) => r.json()).then((data) => this.setState({ data })).catch(() => {});
  }
  renderVals() {
    const st = this.state;
    const dark = (this.props.theme ?? 'light') === 'dark';
    const STRATUM_C = { Emergent: '#E69F00', High: '#009E73', Mid: '#0072B2', Low: '#CC79A7', None: '#5E5A52' };
    const SCALE = [0.75, 1, 1.5, 2, 3];
    const z = st.zoom;
    const nf = new Intl.NumberFormat('en-US');
    const layerColour = (l) => st.layerOv[l] ?? STRATUM_C[l];
    const colourOf = (k, c, l) => st.mode === 'single' ? st.single : st.mode === 'stratum' ? layerColour(l) : (st.ov[k] ?? c);
    const light = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 158; };
    const d = st.data;
    const plants = [];
    const labels = [];
    if (d) {
      const names = {};
      for (const sp of d.species) names[sp.k] = sp.cn;
      for (const p of d.plants) {
        const w = Math.round(st.size * p.z * 10) / 10;
        const X = 640 + (p.x - 640) * z;
        const Y = 470 + (p.y - 470) * z;
        const o = st.hl && st.hl !== p.k ? 0.16 : 1;
        const c = colourOf(p.k, p.c, p.l);
        plants.push({ l: X - w / 2, t: Y - w / 2, w, c, o, h: '#p-' + p.s, kc: light(c) ? 'kd' : '' });
        if (o === 1 && st.labels !== 'none' && (st.labels === 'codes' || p.l === 'Emergent' || p.l === 'High')) labels.push({ x: X + w / 2 + 2, y: Y - 6, t: st.labels === 'codes' ? p.k : names[p.k] });
      }
    }
    const fold = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const q = fold(st.q.trim());
    const all = d ? d.species : [];
    const species = all
      .filter((s) => !q || fold(s.n).includes(q) || fold(s.cn).includes(q) || fold(s.k).includes(q))
      .map((s) => ({
        ...s,
        c: colourOf(s.k, s.c, s.l),
        h: '#p-' + s.s,
        on: st.hl === s.k ? 'true' : 'false',
        cls: st.hl === s.k ? 'sel' : '',
        countLabel: nf.format(s.count),
        pick: () => this.setState({ hl: st.hl === s.k ? null : s.k }),
        recolour: (e) => {
          const v = e.target.value;
          if (st.mode === 'stratum') this.setState({ layerOv: { ...this.state.layerOv, [s.l]: v } });
          else if (st.mode === 'single') this.setState({ single: v });
          else this.setState({ ov: { ...this.state.ov, [s.k]: v } });
        },
      }));
    const hl = st.hl ? all.find((s) => s.k === st.hl) : null;
    const seg = (key, opts) => opts.map(([v, label]) => ({ label, on: st[key] === v ? 'true' : 'false', cls: st[key] === v ? 'on' : '', pick: () => this.setState({ [key]: v }) }));
    const zi = SCALE.indexOf(z);
    const mPerPx = 0.0498 / z;
    const barM = z >= 2 ? 2 : 5;
    return {
      themeClass: dark ? 'dark' : '',
      zoom: z,
      dimBg: st.dim,
      toggleDim: () => this.setState({ dim: !st.dim }),
      haloClass: 'halo-' + st.halo,
      plants, labels,
      totalLine: (d ? nf.format(d.plants.length) : '2,201') + ' plants · ' + (d ? d.species.length : 117) + ' species',
      colourModes: seg('mode', [['species', 'Species'], ['stratum', 'Stratum'], ['single', 'One color']]),
      haloModes: seg('halo', [['light', 'Light'], ['dark', 'Dark'], ['none', 'None']]),
      labelModes: seg('labels', [['none', 'None'], ['codes', 'Codes'], ['names', 'Names']]),
      size: st.size,
      setSize: (e) => this.setState({ size: Number(e.target.value) }),
      isSingle: st.mode === 'single',
      single: st.single,
      setSingle: (e) => this.setState({ single: e.target.value }),
      q: st.q,
      setQ: (e) => this.setState({ q: e.target.value }),
      species,
      noMatch: d && species.length === 0,
      listHint: st.mode === 'species' ? 'A swatch sets the color of every plant of that species, whatever its symbol.' : st.mode === 'stratum' ? 'Colors follow the stratum. A swatch recolors its whole stratum.' : 'One color for every plant. Useful for black-and-white print.',
      hasOverrides: Object.keys(st.ov).length > 0 || Object.keys(st.layerOv).length > 0,
      resetColours: () => this.setState({ ov: {}, layerOv: {} }),
      hasHighlight: !!hl,
      hl: hl ? { cn: hl.cn, count: nf.format(hl.count), c: colourOf(hl.k, hl.c, hl.l), h: '#p-' + hl.s } : { cn: '', count: '0', c: '#000000', h: '' },
      clearHighlight: () => this.setState({ hl: null }),
      open: st.open ? 'true' : 'false',
      isOpen: st.open,
      toggleOpen: () => this.setState({ open: !st.open }),
      zoomIn: () => this.setState({ zoom: SCALE[Math.min(SCALE.length - 1, zi + 1)] }),
      zoomOut: () => this.setState({ zoom: SCALE[Math.max(0, zi - 1)] }),
      scaleRatio: '1:' + nf.format(Math.round(mPerPx / 0.0002646 / 5) * 5),
      scaleLabel: barM + ' m',
      scaleBarPx: Math.round(barM / mPerPx),
    };
  }
}'''

WS_CSS = '''<style>
.plants svg{position:absolute;overflow:visible}
.plants.halo-light svg{stroke:#FFFFFF;stroke-width:2px;stroke-linejoin:round;paint-order:stroke}
.plants.halo-dark svg{stroke:#14160F;stroke-width:2px;stroke-linejoin:round;paint-order:stroke}
.plants.halo-light,.plants.halo-none{--ko:#FFFFFF}
.plants.halo-dark{--ko:#14160F}
.plants.halo-none svg.kd{--ko:#14160F}
.labs span{position:absolute;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;line-height:1;color:#FBF8F2;text-shadow:0 0 2px #1A160F,0 0 2px #1A160F,0 0 3px #1A160F;white-space:nowrap;pointer-events:none}
.sp-sw{width:28px;height:28px;border:1px solid var(--line-strong);border-radius:7px;padding:0;background:transparent;cursor:pointer;flex-shrink:0}
.sp-sw::-webkit-color-swatch-wrapper{padding:2px}.sp-sw::-webkit-color-swatch{border:0;border-radius:5px}
.spb{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:10px;border:0;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer;padding:0;min-height:44px}
</style>'''


def _ws_body():
    def seg_group(holes, label):
        return (f'<div class="segs" role="radiogroup" aria-label="{label}"><sc-for list="{{{{{holes}}}}}" as="o" hint-placeholder-count="3">'
                '<button type="button" role="radio" class="seg {{o.cls}}" aria-checked="{{o.on}}" onClick="{{o.pick}}">{{o.label}}</button></sc-for></div>')
    body = f'''
  <div style="margin: 0 2px; border: 1px solid var(--line); border-radius: 10px; display: flex; flex-direction: column;">
    <button type="button" class="btn ghost" onClick="{{{{toggleOpen}}}}" aria-expanded="{{{{open}}}}" style="justify-content: space-between; height: 36px; font-size: 13px; color: var(--ink-2);">Display on the map{icon("chev-d", "s16")}</button>
    <sc-if value="{{{{isOpen}}}}" hint-placeholder-val="{{{{ true }}}}">
    <div style="display: flex; flex-direction: column; gap: 10px; padding: 2px 10px 12px;">
      <div class="field"><span class="lbl">Color by</span>{seg_group("colourModes", "Color by")}</div>
      <label class="field"><span class="lbl" style="display: flex; justify-content: space-between;">Symbol size<span class="num" style="font-weight: 400; color: var(--muted);">{{{{size}}}} px</span></span>
        <input type="range" min="8" max="34" step="1" value="{{{{size}}}}" onInput="{{{{setSize}}}}" onChange="{{{{setSize}}}}" aria-label="Symbol size"></label>
      <div class="field"><span class="lbl">Outline</span>{seg_group("haloModes", "Outline")}</div>
      <div class="field"><span class="lbl">Labels</span>{seg_group("labelModes", "Labels")}</div>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 28px;">
        <label class="chk"><input type="checkbox" checked="{{{{dimBg}}}}" onChange="{{{{toggleDim}}}}">Soften background</label>
        <sc-if value="{{{{isSingle}}}}" hint-placeholder-val="{{{{ false }}}}"><label class="chk">Color<input type="color" class="sp-sw" value="{{{{single}}}}" onInput="{{{{setSingle}}}}" onChange="{{{{setSingle}}}}" aria-label="Color for every plant"></label></sc-if>
      </div>
    </div>
    </sc-if>
  </div>
  <div style="display: flex; align-items: center; gap: 6px; padding: 10px 2px 2px;">
    <label class="input" style="flex: 1 1 auto;">{icon("search", "s16")}<input type="search" placeholder="Find plants: name, scientific name or code" aria-label="Find plants" aria-keyshortcuts="Control+F" value="{{{{q}}}}" onInput="{{{{setQ}}}}">{kbd("Ctrl F")}</label>
    <sc-if value="{{{{hasOverrides}}}}" hint-placeholder-val="{{{{ false }}}}"><button type="button" class="btn link sm" onClick="{{{{resetColours}}}}">Reset colors</button></sc-if>
  </div>
  <p class="hint" style="margin: 4px 6px 2px;">{{{{listHint}}}}</p>
  <div class="scroll" style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 1px; --ko: var(--surface);">
    <sc-for list="{{{{species}}}}" as="s" hint-placeholder-count="8">
      <div class="row {{{{s.cls}}}}" style="min-height: 46px; padding: 0 6px 0 8px; gap: 8px;">
        <input type="color" class="sp-sw" value="{{{{s.c}}}}" onInput="{{{{s.recolour}}}}" onChange="{{{{s.recolour}}}}" aria-label="Color of {{{{s.cn}}}}">
        <button type="button" class="spb" onClick="{{{{s.pick}}}}" aria-pressed="{{{{s.on}}}}">
          <span class="sr">Highlight </span>
          <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" style="width: 24px; height: 24px; color: {{{{s.c}}}};"><use href="{{{{s.h}}}}"></use></svg>
          <span class="sp-name" style="flex: 1 1 auto;"><b>{{{{s.cn}}}}</b><i lang="la">{{{{s.n}}}}</i></span>
          <span class="code">{{{{s.k}}}}</span>
          <span class="count" style="width: 40px; text-align: right;">{{{{s.countLabel}}}}</span>
        </button>
      </div>
    </sc-for>
    <sc-if value="{{{{noMatch}}}}" hint-placeholder-val="{{{{ false }}}}"><p class="hint" style="margin: 16px 10px; text-align: center;">No species match this search.</p></sc-if>
  </div>'''
    return f'''{WS_CSS}
<div class="map"><img src="{blob('orchard-sat')}" alt="Satellite view of the orchard" style="transform-origin: 640px 470px; transform: scale({{{{zoom}}}});"></div>
<sc-if value="{{{{dimBg}}}}" hint-placeholder-val="{{{{ false }}}}"><div style="position: absolute; inset: 0; background: var(--paper); opacity: 0.5;"></div></sc-if>
<div class="plants {{{{haloClass}}}}" style="position: absolute; inset: 0;">
  <sc-for list="{{{{plants}}}}" as="p" hint-placeholder-count="0"><svg class="{{{{p.kc}}}}" viewBox="0 0 24 24" aria-hidden="true" style="left: {{{{p.l}}}}px; top: {{{{p.t}}}}px; width: {{{{p.w}}}}px; height: {{{{p.w}}}}px; color: {{{{p.c}}}}; opacity: {{{{p.o}}}};"><use href="{{{{p.h}}}}"></use></svg></sc-for>
</div>
<div class="labs maplabel" style="position: absolute; inset: 0;"><sc-for list="{{{{labels}}}}" as="l" hint-placeholder-count="0"><span style="left: {{{{l.x}}}}px; top: {{{{l.y}}}}px;">{{{{l.t}}}}</span></sc-for></div>
{topbar(ORCHARD)}
{toolrail("select")}
{panelrail("plants")}
<sc-if value="{{{{hasHighlight}}}}" hint-placeholder-val="{{{{ false }}}}">
  <div class="float" style="position: absolute; left: 50%; transform: translateX(-50%); top: 72px; height: 40px; border-radius: 20px; display: flex; align-items: center; gap: 8px; padding: 0 5px 0 12px; font-size: 14px;">
    <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" style="width: 22px; height: 22px; color: {{{{hl.c}}}};"><use href="{{{{hl.h}}}}"></use></svg>
    <span role="status"><b style="font-weight: 600;">{{{{hl.cn}}}}</b> <span class="muted">· {{{{hl.count}}}} plants highlighted</span></span>
    <button type="button" class="btn sm">Select these plants</button><button type="button" class="btn ghost sm" onClick="{{{{clearHighlight}}}}">Clear</button>
  </div>
</sc-if>
<aside class="float panel" aria-labelledby="ws-pt" style="position: absolute; right: 76px; top: 72px; bottom: 64px; width: 380px;">
  <div class="phead"><h2 class="ptitle" id="ws-pt">Plants in this Design</h2>{ib("close", "Close panel", size="sm")}</div>
  <p class="small muted" style="margin: -6px 16px 8px;">{{{{totalLine}}}}</p>
  <div class="pbody">{body}</div>
</aside>
{viewchip()}
<div style="position: absolute; right: 12px; bottom: 12px; display: flex; align-items: flex-end; gap: 8px;"><span class="attrib">© Google</span><div class="float" role="group" aria-label="Zoom" style="height: 40px; display: flex; align-items: center; gap: 6px; padding: 0 5px 0 12px; border-radius: 11px;">
  <span role="img" aria-label="Scale bar: {{{{scaleLabel}}}}" style="display: flex; flex-direction: column; gap: 2px;"><span class="num" style="font-size: 12px;">{{{{scaleLabel}}}}</span><span style="width: {{{{scaleBarPx}}}}px; height: 5px; border: 1.5px solid var(--ink-2); border-top: 0;"></span></span>
  <div class="vrule" style="margin: 9px 2px;"></div>
  <button type="button" class="ib sm" aria-label="Zoom out (Ctrl −)" onClick="{{{{zoomOut}}}}">{icon("minus")}</button>
  <button type="button" class="btn ghost sm num" style="min-width: 62px; color: var(--ink);" aria-haspopup="listbox" aria-label="Map scale {{{{scaleRatio}}}}. Choose a scale">{{{{scaleRatio}}}}</button>
  <button type="button" class="ib sm" aria-label="Zoom in (Ctrl +)" onClick="{{{{zoomIn}}}}">{icon("plus")}</button>
  {ib("fit", "Fit to Design (Shift F)", size="sm")}<div class="vrule" style="margin: 9px 2px;"></div>{compass()}
</div></div>'''


board('Workspace', title='Workspace · your orchard (live)', group='workspace', interactive=True, root_class='th {{themeClass}}',
      props={'theme': {'editor': 'enum', 'options': ['light', 'dark'], 'default': 'light'}},
      script=WS_SCRIPT.replace('%JSON%', blob('orchard-json')))(_ws_body)


@board('NamesOnMap', title='Labels on the map, thinned so they never collide, and the plant card', group='workspace')
def names_on_map():
    pts = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'labels_close.json')))
    placed, out = [], ''
    obstacles = [(x - w / 2, y - w / 2, w, w) for x, y, k, w in pts] + [(718.5 - 26, 468.7 - 26, 52, 52)]

    def hits(bx, by, lw, lh, boxes, pad):
        return any(not (bx + lw + pad < a or a + b + pad < bx or by + lh + pad < c or c + d + pad < by) for a, c, b, d in boxes)
    for x, y, k, w in sorted(pts, key=lambda p: (p[1], p[0])):
        lw, lh = 7.4 * len(k) + 2, 13
        bx, by = x + w / 2 + 2, y - lh / 2
        own = (x - w / 2, y - w / 2, w, w)
        if hits(bx, by, lw, lh, placed, 4) or hits(bx, by, lw, lh, [o for o in obstacles if o != own], 1):
            continue
        placed.append((bx, by, lw, lh))
        out += (f'<span class="maplabel mono" style="position: absolute; left: {bx:.0f}px; top: {by:.0f}px; font-size: 12px; font-weight: 600; line-height: 13px; color: #FBF8F2; '
                f'text-shadow: 0 0 2px #1A160F, 0 0 2px #1A160F, 0 0 3px #1A160F;">{k}</span>')
    card = (f'<div class="float" role="tooltip" style="position: absolute; left: 732px; top: 480px; padding: 10px 12px; display: flex; gap: 10px; align-items: center; border-radius: 11px;">'
            f'<span aria-hidden="true" style="position: absolute; left: -7px; top: 18px; width: 12px; height: 12px; background: var(--glass); border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: rotate(45deg);"></span>'
            f'{glyph("apple", "#B06045", 30)}<span style="display: flex; flex-direction: column; line-height: 1.25;"><b style="font-weight: 600;">Pommier cultivé</b><i class="small muted" lang="la">Malus domestica</i>'
            f'<span class="small muted">6 in this Design · planted March 2024</span></span><span class="code" style="align-self: flex-start;">MDO</span></div>'
            '<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true"><circle cx="718.5" cy="468.7" r="15" fill="none" stroke="#FFF8EC" stroke-width="4"></circle><circle cx="718.5" cy="468.7" r="15" fill="none" stroke="#9C5A16" stroke-width="2"></circle></svg>')
    chip = topchip(f'<span role="status">Codes shown for {len(placed)} of 282 plants in view · zoom in for more</span>' + btn('Hide labels', 'ghost', size='sm'))
    return close_map() + out + card + chip + chrome(scale=CLOSE)


# ============================================================ designing
CATALOG_ROWS = [  # alphabetical, all trees with edible fruit
    ('apple', '#B06045', 'Asiminier trilobé', 'Asimina triloba', 'Small tree · 4–8 m · hardy to −28 °C', 'ATR', False),
    ('apple', '#B06045', 'Cognassier', 'Cydonia oblonga', 'Small tree · 4–6 m · hardy to −25 °C', 'COB', False),
    ('apple', '#B06045', 'Cormier', 'Sorbus domestica', 'Tree · 10–20 m · hardy to −30 °C', 'SDO', False),
    ('apple', '#B06045', 'Néflier', 'Mespilus germanica', 'Small tree · 3–6 m · hardy to −25 °C', 'MGE', False),
    ('apple', '#B06045', 'Plaqueminier', 'Diospyros kaki', 'Tree · 6–10 m · hardy to −18 °C', 'DKA', False),
    ('apple', '#B06045', 'Poirier', 'Pyrus communis', 'Tree · 8–15 m · hardy to −30 °C', 'PCO', True),
    ('apple', '#B06045', 'Pommier cultivé', 'Malus domestica', 'Tree · 4–10 m · hardy to −30 °C', 'MDO', True),
    ('apple', '#B06045', 'Pommier sauvage', 'Malus sylvestris', 'Tree · 6–10 m · hardy to −35 °C', 'MSY', False),
]


def catalog_panel(hot=6):
    tokens = ''.join(f'<span class="token">{t}<button type="button" aria-label="Remove filter: {t}">{icon("close", "s16")}</button></span>' for t in ['Temperate', 'Tree', 'Edible fruit'])
    rows = ''
    for i, (sym, col, cn, ln, tags, code, fav) in enumerate(CATALOG_ROWS):
        star = ib('star', ('Remove ' if fav else 'Add ') + cn + (' from favorites' if fav else ' to favorites'), size='sm', cls='fav' if fav else 'quiet')
        place = btn('Place', size='sm', aria=f'Place {cn}') if i == hot else ''
        rows += (f'<div class="row{" sel" if i == hot else ""}" style="min-height: 60px; gap: 6px; padding: 4px 6px 4px 8px;">'
                 f'<button type="button" aria-label="Details for {esc(cn)}" style="flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; padding: 0; cursor: pointer; min-height: 52px;">'
                 f'{glyph(sym, col, 26)}<span style="display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; line-height: 1.25;"><b style="font-weight: 600;">{esc(cn)}</b>'
                 f'<i class="small muted" lang="la">{esc(ln)}</i><span class="small muted" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{esc(tags)}</span></span>'
                 f'<span class="code">{code if code in ("MDO", "PCO") else ""}</span></button>{place}{star}</div>')
    body = f'''
  <div style="padding: 0 2px 8px; display: flex; flex-direction: column; gap: 8px;">
    {search("Search 175,473 species")}
    <div style="display: flex; flex-wrap: wrap; gap: 6px;">{tokens}<button type="button" class="chip" aria-haspopup="dialog">{icon("plus", "s16")}Add filter</button></div>
    <div style="display: flex; align-items: center; gap: 8px;"><span class="small muted" style="flex: 1 1 auto;">148 species</span>{dropdown("Sort: Name", "Sort")}{btn("Clear filters", "link", size="sm")}</div>
  </div>
  <div class="rule"></div>
  <div class="scroll" style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 1px; padding-top: 4px;">{rows}</div>
  <p class="hint" style="margin: 6px 8px 0;">Codes appear on species already in this Design.</p>'''
    return panel('Plant catalog', body)


@board('Catalog', title='Plant catalog · filter, then Place or drag onto the map', group='designing')
def catalog():
    ghost = (f'<svg viewBox="0 0 24 24" aria-hidden="true" style="position: absolute; left: 552px; top: 402px; width: 30px; height: 30px; color: #B06045; opacity: 0.9; stroke: #FFFFFF; stroke-width: 2px; paint-order: stroke; --ko: #FFFFFF;"><use href="#p-apple"></use></svg>'
             f'<span class="tip" style="position: absolute; left: 567px; top: 502px; transform: translateX(-50%);">Pommier cultivé<span class="k">Release to place · Esc to cancel</span></span>'
             '<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true"><circle cx="567" cy="417" r="75" fill="rgba(255,243,214,0.10)" stroke="rgba(20,16,10,0.55)" stroke-width="3.5"></circle><circle cx="567" cy="417" r="75" fill="none" stroke="#FFF3D6" stroke-width="1.6" stroke-dasharray="6 5"></circle></svg>')
    return close_map() + ghost + catalog_panel() + chrome(panel='catalog', scale=CLOSE)


@board('CatalogFilters', title='Plant catalog · add a filter (applies as you choose)', group='designing')
def catalog_filters():
    cats = [('Climate and hardiness', 'Temperate'), ('Size and form', 'Tree'), ('Light', ''), ('Soil and water', ''), ('Uses', 'Edible fruit'),
            ('Stratum and succession', ''), ('Ecology', 'Nitrogen fixer, pollinators'), ('Risks', 'Toxicity, invasiveness')]
    rows = ''.join(f'<button type="button" role="menuitem" aria-haspopup="dialog" aria-expanded="{"true" if a == "Uses" else "false"}" class="mi{" hot" if a == "Uses" else ""}" style="min-height: 44px;">'
                   f'<span style="display: flex; flex-direction: column; line-height: 1.2; flex: 1 1 auto;"><span>{a}</span>{f"<span class=desc>{b}</span>" if b else ""}</span>{icon("chev-r", "s16")}</button>' for a, b in cats)
    pop = (f'<div class="menu" role="dialog" aria-label="Add filter" style="position: absolute; right: 145px; top: 236px; width: 300px; padding: 8px;">'
           f'<div style="padding: 2px 2px 6px;">{search("Search filters", "", focus=True)}</div><div role="menu" aria-label="Filter categories">{rows}</div></div>')
    uses = [('Edible fruit', True), ('Edible nuts', False), ('Edible leaves', False), ('Drinks', False), ('Medicinal', False), ('Timber and firewood', False), ('Fodder', False), ('Wildlife food', False), ('Fiber and dye', False)]
    sub = (f'<fieldset class="menu" style="position: absolute; right: 451px; top: 460px; width: 250px; padding: 8px 10px; margin: 0; display: flex; flex-direction: column; gap: 2px;">'
           f'<legend class="sr">Uses</legend><div style="display: flex; justify-content: space-between; align-items: center; padding: 0 0 4px;"><span class="lbl">Uses</span>{btn("Clear", "link", size="sm")}</div>'
           + ''.join(check(u, on) for u, on in uses) + '</fieldset>')
    return close_map() + catalog_panel(-1) + pop + sub + chrome(panel='catalog', scale=CLOSE)


@board('SpeciesDetail', title='Species detail · Pommier cultivé', group='designing')
def species_detail():
    facts = [('Height', '4–10 m'), ('Width', '3–8 m'), ('Hardiness', 'USDA 4 · to −30 °C'), ('Light', 'Full sun'),
             ('Soil', 'Moist, well drained'), ('Growth', 'Medium · lives 50–80 years'), ('Stratum', 'High'), ('Succession', 'Secondary 1 → Climax')]
    fgrid = ''.join(f'<div style="display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; background: var(--surface-2); border-radius: 8px;"><span class="small muted">{a}</span><b style="font-weight: 600; font-size: 14px;">{esc(b)}</b></div>' for a, b in facts)
    uses = ''.join(f'<span class="tag">{u}</span>' for u in ['Edible fruit', 'Drinks', 'Timber and firewood', 'Wildlife food'])
    eco = ''.join(f'<span class="tag">{u}</span>' for u in ['Pollinators', 'Bird food'])
    secs = ''.join(f'<button type="button" class="row" aria-expanded="false" style="border: 0; background: transparent; width: 100%; font: inherit; color: inherit; justify-content: space-between; min-height: 40px; cursor: pointer;"><span>{s}</span>{icon("chev-d", "s16")}</button>'
                   for s in ['Life cycle and phenology', 'Light and climate', 'Soil', 'Ecology and companions', 'Propagation', 'Fruit and seed', 'Risks and toxicity', 'Names and identity'])
    body = f'''
  <div class="scroll" style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 2px 6px 8px;">
    <div style="display: flex; gap: 12px; align-items: center;">
      <div style="width: 116px; height: 88px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; color: var(--muted); flex-shrink: 0;" role="img" aria-label="No photo available">{icon("image")}</div>
      <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0;"><span class="small muted">Rosaceae · Malus</span><span class="small muted">English: apple, domestic apple</span>
        <span style="display: flex; align-items: center; gap: 6px;">{glyph("apple", "#B06045", 22)}<span class="small">Fruit symbol · color from this Design</span><span class="code" style="width: auto;">MDO</span></span></div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;">{fgrid}</div>
    <div style="display: flex; flex-direction: column; gap: 6px;"><h3 class="lbl">Uses</h3><div style="display: flex; flex-wrap: wrap; gap: 6px;">{uses}</div></div>
    <div style="display: flex; flex-direction: column; gap: 6px;"><h3 class="lbl">Ecology</h3><div style="display: flex; flex-wrap: wrap; gap: 6px;">{eco}</div></div>
    <div style="display: flex; flex-direction: column; border-top: 1px solid var(--line); padding-top: 4px;">{secs}</div>
  </div>'''
    head_extra = ib('star', 'Remove from favorites', size='sm', cls='fav')
    foot = f'<span class="small muted" style="flex: 1 1 auto;">6 in this Design</span>{btn("Select on map")}{btn("Place", "primary", "plant")}'
    p = panel('Pommier cultivé', body, head_extra=head_extra, foot=foot, back=True, sub='<i lang="la">Malus domestica</i>')
    return close_map() + p + chrome(panel='catalog', scale=CLOSE)


def _placing_card():
    lead = glyph('apple', '#B06045', 26)
    extra = (f'<div style="border-top: 1px solid var(--line); padding-top: 8px;">{switch_row("Show mature width", True)}</div>')
    return toolcard('Place plants', ['<b style="font-weight: 600;">Pommier cultivé</b> · click the map to place one', 'Esc to stop placing'],
                    extra=extra, lead=lead).replace('<b style="font-weight: 600; flex: 1 1 auto;">Place plants</b>',
                                                    '<b style="font-weight: 600; flex: 1 1 auto;">Place plants</b>' + btn('Change species', 'link', size='sm'))


@board('PlacePlants', title='Place plants · click to place, mature width and nearest neighbor shown', group='designing')
def place_plants():
    ring = ('<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true">'
            + cased('<circle cx="1010" cy="430" r="165" fill="rgba(255,243,214,0.08)" stroke="#FFF3D6" stroke-width="1.6" stroke-dasharray="6 5"></circle>')
            + cased('<line x1="1010" y1="430" x2="884" y2="366" stroke="#FFF3D6" stroke-width="1.6" stroke-dasharray="4 3"></line>') + '</svg>'
            '<svg viewBox="0 0 24 24" aria-hidden="true" style="position: absolute; left: 994px; top: 414px; width: 32px; height: 32px; color: #B06045; stroke: #FFFFFF; stroke-width: 2px; paint-order: stroke; --ko: #FFFFFF; opacity: 0.9;"><use href="#p-apple"></use></svg>'
            + tag(947, 398, '2.8 m to Goji', live=True) + tag(1010, 262, 'Mature width 6 m (typical)'))
    return close_map() + ring + _placing_card() + chrome('plant', scale=CLOSE)


@board('PlantRow', title='Plant a row · repeat a plant along a line', group='designing')
def plant_row():
    card = toolcard('Plant a row', ['<b style="font-weight: 600;">Framboisier</b> · drag along the row', 'Esc to clear the row'],
                    lead=glyph('berry', '#AB5268', 24),
                    extra=(f'<div style="display: flex; align-items: flex-end; gap: 10px; border-top: 1px solid var(--line); padding-top: 8px;">'
                           f'{field("Spacing", textin("0.5", aria="Spacing in meters", trail=chr(60) + "span class=muted" + chr(62) + "m" + chr(60) + "/span" + chr(62)))}'
                           f'<span role="status" class="count" style="margin-left: auto; padding-bottom: 8px;">12 plants</span></div>'))
    card = card.replace('<b style="font-weight: 600; flex: 1 1 auto;">Plant a row</b>', '<b style="font-weight: 600; flex: 1 1 auto;">Plant a row</b>' + btn('Change species', 'link', size='sm'))
    dots = ''.join(f'<svg viewBox="0 0 24 24" aria-hidden="true" style="position: absolute; left: {1020 - 10}px; top: {230 + i * 26.2 - 10}px; width: 20px; height: 20px; color: #AB5268; opacity: 0.85; stroke: #FFFFFF; stroke-width: 2px; paint-order: stroke; --ko: #FFFFFF;"><use href="#p-berry"></use></svg>' for i in range(12))
    line = '<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true">' + cased('<line x1="1020" y1="222" x2="1020" y2="522" stroke="#FFF3D6" stroke-width="2"></line>') + '</svg>'
    return close_map() + line + dots + tag(1068, 380, '5.8 m', live=True) + card + chrome('row', scale=CLOSE)


@board('StampPlace', title='Place a stamp · a saved group of plants', group='designing')
def stamp_place():
    comp = [('apple', '#B06045', 0, 0, 22), ('pod', '#70814B', -34, 18, 17), ('pod', '#70814B', 34, 18, 17), ('berry', '#AB5268', -20, -30, 17), ('berry', '#AB5268', 22, -30, 17),
            ('herb', '#428063', -50, -8, 13), ('herb', '#428063', 50, -8, 13), ('herb', '#428063', 0, 38, 13), ('flower', '#82629B', -14, 44, 13), ('flower', '#82629B', 16, 44, 13)]
    cx, cy = 1000, 590
    ghost = ''.join(f'<svg viewBox="0 0 24 24" aria-hidden="true" style="position: absolute; left: {cx + dx - s / 2}px; top: {cy + dy - s / 2}px; width: {s}px; height: {s}px; color: {c}; opacity: 0.75; stroke: #FFFFFF; stroke-width: 2px; paint-order: stroke; --ko: #FFFFFF;"><use href="#p-{g}"></use></svg>'
                    for g, c, dx, dy, s in comp)
    ring = '<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true">' + cased(f'<rect x="{cx - 66}" y="{cy - 50}" width="132" height="106" rx="8" fill="none" stroke="#FFF3D6" stroke-width="1.6" stroke-dasharray="6 5"></rect>') + '</svg>'
    card = toolcard('Place a stamp', ['<b style="font-weight: 600;">Guilde pommier</b> · 10 plants · 4 species · click to place', '[ and ] rotate by 15° · Esc to clear the stamp'],
                    lead=icon('stamp'))
    card = card.replace('<b style="font-weight: 600; flex: 1 1 auto;">Place a stamp</b>', '<b style="font-weight: 600; flex: 1 1 auto;">Place a stamp</b>' + btn('Change stamp', 'link', size='sm'))
    return close_map() + ring + ghost + card + chrome('stamp', scale=CLOSE)


@board('Selection', title='Selection · the right-click menu uses plain words; rotate stays on the map', group='designing')
def selection():
    m = menu([('#', '3 plants · Framboisier'), ('Cut', 'Ctrl X'), ('Copy', 'Ctrl C'), ('Paste', 'Ctrl V', 'dis'), ('Duplicate', 'Ctrl D'), '-',
              ('Symbol and color…', '', 'hot'), ('Show names of this species', '', 'nochk'), ('Select all of this species', 'Ctrl Shift A'), ('Species details', ''), '-',
              ('Add to calendar…', ''), ('Set unit cost…', ''), '-',
              ('Group', 'Ctrl G'), ('Arrange', '', 'sub'), ('Rotate…', 'Ctrl Alt R'), ('Save as stamp…', ''), '-', ('Lock', 'Ctrl Shift L'), ('Delete', 'Del', 'danger')], 272,
             ' position: absolute; left: 622px; top: 150px;', label='Selection')
    status = statuschip(f'{glyph("berry", "#AB5268", 20)}<span><b style="font-weight: 600;">3 selected</b> <span class="muted">· Framboisier · 0.52 m apart</span></span>')
    rings = '<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true">' + ''.join(f'<circle cx="592.7" cy="{y}" r="11" fill="none" stroke="#FFF8EC" stroke-width="4"></circle><circle cx="592.7" cy="{y}" r="11" fill="none" stroke="#9C5A16" stroke-width="2"></circle>' for y in (274.7, 301.0, 327.0)) + '</svg>'
    return close_map() + rings + selbox(574, 258, 38, 86) + m + status + chrome(scale=CLOSE)


SYMS = [('Plant form', ['canopy', 'conifer', 'palm', 'shrub', 'herb', 'grass', 'bamboo', 'fern', 'climber', 'groundcover', 'rosette', 'cactus']),
        ('What it gives', ['apple', 'nut', 'berry', 'grape', 'flower', 'carrot', 'grain', 'chili', 'medicinal', 'mushroom', 'timber', 'fodder']),
        ('What it does', ['pod', 'bee', 'biomass', 'windbreak', 'soil'])]
SYM_NAMES = {'canopy': 'Canopy tree', 'conifer': 'Conifer', 'palm': 'Palm', 'shrub': 'Shrub', 'herb': 'Herb', 'grass': 'Grass', 'bamboo': 'Bamboo', 'fern': 'Fern',
             'climber': 'Climber', 'groundcover': 'Groundcover', 'rosette': 'Rosette', 'cactus': 'Cactus', 'apple': 'Fruit', 'nut': 'Nuts', 'berry': 'Berries',
             'grape': 'Grapes', 'flower': 'Flowers', 'pod': 'N-fixer', 'carrot': 'Vegetables', 'grain': 'Grains', 'chili': 'Spices', 'medicinal': 'Medicinal',
             'bee': 'Pollinators', 'biomass': 'Biomass', 'timber': 'Timber', 'fodder': 'Fodder', 'windbreak': 'Windbreak', 'soil': 'Soil builder', 'mushroom': 'Fungi'}


@board('Appearance', title='Symbol and color · any symbol, any color, for the whole species', group='designing')
def appearance():
    groups = ''
    for gi, (g, syms) in enumerate(SYMS):
        tiles = ''.join(f'<button type="button" role="radio" aria-checked="{"true" if s == "berry" else "false"}" class="{"tile-sel" if s == "berry" else ""}" style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px; padding: 8px 2px 4px; height: 70px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); font: inherit; font-size: 12px; color: var(--ink-2); cursor: pointer;">'
                        f'<svg viewBox="0 0 24 24" aria-hidden="true" style="width: 26px; height: 26px; color: var(--ink); --ko: var(--surface);"><use href="#p-{s}"></use></svg><span style="text-align: center; line-height: 1.15; hyphens: none;">{SYM_NAMES[s]}</span></button>' for s in syms)
        groups += (f'<div role="group" aria-labelledby="sg{gi}"><h3 class="sec" id="sg{gi}" style="padding: 8px 2px 4px;">{g}</h3>'
                   f'<div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px;">{tiles}</div></div>')
    swatches = ''.join(f'<button type="button" role="radio" aria-checked="{"true" if c == "#AB5268" else "false"}" aria-label="{n}" class="{"sw-sel" if c == "#AB5268" else ""}" style="width: 32px; height: 32px; border-radius: 8px; background: {c}; border: 1px solid var(--line-strong); cursor: pointer; padding: 0; outline-offset: 2px;"></button>'
                       for c, n in SWATCHES)
    pop = f'''
<div class="sheet" role="dialog" aria-modal="false" aria-labelledby="ap-t" style="position: absolute; left: 622px; top: 72px; width: 424px; display: flex; flex-direction: column; max-height: 800px;">
  <div class="dhead" style="padding: 14px 14px 6px 16px; align-items: center;">{glyph("berry", "#AB5268", 30)}<div style="flex: 1 1 auto;"><h2 id="ap-t" style="font-weight: 600; font-size: 15px;">Symbol and color</h2><span class="small muted" style="display: block;">Framboisier · 142 plants · 3 selected</span></div>{ib("close", "Close", size="sm")}</div>
  <div class="scroll" role="radiogroup" aria-label="Symbol" style="padding: 0 14px 10px; overflow-y: auto; flex: 1 1 auto; min-height: 0;">
    {groups}
    <h3 class="sec" style="padding: 12px 2px 6px;">Color</h3>
    <div role="radiogroup" aria-label="Color" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">{swatches}{btn("Custom…", size="sm")}</div>
  </div>
  <div class="dfoot" style="padding: 10px 14px; justify-content: space-between;">{btn("Only these 3 plants")}{btn("All 142 of this species", "primary")}</div>
</div>'''
    return close_map() + selbox(574, 258, 38, 86, rotate=False) + pop + chrome(scale=CLOSE)


ZONE = [(648, 312), (905, 250), (1004, 368), (866, 590)]


@board('ZoneDraw', title='Polygon zone · drawing with live lengths and area', group='designing')
def zone_draw():
    cur = (700, 560)
    pts = ZONE
    poly = ' '.join(f'{x},{y}' for x, y in pts + [cur])
    els = (f'<polygon points="{poly}" fill="rgba(255,226,160,0.16)" stroke="none"></polygon>'
           + cased(f'<polyline points="{" ".join(f"{x},{y}" for x, y in pts)}" fill="none" stroke="#FFF3D6" stroke-width="2.2"></polyline>')
           + cased(f'<line x1="{pts[-1][0]}" y1="{pts[-1][1]}" x2="{cur[0]}" y2="{cur[1]}" stroke="#FFF3D6" stroke-width="2" stroke-dasharray="6 5"></line>')
           + cased(f'<line x1="{cur[0]}" y1="{cur[1]}" x2="{pts[0][0]}" y2="{pts[0][1]}" stroke="#FFF3D6" stroke-width="1.6" stroke-dasharray="3 5"></line>')
           + ''.join(f'<circle cx="{x}" cy="{y}" r="5.5" fill="#FFFFFF" stroke="#27231D" stroke-width="2"></circle>' for x, y in pts)
           + f'<circle cx="{pts[0][0]}" cy="{pts[0][1]}" r="10" fill="none" stroke="#FFFFFF" stroke-width="2"></circle>'
           + f'<circle cx="{cur[0]}" cy="{cur[1]}" r="4.5" fill="#9C5A16" stroke="#FFFFFF" stroke-width="1.5"></circle>')
    svg = f'<svg width="1440" height="900" viewBox="0 0 1440 900" style="position: absolute; inset: 0;" aria-hidden="true">{els}</svg>'
    labels = tag(776, 272, '105 m') + tag(965, 300, '61 m') + tag(955, 486, '103 m') + tag(783, 586, '67 m', live=True) + tag(820, 420, 'Area 1.07 ha')
    card = toolcard('Polygon zone', ['Click to add corners. Click the first corner, double-click or press Enter to finish.', 'Backspace removes the last corner · Shift keeps 45° angles · Esc to cancel'])
    return z18_map() + svg + labels + card + chrome('polygon', name='Untitled Design', status='Draft', kind='draft', scale=('1:1,500', '50 m', 126))


@board('ZoneSelected', title='Zone selected · name, color and area beside the zone', group='designing')
def zone_selected():
    pts = ZONE + [(700, 560)]
    poly = ' '.join(f'{x},{y}' for x, y in pts)
    svg = (f'<svg width="1440" height="900" viewBox="0 0 1440 900" style="position: absolute; inset: 0;" aria-hidden="true">'
           f'<polygon points="{poly}" fill="rgba(230,190,110,0.22)" stroke="rgba(20,16,10,0.6)" stroke-width="4.5"></polygon>'
           f'<polygon points="{poly}" fill="none" stroke="#E7C27A" stroke-width="2.4"></polygon>'
           + ''.join(f'<rect x="{x - 5}" y="{y - 5}" width="10" height="10" rx="2" fill="#FFF8EC" stroke="#9C5A16" stroke-width="2"></rect>' for x, y in pts) + '</svg>')
    swatch = ''.join(f'<button type="button" role="radio" aria-checked="{"true" if i == 0 else "false"}" aria-label="{n}" class="{"sw-sel" if i == 0 else ""}" style="width: 30px; height: 30px; border-radius: 7px; background: {c}; border: 1px solid var(--line-strong); padding: 0; cursor: pointer;"></button>'
                     for i, (c, n) in enumerate([('#E7C27A', 'Straw'), ('#9DB7C9', 'Sky'), ('#C9A0C0', 'Heather'), ('#A9C49A', 'Meadow'), ('#D9A78A', 'Clay'), ('#FFFFFF', 'White')]))
    card = (f'<div class="sheet" role="dialog" aria-labelledby="zs-t" style="position: absolute; left: 1016px; top: 250px; width: 300px; padding: 14px; display: flex; flex-direction: column; gap: 12px;">'
            f'<div style="display: flex; align-items: center; gap: 6px;"><h2 id="zs-t" style="font-weight: 600; font-size: 15px; flex: 1 1 auto;">Zone</h2>{ib("more", "More actions for this zone", size="sm")}{ib("close", "Close", size="sm")}</div>'
            + field('Name', textin('Verger syntropique', aria='Zone name'))
            + f'<div class="field"><span class="lbl">Color</span><div role="radiogroup" aria-label="Zone color" style="display: flex; gap: 6px;">{swatch}</div></div>' + slider('Fill', 20, '%')
            + '<div class="small muted num" style="display: flex; justify-content: space-between;"><span>Area 1.07 ha</span><span>Perimeter 402 m</span></div>'
            + f'<div style="display: flex; justify-content: space-between; border-top: 1px solid var(--line); padding-top: 10px;">{btn("Delete zone", "danger-ghost", "trash", "sm")}{btn("Lock", "", "lock", "sm")}</div></div>')
    chip = statuschip(f'{icon("polygon", "s18")}<span><b style="font-weight: 600;">Zone</b> <span class="muted">· Verger syntropique · 1.07 ha</span></span>')
    return (z18_map() + svg + mname(826, 420, 'Verger syntropique') + card + chip
            + chrome(name='Untitled Design', status='Draft', kind='draft', scale=('1:1,500', '50 m', 126)))


@board('MeasureText', title='Measure and text notes', group='designing')
def measure_text():
    svg = ('<svg width="1440" height="900" viewBox="0 0 1440 900" style="position: absolute; inset: 0;" aria-hidden="true">'
           + cased('<line x1="551" y1="600" x2="880" y2="600" stroke="#FFF3D6" stroke-width="2"></line>')
           + cased('<line x1="551" y1="590" x2="551" y2="610" stroke="#FFF3D6" stroke-width="2"></line>') + cased('<line x1="880" y1="590" x2="880" y2="610" stroke="#FFF3D6" stroke-width="2"></line>') + '</svg>')
    note = (f'<div style="position: absolute; left: 930px; top: 250px; width: 230px;"><span class="input focus" style="height: auto; padding: 8px 10px; align-items: flex-start;">'
            f'<textarea aria-label="Note text" style="border: 0; background: transparent; font: inherit; color: var(--ink); resize: none; width: 100%; height: 58px;">Paillage BRF à renouveler en novembre</textarea></span></div>')
    card = toolcard('Text note', ['Type the note. Enter to finish.', 'Shift Enter for a new line · Esc to cancel'])
    return close_map() + svg + tag(715, 582, '6.3 m') + note + card + chrome('text', scale=CLOSE)


@board('FindPlants', title='Find plants · forgiving search, then see and select them on the map', group='workspace')
def find_plants():
    rows = [('apple', '#B06045', 'Pommier cultivé', 'Malus domestica', 'MDO', 6), ('apple', '#B06045', 'Pommier sauvage', 'Malus sylvestris', 'MSY', 1)]
    body_rows = ''.join(
        f'<div class="row sel" style="min-height: 48px; gap: 8px; padding: 0 6px 0 8px;">'
        f'<button type="button" aria-pressed="true" style="flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; padding: 0; min-height: 44px; cursor: pointer;">'
        f'<span class="sr">Highlight </span>{glyph(sy, c)}<span class="sp-name" style="flex: 1 1 auto;"><b>{mark(cn, "Pommier")}</b><i lang="la">{esc(ln)}</i></span>'
        f'<span class="code">{k}</span><span class="count" style="width: 40px; flex-shrink: 0; text-align: right;">{n}</span></button>'
        f'{btn("Select", size="sm", aria=f"Select the {n} {cn} plants on the map")}</div>' for sy, c, cn, ln, k, n in rows)
    also = ''.join(
        f'<div class="row" style="min-height: 48px; gap: 8px; padding: 0 6px 0 8px;">'
        f'<button type="button" style="flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; padding: 0; min-height: 44px; cursor: pointer;">'
        f'{glyph(sy, c)}<span class="sp-name" style="flex: 1 1 auto;"><b>{mark(cn, "Pommier")}</b><i lang="la">{esc(ln)}</i></span></button>'
        f'{btn("Open in catalog", "link", size="sm", aria="Open " + cn + " in the plant catalog")}</div>'
        for sy, c, cn, ln in [('apple', '#B06045', 'Pommier du Japon', 'Malus floribunda'), ('apple', '#B06045', 'Pommier à cidre', 'Malus pumila')])
    body = f'''
  {finder("pomier", [("Selected on map", False), ("Stratum", "menu"), ("Form", "menu")], 'Showing results for <b style="font-weight: 600; color: var(--ink);">pommier</b> · 2 species · 7 plants')}
  <div class="scroll" style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 1px; margin-top: 6px;">
    {body_rows}
    <h3 class="sec">In the catalog, not in this Design</h3>
    {also}
  </div>
  <div class="rule" style="margin: 6px 0;"></div>
  <p class="hint" style="margin: 0 6px;">Search matches common names in every language Canopi knows, scientific names, synonyms and codes. Accents, capitals and small typos don’t matter.</p>'''
    p = panel('Plants in this Design', body, sub='2,201 plants · 117 species')
    chip = topchip('<span role="status"><b style="font-weight: 600;">7 plants</b> <span class="muted">match “pommier”</span></span>'
                   + btn('Zoom to them', size='sm') + btn('Select all 7', 'primary', size='sm') + btn('Clear', 'ghost', size='sm'))
    return (f'<div class="map"><img src="{blob("orchard-sat")}" alt="Satellite view of the orchard"></div>'
            f'<img src="{blob("plants-find")}" alt="" style="position: absolute; left: 0; top: 0; width: 1440px; height: 900px;">'
            + p + chip + chrome(panel='plants'))


@board('SelectedToList', title='From the map to the list · a selection filters every panel', group='workspace')
def selected_to_list():
    rings = '<svg width="1440" height="900" style="position: absolute; inset: 0;" aria-hidden="true">' + ''.join(
        f'<circle cx="592.7" cy="{y}" r="11" fill="none" stroke="#FFF8EC" stroke-width="4"></circle><circle cx="592.7" cy="{y}" r="11" fill="none" stroke="#9C5A16" stroke-width="2"></circle>'
        for y in (274.7, 301.0, 327.0)) + '</svg>'
    row = (f'<div class="row" style="min-height: 48px; gap: 8px; padding: 0 6px 0 8px;">{glyph("berry", "#AB5268")}<span class="sp-name" style="flex: 1 1 auto;"><b>Framboisier</b><i lang="la">Rubus idaeus</i></span>'
           f'<span class="code">RID</span><span class="count" style="width: 36px; flex-shrink: 0; text-align: right;">3</span>'
           f'<span class="input focus" style="width: 88px; height: 32px; padding: 0 8px; flex-shrink: 0;"><span class="muted small">€</span><input type="text" inputmode="decimal" value="3.90" aria-label="Unit cost for Framboisier" style="text-align: right;" class="num"></span>'
           f'<span class="num" style="flex: 0 0 84px; text-align: right; font-weight: 600;">€11.70</span></div>')
    body = f'''
  {finder("", [("Selected on map · 3", True), ("Missing a price · 21", False), ("Stratum", "menu"), ("Sort: Name", "menu")], "1 species · 3 plants selected on the map")}
  <div style="display: flex; justify-content: flex-end; padding: 8px 6px 4px;" class="small muted"><span style="width: 36px; text-align: right;">Plants</span><span style="width: 96px; text-align: right;">Unit cost</span><span style="width: 84px; text-align: right;">Total</span></div>
  {row}
  <p class="hint" style="margin: 8px 6px;">Turn off “Selected on map” to see all 117 species again. The filter follows the selection as it changes.</p>'''
    status = statuschip(f'{glyph("berry", "#AB5268", 20)}<span><b style="font-weight: 600;">3 selected</b> <span class="muted">· Framboisier</span></span>')
    return close_map() + rings + selbox(574, 258, 38, 86, rotate=False) + panel('Budget', body, wide=True) + status + chrome(panel='budget', scale=CLOSE)
