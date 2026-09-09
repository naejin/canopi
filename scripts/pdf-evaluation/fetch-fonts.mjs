import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const fonts = JSON.parse(await readFile(new URL('./fonts.json', import.meta.url)));
const directory = new URL('./public/fonts/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const font of fonts) {
  const response = await fetch(font.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Font download failed: ${font.file}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== font.sha256) throw new Error(`Font checksum mismatch: ${font.file}`);
  await writeFile(new URL(font.file, directory), bytes);
  const license = await fetch(font.license, { signal: AbortSignal.timeout(30_000) });
  if (!license.ok) throw new Error(`Font license download failed: ${font.file}`);
  await writeFile(new URL(`${font.id}-LICENSE.txt`, directory), await license.text());
  console.log(JSON.stringify({ id: font.id, bytes: bytes.length, sha256 }));
}
