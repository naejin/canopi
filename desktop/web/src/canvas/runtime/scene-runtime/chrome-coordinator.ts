import type { Guide } from '../../guides'
import { SceneChromeOverlay } from '../scene-chrome'
import type { CameraViewportSnapshot } from '../camera'

interface SceneRuntimeChromeSnapshot {
  camera: CameraViewportSnapshot
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

  update({ guidesVisible, ...snapshot }: SceneRuntimeChromeSnapshot): void {
    this._overlay?.update({
      ...snapshot,
      guides: guidesVisible ? snapshot.guides : [],
      chromeVisible: this._visible,
    })
  }

  destroy(): void {
    this._overlay?.destroy()
    this._overlay = null
  }
}
