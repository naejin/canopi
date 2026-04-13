import { RendererHost } from '../renderers'
import type { SceneRendererContext, SceneRendererInstance, SceneRendererSnapshot } from '../renderers/scene-types'
import type { SceneViewportState } from '../scene'

export type SceneRuntimeRenderKind = 'scene' | 'viewport' | 'chrome'

interface SceneRuntimeRenderSchedulerOptions {
  getRendererHost(): RendererHost<SceneRendererContext, SceneRendererInstance>
  getViewport(): SceneViewportState
  prepareSceneSnapshot(): Promise<SceneRendererSnapshot>
  renderChrome(): void
}

export class SceneRuntimeRenderScheduler {
  private _container: HTMLElement | null = null
  private _renderEpoch = 0

  constructor(private readonly _options: SceneRuntimeRenderSchedulerOptions) {}

  get container(): HTMLElement | null {
    return this._container
  }

  async initialize(container: HTMLElement): Promise<void> {
    this._container = container
    await this._options.getRendererHost().initialize({ container })
  }

  invalidate(kind: SceneRuntimeRenderKind): void {
    if (kind === 'chrome') {
      this._options.renderChrome()
      return
    }
    if (kind === 'viewport') {
      void this.renderViewport()
      return
    }
    void this.renderScene()
  }

  async renderScene(): Promise<void> {
    const container = this._container
    if (!container) return

    const renderEpoch = ++this._renderEpoch
    const snapshot = await this._options.prepareSceneSnapshot()
    if (renderEpoch !== this._renderEpoch || container !== this._container) return

    await this._options.getRendererHost().run((renderer) => {
      renderer.resize(
        Math.max(1, container.clientWidth),
        Math.max(1, container.clientHeight),
      )
      renderer.renderScene(snapshot)
    }, {
      operationName: 'render scene',
    })
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
    void this._options.getRendererHost().run((renderer) => {
      renderer.resize(width, height)
      renderer.setViewport(this._options.getViewport())
    })
    this._options.renderChrome()
  }

  dispose(): void {
    this._container = null
    this._renderEpoch += 1
    void this._options.getRendererHost().dispose()
  }
}
