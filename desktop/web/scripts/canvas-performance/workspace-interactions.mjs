import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

async function main() {
  const { values } = parseArgs({ options: {
    file: { type: 'string' },
    url: { type: 'string', default: 'http://127.0.0.1:1431/app/' },
  } })
  if (!values.file) throw new Error('Provide --file with a temporary v2 Design')
  const base = new URL(values.url)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new Error('Use a local Vite server')
  }

  const require = createRequire(import.meta.url)
  const { chromium } = require(process.env.CANOPI_PLAYWRIGHT_MODULE || 'playwright')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const entry = new URL('__workspace-interactions', base).href
    await page.route(entry, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;overflow:hidden"><div id="scene" style="position:relative;width:1200px;height:800px"></div></body></html>',
    }))
    await page.goto(entry)

    const file = JSON.parse(await readFile(values.file, 'utf8'))
    await page.evaluate(async ({ file, base }) => {
      const source = (name) => new URL(`src/${name}`, base).href
      await import(source('styles/global.css'))
      const { SceneCanvasRuntime } = await import(source('canvas/runtime/scene-runtime.ts'))
      const { MapLibreWorkspaceCameraOwner } = await import(source('maplibre/workspace-camera.ts'))
      const { createSharedMapSceneRendererComposition } = await import(source('maplibre/shared-scene-renderer.ts'))
      const { WorkspaceMapControls } = await import(source('app/canvas-map-surface/workspace-map-controls.ts'))
      const { WorkspaceActivationCoordinator } = await import(source('app/canvas-map-surface/workspace-activation.ts'))
      const container = document.querySelector('#scene')
      if (!(container instanceof HTMLElement)) throw new Error('Missing workspace container')
      const { CURRENT_CANOPI_FILE_VERSION } = await import(source('generated/canopi-design-format.ts'))
      if (file.version !== CURRENT_CANOPI_FILE_VERSION) throw new Error('Workspace interaction check requires a current-format Design')

      const camera = new MapLibreWorkspaceCameraOwner()
      const composition = createSharedMapSceneRendererComposition()
      const runtime = new SceneCanvasRuntime({
        camera,
        renderer: { backends: [composition.renderer] },
      })
      runtime.documentSurface.loadDocument(file)
      const controls = new WorkspaceMapControls({ container })
      const workspace = new WorkspaceActivationCoordinator({
        container,
        runtime,
        camera,
        composition,
        map: controls,
        layer: {},
        readOrigin: () => runtime.querySurface.sessionPlane.peek().origin,
      })
      const result = await workspace.activate({
        sessionIdentity: {},
        map: {
          initialCenter: runtime.querySurface.sessionPlane.peek().origin,
          basemapStyle: file.basemap_style ?? 'street',
          // The production map shell stays offline for this isolated check.
          basemapVisible: false,
          basemapOpacity: 1,
        },
      })
      if (result !== 'shared-ready') throw new Error(`Workspace activation returned ${result}`)
      runtime.commandSurface.viewport.zoomToFit()
      window.__workspaceInteraction = { runtime, workspace, camera, container }
    }, { file, base: base.href })

    const settle = () => page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))
    await settle()

    const before = await page.evaluate(() => window.__workspaceInteraction.camera.snapshot.value.viewport)
    await page.mouse.move(600, 400)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(630, 420, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await settle()
    const panned = await page.evaluate(() => window.__workspaceInteraction.camera.snapshot.value.viewport)
    assert.equal(sameViewport(panned, before), false, 'middle-button pan changes the map-backed frame')

    await page.mouse.wheel(0, -120)
    await settle()
    const zoomed = await page.evaluate(() => window.__workspaceInteraction.camera.snapshot.value.viewport)
    assert.notEqual(zoomed.scale, panned.scale, 'wheel changes the map-backed frame')

    const target = await page.evaluate(() => {
      const runtime = window.__workspaceInteraction.runtime
      runtime.commandSurface.tools.setTool('select')
      const scene = runtime.querySurface.getSceneSnapshot()
      const viewport = runtime.querySurface.viewport.value.viewport
      for (const plant of scene.plants) {
        const x = plant.position.x * viewport.scale + viewport.x
        const y = plant.position.y * viewport.scale + viewport.y
        if (plant.locked || x < 50 || y < 50 || x > 1150 || y > 750) continue
        return { id: plant.id, x, y, position: plant.position }
      }
      throw new Error('No editable visible Plant suitable for the interaction check')
    })

    await page.mouse.click(target.x, target.y)
    await settle()
    const selected = await page.evaluate(() =>
      window.__workspaceInteraction.runtime.querySurface.getSelection())
    assert.equal(
      selected.length === 1 && selected[0]?.kind === 'plant' && selected[0]?.id === target.id,
      true,
      'select chooses the visible Plant',
    )

    const beforeToolDrag = await page.evaluate(() =>
      window.__workspaceInteraction.camera.snapshot.value.viewport)
    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await page.mouse.move(target.x + 35, target.y + 20, { steps: 10 })
    await page.mouse.up()
    await settle()
    const moved = await page.evaluate((id) =>
      window.__workspaceInteraction.runtime.querySurface.getSceneSnapshot().plants.find((plant) => plant.id === id).position,
    target.id)
    assert.equal(samePoint(moved, target.position), false, 'tool drag commits a Scene edit')
    assert.equal(sameViewport(await page.evaluate(() =>
      window.__workspaceInteraction.camera.snapshot.value.viewport),
    beforeToolDrag), true, 'tool drag leaves the map-backed frame unchanged')
    await page.evaluate(() => window.__workspaceInteraction.runtime.commandSurface.history.undo())
    await settle()
    assert.equal(samePoint(await page.evaluate((id) =>
      window.__workspaceInteraction.runtime.querySurface.getSceneSnapshot().plants.find((plant) => plant.id === id).position,
    target.id), target.position), true, 'undo restores the Scene edit')

    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await page.mouse.move(target.x + 35, target.y + 20, { steps: 4 })
    const captureReleased = await page.evaluate(() => {
      const { container } = window.__workspaceInteraction
      if (!container.hasPointerCapture(1)) return false
      container.releasePointerCapture(1)
      return true
    })
    assert.equal(captureReleased, true, 'the Scene Interaction container owns pointer capture')
    await page.mouse.up()
    await settle()
    assert.equal(samePoint(await page.evaluate((id) =>
      window.__workspaceInteraction.runtime.querySurface.getSceneSnapshot().plants.find((plant) => plant.id === id).position,
    target.id), target.position), true, 'capture loss rolls back an unfinished Scene edit')

    await page.evaluate(async () => {
      const { workspace } = window.__workspaceInteraction
      await workspace.teardown()
    })
    assert.equal(await page.locator('canvas[data-canopi-renderer], .maplibregl-canvas').count(), 0)
    console.log(JSON.stringify({
      passed: ['pointer pan', 'wheel zoom', 'select', 'tool drag', 'undo', 'capture loss', 'teardown'],
    }))
  } finally {
    await browser.close()
  }
}

function samePoint(left, right) {
  return left.x === right.x && left.y === right.y
}

function sameViewport(left, right) {
  return samePoint(left, right) && left.scale === right.scale
}

main().catch(() => {
  console.error('workspace interaction check failed')
  process.exitCode = 1
})
