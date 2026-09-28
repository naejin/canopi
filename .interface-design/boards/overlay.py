"""Draw the orchard's plants as one SVG overlay for the static boards (symbols from defs-v3.svg.part)."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DEFS = open(os.path.join(HERE, 'defs-v3.svg.part')).read().replace('var(--ko, #FFFFFF)', '#FFFFFF')


def overlay(data, zoom=1.0, cx=640, cy=470, ox=640, oy=470, size=14, W=1440, H=900, halo=2.0, keep=None):
    """`keep`: species codes drawn at full opacity while every other plant is dimmed (a finder highlight)."""
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>{DEFS}</defs>']
    for p in data['plants']:
        X = ox + (p['x'] - cx) * zoom
        Y = oy + (p['y'] - cy) * zoom
        if not (-30 < X < W + 30 and -30 < Y < H + 30):
            continue
        w = size * p['z']
        op = ' opacity="0.18"' if keep and p['k'] not in keep else ''
        out.append(f'<use href="#p-{p["s"]}" x="{X - w / 2:.1f}" y="{Y - w / 2:.1f}" width="{w:.1f}" height="{w:.1f}"{op} '
                   f'style="color:{p["c"]};stroke:#FFFFFF;stroke-width:{halo};stroke-linejoin:round;paint-order:stroke"/>')
    out.append('</svg>')
    return '\n'.join(out)
