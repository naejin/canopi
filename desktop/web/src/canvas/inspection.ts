import type { ReadonlySignal } from '@preact/signals'

export interface InspectionPoint { readonly x: number; readonly y: number }
export interface InspectionLabel extends InspectionPoint {
  readonly width: number
  readonly height: number
  readonly lines: readonly string[]
}
export interface InspectedPlant {
  readonly id: string
  readonly name: string
  readonly position: InspectionPoint
  readonly distanceM: number
  readonly screenPosition: InspectionPoint
  readonly label: InspectionLabel | null
}
export interface CanvasInspectionState {
  readonly point: InspectionPoint
  readonly held: boolean
  readonly zoomPercent: number
  readonly previewAvailable: boolean
  readonly frame: { readonly width: number; readonly height: number }
  readonly plants: readonly InspectedPlant[]
}

/** A view-only Canvas resource. Its owner also releases it on runtime teardown. */
export interface CanvasInspectionHandle {
  readonly state: ReadonlySignal<CanvasInspectionState | null>
  inspect(point: InspectionPoint): void
  setHeld(held: boolean): void
  zoomBy(factor: number): void
  highlightPlant(id: string | null): void
  focusPlant(id: string): void
  dispose(): void
}
