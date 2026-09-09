/** Read-only, renderer-independent authored Canvas content for physical output. */
export interface PrintPoint { readonly x: number; readonly y: number }
export interface PrintBounds extends PrintPoint { readonly width: number; readonly height: number }
export interface PrintMarkPath {
  readonly d: string
  readonly fill: boolean
  readonly stroke: boolean
  readonly strokeWidth: number
}
export interface PrintPlant {
  readonly id: string
  readonly canonicalName: string
  readonly position: PrintPoint
  readonly color: string
  readonly symbol: string
  readonly mark: readonly PrintMarkPath[]
  readonly pinnedName: boolean
}
export interface PrintZone {
  readonly name: string
  readonly path: string
  readonly bounds: PrintBounds
  readonly fill: string | null
}
export interface CanvasPrintSnapshot {
  readonly layers: readonly { readonly name: string; readonly visible: boolean; readonly opacity: number }[]
  readonly plants: readonly PrintPlant[]
  readonly zones: readonly PrintZone[]
  readonly annotations: readonly {
    readonly id: string
    readonly position: PrintPoint
    readonly text: string
    readonly fontSize: number
    readonly rotation: number
  }[]
  readonly measurements: readonly { readonly id: string; readonly start: PrintPoint; readonly end: PrintPoint }[]
}
