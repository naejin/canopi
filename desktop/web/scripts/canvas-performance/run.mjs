import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:1431/app/' },
  file: { type: 'string' }, output: { type: 'string' },
  browser: { type: 'string', default: 'chromium' },
  dpr: { type: 'string', default: '1' }, headed: { type: 'boolean', default: false },
  screenshots: { type: 'string' },
} })
const url = new URL(values.url)
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use a local Vite server')
const dpr = Number(values.dpr)
if (!(dpr >= 1 && dpr <= 3)) throw new Error('DPR must be between 1 and 3')
const require = createRequire(import.meta.url)
const playwright = require(process.env.CANOPI_PLAYWRIGHT_MODULE || 'playwright')
if (!['chromium', 'firefox', 'webkit'].includes(values.browser)) throw new Error('Unknown browser')
const browser = await playwright[values.browser].launch({
  headless: !values.headed,
  ...(values.browser === 'chromium' ? { channel: 'chrome' } : {}),
})
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr })
  const entry = new URL('__canvas-performance', url).href
  await page.route(entry, route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><div id="scene" style="position:relative;width:1200px;height:800px"></div></body></html>' }))
  await page.goto(entry)
  const file = values.file ? JSON.parse(await readFile(values.file, 'utf8')) : null
  const result = await page.evaluate(async ({ file, base }) => {
    const source = name => new URL(`src/${name}`, base).href
    await import(source('styles/global.css'))
    const { refreshCanvasColorCache } = await import(source('canvas/theme-refresh.ts'))
    refreshCanvasColorCache(document.querySelector('#scene'))
    const { hydrateScenePersistedState } = await import(source('canvas/runtime/scene/codec.ts'))
    const { createTestSceneRendererSnapshot: makeSnapshot } = await import(source('__tests__/support/scene-renderer-snapshot.ts'))
    const { createPixiSceneRenderer } = await import(source('canvas/runtime/renderers/pixi-scene.ts'))
    const { createCanvas2DSceneRenderer } = await import(source('canvas/runtime/renderers/canvas2d-scene.ts'))
    const { RendererHost } = await import(source('canvas/runtime/renderers/host.ts'))
    const { hitTestVisibleTopLevel } = await import(source('canvas/runtime/interaction/hit-testing.ts'))
    const scene = file ? hydrateScenePersistedState(file) : makeSnapshot({ scene: {
      plants: Array.from({ length: 2200 }, (_, i) => ({ kind: 'plant', id: `plant-${i}`, locked: false,
        canonicalName: `Species ${i % 12}`, commonName: `Plant ${i % 12}`, color: '#69804a',
        symbol: ['shrub', 'herb', 'canopy', 'groundcover'][i % 4], stratum: null, canopySpreadM: null,
        position: { x: (i % 44) * .6, y: Math.floor(i / 44) * .55 }, rotationDeg: null,
        scale: null, notes: null, plantedDate: null, quantity: 1,
      })),
    } }).scene
    const host = new RendererHost({ backends: [createPixiSceneRenderer(), createCanvas2DSceneRenderer()] })
    await host.initialize({ container: document.querySelector('#scene') })
    const canvas = document.querySelector('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    const extension = gl?.getExtension('WEBGL_debug_renderer_info')
    const metadata = { backend: host.snapshot, gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      dpr: devicePixelRatio, width: 1200, height: 800, userAgent: navigator.userAgent,
      counts: { plants: scene.plants.length, zones: scene.zones.length, annotations: scene.annotations.length, guides: scene.measurementGuides.length } }
    // Instrument the actual Vite-resolved Pixi module, also on an older comparison checkout.
    const pixiSource = await (await fetch(source('canvas/runtime/renderers/pixi-scene.ts'))).text()
    const pixiUrl = pixiSource.match(/from ["']([^"']*pixi__js[^"']*)["']/)?.[1]
    if (!pixiUrl) throw new Error('Cannot locate the Vite Pixi module')
    const pixi = await import(new URL(pixiUrl, base).href)
    let clears = 0, renders = 0
    const clear = pixi.Graphics.prototype.clear, render = pixi.Application.prototype.render
    pixi.Graphics.prototype.clear = function(...args) { clears++; return clear.apply(this, args) }
    pixi.Application.prototype.render = function(...args) { renders++; return render.apply(this, args) }
    const traceEvents = [], results = []
    const samples = 30, warmup = 5
    try {
      await host.run(async renderer => {
        const origin = { x: 0, y: 0, scale: 30 }
        const cases = [
          ['pan', i => renderer.setViewport({ ...origin, x: i * 2 })],
          ['zoom', i => renderer.setViewport({ ...origin, scale: 30 + 20 * Math.sin(i / 8) })],
          ['zoom-detail', i => renderer.setViewport({ ...origin, scale: 100 + 30 * Math.sin(i / 8) })],
          ['hover', i => {
            const plant = scene.plants[i % scene.plants.length]
            const context = { plants: scene.plants, viewport: origin, speciesCache: new Map() }
            const target = hitTestVisibleTopLevel(scene, plant.position, origin.scale, context.speciesCache, () => context, [], null)
            renderer.renderScene(makeSnapshot({ scene, viewport: origin,
              hoveredCanonicalName: target?.kind === 'plant' ? plant.canonicalName : null,
              hoverTarget: target ? { ...target, state: 'hover' } : null }))
          }],
          ['selection', i => renderer.renderScene(makeSnapshot({ scene, viewport: origin,
            selectedTargets: [{ kind: 'plant', id: scene.plants[i % scene.plants.length].id }] }))],
          ['move', i => {
            const plants = scene.plants.map((p, index) => index === 0 ? { ...p, position: { x: p.position.x + i * .01, y: p.position.y } } : p)
            renderer.renderScene(makeSnapshot({ scene: { ...scene, plants }, viewport: origin,
              selectedTargets: [{ kind: 'plant', id: plants[0].id }] }))
          }],
          ['offscreen', i => renderer.setViewport({ ...origin, x: 100000 + i * 2 })],
        ]
        if (!scene.plants.length) throw new Error('Benchmark needs at least one plant')
        for (const [name, operation] of cases) {
          renderer.renderScene(makeSnapshot({ scene, viewport: origin }))
          const times = [], frames = []
          for (let i = 0; i < warmup + samples; i++) {
            await new Promise(requestAnimationFrame)
            clears = 0; renders = 0
            const start = performance.now()
            operation(i)
            const duration = performance.now() - start
            if (i < warmup) continue
            times.push(duration); frames.push({ clears, renders })
            traceEvents.push({ name, cat: 'canopi.canvas', ph: 'X', pid: 1, tid: 1, ts: start * 1000, dur: duration * 1000 })
          }
          times.sort((a, b) => a - b)
          results.push({ operation: name, samples, medianMs: times[15], p95Ms: times[28],
            clearsPerUpdate: frames.reduce((n, f) => n + f.clears, 0) / samples,
            rendersPerUpdate: frames.reduce((n, f) => n + f.renders, 0) / samples })
        }
        renderer.renderScene(makeSnapshot({ scene, viewport: origin }))
        // Retained only until this isolated browser closes, for optional visual comparisons.
        window.__benchmarkViewport = viewport => renderer.setViewport(viewport)
      })
    } finally {
      pixi.Graphics.prototype.clear = clear
      pixi.Application.prototype.render = render
    }
    return { metadata, results, traceEvents }
  }, { file, base: url.href })
  result.revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  result.workingTreeDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  result.note = 'Renderer/hit-test workload; excludes document transactions, IPC and GPU completion. Compare like-for-like browser/GPU/DPR and warm-up.'
  if (values.output) await writeFile(values.output, JSON.stringify(result, null, 2))
  if (values.screenshots) {
    for (const scale of [10, 30, 100]) {
      await page.evaluate(scale => window.__benchmarkViewport({ x: 0, y: 0, scale }), scale)
      await page.screenshot({ path: `${values.screenshots}-${scale}.png` })
    }
  }
  console.log(JSON.stringify({ ...result, traceEvents: undefined }, null, 2))
} finally {
  await browser.close()
}
