import Konva from 'konva'
import type { CanvasHistory } from '../history'
import type { HtmlRulers } from '../rulers'
import type { ScaleBar } from '../scale-bar'
import type { CanvasTool } from '../tools/base'
import type { CanvasEngine } from '../engine'
import type { RenderPass } from './render-passes'

export type CanvasLayers = Map<string, Konva.Layer>

export interface RenderPipelineDeps {
  stage: Konva.Stage
  layers: CanvasLayers
  getHtmlRulers: () => HtmlRulers | null
  getScaleBar: () => ScaleBar | null
  getSpeciesCache: () => Map<string, Record<string, unknown>>
  loadSpeciesCache: (locale: string) => Promise<void>
}

export interface ViewportDeps {
  stage: Konva.Stage
  layers: CanvasLayers
  applyStageTransform: (
    scale: number,
    position: { x: number; y: number },
    options?: { invalidateDeferred?: boolean },
  ) => void
  invalidateRender: (...passes: RenderPass[]) => void
}

export interface ObjectOpsDeps {
  stage: Konva.Stage
  layers: CanvasLayers
  history: CanvasHistory
  getClipboard: () => string | null
  setClipboard: (value: string | null) => void
}

export interface DocumentSessionEngine {
  stage: Konva.Stage
  layers: CanvasLayers
  restoreGuides: () => void
  restoreObjectGroups: (groups: import('../../types/design').ObjectGroup[]) => void
  invalidateRender: (...passes: RenderPass[]) => void
  getDocumentLoadEpoch: () => number
}

export interface ExternalInputDeps {
  stage: Konva.Stage
  layers: CanvasLayers
  history: CanvasHistory
  toolRegistry: Map<string, CanvasTool>
  getEngine: () => CanvasEngine
  getSpaceHeld: () => boolean
  setSpaceHeld: (value: boolean) => void
  getWasSpaceDraggable: () => boolean
  setWasSpaceDraggable: (value: boolean) => void
  getActiveToolCursor: () => string
  invalidateRender: (...passes: RenderPass[]) => void
}
