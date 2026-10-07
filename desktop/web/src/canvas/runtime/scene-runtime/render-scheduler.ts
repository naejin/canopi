import { signal, type ReadonlySignal } from '@preact/signals'
import type { SceneRendererSnapshot, SceneRenderTarget } from '../renderers/scene-types'
import type { DraftPresentation } from '../tools/draft'

interface SceneRuntimePreparedRender {
  publish(): SceneRendererSnapshot
}

interface SceneRuntimeRenderSchedulerOptions {
  prepareSceneRender(): Promise<SceneRuntimePreparedRender>
  /**
   * Runs first in every scene render: a waiting open fit places the camera (document-surface.ts), so the render draws the
   * opened Design where it opens, inside the chrome mounted since the open. A view-mode change it causes is this render's.
   */
  placeOpenedDesign(): void
}

/**
 * Owns the runtime's one target slot (ADR 0019): the map-owned shared scene layer connects to it and gets the latest
 * snapshot and draft, so a layer a Design switch or a Retry rebuilt draws the Scene with no pan. While mounted it coalesces
 * scene invalidations into frames that publish a whole snapshot; the layer reads the camera itself, so a camera frame
 * only asks it for a repaint. There is no renderer definition, selection or fallback (ADR 0004).
 */
export class SceneRuntimeRenderScheduler {
  private _container: HTMLElement | null = null
  private _target: SceneRenderTarget | null = null
  /** What a connecting target draws: the open Design's latest published snapshot and draft while mounted, else null. */
  private _snapshot: SceneRendererSnapshot | null = null
  private _draft: DraftPresentation | null = null
  private _renderEpoch = 0
  private _frame: number | null = null
  /** A scene invalidation waits for its frame. */
  private _sceneFrameQueued = false
  /** The epoch of the latest scene render, until it has drawn or failed; a newer epoch fences it. */
  private _sceneRenderEpoch: number | null = null
  /**
   * The scene render that published `_snapshot` into the empty slot while an opened Design waited for its first draw: it
   * settles once a target draws it.
   */
  private _undrawnEpoch: number | null = null
  /** Scene renders up to this epoch were started before the latest awaitPresentation; only a later one presents. */
  private _presentAfterEpoch = 0
  private readonly _scenePending = signal(false)
  private readonly _presented = signal(true)
  /** Unmount released the slot and no mount has begun since, so nothing here will draw an opened Design. */
  private _unmounted = false

  constructor(private readonly _options: SceneRuntimeRenderSchedulerOptions) {}

  get container(): HTMLElement | null {
    return this._container
  }

  /**
   * True from a scene invalidation until the frame that draws it has run, the render
   * failed, or unmount fenced it. Camera-only frames never set it.
   */
  get scenePending(): ReadonlySignal<boolean> {
    return this._scenePending
  }

  /**
   * False from awaitPresentation until a scene render started after it has drawn (or failed), or the renderer unmounts and
   * nothing will draw it. Camera frames and later scene changes never turn it false.
   */
  get presented(): ReadonlySignal<boolean> {
    return this._presented
  }

  /**
   * A Design was opened: it is presented by the first scene render started from now on (the mount's, if none is mounted yet),
   * or at once when nothing will draw it. The previous Design's snapshot and draft are dropped, so a layer connecting before
   * the opened Design publishes draws nothing rather than the previous Design at the new camera.
   */
  awaitPresentation(): void {
    this._snapshot = null
    this._draft = null
    if (this._unmounted) return
    this._presentAfterEpoch = this._renderEpoch
    this._presented.value = false
  }

  /**
   * No Design shows (Close Design's start screen): no layer will connect to draw one, so the open is presented, a render
   * waiting for a layer settles now, and later ones settle on their frame until a Design opens again.
   */
  releasePresentation(): void {
    if (this._undrawnEpoch !== null) this._settleSceneRender(this._undrawnEpoch)
    this._undrawnEpoch = null
    this._presented.value = true
  }

  /** Mounts on the map container; the target slot draws from now on. */
  mount(container: HTMLElement): void {
    if (this._container) throw new Error('The Scene Canvas renderer is already mounted. Unmount it before mounting again.')
    this._container = container
    this._unmounted = false
  }

  /**
   * Fills the slot: the target gets the latest snapshot and draft at once, then every later one; a scene render that
   * published into the empty slot settles once this target draws it. Returns the disconnect, which is ignored once another
   * target has connected.
   */
  connect(target: SceneRenderTarget): () => void {
    this._target = target
    if (this._snapshot) target.setSnapshot(this._snapshot)
    if (this._draft) target.setDraft(this._draft)
    if (this._undrawnEpoch !== null) this._settleWhenDrawn(this._undrawnEpoch)
    this._undrawnEpoch = null
    return () => {
      if (this._target === target) this._target = null
    }
  }

  /** A camera frame: the layer reads it when MapLibre draws, so the target only repaints and no snapshot is published. */
  requestRepaint(): void {
    if (this._container) this._target?.requestRender()
  }

  /** A scene change: a whole snapshot is published on the next frame. */
  invalidate(): void {
    if (!this._container) return
    // Fence an in-flight preparation immediately, even though drawing waits for a frame.
    this._renderEpoch += 1
    this._sceneFrameQueued = true
    this._publishScenePending()
    if (this._frame !== null) return
    this._frame = requestAnimationFrame(() => {
      this._frame = null
      this._sceneFrameQueued = false
      this._runDetached(this.renderScene(), 'Scene Canvas render failed:')
    })
  }

  async renderScene(): Promise<void> {
    if (!this._container) return

    // Before the frame is cancelled and the epoch taken: a scene invalidation the placement raises folds into this render.
    this._options.placeOpenedDesign()
    this._cancelFrame()
    const renderEpoch = ++this._renderEpoch
    this._sceneRenderEpoch = renderEpoch
    this._publishScenePending()
    try {
      const prepared = await this._options.prepareSceneRender()
      if (renderEpoch !== this._renderEpoch) return
      const snapshot = prepared.publish()
      if (renderEpoch !== this._renderEpoch) return
      this._snapshot = snapshot
      // With the slot empty while an opened Design waits for its first draw (a Design switch before its layer connects),
      // nothing draws the snapshot: the render stays pending until a target connects and draws it.
      this._undrawnEpoch = this._target || this._presented.value ? null : renderEpoch
      this._target?.setSnapshot(snapshot)
    } catch (error) {
      this._settleSceneRender(renderEpoch)
      throw error
    }
    if (this._undrawnEpoch === null) this._settleWhenDrawn(renderEpoch)
  }

  /**
   * The ToolHost's draft sink: a tool draft goes straight to the target, which draws it on the map's next frame without a
   * scene render. Unmounted, there is nothing to draw on.
   */
  setDraft(draft: DraftPresentation | null): void {
    if (!this._container) return
    this._draft = draft
    this._target?.setDraft(draft)
  }

  /**
   * Stops drawing and fences pending work. The runtime keeps its Scene, and the slot keeps its target; nothing draws
   * until the runtime mounts again.
   */
  unmount(): void {
    this._cancelFrame()
    this._container = null
    this._snapshot = null
    this._undrawnEpoch = null
    this._draft = null
    this._renderEpoch += 1
    this._publishScenePending()
    this._unmounted = true
    this._presented.value = true
  }

  dispose(): void {
    this.unmount()
  }

  private _cancelFrame(): void {
    if (this._frame !== null) cancelAnimationFrame(this._frame)
    this._frame = null
    this._sceneFrameQueued = false
  }

  /**
   * The target asked MapLibre for a repaint, which draws the snapshot in the next animation frame; a frame callback
   * requested after it runs once that drawing is done.
   */
  private _settleWhenDrawn(renderEpoch: number): void {
    requestAnimationFrame(() => this._settleSceneRender(renderEpoch))
  }

  private _settleSceneRender(renderEpoch: number): void {
    if (this._sceneRenderEpoch !== renderEpoch) return
    this._sceneRenderEpoch = null
    this._publishScenePending()
    if (renderEpoch > this._presentAfterEpoch) this._presented.value = true
  }

  /** A scene invalidation waits for its frame, or the latest scene render has not drawn yet. */
  private _publishScenePending(): void {
    this._scenePending.value = this._sceneFrameQueued || this._sceneRenderEpoch === this._renderEpoch
  }

  private _runDetached(operation: Promise<void>, failureMessage: string): void {
    void operation.catch((error) => {
      console.error(failureMessage, error)
    })
  }
}
