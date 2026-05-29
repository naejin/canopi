import { indexTargetScene, resolveTargetsInScene, type TargetSceneInput } from './identity'
import type { PanelTarget } from '../types/design'

export type TargetResolutionScene = TargetSceneInput

export interface TargetResolutionResult {
  readonly plantIds: readonly string[]
  readonly zoneIds: readonly string[]
  readonly sceneIds: readonly string[]
  readonly unresolvedTargets: readonly PanelTarget[]
}

export function resolveTargets(
  values: readonly PanelTarget[],
  scene: TargetResolutionScene,
): TargetResolutionResult {
  const resolution = resolveTargetsInScene(values, indexTargetScene(scene))
  return {
    plantIds: resolution.plantIds,
    zoneIds: resolution.zoneIds,
    sceneIds: resolution.sceneIds,
    unresolvedTargets: resolution.unresolvedTargets,
  }
}
