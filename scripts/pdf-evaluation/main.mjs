import fonts from './fonts.json';
import { createFixture } from './fixture.mjs';

const loaders = {
  pdfkit: () => import('./pdfkit.mjs'),
  'pdf-lib': () => import('./pdf-lib.mjs'),
  'pdf-lib-full': async () => { const { generate } = await import('./pdf-lib.mjs'); return { generate: (fixture, bytes) => generate(fixture, bytes, false) }; },
};
let current;
let ownedFonts = [];
const urls = new Set();
const timers = new Set();

function disposeFonts() {
  for (const face of ownedFonts) document.fonts.delete(face);
  ownedFonts = [];
}

async function loadFonts() {
  disposeFonts();
  const bytes = {};
  try {
    for (const font of fonts) {
      const response = await fetch(`./fonts/${font.file}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Cannot load ${font.file}: HTTP ${response.status}`);
      bytes[font.id] = new Uint8Array(await response.arrayBuffer());
      const face = await new FontFace(`Evaluation-${font.id}`, bytes[font.id]).load();
      document.fonts.add(face);
      ownedFonts.push(face);
    }
    return bytes;
  } catch (error) {
    disposeFonts();
    throw error;
  }
}

function preview(page, parsedFonts) {
  const canvas = document.createElement('canvas');
  const ratio = 96 / 72;
  canvas.width = Math.ceil(page.width * ratio);
  canvas.height = Math.ceil(page.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, page.width, page.height);
  for (const op of page.ops) {
    if (op.kind === 'text') {
      ctx.fillStyle = op.color;
      const font = parsedFonts[op.font];
      const run = font.layout(op.text);
      const factor = op.size / font.unitsPerEm;
      let x = op.x;
      for (let i = 0; i < run.glyphs.length; i++) {
        const position = run.positions[i];
        ctx.save();
        ctx.translate(x + position.xOffset * factor, op.y - position.yOffset * factor);
        ctx.scale(factor, -factor);
        ctx.fill(new Path2D(run.glyphs[i].path.toSVG()));
        ctx.restore();
        x += position.xAdvance * factor;
      }
    } else if (op.kind === 'clip') { ctx.save(); ctx.beginPath(); ctx.rect(op.x, op.y, op.w, op.h); ctx.clip(); }
    else if (op.kind === 'unclip') ctx.restore();
    else if (op.kind === 'rect') { ctx.strokeStyle = op.color; ctx.lineWidth = op.stroke; ctx.strokeRect(op.x, op.y, op.width, op.height); }
    else if (op.kind === 'line') { ctx.strokeStyle = op.color; ctx.lineWidth = op.width; ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2); ctx.stroke(); }
    else if (op.kind === 'marker') {
      const { x, y, radius: r } = op;
      ctx.fillStyle = op.color; ctx.beginPath();
      if (op.shape === 0) ctx.arc(x, y, r, 0, Math.PI * 2);
      else if (op.shape === 1) ctx.rect(x - r, y - r, 2 * r, 2 * r);
      else { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); }
      ctx.fill();
    }
  }
  return canvas;
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  try { link.click(); } finally {
    link.remove();
    // Retain through the dispatch task; page teardown also revokes owned URLs.
    const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); timers.delete(timer); }, 1000);
    timers.add(timer);
  }
}

async function run(candidate) {
  if (!Object.hasOwn(loaders, candidate)) throw new Error('Unknown PDF candidate');
  current = undefined;
  document.getElementById('download').disabled = true;
  const start = performance.now();
  const fontBytes = await loadFonts();
  const fontLoadMs = performance.now() - start;
  const { create } = await import('fontkit');
  const parsedFonts = Object.fromEntries(Object.entries(fontBytes).map(([id, bytes]) => [id, create(bytes)]));
  const ctx = document.createElement('canvas').getContext('2d');
  const fixture = createFixture((text, font, size) => parsedFonts[font].layout(text).advanceWidth / parsedFonts[font].unitsPerEm * size);
  const browserMeasurements = fixture.pages.flatMap(p => p.ops.filter(op => op.kind === 'text').map(op => {
    ctx.font = `${op.size}px "Evaluation-${op.font}"`;
    return { text: op.text, font: op.font, shapedWidth: op.previewWidth, browserWidth: ctx.measureText(op.text).width };
  }));
  const missing = [], fontFacts = [];
  for (const font of fonts) {
    const parsed = parsedFonts[font.id];
    const texts = fixture.pages.flatMap(p => p.ops.filter(op => op.kind === 'text' && op.font === font.id).map(op => op.text));
    for (const char of new Set(texts.join(''))) if (!parsed.hasGlyphForCodePoint(char.codePointAt(0))) missing.push({ font: font.id, char });
    fontFacts.push({ id: font.id, name: parsed.fullName, version: parsed.version, bytes: fontBytes[font.id].length, rejectsNoncharacter: !parsed.hasGlyphForCodePoint(0x10ffff) });
  }
  if (missing.length) throw new Error(`Missing glyphs: ${JSON.stringify(missing)}`);
  const previews = document.getElementById('previews');
  previews.replaceChildren(...fixture.pages.map(page => preview(page, parsedFonts)));
  const loadStart = performance.now();
  const { generate } = await loaders[candidate]();
  const importMs = performance.now() - loadStart;
  const samples = [];
  let result;
  for (let i = 0; i < (candidate === 'pdf-lib-full' ? 1 : 4); i++) {
    const heapBefore = performance.memory?.usedJSHeapSize ?? null;
    const generationStart = performance.now();
    result = await generate(fixture, fontBytes);
    samples.push({ generationMs: performance.now() - generationStart, bytes: result.blob.size, heapBefore, heapAfter: performance.memory?.usedJSHeapSize ?? null });
  }
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  const report = { candidate, runtime: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, fontLoadMs, importMs, samples, fontFacts, missing, sha256, measurements: result.measurements, browserMeasurements, fixture };
  current = { blob: result.blob, report };
  document.getElementById('download').disabled = false;
  return report;
}

document.getElementById('generate').addEventListener('click', async () => {
  const button = document.getElementById('generate');
  button.disabled = true;
  try {
    const report = await run(document.getElementById('candidate').value);
    document.getElementById('status').textContent = JSON.stringify({ candidate: report.candidate, samples: report.samples, missing: report.missing }, null, 2);
  } catch (error) { document.getElementById('status').textContent = String(error); }
  finally { button.disabled = false; }
});
document.getElementById('download').addEventListener('click', () => download(current.blob, `${current.report.candidate}.pdf`));
window.evaluation = { run, report: () => current?.report, bytes: () => current.blob.arrayBuffer(), downloadReport: () => download(new Blob([JSON.stringify(current.report, null, 2)], { type: 'application/json' }), `${current.report.candidate}.json`), activeUrls: () => urls.size };
window.addEventListener('pagehide', () => {
  disposeFonts();
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
});
