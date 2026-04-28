import { indexPanelTargetScene, resolvePanelTargetIdentity } from './panel-target-identity'
import type { PanelTargetSceneInput } from './panel-target-identity'
import type { PanelTarget } from './types/design'

export type PanelTargetResolutionScene = PanelTargetSceneInput

export interface PanelTargetResolutionResult {
  readonly plantIds: readonly string[]
  readonly zoneIds: readonly string[]
  readonly sceneIds: readonly string[]
  readonly unresolvedTargets: readonly PanelTarget[]
}

export function resolvePanelTargets(
  targets: readonly PanelTarget[],
  scene: PanelTargetResolutionScene,
): PanelTargetResolutionResult {
  const resolution = resolvePanelTargetIdentity(targets, indexPanelTargetScene(scene))
  return {
    plantIds: resolution.plantIds,
    zoneIds: resolution.zoneIds,
    sceneIds: resolution.sceneIds,
    unresolvedTargets: resolution.unresolvedTargets,
  }
}
