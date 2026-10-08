"""Canopi v2 design system for the mockup canvas: tokens, CSS, icons and components.

Every board is generated from these parts, so a fix here lands on every board.
Component functions return HTML strings written with real elements and ARIA semantics.
Copy is US English (the app's en locale); numbers follow the en locale (2,201 · 20% · €6,482.30).
"""
import html as _html
import itertools

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,600'
         '&amp;family=Source+Sans+3:ital,wght@0,400;0,600;1,400&amp;family=IBM+Plex+Mono:wght@400;600&amp;display=swap" rel="stylesheet">')

_ids = itertools.count(1)


def uid(prefix='u'):
    return f'{prefix}{next(_ids)}'


# ---------------------------------------------------------------- tokens
LIGHT = {
    'paper': '#EFE9DD', 'surface': '#FBF8F2', 'surface-2': '#F3EEE3', 'glass': 'rgba(251,248,242,0.95)',
    'ink': '#27231D', 'ink-2': '#4A4237', 'muted': '#645A4C',
    'line': 'rgba(58,46,28,0.14)', 'line-strong': 'rgba(58,46,28,0.55)',   # control boundaries ≥ 3:1
    'hover': 'rgba(150,88,22,0.08)', 'pressed': 'rgba(150,88,22,0.14)',
    'accent': '#9C5A16', 'accent-ink': '#8A4E12', 'on-accent': '#FFF8EC', 'accent-soft': 'rgba(156,90,22,0.12)',
    'danger': '#A8332A', 'danger-soft': 'rgba(168,51,42,0.09)',
    'warn': '#7A5A00', 'warn-soft': 'rgba(214,170,40,0.18)', 'warn-line': '#A88410',
    'focus': '#1F5F8B',
    'switch-off': '#8C8579', 'knob': '#FFFFFF',
    'scrim': 'rgba(24,20,14,0.42)',
    'shadow': '0 10px 30px rgba(30,22,10,0.16), 0 1px 3px rgba(30,22,10,0.10)', 'shadow-sm': '0 2px 8px rgba(30,22,10,0.12)',
    'tip': '#27231D', 'on-tip': '#FBF3E4',
    'curve-1': '#27231D', 'curve-2': '#9C5A16', 'curve-3': '#2E7D4F', 'curve-4': '#8A3F7A',   # profile curves, never blue
}
DARK = {
    'paper': '#161510', 'surface': '#201E19', 'surface-2': '#2A2721', 'glass': 'rgba(30,28,23,0.93)',
    'ink': '#EFE8DA', 'ink-2': '#D6CEBF', 'muted': '#B5AC9D',
    'line': 'rgba(255,248,235,0.12)', 'line-strong': 'rgba(255,248,235,0.40)',
    'hover': 'rgba(240,170,80,0.10)', 'pressed': 'rgba(240,170,80,0.18)',
    'accent': '#E3A04C', 'accent-ink': '#F0B465', 'on-accent': '#1D1A14', 'accent-soft': 'rgba(227,160,76,0.20)',
    'danger': '#F08A7C', 'danger-soft': 'rgba(240,138,124,0.12)',
    'warn': '#E8C766', 'warn-soft': 'rgba(232,199,102,0.14)', 'warn-line': '#C9A640',
    'focus': '#7FB8E0',
    'switch-off': '#6E685E', 'knob': '#1D1A14',
    'scrim': 'rgba(0,0,0,0.55)',
    'shadow': '0 12px 34px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.4)', 'shadow-sm': '0 2px 8px rgba(0,0,0,0.35)',
    'tip': '#EFE8DA', 'on-tip': '#1D1A14',
    'curve-1': '#EFE8DA', 'curve-2': '#E3A04C', 'curve-3': '#7FC79A', 'curve-4': '#D58BC6',
}


def _vars(t):
    return ';'.join(f'--{k}:{v}' for k, v in t.items())


CSS = """
body{margin:0;background:var(--paper);font-family:'Source Sans 3',system-ui,sans-serif;color:var(--ink)}
a{color:#8A4E12}a:hover{color:#6E3D0C}
.th{%LIGHT%;color:var(--ink);font-family:'Source Sans 3','Noto Sans','PingFang SC','Hiragino Sans','Apple SD Gothic Neo','Microsoft YaHei',system-ui,sans-serif;font-size:14px;line-height:1.4;-webkit-font-smoothing:antialiased;color-scheme:light;font-synthesis:none}
.th.dark{%DARK%;color-scheme:dark}
.th *{box-sizing:border-box}
.th a{color:var(--accent-ink)}
.th h1,.th h2,.th h3{margin:0}
.disp{font-family:'Literata','Noto Serif','Noto Sans SC','Hiragino Sans',Georgia,serif;font-weight:600;letter-spacing:-0.005em}
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace}
.muted{color:var(--muted)}
.small{font-size:12.5px}
.num{font-variant-numeric:tabular-nums}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ic{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.ic.s16{width:16px;height:16px}.ic.s18{width:18px;height:18px}
.ic .f{fill:currentColor;stroke:none}
.compass .ring{stroke:var(--ink-2)}.compass .nn{fill:var(--muted);stroke:var(--muted)}.compass .ns{fill:none;stroke:var(--muted)}
.compass.turned .nn{fill:var(--accent);stroke:var(--accent)}.compass.turned .ns{stroke:var(--ink)}
.compass.dragging{background:var(--accent-soft);cursor:grabbing}
.th :focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.th .mi:focus-visible,.th .seg:focus-visible,.th .row:focus-visible{outline-offset:-2px}
.focus-demo{outline:2px solid var(--focus);outline-offset:2px}
.float{background:var(--glass);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px}
.sheet{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
.rule{height:1px;background:var(--line);border:0;margin:0}
.vrule{width:1px;align-self:stretch;background:var(--line)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:32px;padding:0 13px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface);color:var(--ink);font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--hover)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn.primary:hover{filter:brightness(1.06)}
.btn.ghost{background:transparent;border-color:transparent;color:var(--ink-2)}
.btn.ghost:hover{background:var(--hover)}
.btn.link{background:transparent;border-color:transparent;color:var(--accent-ink);padding:0 6px}
.btn.danger{background:var(--danger);border-color:var(--danger);color:#FFF8F4}
.th.dark .btn.danger{color:#1D1A14}
.btn.sm{height:28px;padding:0 10px;font-size:13px;border-radius:7px}
.btn.md{height:34px}
.btn.lg{height:44px;padding:0 18px;font-size:15px;border-radius:10px}
.btn[disabled]{opacity:0.45;cursor:default}
.btn[aria-pressed=true]:not(.plain){background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink)}
.ib{width:36px;height:36px;border-radius:9px;border:0;background:transparent;color:var(--ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;position:relative;flex-shrink:0}
.ib:hover{background:var(--hover)}
.ib.on{background:var(--accent);color:var(--on-accent)}
.ib.sm{width:28px;height:28px;border-radius:7px}
.ib.lg{width:40px;height:40px;border-radius:10px}
.ib.touch{width:44px;height:44px;border-radius:11px}
.ib.fav{color:var(--accent)}
.ib.fav svg path{fill:currentColor}
.ib.quiet{color:var(--muted);opacity:0.7}
.ib.soft{background:var(--accent-soft);color:var(--ink)}
.ib[disabled]{opacity:0.38;cursor:default}
.ib[disabled]:hover{background:transparent}
.field{display:flex;flex-direction:column;gap:5px;min-width:0}
.lbl{font-size:12.5px;font-weight:600;color:var(--ink-2)}
.hint{font-size:12.5px;color:var(--muted);line-height:1.35}
.hint.err{color:var(--danger);display:flex;gap:5px;align-items:flex-start}
.input{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface);color:var(--ink);font:inherit;font-size:14px}
.input input,.input textarea{border:0;background:transparent;font:inherit;color:inherit;outline:none;flex:1 1 auto;min-width:0;padding:0}
.input input::placeholder,.input textarea::placeholder{color:var(--muted)}
.input:focus-within,.input.focus{border-color:var(--focus);box-shadow:0 0 0 2px var(--focus)}
.input.err{border-color:var(--danger)}
.input.touch{height:46px;font-size:16px}
.input.touch input{font-size:16px}
textarea.ta{width:100%;min-height:84px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface);color:var(--ink);font:inherit;font-size:14px;padding:8px 10px;resize:vertical}
.kbd{font-family:'Source Sans 3',sans-serif;font-size:12px;color:var(--ink-2);border:1px solid var(--line-strong);border-radius:5px;padding:0 5px;line-height:18px;background:var(--surface-2);white-space:nowrap}
.segs{display:flex;flex-wrap:wrap;background:var(--surface-2);border:1px solid var(--line-strong);border-radius:9px;padding:2px;gap:2px}
.seg{flex:1 1 auto;border:1.5px solid transparent;background:transparent;border-radius:7px;min-height:28px;font:inherit;font-size:13px;color:var(--ink-2);cursor:pointer;padding:0 8px;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.seg:hover{background:var(--hover)}
.seg.on{background:var(--surface);color:var(--ink);font-weight:600;border-color:var(--ink-2)}
.chk{display:flex;align-items:center;gap:9px;font-size:14px;cursor:pointer;min-height:28px}
.chk input{accent-color:var(--accent);width:16px;height:16px;margin:0;flex-shrink:0}
.th input[type=radio]{appearance:none;-webkit-appearance:none;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--line-strong);background:var(--surface);margin:0;flex-shrink:0;display:inline-grid;place-content:center;cursor:pointer}
.th input[type=radio]::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--accent);transform:scale(0)}
.th input[type=radio]:checked{border-color:var(--accent)}
.th input[type=radio]:checked::before{transform:scale(1)}
.switch{position:relative;display:inline-block;width:34px;height:20px;border-radius:10px;background:var(--switch-off);flex-shrink:0}
.switch::after{content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#FFFFFF;box-shadow:0 1px 2px rgba(0,0,0,0.3)}
.switch.on{background:var(--accent)}
.switch.on::after{left:16px;background:var(--knob)}
.sw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;font-size:14px;position:relative;cursor:pointer}
.sw-row input:focus-visible+.switch{outline:2px solid var(--focus);outline-offset:2px}
input[type=range]{accent-color:var(--accent);margin:0;height:24px}
.dropdown{display:flex;align-items:center;justify-content:space-between;gap:8px;height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface);color:var(--ink);font:inherit;font-size:14px;cursor:pointer;text-align:left;min-width:0}
.dropdown span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.menu{background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:var(--shadow);padding:5px;min-width:220px}
.mi{display:flex;align-items:center;gap:10px;min-height:32px;padding:4px 10px;border-radius:7px;font-size:14px;color:var(--ink);border:0;background:transparent;width:100%;font-family:inherit;text-align:left;cursor:pointer}
.mi:hover,.mi.hot{background:var(--accent);color:var(--on-accent)}
.mi:hover .kbd2,.mi.hot .kbd2,.mi.hot .desc{color:var(--on-accent)}
.mi .kbd2{margin-left:auto;font-size:12.5px;color:var(--muted);padding-left:18px;white-space:nowrap}
.mi .desc{display:block;font-size:12.5px;color:var(--muted)}
.mi[aria-disabled=true]{color:var(--muted);cursor:default}
.mi[aria-disabled=true]:hover{background:transparent;color:var(--muted)}
.mi.danger{color:var(--danger)}
.mi .ck{width:16px;flex-shrink:0;display:inline-flex}
.mhead{font-size:12px;font-weight:600;color:var(--muted);padding:7px 10px 3px}
.msep{height:1px;background:var(--line);margin:5px 6px}
.tip{background:var(--tip);color:var(--on-tip);border-radius:7px;padding:5px 9px;font-size:13px;display:inline-flex;align-items:center;gap:8px;box-shadow:var(--shadow-sm);white-space:nowrap}
.tip .k{opacity:0.78}
.row{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 10px;border-radius:8px}
.row:hover{background:var(--hover)}
.row.sel{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
.tile-sel{background:var(--accent-soft)!important;box-shadow:inset 0 0 0 2px var(--accent)!important}
.sw-sel{box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--accent)!important}
.cell-sel{box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--ink)!important}
.btn.danger-ghost{background:transparent;border-color:var(--danger);color:var(--danger)}
.btn.danger-ghost:hover{background:var(--danger-soft)}
.th input[type=radio]:disabled{opacity:0.45;cursor:default}
.th label:has(input:disabled){cursor:default;background:var(--surface-2)}
.th.dark .glyph{filter:drop-shadow(0 0 1px #EFE8DA) drop-shadow(0 0 1px #EFE8DA)}
.sec{font-size:12px;font-weight:600;color:var(--muted);padding:10px 10px 4px;letter-spacing:0.01em;font-family:inherit;display:block}
.count{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.badge{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:11px;font-size:12px;font-weight:600;background:var(--accent-soft);color:var(--accent-ink);white-space:nowrap}
.tag{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:6px;font-size:13px;background:var(--surface-2);color:var(--ink-2)}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 11px;border-radius:15px;border:1px solid var(--line-strong);background:var(--surface);font:inherit;font-size:13px;color:var(--ink-2);cursor:pointer}
.chip.on,.chip[aria-pressed=true],.chip[aria-checked=true],.chip[aria-selected=true]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.token{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 3px 0 10px;border-radius:15px;border:1px solid var(--line-strong);background:var(--surface-2);font:inherit;font-size:13px;color:var(--ink)}
.token button{border:0;background:transparent;color:var(--muted);width:24px;height:24px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.bar>i{display:block;height:6px;background:var(--accent);border-radius:3px}
.panel{display:flex;flex-direction:column;overflow:hidden}
.phead{display:flex;align-items:center;gap:6px;padding:12px 10px 8px 16px}
.ptitle{font-family:'Literata','Noto Serif','Noto Sans SC',Georgia,serif;font-weight:600;font-size:18px;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbody{padding:0 8px 10px;display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1 1 auto;min-height:0}
.pfoot{border-top:1px solid var(--line);padding:10px 12px 12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.scroll{overflow-y:auto;scrollbar-width:thin}
.scrim{position:absolute;inset:0;background:var(--scrim)}
.dialog{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);display:flex;flex-direction:column}
.dhead{padding:20px 22px 6px;display:flex;align-items:flex-start;gap:12px}
.dtitle{font-family:'Literata','Noto Serif','Noto Sans SC',Georgia,serif;font-weight:600;font-size:20px;line-height:1.25;flex:1 1 auto}
.dbody{padding:6px 22px 18px;display:flex;flex-direction:column;gap:14px;font-size:14.5px;line-height:1.45;color:var(--ink-2)}
.dfoot{padding:14px 22px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center}
.dfoot>.btn.ghost:first-child,.dfoot>.btn.link:first-child{margin-left:-13px}
.notice{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;font-size:14px}
.notice.info{background:var(--surface-2);border:1px solid var(--line)}
.notice.warn{background:var(--warn-soft);border:1px solid var(--warn-line);color:var(--ink)}
.notice.warn>.ic{color:var(--warn)}
.notice.err{background:var(--danger-soft);border:1px solid var(--danger);color:var(--ink)}
.notice.err>.ic{color:var(--danger)}
.toast{background:var(--tip);color:var(--on-tip);border-radius:11px;padding:10px 12px 10px 14px;display:flex;align-items:center;gap:12px;font-size:14px;box-shadow:var(--shadow)}
.toast .btn.link{color:var(--on-tip);text-decoration:underline}
.map{position:absolute;inset:0;overflow:hidden;background:#26331C}
.map img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
.mtag{position:absolute;transform:translate(-50%,-50%);background:rgba(251,248,242,0.95);color:#27231D;border-radius:6px;padding:2px 7px;font-size:13px;font-weight:600;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.35);font-variant-numeric:tabular-nums}
.mtag.live{background:#27231D;color:#FBF3E4}
.mname{position:absolute;transform:translate(-50%,-50%);color:#FFF6DF;font-size:14px;font-weight:600;white-space:nowrap;text-shadow:0 0 2px #1A160F,0 0 3px #1A160F,0 1px 3px #1A160F}
.attrib{margin-bottom:4px;font-size:12px;color:var(--ink-2);background:var(--glass);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.sp-name{display:flex;flex-direction:column;min-width:0;line-height:1.2}
.sp-name b{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-name i{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.code{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ink-2);width:44px;text-align:right;flex-shrink:0}
.glyph{width:22px;height:22px;flex-shrink:0;--ko:var(--surface)}
.th mark{background:rgba(214,170,40,0.38);color:inherit;border-radius:2px;padding:0 1px}
.th.dark mark{background:rgba(232,199,102,0.30)}
.swatch{width:22px;height:22px;border-radius:6px;border:1px solid var(--line-strong);flex-shrink:0}
"""


# Raster ramps: the stops `colorize()` paints in the pinned cog-tiler-wasm (as desktop/web/src/app/lidar/display-legend.ts
# keeps them), so a board's swatch and legend show the colours the map draws. Every ramp has one end that nearly vanishes
# into a panel, so swatches and legends get a --line-strong edge. Blue is water's alone: 'blues' and 'ice' serve water
# kinds only (2.1 hydrology); differences use 'puor' (purple to orange).
RAMPS = {
    'schwarzwald': ['#aeefd5', '#b0f2cd', '#b1f4c1', '#b2f6b5', '#bbf7b2', '#c8f9b2', '#d8fab2', '#eafcb2',
                    '#f7fcb2', '#eff4a3', '#cfe888', '#b2dc72', '#8dce5b', '#68c047', '#48b437', '#29a62c',
                    '#17992f', '#0c8b37', '#0b823f', '#2c853d', '#448c3b', '#619436', '#7b9b31', '#8da02d',
                    '#a4a627', '#beae21', '#d3b21a', '#ebb50f', '#f6ad04', '#ec9802', '#de7c02', '#d36402',
                    '#c44f02', '#b53b02', '#a82902', '#9a1b01', '#8d0e01', '#810500', '#790a01', '#751102',
                    '#741504', '#721905', '#711d06', '#6f2108', '#6e2509', '#6c290a', '#6b2d0c', '#6b310f',
                    '#723b19', '#784625', '#805133', '#885d42', '#906953', '#967561', '#9d8475', '#a3938c',
                    '#a7a19d', '#adacac', '#b5b4b5', '#bdbcbd', '#c6c5c6', '#cecdce', '#d7d5d7', '#dfdddf', '#e9e7e9'],
    'turbid': ['#e8f5ab', '#e0e395', '#d8d17f', '#d0bf6a', '#c9ad59', '#c19c4b', '#b88c42', '#ac7e3e', '#a0713c',
               '#93643a', '#835a38', '#735036', '#634633', '#533c2e', '#423228', '#322821', '#221e1b'],
    'gray': ['#000000', '#202020', '#404040', '#606060', '#808080', '#9f9f9f', '#bfbfbf', '#dfdfdf', '#ffffff'],
    'greens': ['#f7fcf5', '#e3f4de', '#c5e7be', '#9fd79b', '#72c378', '#42aa5d', '#218b44', '#026c2c', '#00441b'],
    'magma': ['#000003', '#0a0721', '#1d0f46', '#350f69', '#50127b', '#691b7e', '#822581', '#9c2e7e', '#b53679',
              '#ce426e', '#e45163', '#f3695d', '#fa8762', '#fda572', '#fec287', '#fcdfa3', '#fbfcbf'],
    'ylorrd': ['#ffffcc', '#ffeba1', '#fed775', '#fdb24d', '#fc8b3b', '#fa4e2a', '#e11b1d', '#bc0126', '#800026'],
    'puor': ['#7f3b08', '#be6209', '#ee9c3b', '#fdd4a0', '#f6f6f5', '#cecee4', '#998ebf', '#5f3b90', '#2d004b'],
    'blues': ['#f7fbff', '#deebf7', '#c5daef', '#9cc8e1', '#6caed5', '#4390c5', '#2271b3', '#09519b', '#08306b'],
    'ice': ['#030512', '#11122a', '#1f1f41', '#2d2c59', '#363874', '#3c468d', '#3e56a2', '#3f68ae', '#437ab7',
            '#4a8bbd', '#599cc3', '#67adca', '#7abed0', '#92ced8', '#afdde2', '#cdecee', '#eafcfd'],
}
RAMP_NAMES = {'schwarzwald': 'Terrain', 'turbid': 'Earth', 'gray': 'Gray', 'greens': 'Greens', 'magma': 'Magma',
              'ylorrd': 'Yellow–red', 'puor': 'Purple–orange', 'blues': 'Blues', 'ice': 'Ice'}
# The ramps each kind offers, its default first.
KIND_RAMPS = {'elevation': ['schwarzwald', 'turbid', 'gray'], 'height': ['greens', 'magma', 'gray'],
              'slope': ['ylorrd', 'magma', 'gray'], 'other': ['magma', 'ylorrd', 'gray'], 'water': ['blues', 'ice', 'gray']}
WATER = '#3E8CC0'
# Map overlays are theme-independent (they sit on imagery): the pinned-point dot (ink core, white ring), the drawn line
# (light line on a dark casing, as the draft and Measure tokens), and the online contour lines.
MAPINK = {'ink': '#27231D', 'ring': '#FFFFFF', 'line': '#FFF3D6', 'casing': 'rgba(20,16,10,0.6)', 'contour': '#FFF3D6'}


def ramp(name, angle=90, reversed=False):
    stops = RAMPS[name][::-1] if reversed else RAMPS[name]
    return f'linear-gradient({angle}deg, {", ".join(stops)})'


def css():
    return CSS.replace('%LIGHT%', _vars(LIGHT)).replace('%DARK%', _vars(DARK))


def esc(s):
    return _html.escape(str(s), quote=True)


def _dot(x, y, r=1.35):
    return f'M{x + r} {y}a{r} {r} 0 1 1-{2 * r} 0 {r} {r} 0 0 1 {2 * r} 0z'


# 20 x 20 icons; entries starting with '*' are filled shapes.
IC = {
    'select': 'M5 3l10.5 6.6-4.7 1.3-2.1 4.6z',
    'hand': 'M7 11V5.2a1.3 1.3 0 0 1 2.6 0V10M9.6 9.6V4a1.3 1.3 0 0 1 2.6 0v5.6M12.2 9.6V5.4a1.3 1.3 0 0 1 2.6 0V12c0 3.6-2.3 6-5.6 6-2.6 0-3.8-1.2-4.8-3.2L3 11.6a1.3 1.3 0 0 1 2.2-1.3L7 12.4',
    'plant': 'M10 17.5v-7M10 10.5C10 7 7.7 5 4 5c0 3.5 2.3 5.5 6 5.5zM10 10.5c0-3.5 2.3-5.5 6-5.5 0 3.5-2.3 5.5-6 5.5z',
    'row': 'M2.5 16.5h15M4 16.5l1.5-1.5M4 16.5l1.5 1.5M16 16.5l-1.5-1.5M16 16.5l-1.5 1.5M5 11V8M5 8c0-1.7 1-2.8 2.6-2.8 0 1.7-1 2.8-2.6 2.8zM10 11V8M10 8c0-1.7 1-2.8 2.6-2.8 0 1.7-1 2.8-2.6 2.8zM15 11V8M15 8c0-1.7 1-2.8 2.6-2.8 0 1.7-1 2.8-2.6 2.8z',
    'polygon': 'M4 7l6-4 6 4.5-2.2 8H6.2z',
    'rect': 'M3.5 5.5h13v9h-13z',
    'ellipse': 'M17 10c0 3-3.1 5.5-7 5.5S3 13 3 10s3.1-5.5 7-5.5S17 7 17 10z',
    'line': 'M4 16L16 4',
    'text': 'M4.5 6V4.5h11V6M10 4.5v11M7.5 15.5h5',
    'measure': 'M3 13.5L13.5 3l3.5 3.5L6.5 17zM6.5 10l1.6 1.6M9 7.5l1.6 1.6M11.5 5l1.6 1.6',
    'stamp': 'M8 3.5h4v4l3.5 1.2V11h-11V8.7L8 7.5zM3.5 13.5h13v2.5h-13z',
    'undo': 'M7.5 12L3.5 8l4-4M3.5 8h8.5a4.5 4.5 0 0 1 0 9H9',
    'redo': 'M12.5 12l4-4-4-4M16.5 8H8a4.5 4.5 0 0 0 0 9h3',
    'layers': 'M10 3l7.5 4-7.5 4-7.5-4zM2.5 11l7.5 4 7.5-4',
    'plants': 'M5.5 16.5v-3M5.5 13.5c-2 0-3.2-1.3-3.2-3S3.6 7.3 5.5 7.3s3.2 1.4 3.2 3.2-1.2 3-3.2 3zM11 7.5h6.5M11 11h6.5M11 14.5h4.5',
    'catalog': 'M8.5 14.5a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17.5 17.5l-4.8-4.8M8.5 12V8.4M8.5 8.4c0-2 1.3-3.3 3.3-3.4 0 2-1.3 3.3-3.3 3.4zM8.5 10c-.1-1.5-1-2.4-2.6-2.4 0 1.5.9 2.4 2.6 2.4z',
    'calendar': 'M4 5.5h12v11H4zM4 9h12M7.5 3.5v3M12.5 3.5v3',
    'budget': 'M10 7.5c3.6 0 6.5-1 6.5-2.3S13.6 3 10 3 3.5 4 3.5 5.2 6.4 7.5 10 7.5zM3.5 5.2v3.5c0 1.3 2.9 2.3 6.5 2.3s6.5-1 6.5-2.3V5.2M3.5 8.7v3.5c0 1.3 2.9 2.3 6.5 2.3s6.5-1 6.5-2.3V8.7M3.5 12.2v3.3c0 1.3 2.9 2.3 6.5 2.3s6.5-1 6.5-2.3v-3.3',
    'consortium': 'M2.5 17h15M5 17v-2.5M5 14.5c-1.2 0-2-.8-2-1.8s.8-1.9 2-1.9 2 .9 2 1.9-.8 1.8-2 1.8zM10 17v-4M10 13c-1.6 0-2.6-1.1-2.6-2.5S8.4 7.9 10 7.9s2.6 1.2 2.6 2.6S11.6 13 10 13zM15 17V11.5M15 11.5c-1.9 0-3.1-1.3-3.1-3S13.1 5.3 15 5.3s3.1 1.4 3.1 3.2-1.2 3-3.1 3z',
    'notebook': 'M6 3h9.5v14H6zM6 3c-.8 0-1.5.7-1.5 1.5v11c0 .8.7 1.5 1.5 1.5M3.5 6h2M3.5 9h2M3.5 12h2M9 7h4M9 10h4',
    'star': 'M10 3l2.1 4.4 4.8.6-3.5 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.1 8l4.8-.6z',
    'search': 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.8-3.8',
    'close': 'M5 5l10 10M15 5L5 15',
    'chev-r': 'M8 5l5 5-5 5', 'chev-l': 'M12 5l-5 5 5 5', 'chev-d': 'M5 8l5 5 5-5', 'chev-u': 'M5 12l5-5 5 5',
    'more': '*' + _dot(5, 10) + _dot(10, 10) + _dot(15, 10),
    'dots-v': '*' + _dot(10, 5) + _dot(10, 10) + _dot(10, 15),
    'grip': '*' + _dot(7.5, 5, 1.2) + _dot(12.5, 5, 1.2) + _dot(7.5, 10, 1.2) + _dot(12.5, 10, 1.2) + _dot(7.5, 15, 1.2) + _dot(12.5, 15, 1.2),
    'menu': 'M3.5 5.5h13M3.5 10h13M3.5 14.5h13',
    'eye': 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10zM10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z',
    'eye-off': 'M3 3l14 14M8.3 4.8A7.6 7.6 0 0 1 10 4.5c5 0 8 5.5 8 5.5a13 13 0 0 1-2.5 3.1M5.2 6.3A12.6 12.6 0 0 0 2 10s3 5.5 8 5.5c1.3 0 2.5-.4 3.5-.9',
    'lock': 'M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 5 0V9',
    'unlock': 'M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 4.8-1',
    'plus': 'M10 4v12M4 10h12', 'minus': 'M4 10h12',
    'fit': 'M3.5 7v-3.5H7M16.5 7V3.5H13M3.5 13v3.5H7M16.5 13v3.5H13M7.5 8.5h5v3h-5z',
    'expand': 'M12 3.5h4.5V8M16.5 3.5L11.5 8.5M8 16.5H3.5V12M3.5 16.5l5-5',
    'check': 'M4 10.5l4 4 8-9',
    'alert': 'M10 3.5l7.5 13h-15zM10 8.5v3.5M10 14.5h.01',
    'info': 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM10 9v5M10 6.5h.01',
    'trash': 'M4 6h12M8 6V4.5h4V6M6 6l.8 10.5h6.4L14 6',
    'copy': 'M7 7h9v9H7zM13 7V4H4v9h3',
    'rotate': 'M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.5v3.3h-3.3',
    'import': 'M10 3.5v9M6.5 9l3.5 3.5L13.5 9M4 13.5v3h12v-3',
    'export': 'M10 12.5v-9M6.5 7L10 3.5 13.5 7M4 13.5v3h12v-3',
    'file': 'M5 2.5h6.5L15 6v11.5H5zM11.5 2.5V6H15',
    'folder': 'M2.5 5.5h5l1.5 1.5h8.5v9h-15z',
    'folder-open': 'M2.5 15.5v-10h5L9 7h6.5v2M2.5 15.5l2.5-6.5h13l-2.5 6.5z',
    'gear': 'M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM8.6 2.6h2.8l.4 2 1.7 1 1.9-.7 1.4 2.4-1.5 1.4v2l1.5 1.4-1.4 2.4-1.9-.7-1.7 1-.4 2H8.6l-.4-2-1.7-1-1.9.7-1.4-2.4 1.5-1.4v-2L3.2 7.3l1.4-2.4 1.9.7 1.7-1z',
    'help': 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM7.8 7.8a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 2-2.2 3.3M10 14.4h.01',
    'moon': 'M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2z',
    'sun': 'M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1',
    'grid': 'M3.5 3.5h13v13h-13zM3.5 8h13M3.5 12h13M8 3.5v13M12 3.5v13',
    'magnet': 'M5 3.5v6.5a5 5 0 0 0 10 0V3.5h-3.2V10a1.8 1.8 0 0 1-3.6 0V3.5zM5 6.5h3.2M11.8 6.5H15',
    'globe': 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM3 10h14M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17c-2-2-2.8-4.4-2.8-7S8 5 10 3z',
    'pin': 'M10 17.5s-5.5-5-5.5-9A5.5 5.5 0 0 1 15.5 8.5c0 4-5.5 9-5.5 9zM10 10.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
    'cloud-off': 'M3 3l14 14M7 6.3A4.5 4.5 0 0 1 14.3 9a3.2 3.2 0 0 1 2.4 4.2M14 15.5H6a3.5 3.5 0 0 1-.6-7',
    'key': 'M12.5 10a3.5 3.5 0 1 0-3.3-4.7L3 11.5V15h3v-2h2v-2h1.5z',
    'filter': 'M3.5 4.5h13l-5 6v5l-3 1.5v-6.5z',
    'sort': 'M6 4v12M3.5 13.5L6 16l2.5-2.5M14 16V4M11.5 6.5L14 4l2.5 2.5',
    'edit': 'M13.5 3.5l3 3-9 9h-3v-3z',
    'bug': 'M7 7.5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM7 10H3.5M16.5 10H13M7.3 14l-2.8 2M12.7 14l2.8 2M7.3 6.5L5 4.5M12.7 6.5L15 4.5M10 9v6',
    'keyboard': 'M2.5 5.5h15v9h-15zM5.5 8.5h.01M8.5 8.5h.01M11.5 8.5h.01M14.5 8.5h.01M6.5 11.5h7',
    'target': 'M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM10 3.5V6M10 14v2.5M3.5 10H6M14 10h2.5',
    'terrain': 'M2.5 16l5-8 3 4.5 2-3 5 6.5z',
    'draft': 'M5 2.5h6.5L15 6v11.5H5zM11.5 2.5V6H15M7.5 10.5h5M7.5 13.5h3',
    'clock': 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM10 6v4l2.5 2.5',
    'image': 'M3 4.5h14v11H3zM3 13l4-4 3 3 2.5-2.5L17 14M13 8h.01',
    'wand': 'M3.5 16.5l9-9M11 4l.8 1.7L13.5 6.5l-1.7.8L11 9l-.8-1.7L8.5 6.5l1.7-.8zM15.5 9.5l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z',
    'desktop': 'M2.5 4h15v10h-15zM7 17h6M10 14v3',
    'download': 'M10 3.5v9M6.5 9l3.5 3.5L13.5 9M4 16.5h12',
    'story': 'M3 4.5h6c.6 0 1 .4 1 1v11c0-.6-.4-1-1-1H3zM17 4.5h-6c-.6 0-1 .4-1 1v11c0-.6.4-1 1-1h6zM5 8h3M5 11h3M12 8h3',
    'play': 'M6.5 4.5l9 5.5-9 5.5z',
    'camera': 'M3 6.5h3l1.5-2h5l1.5 2h3v9H3zM10 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'compass': 'M18.2 10a8.2 8.2 0 1 1-16.4 0 8.2 8.2 0 0 1 16.4 0zM10 3.6L12.6 10H7.4zM7.4 10h5.2L10 16.4z',
    'contours': 'M2.5 14.5c2.5-2.6 4.6-.4 7-2.4s4.3-1.7 8-3.6M2.5 10.5c2.5-2.6 4.6-.4 7-2.4s4.3-1.7 8-3.6M2.5 18c2.5-2.6 4.6-.4 7-2.4s4.3-1.7 8-3.6',
    'hillshade': 'M2.5 16l5-8 3 4.5 2-3 5 6.5zM7.5 8l-1 8M12.5 9.5L12 16',
    'sitedata': 'M10 2.8c4.3 0 7.4 2.9 7.2 7.1-.2 4.1-3.6 7.3-7.6 7.3S2.6 14.4 2.8 10.3C3 6 5.8 2.8 10 2.8zM10.2 6c2.4 0 4.2 1.7 4 4.1-.1 2.3-2 3.9-4.3 3.9S5.8 12.4 6 10.1C6.1 7.7 7.8 6 10.2 6zM10.3 8.9c.8 0 1.3.5 1.3 1.2s-.6 1.3-1.4 1.3-1.3-.6-1.2-1.3c0-.7.6-1.2 1.3-1.2z',
    'profile': 'M2.5 16.5h15M2.5 13.5l3.5-4.5 3 2.5 3.5-6.5 5 6',
    'library': 'M3.5 3.5h3v13h-3zM7.5 3.5h3v13h-3zM11.6 4.6l2.9-.8 3.1 12-2.9.8z',
}


def icon(name, cls='', extra=''):
    d = IC[name]
    if d.startswith('*'):
        return f'<svg class="ic {cls}" viewBox="0 0 20 20" aria-hidden="true"{extra}><path class="f" d="{d[1:]}"></path></svg>'
    return f'<svg class="ic {cls}" viewBox="0 0 20 20" aria-hidden="true"{extra}><path d="{d}"></path></svg>'


def btn(label, kind='', ic=None, size='', extra='', icon_right=None, aria=''):
    cls = ' '.join(x for x in ['btn', kind, size] if x)
    a = f' aria-label="{esc(aria)}"' if aria else ''
    inner = (icon(ic, 's18') if ic else '') + esc(label) + (icon(icon_right, 's16') if icon_right else '')
    return f'<button type="button" class="{cls}"{a}{extra}>{inner}</button>'


def ib(ic, label, on=False, size='', extra='', cls=''):
    c = ' '.join(x for x in ['ib', 'on' if on else '', size, cls] if x)
    return f'<button type="button" class="{c}" aria-label="{esc(label)}"{extra}>{icon(ic)}</button>'


def kbd(k):
    return f'<span class="kbd">{esc(k)}</span>'


def seg(options, active, label='Options'):
    items = ''.join(f'<button type="button" role="radio" class="seg{" on" if o == active else ""}" aria-checked="{"true" if o == active else "false"}">{esc(o)}</button>' for o in options)
    return f'<div class="segs" role="radiogroup" aria-label="{esc(label)}">{items}</div>'


def field(label, control, hint='', err=False):
    h = ''
    if hint:
        h = (f'<span class="hint err">{icon("alert", "s16")}{esc(hint)}</span>' if err else f'<span class="hint">{esc(hint)}</span>')
    return f'<label class="field"><span class="lbl">{esc(label)}</span>{control}{h}</label>'


def textin(value='', placeholder='', ic=None, focus=False, err=False, trail='', aria='', touch=False):
    c = 'input' + (' focus' if focus else '') + (' err' if err else '') + (' touch' if touch else '')
    a = f' aria-label="{esc(aria)}"' if aria else ''
    inv = ' aria-invalid="true"' if err else ''
    return (f'<span class="{c}">{icon(ic, "s16") if ic else ""}'
            f'<input type="text" value="{esc(value)}" placeholder="{esc(placeholder)}"{a}{inv}>{trail}</span>')


def search(placeholder, value='', aria='', trail='', focus=False, touch=False):
    c = 'input' + (' focus' if focus else '') + (' touch' if touch else '')
    return (f'<span class="{c}">{icon("search", "s16")}<input type="search" value="{esc(value)}" placeholder="{esc(placeholder)}" '
            f'aria-label="{esc(aria or placeholder)}">{trail}</span>')


def check(label, on=False):
    v = 'true' if on else 'false'
    return f'<label class="chk"><input type="checkbox" checked="{{{{ {v} }}}}">{esc(label)}</label>'


def radio(label, on=False, name='r', trail=''):
    v = 'true' if on else 'false'
    return f'<label class="row" style="min-height: 34px; gap: 10px; cursor: pointer;"><input type="radio" name="{name}" checked="{{{{ {v} }}}}"><span style="flex: 1 1 auto;">{esc(label)}</span>{trail}</label>'


def switch_row(label, on=False, hint=''):
    h = f'<span class="hint">{esc(hint)}</span>' if hint else ''
    v = 'true' if on else 'false'
    return (f'<label class="sw-row"><span style="display: flex; flex-direction: column; gap: 2px;">{esc(label)}{h}</span>'
            f'<input type="checkbox" role="switch" checked="{{{{ {v} }}}}" style="position: absolute; right: 0; opacity: 0; width: 34px; height: 20px; margin: 0;">'
            f'<span class="switch{" on" if on else ""}" aria-hidden="true"></span></label>')


def dropdown(value, label):
    i = uid('dd')
    return (f'<button type="button" class="dropdown" aria-haspopup="listbox" aria-labelledby="{i}l {i}v"><span class="sr" id="{i}l">{esc(label)}</span>'
            f'<span id="{i}v">{esc(value)}</span>{icon("chev-d", "s16")}</button>')


def slider(label, value, unit='', lo=0, hi=100):
    return (f'<label class="field"><span class="lbl" style="display: flex; justify-content: space-between;">{esc(label)}'
            f'<span class="num" style="font-weight: 400; color: var(--muted);">{esc(value)}{esc(unit)}</span></span>'
            f'<input type="range" min="{lo}" max="{hi}" value="{value}" aria-label="{esc(label)}"></label>')


def menu(items, width=260, extra='', label='Commands'):
    """items: (label, shortcut, flags) | '-' | ('#', heading).
    flags: hot dis danger sub chk nochk ic:<name> desc:<text_with_underscores>. A check column is reserved when any item is checkable."""
    checkable = any(isinstance(it, tuple) and len(it) > 2 and any(f in it[2].split() for f in ('chk', 'nochk')) for it in items)
    out = []
    for it in items:
        if it == '-':
            out.append('<div class="msep" role="separator"></div>')
        elif it[0] == '#':
            out.append(f'<div class="mhead" role="presentation">{esc(it[1])}</div>')
        else:
            label_, k = it[0], it[1] if len(it) > 1 else ''
            fl = (it[2] if len(it) > 2 else '').split()
            cls = 'mi' + (' hot' if 'hot' in fl else '') + (' danger' if 'danger' in fl else '')
            role = 'menuitemcheckbox' if ('chk' in fl or 'nochk' in fl) else 'menuitem'
            attrs = f' role="{role}"'
            if role == 'menuitemcheckbox':
                attrs += f' aria-checked="{"true" if "chk" in fl else "false"}"'
            if 'dis' in fl:
                attrs += ' aria-disabled="true"'
            if 'sub' in fl:
                attrs += f' aria-haspopup="menu" aria-expanded="{"true" if "hot" in fl else "false"}"'
            ic = ''.join(icon(f[3:], 's18') for f in fl if f.startswith('ic:'))
            desc = next((f[5:].replace('_', ' ') for f in fl if f.startswith('desc:')), '')
            ck = (f'<span class="ck">{icon("check", "s16") if "chk" in fl else ""}</span>') if checkable else ''
            lab = f'<span style="flex: 1 1 auto;">{esc(label_)}{f"<span class=desc>{esc(desc)}</span>" if desc else ""}</span>'
            sub = icon('chev-r', 's16') if 'sub' in fl else ''
            out.append(f'<button type="button" class="{cls}"{attrs}>{ck}{ic}{lab}<span class="kbd2">{esc(k)}</span>{sub}</button>')
    return f'<div class="menu" role="menu" aria-label="{esc(label)}" style="min-width: {width}px;{extra}">{"".join(out)}</div>'


def tip(text, k=''):
    kk = f'<span class="k">{esc(k)}</span>' if k else ''
    return f'<span class="tip" role="tooltip">{esc(text)}{kk}</span>'


def notice(kind, text, ic='info', action=''):
    role = ' role="alert"' if kind == 'err' else (' role="status"' if kind == 'warn' else '')
    return f'<div class="notice {kind}"{role}>{icon(ic, "s18")}<span style="flex: 1 1 auto;">{text}</span>{action}</div>'


def toast(text, action='Undo', ic='check'):
    a = btn(action, 'link', size='sm') if action else ''
    return f'<div class="toast" role="status">{icon(ic, "s18")}<span>{esc(text)}</span>{a}</div>'


def glyph(sym, colour, size=22):
    return f'<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" style="width: {size}px; height: {size}px; color: {colour};"><use href="#p-{sym}"></use></svg>'


def species_row(sym, colour, common, latin, code='', count='', sel=False, trail='', swatch=False, lead='', button=True, verb=''):
    """One species row everywhere: [lead][swatch] glyph · common over italic scientific · code · count · actions."""
    sw = f'<span class="swatch" style="background: {colour};" aria-hidden="true"></span>' if swatch else ''
    cd = f'<span class="code">{esc(code)}</span>' if code else '<span class="code" aria-hidden="true"></span>'
    ct = f'<span class="count" style="width: 40px; flex-shrink: 0; text-align: right;">{esc(count)}</span>' if count != '' else ''
    name = f'<span class="sp-name" style="flex: 1 1 auto;"><b>{esc(common)}</b><i lang="la">{esc(latin)}</i></span>'
    v = f'<span class="sr">{esc(verb)} </span>' if verb else ''
    body = f'{v}{glyph(sym, colour)}{name}{cd}{ct}'
    if button:
        body = (f'<button type="button" style="flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; padding: 0; min-height: 44px; cursor: pointer;"'
                f'{" aria-pressed=" + chr(34) + "true" + chr(34) if sel else ""}>{body}</button>')
    return f'<div class="row{" sel" if sel else ""}" style="min-height: 46px; gap: 8px; padding: 0 6px 0 8px;">{lead}{sw}{body}{trail}</div>'


def dialog(title, body, actions, width=460, close=True, extra='', max_h=None):
    """max_h: a height cap; the body then scrolls between the fixed head and foot."""
    i = uid('dlg')
    c = ib('close', 'Close', size='sm') if close else ''
    cap, scroll = (f' max-height: {max_h}px;', ' style="min-height: 0; overflow-y: auto;"') if max_h else ('', '')
    return (f'<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="{i}" style="width: {width}px;{cap}{extra}">'
            f'<div class="dhead"><h2 class="dtitle" id="{i}">{esc(title)}</h2>{c}</div>'
            f'<div class="dbody"{scroll}>{body}</div><div class="dfoot">{actions}</div></div>')


def sec(text, extra=''):
    return f'<h3 class="sec" style="{extra}">{text}</h3>'


LOGO = ('<svg viewBox="0 0 24 24" style="width: 24px; height: 24px; flex-shrink: 0;" aria-hidden="true">'
        '<circle cx="12" cy="12" r="10" fill="#5F7F35"></circle><path d="M12 5.5c-3.2 0-5.4 2.3-5.4 5 0 2.4 1.8 4.4 4.4 4.9V19h2v-3.6c2.6-.5 4.4-2.5 4.4-4.9 0-2.7-2.2-5-5.4-5z" fill="#F4E4B8"></path></svg>')


def save_status(status, kind):
    st_ic = {'ok': 'check', 'saving': 'clock', 'err': 'alert', 'draft': 'draft', 'web': 'check'}[kind]
    col = 'var(--danger)' if kind == 'err' else 'var(--muted)'
    role = 'alert' if kind == 'err' else 'status'
    return (f'<span role="{role}" style="display: flex; align-items: center; gap: 5px; font-size: 13px; color: {col}; white-space: nowrap;{" font-weight: 600;" if kind == "err" else ""}">'
            f'{icon(st_ic, "s16")}{esc(status)}</span>')


def topbar(name, status='Saved', status_kind='ok', web=False, search_value='', menus=('File', 'Edit', 'View', 'Tools', 'Help'), hot=None,
           show_search=True, search_label='Search a place or coordinates', search_key='Ctrl K', status_action=''):
    ms = ''.join(f'<button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="{"true" if m == hot else "false"}" class="btn ghost sm" style="font-weight: 400; font-size: 14px;{" background: var(--pressed); color: var(--ink);" if m == hot else " color: var(--ink);"}">{esc(m)}</button>' for m in menus)
    if status_kind == 'draft' and not status_action:
        status_action = btn('Save as…', '', size='sm')
    web_b = ib('folder-open', 'Open a .canopi file') if web else ''
    sw = 220 if web else 290
    srch = (f'<label class="input" style="width: {sw}px; height: 34px;">{icon("search", "s16")}<input type="search" placeholder="{esc(search_label)}" value="{esc(search_value)}" aria-label="{esc(search_label)}" aria-keyshortcuts="Control+K">{kbd(search_key)}</label>'
            if show_search else '')
    return f'''<header class="float" style="position: absolute; left: 12px; top: 10px; right: 12px; height: 50px; display: flex; align-items: center; gap: 10px; padding: 0 8px 0 12px;">
  {LOGO}<div role="menubar" aria-label="Menus" style="display: flex; gap: 0;">{ms}</div>
  <div class="vrule" style="margin: 12px 4px;"></div>
  <div style="display: flex; align-items: center; gap: 10px; min-width: 0;"><button type="button" class="btn ghost" aria-label="Rename Design: {esc(name)}" style="padding: 0 6px; height: 34px; min-width: 0; font-weight: 600;"><span class="disp" style="font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 440px; color: var(--ink);">{esc(name)}</span></button>{save_status(status, status_kind)}{status_action}</div>
  <div style="flex: 1 1 auto;"></div>{web_b}{srch}
  {ib("help", "Help and keyboard shortcuts (F1)")}{ib("gear", "Settings (Ctrl ,)")}
</header>'''


TOOLS = [('select', 'Select', 'V'), None,
         ('plant', 'Place plants', 'P'), ('row', 'Plant a row', 'W'), ('stamp', 'Place a stamp', 'K'), None,
         '#Zones', ('polygon', 'Polygon zone', 'Z'), ('rect', 'Rectangle zone', 'R'), ('ellipse', 'Ellipse zone', 'E'), ('line', 'Line zone', 'L'), None,
         ('text', 'Text note', 'T'), ('measure', 'Measure', 'M')]


def toolrail(active='select', labelled=False, top=72, disabled=False, names=None):
    names = names or {}
    out = []
    for t in TOOLS:
        if t is None:
            out.append('<div class="rule" style="margin: 3px 6px;" role="separator"></div>')
            continue
        if isinstance(t, str):
            if labelled:
                out.append(f'<span class="sec" style="padding: 4px 8px 2px;">{esc(names.get(t[1:], t[1:]))}</span>')
            continue
        ic, label, k = t
        label = names.get(label, label)
        on = ic == active
        dis = ' disabled' if disabled and not on else ''
        if labelled:
            out.append(f'<button type="button" class="btn ghost plain" aria-pressed="{"true" if on else "false"}" aria-keyshortcuts="{k}" style="justify-content: flex-start; height: 36px; padding: 0 8px; gap: 10px; font-weight: {600 if on else 400};{" background: var(--accent); color: var(--on-accent);" if on else " color: var(--ink);"}"{dis}>'
                       f'{icon(ic)}<span style="flex: 1 1 auto; text-align: left; white-space: nowrap;">{esc(label)}</span><span class="kbd" style="{"background: transparent; color: inherit; border-color: currentColor;" if on else ""}">{k}</span></button>')
        else:
            out.append(ib(ic, f'{label} ({k})', on=on, size='lg', extra=f' aria-pressed="{"true" if on else "false"}" aria-keyshortcuts="{k}"{dis}'))
    out.append('<div class="rule" style="margin: 3px 6px;" role="separator"></div>')
    for ic, label, k in [('undo', names.get('Undo', 'Undo'), 'Ctrl Z'), ('redo', names.get('Redo', 'Redo'), names.get('Ctrl Shift Z', 'Ctrl Shift Z'))]:
        out.append(ib(ic, f'{label} ({k})', size='lg') if not labelled else
                   f'<button type="button" class="btn ghost" style="justify-content: flex-start; height: 36px; padding: 0 8px; gap: 10px; font-weight: 400; color: var(--ink);">{icon(ic)}<span style="flex: 1 1 auto; text-align: left; white-space: nowrap;">{esc(label)}</span><span class="kbd">{esc(k)}</span></button>')
    w = 'max-content; min-width: 214px; max-width: 290px' if labelled else '52px'
    return f'<div class="float" role="toolbar" aria-label="Tools" aria-orientation="vertical" style="position: absolute; left: 12px; top: {top}px; width: {w}; padding: 5px; display: flex; flex-direction: column; gap: 2px;">{"".join(out)}</div>'


# The panel rail, in order; the key is its Ctrl digit ('' = none). Site data is Desktop only.
PANELS = [('layers', 'Layers', '1'), ('sitedata', 'Site data', '2'), ('plants', 'Plants in this Design', '3'), ('catalog', 'Plant catalog', '4'),
          ('star', 'Favorites and stamps', '5'), None, ('calendar', 'Calendar', '6'), ('budget', 'Budget', '7'), ('consortium', 'Consortium', '8'),
          ('notebook', 'Design notebook', '9'), ('story', 'Stories', '')]
DESKTOP_PANELS = {'sitedata'}


def panelrail(active=None, top=72, labelled=False, web=False):
    out = []
    for p in PANELS:
        if p is None:
            out.append('<div class="rule" style="margin: 3px 6px;" role="separator"></div>')
            continue
        ic, label, n = p
        if web and ic in DESKTOP_PANELS:
            continue
        on = ic == active
        if labelled:
            k = f'<span class="kbd">Ctrl {n}</span>' if n else ''
            out.append(f'<button type="button" class="btn ghost plain" aria-expanded="{"true" if on else "false"}" style="justify-content: flex-start; height: 36px; padding: 0 8px; gap: 10px; font-weight: {600 if on else 400};{" background: var(--accent); color: var(--on-accent);" if on else " color: var(--ink);"}">'
                       f'{icon(ic)}<span style="flex: 1 1 auto; text-align: left; white-space: nowrap;">{esc(label)}</span>{k}</button>')
        else:
            keys = f' aria-keyshortcuts="Control+{n}"' if n else ''
            out.append(ib(ic, f'{label} (Ctrl {n})' if n else label, on=on, size='lg', extra=f' aria-expanded="{"true" if on else "false"}"{keys}'))
    w = 'max-content; min-width: 250px' if labelled else '52px'
    return f'<nav class="float" aria-label="Panels" style="position: absolute; right: 12px; top: {top}px; width: {w}; padding: 5px; display: flex; flex-direction: column; gap: 2px;">{"".join(out)}</nav>'


def viewchip(grid=False, snap=True, bottom=12, names=('Grid', 'Snap to grid')):
    def t(label, on):
        return (f'<button type="button" class="btn ghost sm plain" aria-pressed="{"true" if on else "false"}" style="gap: 5px; font-weight: {600 if on else 400};{" color: var(--accent-ink); background: var(--accent-soft);" if on else " color: var(--ink);"}">'
                f'{icon("check", "s16") if on else ""}{esc(label)}</button>')
    return (f'<div class="float" role="group" aria-label="View" style="position: absolute; left: 12px; bottom: {bottom}px; height: 40px; display: flex; align-items: center; gap: 2px; padding: 0 5px; border-radius: 11px;">'
            f'{t(names[0], grid)}{t(names[1], snap)}</div>')


def compass_glyph(bearing=0):
    """The compass needle: north half filled, south half outlined, turned by the view's bearing so it points to true north."""
    return (f'<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle class="ring" cx="10" cy="10" r="8.2"></circle>'
            f'<g transform="rotate({-bearing:g} 10 10)"><path class="nn" d="M10 3.6L12.6 10H7.4z"></path><path class="ns" d="M7.4 10h5.2L10 16.4z"></path></g></svg>')


def compass(bearing=0, size='sm', extra='', cls=''):
    """Reset north: always visible, muted at north (still enabled: a drag turns the view), ochre north half when turned."""
    turned = bearing % 360 != 0
    desc = f'View turned {bearing:g}° from north' if turned else 'North is up'
    c = ' '.join(x for x in ['ib', size, 'compass', 'turned' if turned else '', cls] if x)
    return (f'<button type="button" class="{c}" aria-label="Reset north" aria-description="{esc(desc)}" aria-keyshortcuts="N Shift+N"{extra}>'
            f'{compass_glyph(bearing)}</button>')


def zoombar(scale='1:190', bar_label='5 m', bar_px=100, bottom=12, fit=True, attrib='© Google', bearing=0, show_compass=True):
    f = ib('fit', 'Fit to Design (Shift F)', size='sm') if fit else ''
    a = f'<span class="attrib">{esc(attrib)}</span>' if attrib else ''
    cp = f'<div class="vrule" style="margin: 9px 2px;"></div>{compass(bearing)}' if show_compass else ''
    return f'''<div style="position: absolute; right: 12px; bottom: {bottom}px; display: flex; align-items: flex-end; gap: 8px;">{a}<div class="float" role="group" aria-label="Zoom" style="height: 40px; display: flex; align-items: center; gap: 6px; padding: 0 5px 0 12px; border-radius: 11px;">
  <span role="img" aria-label="Scale bar: {esc(bar_label)}" style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 12px;" class="num">{esc(bar_label)}</span><span style="width: {bar_px}px; height: 5px; border: 1.5px solid var(--ink-2); border-top: 0;"></span></span>
  <div class="vrule" style="margin: 9px 2px;"></div>
  {ib("minus", "Zoom out (Ctrl −)", size="sm")}<button type="button" class="btn ghost sm num" style="min-width: 62px; font-weight: 600; color: var(--ink);" aria-haspopup="listbox" aria-label="Map scale {esc(scale)}. Choose a scale">{esc(scale)}</button>{ib("plus", "Zoom in (Ctrl +)", size="sm")}{f}{cp}
</div></div>'''


def attribution(text='© Google'):
    return ''  # attribution is drawn by zoombar(attrib=...) so it never collides with panels


def mapbg(src, dim=0.0):
    d = f'<div style="position: absolute; inset: 0; background: rgba(250,246,238,{dim});"></div>' if dim else ''
    return f'<div class="map"><img src="{src}" alt=""></div>{d}'


def panel(title, body, width=380, top=72, right=76, bottom=64, head_extra='', foot='', sub='', back=False, wide=False):
    i = uid('pt')
    w = 440 if wide else width
    bk = ib('chev-l', 'Back', size='sm') if back else ''
    sb = f'<p class="small muted" style="margin: -6px 16px 8px {50 if back else 16}px;">{sub}</p>' if sub else ''
    ft = f'<div class="pfoot">{foot}</div>' if foot else ''
    pos = f'right: {right}px; top: {top}px;' + (f' bottom: {bottom}px;' if bottom is not None else '')
    return (f'<aside class="float panel" aria-labelledby="{i}" style="position: absolute; {pos} width: {w}px;">'
            f'<div class="phead">{bk}<h2 class="ptitle" id="{i}">{esc(title)}</h2>{head_extra}{ib("close", "Close panel", size="sm")}</div>{sb}'
            f'<div class="pbody">{body}</div>{ft}</aside>')


def toolcard(title, lines, extra='', width=320, lead=''):
    """Tool hint card: top-left beside the rail. First line is the instruction, the rest are quiet key hints."""
    body = ''.join(f'<span class="small{" muted" if i else ""}">{l}</span>' for i, l in enumerate(lines))
    return (f'<div class="float" style="position: absolute; left: 76px; top: 72px; width: {width}px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; border-radius: 12px;">'
            f'<div style="display: flex; align-items: center; gap: 10px;">{lead}<b style="font-weight: 600; flex: 1 1 auto;">{title}</b></div>'
            f'<div role="status" style="display: flex; flex-direction: column; gap: 4px;">{body}</div>{extra}</div>')


def finder(value='', chips=(), count='', focus=False, placeholder='Find plants: name, scientific name or code', touch=False):
    """The one way to find plants in any list: typo- and accent-tolerant search on common, scientific and other-language names
    and codes, quick filters, and a live result count. Ctrl F focuses it in the open panel."""
    c = 'input' + (' focus' if focus else '') + (' touch' if touch else '')
    trail = (f'<button type="button" class="ib sm" aria-label="Clear search" style="width: 24px; height: 24px;">{icon("close", "s16")}</button>' if value else kbd('Ctrl F'))
    field_ = (f'<span class="{c}">{icon("search", "s16")}<input type="search" value="{esc(value)}" placeholder="{esc(placeholder)}" aria-label="Find plants" aria-keyshortcuts="Control+F">{trail}</span>')
    ch = ''
    for ch_ in chips:
        label, state = ch_[0], ch_[1]
        if state == 'menu':
            ch += f'<button type="button" class="chip" aria-haspopup="listbox">{esc(label)}{icon("chev-d", "s16")}</button>'
        else:
            on = state is True
            ch += f'<button type="button" class="chip" aria-pressed="{"true" if on else "false"}">{icon("check", "s16") if on else ""}{esc(label)}</button>'
    chips_html = f'<div role="group" aria-label="Quick filters" style="display: flex; flex-wrap: wrap; gap: 6px;">{ch}</div>' if ch else ''
    ct = f'<span role="status" class="small muted">{count}</span>' if count else ''
    return f'<div style="display: flex; flex-direction: column; gap: 8px;">{field_}{chips_html}{ct}</div>'


def mark(text, q):
    """Highlight the matched part of a name (case- and accent-insensitive for plain ASCII queries)."""
    import unicodedata
    def fold(t):
        return ''.join(ch for ch in unicodedata.normalize('NFD', t.lower()) if unicodedata.category(ch) != 'Mn')
    i = fold(text).find(fold(q)) if q else -1
    if i < 0:
        return esc(text)
    return esc(text[:i]) + '<mark>' + esc(text[i:i + len(q)]) + '</mark>' + esc(text[i + len(q):])
