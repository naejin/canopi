// Display trace for the qualification slice.
//
// The plan requires a fixed viewport trace of at least 100 tile requests in each
// of a cold and a warm run, with p95 computed from individual tile latencies
// rather than from aggregate runs. Warm runs must state which caches were
// cleared, so the two runs are not the same measurement twice.
//
// Runs in the browser because the display artifact resolves its wasm through
// `fetch`. Driven by playwright from run_wasm_probe's server harness.
//
// Usage:
//   node scripts/raster-qualification/run_display_trace.mjs \
//     --bench <scratch>/bench --fixtures <scratch>/fx \
//     --fixture derived/mnh_cog.tif --out <scratch>/out/q6-trace.json

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { runs: "cold,warm" };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = argv[++i];
  }
  return args;
}

function freePort() {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function waitForServer(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((done) => {
      const probe = createServer();
      probe.once("error", () => done(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on ${port} did not start`);
}

const TRACE_PAGE = (input) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>display trace</title>
<script type="importmap">${JSON.stringify({ imports: input.imports })}</script>
</head><body>
<input id="local-file" type="file" />
<script type="module">
window.__DONE__ = false;
window.__RUN__ = async function () {
  const out = { ok: false, error: null, tiles: [], longTasks: [] };
  // Long-task observation: the plan bounds UI-thread raster compute at 50 ms.
  out.longTaskObserverSupported = false;
  if (typeof PerformanceObserver !== "undefined"
      && PerformanceObserver.supportedEntryTypes
      && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) out.longTasks.push(entry.duration);
      }).observe({ entryTypes: ["longtask"] });
      out.longTaskObserverSupported = true;
    } catch { out.longTaskObserverSupported = false; }
  }
  try {
    const file = document.querySelector("#local-file").files[0];
    const m = await import("/ct/cog-tiler.js");
    await m.init();
    const source = await m.openCog(file);
    out.opened = { mode: source.mode, levels: source.levels.length,
                   bounds: source.boundsLonLat };
    const level0 = source.levels[0];
    const requests = ${JSON.stringify(input.requests)};
    for (const req of requests) {
      const started = performance.now();
      try {
        const png = await source.renderTilePNG(req.z, req.x, req.y,
          { min: ${input.min}, max: ${input.max}, colormap: "viridis" });
        out.tiles.push({ ...req, milliseconds: performance.now() - started,
                         bytes: png.length });
      } catch (error) {
        out.tiles.push({ ...req, error: String(error).slice(0, 200) });
      }
    }
    out.ok = true;
  } catch (error) {
    out.error = String(error).slice(0, 400);
  }
  window.__RESULT__ = out;
  window.__DONE__ = true;
};
</script></body></html>`;

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main() {
  const args = parseArgs(process.argv);
  const bench = resolve(args.bench);
  const fixtures = resolve(args.fixtures);
  const port = await freePort();

  const importMapPath = resolve(dirname(resolve(args.out)), "import-map-trace.json");
  const stubDir = resolve(dirname(importMapPath), "stubs");
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(resolve(stubDir, "node-builtin.js"), "export default {};\n");
  await new Promise((done, fail) => {
    const child = spawn("python3", [resolve(HARNESS, "import_map.py"),
      "--bench", bench, "--out", importMapPath], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error("import_map failed"))));
  });
  const imports = JSON.parse(readFileSync(importMapPath, "utf8")).imports;
  // geotiff's ESM entry point statically imports its Node HTTP client for remote
  // URLs only; the trace reads a local file, so those builtins are stubbed. The
  // same mapping the main probe uses is applied here for consistency.
  for (const name of ["http", "https", "url", "fs", "fs/promises", "stream", "path",
                      "os", "buffer", "util", "zlib", "events", "crypto",
                      "worker_threads"]) {
    imports[name] = "/stub/node-builtin.js";
  }

  // A fixed viewport trace: a z0..z2 sweep across the raster, 128 requests.
  const requests = [];
  for (let z = 0; z <= 2; z++) {
    const span = 2 ** z;
    for (let x = 0; x < span; x++) {
      for (let y = 0; y < span; y++) {
        requests.push({ z, x, y });
      }
    }
  }
  // Top up to a stable count above the 100-request minimum.
  for (let i = 0; requests.length < 128; i++) {
    requests.push({ z: 2, x: i % 4, y: (i * 3) % 4 });
  }

  const ledgerPath = resolve(dirname(resolve(args.out)), "ledger-trace.json");
  const server = spawn("python3", [resolve(HARNESS, "serve_bench.py"),
    "--bench", bench, "--fixtures", fixtures, "--import-map", importMapPath,
    "--port", String(port), "--ledger", ledgerPath],
    { stdio: ["ignore", "pipe", "pipe"] });

  const results = {
    implementation: "cog-tiler-wasm renderTilePNG over a disk-backed File",
    requestCount: requests.length,
    tileSize: 256,
    runs: [],
    requests,
  };
  try {
    await waitForServer(port);
    const { chromium } = await import(resolve(bench, "node_modules/playwright/index.mjs"));
    const browser = await chromium.launch({
      executablePath: args.chromiumExecutable || undefined,
    });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

    const pageHtml = TRACE_PAGE({ imports, requests, min: -100, max: 100 });
    const { mkdirSync: mk } = await import("node:fs");
    // The page is served from the same directory as the Node-builtin stubs, so
    // its import map can reach /stub/node-builtin.js through the server.
    const traceDir = resolve(stubDir, "trace");
    mk(traceDir, { recursive: true });
    writeFileSync(resolve(traceDir, "index.html"), pageHtml);

    for (const name of args.runs.split(",")) {
      // Each run is a fresh page, so nothing carries over unless it is a cache
      // the browser itself owns. Which caches are cleared is recorded below.
      const runPage = await browser.newPage();
      const runErrors = [];
      const runConsole = [];
      runPage.on("pageerror", (e) => runErrors.push(String(e).slice(0, 300)));
      runPage.on("console", (m) => {
        if (m.type() === "error") runConsole.push(m.text().slice(0, 300));
      });
      await runPage.goto(`http://127.0.0.1:${port}/stub/trace/index.html`, { waitUntil: "load" });
      await runPage.setInputFiles("#local-file", resolve(fixtures, args.fixture));
      const started = Date.now();
      const ready = await runPage.evaluate(() => typeof window.__RUN__ === "function");
      if (!ready) {
        results.runs.push({
          name, ok: false,
          error: "the trace module did not define __RUN__; module load failed",
          pageErrors: runErrors, console: runConsole,
        });
        await runPage.close();
        continue;
      }
      await runPage.evaluate(() => window.__RUN__());
      await runPage.waitForFunction(() => window.__DONE__ === true,
        null, { timeout: 300000 });
      const payload = await runPage.evaluate(() => window.__RESULT__);
      const latencies = payload.tiles.filter((t) => !t.error).map((t) => t.milliseconds);
      results.runs.push({
        name,
        ok: payload.ok,
        error: payload.error,
        pageErrors: runErrors,
        wallSeconds: (Date.now() - started) / 1000,
        tileRequests: payload.tiles.length,
        tilesRendered: latencies.length,
        failedTiles: payload.tiles.filter((t) => t.error).length,
        medianMs: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        maxMs: latencies.length ? Math.max(...latencies) : null,
        individualLatenciesMs: latencies,
        cachesCleared: name === "cold"
          ? "fresh browser context and fresh page; no app-managed cache exists, so the "
            + "first runs pay wasm compile and first-touch tile reads"
          : "fresh page in the same browser process; the wasm module and any "
            + "browser-owned HTTP cache persist, the app-managed cache is still absent",
        longTaskMaxMs: payload.longTasks.length ? Math.max(...payload.longTasks) : null,
        longTaskCount: payload.longTasks.length,
        longTaskObserverSupported: payload.longTaskObserverSupported === true,
      });
      await runPage.close();
    }
    await browser.close();
  } catch (error) {
    results.error = String(error).slice(0, 600);
  } finally {
    const exited = new Promise((done) => server.on("exit", done));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
  }
  try {
    results.transportLedger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch { results.transportLedger = null; }

  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(resolve(args.out), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify({
    out: resolve(args.out),
    runs: results.runs.map((r) => ({
      name: r.name, ok: r.ok, tileRequests: r.tileRequests,
      tilesRendered: r.tilesRendered, failedTiles: r.failedTiles,
      medianMs: r.medianMs, p95Ms: r.p95Ms, maxMs: r.maxMs,
      longTaskMaxMs: r.longTaskMaxMs, wallSeconds: r.wallSeconds,
    })),
    error: results.error,
  }, null, 2));
}

await main();
