import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const root = new URL('./', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('dist/.vite/manifest.json', root)));
const fontManifest = JSON.parse(await readFile(new URL('fonts.json', root)));
const lock = JSON.parse(await readFile(new URL('package-lock.json', root)));
const previewFontModule = Object.keys(manifest).find(key => manifest[key].name === 'browser-module');

async function size(entries) {
  const keys = new Set();
  function visit(key) {
    if (keys.has(key)) return;
    keys.add(key);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  }
  for (const entry of entries) visit(entry);
  const files = [];
  for (const key of keys) {
    const file = manifest[key].file;
    const data = await readFile(new URL(`dist/${file}`, root));
    files.push({ file, rawBytes: data.length, gzipBytes: gzipSync(data).length });
  }
  return { files, rawBytes: files.reduce((n, f) => n + f.rawBytes, 0), gzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0) };
}

const fonts = [];
for (const font of fontManifest) {
  const data = await readFile(new URL(`public/fonts/${font.file}`, root));
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (sha256 !== font.sha256) throw new Error(`Font checksum mismatch: ${font.file}`);
  const license = await readFile(new URL(`public/fonts/${font.id}-LICENSE.txt`, root), 'utf8');
  if (!license.includes('SIL OPEN FONT LICENSE Version 1.1')) throw new Error(`Missing OFL: ${font.file}`);
  fonts.push({ ...font, rawBytes: data.length, gzipBytes: gzipSync(data).length });
}
const result = {
  node: process.version,
  packages: Object.fromEntries(['pdfkit', 'fontkit', 'pdf-lib', '@pdf-lib/fontkit', 'vite'].map(name => {
    const entry = lock.packages[`node_modules/${name}`];
    return [name, { version: entry.version, license: entry.license }];
  })),
  pdfkitEncoderAndPreview: await size(['pdfkit.mjs', previewFontModule]),
  pdfLibEncoder: await size(['pdf-lib.mjs']),
  pdfLibEncoderAndSharedPreview: await size(['pdf-lib.mjs', previewFontModule]),
  fonts,
};
await writeFile(new URL('output/assets.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
