import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'

const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:1431/app/' },
  file: { type: 'string' },
  output: { type: 'string' },
  dpr: { type: 'string', default: '1' },
  headed: { type: 'boolean', default: false },
  screenshots: { type: 'string' },
  baseline: { type: 'string' },
} })

if (!values.file) throw new Error('A representative --file is required')
const url = new URL(values.url)
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use a local Vite server')
const dpr = Number(values.dpr)
if (!(dpr >= 1 && dpr <= 3)) throw new Error('DPR must be between 1 and 3')

const require = createRequire(import.meta.url)
const playwright = require(process.env.CANOPI_PLAYWRIGHT_MODULE || 'playwright')
const browser = await playwright.chromium.launch({ headless: !values.headed, channel: 'chrome' })

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr })
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    const webglContexts = new Set()
    const webglCanvases = new Set()
    const webglRequests = []
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const context = original.call(this, type, ...args)
      if ((type === 'webgl' || type === 'webgl2') && context) {
        webglContexts.add(context)
        webglCanvases.add(this)
        webglRequests.push({ type, canvasId: this.id, connected: this.isConnected })
      }
      return context
    }
    window.__v2WebglContexts = webglContexts
    window.__v2WebglCanvases = webglCanvases
    window.__v2WebglRequests = webglRequests
  })

  const entry = new URL('__v2-shared-map-scene', url).href
  await page.route(entry, route => route.fulfill({
    contentType: 'text/html',
    body: '<html><body style="margin:0;overflow:hidden"><div id="scene" style="position:relative;width:1200px;height:800px;visibility:hidden"></div></body></html>',
  }))
  let externalRequestCount = 0
  page.on('request', request => {
    const requestUrl = new URL(request.url())
    if (!['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname) && !['data:', 'blob:'].includes(requestUrl.protocol)) {
      externalRequestCount += 1
    }
  })
  await page.goto(entry)

  const file = JSON.parse(await readFile(values.file, 'utf8'))
  const setup = await page.evaluate(async ({ file, base }) => {
    const source = name => new URL(`src/${name}`, base).href
    await import(source('styles/global.css'))
    const { loadMapLibreModule } = await import(source('maplibre/loader.ts'))
    const { createSharedMapSceneLayer } = await import(source('maplibre/shared-scene-layer.ts'))
    const { hydrateScenePersistedState } = await import(source('canvas/runtime/scene/codec.ts'))
    const { createTestSceneRendererSnapshot } = await import(source('__tests__/support/scene-renderer-snapshot.ts'))
    const { worldToGeo, geoToWorld, stageScaleToMapZoom } = await import(source('canvas/projection.ts'))
    const { maplibreBearingFromNorthBearing } = await import(source('canvas/maplibre-camera.ts'))
    const pixiVersion = '8.17.1'

    const container = document.querySelector('#scene')
    const anchor = {
      lat: file.spatial_frame.anchor_latitude_deg,
      lon: file.spatial_frame.anchor_longitude_deg,
    }
    const northBearingDeg = file.spatial_frame.north_bearing_deg
    const scene = hydrateScenePersistedState(file)
    if (!scene.plants.length) throw new Error('Representative scene has no Plants')

    const points = []
    for (const plant of scene.plants) points.push(plant.position)
    for (const zone of scene.zones) points.push(...zone.points)
    for (const guide of scene.measurementGuides) points.push(guide.start, guide.end)
    for (const annotation of scene.annotations) points.push(annotation.position)
    const bounds = points.reduce((value, point) => ({
      minX: Math.min(value.minX, point.x), minY: Math.min(value.minY, point.y),
      maxX: Math.max(value.maxX, point.x), maxY: Math.max(value.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) throw new Error('Representative scene has no finite geometry')
    const padding = Math.max(5, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.05)
    const qualifiedExtent = Math.max(1, ...points.flatMap(point => [Math.abs(point.x), Math.abs(point.y)]))
    const control = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    const center = worldToGeo(control.x, control.y, anchor.lat, anchor.lon, northBearingDeg)
    const maplibre = await loadMapLibreModule()
    const map = new maplibre.Map({
      container,
      center: [center.lng, center.lat],
      zoom: stageScaleToMapZoom(30, anchor.lat),
      bearing: maplibreBearingFromNorthBearing(northBearingDeg),
      pitch: 0,
      interactive: true,
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    })
    const waitForMapEvent = (eventName, label, timeoutMs = 10_000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)
      map.once(eventName, event => {
        clearTimeout(timer)
        resolve(event)
      })
    })
    const canvas = map.getCanvas()
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('MapLibre did not create WebGL2')
    const loseExtension = gl.getExtension('WEBGL_lose_context')
    const debugExtension = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = debugExtension ? gl.getParameter(debugExtension.UNMASKED_RENDERER_WEBGL) : null
    let lossCallCount = 0
    if (loseExtension) {
      const originalLose = loseExtension.loseContext.bind(loseExtension)
      loseExtension.loseContext = () => {
        lossCallCount += 1
        originalLose()
      }
    }
    let customClearCount = 0
    let insideCustomLayer = false
    const originalClear = gl.clear.bind(gl)
    gl.clear = mask => {
      if (insideCustomLayer) customClearCount += 1
      originalClear(mask)
    }

    const adapter = createSharedMapSceneLayer({
      id: 'experiment-design',
      anchor,
      northBearingDeg,
      maximumWorldExtentMeters: qualifiedExtent,
    })
    await adapter.initialize(map, gl)
    const customRender = adapter.layer.render.bind(adapter.layer)
    adapter.layer.render = (context, options) => {
      insideCustomLayer = true
      try { customRender(context, options) } finally { insideCustomLayer = false }
    }

    function makeRaster(id, first, second) {
      const raster = document.createElement('canvas')
      raster.id = id
      raster.width = 32
      raster.height = 32
      raster.style.display = 'none'
      const context = raster.getContext('2d')
      context.fillStyle = first
      context.fillRect(0, 0, 32, 32)
      context.fillStyle = second
      for (let index = -32; index < 64; index += 8) context.fillRect(index, 0, 3, 32)
      document.body.appendChild(raster)
      return raster
    }
    const lidarSourceCanvas = makeRaster('experiment-lidar-source-canvas', '#6e5f51', '#9b8975')
    const lidarAnalysisCanvas = makeRaster('experiment-lidar-analysis-canvas', 'rgba(190,113,36,.15)', 'rgba(190,113,36,.42)')
    const rasterCorners = [
      worldToGeo(bounds.minX - padding, bounds.minY - padding, anchor.lat, anchor.lon, northBearingDeg),
      worldToGeo(bounds.maxX + padding, bounds.minY - padding, anchor.lat, anchor.lon, northBearingDeg),
      worldToGeo(bounds.maxX + padding, bounds.maxY + padding, anchor.lat, anchor.lon, northBearingDeg),
      worldToGeo(bounds.minX - padding, bounds.maxY + padding, anchor.lat, anchor.lon, northBearingDeg),
    ].map(point => [point.lng, point.lat])
    const referenceGeo = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...rasterCorners, rasterCorners[0]]] } }],
    }
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    const gridStep = Math.max(1, 10 ** Math.floor(Math.log10(Math.max(1, span / 20))))
    const gridFeatures = []
    for (let x = Math.floor((bounds.minX - padding) / gridStep) * gridStep; x <= bounds.maxX + padding; x += gridStep) {
      const a = worldToGeo(x, bounds.minY - padding, anchor.lat, anchor.lon, northBearingDeg)
      const b = worldToGeo(x, bounds.maxY + padding, anchor.lat, anchor.lon, northBearingDeg)
      gridFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } })
    }
    for (let y = Math.floor((bounds.minY - padding) / gridStep) * gridStep; y <= bounds.maxY + padding; y += gridStep) {
      const a = worldToGeo(bounds.minX - padding, y, anchor.lat, anchor.lon, northBearingDeg)
      const b = worldToGeo(bounds.maxX + padding, y, anchor.lat, anchor.lon, northBearingDeg)
      gridFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } })
    }
    const gridGeo = { type: 'FeatureCollection', features: gridFeatures }
    const controlGeo = worldToGeo(control.x, control.y, anchor.lat, anchor.lon, northBearingDeg)
    const calibrationGeo = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [controlGeo.lng, controlGeo.lat] } }] }
    const baseStyle = () => ({
      version: 8,
      sources: {},
      layers: [{ id: 'experiment-basemap', type: 'background', paint: { 'background-color': '#e5dcc7' } }],
    })
    const expectedOrder = [
      'experiment-basemap', 'experiment-lidar-source', 'experiment-lidar-analysis',
      'experiment-reference', 'experiment-grid', 'experiment-alignment-reference', 'experiment-design',
    ]
    let stackInstallCount = 0
    const installStack = () => {
      if (map.getLayer('experiment-design')) return
      if (!map.getSource('experiment-lidar-source-data')) {
        map.addSource('experiment-lidar-source-data', { type: 'canvas', canvas: lidarSourceCanvas.id, coordinates: rasterCorners, animate: false })
      }
      if (!map.getLayer('experiment-lidar-source')) {
        map.addLayer({ id: 'experiment-lidar-source', type: 'raster', source: 'experiment-lidar-source-data', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } })
      }
      if (!map.getSource('experiment-lidar-analysis-data')) {
        map.addSource('experiment-lidar-analysis-data', { type: 'canvas', canvas: lidarAnalysisCanvas.id, coordinates: rasterCorners, animate: false })
      }
      if (!map.getLayer('experiment-lidar-analysis')) {
        map.addLayer({ id: 'experiment-lidar-analysis', type: 'raster', source: 'experiment-lidar-analysis-data', paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 } })
      }
      if (!map.getSource('experiment-reference-data')) map.addSource('experiment-reference-data', { type: 'geojson', data: referenceGeo })
      if (!map.getLayer('experiment-reference')) {
        map.addLayer({ id: 'experiment-reference', type: 'line', source: 'experiment-reference-data', paint: { 'line-color': '#f7f1e5', 'line-width': 5 } })
      }
      if (!map.getSource('experiment-grid-data')) map.addSource('experiment-grid-data', { type: 'geojson', data: gridGeo })
      if (!map.getLayer('experiment-grid')) {
        map.addLayer({ id: 'experiment-grid', type: 'line', source: 'experiment-grid-data', paint: { 'line-color': '#f9edcf', 'line-width': 1.5, 'line-opacity': 0.9 } })
      }
      if (!map.getSource('experiment-alignment-reference-data')) {
        map.addSource('experiment-alignment-reference-data', { type: 'geojson', data: calibrationGeo })
      }
      if (!map.getLayer('experiment-alignment-reference')) {
        map.addLayer({ id: 'experiment-alignment-reference', type: 'circle', source: 'experiment-alignment-reference-data', paint: {
          'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#00ffff', 'circle-stroke-width': 3,
        } })
      }
      if (!map.getLayer(adapter.layer.id)) map.addLayer(adapter.layer)
      stackInstallCount += 1
    }
    const installAfterContextRestore = () => {
      if (map.isStyleLoaded()) installStack()
      else map.once('style.load', installStack)
    }
    map.on('style.load', installStack)
    map.on('webglcontextrestored', installAfterContextRestore)

    const representativeSnapshot = createTestSceneRendererSnapshot({
      scene,
      selectedTargets: [{ kind: 'plant', id: scene.plants[0].id }],
    })
    const calibrationPlant = {
      ...scene.plants[0],
      id: 'experiment-calibration-plant',
      canonicalName: 'Calibration',
      commonName: null,
      color: '#ff00ff',
      symbol: 'round',
      position: control,
      scale: 0.35,
      locked: false,
    }
    const calibrationSnapshot = createTestSceneRendererSnapshot({
      scene: { ...scene, plants: [calibrationPlant], zones: [], annotations: [], measurementGuides: [], groups: [], guides: [] },
    })
    adapter.setSnapshot(representativeSnapshot)
    const styleLoaded = waitForMapEvent('style.load', 'initial MapLibre style load')
    map.setStyle(baseStyle(), { diff: false })
    await styleLoaded

    const geoBounds = rasterCorners.reduce((value, point) => ({
      west: Math.min(value.west, point[0]), south: Math.min(value.south, point[1]),
      east: Math.max(value.east, point[0]), north: Math.max(value.north, point[1]),
    }), { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity })
    map.fitBounds([[geoBounds.west, geoBounds.south], [geoBounds.east, geoBounds.north]], { padding: 60, duration: 0 })
    await waitForMapEvent('idle', 'initial MapLibre idle')
    map.triggerRepaint()
    await new Promise(resolve => map.once('render', resolve))
    container.style.visibility = 'visible'

    function layerOrder() {
      // Style serialization deliberately excludes custom layers. The private order
      // is used only by this version-pinned experiment to verify actual painter order.
      const ids = (map.style?._order ?? map.getStyle().layers.map(layer => layer.id))
        .filter(id => id.startsWith('experiment-'))
      return ids
    }
    function readAlignment() {
      const width = canvas.width
      const height = canvas.height
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      const colors = {
        cyan: { x: 0, y: 0, count: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        magenta: { x: 0, y: 0, count: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      }
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4
          const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2], a = pixels[index + 3]
          let target = null
          if (a > 128 && r < 70 && g > 180 && b > 180) target = colors.cyan
          else if (a > 128 && r > 180 && g < 90 && b > 180) target = colors.magenta
          if (target) {
            const screenY = height - 1 - y
            target.x += x
            target.y += screenY
            target.count += 1
            target.minX = Math.min(target.minX, x)
            target.minY = Math.min(target.minY, screenY)
            target.maxX = Math.max(target.maxX, x)
            target.maxY = Math.max(target.maxY, screenY)
          }
        }
      }
      const xRatio = width / canvas.clientWidth
      const yRatio = height / canvas.clientHeight
      const centroid = value => value.count ? { x: value.x / value.count / xRatio, y: value.y / value.count / yRatio } : null
      const boundsCenter = value => value.count ? {
        x: (value.minX + value.maxX) / 2 / xRatio,
        y: (value.minY + value.maxY) / 2 / yRatio,
      } : null
      const cyan = centroid(colors.cyan)
      const magenta = centroid(colors.magenta)
      const cyanBoundsCenter = boundsCenter(colors.cyan)
      const magentaBoundsCenter = boundsCenter(colors.magenta)
      return {
        cyanPixels: colors.cyan.count,
        magentaPixels: colors.magenta.count,
        errorCssPx: cyanBoundsCenter && magentaBoundsCenter
          ? Math.hypot(cyanBoundsCenter.x - magentaBoundsCenter.x, cyanBoundsCenter.y - magentaBoundsCenter.y)
          : null,
        centroidErrorCssPx: cyan && magenta ? Math.hypot(cyan.x - magenta.x, cyan.y - magenta.y) : null,
      }
    }
    async function captureAlignment() {
      const rendered = waitForMapEvent('render', 'alignment render')
      map.triggerRepaint()
      await rendered
      return readAlignment()
    }
    async function setCalibrationMode(enabled) {
      adapter.setSnapshot(enabled ? calibrationSnapshot : representativeSnapshot)
      await waitForMapEvent('render', 'scene snapshot render')
    }
    async function collectLiveAlignment() {
      await setCalibrationMode(true)
      const samples = []
      const listener = () => {
        const sample = readAlignment()
        if (sample.errorCssPx !== null) samples.push(sample)
      }
      map.on('render', listener)
      map.easeTo({ zoom: map.getZoom() + 0.75, center: [controlGeo.lng, controlGeo.lat], duration: 450 })
      await waitForMapEvent('moveend', 'alignment camera movement')
      map.off('render', listener)
      samples.push(await captureAlignment())
      return samples
    }
    async function reloadStyle() {
      const loaded = waitForMapEvent('style.load', 'replacement MapLibre style load')
      map.setStyle(baseStyle(), { diff: false })
      await loaded
      await waitForMapEvent('idle', 'replacement MapLibre idle')
      const firstFrame = await captureAlignment()
      const settled = await captureAlignment()
      return { firstFrame, settled }
    }
    async function forceContextCycle() {
      if (!loseExtension) return { supported: false }
      const restored = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebGL context restoration timed out')), 10_000)
        map.once('webglcontextrestored', event => { clearTimeout(timer); resolve(event) })
      })
      loseExtension.loseContext()
      setTimeout(() => loseExtension.restoreContext(), 100)
      await restored
      if (!map.isStyleLoaded()) await waitForMapEvent('style.load', 'restored MapLibre style load')
      if (!map.getLayer(adapter.layer.id)) installStack()
      if (!map.loaded()) await waitForMapEvent('idle', 'restored MapLibre idle')
      return { supported: true, alignment: await captureAlignment() }
    }
    function percentile(values, percentileValue) {
      if (!values.length) return null
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))]
    }
    async function measureCameraFrames() {
      await setCalibrationMode(false)
      const warmup = 5
      const samples = 30
      const restoreCenter = map.getCenter()
      const restoreCamera = { center: [restoreCenter.lng, restoreCenter.lat], zoom: map.getZoom() }
      const cameraForViewport = viewport => {
        const centerWorld = {
          x: (canvas.clientWidth / 2 - viewport.x) / viewport.scale,
          y: (canvas.clientHeight / 2 - viewport.y) / viewport.scale,
        }
        const nextCenter = worldToGeo(centerWorld.x, centerWorld.y, anchor.lat, anchor.lon, northBearingDeg)
        return {
          center: [nextCenter.lng, nextCenter.lat],
          zoom: stageScaleToMapZoom(viewport.scale, anchor.lat),
        }
      }
      const cases = [
        ['pan', index => cameraForViewport({ x: index * 2, y: 0, scale: 30 })],
        ['zoom', index => cameraForViewport({ x: 0, y: 0, scale: 30 + 20 * Math.sin(index / 8) })],
      ]
      const results = []
      for (const [name, cameraForIndex] of cases) {
        const wallTimes = []
        const submissionTimes = []
        for (let index = 0; index < warmup + samples; index += 1) {
          const beforeRenderCount = adapter.diagnostics.renderCount
          const startedAt = performance.now()
          const rendered = new Promise(resolve => map.once('render', resolve))
          map.jumpTo(cameraForIndex(index))
          await rendered
          if (adapter.diagnostics.renderCount <= beforeRenderCount) throw new Error(`${name} update did not render the shared scene`)
          const duration = performance.now() - startedAt
          const recent = adapter.diagnostics.recentRenderDurationsMs
          if (index >= warmup) {
            wallTimes.push(duration)
            submissionTimes.push(recent[recent.length - 1])
          }
        }
        results.push({
          operation: name,
          samples,
          p50FrameWallMs: percentile(wallTimes, 0.5),
          p95FrameWallMs: percentile(wallTimes, 0.95),
          p99FrameWallMs: percentile(wallTimes, 0.99),
          p50SubmissionMs: percentile(submissionTimes, 0.5),
          p95SubmissionMs: percentile(submissionTimes, 0.95),
          p99SubmissionMs: percentile(submissionTimes, 0.99),
        })
      }
      const restored = waitForMapEvent('render', 'post-performance camera restore')
      map.jumpTo(restoreCamera)
      await restored
      return results
    }
    async function resizeAndCapture(width, height) {
      container.style.width = `${width}px`
      container.style.height = `${height}px`
      map.resize()
      return captureAlignment()
    }
    async function lateInsertAndOrder() {
      map.addLayer({ id: 'experiment-lidar-late', type: 'raster', source: 'experiment-lidar-source-data', paint: { 'raster-opacity': 0.1 } })
      map.moveLayer('experiment-lidar-late', 'experiment-reference')
      const order = layerOrder()
      map.removeLayer('experiment-lidar-late')
      return order
    }
    async function beginToolDrag() {
      await setCalibrationMode(false)
      map.dragPan.disable()
      const plant = scene.plants.reduce((closest, candidate) => {
        const closestDistance = Math.hypot(closest.position.x - control.x, closest.position.y - control.y)
        const candidateDistance = Math.hypot(candidate.position.x - control.x, candidate.position.y - control.y)
        return candidateDistance < closestDistance ? candidate : closest
      })
      const plantGeo = worldToGeo(plant.position.x, plant.position.y, anchor.lat, anchor.lon, northBearingDeg)
      const screen = map.project(plantGeo)
      const startCenter = map.getCenter()
      let currentSnapshot = representativeSnapshot
      let dragging = false
      const toLocal = event => {
        const rect = canvas.getBoundingClientRect()
        const geo = map.unproject([event.clientX - rect.left, event.clientY - rect.top])
        return geoToWorld(geo.lng, geo.lat, anchor.lat, anchor.lon, northBearingDeg)
      }
      const down = event => {
        dragging = true
        canvas.setPointerCapture(event.pointerId)
        event.preventDefault()
      }
      const move = event => {
        if (!dragging) return
        const position = toLocal(event)
        const plants = currentSnapshot.scene.plants.map(item => item.id === plant.id ? { ...item, position } : item)
        currentSnapshot = { ...currentSnapshot, scene: { ...currentSnapshot.scene, plants } }
        adapter.setSnapshot(currentSnapshot)
        event.preventDefault()
      }
      const up = event => {
        dragging = false
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        event.preventDefault()
      }
      canvas.addEventListener('pointerdown', down)
      canvas.addEventListener('pointermove', move)
      canvas.addEventListener('pointerup', up)
      window.__v2ToolDrag = {
        point: { x: screen.x, y: screen.y },
        finish: () => {
          canvas.removeEventListener('pointerdown', down)
          canvas.removeEventListener('pointermove', move)
          canvas.removeEventListener('pointerup', up)
          map.dragPan.enable()
          const endCenter = map.getCenter()
          const moved = currentSnapshot.scene.plants.find(item => item.id === plant.id).position
          return {
            cameraDelta: Math.hypot(endCenter.lng - startCenter.lng, endCenter.lat - startCenter.lat),
            plantDeltaMeters: Math.hypot(moved.x - plant.position.x, moved.y - plant.position.y),
          }
        },
      }
      return window.__v2ToolDrag.point
    }
    async function disposeSharedRenderer() {
      const lossCallsBefore = lossCallCount
      const disposal = adapter.dispose()
      await disposal
      if (map.getLayer(adapter.layer.id)) map.removeLayer(adapter.layer.id)
      map.addLayer({ id: 'experiment-post-dispose-probe', type: 'circle', source: 'experiment-alignment-reference-data', paint: { 'circle-radius': 5, 'circle-color': '#00ffff' } })
      await new Promise(resolve => { map.once('render', resolve); map.triggerRepaint() })
      return {
        lossCallsBefore,
        lossCallsAfter: lossCallCount,
        contextLost: gl.isContextLost(),
        canvasConnected: canvas.isConnected,
        probePresent: Boolean(map.getLayer('experiment-post-dispose-probe')),
      }
    }
    async function repeatMountCycle() {
      const repeatAdapter = createSharedMapSceneLayer({
        id: 'experiment-design-remount',
        anchor,
        northBearingDeg,
        maximumWorldExtentMeters: qualifiedExtent,
      })
      const lossCallsBefore = lossCallCount
      await repeatAdapter.initialize(map, gl)
      repeatAdapter.setSnapshot(representativeSnapshot)
      map.addLayer(repeatAdapter.layer)
      await waitForMapEvent('render', 'repeat mount render')
      const activeDiagnostics = diagnosticReceipt(repeatAdapter.diagnostics)
      await repeatAdapter.dispose()
      if (map.getLayer(repeatAdapter.layer.id)) map.removeLayer(repeatAdapter.layer.id)
      return {
        activeDiagnostics,
        disposedDiagnostics: diagnosticReceipt(repeatAdapter.diagnostics),
        lossCallsBefore,
        lossCallsAfter: lossCallCount,
        contextLost: gl.isContextLost(),
        canvasConnected: canvas.isConnected,
      }
    }
    function diagnosticReceipt(value) {
      const { recentRenderDurationsMs, ...counts } = value
      return {
        ...counts,
        recentRenderDurationCount: recentRenderDurationsMs.length,
        recentRenderDurationMaximumMs: recentRenderDurationsMs.length ? Math.max(...recentRenderDurationsMs) : null,
      }
    }
    function destroyMap() {
      map.off('style.load', installStack)
      map.off('webglcontextrestored', installAfterContextRestore)
      map.remove()
      lidarSourceCanvas.remove()
      lidarAnalysisCanvas.remove()
    }

    window.__v2SharedExperiment = {
      map,
      adapter,
      expectedOrder,
      layerOrder,
      captureAlignment,
      collectLiveAlignment,
      reloadStyle,
      forceContextCycle,
      measureCameraFrames,
      resizeAndCapture,
      lateInsertAndOrder,
      beginToolDrag,
      finishToolDrag: () => window.__v2ToolDrag.finish(),
      setCalibrationMode,
      disposeSharedRenderer,
      repeatMountCycle,
      destroyMap,
      readState: () => ({
        diagnostics: diagnosticReceipt(adapter.diagnostics),
        customClearCount,
        lossCallCount,
        stackInstallCount,
        layerOrder: layerOrder(),
        webglContextCount: window.__v2WebglContexts.size,
        connectedWebglCanvasCount: [...window.__v2WebglCanvases].filter(value => value.isConnected).length,
        mapCanvasContextCount: [...window.__v2WebglContexts].filter(value => value.canvas === canvas).length,
        webglRequests: window.__v2WebglRequests,
      }),
    }
    return {
      counts: { plants: scene.plants.length, zones: scene.zones.length, annotations: scene.annotations.length, guides: scene.measurementGuides.length },
      gpu,
      pixiVersion,
      maplibreVersion: maplibre.getVersion?.() ?? null,
      layerOrder: layerOrder(),
      expectedOrder,
      diagnostics: adapter.diagnostics,
      webglContextCount: window.__v2WebglContexts.size,
      connectedWebglCanvasCount: [...window.__v2WebglCanvases].filter(value => value.isConnected).length,
      mapCanvasContextCount: [...window.__v2WebglContexts].filter(value => value.canvas === canvas).length,
    }
  }, { file, base: url.href })

  const readCamera = () => page.evaluate(() => {
    const map = window.__v2SharedExperiment.map
    const center = map.getCenter()
    return { center: [center.lng, center.lat], zoom: map.getZoom() }
  })
  const canvasBounds = await page.locator('#scene canvas.maplibregl-canvas').boundingBox()
  if (!canvasBounds) throw new Error('MapLibre canvas has no pointer bounds')
  const pointerPan = async (distance) => {
    const before = await readCamera()
    const x = canvasBounds.x + canvasBounds.width / 2
    const y = canvasBounds.y + canvasBounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + distance, y + distance * 0.6, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(150)
    const after = await readCamera()
    return Math.hypot(after.center[0] - before.center[0], after.center[1] - before.center[1])
  }
  let navigationCameraDelta = await pointerPan(50)
  if (navigationCameraDelta === 0) navigationCameraDelta = await pointerPan(-70)
  const wheelBefore = await readCamera()
  await page.mouse.move(canvasBounds.x + canvasBounds.width / 2, canvasBounds.y + canvasBounds.height / 2)
  await page.mouse.wheel(0, -180)
  await page.waitForTimeout(250)
  const wheelAfter = await readCamera()
  const navigationZoomDelta = Math.abs(wheelAfter.zoom - wheelBefore.zoom)

  const toolPoint = await page.evaluate(() => window.__v2SharedExperiment.beginToolDrag())
  await page.mouse.move(toolPoint.x, toolPoint.y)
  await page.mouse.down()
  await page.mouse.move(toolPoint.x + 30, toolPoint.y + 20, { steps: 6 })
  await page.mouse.up()
  const toolDrag = await page.evaluate(() => window.__v2SharedExperiment.finishToolDrag())

  const evidence = await page.evaluate(async () => {
    const experiment = window.__v2SharedExperiment
    await experiment.setCalibrationMode(true)
    const settledAlignment = await experiment.captureAlignment()
    const liveAlignment = await experiment.collectLiveAlignment()
    const performance = await experiment.measureCameraFrames()
    await experiment.setCalibrationMode(true)
    const lateLayerOrder = await experiment.lateInsertAndOrder()
    const resizeAlignment = await experiment.resizeAndCapture(1000, 700)
    const styleReloadAlignment = await experiment.reloadStyle()
    const contextCycle = await experiment.forceContextCycle()
    await experiment.setCalibrationMode(false)
    return {
      settledAlignment,
      liveAlignment,
      lateLayerOrder,
      resizeAlignment,
      styleReloadAlignment,
      contextCycle,
      performance,
      stateBeforeDispose: experiment.readState(),
    }
  })

  if (values.screenshots) {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.evaluate(() => {
      const container = document.querySelector('#scene')
      container.style.width = '1200px'
      container.style.height = '800px'
      window.__v2SharedExperiment.map.resize()
    })
    await page.waitForTimeout(100)
    await page.screenshot({ path: `${values.screenshots}-representative.png` })
  }

  const teardown = await page.evaluate(async () => {
    const result = await window.__v2SharedExperiment.disposeSharedRenderer()
    const state = window.__v2SharedExperiment.readState()
    const repeatMount = await window.__v2SharedExperiment.repeatMountCycle()
    window.__v2SharedExperiment.destroyMap()
    return { ...result, diagnostics: state.diagnostics, repeatMount }
  })
  const baseline = values.baseline ? JSON.parse(await readFile(values.baseline, 'utf8')) : null
  const performanceComparison = baseline ? evidence.performance.map(candidate => {
    const prior = baseline.results?.find(value => value.operation === candidate.operation)
    return {
      operation: candidate.operation,
      candidateP50SubmissionMs: candidate.p50SubmissionMs,
      candidateP95SubmissionMs: candidate.p95SubmissionMs,
      baselineP50SubmissionMs: prior?.medianMs ?? null,
      baselineP95SubmissionMs: prior?.p95Ms ?? null,
      p50Ratio: prior?.medianMs ? candidate.p50SubmissionMs / prior.medianMs : null,
      p95Ratio: prior?.p95Ms ? candidate.p95SubmissionMs / prior.p95Ms : null,
    }
  }) : null
  const expectedLateLayerOrder = [...setup.expectedOrder]
  expectedLateLayerOrder.splice(expectedLateLayerOrder.indexOf('experiment-reference'), 0, 'experiment-lidar-late')
  const alignmentSamples = [
    evidence.settledAlignment,
    ...evidence.liveAlignment,
    evidence.resizeAlignment,
    evidence.styleReloadAlignment.firstFrame,
    evidence.styleReloadAlignment.settled,
    evidence.contextCycle.alignment,
  ]
  const criteria = {
    representativeContent: setup.counts.plants === 2201 && setup.counts.zones === 24
      && setup.counts.annotations === 106 && setup.counts.guides === 134,
    initialLayerOrder: JSON.stringify(setup.layerOrder) === JSON.stringify(setup.expectedOrder),
    lateLayerOrder: JSON.stringify(evidence.lateLayerOrder) === JSON.stringify(expectedLateLayerOrder),
    renderedAlignment: alignmentSamples.every(value => value?.cyanPixels > 0 && value.magentaPixels > 0
      && value.errorCssPx !== null && value.errorCssPx <= 1),
    navigationOwnership: navigationCameraDelta > 0 && navigationZoomDelta > 0,
    toolOwnership: toolDrag.cameraDelta === 0 && toolDrag.plantDeltaMeters > 0,
    oneMapWebglSurface: setup.connectedWebglCanvasCount === 1 && setup.mapCanvasContextCount === 1,
    noCustomClear: evidence.stateBeforeDispose.customClearCount === 0,
    noDuplicateRenderer: evidence.stateBeforeDispose.diagnostics.initializeCount === 1
      && evidence.stateBeforeDispose.diagnostics.skippedRenderCount === 0
      && evidence.stateBeforeDispose.diagnostics.lastFailure === null,
    styleAndContextRecovery: evidence.stateBeforeDispose.stackInstallCount === 3
      && evidence.contextCycle.supported === true,
    offlineStyle: externalRequestCount === 0,
    teardownKeepsMapContext: teardown.lossCallsAfter === teardown.lossCallsBefore
      && !teardown.contextLost && teardown.canvasConnected && teardown.probePresent
      && teardown.diagnostics.phase === 'disposed' && teardown.diagnostics.disposeCount === 1
      && teardown.diagnostics.disposeInRenderCount === 1,
    repeatedMount: teardown.repeatMount.lossCallsAfter === teardown.repeatMount.lossCallsBefore
      && !teardown.repeatMount.contextLost && teardown.repeatMount.canvasConnected
      && teardown.repeatMount.activeDiagnostics.phase === 'attached'
      && teardown.repeatMount.activeDiagnostics.initializeCount === 1
      && teardown.repeatMount.activeDiagnostics.renderCount >= 1
      && teardown.repeatMount.disposedDiagnostics.phase === 'disposed'
      && teardown.repeatMount.disposedDiagnostics.disposeCount === 1
      && teardown.repeatMount.disposedDiagnostics.disposeInRenderCount === 1,
    performanceSampleCount: evidence.performance.every(value => value.samples === 30
      && Number.isFinite(value.p50FrameWallMs) && Number.isFinite(value.p95FrameWallMs)
      && Number.isFinite(value.p50SubmissionMs) && Number.isFinite(value.p95SubmissionMs)),
  }
  const result = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    dpr,
    headed: Boolean(values.headed),
    counts: setup.counts,
    gpu: setup.gpu,
    versions: { maplibre: setup.maplibreVersion, pixi: setup.pixiVersion },
    webglContextCount: setup.webglContextCount,
    layerOrder: setup.layerOrder,
    expectedLayerOrder: setup.expectedOrder,
    navigation: { cameraDeltaDegrees: navigationCameraDelta, zoomDelta: navigationZoomDelta },
    toolDrag,
    ...evidence,
    performanceComparison,
    teardown,
    externalRequestCount,
    criteria,
    note: 'Isolated MapLibre/Pixi shared-context experiment. Alignment is the thresholded framebuffer bounds-center distance in CSS pixels; centroid distance is diagnostic only and readback is excluded from performance timing.',
  }
  if (values.output) await writeFile(values.output, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (Object.values(criteria).some(value => !value)) process.exitCode = 1
} finally {
  await browser.close()
}
