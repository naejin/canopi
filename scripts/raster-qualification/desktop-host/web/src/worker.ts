/**
 * The bundled worker: bounded numeric windows through the native bridge.
 *
 * The worker never sees a path and never calls the host directly. It plans the reads
 * it needs from the COG header, asks the main WebView for exactly those intervals, and
 * decodes the returned bytes with the candidate `CogStream`. It reports its own
 * counters; the native ledger is recorded independently on the host side and the two
 * are compared by the launcher.
 */

interface RefusalControl {
  readonly id: string;
  readonly handle?: number;
  readonly offset: number;
  readonly length: number;
  readonly expected: string;
}

interface RefusalResult {
  readonly id: string;
  readonly requestId: string;
  readonly expected: string;
  readonly observed: string;
  readonly ok: boolean;
}

interface ReadRequest {
  readonly type: 'run';
  readonly handle: number;
  readonly run: string;
  readonly headerBytes: number;
  readonly assetBase: string;
  readonly wasmUrl: string;
  readonly windows: readonly { id: string; x: number; y: number; w: number; h: number }[];
  readonly refusals: readonly RefusalControl[];
}

interface NativeReadReply {
  readonly type: 'bytes' | 'failed';
  readonly requestId: string;
  readonly bytes?: Uint8Array;
  readonly code?: string;
}

/** One tile the engine asks for, in the engine's own JSON vocabulary. */
interface TileRef {
  readonly offset: number;
  readonly length: number;
  readonly row: number;
  readonly col: number;
}

/** One level of the opened stream. */
interface LevelInfo {
  readonly width: number;
  readonly height: number;
  readonly tile_width: number;
  readonly tile_height: number;
  readonly bands: number;
}

/**
 * Read one required numeric field from parsed engine JSON.
 *
 * The engine's structures are external input, so a renamed or missing field is a named
 * failure rather than a silently undefined coordinate that would leave a window full of
 * NaN while still looking like a completed read.
 */
function requiredNumber(source: Record<string, unknown>, field: string, where: string): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where} has no numeric ${field} (got ${JSON.stringify(value)})`);
  }
  return value;
}

function readTiles(raw: unknown): TileRef[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('the engine returned no tiles for the window');
  return raw.map((entry, index) => {
    const tile = entry as Record<string, unknown>;
    return {
      offset: requiredNumber(tile, 'offset', `tile ${index}`),
      length: requiredNumber(tile, 'length', `tile ${index}`),
      row: requiredNumber(tile, 'row', `tile ${index}`),
      col: requiredNumber(tile, 'col', `tile ${index}`),
    };
  });
}

function readLevel(raw: unknown, level: number): LevelInfo {
  const info = raw as Record<string, unknown>;
  const where = `level ${level}`;
  return {
    width: requiredNumber(info, 'width', where),
    height: requiredNumber(info, 'height', where),
    tile_width: requiredNumber(info, 'tile_width', where),
    tile_height: requiredNumber(info, 'tile_height', where),
    bands: requiredNumber(info, 'bands', where),
  };
}

const counters = {
  headerRequests: 0,
  headerBytes: 0,
  tileRequests: 0,
  tileBytes: 0,
  totalBytes: 0,
  largestRequest: 0,
  readFailures: [] as { requestId: string; code: string }[],
};

let nextRequest = 0;
const pending = new Map<string, (reply: NativeReadReply) => void>();

/**
 * Issue a read that must be refused, through the same native path a real read uses.
 *
 * The control is declared by the launcher, so neither the request nor the expected code
 * comes from the bridge under test. A control that unexpectedly returns bytes is a
 * failure of the control, not evidence of bounded transport.
 */
function nativeReadExpectingRefusal(control: RefusalControl, fallbackHandle: number): Promise<RefusalResult> {
  const handle = control.handle ?? fallbackHandle;
  const requestId = `r${nextRequest++}`;
  return new Promise((done) => {
    pending.set(requestId, (reply) => {
      const observed = reply.type === 'bytes' ? 'unexpected-success' : reply.code ?? 'unknown';
      done({
        id: control.id,
        requestId,
        expected: control.expected,
        observed,
        ok: observed === control.expected,
      });
    });
    self.postMessage({ type: 'read', handle, offset: control.offset, length: control.length, requestId });
  });
}

function nativeRead(handle: number, offset: number, length: number): Promise<Uint8Array> {
  const requestId = `w${nextRequest++}`;
  return new Promise((done, fail) => {
    pending.set(requestId, (reply) => {
      if (reply.type === 'bytes' && reply.bytes !== undefined) {
        counters.largestRequest = Math.max(counters.largestRequest, reply.bytes.length);
        done(reply.bytes);
      } else {
        counters.readFailures.push({ requestId, code: reply.code ?? 'unknown' });
        fail(new Error(`native read ${requestId} refused: ${reply.code ?? 'unknown'}`));
      }
    });
    self.postMessage({ type: 'read', handle, offset, length, requestId });
  });
}

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as ReadRequest | NativeReadReply;
  if (message.type === 'bytes' || message.type === 'failed') {
    pending.get(message.requestId)?.(message);
    pending.delete(message.requestId);
    return;
  }
  if (message.type !== 'run') return;
  try {
    const result = await run(message);
    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  }
};

async function run(spec: ReadRequest): Promise<unknown> {
  const module = (await import(/* @vite-ignore */ `${spec.assetBase}/whitebox_wasm.js`)) as {
    default: (path: string) => Promise<unknown>;
    CogStream: new (bytes: Uint8Array) => {
      levels_json(): string;
      tiles_for_window(level: number, x: number, y: number, w: number, h: number): string;
      decode_tile_f64(level: number, bytes: Uint8Array): Float64Array;
      nodata: number;
    };
  };
  // Refused-read controls first: they must be refused before any window is decoded, and
  // they never contribute bytes to the transport ledger.
  const refusals: RefusalResult[] = [];
  for (const control of spec.refusals ?? []) {
    refusals.push(await nativeReadExpectingRefusal(control, spec.handle));
  }

  await module.default(spec.wasmUrl);

  // A header prefix is fetched once and grown only when the engine says the header is
  // short; the cap keeps a pathological file from becoming a whole-file read.
  let prefixBytes = spec.headerBytes;
  let stream: InstanceType<typeof module.CogStream> | undefined;
  for (let attempt = 0; attempt < 4 && stream === undefined; attempt += 1) {
    const header = await nativeRead(spec.handle, 0, prefixBytes);
    counters.headerRequests += 1;
    counters.headerBytes += header.length;
    counters.totalBytes += header.length;
    try {
      stream = new module.CogStream(header);
    } catch (error) {
      if (attempt === 3 || !String(error).includes('header')) throw error;
      prefixBytes = Math.min(prefixBytes * 4, 1 << 20);
    }
  }
  if (stream === undefined) throw new Error('the COG header could not be parsed within four attempts');
  const levels = JSON.parse(stream.levels_json()) as unknown[];
  const level = 0;
  const levelInfo = readLevel(levels[level], level);
  const nodata = stream.nodata;

  const windows = [];
  for (const window of spec.windows) {
    const tiles = readTiles(JSON.parse(stream.tiles_for_window(level, window.x, window.y, window.w, window.h)));
    const values = new Float64Array(window.w * window.h).fill(Number.NaN);
    for (const tile of tiles) {
      const bytes = await nativeRead(spec.handle, tile.offset, tile.length);
      counters.tileRequests += 1;
      counters.tileBytes += bytes.length;
      counters.totalBytes += bytes.length;
      const decoded = stream.decode_tile_f64(level, bytes);
      for (let row = 0; row < levelInfo.tile_height; row += 1) {
        const ty = tile.row * levelInfo.tile_height + row;
        if (ty < window.y || ty >= window.y + window.h || ty < 0 || ty >= levelInfo.height) continue;
        for (let column = 0; column < levelInfo.tile_width; column += 1) {
          const tx = tile.col * levelInfo.tile_width + column;
          if (tx < window.x || tx >= window.x + window.w || tx < 0 || tx >= levelInfo.width) continue;
          // The decoder returns band-interleaved samples for the whole tile.
          const source = (row * levelInfo.tile_width + column) * levelInfo.bands;
          const value = decoded[source];
          values[(ty - window.y) * window.w + (tx - window.x)] = value === undefined ? Number.NaN : value;
        }
      }
    }
    windows.push({
      id: window.id,
      x: window.x,
      y: window.y,
      w: window.w,
      h: window.h,
      nodata,
      values: Array.from(values),
    });
  }
  return { windows, counters, refusals, levels: levels.length, nodata };
}
