import Konva from 'konva'
import type { RenderPass } from './runtime/render-passes'

export type CanvasLayers = Map<string, Konva.Layer>

export interface PlantPlacementSpec {
  canonicalName: string
  commonName: string | null
  stratum: string | null
  canopySpreadM: number | null
  position: { x: number; y: number }
}

export interface CanvasGeometryEngine {
  stage: Konva.Stage
  layers: CanvasLayers
}

export interface CanvasCommandEngine extends CanvasGeometryEngine {
  removeNode(nodeId: string): void
  getSelectedNodes(): Konva.Node[]
  invalidateRender(...passes: RenderPass[]): void
}

export interface Command {
  readonly type: string
  readonly dirtyPasses: readonly RenderPass[]
  execute(engine: CanvasCommandEngine): void
  undo(engine: CanvasCommandEngine): void
}

export interface CanvasHistoryHandle {
  execute(cmd: Command, engine: CanvasCommandEngine): void
  record(cmd: Command, engine: CanvasCommandEngine): void
}

export interface CanvasToolEngine extends CanvasCommandEngine {
  history: CanvasHistoryHandle
  createPlantPlacementNode(plant: PlantPlacementSpec): Konva.Group
}
