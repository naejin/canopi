import type { Guide } from '../../guides'
import type { SceneEditingAids } from '../renderers/scene-types'
import { SceneChromeOverlay } from '../scene-chrome'
import { getMapBackdropInk } from '../scene-visuals'
import type { ViewFrame } from '../view/types'

interface SceneRuntimeChromeSnapshot {
  frame: ViewFrame
  rulersVisible: boolean
  gridVisible: boolean
  guidesVisible: boolean
  guides: Guide[]
}

export class SceneRuntimeChromeCoordinator {
  private _overlay: SceneChromeOverlay | null = null
  private _visible = false

  attach(
    container: HTMLElement,
    onGuideCreate: (axis: 'h' | 'v', worldPosition: number) => void,
  ): void {
    this.destroy()
    this._overlay = new SceneChromeOverlay(container, onGuideCreate)
  }

  show(): void {
    this._visible = true
  }

  hide(): void {
    this._visible = false
  }

  refreshTheme(): void {
    this._overlay?.refreshTheme()
  }

  /**
   * Draws the rulers for this frame and returns the editing aids the workspace map draws (the grid and the ruler
   * guides), null while the chrome is hidden or there is nothing to draw.
   */
  update({ guidesVisible, ...snapshot }: SceneRuntimeChromeSnapshot): SceneEditingAids | null {
    this._overlay?.update({
      ...snapshot,
      guides: guidesVisible ? snapshot.guides : [],
      chromeVisible: this._visible,
    })
    if (!this._visible) return null
    const ink = snapshot.gridVisible ? getMapBackdropInk() : null
    const rulerGuides = guidesVisible ? snapshot.guides.map(({ axis, position }) => ({ axis, position })) : []
    if (!ink && rulerGuides.length === 0) return null
    return { grid: ink ? { ink: ink.grid, majorInk: ink.gridMajor } : null, rulerGuides }
  }

  destroy(): void {
    this._overlay?.destroy()
    this._overlay = null
  }
}
