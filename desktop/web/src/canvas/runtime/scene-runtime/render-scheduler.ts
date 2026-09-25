import type {
  SceneRendererDefinition,
  SceneRendererInstance,
  SceneRendererSnapshot,
} from '../renderers/scene-types'
import type { SceneViewportState } from '../scene'

export type SceneRuntimeRenderKind = 'scene' | 'viewport' | 'chrome'

export interface SceneRuntimePreparedRender {
  publish(): SceneRendererSnapshot
}

interface SceneRuntimeRenderSchedulerOptions {
  getRenderer(): SceneRendererDefinition | null
  getViewport(): SceneViewportState
  prepareSceneRender(): Promise<SceneRuntimePreparedRender>
  renderChrome(): void
}

/** Unmount or disposal won the race against a pending renderer mount. */
export class SceneRendererMountCancelledError extends Error {
  override readonly name = 'SceneRendererMountCancelledError'

  constructor() {
    super('The Scene Canvas renderer mount was cancelled because the renderer was unmounted.')
  }
}

/**
 * Sole lifecycle owner of the one mounted scene renderer (ADR 0004). It mounts
 * the renderer once, coalesces scene and camera invalidations into frames, and
 * unmounts it on disposal or when the map becomes unavailable. There is no
 * renderer selection and no fallback.
 */
export class SceneRuntimeRenderScheduler {
  private _container: HTMLElement | null = null
  private _renderer: SceneRendererInstance | null = null
  private _mounting = false
  private _mountEpoch = 0
  private _renderEpoch = 0
  private _frame: number | null = null
  private _pendingKind: 'scene' | 'viewport' | null = null

  constructor(private readonly _options: SceneRuntimeRenderSchedulerOptions) {}

  get container(): HTMLElement | null {
    return this._container
  }

  async initialize(container: HTMLElement): Promise<void> {
    const definition = this._options.getRenderer()
    if (!definition) throw new Error('The Scene Canvas runtime has no renderer to mount.')
    if (this._mounting || this._renderer) {
      throw new Error('The Scene Canvas renderer is already mounted. Unmount it before mounting again.')
    }
    this._mounting = true
    const mountEpoch = ++this._mountEpoch
    let renderer: SceneRendererInstance
    try {
      renderer = await definition.initialize({ container })
    } finally {
      if (mountEpoch === this._mountEpoch) this._mounting = false
    }
    if (mountEpoch !== this._mountEpoch) {
      await disposeRenderer(renderer)
      throw new SceneRendererMountCancelledError()
    }
    this._renderer = renderer
    this._container = container
  }

  invalidate(kind: SceneRuntimeRenderKind): void {
    if (kind === 'chrome') {
      this._options.renderChrome()
      return
    }
    if (!this._renderer) return
    // Fence an in-flight preparation immediately, even though drawing waits for a frame.
    if (kind === 'scene') this._renderEpoch += 1
    if (this._pendingKind !== 'scene') this._pendingKind = kind
    if (this._frame !== null) return
    this._frame = requestAnimationFrame(() => {
      const pending = this._pendingKind
      this._frame = null
      this._pendingKind = null
      if (pending === 'scene') this._runDetached(this.renderScene(), 'Scene Canvas render failed:')
      else if (pending === 'viewport') this._runDetached(this.renderViewport(), 'Scene Canvas viewport update failed:')
    })
  }

  async renderScene(): Promise<void> {
    const renderer = this._renderer
    if (!renderer) return

    this._cancelFrame()
    const renderEpoch = ++this._renderEpoch
    const prepared = await this._options.prepareSceneRender()
    if (renderEpoch !== this._renderEpoch || renderer !== this._renderer) return
    const snapshot = prepared.publish()
    if (renderEpoch !== this._renderEpoch || renderer !== this._renderer) return
    renderer.renderScene(snapshot)
    this._options.renderChrome()
  }

  async renderViewport(): Promise<void> {
    const renderer = this._renderer
    if (!renderer) return
    renderer.setViewport(this._options.getViewport())
    this._options.renderChrome()
  }

  /** MapLibre owns the drawing surface size; a resize is a camera-only update. */
  resize(_width: number, _height: number): void {
    this._runDetached(this.renderViewport(), 'Scene Canvas resize failed:')
  }

  /**
   * Releases the mounted renderer and fences pending work. The runtime keeps
   * its Scene; nothing draws until a renderer is mounted again.
   */
  async unmount(): Promise<void> {
    this._cancelFrame()
    this._container = null
    this._renderEpoch += 1
    this._mountEpoch += 1
    this._mounting = false
    const renderer = this._renderer
    this._renderer = null
    if (renderer) await disposeRenderer(renderer)
  }

  dispose(): void {
    void this.unmount()
  }

  private _cancelFrame(): void {
    if (this._frame !== null) cancelAnimationFrame(this._frame)
    this._frame = null
    this._pendingKind = null
  }

  private _runDetached(operation: Promise<void>, failureMessage: string): void {
    void operation.catch((error) => {
      console.error(failureMessage, error)
    })
  }
}

async function disposeRenderer(renderer: SceneRendererInstance): Promise<void> {
  try {
    await renderer.dispose()
  } catch (error) {
    console.error('Scene Canvas renderer disposal failed:', error)
  }
}
