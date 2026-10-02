// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import { logMapError } from './redact-credentials'
import 'pixi.js/unsafe-eval'
// The one extension the layer registers itself (skipExtensionImports leaves it out): the plant
// layer's opacity and species dim and the placement ghosts draw through an AlphaFilter.
import 'pixi.js/filters'
import { Container, Text, Ticker, WebGLRenderer, type WebGLOptions } from 'pixi.js'
import type { CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl'
import { createPixiScenePresentation, type PixiScenePresentation } from '../canvas/runtime/renderers/pixi-scene'
import type { SceneRendererSnapshot } from '../canvas/runtime/renderers/scene-types'
import type { SceneViewportState } from '../canvas/runtime/scene'
import type { DraftPresentation } from '../canvas/runtime/tools/draft'
import { buildViewTransformFromPlane } from '../canvas/runtime/view/view-transform'
import { createSessionPlane } from '../canvas/session-plane'
import { deriveSharedMapSceneViewport, type SharedMapProjector } from './scene-camera-transform'

/** The one production custom layer which all map-owned raster bands sit below. */
export const MAPLIBRE_SHARED_SCENE_LAYER_ID = 'canopi-shared-scene'

export interface SharedMapSceneMap extends SharedMapProjector {
  getCanvas(): HTMLCanvasElement
  getPitch(): number
  triggerRepaint(): void
}

/** Pixi's real renderer options, so the layer's choices are checked against them. */
export type SharedPixiRendererInitOptions = Partial<WebGLOptions>

export interface SharedPixiRenderer {
  init(options: SharedPixiRendererInitOptions): Promise<void>
  render(options: { readonly container: Container; readonly clear: false }): void
  resize(width: number, height: number, resolution: number): void
  resetState(): void
  destroy(options: { readonly removeView: false }): void
  readonly context: { readonly extensions: { loseContext?: { loseContext(): void } } }
  /** Pixi's event system, which `init` installs on the canvas; the layer detaches it. */
  readonly events?: { setTargetElement(element: HTMLElement | null): void }
}

export interface SharedPixiRendererView {
  readonly canvas: HTMLCanvasElement
  readonly context: WebGL2RenderingContext
  readonly width: number
  readonly height: number
  readonly resolution: number
}

/**
 * Pixi draws inside MapLibre's context and frame loop (ADR 0004): it imports
 * no extensions but the filters (registered above), clears nothing, collects no GPU resources on a schedule of
 * its own, and its containers take no events. Pixi still installs its
 * EventSystem on the canvas and its scheduler on `Ticker.system` during
 * `init`; `detachPixiFromHost` undoes both right after.
 */
export function sharedPixiRendererInitOptions(view: SharedPixiRendererView): SharedPixiRendererInitOptions {
  return {
    ...view,
    autoDensity: false,
    antialias: true,
    backgroundAlpha: 0,
    clearBeforeRender: false,
    premultipliedAlpha: true,
    skipExtensionImports: true,
    eventMode: 'none',
    eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    textureGCActive: false,
    renderableGCActive: false,
  }
}

/**
 * MapLibre owns the canvas's pointer events (touch-action, preventDefault,
 * document listeners) and the only frame loop. Pixi's canvas listeners go,
 * and `Ticker.system`, which Pixi's scheduler started, stops; nothing of
 * ours listens on it.
 */
function detachPixiFromHost(renderer: SharedPixiRenderer): void {
  renderer.events?.setTargetElement(null)
  Ticker.system.stop()
}

interface SharedMapSceneDiagnostics {
  readonly phase: 'new' | 'initializing' | 'initialized' | 'attached' | 'detached' | 'disposing' | 'disposed' | 'failed'
  readonly initializeCount: number
  readonly renderCount: number
  readonly sceneSyncCount: number
  readonly disposeCount: number
  readonly lastFailure: string | null
}

export interface SharedMapSceneLayerOptions {
  readonly id: string
  /** Live session plane origin, read on every render. */
  readonly readOrigin: () => { readonly lat: number; readonly lon: number }
  readonly maximumWorldExtentMeters?: number
  readonly onFailure?: (error: Error) => void
  readonly createRenderer?: () => SharedPixiRenderer
  readonly createStage?: () => Container
  readonly createPresentation?: (input: {
    readonly stage: Container
    readonly createText: () => Text
    readonly viewSize: { width: number; height: number }
    readonly requestRepaint: () => void
  }) => PixiScenePresentation
}

export interface SharedMapSceneLayer {
  readonly layer: CustomLayerInterface
  readonly diagnostics: SharedMapSceneDiagnostics
  /** Initialize before adding the custom layer; it never runs from onAdd. */
  initialize(map: SharedMapSceneMap, gl: WebGL2RenderingContext): Promise<void>
  /** Stores a scene update and asks MapLibre for the only eligible frame. */
  setSnapshot(snapshot: SceneRendererSnapshot): void
  /** Requests a camera-only MapLibre frame without rebuilding scene content. */
  requestRender(): void
  /** Final owner teardown. Style reload removal only detaches the layer. */
  dispose(options?: { readonly mapWillBeRemoved?: boolean }): Promise<void>
}

/**
 * What the MapLibre scene bridge forwards to the layer for the Pixi draft layer (0B): the ToolHost's draft. The layer
 * keeps the latest until its presentation exists, and drops it on dispose.
 */
export interface SharedMapSceneDraftSink {
  setDraft(draft: DraftPresentation | null): void
}

type Phase = SharedMapSceneDiagnostics['phase']

export function createSharedMapSceneLayer(options: SharedMapSceneLayerOptions): SharedMapSceneLayer & SharedMapSceneDraftSink {
  let phase: Phase = 'new'
  let map: SharedMapSceneMap | null = null
  let context: WebGL2RenderingContext | null = null
  let canvas: HTMLCanvasElement | null = null
  let renderer: SharedPixiRenderer | null = null
  let stage: Container | null = null
  let presentation: PixiScenePresentation | null = null
  let pendingSnapshot: SceneRendererSnapshot | null = null
  let renderedSnapshot: SceneRendererSnapshot | null = null
  let presentedViewport: SceneViewportState | null = null
  let viewRevision = 0
  let draft: DraftPresentation | null = null
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
  let disposeCount = 0
  let lastFailure: string | null = null
  let failureReported = false

  const diagnostics = (): SharedMapSceneDiagnostics => ({
    phase,
    initializeCount,
    renderCount,
    sceneSyncCount,
    disposeCount,
    lastFailure,
  })

  const fail = (failure: string | Error): void => {
    const error = failure instanceof Error ? failure : new Error(failure)
    lastFailure = error.message
    phase = 'failed'
    if (failureReported) return
    failureReported = true
    try {
      options.onFailure?.(error)
    } catch (observerError) {
      logMapError('Shared map scene failure observer failed:', observerError)
    }
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
      if (gl !== context || !renderer) return
      if (disposeRequested) {
        destroyOwnedResources()
        finishDispose()
        return
      }
      if (phase !== 'attached' || !map || !stage || !presentation || (!pendingSnapshot && !renderedSnapshot)) return
      const nextSize = syncMapLibreOwnedSize(canvas, renderer, rendererSize)
      if (!nextSize) {
        fail('MapLibre canvas backing size changed outside the shared renderer contract.')
        return
      }
      const sizeChanged = !sameRendererSize(rendererSize, nextSize)
      rendererSize = nextSize
      const transform = deriveSharedMapSceneViewport({
        project: point => map!.project(point),
        anchor: options.readOrigin(),
        pitchDeg: map.getPitch(),
        maximumWorldExtentMeters: options.maximumWorldExtentMeters ?? 10_000,
      })
      if (!transform.accepted) {
        fail(`Shared map scene cannot render: ${transform.reason}.`)
        return
      }
      try {
        renderer.resetState()
        presentation.resize(rendererSize.width, rendererSize.height)
        if (sizeChanged || !sameViewport(presentedViewport, transform.viewport)) {
          // Until the layer reads the runtime's frames: the derived placement as a bearing-0 view.
          presentation.setView(buildViewTransformFromPlane({
            planar: { ...transform.viewport, bearingDeg: 0 },
            screen: { width: rendererSize.width, height: rendererSize.height, devicePixelRatio: rendererSize.resolution },
            plane: createSessionPlane(options.readOrigin()),
            planeRevision: 0,
            revision: ++viewRevision,
          }))
          presentedViewport = transform.viewport
        }
        if (pendingSnapshot) {
          renderedSnapshot = pendingSnapshot
          pendingSnapshot = null
          presentation.syncScene(renderedSnapshot)
          sceneSyncCount += 1
        }
        renderer.render({ container: stage, clear: false })
        renderCount += 1
      } catch (error) {
        fail(error instanceof Error ? error : 'Shared map scene rendering failed.')
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
      const nextRenderer = (options.createRenderer ?? (() => new WebGLRenderer()))()
      renderer = nextRenderer
      const initialBackingSize = { width: canvas.width, height: canvas.height }
      initializePromise = nextRenderer.init(sharedPixiRendererInitOptions({
        canvas,
        context: gl,
        width: size.width,
        height: size.height,
        resolution: size.resolution,
      })).then(() => {
        detachPixiFromHost(nextRenderer)
        if (canvas?.width !== initialBackingSize.width || canvas.height !== initialBackingSize.height) {
          throw new Error('Pixi initialization changed MapLibre canvas backing dimensions.')
        }
        rendererSize = size
        if (disposeRequested) return
        stage = (options.createStage ?? (() => new Container()))()
        presentation = (options.createPresentation ?? createPixiScenePresentation)(
          {
            stage,
            createText: () => new Text({ resolution: size.resolution * 2 }),
            viewSize: { width: size.width, height: size.height },
            requestRepaint,
          },
        )
        // A draft set while the layer initialized is still live.
        if (draft) presentation.setDraft(draft)
        phase = 'initialized'
      }).catch((error: unknown) => {
        fail(error instanceof Error ? error : 'Shared map scene initialization failed.')
        throw error
      })
      return initializePromise
    },
    setSnapshot(nextSnapshot) {
      if (phase === 'disposed') return
      pendingSnapshot = nextSnapshot
      requestRepaint()
    },
    requestRender() {
      if (phase === 'disposed') return
      requestRepaint()
    },
    setDraft(nextDraft) {
      if (phase === 'disposed') return
      draft = nextDraft
      presentation?.setDraft(nextDraft)
      requestRepaint()
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
    if (!map) return
    map.triggerRepaint()
  }

  function destroyOwnedResources(): void {
    presentation?.dispose()
    presentation = null
    stage?.destroy({ children: true })
    stage = null
    if (renderer && !rendererDestroyed) {
      // Pixi's GlContextSystem.destroy() always calls loseContext(). This is
      // Pixi's own extension registry, so suppress that one teardown action
      // before releasing resources from the MapLibre-owned shared context.
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
    presentedViewport = null
    draft = null
    map = null
    context = null
    canvas = null
    rendererSize = null
    resolveDispose?.()
    resolveDispose = null
    rejectDispose = null
  }
}

function sameViewport(
  left: SceneViewportState | null,
  right: SceneViewportState,
): boolean {
  return left?.x === right.x && left.y === right.y && left.scale === right.scale
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
  renderer: SharedPixiRenderer,
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
