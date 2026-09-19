/**
 * Generate the pilot's raster fixture and prepare it with native GDAL.
 *
 * The plane is streamed from TypeScript — `z(column,row) = column - row` over
 * zero-based cell indices, with the sentinel `-9999` at (100,100) and (1024,1024) —
 * and written as an ENVI-ordered raw band plus a VRT that declares its geotransform,
 * EPSG:2154 and sentinel. GDAL then prepares an uncompressed 512-cell tiled COG with
 * no overviews. The analytic expectation lives in TypeScript and is independent of
 * anything the candidate decodes.
 *
 * This writes only into the run directory it is given; it never touches private
 * fixtures and never relabels prepared data as an original.
 *
 * Usage: node tools/makePilotFixture.mjs --out <run-dir>
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SIZE = 2048;
export const NODATA = -9999;
export const HOLES = [[100, 100], [1024, 1024]];
export const GEOTRANSFORM = [0, 1, 0, SIZE, 0, -1];
export const EPSG = 2154;

/** The analytic value of one cell, or the sentinel. */
export function analyticValue(column, row) {
  if (HOLES.some(([x, y]) => x === column && y === row)) return NODATA;
  return column - row;
}

/** Stream the plane as little-endian Float32 rows. */
export async function writePlane(path) {
  const stream = createWriteStream(path, { highWaterMark: 1 << 16 });
  const row = Buffer.alloc(SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) row.writeFloatLE(analyticValue(x, y), x * 4);
    if (!stream.write(Buffer.from(row))) {
      await new Promise((done) => stream.once('drain', done));
    }
  }
  await new Promise((done, fail) => {
    stream.once('error', fail);
    stream.end(done);
  });
}

function vrt(rawName) {
  return `<VRTDataset rasterXSize="${SIZE}" rasterYSize="${SIZE}">
  <SRS>EPSG:${EPSG}</SRS>
  <GeoTransform>${GEOTRANSFORM.join(', ')}</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTRawRasterBand">
    <NoDataValue>${NODATA}</NoDataValue>
    <SourceFilename relativetoVRT="1">${rawName}</SourceFilename>
    <ImageOffset>0</ImageOffset>
    <PixelOffset>4</PixelOffset>
    <LineOffset>${SIZE * 4}</LineOffset>
    <ByteOrder>LSB</ByteOrder>
  </VRTRasterBand>
</VRTDataset>
`;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  if (outIndex === -1) {
    process.stderr.write('usage: makePilotFixture.mjs --out <run-dir>\n');
    process.exitCode = 2;
    return;
  }
  const outDir = resolve(args[outIndex + 1]);
  mkdirSync(outDir, { recursive: true });
  const rawPath = join(outDir, 'plane.raw');
  const vrtPath = join(outDir, 'plane.vrt');
  const cogPath = join(outDir, 'plane-cog.tif');

  await writePlane(rawPath);
  writeFileSync(vrtPath, vrt('plane.raw'), 'utf8');
  execFileSync('gdal_translate', [
    '-of', 'COG',
    '-co', 'BLOCKSIZE=512',
    '-co', 'COMPRESS=NONE',
    '-co', 'OVERVIEWS=NONE',
    vrtPath,
    cogPath,
  ], { stdio: 'inherit' });
  const info = JSON.parse(
    execFileSync('gdalinfo', ['-json', cogPath], { encoding: 'utf8' }),
  );
  const manifest = {
    fixture: 'plane-cog.tif',
    path: cogPath,
    size: SIZE,
    nodata: NODATA,
    holes: HOLES,
    // The projected CRS id is the last EPSG id in the WKT; earlier ids belong to the
    // base geodetic CRS and its datum.
    epsg: Number(
      [...info.coordinateSystem.wkt.matchAll(/ID\["EPSG",(\d+)\]\]/g)].at(-1)[1],
    ),
    layout: info.metadata?.IMAGE_STRUCTURE?.LAYOUT ?? null,
    geotransform: info.geoTransform,
    blockSize: info.bands[0].block[0],
    overviews: info.bands[0].overviews ? info.bands[0].overviews.length : 0,
    dataType: info.bands[0].type,
    compression: info.metadata['IMAGE_STRUCTURE'].COMPRESSION ?? 'NONE',
    sha256: sha256(cogPath),
    bytes: statSync(cogPath).size,
    driver: info.driverShortName,
    bandCount: info.bands.length,
  };
  writeFileSync(join(outDir, 'fixture.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
