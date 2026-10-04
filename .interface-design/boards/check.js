// Screenshot boards and run automated UI checks (contrast, text size, target size, names, clipping, overflow).
// Usage: node check.js [Board ...]      with the server from serve.py running on PORT (default 47213)
//   → out/shots/<Board>.png and a findings report on stdout; no argument checks every board in out/boards.json.
// Needs Playwright and a Chrome/Chromium binary: set PLAYWRIGHT_MODULE (a path to the playwright package) when it is not
// resolvable from here, and CHROME (a browser path) when Playwright's own Chromium is not installed.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'out');
const PORT = process.env.PORT || 47213;
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const AUDIT = () => {
  const out = { contrast: [], small: [], target: [], names: [], clipped: [], overflowRoot: [] };
  const root = document.querySelector('.th') || document.body;
  const rb = root.getBoundingClientRect();
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  // effective background: composite ancestor backgrounds; unknown when an image or map is behind
  const bgOf = (el) => {
    const layers = [];
    let n = el, overImage = false;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      const bg = parse(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient')) overImage = true;
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 0.99) break; }
      if (n.classList && n.classList.contains('map')) overImage = true;
      n = n.parentElement;
    }
    let c = { r: 255, g: 255, b: 255, a: 1 };
    const opaque = layers.length && layers[layers.length - 1].a >= 0.99;
    if (!opaque) overImage = overImage || true;
    for (let i = layers.length - 1; i >= 0; i--) c = blend(layers[i], c);
    return { c, unsure: !opaque && overImage && layers.reduce((s, l) => s + l.a, 0) < 0.85 };
  };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el) || el.closest('svg')) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fs = parseFloat(cs.fontSize);
    const txt = t.textContent.trim().slice(0, 40);
    if (fs < 12 && !el.closest('.maplabel,.print')) out.small.push(`${fs}px "${txt}"`);
    const fg = parse(cs.color);
    const { c: bg, unsure } = bgOf(el);
    if (!fg || unsure || el.closest('.maplabel')) continue;
    let o = 1, n = el;
    while (n && n.nodeType === 1) { o *= parseFloat(getComputedStyle(n).opacity); n = n.parentElement; }
    const f2 = blend({ ...fg, a: fg.a * o }, bg);
    const L1 = lum(f2), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 600);
    const need = el.closest('[disabled],.dis,[aria-disabled=true]') ? 0 : (large ? 3 : 4.5);
    if (ratio < need) out.contrast.push(`${ratio.toFixed(2)} "${txt}" ${fs}px`);
  }
  for (const el of root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=menuitem],[role=option],[role=switch]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (el.type === 'checkbox' || el.type === 'radio') {
      const lab = el.closest('label');
      if (!lab && !el.getAttribute('aria-label')) out.names.push(`checkbox without label`);
      continue;
    }
    if (el.style.opacity === '0') continue;
    const box = el.parentElement && el.parentElement.classList.contains('input') ? el.parentElement.getBoundingClientRect() : r;
    if ((box.width < 24 || box.height < 24) && box.width > 0) out.target.push(`${Math.round(box.width)}x${Math.round(box.height)} "${label(el)}"`);
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim();
    const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
    if (!name && !lab) out.names.push(`${el.tagName.toLowerCase()} without accessible name`);
    if (el.tagName === 'INPUT' && !lab && !el.getAttribute('aria-label')) out.names.push(`input "${el.placeholder}" relies on placeholder`);
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('svg') || el.closest('.map') || el.closest('.sr') || el.tagName === 'CAPTION') continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && (cs.overflow === 'hidden' || cs.overflowX === 'hidden') && cs.textOverflow !== 'ellipsis' && el.textContent.trim() && el.children.length === 0) out.clipped.push(`"${el.textContent.trim().slice(0, 40)}"`);
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > rb.right + 1 || r.bottom > rb.bottom + 1 || r.left < rb.left - 1 || r.top < rb.top - 1) && !el.closest('.bleed')) {
      let n = el.parentElement, clipped = false;
      while (n && n !== root) { const c = getComputedStyle(n); if (c.overflow !== 'visible') { clipped = true; break; } n = n.parentElement; }
      if (!clipped) out.overflowRoot.push(`${el.tagName.toLowerCase()}.${el.className && el.className.baseVal === undefined ? String(el.className).split(' ')[0] : ''} "${(el.textContent || '').trim().slice(0, 30)}"`);
    }
  }
  const uniq = (a) => [...new Set(a)];
  for (const k of Object.keys(out)) out[k] = uniq(out[k]).slice(0, 14);
  return out;
};

(async () => {
  const boards = JSON.parse(fs.readFileSync(path.join(OUT, 'boards.json'), 'utf8'));
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(boards);
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const launch = { args: ['--use-gl=swiftshader'] };
  if (process.env.CHROME) launch.executablePath = process.env.CHROME;
  const browser = await chromium.launch(launch);
  let failures = 0;
  for (const name of names) {
    if (!boards[name]) { console.log(`${name}: unknown board`); failures++; continue; }
    const { w, h } = boards[name];
    const page = await browser.newPage({ viewport: { width: w + 48, height: h + 48 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) errs.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/${name}.html`);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'shots', `${name}.png`), fullPage: true });
    if (errs.length) failures++;
    const r = await page.evaluate(AUDIT);
    const lines = Object.entries(r).filter(([, v]) => v.length).map(([k, v]) => `  ${k}: ${v.join(' · ')}`);
    console.log(`${name}: ${lines.length ? '' : 'clean'}${errs.length ? ' JS ERRORS ' + errs.join(' | ') : ''}`);
    for (const l of lines) console.log(l);
    await page.close();
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
