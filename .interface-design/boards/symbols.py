"""Canopi plant symbol set: single source for the mockup and, later, the app recipes.

Grid: 24 x 24. Plant forms stand on the ground line y = 22; produce and role icons are centred.
Every part is a filled shape (no strokes). Detail is a cut-out painted in the outline colour (--ko).
"""
import math, json

KO = 'style="fill: var(--ko, #FFFFFF); stroke: none;"'
FILL = 'fill="currentColor"'


def f(x):
    return f'{x:.2f}'.rstrip('0').rstrip('.')


def circ(cx, cy, r, extra=FILL):
    return f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" {extra}></circle>'


def ell(cx, cy, rx, ry, rot=0, extra=FILL):
    t = f' transform="rotate({f(rot)} {f(cx)} {f(cy)})"' if rot else ''
    return f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx)}" ry="{f(ry)}"{t} {extra}></ellipse>'


def rect(x, y, w, h, extra=FILL):
    return f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" {extra}></rect>'


def path(d, extra=FILL):
    return f'<path {extra} d="{d}"></path>'


def poly(pts):
    return 'M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in pts) + 'Z'


def lens(x0, y0, x1, y1, w, bulge=0.5):
    """Pointed leaf from (x0, y0) to (x1, y1) with half-width w."""
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    nx, ny = -dy / L, dx / L
    ax, ay = x0 + dx * bulge, y0 + dy * bulge
    c1 = (ax + nx * w * 1.33, ay + ny * w * 1.33)
    c2 = (ax - nx * w * 1.33, ay - ny * w * 1.33)
    return (f'M{f(x0)} {f(y0)}Q{f(c1[0])} {f(c1[1])} {f(x1)} {f(y1)}'
            f'Q{f(c2[0])} {f(c2[1])} {f(x0)} {f(y0)}Z')


def qbez(p0, p1, p2, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
            for t in (i / n for i in range(n + 1))]


def cbez(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def arc(cx, cy, r, a0, a1, n=20):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def band(pts, width, caps=True):
    """Filled band along a polyline. width is a number or a function of t in [0, 1] (half-width)."""
    wf = width if callable(width) else (lambda t: width)
    L, R, n = [], [], len(pts)
    for i, (x, y) in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dy) or 1
        nx, ny = -dy / l, dx / l
        w = wf(i / (n - 1))
        L.append((x + nx * w, y + ny * w))
        R.append((x - nx * w, y - ny * w))
    out = path(poly(L + R[::-1]))
    if caps:
        out += circ(*pts[0], wf(0)) + circ(*pts[-1], wf(1))
    return out


def group(inner, transform):
    return f'<g transform="{transform}">{inner}</g>'


S = {}

# ---------------- plant forms (side views on the ground line) ----------------
S['canopy'] = (circ(12, 7.2, 6.2) + circ(6.4, 10, 4.5) + circ(17.6, 10, 4.5)
               + circ(9.4, 12.2, 3.4) + circ(14.6, 12.2, 3.4)
               + path('M10.3 22 10.8 13h2.4l.5 9z'))
S['conifer'] = path('M12 1.5 17.4 8H15l4.8 5.8h-3l4.7 6H13.3V22h-2.6v-2.2H2.5l4.7-6h-3L9 8H6.6z')
S['palm'] = (band(qbez((11.2, 22), (11.6, 15), (13.2, 9)), lambda t: 1.9 - 0.7 * t, caps=False)
             + ''.join(band(qbez((13.2, 9), c, e), lambda t, w=w: w * (1 - t) + 0.5 * t, caps=False)
                       for c, e, w in [((6, 5.4), (1.6, 12.6), 2.0), ((9, 3), (4.4, 3.2), 1.8),
                                       ((13.6, 4), (12.8, 1.4), 1.6), ((17.6, 3.2), (21.4, 4.6), 1.8),
                                       ((20.6, 5.6), (22.4, 12.6), 2.0)])
             + circ(13.2, 9, 1.9))
S['shrub'] = (circ(12, 9.4, 5.8) + circ(6.4, 12.8, 4.8) + circ(17.6, 12.8, 4.8) + circ(12, 15.4, 5.4)
              + f'<rect x="2.4" y="14.4" width="19.2" height="7.6" rx="3.4" {FILL}></rect>')
# Herb: a sprout, two broad leaves on a short stem; wide rather than round, unlike the canopy tree.
S['herb'] = (rect(10.8, 12, 2.4, 10)
             + path(lens(12, 13.6, 1.2, 6.2, 4.1, 0.5)) + path(lens(12, 13.6, 22.8, 6.2, 4.1, 0.5))
             + path(lens(12, 12.4, 12, 2.6, 2.5, 0.5)))
S['grass'] = ''.join(band(qbez(a, b, c), lambda t, w=w: w * (1 - t) + 0.4 * t, caps=False)
                     for a, b, c, w in [((10.2, 22), (8, 14), (2.2, 6), 1.9), ((11.8, 22), (10.6, 11), (12.6, 1.8), 2.0),
                                        ((13.6, 22), (15.6, 13), (21.6, 5), 1.9), ((11, 22), (7.6, 17.2), (3.8, 14.4), 1.5),
                                        ((13, 22), (16.6, 17.4), (20.4, 15.2), 1.5)])
S['bamboo'] = (path('M4.6 4.5h3.6V22H4.6z M10.2 1.8h3.6V22h-3.6z M15.8 7h3.6v15h-3.6z')
               + f'<g {KO}>' + ''.join(f'<rect x="{x}" y="{y}" width="3.6" height="1.1"></rect>'
                                        for x, ys in [(4.6, [9.2, 14.6]), (10.2, [6.6, 12, 17.4]), (15.8, [12, 17])]
                                        for y in ys) + '</g>'
               + path(lens(13.8, 6, 21.6, 3.2, 1.7)) + path(lens(8.2, 11, 1.4, 7.8, 1.6))
               + path(lens(19.4, 11.8, 23, 15.8, 1.4)))
fern = ''
for p0, p1, p2, n in [((11.2, 22), (5, 14.6), (1.6, 5.6), 5), ((12.8, 22), (19, 14.6), (22.4, 5.6), 5)]:
    pts = qbez(p0, p1, p2, 40)
    fern += band(pts, lambda t: 1.2 - 0.6 * t, caps=False)
    for k in range(1, n + 1):
        t = k / (n + 1.1)
        i = int(t * 40)
        x, y = pts[i]
        bx, by = pts[i + 1]
        dx, dy = bx - x, by - y
        l = math.hypot(dx, dy)
        ux, uy = dx / l, dy / l
        L = 4.6 * (1 - t * 0.55)
        for sd in (1, -1):
            nx, ny = -uy * sd, ux * sd
            fern += path(lens(x, y, x + nx * L + ux * L * 0.6, y + ny * L + uy * L * 0.6, 1.8 * (1 - t * 0.3), 0.45))
spiral = [(12 + (3.6 - 2.5 * k / 30) * math.cos(math.radians(90 - 330 * k / 30)),
           9.6 + (3.6 - 2.5 * k / 30) * math.sin(math.radians(90 - 330 * k / 30))) for k in range(31)]
fern += rect(10.8, 13, 2.4, 9) + band(spiral, lambda t: 1.35 - 0.35 * t)
S['fern'] = fern
vine = cbez((8.6, 22), (19.5, 17), (4.6, 10.5), (12.2, 2.6), 40)
S['climber'] = (band(vine, 1.3)
                + path('M13 16.2c1.6-2.6 4.4-3.2 7-2.6.5 3.2-2 5.4-7 2.6z')
                + path('M10.6 12.2c-1.8-2.4-4.6-2.8-7.2-2-.2 3.2 2.6 5.2 7.2 2z')
                + path('M12.6 5.8c1.6-2.2 4-2.8 6.4-2.2.4 3-1.8 4.8-6.4 2.2z')
                + circ(17.4, 9.6, 2.7) + circ(17.4, 9.6, 1.1, KO))
S['groundcover'] = (circ(3.8, 19.4, 2.6) + circ(8, 18.6, 3) + circ(12, 18.3, 3.1) + circ(16, 18.6, 3)
                    + circ(20.2, 19.4, 2.6) + rect(1.2, 19.4, 21.6, 2.6)
                    + ''.join(ell(x, y, rx, ry, r) for x, y, rx, ry, r in
                              [(4.6, 16.4, 1.9, 2.3, -40), (12, 14.6, 2.1, 2.6, 0), (19.4, 16.4, 1.9, 2.3, 40),
                               (8.2, 15.3, 1.8, 2.3, -18), (15.8, 15.3, 1.8, 2.3, 18)]))
S['rosette'] = (''.join(path(lens(12, 21.6, 12 + math.sin(math.radians(a)) * L, 21.6 - math.cos(math.radians(a)) * L, w, 0.4))
                        for a, L, w in [(-78, 11, 1.9), (-52, 13, 2.1), (-26, 15, 2.3), (0, 17.5, 2.4),
                                        (26, 15, 2.3), (52, 13, 2.1), (78, 11, 1.9)])
                + rect(6, 20.2, 12, 1.8))
S['cactus'] = path('M9.5 22v-7h-4C3 15 2 13.4 2 11V8c0-3 4-3 4 0v2.7h3.5V4c0-3.5 5-3.5 5 0v9.7H18V10c0-3 4-3 4 0v4c0 2.7-1.5 4-4 4h-3.5v4z')

# ---------------- produce: what the plant gives ----------------
S['apple'] = (path('M12 7.6c-1.3-.9-2.7-1.3-4.1-1.1C4.9 6.9 3.4 9.4 3.7 12.7c.3 3.7 2.7 8.2 5.6 8.6 1 .1 1.7-.5 2.7-.5s1.7.6 2.7.5c2.9-.4 5.3-4.9 5.6-8.6.3-3.3-1.2-5.8-4.2-6.2-1.4-.2-2.8.2-4.1 1.1z')
              + path('M11 7.4c-.3-2 .3-3.8 1.6-5.2l1.4 1c-1 1.2-1.4 2.6-1.2 4.2z')
              + path('M13.4 5.4c.8-2.6 3.2-4 6.2-3.8-.7 2.7-3.2 4.2-6.2 3.8z')
              + path('M6.4 12.6c.1-2 1.2-3.4 2.9-3.9-.6 1.4-.9 2.6-.9 4.1z', KO))
acorn = (rect(11.2, 1.8, 1.6, 3.2) + path('M4.4 10.6c0-3.7 3.4-6.1 7.6-6.1s7.6 2.4 7.6 6.1z')
         + path('M6 12h12c0 5.4-2.7 9.3-6 10.6-3.3-1.3-6-5.2-6-10.6z'))
S['nut'] = group(acorn, 'rotate(28 12 12) translate(1.2 0.6) scale(0.92)')
S['berry'] = (path('M11 9.6c-.2-2.6.6-4.8 2.4-6.4l1.2 1c-1.4 1.4-2 3.2-1.8 5.4z')
              + path('M13.4 5c1.8-2.4 4.8-3.2 7.8-2.2-1.6 2.6-4.6 3.6-7.8 2.2z')
              + circ(7.6, 13.6, 4.2) + circ(16.4, 13.6, 4.2) + circ(12, 19, 4.2)
              + f'<g {KO}>' + circ(6.4, 12.4, 1.2, '') + circ(15.2, 12.4, 1.2, '') + circ(10.8, 17.8, 1.2, '') + '</g>')
S['grape'] = (rect(11.2, 1.4, 1.6, 4.4) + path('M12.7 3.8c1.6-2.1 4.1-2.8 6.6-2-1.4 2.3-3.9 3.1-6.6 2z')
              + ''.join(circ(x, y, 2.45) for x, y in [(5.2, 8), (9.6, 8), (14.4, 8), (18.8, 8), (7.4, 12), (12, 12), (16.6, 12),
                                                        (9.7, 16), (14.3, 16), (12, 20)]))
S['flower'] = (rect(10.9, 13, 2.2, 9) + path(lens(12, 19.6, 19, 15.2, 2.2, 0.5))
               + ''.join(ell(12 + 4.7 * math.sin(math.radians(a)), 8.2 - 4.7 * math.cos(math.radians(a)), 2.5, 3.4, a)
                         for a in range(0, 360, 60))
               + circ(12, 8.2, 2.5, KO))
# Nitrogen fixer: a pea pod lying horizontally, peas cut out.
pod = qbez((2.2, 15.2), (11.5, 7.6), (21.2, 12.6), 40)
S['pod'] = (band(pod, lambda t: 0.6 + 4.2 * math.sin(math.pi * t) ** 0.7, caps=False)
            + band(qbez((20.6, 12.2), (22.2, 10.6), (22, 8.4), 10), 0.8)
            + f'<g {KO}>' + ''.join(circ(*pod[i], 2.1, '') for i in (11, 20, 29)) + '</g>')

# ---------------- roles: what the plant does for the design ----------------
S['carrot'] = (path(poly([(2.2, 21.8)] + arc(15, 9.6, 4.4, -133.6, 46.4, 20)))
               + path(lens(15.6, 6.4, 16.4, 0.8, 1.7, 0.5)) + path(lens(16.8, 7, 22.6, 3.2, 1.8, 0.5))
               + path(lens(17.8, 8.4, 23.2, 8.6, 1.6, 0.5))
               + f'<g {KO}>' + path(lens(7.4, 17.2, 10.2, 18.6, 0.55), '') + path(lens(10.8, 13.2, 13.8, 14.8, 0.6), '') + '</g>')
S['grain'] = (rect(11.2, 7.5, 1.6, 14.5)
              + ''.join(ell(x, y, 2.1, 3.2, r) for x, y, r in [(9.4, 8.4, -30), (14.6, 8.4, 30), (9.4, 12.6, -30),
                                                               (14.6, 12.6, 30), (9.4, 16.8, -30), (14.6, 16.8, 30), (12, 4.4, 0)])
              + path(lens(12, 1.6, 12, 0.2, 0.4)))
chili = qbez((10.4, 7.2), (8.2, 17.6), (17.4, 21.6), 40)
S['chili'] = (band(chili, lambda t: 3.7 * (1 - t) ** 0.65 + 0.5)
              + ell(11.2, 6.4, 4.2, 2, -8)
              + band(qbez((11.6, 5.4), (11.8, 2.6), (14.8, 1.6), 10), 0.85))
S['medicinal'] = (path('M2.6 10h18.8v2H2.6z M3.6 12h16.8c-.3 3.9-3 7-6.7 7.8V21H10.3v-1.2C6.6 19 3.9 15.9 3.6 12z')
                  + band([(13.4, 9.2), (19.4, 2.6)], 1.7))
S['bee'] = (ell(10.4, 7.2, 2.9, 4.3, -22) + ell(15.6, 7.2, 2.7, 4, 22)
            + ell(13.2, 14.6, 6.8, 4.6) + circ(5, 14.2, 2.8) + path('M19.6 13.6l3.2 1-3.2 1z')
            + f'<g {KO}>' + rect(10.3, 10.8, 1.6, 7.6, '') + rect(14, 10.8, 1.6, 7.6, '') + '</g>')
S['biomass'] = (path('M7.6 7.6 22 14.6l-1.4 2.2L6.4 10.8z M7.6 16.4 22 9.4l-1.4-2.2L6.4 13.2z')
                + circ(5.2, 6.4, 3.6) + circ(5.2, 17.6, 3.6)
                + f'<g {KO}>' + circ(5.2, 6.4, 1.6, '') + circ(5.2, 17.6, 1.6, '') + circ(13, 12, 1, '') + '</g>')
S['timber'] = (path('M7 6.2h11.5a4.2 5.8 0 0 1 0 11.6H7a4.2 5.8 0 0 1 0-11.6z') + path('M12.2 6.6l1.4-3.2h2.4l-1.3 3.2z')
               + f'<g {KO}>' + path('M7 8.4a2.7 3.6 0 1 0 .01 0zm0 1.4a1.3 2.2 0 1 1-.01 0z', '') + circ(7, 12, 0.9, '') + '</g>')
# Fodder: a cow in side view, a horizontal body on four legs; unlike any round symbol.
S['fodder'] = (path('M7.2 7.6h10.4c2.4 0 3.6 1.6 3.6 3.8v2.2c0 1.6-1 2.6-2.4 2.6H7.4c-1.8 0-2.8-1.2-2.8-3v-2.8c0-1.8 1.2-2.8 2.6-2.8z')
               + path('M1.2 7.6c0-1.6 1.2-2.6 2.8-2.6h1.6c1.4 0 2.4 1 2.4 2.4v3.4c0 1.2-.8 2-2 2H3.2c-1.2 0-2-.8-2-2z')
               + path(lens(4.6, 5.4, 6.4, 2.2, 0.8)) + path(lens(3.2, 6.2, 0.4, 4.8, 0.9))
               + rect(6.4, 14.4, 2.3, 7.6) + rect(9.6, 14.4, 2.3, 7.6) + rect(14.2, 14.4, 2.3, 7.6) + rect(17.4, 14.4, 2.3, 7.6)
               + band(qbez((20.8, 9), (22.6, 11), (22.2, 15.4), 12), 0.6) + ell(22.2, 16.2, 1, 1.4)
               + f'<g {KO}>' + ell(11.8, 10.8, 2.4, 1.6, -10, '') + ell(16.6, 12.4, 1.5, 1.1, 0, '') + '</g>')
wind = (band([(2.6, 9)] + arc(14, 6, 3, 90, -180, 24)[0:], 1.25)
        + band([(2.6, 13.5), (18, 13.5)] + arc(18, 16.5, 3, -90, 180, 24)[1:], 1.25)
        + band([(2.6, 18), (9.4, 18)], 1.25))
S['windbreak'] = wind
worm = (cbez((3.2, 18.4), (4.6, 10.4), (9.2, 10.4), (10.2, 15), 16)
        + cbez((10.2, 15), (11.2, 19.6), (15.4, 19.6), (16.4, 13.6), 16)[1:]
        + cbez((16.4, 13.6), (17, 10.4), (18.6, 9.2), (20, 9.4), 10)[1:])
ticks = ''
for i in (6, 12, 20, 27, 35):
    x, y = worm[i]
    bx, by = worm[i + 1]
    ang = math.degrees(math.atan2(by - y, bx - x))
    ticks += ell(x, y, 0.5, 2, ang, '')
S['soil'] = (rect(1.4, 20.6, 21.2, 2) + band(worm, 2.1) + circ(20.2, 9.4, 2.5)
             + f'<g {KO}>{ticks}' + circ(21, 8.8, 0.7, '') + '</g>')
S['mushroom'] = (path('M1.4 12.8C1.4 6.8 6.2 3.4 12 3.4s10.6 3.4 10.6 9.4c0 .9-.6 1.4-1.4 1.4H2.8c-.8 0-1.4-.5-1.4-1.4z')
                 + path('M8.2 15.4h7.6l.6 5.2c.1 1-.6 1.6-1.6 1.6H9.2c-1 0-1.7-.6-1.6-1.6z')
                 + f'<g {KO}>' + circ(7.4, 9.2, 1.8, '') + circ(13.2, 6.8, 1.5, '') + circ(17.2, 10.2, 1.6, '') + '</g>')

ORDER = ['canopy', 'conifer', 'palm', 'shrub', 'herb', 'grass', 'bamboo', 'fern', 'climber', 'groundcover', 'rosette', 'cactus',
         'apple', 'nut', 'berry', 'grape', 'flower', 'pod',
         'carrot', 'grain', 'chili', 'medicinal', 'bee', 'biomass', 'timber', 'fodder', 'windbreak', 'soil', 'mushroom']


def defs():
    return '\n'.join(f'<symbol id="p-{k}" viewBox="0 0 24 24">{S[k]}</symbol>' for k in ORDER)


if __name__ == '__main__':
    import os
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'defs-v3.svg.part'), 'w') as f:
        f.write(defs())
    print(len(ORDER), 'symbols')
