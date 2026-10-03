import type { Guide } from '../../guides'
import { createRulerOverlay, type RulerOverlay } from '../chrome/rulers'
import type { SceneEditingAids } from '../renderers/scene-types'
import { getMapBackdropInk } from '../scene-visuals'
import type { ViewFrame } from '../view/types'

interface SceneRuntimeChromeSnapshot {
  frame: ViewFrame
  rulersVisible: boolean
  gridVisible: boolean
  guidesVisible: boolean
  guides: Guide[]
}

/**
 * The workspace's editing chrome (spec §1.5): it builds the Canvas2D rulers on the ruler host, redraws them after each
 * frame (shown only while north is up) and disposes them, and turns the chrome settings into the editing aids (the grid and the ruler guides) the
 * workspace map draws in its world root.
 */
export class SceneRuntimeChromeCoordinator {
  private _rulers: RulerOverlay | null = null
  private _visible = false
  private _rulersSnapshot: Parameters<RulerOverlay['update']>[0] | null = null

  attach(
    container: HTMLElement,
    onGuideCreate: (axis: 'h' | 'v', worldPosition: number) => void,
  ): void {
    this.destroy()
    this._rulers = createRulerOverlay(container, { onGuideCreate })
  }

  show(): void {
    this._visible = true
  }

  hide(): void {
    this._visible = false
  }

  refreshTheme(): void {
    this._rulers?.refreshTheme()
    if (this._rulersSnapshot) this._rulers?.update(this._rulersSnapshot)
  }

  /**
   * Draws the rulers for this frame and returns the editing aids the workspace map draws (the grid and the ruler
   * guides), null while the chrome is hidden or there is nothing to draw.
   */
  update({ frame, rulersVisible, gridVisible, guidesVisible, guides }: SceneRuntimeChromeSnapshot): SceneEditingAids | null {
    this._rulersSnapshot = { frame, rulersVisible, chromeVisible: this._visible }
    this._rulers?.update(this._rulersSnapshot)
    if (!this._visible) return null
    const ink = gridVisible ? getMapBackdropInk() : null
    const rulerGuides = guidesVisible ? guides.map(({ axis, position }) => ({ axis, position })) : []
    if (!ink && rulerGuides.length === 0) return null
    return { grid: ink ? { ink: ink.grid, majorInk: ink.gridMajor } : null, rulerGuides }
  }

  destroy(): void {
    this._rulers?.destroy()
    this._rulers = null
    this._rulersSnapshot = null
  }
}
