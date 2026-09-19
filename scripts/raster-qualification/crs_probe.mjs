// CRS probe: does the display artifact's own projection agree with the
// independently configured reference, and how does it map a requested pixel?
//
// The qualification route resolves CRS through native preparation, so this probe
// answers two narrow questions with the artifact's own numbers:
//
//   1. Does its projection engine reproduce a coordinate that an independently
//      configured EPSG:2154 reference computes for the same point?
//   2. When asked for a point, does the coordinate it reports address the pixel
//      the caller asked for?
//
// Question 2 is recorded as a measured delta with its cause stated, not asserted
// as a pass, because the artifact derives its sample coordinate from its own
// bounds mapping and that mapping is what is under measurement.
//
// Usage:
//   node scripts/raster-qualification/crs_probe.mjs \
//     --bench <scratch>/bench --fixtures <scratch>/fx \
//     --fixture derived/mnh_cog.tif \
//     --reference-points <json> --out <scratch>/out/q4-crs-probe.json

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
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

const CRS_PAGE = (input) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>crs probe</title>
<script type="importmap">${JSON.stringify({ imports: input.imports })}</script>
</head><body>
<input id="local-file" type="file" />
<script type="module">
window.__DONE__ = false;
window.__RUN__ = async function () {
  const out = { ok: false, error: null, samples: [], projection: null };
  try {
    const file = document.querySelector("#local-file").files[0];
    const m = await import("/ct/cog-tiler.js");
    await m.init();
    const source = await m.openCog(file);
    out.opened = { mode: source.mode, crsLabel: source.crsLabel,
                   boundsLonLat: source.boundsLonLat, levels: source.levels.length };

    // (1) Projection agreement: project the supplied reference WGS84 points and
    // compare against the reference that GDAL computed for the same points.
    const proj4mod = await import("proj4");
    const proj4 = proj4mod.default ?? proj4mod;
    const def = ${JSON.stringify(input.projDef)};
    out.projection = ${JSON.stringify(input.projectionChecks)}.map((check) => {
      const [east, north] = proj4(def, [check.lon, check.lat]);
      return { ...check, proj4: [east, north],
               deltaMetres: Math.hypot(east - check.reference[0], north - check.reference[1]) };
    });

    // (2) Pixel addressing: each request supplies the WGS84 coordinate that the
    // reference computes for a pixel centre. Record what the artifact returns.
    for (const request of ${JSON.stringify(input.pixelRequests)}) {
      try {
        const point = await source.point(request.lon, request.lat);
        out.samples.push({ ...request, returned: point });
      } catch (error) {
        out.samples.push({ ...request, error: String(error).slice(0, 200) });
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

async function main() {
  const args = parseArgs(process.argv);
  const bench = resolve(args.bench);
  const fixtures = resolve(args.fixtures);
  const port = await freePort();

  const reference = JSON.parse(readFileSync(args.referencePoints, "utf8"));
  const importMapPath = resolve(dirname(resolve(args.out)), "import-map-crs.json");
  const stubDir = resolve(dirname(importMapPath), "stubs");
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(resolve(stubDir, "node-builtin.js"), "export default {};\n");
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, [resolve(HARNESS, "ts/dist/src/importMap.js"),
      "--bench", bench, "--out", importMapPath], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", (code) =>
      (code === 0 ? done() : fail(new Error(`importMap.js exited ${code}`))));
  });
  const imports = JSON.parse(readFileSync(importMapPath, "utf8")).imports;
  for (const name of ["http", "https", "url", "fs", "fs/promises", "stream", "path",
                      "os", "buffer", "util", "zlib", "events", "crypto",
                      "worker_threads"]) {
    imports[name] = "/stub/node-builtin.js";
  }

  const server = spawn("python3", [resolve(HARNESS, "serve_bench.py"),
    "--bench", bench, "--fixtures", fixtures, "--import-map", importMapPath,
    "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });

  const results = { implementation: "cog-tiler-wasm openCog + proj4 projection engine" };
  try {
    await waitForServer(port);
    const { chromium } = await import(resolve(bench, "node_modules/playwright/index.mjs"));
    const browser = await chromium.launch({
      executablePath: args.chromiumExecutable || undefined,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    const pageHtml = CRS_PAGE({
      imports,
      projDef: reference.projDef,
      projectionChecks: reference.projectionChecks,
      pixelRequests: reference.pixelRequests,
    });
    const traceDir = resolve(stubDir, "crs");
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(resolve(traceDir, "index.html"), pageHtml);
    await page.goto(`http://127.0.0.1:${port}/stub/crs/index.html`, { waitUntil: "load" });
    await page.setInputFiles("#local-file", resolve(fixtures, args.fixture));
    await page.evaluate(() => window.__RUN__());
    await page.waitForFunction(() => window.__DONE__ === true, null, { timeout: 180000 });
    Object.assign(results, await page.evaluate(() => window.__RESULT__));
    results.pageErrors = errors;
    await browser.close();
  } catch (error) {
    results.error = String(error).slice(0, 600);
  } finally {
    const exited = new Promise((done) => server.on("exit", done));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
  }

  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(resolve(args.out), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify({
    out: resolve(args.out),
    ok: results.ok,
    error: results.error,
    projection: (results.projection || []).map((c) => ({
      label: c.label, deltaMetres: c.deltaMetres })),
    sampleCount: (results.samples || []).length,
    pageErrors: results.pageErrors,
  }, null, 2));
}

await main();
