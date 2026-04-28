import type { PanelTarget } from '../../../types/design'

export interface SceneRuntimePanelTargetAdapter {
  readPanelOriginTargets(): readonly PanelTarget[]
  setCanvasHoverTargets(targets: readonly PanelTarget[]): void
  clearPanelOriginTargets(): void
  subscribePanelOriginTargetChanges(onChange: () => void): () => void
}

export function createDetachedSceneRuntimePanelTargetAdapter(): SceneRuntimePanelTargetAdapter {
  return {
    readPanelOriginTargets: () => [],
    setCanvasHoverTargets: () => {},
    clearPanelOriginTargets: () => {},
    subscribePanelOriginTargetChanges: () => () => {},
  }
}
