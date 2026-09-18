// Drive the browser-side qualification runner in a real Chromium/WebKit context.
//
// The runner needs a genuine browser because cog-tiler-wasm resolves its wasm
// through `fetch`, which Node cannot do for local files. This driver starts the
// harness static server, opens runner.html with the scenario payload installed
// before any document script runs, and returns the runner's structured result.
//
// Chromium and WebKit are reported separately and never merged: the Desktop
// edition renders in a WebKit WebView on Linux, so a Chromium-only pass is not
// evidence for WebKit.
//
// Usage:
//   node scripts/raster-qualification/run_wasm_probe.mjs \
//     --experiment q2 --bench <scratch>/bench --fixtures <scratch>/fx \
//     --fixture-map <json> --out <scratch>/out/q2.json [--engines chromium webkit]

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = dirname(fileURLToPath(import.meta.url));

const EXPERIMENTS = {
  q1: { scenarios: ["cogstream_windows"], extra: {} },
  // Q2 over the intended ranged transport, with stride sampling.
  q2ranged: {
    scenarios: ["ranged_numeric", "geotiff_reader"],
    extra: {
      numericSpec: {
        prefixBytes: 65536,
        strideGrid: 4,
        windows: [
          { fixture: "plane2000", x: 0, y: 0, w: 8, h: 8, label: "origin" },
          { fixture: "plane2000", x: 100, y: 50, w: 8, h: 8, label: "interior" },
          { fixture: "plane2000", x: 248, y: 248, w: 16, h: 16, label: "straddles-tile-edge" },
          { fixture: "plane2000", x: 1016, y: 1016, w: 8, h: 8, label: "second-tile-origin" },
          { fixture: "plane2000", x: 1024, y: 0, w: 256, h: 256, label: "max-contract-window" },
          { fixture: "plane2000", x: 1990, y: 1990, w: 16, h: 16, label: "far-corner" },
          { fixture: "plane256", x: 90, y: 90, w: 20, h: 20, label: "crosses-nodata-hole" },
          { fixture: "plane256", x: 10, y: 10, w: 8, h: 8, label: "inside-nodata-hole",
            expectNoCoverage: true },
          { fixture: "steep45", x: 24, y: 24, w: 4, h: 4, label: "steep45-interior" },
        ],
      },
    },
  },
  q2: {
    scenarios: ["cogstream_windows", "geotiff_reader"],
    extra: {
      // Scoped to the fixture that can satisfy them: a window whose origin lies
      // outside the raster is a legitimate rejection, recorded rather than lost.
      windowSpecs: [
        { fixture: "plane2000", x: 0, y: 0, w: 8, h: 8, label: "origin" },
        { fixture: "plane2000", x: 100, y: 50, w: 8, h: 8, label: "interior" },
        { fixture: "plane2000", x: 248, y: 248, w: 16, h: 16, label: "straddles-tile-edge" },
        { fixture: "plane2000", x: 1016, y: 1016, w: 8, h: 8, label: "second-tile-origin" },
        { fixture: "plane2000", x: 1024, y: 0, w: 256, h: 256, label: "max-contract-window" },
        { fixture: "plane2000", x: 1990, y: 1990, w: 16, h: 16, label: "far-corner" },
        { fixture: "plane256", x: 90, y: 90, w: 20, h: 20, label: "crosses-nodata-hole" },
        { fixture: "steep45", x: 24, y: 24, w: 4, h: 4, label: "steep45-interior" },
      ],
    },
  },
  q3: {
    scenarios: ["cog_builder", "display_tiles"],
    extra: {
      // The independent artifact writes a tiled COG with overviews; this is the
      // bounded derivative the plan expects native preparation to produce.
      plane: {
        width: 512, height: 512, a: 0.1, b: 0.2, c: -100.0,
        epsg: 2154, originX: 444999.75, originY: 6806000.25, pixel: 0.5,
        tileSize: 256, overviews: 2,
      },
      tileRequests: [
        { z: 0, x: 0, y: 0, min: -100, max: 100, colormap: "viridis" },
        { z: 1, x: 0, y: 0, min: -100, max: 100, colormap: "viridis" },
        { z: 1, x: 1, y: 1, min: -100, max: 100, colormap: "viridis" },
        { z: 2, x: 2, y: 1, min: -100, max: 100, colormap: "gray" },
      ],
    },
  },
  // Native preparation integrity: window reads on a derivative prepared from the
  // real stripped fixture, plus the whole-file path for comparison.
  q3prep: {
    scenarios: ["cogstream_windows", "geotiff_reader"],
    extra: {
      windowSpecs: [
        { x: 0, y: 0, w: 64, h: 64, label: "origin-first-data-column" },
        { x: 900, y: 900, w: 64, h: 64, label: "interior" },
        { x: 1990, y: 1990, w: 16, h: 16, label: "far-corner" },
        { x: 0, y: 1990, w: 64, h: 16, label: "last-rows" },
        { x: 512, y: 512, w: 256, h: 256, label: "multiple-tiles" },
      ],
    },
  },
  // Q3 local transport: a real File attached by the host, sliced from disk.
  q3file: {
    scenarios: ["local_file_source"],
    extra: { numericSpec: { strideGrid: 4 } },
  },
  q5: { scenarios: ["failure_injection"], extra: {} },
};

function parseArgs(argv) {
  const args = { engines: ["chromium"], timeoutMs: 240000 };
  const keys = new Set(["experiment", "bench", "fixtures", "fixtureMap", "out",
    "attachFile", "timeoutMs", "chromiumExecutable", "webkitExecutable",
    "firefoxExecutable"]);
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === "engines") {
      // Comma-separated so the flag consumes exactly one argv slot.
      args.engines = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (!keys.has(key)) throw new Error(`unknown flag ${raw}`);
    const value = argv[++i];
    args[key] = key === "timeoutMs" ? Number(value) : value;
  }
  return args;
}

function launchOptionsFor(engine) {
  // A managed browser download is not assumed: the qualified host may only have
  // a system browser, and the driver reports the engine unavailable rather than
  // silently skipping it.
  if (engine === "chromium" && process.env.QUAL_CHROME_CHANNEL === "chrome") {
    return { channel: "chrome" };
  }
  return {};
}

function explicitExecutable(engine, args) {
  const key = `${engine}Executable`;
  return args[key] || process.env[`QUAL_${engine.toUpperCase()}_EXECUTABLE`] || null;
}

function freePort() {  return new Promise((done) => {
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
      const socket = createServer();
      socket.once("error", () => done(false));
      socket.listen(port, "127.0.0.1", () => socket.close(() => done(true)));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`harness server on port ${port} did not start`);
}

async function main() {
  const args = parseArgs(process.argv);
  const spec = EXPERIMENTS[args.experiment];
  if (!spec) throw new Error(`unknown experiment ${args.experiment}`);
  const fixtures = resolve(args.fixtures);
  const bench = resolve(args.bench);
  const fixtureMap = JSON.parse(readFileSync(args.fixtureMap, "utf8"));
  const port = await freePort();

  // Resolve the bare peer specifiers from the installed packages rather than a
  // hand-maintained list, so a missing peer fails loudly in one place.
  const importMapPath = resolve(dirname(resolve(args.out)), `import-map-${args.experiment}.json`);
  // `geotiff`'s ESM entry point statically imports its Node HTTP client, which a
  // browser cannot load. That client is only used for remote URLs; the probe
  // exercises local files. The three Node builtins it needs are mapped to inert
  // stubs so the local path can be measured. This is recorded in the receipt and
  // is not a production recommendation.
  const stubDir = resolve(dirname(importMapPath), "stubs");
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(resolve(stubDir, "node-builtin.js"), "export default {};\n");
  const NODE_BUILTINS = [
    "fs", "fs/promises", "http", "https", "url", "stream", "path", "os",
    "buffer", "util", "zlib", "events", "crypto", "worker_threads",
  ];
  const nodeStubs = resolve(stubDir, "node-builtin-stubs.json");
  writeFileSync(nodeStubs, JSON.stringify({
    imports: Object.fromEntries(
      NODE_BUILTINS.map((name) => [name, "/stub/node-builtin.js"])),
  }, null, 2));

  await new Promise((done, fail) => {
    const child = spawn("python3", [
      resolve(HARNESS, "import_map.py"), "--bench", bench, "--out", importMapPath,
      "--extra-map", nodeStubs,
    ], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", (code) =>
      (code === 0 ? done() : fail(new Error(`import_map.py exited ${code}`))));
  });

  // The transport keeps its own ledger of served bytes, so the report carries a
  // record the client cannot inflate or omit.
  const ledgerPath = resolve(dirname(resolve(args.out)), `ledger-${args.experiment}.json`);
  const server = spawn("python3", [
    resolve(HARNESS, "serve_bench.py"),
    "--bench", bench, "--fixtures", fixtures,
    "--import-map", importMapPath, "--port", String(port),
    "--ledger", ledgerPath,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });

  const results = { experiment: args.experiment, engines: {} };
  try {
    await waitForServer(port);
    const { chromium, webkit, firefox } = await import(
      resolve(bench, "node_modules/playwright/index.mjs"));
    const browsers = { chromium, webkit, firefox };
    const pageInput = {
      wasmUrl: `http://127.0.0.1:${port}/wb/whitebox_wasm_bg.wasm`,
      scenarios: spec.scenarios,
      fixtures: Object.fromEntries(
        Object.entries(fixtureMap).map(([name, rel]) => [name, `/fx/${rel}`])),
      ...spec.extra,
    };

    for (const engine of args.engines) {
      const browserType = browsers[engine];
      if (!browserType) {
        results.engines[engine] = { available: false, error: `unknown engine ${engine}` };
        continue;
      }
      let browser;
      try {
        browser = await browserType.launch(launchOptionsFor(engine));
      } catch (error) {
        // Fall back to an explicitly supplied executable before reporting the
        // engine unavailable, so a host with a system browser still qualifies.
        const explicit = explicitExecutable(engine, args);
        if (explicit) {
          try {
            browser = await browserType.launch({ executablePath: explicit });
          } catch (second) {
            results.engines[engine] = {
              available: false, error: `${String(error).slice(0, 200)} | ${String(second).slice(0, 300)}`,
            };
            continue;
          }
        } else {
          results.engines[engine] = { available: false, error: String(error).slice(0, 400) };
          continue;
        }
      }
      const started = Date.now();
      const console_ = [];
      try {
        const page = await browser.newPage();
        page.on("console", (m) => console_.push(`${m.type()}: ${m.text()}`));
        page.on("pageerror", (e) => console_.push(`pageerror: ${e}`));
        await page.addInitScript(
          (payload) => { window.__QUAL_INPUT__ = payload; }, pageInput);
        await page.goto(`http://127.0.0.1:${port}/runner.html`, { waitUntil: "load" });
        // A disk-backed File must exist before the runner starts, so the run is
        // triggered explicitly rather than at import time.
        if (args.attachFile) {
          await page.setInputFiles("#local-file", args.attachFile);
        }
        await page.evaluate(() => window.__QUAL_RUN__());
        await page.waitForFunction(() => window.__QUAL_DONE__ === true,
          null, { timeout: args.timeoutMs });
        const payload = await page.evaluate(() => window.__QUAL_RESULT__);
        results.engines[engine] = {
          available: true, ...payload, console: console_, seconds: (Date.now() - started) / 1000,
        };
      } catch (error) {
        results.engines[engine] = {
          available: true, ok: false,
          error: `runner did not finish: ${String(error)}`.slice(0, 800), console: console_,
        };
      } finally {
        await browser.close();
      }
    }
  } finally {
    // Wait for the server to actually exit: its byte ledger is written during
    // shutdown, and reading it before then would silently record nothing.
    const exited = new Promise((done) => server.on("exit", done));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((done) => setTimeout(done, 8000))]);
  }
  try {
    results.transportLedger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    results.transportLedger = null;
    results.transportLedgerError = String(error).slice(0, 200);
  }

  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(resolve(args.out), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify({
    experiment: args.experiment,
    out: resolve(args.out),
    engines: Object.fromEntries(Object.entries(results.engines).map(([name, value]) => [
      name,
      { available: value.available, ok: value.ok, errors: value.errors,
        consoleErrors: (value.console || []).filter((l) => !l.startsWith("log")).slice(0, 3) },
    ])),
    serverLog: serverLog.trim().slice(0, 400),
  }, null, 2));
}

await main();
