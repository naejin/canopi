import type { Guide } from '../../guides'
import { SceneChromeOverlay } from '../scene-chrome'
import type { CameraViewportSnapshot } from '../camera'

interface SceneRuntimeChromeSnapshot {
  camera: CameraViewportSnapshot
  rulersVisible: boolean
  gridVisible: boolean
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

  update(snapshot: SceneRuntimeChromeSnapshot): void {
    this._overlay?.update({
      ...snapshot,
      chromeVisible: this._visible,
    })
  }

  destroy(): void {
    this._overlay?.destroy()
    this._overlay = null
  }
}
