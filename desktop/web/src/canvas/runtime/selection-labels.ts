import { worldToScreen } from './annotation-layout'
import type { ScenePlantEntity, ScenePoint, SceneViewportState } from './scene'

export interface SelectionLabel {
  canonicalName: string
  text: string
  fontStyle: 'normal' | 'italic'
  screenPoint: ScenePoint
}

const LABEL_OVERLAP_PX = 16

export function computeSelectionLabels(
  plants: readonly ScenePlantEntity[],
  selectedIds: ReadonlySet<string>,
  viewport: SceneViewportState,
  localizedCommonNames: ReadonlyMap<string, string | null>,
): SelectionLabel[] {
  if (selectedIds.size === 0) return []

  // Group selected plants by species
  const groups = new Map<string, ScenePlantEntity[]>()
  for (const plant of plants) {
    if (!selectedIds.has(plant.id)) continue
    const group = groups.get(plant.canonicalName)
    if (group) group.push(plant)
    else groups.set(plant.canonicalName, [plant])
  }

  // Compute one label per species at centroid
  const labels: SelectionLabel[] = []
  for (const [canonicalName, group] of groups) {
    let sumX = 0
    let sumY = 0
    for (const plant of group) {
      sumX += plant.position.x
      sumY += plant.position.y
    }
    const worldCentroid = { x: sumX / group.length, y: sumY / group.length }
    const screenPoint = worldToScreen(worldCentroid, viewport)

    const localizedName = localizedCommonNames.get(canonicalName) ?? group[0]!.commonName
    const text = localizedName || abbreviateCanonical(canonicalName)
    const fontStyle = localizedName ? 'normal' as const : 'italic' as const

    labels.push({ canonicalName, text, fontStyle, screenPoint })
  }

  // Sort by screen Y and nudge overlapping labels apart
  labels.sort((a, b) => a.screenPoint.y - b.screenPoint.y)
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1]!
    const curr = labels[i]!
    const overlap = (prev.screenPoint.y + LABEL_OVERLAP_PX) - curr.screenPoint.y
    if (overlap > 0) {
      curr.screenPoint.y += overlap
    }
  }

  return labels
}

function abbreviateCanonical(name: string): string {
  const parts = name.split(' ')
  return parts.length >= 2
    ? `${parts[0]![0]}. ${parts[1]!.slice(0, 3)}.`
    : name.slice(0, 6)
}
