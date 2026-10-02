import { getCanvasPlantNameLabels } from '../automatic-detail'
import { projectScenePlantLabels, type PlantNameLabel, type SelectionLabel } from '../selection-labels'
import type { SceneRendererSnapshot } from './scene-types'

/** The labels the scene draws: a single selection's name and the admitted plant names, each at an offset from its anchor. */
export interface AdmittedLabels {
  readonly selectionLabels: readonly SelectionLabel[]
  readonly plantNameLabels: readonly PlantNameLabel[]
}

/** Admits the labels of `snapshot` at `pixelsPerMetre`; a translation never changes admission, so none is taken. */
export function admitLabels(snapshot: SceneRendererSnapshot, pixelsPerMetre: number): AdmittedLabels {
  const viewport = { x: 0, y: 0, scale: pixelsPerMetre }
  const projected = projectScenePlantLabels(snapshot, viewport)
  return {
    selectionLabels: projected.selectionLabels,
    plantNameLabels: getCanvasPlantNameLabels(snapshot, viewport, projected),
  }
}

/**
 * Label admission at today's cadence (spec §1.5; settle and zoom band from phase R): a scene sync or any scale change
 * admits again, while a pan keeps the admitted labels, which the billboards move with their anchors.
 */
export class LabelAdmission {
  private snapshot: SceneRendererSnapshot | null = null
  private admitted: { readonly pixelsPerMetre: number; readonly labels: AdmittedLabels } | null = null

  /** The labels last admitted; null before a scene and its first scale. */
  get current(): AdmittedLabels | null { return this.admitted?.labels ?? null }

  setScene(snapshot: SceneRendererSnapshot): void {
    this.snapshot = snapshot
    this.admitted = null
  }

  /** The labels at `pixelsPerMetre`, admitted again only when the scene or the scale changed; null before a scene. */
  admit(pixelsPerMetre: number): AdmittedLabels | null {
    if (!this.snapshot) return null
    if (this.admitted?.pixelsPerMetre !== pixelsPerMetre) {
      this.admitted = { pixelsPerMetre, labels: admitLabels(this.snapshot, pixelsPerMetre) }
    }
    return this.admitted.labels
  }

  dispose(): void {
    this.snapshot = null
    this.admitted = null
  }
}
