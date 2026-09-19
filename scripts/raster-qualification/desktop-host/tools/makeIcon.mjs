/**
 * Generate the qualification host's application icon.
 *
 * Tauri's context macro requires an icon to exist at build time. The icon is a
 * generated build input, not an authored asset: this script writes a deterministic
 * 32x32 RGBA PNG so the host build has no dependency on production artwork.
 *
 * Usage: node tools/makeIcon.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 32;

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let bit = 0; bit < 8; bit += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < SIZE; x += 1) {
    const at = row + 1 + x * 4;
    // A flat ochre field with a darker border, matching the project accent token.
    const border = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
    raw[at] = border ? 0x6f : 0xa0;
    raw[at + 1] = border ? 0x47 : 0x6b;
    raw[at + 2] = border ? 0x14 : 0x1f;
    raw[at + 3] = 0xff;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../icons/icon.png');
writeFileSync(target, png);
process.stdout.write(`wrote ${target} (${png.length} bytes)\n`);
