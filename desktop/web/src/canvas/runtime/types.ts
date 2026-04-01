import Konva from 'konva'
import type { CanvasHistory } from '../history'
import type { HtmlRulers } from '../rulers'
import type { CanvasLayers, CanvasToolEngine } from '../contracts'
import type { CanvasTool } from '../tools/base'
import type { RenderPass } from './render-passes'

export interface RenderPipelineDeps {
  stage: Konva.Stage
  layers: CanvasLayers
  getHtmlRulers: () => HtmlRulers | null
  speciesCache: {
    getCache: () => Map<string, Record<string, unknown>>
    loadVisiblePlantEntries: (plantsLayer: Konva.Layer | undefined, locale: string) => Promise<boolean>
  }
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
  toolRegistry: Map<string, CanvasTool>
  engine: CanvasToolEngine
  getSpaceHeld: () => boolean
  setSpaceHeld: (value: boolean) => void
  getWasSpaceDraggable: () => boolean
  setWasSpaceDraggable: (value: boolean) => void
  getActiveToolCursor: () => string
  invalidateRender: (...passes: RenderPass[]) => void
}
