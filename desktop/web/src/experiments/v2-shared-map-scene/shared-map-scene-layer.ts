import { Container, Text, WebGLRenderer } from 'pixi.js'
import type { CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl'
import { createPixiScenePresentation, type PixiScenePresentation } from '../../canvas/runtime/renderers/pixi-scene'
import type { SceneRendererSnapshot } from '../../canvas/runtime/renderers/scene-types'
import { deriveV2SharedMapSceneViewport, type V2SharedMapProjector } from './camera-transform'

export interface V2SharedMapSceneMap extends V2SharedMapProjector {
  getCanvas(): HTMLCanvasElement
  getPitch(): number
  triggerRepaint(): void
}

export interface V2SharedPixiRenderer {
  init(options: {
    readonly canvas: HTMLCanvasElement
    readonly context: WebGL2RenderingContext
    readonly width: number
    readonly height: number
    readonly resolution: number
    readonly autoDensity: false
    readonly antialias: true
    readonly backgroundAlpha: 0
    readonly clearBeforeRender: false
    readonly premultipliedAlpha: true
  }): Promise<void>
  render(options: { readonly container: Container; readonly clear: false }): void
  resize(width: number, height: number, resolution: number): void
  resetState(): void
  destroy(options: { readonly removeView: false }): void
  readonly context: { readonly extensions: { loseContext?: { loseContext(): void } } }
}

export interface V2SharedMapSceneDiagnostics {
  readonly phase: 'new' | 'initializing' | 'initialized' | 'attached' | 'detached' | 'disposing' | 'disposed' | 'failed'
  readonly initializeCount: number
  readonly renderCount: number
  readonly sceneSyncCount: number
  readonly viewportSyncCount: number
  readonly resizeCount: number
  readonly repaintCount: number
  readonly skippedRenderCount: number
  readonly resetStateCount: number
  readonly disposeCount: number
  readonly disposeInRenderCount: number
  readonly recentRenderDurationsMs: readonly number[]
  readonly lastFailure: string | null
}

export interface V2SharedMapSceneLayerOptions {
  readonly id: string
  readonly anchor: { readonly lat: number; readonly lon: number }
  readonly northBearingDeg: number
  readonly maximumWorldExtentMeters?: number
  readonly createRenderer?: () => V2SharedPixiRenderer
  readonly createStage?: () => Container
  readonly createPresentation?: (input: {
    readonly stage: Container
    readonly createText: () => Text
    readonly viewSize: { width: number; height: number }
  }) => PixiScenePresentation
}

export interface V2SharedMapSceneLayer {
  readonly layer: CustomLayerInterface
  readonly diagnostics: V2SharedMapSceneDiagnostics
  /** Initialize before adding the custom layer; it never runs from onAdd. */
  initialize(map: V2SharedMapSceneMap, gl: WebGL2RenderingContext): Promise<void>
  /** Stores a scene update and asks MapLibre for the only eligible frame. */
  setSnapshot(snapshot: SceneRendererSnapshot): void
  /** Final owner teardown. Style reload removal only detaches the layer. */
  dispose(options?: { readonly mapWillBeRemoved?: boolean }): Promise<void>
}

type Phase = V2SharedMapSceneDiagnostics['phase']

export function createV2SharedMapSceneLayer(options: V2SharedMapSceneLayerOptions): V2SharedMapSceneLayer {
  let phase: Phase = 'new'
  let map: V2SharedMapSceneMap | null = null
  let context: WebGL2RenderingContext | null = null
  let canvas: HTMLCanvasElement | null = null
  let renderer: V2SharedPixiRenderer | null = null
  let stage: Container | null = null
  let presentation: PixiScenePresentation | null = null
  let pendingSnapshot: SceneRendererSnapshot | null = null
  let renderedSnapshot: SceneRendererSnapshot | null = null
  let initializePromise: Promise<void> | null = null
  let disposePromise: Promise<void> | null = null
  let resolveDispose: (() => void) | null = null
  let rejectDispose: ((error: Error) => void) | null = null
  let disposeRequested = false
  let rendererDestroyed = false
  let attached = false
  let rendererSize: { width: number; height: number; resolution: number } | null = null
  let initializeCount = 0
  let renderCount = 0
  let sceneSyncCount = 0
  let viewportSyncCount = 0
  let resizeCount = 0
  let repaintCount = 0
  let skippedRenderCount = 0
  let resetStateCount = 0
  let disposeCount = 0
  let disposeInRenderCount = 0
  const recentRenderDurationsMs: number[] = []
  let lastFailure: string | null = null

  const diagnostics = (): V2SharedMapSceneDiagnostics => ({
    phase,
    initializeCount,
    renderCount,
    sceneSyncCount,
    viewportSyncCount,
    resizeCount,
    repaintCount,
    skippedRenderCount,
    resetStateCount,
    disposeCount,
    disposeInRenderCount,
    recentRenderDurationsMs: [...recentRenderDurationsMs],
    lastFailure,
  })

  const fail = (message: string): void => {
    lastFailure = message
    phase = 'failed'
  }

  const layer = {
    id: options.id,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd(nextMap: unknown, gl: WebGL2RenderingContext) {
      if (phase === 'disposed') return
      if (nextMap !== map || gl !== context || !renderer || !presentation) {
        fail('MapLibre attached a layer that was not initialized for this map context.')
        return
      }
      attached = true
      phase = disposeRequested ? 'disposing' : 'attached'
      if (disposeRequested) requestRepaint()
    },
    onRemove(nextMap: unknown, gl: WebGL2RenderingContext) {
      if (phase === 'disposed') return
      if (nextMap !== map || gl !== context) {
        fail('MapLibre removed a layer from an unexpected map context.')
        return
      }
      attached = false
      phase = disposeRequested ? 'disposing' : 'detached'
    },
    render(gl: WebGL2RenderingContext, _input: CustomRenderMethodInput) {
      if (gl !== context || !renderer) {
        skippedRenderCount += 1
        return
      }
      if (disposeRequested) {
        disposeInRenderCount += 1
        destroyOwnedResources()
        finishDispose()
        return
      }
      if (phase !== 'attached' || !map || !stage || !presentation || (!pendingSnapshot && !renderedSnapshot)) {
        skippedRenderCount += 1
        return
      }
      const nextSize = syncMapLibreOwnedSize(canvas, renderer, rendererSize)
      if (!nextSize) {
        skippedRenderCount += 1
        fail('MapLibre canvas backing size changed outside the shared renderer contract.')
        return
      }
      if (!sameRendererSize(rendererSize, nextSize)) resizeCount += 1
      rendererSize = nextSize
      const transform = deriveV2SharedMapSceneViewport({
        project: point => map!.project(point),
        anchor: options.anchor,
        northBearingDeg: options.northBearingDeg,
        pitchDeg: map.getPitch(),
        maximumWorldExtentMeters: options.maximumWorldExtentMeters ?? 10_000,
      })
      if (!transform.accepted) {
        skippedRenderCount += 1
        lastFailure = `Shared map scene cannot render: ${transform.reason}.`
        return
      }
      try {
        const startedAt = performance.now()
        renderer.resetState()
        resetStateCount += 1
        presentation.resize(rendererSize.width, rendererSize.height)
        if (pendingSnapshot) {
          renderedSnapshot = pendingSnapshot
          pendingSnapshot = null
          presentation.renderScene({ ...renderedSnapshot, viewport: transform.viewport })
          sceneSyncCount += 1
        } else {
          presentation.setViewport(transform.viewport)
          viewportSyncCount += 1
        }
        renderer.render({ container: stage, clear: false })
        renderCount += 1
        recentRenderDurationsMs.push(performance.now() - startedAt)
        if (recentRenderDurationsMs.length > 512) recentRenderDurationsMs.shift()
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : 'Shared map scene rendering failed.'
        skippedRenderCount += 1
      }
    },
  } satisfies CustomLayerInterface

  return {
    layer,
    get diagnostics() { return diagnostics() },
    async initialize(nextMap, gl) {
      if (phase === 'disposed') throw new Error('Cannot initialize a disposed shared map scene layer.')
      if (initializePromise) {
        if (nextMap !== map || gl !== context) throw new Error('Shared map scene layer is already bound to another map context.')
        return initializePromise
      }
      map = nextMap
      context = gl
      canvas = nextMap.getCanvas()
      const size = getMapLibreCanvasSize(canvas)
      if (!size) {
        fail('MapLibre canvas has no stable CSS-pixel backing size for shared rendering.')
        throw new Error(lastFailure ?? 'MapLibre canvas size is invalid.')
      }
      phase = 'initializing'
      initializeCount += 1
      const nextRenderer = (options.createRenderer ?? (() => new WebGLRenderer() as unknown as V2SharedPixiRenderer))()
      renderer = nextRenderer
      const initialBackingSize = { width: canvas.width, height: canvas.height }
      initializePromise = nextRenderer.init({
        canvas,
        context: gl,
        width: size.width,
        height: size.height,
        resolution: size.resolution,
        autoDensity: false,
        antialias: true,
        backgroundAlpha: 0,
        clearBeforeRender: false,
        premultipliedAlpha: true,
      }).then(() => {
        if (canvas?.width !== initialBackingSize.width || canvas.height !== initialBackingSize.height) {
          throw new Error('Pixi initialization changed MapLibre canvas backing dimensions.')
        }
        rendererSize = size
        if (disposeRequested) return
        stage = (options.createStage ?? (() => new Container()))()
        presentation = (options.createPresentation ?? createDefaultPresentation)(
          { stage, createText: () => new Text({ resolution: size.resolution * 2 }), viewSize: { width: size.width, height: size.height } },
        )
        phase = 'initialized'
      }).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : 'Shared map scene initialization failed.')
        throw error
      })
      return initializePromise
    },
    setSnapshot(nextSnapshot) {
      if (phase === 'disposed') return
      pendingSnapshot = nextSnapshot
      if (map) {
        map.triggerRepaint()
        repaintCount += 1
      }
    },
    dispose(disposeOptions = {}) {
      if (disposePromise) return disposePromise
      disposeRequested = true
      phase = 'disposing'
      disposeCount += 1
      disposePromise = new Promise<void>((resolve, reject) => {
        resolveDispose = resolve
        rejectDispose = reject
      })
      void (initializePromise ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => {
          if (rendererDestroyed) {
            finishDispose()
            return
          }
          if (attached && !disposeOptions.mapWillBeRemoved) {
            requestRepaint()
            return
          }
          if (!disposeOptions.mapWillBeRemoved && map) {
            const error = new Error('Detached shared rendering must be reattached for disposal, or disposed immediately before MapLibre removal.')
            lastFailure = error.message
            const reject = rejectDispose
            disposeRequested = false
            phase = 'detached'
            disposePromise = null
            resolveDispose = null
            rejectDispose = null
            reject?.(error)
            return
          }
          destroyOwnedResources()
          finishDispose()
        })
      return disposePromise
    },
  }

  function requestRepaint(): void {
    map?.triggerRepaint()
    repaintCount += 1
  }

  function destroyOwnedResources(): void {
    presentation?.dispose()
    presentation = null
    stage?.destroy({ children: true })
    stage = null
    if (renderer && !rendererDestroyed) {
      renderer.context.extensions.loseContext = undefined
      renderer.destroy({ removeView: false })
      rendererDestroyed = true
    }
  }

  function finishDispose(): void {
    if (phase === 'disposed') return
    phase = 'disposed'
    attached = false
    renderer = null
    pendingSnapshot = null
    renderedSnapshot = null
    map = null
    context = null
    canvas = null
    rendererSize = null
    resolveDispose?.()
    resolveDispose = null
    rejectDispose = null
  }
}

function createDefaultPresentation(input: {
  readonly stage: Container
  readonly createText: () => Text
  readonly viewSize: { width: number; height: number }
}): PixiScenePresentation {
  return createPixiScenePresentation({ ...input, requestDraw: () => {} })
}

function getMapLibreCanvasSize(canvas: HTMLCanvasElement): { width: number; height: number; resolution: number } | null {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const widthRange = resolutionRange(width, canvas.width)
  const heightRange = resolutionRange(height, canvas.height)
  const lower = Math.max(widthRange.lower, heightRange.lower)
  const upper = Math.min(widthRange.upper, heightRange.upper)
  if (!(lower < upper)) return null
  const resolution = (lower + upper) / 2
  if (Math.round(width * resolution) !== canvas.width || Math.round(height * resolution) !== canvas.height) return null
  return { width, height, resolution }
}

function resolutionRange(cssPixels: number, backingPixels: number): { lower: number; upper: number } {
  return {
    lower: Math.max(0, (backingPixels - 0.5) / cssPixels),
    upper: (backingPixels + 0.5) / cssPixels,
  }
}

function syncMapLibreOwnedSize(
  canvas: HTMLCanvasElement | null,
  renderer: V2SharedPixiRenderer,
  current: { width: number; height: number; resolution: number } | null,
): { width: number; height: number; resolution: number } | null {
  const size = canvas ? getMapLibreCanvasSize(canvas) : null
  if (!canvas || !size) return null
  if (sameRendererSize(current, size)) return size
  const expectedWidth = Math.round(size.width * size.resolution)
  const expectedHeight = Math.round(size.height * size.resolution)
  if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) return null
  const before = { width: canvas.width, height: canvas.height }
  renderer.resize(size.width, size.height, size.resolution)
  return canvas.width === before.width && canvas.height === before.height ? size : null
}

function sameRendererSize(
  left: { width: number; height: number; resolution: number } | null,
  right: { width: number; height: number; resolution: number },
): boolean {
  return left?.width === right.width
    && left.height === right.height
    && left.resolution === right.resolution
}
