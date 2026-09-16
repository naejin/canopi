#!/usr/bin/env node
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { processFixture, withTemporaryDerivative } from './fixture-receipt.mjs'

const FIXTURE_EXPECTATIONS = Object.freeze({
  'expected-sha256': '446c656e12eca21ddf5c03e79cd1f8d7862eae88626c4cb550d55b505d246f40',
  'expected-plants': '2201',
  'expected-zones': '24',
  'expected-annotations': '106',
  'expected-measurement-guides': '134',
  'expected-layers': '8',
  'expected-guides': '2',
  'expected-consortiums': '124',
  'expected-budget': '117',
})

const SCENARIOS = Object.freeze({
  representative: { id: 'representative-shared', derivative: null, forceCanvas2d: false, expectedOutcome: 'shared-ready' },
  fallback: { id: 'representative-canvas2d-fallback', derivative: null, forceCanvas2d: true, expectedOutcome: 'fallback-ready' },
  dense: { id: 'capacity-10000-dense-shared', derivative: 'dense', forceCanvas2d: false, expectedOutcome: 'shared-ready' },
  dispersed: { id: 'capacity-10000-dispersed-shared', derivative: 'dispersed', forceCanvas2d: false, expectedOutcome: 'shared-ready' },
})

const WARMUP_FRAMES = 20
const FRAME_SAMPLES = 120
const INPUT_SAMPLES = 30
const POINTER_TARGET_EDGE_MARGIN_PX = 120
const MAX_POINTER_TARGET_CANDIDATES = 6

export const FAILURE_CODES = Object.freeze([
  'unknown', 'browser-launch', 'scenario-setup', 'readiness', 'single-owner',
  'interaction', 'semantic-order', 'listener-cleanup', 'external-request',
  'source-recheck',
])

class CapacityRunnerError extends Error {
  constructor(code) {
    super(code)
    this.code = FAILURE_CODES.includes(code) ? code : 'unknown'
    this.cleanupCode = null
  }
}

function failure(code) {
  return new CapacityRunnerError(code)
}

export function percentile(samples, proportion) {
  if (!Array.isArray(samples) || samples.length === 0) return null
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(proportion * sorted.length) - 1))]
}

/** Summarize bounded browser-side samples without emitting individual timings. */
export function summarizeBoundedSamples(samples, options = {}) {
  const bounded = Array.isArray(samples) ? samples : []
  const count = options.count ?? bounded.length
  const totalMs = options.totalMs ?? bounded.reduce((sum, value) => sum + value, 0)
  const sampleLimit = options.sampleLimit ?? bounded.length
  if (bounded.length === 0) return { count, totalMs, p50Ms: null, p95Ms: null, p99Ms: null, sampleLimit, droppedSamples: count }
  return {
    count,
    totalMs,
    p50Ms: percentile(bounded, 0.5),
    p95Ms: percentile(bounded, 0.95),
    p99Ms: percentile(bounded, 0.99),
    sampleLimit,
    droppedSamples: Math.max(0, count - bounded.length),
  }
}

/** Browser proxies compared directly with the plan's reference values. These
 * comparisons do not certify native presented frames or input-to-visible time. */
export function classifyCapacityEvidence({ frameIntervalsMs, inputToSecondRafMs }) {
  const frameP95 = percentile(frameIntervalsMs, 0.95)
  const inputP95 = percentile(inputToSecondRafMs, 0.95)
  const stalls = frameIntervalsMs.filter((duration) => duration > 100)
  let longestRun = 0
  let currentRun = 0
  for (const duration of frameIntervalsMs) {
    currentRun = duration > 100 ? currentRun + 1 : 0
    longestRun = Math.max(longestRun, currentRun)
  }
  const frameOpportunityProxy = {
    status: frameP95 !== null && frameP95 <= 16.7 ? 'pass' : 'fail',
    referenceMs: 16.7,
    p95Ms: frameP95,
  }
  const inputToSecondRafProxy = {
    status: inputP95 !== null && inputP95 < 50 ? 'pass' : 'fail',
    referenceMs: 50,
    p95Ms: inputP95,
  }
  const sustainedFrameOpportunityStalls = {
    status: longestRun < 2 ? 'pass' : 'fail',
    thresholdMs: 100,
    count: stalls.length,
    sustained: longestRun >= 2,
  }
  return {
    frameOpportunityProxy,
    inputToSecondRafProxy,
    sustainedFrameOpportunityStalls,
    proxyOverall: [frameOpportunityProxy, inputToSecondRafProxy, sustainedFrameOpportunityStalls]
      .every((gate) => gate.status === 'pass') ? 'pass' : 'fail',
    nativeQualification: 'unavailable',
  }
}

export function sanitizeRunnerError(error) {
  const code = FAILURE_CODES.includes(error?.code) ? error.code : 'unknown'
  const cleanup = FAILURE_CODES.includes(error?.cleanupCode) ? `; cleanup=${error.cleanupCode}` : ''
  return `production workspace capacity run failed [${code}${cleanup}]`
}

function parseScenario(value) {
  if (!value || value === 'all') return Object.values(SCENARIOS)
  const scenario = SCENARIOS[value]
  if (!scenario) throw new Error('invalid scenario')
  return [scenario]
}

function assertLocalUrl(value) {
  const url = new URL(value)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('a local Vite server is required')
  return url
}

async function readFixtureForBrowser(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new Error('cannot prepare fixture for browser')
  }
}

function nodeEnvironment() {
  return {
    os: { type: os.type(), release: os.release(), architecture: os.arch() },
    node: process.version,
    cpu: { model: os.cpus()[0]?.model ?? 'unavailable', logicalCores: os.cpus().length },
  }
}

async function verifySourceReceipt(file) {
  try {
    return await processFixture(file, FIXTURE_EXPECTATIONS)
  } catch {
    throw failure('source-recheck')
  }
}

async function runVerifiedScenario({ browser, base, scenario, file, profileWork }) {
  await verifySourceReceipt(file)
  try {
    if (scenario.derivative) {
      return await withTemporaryDerivative(
        file,
        scenario.derivative,
        FIXTURE_EXPECTATIONS,
        ({ file: derivativeFile, receipt }) => runBrowserScenario({ browser, base, scenario, file: derivativeFile, profileWork })
          .then((result) => ({ ...result, fixture: receipt })),
      )
    }
    return await runBrowserScenario({ browser, base, scenario, file, profileWork })
  } finally {
    await verifySourceReceipt(file)
  }
}

async function runBrowserScenario({ browser, base, scenario, file, profileWork }) {
  let page
  let primaryFailure = null
  let cleanupAttempted = false
  let externalRequestCount = 0
  let pageErrorCount = 0
  try {
    try {
      page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 })
    } catch {
      throw failure('scenario-setup')
    }
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) externalRequestCount += 1
    })
    page.on('pageerror', () => {
      pageErrorCount += 1
    })
    const entry = new URL(`__production-workspace-capacity-${scenario.id}`, base).href
    let setup
    try {
      await page.route(entry, (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body style="margin:0;overflow:hidden"><div id="scene" style="position:relative;width:1200px;height:800px"></div></body></html>',
      }))
      await page.goto(entry)
      const sourceFile = await readFixtureForBrowser(file)
      setup = await page.evaluate(async ({ sourceFile: unpreparedFile, base: baseHref, forceCanvas2d, warmupFrames, frameSamples, inputSamples, profileWork }) => {
      const source = (name) => new URL(`src/${name}`, baseHref).href
      await import(source('styles/global.css'))
      const [{ createWorkspaceRuntimeComposition }, { createDetachedCanvasRuntimeAppAdapter }, { createDetachedSceneRuntimePanelTargetAdapter }, { newDesignSpatialFrame }, { loadMapLibreModule }, basemap, sharedScene] = await Promise.all([
        import(source('app/canvas-map-surface/workspace-runtime-composition.ts')),
        import(source('canvas/runtime/app-adapter.ts')),
        import(source('canvas/runtime/scene-runtime/panel-target-adapter.ts')),
        import(source('spatial-frame.ts')),
        import(source('maplibre/loader.ts')),
        import(source('maplibre/config.ts')),
        import(source('maplibre/shared-scene-layer.ts')),
      ])
      const container = document.querySelector('#scene')
      if (!(container instanceof HTMLElement)) throw new Error('missing workspace container')
      function createWorkProfiler({ pixi, SceneViewportPresentation, sharedLayerId }) {
        const SAMPLE_LIMIT = 512
        const observations = {
          customLayer: false,
          pixiRender: false,
          graphicsClear: false,
          viewport: false,
          repaint: false,
          pixiSceneWork: false,
        }
        const durations = {
          wheelDispatch: [], customLayer: [], pixiRender: [], viewportChanged: [], viewportUnchanged: [],
          plantObjects: [], plantCull: [], plantEntries: [], plantLayout: [], plantDraw: [],
        }
        const durationTotals = {
          wheelDispatch: { count: 0, totalMs: 0 }, customLayer: { count: 0, totalMs: 0 },
          pixiRender: { count: 0, totalMs: 0 }, viewportChanged: { count: 0, totalMs: 0 },
          viewportUnchanged: { count: 0, totalMs: 0 },
          plantObjects: { count: 0, totalMs: 0 }, plantCull: { count: 0, totalMs: 0 },
          plantEntries: { count: 0, totalMs: 0 }, plantLayout: { count: 0, totalMs: 0 },
          plantDraw: { count: 0, totalMs: 0 },
        }
        const clearsPerCustomLayer = []
        const clearsTotal = { count: 0, total: 0 }
        let triggerRepaintCount = 0
        let active = false
        let restored = false
        const restores = []
        const customLayerInvocations = []
        const capturedLayers = new WeakSet()
        const recordDuration = (name, value) => {
          if (!active || !Number.isFinite(value)) return
          const total = durationTotals[name]
          total.count += 1
          total.totalMs += value
          if (durations[name].length < SAMPLE_LIMIT) durations[name].push(value)
        }
        const recordClear = () => {
          if (!active || customLayerInvocations.length === 0) return
          customLayerInvocations[customLayerInvocations.length - 1].clears += 1
        }
        const summarizeDuration = (name) => {
          const total = durationTotals[name]
          if (total.count === 0) return 'unavailable'
          const samples = durations[name]
          const sorted = [...samples].sort((left, right) => left - right)
          const percentile = (proportion) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(proportion * sorted.length) - 1))]
          return {
            count: total.count,
            totalMs: total.totalMs,
            p50Ms: percentile(0.5),
            p95Ms: percentile(0.95),
            p99Ms: percentile(0.99),
            sampleLimit: SAMPLE_LIMIT,
            droppedSamples: Math.max(0, total.count - samples.length),
          }
        }
        const summarizeClears = () => {
          if (clearsTotal.count === 0) return 'unavailable'
          const sorted = [...clearsPerCustomLayer].sort((left, right) => left - right)
          const percentile = (proportion) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(proportion * sorted.length) - 1))]
          return {
            count: clearsTotal.count,
            total: clearsTotal.total,
            p50: percentile(0.5),
            p95: percentile(0.95),
            p99: percentile(0.99),
            sampleLimit: SAMPLE_LIMIT,
            droppedSamples: Math.max(0, clearsTotal.count - clearsPerCustomLayer.length),
          }
        }
        const patch = (target, name, wrap) => {
          const original = target?.[name]
          if (typeof original !== 'function') return false
          target[name] = wrap(original)
          restores.push(() => { target[name] = original })
          return true
        }
        return {
          installMap(mapPrototype) {
            observations.repaint = patch(mapPrototype, 'triggerRepaint', (original) => function (...args) {
              if (active) triggerRepaintCount += 1
              return original.apply(this, args)
            })
          },
          installPixi() {
            const previousSceneWorkObserver = globalThis.__CANOPI_PIXI_SCENE_WORK__
            globalThis.__CANOPI_PIXI_SCENE_WORK__ = (name, durationMs) => recordDuration(name, durationMs)
            restores.push(() => {
              if (previousSceneWorkObserver) globalThis.__CANOPI_PIXI_SCENE_WORK__ = previousSceneWorkObserver
              else delete globalThis.__CANOPI_PIXI_SCENE_WORK__
            })
            observations.pixiSceneWork = true
            observations.graphicsClear = patch(pixi?.Graphics?.prototype, 'clear', (original) => function (...args) {
              recordClear()
              return original.apply(this, args)
            })
            observations.pixiRender = patch(pixi?.WebGLRenderer?.prototype, 'render', (original) => function (...args) {
              const startedAt = performance.now()
              try {
                return original.apply(this, args)
              } finally {
                recordDuration('pixiRender', performance.now() - startedAt)
              }
            })
            observations.viewport = patch(SceneViewportPresentation?.prototype, 'setViewport', (original) => function (viewport, ...args) {
              const previous = this.current?.snapshot?.viewport
              const unchanged = previous?.x === viewport?.x && previous?.y === viewport?.y && previous?.scale === viewport?.scale
              const startedAt = performance.now()
              try {
                return original.call(this, viewport, ...args)
              } finally {
                recordDuration(unchanged ? 'viewportUnchanged' : 'viewportChanged', performance.now() - startedAt)
              }
            })
          },
          captureCustomLayer(layer) {
            if (!layer || layer.id !== sharedLayerId || typeof layer.render !== 'function' || capturedLayers.has(layer)) return
            capturedLayers.add(layer)
            const original = layer.render
            layer.render = function (...args) {
              const invocation = { clears: 0 }
              const startedAt = performance.now()
              if (active) customLayerInvocations.push(invocation)
              try {
                return original.apply(this, args)
              } finally {
                if (active) {
                  customLayerInvocations.pop()
                  recordDuration('customLayer', performance.now() - startedAt)
                  clearsTotal.count += 1
                  clearsTotal.total += invocation.clears
                  if (clearsPerCustomLayer.length < SAMPLE_LIMIT) clearsPerCustomLayer.push(invocation.clears)
                }
              }
            }
            restores.push(() => { layer.render = original })
            observations.customLayer = true
          },
          start() { active = true },
          recordWheelDispatch(duration) { recordDuration('wheelDispatch', duration) },
          snapshot(outcome) {
            if (outcome !== 'shared-ready') {
              return { status: 'unavailable', reason: 'Canvas2D fallback does not run the shared WebGL custom layer.' }
            }
            return {
              status: 'available',
              synchronousWheelDispatchMs: summarizeDuration('wheelDispatch'),
              sharedCustomLayerRenderMs: observations.customLayer ? summarizeDuration('customLayer') : 'unavailable',
              pixiWebGLRendererRenderMs: observations.pixiRender ? summarizeDuration('pixiRender') : 'unavailable',
              graphicsClearsPerSharedCustomLayerInvocation: observations.graphicsClear && observations.customLayer ? summarizeClears() : 'unavailable',
              sceneViewportPresentationSetViewportMs: observations.viewport
                ? { changed: summarizeDuration('viewportChanged'), unchanged: summarizeDuration('viewportUnchanged') }
                : 'unavailable',
              pixiSceneWorkMs: observations.pixiSceneWork ? {
                plantObjects: summarizeDuration('plantObjects'),
                plantCull: summarizeDuration('plantCull'),
                plantEntries: summarizeDuration('plantEntries'),
                plantLayout: summarizeDuration('plantLayout'),
                plantDraw: summarizeDuration('plantDraw'),
              } : 'unavailable',
              mapLibreTriggerRepaintRequests: observations.repaint ? { count: triggerRepaintCount } : 'unavailable',
              fullSceneTraversalCount: 'unavailable',
            }
          },
          restore() {
            if (restored) return
            restored = true
            active = false
            for (const restore of restores.reverse()) restore()
          },
        }
      }
      function installHarnessInstrumentation(maplibre, scope, workProfiler) {
        const mapPrototype = maplibre.Map.prototype
        const original = {
          addLayer: mapPrototype.addLayer,
          on: mapPrototype.on,
          off: mapPrototype.off,
          remove: mapPrototype.remove,
          addEventListener: EventTarget.prototype.addEventListener,
          removeEventListener: EventTarget.prototype.removeEventListener,
        }
        const mapListeners = []
        const domListeners = []
        let map = null
        let mapRemovalCount = 0
        let restored = false
        try {
          workProfiler?.installMap(mapPrototype)
          workProfiler?.installPixi()
        } catch (error) {
          workProfiler?.restore()
          throw error
        }
        const recordMapListener = (target, type, listener, delta) => {
          if (!listener) return
          const entry = mapListeners.find((candidate) => candidate.target === target && candidate.type === type && candidate.listener === listener)
          if (entry) entry.count += delta
          else if (delta > 0) mapListeners.push({ target, type, listener, count: delta })
        }
        const trackedDomTarget = (target) => target === window || target === document || target === scope
          || (target instanceof HTMLCanvasElement && (target.classList.contains('maplibregl-canvas') || target.dataset.canopiRenderer !== undefined))
        const once = (options) => typeof options === 'object' && options !== null && options.once === true
        const capture = (options) => options === true
          || (typeof options === 'object' && options !== null && options.capture === true)
        const addDomListener = (target, type, listener, options) => {
          if (!listener || !trackedDomTarget(target) || once(options)) return
          const useCapture = capture(options)
          const registered = domListeners.some((candidate) => candidate.target === target
            && candidate.type === type
            && candidate.listener === listener
            && candidate.capture === useCapture)
          if (!registered) domListeners.push({ target, type, listener, capture: useCapture })
        }
        const removeDomListener = (target, type, listener, options) => {
          if (!listener || !trackedDomTarget(target)) return
          const useCapture = capture(options)
          const index = domListeners.findIndex((candidate) => candidate.target === target
            && candidate.type === type
            && candidate.listener === listener
            && candidate.capture === useCapture)
          if (index >= 0) domListeners.splice(index, 1)
        }
        mapPrototype.addLayer = function (...args) {
          map ??= this
          workProfiler?.captureCustomLayer(args[0])
          return original.addLayer.apply(this, args)
        }
        mapPrototype.on = function (type, listener, ...args) {
          recordMapListener(this, type, listener, 1)
          return original.on.call(this, type, listener, ...args)
        }
        mapPrototype.off = function (type, listener, ...args) {
          recordMapListener(this, type, listener, -1)
          return original.off.call(this, type, listener, ...args)
        }
        mapPrototype.remove = function (...args) {
          map ??= this
          mapRemovalCount += 1
          return original.remove.apply(this, args)
        }
        EventTarget.prototype.addEventListener = function (type, listener, options) {
          addDomListener(this, type, listener, options)
          return original.addEventListener.call(this, type, listener, options)
        }
        EventTarget.prototype.removeEventListener = function (type, listener, options) {
          removeDomListener(this, type, listener, options)
          return original.removeEventListener.call(this, type, listener, options)
        }
        const activeMapEventedRegistrations = () => mapListeners.reduce((count, entry) => count + Math.max(0, entry.count), 0)
        const activeScopedDomListeners = () => domListeners.length
        return {
          readMapState() {
            if (!map) return null
            return {
              zoom: map.getZoom(),
              minimumZoom: map.getMinZoom(),
              maximumZoom: map.getMaxZoom(),
              renderWorldCopies: map.getRenderWorldCopies(),
            }
          },
          assertSemanticOrder(backgroundId, sharedSceneId) {
            if (!map) throw new Error('MapLibre map was not captured by public addLayer instrumentation')
            const order = map.getLayersOrder()
            const background = order.indexOf(backgroundId)
            const sharedScene = order.indexOf(sharedSceneId)
            if (background < 0 || sharedScene < 0 || background >= sharedScene) throw new Error('public MapLibre semantic layer order is invalid')
            return { status: 'pass', observedBands: ['basemap', 'shared-scene'] }
          },
          assertNoActiveListeners(expectedMapRemovalCounts = [1]) {
            const scopedDomListenerCount = activeScopedDomListeners()
            const mapRemovalPassed = expectedMapRemovalCounts.includes(mapRemovalCount)
            return {
              status: mapRemovalPassed && scopedDomListenerCount === 0 ? 'pass' : 'fail',
              mapRemoval: {
                status: mapRemovalPassed ? 'pass' : 'fail',
                count: mapRemovalCount,
                expectedCounts: expectedMapRemovalCounts,
              },
              scopedPersistentDomListeners: { status: scopedDomListenerCount === 0 ? 'pass' : 'fail', count: scopedDomListenerCount },
              mapEventedRegistrations: {
                status: 'unavailable',
                count: activeMapEventedRegistrations(),
                reason: 'MapLibre internal Evented registrations may remain after public map.remove()',
              },
            }
          },
          restore() {
            if (restored) return
            restored = true
            mapPrototype.addLayer = original.addLayer
            mapPrototype.on = original.on
            mapPrototype.off = original.off
            mapPrototype.remove = original.remove
            EventTarget.prototype.addEventListener = original.addEventListener
            EventTarget.prototype.removeEventListener = original.removeEventListener
            workProfiler?.restore()
          },
        }
      }
      let profilerDependencies = null
      if (profileWork) {
        try {
          const pixiSceneSource = await (await fetch(source('canvas/runtime/renderers/pixi-scene.ts'))).text()
          const pixiModulePath = pixiSceneSource.match(/from ["']([^"']*pixi__js[^"']*)["']/)?.[1]
          const viewportPresentationPath = pixiSceneSource.match(/from ["']([^"']*viewport-presentation[^"']*)["']/)?.[1]
          if (pixiModulePath && viewportPresentationPath) {
            const [pixi, viewportPresentation] = await Promise.all([
              import(new URL(pixiModulePath, baseHref).href),
              import(new URL(viewportPresentationPath, baseHref).href),
            ])
            profilerDependencies = { pixi, SceneViewportPresentation: viewportPresentation.SceneViewportPresentation }
          }
        } catch {
          profilerDependencies = null
        }
      }
      const workProfiler = profileWork
        ? createWorkProfiler({ ...profilerDependencies, sharedLayerId: sharedScene.MAPLIBRE_SHARED_SCENE_LAYER_ID })
        : null
      const instrumentation = installHarnessInstrumentation(await loadMapLibreModule(), container, workProfiler)
      const file = structuredClone(unpreparedFile)
      if (file.version !== 5) {
        instrumentation.restore()
        throw new Error('representative fixture must be v5')
      }
      // Development harness preparation only: retain all v5 fields and add the v6 spatial contract.
      file.version = 6
      file.spatial_frame = newDesignSpatialFrame()
      const frame = file.spatial_frame
      const map = Object.freeze({
        anchor: Object.freeze({ lat: frame.anchor_latitude_deg, lon: frame.anchor_longitude_deg }),
        northBearingDeg: frame.north_bearing_deg,
        placementStatus: frame.placement_status,
        basemapStyle: 'street',
        basemapVisible: false,
        basemapOpacity: 1,
      })
      const sessionIdentity = {}
      let restoreForcedCanvasContext = () => {}
      if (forceCanvas2d) {
        const getContext = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null
          return getContext.call(this, kind, ...args)
        }
        restoreForcedCanvasContext = () => {
          HTMLCanvasElement.prototype.getContext = getContext
        }
      }
      let composition
      let outcome
      try {
        composition = createWorkspaceRuntimeComposition({
          container,
          appAdapter: createDetachedCanvasRuntimeAppAdapter(),
          targetPresentation: createDetachedSceneRuntimePanelTargetAdapter(),
          mapContributions: { read: () => null },
          readSnapshot: () => Object.freeze({ sessionIdentity, map }),
          readBasemapPresentation: () => ({ basemapStyle: 'street', basemapVisible: false, basemapOpacity: 1 }),
        })
        // Load through the public document surface before admission, as an edition does.
        composition.surfaces.documents.loadDocument(file)
        outcome = await composition.start()
      } catch (error) {
        try {
          await composition?.dispose()
        } finally {
          instrumentation.restore()
          restoreForcedCanvasContext()
        }
        throw error
      }
      const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const exerciseWorldCamera = async () => {
        const surfaces = composition.surfaces
        const sameViewport = (left, right) => left.x === right.x
          && left.y === right.y
          && left.scale === right.scale
        for (let index = 0; index < 240; index += 1) surfaces.commands.viewport.zoomOut()
        await settle()
        const overviewFrame = surfaces.queries.viewport.value
        const sceneBeforeBlockedEdit = JSON.stringify(surfaces.queries.getSceneSnapshot())
        surfaces.commands.sceneEdits.selectAll()
        const selectionBeforeBlockedEdit = JSON.stringify(surfaces.queries.getSelection())
        surfaces.commands.sceneEdits.deleteSelected()
        const blockedEditPreservedScene = JSON.stringify(surfaces.queries.getSceneSnapshot()) === sceneBeforeBlockedEdit
        const blockedEditPreservedSelection = JSON.stringify(surfaces.queries.getSelection()) === selectionBeforeBlockedEdit
        const overviewBoundary = surfaces.queries.viewport.value
        for (let index = 0; index < 100; index += 1) surfaces.commands.viewport.zoomOut()
        const exhaustedOverview = surfaces.queries.viewport.value
        const mapAtOverview = instrumentation.readMapState()
        surfaces.commands.viewport.returnToDesign()
        await settle()
        const returnedFrame = surfaces.queries.viewport.value
        for (let index = 0; index < 240; index += 1) surfaces.commands.viewport.zoomIn()
        await settle()
        const maximumBoundary = surfaces.queries.viewport.value
        const mapAtMaximum = instrumentation.readMapState()
        for (let index = 0; index < 100; index += 1) surfaces.commands.viewport.zoomIn()
        const exhaustedMaximum = surfaces.queries.viewport.value
        surfaces.commands.viewport.returnToDesign()
        await settle()
        const finalFrame = surfaces.queries.viewport.value
        const checks = {
          overviewEntered: overviewFrame.mode === 'overview',
          overviewLimitNoOp: exhaustedOverview === overviewBoundary
            && sameViewport(exhaustedOverview.viewport, overviewBoundary.viewport),
          blockedEditPreservedScene,
          blockedEditPreservedSelection,
          returnedToSite: returnedFrame.mode === 'site',
          maximumReached: maximumBoundary.viewport.scale === maximumBoundary.scaleBounds.maximum,
          maximumLimitNoOp: exhaustedMaximum === maximumBoundary
            && sameViewport(exhaustedMaximum.viewport, maximumBoundary.viewport),
          zoom27Reached: outcome !== 'shared-ready' || mapAtMaximum?.zoom === 27,
          singleWorld: outcome !== 'shared-ready' || mapAtOverview?.renderWorldCopies === false,
          finalSite: finalFrame.mode === 'site',
        }
        if (!Object.values(checks).every(Boolean)) throw new Error('world camera qualification failed')
        return { status: 'pass', checks: Object.keys(checks) }
      }
      const dispose = async () => {
        try {
            await composition.dispose()
            return {
              connectedCanvasCount: container.querySelectorAll('canvas').length,
              listeners: instrumentation.assertNoActiveListeners(
                outcome === 'shared-ready' ? [1] : [0, 1],
              ),
            }
        } finally {
          instrumentation.restore()
          restoreForcedCanvasContext()
        }
      }
      window.__productionWorkspaceCapacity = {
        composition,
        settle,
        exerciseWorldCamera,
        semanticOrder: () => outcome === 'shared-ready'
          ? instrumentation.assertSemanticOrder(
            basemap.MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
            sharedScene.MAPLIBRE_SHARED_SCENE_LAYER_ID,
          )
          : { status: 'not-applicable', reason: 'Canvas2D fallback has no MapLibre semantic layer stack' },
        dispose,
      }
      const dispatchWheel = (deltaY) => {
        if (!workProfiler) {
          container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }))
          return
        }
        const startedAt = performance.now()
        container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }))
        workProfiler.recordWheelDispatch(performance.now() - startedAt)
      }
      const collectNavigationFrames = async (count) => {
        const timestamps = []
        for (let index = 0; index < count; index += 1) {
          dispatchWheel(index % 2 === 0 ? -1 : 1)
          timestamps.push(await new Promise(requestAnimationFrame))
        }
        return timestamps.slice(1).map((value, index) => value - timestamps[index])
      }
      const inputToSecondRaf = async (count) => {
        const samples = []
        for (let index = 0; index < count; index += 1) {
          const start = performance.now()
          dispatchWheel(-1)
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          samples.push(performance.now() - start)
        }
        return samples
      }
      let navigationFrameOpportunityIntervalsMs
      let inputToSecondRafMs
      let workProfile
      try {
        workProfiler?.start()
        await collectNavigationFrames(warmupFrames)
        navigationFrameOpportunityIntervalsMs = await collectNavigationFrames(frameSamples)
        inputToSecondRafMs = await inputToSecondRaf(inputSamples)
      } finally {
        workProfile = workProfiler?.snapshot(outcome)
        workProfiler?.restore()
      }
      const canvas = container.querySelector('canvas[data-canopi-renderer], canvas')
      let gpu = 'unavailable'
      if (canvas instanceof HTMLCanvasElement) {
        const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
        const debug = context?.getExtension('WEBGL_debug_renderer_info')
        if (debug) gpu = context.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? 'unavailable'
      }
      const memory = performance.memory
        ? { usedJsHeapSize: performance.memory.usedJSHeapSize, totalJsHeapSize: performance.memory.totalJSHeapSize }
        : 'unavailable'
      return {
        outcome,
        connectedCanvasCount: container.querySelectorAll('canvas').length,
        navigationFrameOpportunityIntervalsMs,
        inputToSecondRafMs,
        ...(profileWork ? { workProfile } : {}),
        metadata: {
          viewport: { width: innerWidth, height: innerHeight },
          devicePixelRatio,
          navigationWarmupFrames: warmupFrames,
          navigationFrameSamples: frameSamples,
          navigationInput: 'alternating synthetic wheel events',
          inputSamples,
          browser: { userAgent: navigator.userAgent, platform: navigator.platform },
          gpu,
          renderer: canvas instanceof HTMLCanvasElement ? canvas.dataset.canopiRenderer ?? 'maplibre-shared' : 'unavailable',
          memory,
          workCounters: 'unavailable',
          renderCounters: 'unavailable',
        },
      }
    }, { sourceFile, base: base.href, forceCanvas2d: scenario.forceCanvas2d, warmupFrames: WARMUP_FRAMES, frameSamples: FRAME_SAMPLES, inputSamples: INPUT_SAMPLES, profileWork })
    } catch {
      throw failure('scenario-setup')
    }
    if (setup.outcome !== scenario.expectedOutcome) throw failure('readiness')
    if (setup.connectedCanvasCount !== 1) throw failure('single-owner')
    let semanticOrder
    try {
      semanticOrder = await page.evaluate(() => window.__productionWorkspaceCapacity?.semanticOrder?.())
    } catch {
      throw failure('semantic-order')
    }
    try {
      await page.evaluate(async () => window.__productionWorkspaceCapacity?.settle?.())
    } catch {
      throw failure('interaction')
    }
    let interaction
    try {
      const worldCamera = await page.evaluate(async () =>
        window.__productionWorkspaceCapacity?.exerciseWorldCamera?.())
      if (worldCamera?.status !== 'pass') throw new Error('world camera check unavailable')
      interaction = await exercisePublicSurfaces(page)
      interaction.worldCamera = worldCamera
    } catch {
      throw failure('interaction')
    }
    const viewportBeforeDispose = await page.evaluate(() =>
      window.__productionWorkspaceCapacity?.composition.surfaces.queries.viewport.value.viewport)
    cleanupAttempted = true
    let cleanup
    try {
      cleanup = await page.evaluate(async () => window.__productionWorkspaceCapacity?.dispose?.())
    } catch {
      throw failure('listener-cleanup')
    }
    if (!cleanup || cleanup.connectedCanvasCount !== 0 || cleanup.listeners.status !== 'pass') throw failure('listener-cleanup')
    const errorsBeforePostDisposeEvents = pageErrorCount
    let postDisposeInert
    try {
      postDisposeInert = await page.evaluate(async (before) => {
        const state = window.__productionWorkspaceCapacity
        const container = document.querySelector('#scene')
        if (!state || !(container instanceof HTMLElement) || !before) return false
        container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1 }))
        container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const after = state.composition.surfaces.queries.viewport.value.viewport
        return container.querySelectorAll('canvas').length === 0
          && after.x === before.x
          && after.y === before.y
          && after.scale === before.scale
      }, viewportBeforeDispose)
    } catch {
      throw failure('listener-cleanup')
    }
    if (!postDisposeInert || pageErrorCount !== errorsBeforePostDisposeEvents) throw failure('listener-cleanup')
    if (externalRequestCount !== 0) throw failure('external-request')
    const measurements = {
      browserProxyOnly: true,
      navigationFrameOpportunityIntervalsMs: summarizeSamples(setup.navigationFrameOpportunityIntervalsMs),
      inputToSecondRafMs: summarizeSamples(setup.inputToSecondRafMs),
      classification: classifyCapacityEvidence({ frameIntervalsMs: setup.navigationFrameOpportunityIntervalsMs, inputToSecondRafMs: setup.inputToSecondRafMs }),
      renderer: setup.metadata.renderer,
      workCounters: setup.metadata.workCounters,
      renderCounters: setup.metadata.renderCounters,
      memory: setup.metadata.memory,
    }
    if (setup.workProfile !== undefined) measurements.workProfile = setup.workProfile
    return {
      id: scenario.id,
      status: 'pass',
      expectedOutcome: scenario.expectedOutcome,
      outcome: setup.outcome,
      correctness: {
        singleCanvasOwner: 'pass', pan: interaction.pan, zoom: interaction.zoom, selection: interaction.selection,
        plantEdit: interaction.plantEdit, undo: interaction.undo,
        worldCamera: interaction.worldCamera,
        semanticOrder,
        teardown: 'pass', listenerCleanup: cleanup.listeners, postDisposeWorkspaceEvents: 'pass',
      },
      measurements,
      environment: setup.metadata,
    }
  } catch (error) {
    primaryFailure = error instanceof CapacityRunnerError ? error : failure('unknown')
    throw primaryFailure
  } finally {
    if (page && !cleanupAttempted) {
      try {
        await page.evaluate(async () => window.__productionWorkspaceCapacity?.dispose?.())
      } catch {
        if (primaryFailure) primaryFailure.cleanupCode = 'listener-cleanup'
        else throw failure('listener-cleanup')
      }
    }
    await page?.close()
  }
}

async function exercisePublicSurfaces(page) {
  await page.evaluate(() => {
    const state = window.__productionWorkspaceCapacity
    if (!state) throw new Error('workspace state unavailable')
    const surfaces = state.composition.surfaces
    state.beforePan = surfaces.queries.viewport.value.viewport
  })
  await page.mouse.move(600, 400)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(630, 420, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  await settlePage(page)
  const pan = await page.evaluate(() => {
    const current = window.__productionWorkspaceCapacity.composition.surfaces.queries.viewport.value.viewport
    const previous = window.__productionWorkspaceCapacity.beforePan
    return current.x !== previous.x || current.y !== previous.y || current.scale !== previous.scale
  })
  await page.evaluate(() => {
    window.__productionWorkspaceCapacity.beforeZoom = window.__productionWorkspaceCapacity.composition.surfaces.queries.viewport.value.viewport
  })
  await page.mouse.wheel(0, -120)
  await settlePage(page)
  const zoom = await page.evaluate(() => window.__productionWorkspaceCapacity.composition.surfaces.queries.viewport.value.viewport.scale !== window.__productionWorkspaceCapacity.beforeZoom.scale)
  const candidates = await page.evaluate(({ edgeMargin, maximumCandidates }) => {
    const surfaces = window.__productionWorkspaceCapacity.composition.surfaces
    surfaces.commands.tools.setTool('select')
    const viewport = surfaces.queries.viewport.value.viewport
    const scene = surfaces.queries.getSceneSnapshot()
    const plantLayer = scene.layers.find((layer) => layer.name === 'plants')
    if (plantLayer?.visible === false || plantLayer?.locked === true) return []
    const groupedPlantIds = new Set(scene.groups.flatMap((group) => group.members
      .filter((member) => member.kind === 'plant')
      .map((member) => member.id)))
    return scene.plants
      .filter((plant) => !plant.locked && !groupedPlantIds.has(plant.id))
      .map((plant) => ({
        id: plant.id,
        x: plant.position.x * viewport.scale + viewport.x,
        y: plant.position.y * viewport.scale + viewport.y,
        position: plant.position,
      }))
      .filter((plant) => {
        const x = plant.x
        const y = plant.y
        return x > edgeMargin && y > edgeMargin && x < innerWidth - edgeMargin && y < innerHeight - edgeMargin
      })
      .sort((left, right) => {
        const leftDistance = (left.x - innerWidth / 2) ** 2 + (left.y - innerHeight / 2) ** 2
        const rightDistance = (right.x - innerWidth / 2) ** 2 + (right.y - innerHeight / 2) ** 2
        return leftDistance - rightDistance || left.id.localeCompare(right.id)
      })
      .slice(0, maximumCandidates)
  }, { edgeMargin: POINTER_TARGET_EDGE_MARGIN_PX, maximumCandidates: MAX_POINTER_TARGET_CANDIDATES })
  let selectedTarget = null
  for (const candidate of candidates) {
    await page.mouse.click(candidate.x, candidate.y)
    await settlePage(page)
    const selected = await page.evaluate((id) => {
      const targets = window.__productionWorkspaceCapacity.composition.surfaces.queries.getSelection()
      return targets.length === 1 && targets[0]?.kind === 'plant' && targets[0]?.id === id
    }, candidate.id)
    if (selected) {
      selectedTarget = candidate
      break
    }
  }
  if (!selectedTarget) throw new Error('no pointer-selectable editable plant candidate')
  const selection = true
  await page.mouse.move(selectedTarget.x, selectedTarget.y)
  await page.mouse.down()
  await page.mouse.move(selectedTarget.x + 35, selectedTarget.y + 20, { steps: 10 })
  await page.mouse.up()
  await settlePage(page)
  const plantEdit = await page.evaluate(({ id, position }) => {
    const current = window.__productionWorkspaceCapacity.composition.surfaces.queries.getSceneSnapshot().plants.find((item) => item.id === id).position
    return current.x !== position.x || current.y !== position.y
  }, selectedTarget)
  await page.evaluate(() => window.__productionWorkspaceCapacity.composition.surfaces.commands.history.undo())
  await settlePage(page)
  const undo = await page.evaluate(({ id, position }) => {
    const current = window.__productionWorkspaceCapacity.composition.surfaces.queries.getSceneSnapshot().plants.find((item) => item.id === id).position
    return current.x === position.x && current.y === position.y
  }, selectedTarget)
  if (![pan, zoom, selection, plantEdit, undo].every(Boolean)) throw new Error('a required public workspace interaction failed')
  return { pan: 'pass', zoom: 'pass', selection: 'pass', plantEdit: 'pass', undo: 'pass' }
}

function summarizeSamples(values) {
  return { p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99), over100Ms: values.filter((value) => value > 100).length }
}

async function settlePage(page) { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }

async function main() {
  const { values } = parseArgs({ options: {
    file: { type: 'string' }, scenario: { type: 'string', default: 'all' },
    url: { type: 'string', default: 'http://127.0.0.1:1431/app/' },
    headed: { type: 'boolean', default: false },
    'profile-work': { type: 'boolean', default: false },
  } })
  if (!values.file) throw new Error('missing fixture')
  const base = assertLocalUrl(values.url)
  const scenarios = parseScenario(values.scenario)
  const receipt = await verifySourceReceipt(values.file)
  const require = createRequire(import.meta.url)
  let chromium
  try {
    ({ chromium } = require(process.env.CANOPI_PLAYWRIGHT_MODULE || 'playwright'))
  } catch {
    throw failure('browser-launch')
  }
  let browser
  let verifiedAfterRun = false
  try {
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: !values.headed })
    } catch {
      throw failure('browser-launch')
    }
    const results = []
    let failed = false
    for (const scenario of scenarios) {
      try {
        results.push(await runVerifiedScenario({ browser, base, scenario, file: values.file, profileWork: values['profile-work'] }))
      } catch (error) {
        const safe = error instanceof CapacityRunnerError ? error : failure('unknown')
        results.push({
          id: scenario.id,
          status: 'fail',
          expectedOutcome: scenario.expectedOutcome,
          failure: {
            code: safe.code,
            cleanupCode: FAILURE_CODES.includes(safe.cleanupCode) ? safe.cleanupCode : null,
          },
        })
        failed = true
      }
    }
    await verifySourceReceipt(values.file)
    verifiedAfterRun = true
    console.log(JSON.stringify({
      kind: 'canopi-production-workspace-capacity',
      limitations: 'Browser requestAnimationFrame and second-requestAnimationFrame proxies only; not native timing or GPU completion.',
      fixture: receipt,
      environment: nodeEnvironment(),
      scenarios: results,
    }, null, 2))
    if (failed) process.exitCode = 1
  } finally {
    try {
      await browser?.close()
    } finally {
      if (!verifiedAfterRun) await verifySourceReceipt(values.file)
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(sanitizeRunnerError(error))
    process.exitCode = 1
  })
}
