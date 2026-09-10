import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  backend: { type: 'string', default: 'auto' },
  file: { type: 'string' }, url: { type: 'string', default: 'http://127.0.0.1:1431/app/' },
} })
if (!['auto', 'canvas2d'].includes(values.backend)) throw new Error('Unknown backend')
if (!values.file) throw new Error('Provide --file with a local design')
const base = new URL(values.url)
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Use a local Vite server')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.CANOPI_PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  if (values.backend === 'canvas2d') await page.addInitScript(() => {
    // Exercise the production fallback by emulating unavailable WebGL contexts.
    for (const prototype of [HTMLCanvasElement.prototype, ...(typeof OffscreenCanvas === 'undefined' ? [] : [OffscreenCanvas.prototype])]) {
      const getContext = prototype.getContext
      prototype.getContext = function(type, ...args) {
        return ['webgl', 'webgl2', 'experimental-webgl'].includes(type) ? null : getContext.call(this, type, ...args)
      }
    }
  })
  const entry = new URL('__canvas-interactions', base).href
  await page.route(entry, route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><div id="scene" style="position:relative;width:1200px;height:800px"></div></body></html>' }))
  await page.goto(entry)
  await page.evaluate(async ({ file, base }) => {
    const source = name => new URL(`src/${name}`, base).href
    await import(source('styles/global.css'))
    const { SceneCanvasRuntime } = await import(source('canvas/runtime/scene-runtime.ts'))
    const runtime = new SceneCanvasRuntime()
    await runtime.init(document.querySelector('#scene'))
    runtime.documentSurface.loadDocument(file)
    runtime.commandSurface.viewport.zoomToFit()
    window.__interactionRuntime = runtime
    window.__interactionHitTest = (await import(source('canvas/runtime/interaction/hit-testing.ts'))).hitTestVisibleTopLevel
  }, { file: JSON.parse(await readFile(values.file, 'utf8')), base: base.href })
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await settle()
  const before = await page.evaluate(() => window.__interactionRuntime.querySurface.viewport.value.viewport)
  await page.mouse.move(600, 400)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(630, 420, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  await settle()
  const panned = await page.evaluate(() => window.__interactionRuntime.querySurface.viewport.value.viewport)
  assert.notEqual(panned.x, before.x, 'middle-button pan changes viewport')
  await page.mouse.wheel(0, -120)
  await settle()
  const zoomed = await page.evaluate(() => window.__interactionRuntime.querySurface.viewport.value.viewport)
  assert.notEqual(zoomed.scale, panned.scale, 'wheel changes zoom')
  const target = await page.evaluate(() => {
    const runtime = window.__interactionRuntime
    runtime.commandSurface.tools.setTool('select')
    const scene = runtime.querySurface.getSceneSnapshot()
    const viewport = runtime.querySurface.viewport.value.viewport
    const context = { plants: scene.plants, viewport, speciesCache: new Map() }
    for (const plant of scene.plants) {
      const x = plant.position.x * viewport.scale + viewport.x
      const y = plant.position.y * viewport.scale + viewport.y
      if (plant.locked || x < 50 || y < 50 || x > 1150 || y > 750) continue
      const hit = window.__interactionHitTest(scene, plant.position, viewport.scale, context.speciesCache, () => context, [], null)
      if (hit?.kind === 'plant' && hit.id === plant.id) return { id: plant.id, x, y, position: plant.position }
    }
    throw new Error('No editable visible plant suitable for the interaction smoke test')
  })
  await page.mouse.move(target.x, target.y)
  await page.mouse.click(target.x, target.y)
  await settle()
  assert.deepEqual(await page.evaluate(() => window.__interactionRuntime.querySurface.getSelection()), [{ kind: 'plant', id: target.id }])
  await page.mouse.move(target.x, target.y)
  await page.mouse.down()
  await page.mouse.move(target.x + 35, target.y + 20, { steps: 10 })
  await page.mouse.up()
  await settle()
  const moved = await page.evaluate(id => window.__interactionRuntime.querySurface.getSceneSnapshot().plants.find(p => p.id === id).position, target.id)
  assert.notDeepEqual(moved, target.position, 'pointer drag commits movement')
  await page.evaluate(() => window.__interactionRuntime.commandSurface.history.undo())
  await settle()
  assert.deepEqual(await page.evaluate(id => window.__interactionRuntime.querySurface.getSceneSnapshot().plants.find(p => p.id === id).position, target.id), target.position)
  const backend = await page.locator('canvas[data-canopi-renderer]').first().getAttribute('data-canopi-renderer')
  if (values.backend === 'canvas2d') assert.equal(backend, 'canvas2d')
  await page.evaluate(() => window.__interactionRuntime.destroy())
  assert.equal(await page.locator('canvas[data-canopi-renderer]').count(), 0)
  console.log(JSON.stringify({ backend, passed: ['pointer pan', 'wheel zoom', 'hover/select', 'pointer drag', 'undo', 'teardown'] }))
} finally {
  await browser.close()
}
