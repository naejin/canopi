import { nextPlantLabelMode, type PlantLabelMode } from '../../canvas/runtime/plant-display'
import { readPlantDisplayOptions, setPlantDisplayOptions } from '../design-edit/plant-display'
import { currentDesign } from '../document-session/store'

export {
  resetStratumDisplayColors,
  setPlantDisplayOptions,
  setStratumDisplayColor,
} from '../design-edit/plant-display'

export function setPlantLabels(labels: PlantLabelMode): void {
  setPlantDisplayOptions({ labels })
}

/** View › Labels (N): None, Codes, Names, then None again. */
export function cyclePlantLabels(): void {
  const design = currentDesign.peek()
  if (!design) return
  setPlantLabels(nextPlantLabelMode(readPlantDisplayOptions(design).labels))
}
