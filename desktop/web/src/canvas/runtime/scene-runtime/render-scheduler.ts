import {
  RendererHost,
  RendererHostInitializationCancelledError,
} from '../renderers'
import type { SceneRendererContext, SceneRendererInstance, SceneRendererSnapshot } from '../renderers/scene-types'
import type { SceneViewportState } from '../scene'

export type SceneRuntimeRenderKind = 'scene' | 'viewport' | 'chrome'

export interface SceneRuntimePreparedRender {
  publish(): SceneRendererSnapshot
}

interface SceneRuntimeRenderSchedulerOptions {
  getRendererHost(): RendererHost<SceneRendererContext, SceneRendererInstance>
  getViewport(): SceneViewportState
  prepareSceneRender(): Promise<SceneRuntimePreparedRender>
  renderChrome(): void
}

export class SceneRuntimeRenderScheduler {
  private _container: HTMLElement | null = null
  private _renderEpoch = 0
  private _frame: number | null = null
  private _pendingKind: 'scene' | 'viewport' | null = null
  private readonly _sizes = new WeakMap<SceneRendererInstance, { width: number; height: number }>()

  constructor(private readonly _options: SceneRuntimeRenderSchedulerOptions) {}

  get container(): HTMLElement | null {
    return this._container
  }

  async initialize(container: HTMLElement): Promise<void> {
    await this._options.getRendererHost().initialize({ container })
    this._container = container
  }

  invalidate(kind: SceneRuntimeRenderKind): void {
    if (kind === 'chrome') {
      this._options.renderChrome()
      return
    }
    if (!this._container) return
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
    const container = this._container
    if (!container) return

    this._cancelFrame()
    const renderEpoch = ++this._renderEpoch
    const prepared = await this._options.prepareSceneRender()
    if (renderEpoch !== this._renderEpoch || container !== this._container) return
    const snapshot = prepared.publish()
    if (renderEpoch !== this._renderEpoch || container !== this._container) return

    await this._options.getRendererHost().run((renderer) => {
      if (renderEpoch !== this._renderEpoch || container !== this._container) return
      this._resizeRenderer(renderer,
        Math.max(1, container.clientWidth),
        Math.max(1, container.clientHeight),
      )
      renderer.renderScene(snapshot)
    }, {
      operationName: 'render scene',
    })
    if (renderEpoch !== this._renderEpoch || container !== this._container) return
    this._options.renderChrome()
  }

  async renderViewport(): Promise<void> {
    if (!this._container) return
    await this._options.getRendererHost().run((renderer) => {
      renderer.setViewport(this._options.getViewport())
    }, {
      operationName: 'update viewport',
    })
    this._options.renderChrome()
  }

  resize(width: number, height: number): void {
    if (!this._container) return
    this._runDetached(this._options.getRendererHost().run((renderer) => {
      this._resizeRenderer(renderer, width, height)
      renderer.setViewport(this._options.getViewport())
    }), 'Scene Canvas resize failed:')
    this._options.renderChrome()
  }

  dispose(): void {
    this._cancelFrame()
    this._container = null
    this._renderEpoch += 1
    void this._options.getRendererHost().dispose()
  }

  private _cancelFrame(): void {
    if (this._frame !== null) cancelAnimationFrame(this._frame)
    this._frame = null
    this._pendingKind = null
  }

  private _resizeRenderer(renderer: SceneRendererInstance, width: number, height: number): void {
    const previous = this._sizes.get(renderer)
    if (previous?.width === width && previous.height === height) return
    renderer.resize(width, height)
    this._sizes.set(renderer, { width, height })
  }

  private _runDetached(operation: Promise<void>, failureMessage: string): void {
    void operation.catch((error) => {
      if (error instanceof RendererHostInitializationCancelledError) return
      console.error(failureMessage, error)
    })
  }
}
