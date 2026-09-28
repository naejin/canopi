"""Generated stand-ins for the map imagery and analysis rasters the boards sit on.

The boards were designed over satellite tiles and LiDAR-derived rasters that cannot be committed
(imagery terms, size). Every background here is drawn procedurally at build time, so a clone renders
every board offline: a flat field for the orchard, map paper for the wider site and the world, soft
tinted blobs for slope and wetness, synthetic streams and crowns, and the orchard's plants from the
symbol set. Nothing here is design; the design is the chrome drawn over it.
"""
import json
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1440, 900


def _svg(inner, w=W, h=H):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{inner}</svg>'


def _rows(rng, x0, y0, x1, y1, step, colour, width):
    out = ''
    y = y0
    while y < y1:
        out += f'<line x1="{x0}" y1="{y:.0f}" x2="{x1}" y2="{y + rng.uniform(-6, 6):.0f}" stroke="{colour}" stroke-width="{width}" stroke-opacity="0.35"/>'
        y += step
    return out


def field():
    """The orchard: a flat green field with faint planting rows and a hedge."""
    rng = random.Random(7)
    g = ('<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6F7F45"/><stop offset="1" stop-color="#5E7040"/></linearGradient></defs>'
         f'<rect width="{W}" height="{H}" fill="url(#g)"/>')
    g += _rows(rng, 120, 60, 1320, 860, 26, '#54663A', 3)
    for _ in range(40):  # mown patches and shadows
        g += f'<ellipse cx="{rng.uniform(0, W):.0f}" cy="{rng.uniform(0, H):.0f}" rx="{rng.uniform(30, 120):.0f}" ry="{rng.uniform(20, 70):.0f}" fill="#7C8B4E" fill-opacity="{rng.uniform(0.08, 0.2):.2f}"/>'
    g += f'<rect x="0" y="0" width="{W}" height="42" fill="#3F4F2C" fill-opacity="0.85"/><rect x="1380" y="0" width="60" height="{H}" fill="#4A5A32" fill-opacity="0.8"/>'
    return _svg(g)


def paper(scale, seed, roads=True):
    """Map paper: parchment with a faint grid and, for the site, a few quiet roads and parcels."""
    rng = random.Random(seed)
    g = f'<rect width="{W}" height="{H}" fill="#E9E2D2"/>'
    for x in range(0, W, scale):
        g += f'<line x1="{x}" y1="0" x2="{x}" y2="{H}" stroke="#D8CFBB" stroke-width="1"/>'
    for y in range(0, H, scale):
        g += f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="#D8CFBB" stroke-width="1"/>'
    if roads:
        for _ in range(14):
            x, y = rng.uniform(0, W), rng.uniform(0, H)
            g += f'<rect x="{x:.0f}" y="{y:.0f}" width="{rng.uniform(80, 260):.0f}" height="{rng.uniform(60, 200):.0f}" fill="#DED6C3" stroke="#CFC5AE" stroke-width="1.2"/>'
        pts = [(0, 620), (300, 560), (640, 590), (980, 470), (1440, 430)]
        d = 'M' + ' L'.join(f'{x} {y}' for x, y in pts)
        g += f'<path d="{d}" fill="none" stroke="#F7F2E6" stroke-width="12"/><path d="{d}" fill="none" stroke="#C9BFA6" stroke-width="14" stroke-opacity="0.6" stroke-dasharray="0"/><path d="{d}" fill="none" stroke="#F7F2E6" stroke-width="10"/>'
        g += '<path d="M760 0 L720 380 L690 900" fill="none" stroke="#F7F2E6" stroke-width="8"/>'
        g += '<path d="M0 240 C 300 260, 500 200, 760 300 S 1200 420, 1440 380" fill="none" stroke="#9FB6C6" stroke-width="5" stroke-opacity="0.6"/>'
    return _svg(g)


def world():
    """The world at zoom 3: paper with a graticule and two soft land masses."""
    g = f'<rect width="{W}" height="{H}" fill="#DCE4E6"/>'
    g += '<path d="M120 180 C 260 120, 420 160, 520 240 S 640 420, 560 520 S 380 640, 300 560 S 80 420, 120 180z" fill="#E9E2D2" stroke="#C9C0AA" stroke-width="1.5"/>'
    g += '<path d="M760 140 C 900 90, 1180 110, 1320 220 S 1380 480, 1240 560 S 980 640, 860 560 S 700 300, 760 140z" fill="#E9E2D2" stroke="#C9C0AA" stroke-width="1.5"/>'
    for x in range(0, W, 120):
        g += f'<line x1="{x}" y1="0" x2="{x}" y2="{H}" stroke="#B9C4C8" stroke-width="1" stroke-opacity="0.6"/>'
    for y in range(0, H, 120):
        g += f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="#B9C4C8" stroke-width="1" stroke-opacity="0.6"/>'
    return _svg(g)


def _blobs(seed, colours, n, rx, ry):
    rng = random.Random(seed)
    g = ''
    for i in range(n):
        c = colours[i % len(colours)]
        cx, cy = rng.uniform(0, W), rng.uniform(0, H)
        g += f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{rng.uniform(*rx):.0f}" ry="{rng.uniform(*ry):.0f}" transform="rotate({rng.uniform(-40, 40):.0f} {cx:.0f} {cy:.0f})" fill="{c}" fill-opacity="0.55"/>'
    return g


def slope():
    """Slope classes as soft bands running down the site (flat, gentle, steep)."""
    g = '<defs><filter id="b"><feGaussianBlur stdDeviation="28"/></filter></defs><g filter="url(#b)">'
    g += _blobs(3, ['#F2D28B', '#E39A4A', '#B85A2A'], 22, (140, 320), (60, 160))
    g += '</g>'
    return _svg(g)


def wetness():
    """A wetness index: blue pooling along a diagonal valley."""
    g = '<defs><filter id="b"><feGaussianBlur stdDeviation="34"/></filter></defs><g filter="url(#b)">'
    g += '<path d="M60 840 C 320 700, 520 720, 700 560 S 1040 300, 1400 120" fill="none" stroke="#1F5F8B" stroke-width="150" stroke-opacity="0.7" stroke-linecap="round"/>'
    g += _blobs(5, ['#3E7FA8', '#7FB0CC'], 12, (60, 180), (40, 100))
    g += '</g>'
    return _svg(g)


def streams():
    """Flow lines gathering into the valley: short dark segments, as the analysis draws them."""
    rng = random.Random(11)
    g = ''
    for i in range(46):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        segs = ''
        for _ in range(rng.randint(8, 40)):
            # drift towards the valley line y = 840 - 0.5 x, with noise
            ty = 840 - 0.5 * x
            dx = 6 if ty > y else 6
            dy = (6 if ty > y else -6) + rng.uniform(-3, 3)
            nx, ny = x + dx, y + dy
            segs += f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{nx:.1f}" y2="{ny:.1f}" stroke="#0B2A40" stroke-opacity="0.55" stroke-width="{rng.uniform(2.5, 5.2):.1f}" stroke-linecap="round"/>'
            x, y = nx, ny
            if not (0 <= x <= W and 0 <= y <= H):
                break
        g += segs
    return _svg(g)


def crowns():
    """Detected tree crowns: irregular polygons with a dark casing and a light stroke."""
    rng = random.Random(13)
    g = ''
    for _ in range(140):
        cx, cy, r = rng.uniform(40, W - 40), rng.uniform(60, H - 40), rng.uniform(9, 24)
        pts = ' '.join(f'{cx + r * rng.uniform(0.75, 1.15) * math.cos(a):.1f},{cy + r * rng.uniform(0.75, 1.15) * math.sin(a):.1f}'
                       for a in [k * 2 * math.pi / 14 for k in range(14)])
        g += (f'<polygon points="{pts}" fill="#E2B85A" fill-opacity="0.18" stroke="#1A160F" stroke-opacity="0.55" stroke-width="3.2"/>'
              f'<polygon points="{pts}" fill="none" stroke="#FFF3D6" stroke-width="1.4"/>')
    return _svg(g)


def orchard():
    """The reference Design: 2,201 plants of 117 species, expanded from the compact orchard.json."""
    d = json.load(open(os.path.join(HERE, 'orchard.json')))
    sp = d['species']
    plants = [dict(x=x, y=y, k=sp[i]['k'], c=sp[i]['c'], s=sp[i]['s'], l=sp[i]['l'], z=z) for x, y, i, z in d['plants']]
    return {'species': sp, 'plants': plants}


def write_all(out):
    os.makedirs(out, exist_ok=True)
    import overlay
    data = orchard()
    files = {
        'orchard-sat.svg': field(), 'site-z18.svg': paper(90, 2), 'site-z16.svg': paper(48, 4), 'world-z3.svg': world(),
        'slope-overlay.svg': slope(), 'wetness.svg': wetness(), 'streams.svg': streams(), 'crowns.svg': crowns(),
        'plants-site.svg': overlay.overlay(data, zoom=1, size=14),
        'plants-close.svg': overlay.overlay(data, zoom=2.6, size=18),
        'plants-close-goji.svg': overlay.overlay(data, zoom=2.6, size=18, keep={'LBA'}),
        'plants-find.svg': overlay.overlay(data, zoom=1, size=14, keep={'MDO', 'MSY'}),
        'orchard-json.json': json.dumps(data, separators=(',', ':'), ensure_ascii=False),
    }
    for name, text in files.items():
        with open(os.path.join(out, name), 'w') as f:
            f.write(text)
