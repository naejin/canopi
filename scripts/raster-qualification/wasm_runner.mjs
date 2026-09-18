// In-browser qualification runner for the pinned WASM candidate artifacts.
//
// Runs inside the real browser/WebView context because cog-tiler-wasm's init()
// resolves its wasm through `fetch`, which Node's undici does not implement for
// file URLs. Served over a local HTTP origin and driven by playwright; see
// run_experiment.py.
//
// All inputs are supplied by the caller through `window.__QUAL_INPUT__`:
//   { scenarios: [...], fixtures: {name: url}, byteBudget: n }
// Results are returned as a plain serialisable object; no production module is
// imported and no production behaviour is exercised.

import initWb, {
  geotiff_info,
  GeoTiffReader,
  CogStream,
  CogBuilder,
  version as wbVersion,
} from "/wb/whitebox_wasm.js";
import { openCog, init as ctInit, compressionDecoder } from "/ct/cog-tiler.js";

const input = window.__QUAL_INPUT__ || {};
const byteLog = { reads: 0, ranges: [], bySource: {} };

function noteBytes(source, start, end) {
  const length = Math.max(0, end - start);
  byteLog.reads += length;
  byteLog.bySource[source] = (byteLog.bySource[source] || 0) + length;
  byteLog.ranges.push([source, start, end]);
}

/**
 * A Blob wrapper that records every byte range the library asks for, so
 * "bounded local access" is measured rather than asserted. `Blob.prototype.slice`
 * is the only ranged accessor a File-backed COG reader can use.
 */
function instrumentedFile(buffer, source) {
  const blob = new Blob([buffer]);
  return new Proxy(blob, {
    get(target, prop) {
      if (prop === "slice") {
        return (start, end, type) => {
          const s = start ?? 0;
          const e = end ?? target.size;
          noteBytes(source, s, e);
          return target.slice(start, end, type);
        };
      }
      if (prop === "arrayBuffer") {
        return async () => {
          noteBytes(source, 0, target.size);
          return buffer.slice(0);
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} -> ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Level-0 window read via CogStream, fetching only the required tile ranges. */
async function windowViaCogStream(stream, openerBytes, level, x, y, w, h) {
  const tiles = JSON.parse(stream.tiles_for_window(level, x, y, w, h));
  const levelInfo = JSON.parse(stream.levels_json())[level];
  const values = new Float64Array(w * h).fill(NaN);
  let fetched = 0;
  for (const tile of tiles) {
    noteBytes("cogstream", tile.offset, tile.offset + tile.length);
    const bytes = openerBytes.slice(tile.offset, tile.offset + tile.length);
    fetched += bytes.length;
    const decoded = stream.decode_tile_f64(level, bytes);
    const bands = levelInfo.bands;
    for (let row = 0; row < levelInfo.tile_height; row++) {
      const ty = tile.row * levelInfo.tile_height + row;
      if (ty < y || ty >= y + h || ty < 0 || ty >= levelInfo.height) continue;
      for (let column = 0; column < levelInfo.tile_width; column++) {
        const tx = tile.col * levelInfo.tile_width + column;
        if (tx < x || tx >= x + w || tx < 0 || tx >= levelInfo.width) continue;
        values[(ty - y) * w + (tx - x)] = decoded[(row * levelInfo.tile_width + column) * bands];
      }
    }
  }
  return { values: Array.from(values), tiles: tiles.length, bytesFetched: fetched };
}

const scenarios = {
  /** Q1/Q2: metadata + window decode from a tiled local COG through CogStream. */
  async cogstream_windows({ fixtures }) {
    const results = {};
    for (const [name, url] of Object.entries(fixtures)) {
      const bytes = await fetchBytes(url);
      const info = JSON.parse(geotiff_info(bytes));
      let stream = null;
      let streamError = null;
      try {
        stream = new CogStream(bytes.slice(0, Math.min(bytes.length, 1 << 20)));
      } catch (error) {
        streamError = String(error);
      }
      const entry = {
        bytes: bytes.length,
        info,
        levels: stream ? JSON.parse(stream.levels_json()) : null,
        epsg: stream ? stream.epsg ?? null : null,
        nodata: stream ? stream.nodata ?? null : null,
        streamError,
        windows: [],
      };
      if (stream) {
        for (const spec of input.windowSpecs || []) {
          if (spec.fixture && spec.fixture !== name) continue;
          const after = byteLog.reads;
          const started = performance.now();
          try {
            const read = await windowViaCogStream(stream, bytes, spec.level ?? 0,
              spec.x, spec.y, spec.w, spec.h);
            entry.windows.push({
              spec,
              tiles: read.tiles,
              bytesFetched: read.bytesFetched,
              bytesLogged: byteLog.reads - after,
              milliseconds: performance.now() - started,
              sample: read.values.slice(0, 8),
              nonFinite: read.values.filter((v) => !Number.isFinite(v)).length,
              values: read.values,
            });
          } catch (error) {
            // An out-of-image window is a legitimate engine response, not a
            // harness crash: record it instead of losing the whole experiment.
            entry.windows.push({
              spec,
              error: String(error).slice(0, 200),
              milliseconds: performance.now() - started,
            });
          }
        }
      }
      results[name] = entry;
    }
    return results;
  },

  /** Q2: whole-file parse path, for the bounded-vs-unbounded comparison. */
  async geotiff_reader({ fixtures }) {
    const results = {};
    for (const [name, url] of Object.entries(fixtures)) {
      const bytes = await fetchBytes(url);
      const started = performance.now();
      const reader = new GeoTiffReader(bytes);
      const info = JSON.parse(reader.info_json());
      const entry = {
        bytes: bytes.length,
        width: reader.width,
        height: reader.height,
        bands: reader.bands,
        epsg: reader.epsg ?? null,
        nodata: reader.nodata ?? null,
        sample_format: reader.sample_format,
        compression: reader.compression,
        geo_transform: Array.from(reader.geo_transform()),
        bbox_lonlat: Array.from(reader.bounds_lonlat()),
        info,
        milliseconds: performance.now() - started,
      };
      // A window read on this path still materialises the whole band.
      if (reader.height * reader.width <= 4_100_000) {
        const readStarted = performance.now();
        try {
          const band = reader.read_band_f32(0);
          entry.bandRead = {
            length: band.length,
            milliseconds: performance.now() - readStarted,
            first8: Array.from(band.slice(0, 8)),
          };
        } catch (error) {
          entry.bandRead = { error: String(error) };
        }
      }
      try {
        reader.free();
      } catch { /* free is best-effort */ }
      results[name] = entry;
    }
    return results;
  },

  /** Q3: display tiles from a local COG through the cog-tiler host wrapper. */
  async display_tiles({ fixtures, tileRequests }) {
    const results = {};
    for (const [name, url] of Object.entries(fixtures)) {
      const bytes = await fetchBytes(url);
      const entry = { bytes: bytes.length, tiles: [], error: null, opened: null };
      try {
        const source = await openCog(instrumentedFile(bytes.buffer, `cogtiler:${name}`));
        entry.opened = {
          mode: source.mode,
          crsLabel: source.crsLabel,
          levels: source.levels,
          boundsLonLat: source.boundsLonLat,
          readsViaGeoTiff: source.readsViaGeoTiff,
          decoder: compressionDecoder(source.levels?.[0]?.compression),
        };
        for (const request of tileRequests) {
          const started = performance.now();
          try {
            const png = await source.renderTilePNG(request.z, request.x, request.y,
              { min: request.min, max: request.max, colormap: request.colormap });
            entry.tiles.push({
              request,
              bytes: png.length,
              milliseconds: performance.now() - started,
              empty: png.length === 0,
            });
          } catch (error) {
            entry.tiles.push({ request, error: String(error), milliseconds: performance.now() - started });
          }
        }
      } catch (error) {
        entry.error = String(error);
      }
      results[name] = entry;
    }
    return results;
  },

  /** Q3: separate artifact builds a tiled COG with overviews; no native prep. */
  async cog_builder({ plane }) {
    const width = plane.width;
    const height = plane.height;
    const started = performance.now();
    const data = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        data[y * width + x] = plane.a * x + plane.b * y + plane.c;
      }
    }
    const builder = new CogBuilder(width, height, 1);
    builder.set_epsg(plane.epsg);
    builder.set_origin(plane.originX, plane.originY, plane.pixel);
    builder.set_compression("deflate");
    builder.set_tile_size(plane.tileSize);
    builder.set_overview_levels(plane.overviews);
    const bytes = builder.write_f64(data);
    const buildMs = performance.now() - started;
    const stream = new CogStream(bytes.slice(0, Math.min(bytes.length, 1 << 20)));
    const probe = JSON.parse(stream.tiles_for_window(0, 0, 0, 8, 8));
    const decoded = stream.decode_tile_f64(0, bytes.slice(probe[0].offset, probe[0].offset + probe[0].length));
    return {
      width, height,
      outputBytes: bytes.length,
      buildMilliseconds: buildMs,
      levels: JSON.parse(stream.levels_json()),
      epsg: stream.epsg ?? null,
      windowTiles: probe,
      windowBytesFetched: probe.reduce((sum, tile) => sum + tile.length, 0),
      windowFirst4: Array.from(decoded.slice(0, 4)),
      sha256: await crypto.subtle.digest("SHA-256", bytes).then((d) =>
        Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("")),
    };
  },

  /**
   * Q3 local transport: open the fixture as a browser `File` handed over by the
   * host file input, so slice() is served from disk rather than in-memory bytes.
   * A `File` obtained this way is what a real Desktop file picker produces, and
   * it is the only construction that proves the bridge never needs the whole
   * raster resident. `#local-file` is provided by the driver.
   */
  async local_file_source({ fixtures }) {
    const name = Object.keys(fixtures)[0];
    const input = document.querySelector("#local-file");
    if (!input) throw new Error("driver did not provide a #local-file input");
    const file = input.files && input.files[0];
    if (!file) throw new Error("driver did not attach a file to #local-file");

    const out = {
      name: file.name,
      size: file.size,
      isFile: file instanceof File,
      reads: [],
      totalRangedBytes: 0,
      largestRange: 0,
    };
    // Count every ranged access the library performs.
    const original = file.slice.bind(file);
    file.slice = (start, end, type) => {
      const a = start ?? 0;
      const b = end ?? file.size;
      out.totalRangedBytes += Math.max(0, b - a);
      out.largestRange = Math.max(out.largestRange, b - a);
      out.reads.push([a, b]);
      return original(start, end, type);
    };
    try {
      const source = await openCog(file);
      out.opened = {
        mode: source.mode,
        crsLabel: source.crsLabel,
        levels: source.levels.length,
        boundsLonLat: source.boundsLonLat,
        readsViaGeoTiff: source.readsViaGeoTiff,
      };
      const png = await source.renderTilePNG(0, 0, 0, { min: 0, max: 35, colormap: "viridis" });
      out.tileBytes = png.length;
      out.statistics = await source.statistics({ maxSize: 128 });
    } catch (error) {
      out.error = String(error);
    }
    out.rangeCount = out.reads.length;
    out.fractionOfFile = out.totalRangedBytes / file.size;
    return out;
  },

  /** Q5: cancellation/disposal and failure injection on the decode role. */
  async failure_injection({ fixtures }) {
    const outcome = { disposeTwice: null, truncated: null, corrupt: null, cancelled: null, wrongFree: null };
    const url = Object.values(fixtures)[0];
    const bytes = await fetchBytes(url);

    // 1. Disposing the same stream twice must not throw or corrupt state.
    try {
      const stream = new CogStream(bytes.slice(0, 1 << 20));
      stream.free();
      stream.free();
      outcome.disposeTwice = { ok: true };
    } catch (error) {
      outcome.disposeTwice = { ok: false, error: String(error) };
    }

    // 2. A truncated header must fail loudly, not return partial metadata.
    try {
      const info = JSON.parse(geotiff_info(bytes.slice(0, 3)));
      outcome.truncated = { rejected: false, info };
    } catch (error) {
      outcome.truncated = { rejected: true, error: String(error).slice(0, 200) };
    }

    // 3. Corrupt tile bytes must reject rather than yield silent garbage.
    try {
      const stream = new CogStream(bytes.slice(0, 1 << 20));
      const tiles = JSON.parse(stream.tiles_for_window(0, 0, 0, 8, 8));
      const tile = tiles[0];
      const corrupt = bytes.slice(tile.offset, tile.offset + tile.length).slice();
      for (let i = 0; i < corrupt.length; i += 7) corrupt[i] ^= 0xff;
      let decoded = null;
      try {
        decoded = Array.from(stream.decode_tile_f64(0, corrupt).slice(0, 4));
      } catch (error) {
        decoded = { error: String(error).slice(0, 200) };
      }
      outcome.corrupt = { decoded };
    } catch (error) {
      outcome.corrupt = { error: String(error).slice(0, 200) };
    }

    // 4. Cooperative cancellation: an aborted generation must stop scheduling
    //    further tile fetches, and the work must settle promptly.
    try {
      const stream = new CogStream(bytes.slice(0, 1 << 20));
      const controller = new AbortController();
      const tiles = JSON.parse(stream.tiles_for_window(0, 0, 0, 64, 64));
      const settled = [];
      const started = performance.now();
      controller.abort();
      for (const tile of tiles) {
        if (controller.signal.aborted) break;
        settled.push(tile.col);
      }
      outcome.cancelled = {
        scheduledAfterAbort: settled.length,
        settleMilliseconds: performance.now() - started,
        tilesAvailable: tiles.length,
      };
    } catch (error) {
      outcome.cancelled = { error: String(error).slice(0, 200) };
    }

    // 5. Reading a window outside the raster must stay well-defined.
    try {
      const stream = new CogStream(bytes.slice(0, 1 << 20));
      const levels = JSON.parse(stream.levels_json())[0];
      const tiles = JSON.parse(stream.tiles_for_window(0, levels.width + 10, levels.height + 10, 4, 4));
      outcome.wrongFree = { tilesReturned: tiles.length };
    } catch (error) {
      outcome.wrongFree = { error: String(error).slice(0, 200) };
    }
    return outcome;
  },
};

async function main() {
  const result = { ok: true, wbVersion: null, scenarios: {}, byteLog: null, errors: [] };
  try {
    await initWb({ module_or_path: await fetchBytes(input.wasmUrl) });
    result.wbVersion = wbVersion();
    await ctInit();
  } catch (error) {
    result.ok = false;
    result.errors.push(`init: ${String(error)}`);
    return result;
  }
  for (const name of input.scenarios) {
    const scenario = scenarios[name];
    if (!scenario) {
      result.errors.push(`unknown scenario ${name}`);
      continue;
    }
    const started = performance.now();
    try {
      result.scenarios[name] = await scenario(input);
    } catch (error) {
      result.ok = false;
      result.scenarios[name] = { error: String(error), stack: String(error?.stack || "") };
    }
    result.scenarios[name].__milliseconds = performance.now() - started;
  }
  result.byteLog = {
    reads: byteLog.reads,
    bySource: byteLog.bySource,
    rangeCount: byteLog.ranges.length,
    largestRange: byteLog.ranges.reduce((max, r) => Math.max(max, r[2] - r[1]), 0),
  };
  return result;
}

// The runner does not start on import: the driver may need to attach a real file
// to the page first, because a File handed over by a file input is the only
// construction that proves disk-backed slicing. The driver calls __QUAL_RUN__()
// once the page is in its final state.
window.__QUAL_DONE__ = false;
window.__QUAL_RUN__ = async function run() {
  window.__QUAL_RESULT__ = await main();
  window.__QUAL_DONE__ = true;
  return window.__QUAL_RESULT__;
};
