// canvas/runtime/interaction-ports.ts  (types; implementations in input/ and tools/)

import type { ReadonlySignal } from '@preact/signals'
import type { CanvasToolGuidance } from '../session-state'
import type { CanvasFocusPort } from './app-adapter'
import type { Bindings } from './input/bindings'
import type { Gesture, MenuSource } from './input/gestures'
import type { InputPlatform } from './input/platform'
import type { AdapterEffect, RawInput } from './input/raw-input'
import type { ToolId } from './interaction-types'
import type { SceneRendererV2 } from './renderers/scene-types'
import type { CanvasSceneEditCommandSurface } from './runtime'
import type { SceneDesignObjectSelection, SceneDesignObjectTarget } from './scene/design-object-targets'
import type { SceneStateReader } from './scene/store'
import type { SceneEditCoordinator } from './scene-runtime/transactions'
import type { ToolHandle } from './tools/draft'
import type {
  HitTarget,
  SceneLayerKind,
  TextEntryRequest,
  ToolCommand,
  ToolContext,
  ToolReply,
  ToolScene,
  ToolSettingsPort,
  ToolSource,
} from './tools/tool'
import type { ViewNavigation } from './view/navigation'
import type { ScreenPoint, ViewFrameSource, WorldPoint } from './view/types'

export interface DomInputSourceDeps {
  readonly host: HTMLElement                                    // the map host; listeners attach here and, during an owned session, on window
  readonly platform: InputPlatform
  readonly bindings: () => Bindings                             // CURRENT_BINDINGS in production
  readonly keys: { readonly physicalCtrl: () => boolean; readonly lastKeyboardMenuAt: () => number | null }   // from the KeyRouter
  readonly clock: () => number
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void }
}
export interface DomInputSource {
  /** Installs the host listeners; returns the disposer that removes every listener it added (tested: exactly once each). */
  attach(sink: (input: RawInput) => void): () => void
  /** Applies recogniser effects (preventDefault on the event being handled, capture, timers). */
  apply(effects: readonly AdapterEffect[]): void
}

/**
 * An adapter over today's controller (`createCanvasContextMenu`, interaction/canvas-context-menu.ts), which builds the
 * app's CanvasContextMenuRequest (canvas/runtime/app-adapter.ts: anchor, world, retargeted selection, commands,
 * placePlantsAt, saveSelectionAsObjectStamp, returnFocus) and hands it to CanvasRuntimeAppAdapter.contextMenu.
 * The host fills the optional entries from its hit and tool state; the request type gains them in phase 1 (D1).
 */
export interface ContextMenuPort {
  open(request: {
    readonly at: WorldPoint | 'selection'
    readonly source: MenuSource
    readonly screen: ScreenPoint | null
    readonly hit: HitTarget | null
    readonly turnViewToEdge?: () => void                        // a zone-edge hit within the source's tolerance (§4.16)
    readonly highlightEdge?: (on: boolean) => void              // while the entry is highlighted: the ochre trace (a draft)
    readonly finishShape?: () => void                           // ToolHost.command({ kind: 'finish-shape' }) during a 3+ corner draft
  }): void
  close(): void
  readonly isOpen: () => boolean
}
export interface InputRouterDeps {
  readonly navigation: Pick<ViewNavigation, 'panByPx' | 'zoomAroundPx' | 'beginRotation'>
  readonly toolHost: ToolHost
}
export interface InputRouter {
  /** Routes one gesture: navigation → ViewNavigation, menu-request → ToolHost.menuAt (the host is the only menu opener), editing and drops → ToolHost. Computes no geometry. */
  route(g: Gesture): void
}

/** Built by interaction-session.ts; everything the host needs, so tools stay narrow. */
export interface ToolHostDeps {
  readonly frames: ViewFrameSource                              // ToolView, re-emit on onViewFrame('tools'), plane changes
  readonly scene: ToolScene                                     // from createToolScene below: spatial index per scene revision
  readonly edits: SceneEditCoordinator
  readonly renderer: Pick<SceneRendererV2, 'setDraft' | 'setSelectionPreview'>
  readonly chrome: {
    setHandles(h: readonly ToolHandle[]): void; requestTextEntry(r: TextEntryRequest): Promise<string | null>; setCursor(c: string): void
    setTooltip(t: { readonly target: SceneDesignObjectTarget; readonly at: ScreenPoint } | null): void   // chrome/hover-tooltip.ts
    setLockedAffordance(target: SceneDesignObjectTarget | null): void                                     // chrome/locked-affordance.ts
  }
  readonly menu: ContextMenuPort                                // opened only by the host (menuAt, ToolEffects.requestMenu)
  readonly focus: CanvasFocusPort                               // ToolEffects.requestFocus
  readonly guidance: (g: Partial<CanvasToolGuidance> | null) => void
  readonly toolState: { readonly active: ReadonlySignal<ToolId>; set(id: ToolId): void }   // the session's tool signal
  readonly settings: ToolSettingsPort
  readonly translate: ToolContext['translate']
  readonly bindings: () => Bindings                             // modifier resolution (§2.3)
  readonly platform: InputPlatform
  readonly navigation: Pick<ViewNavigation, 'turnToEdge'>       // the "Turn view to this edge" entry
  /** Today's deps.nudge (the runtime's scene-edit commands); the host owns the series (nudge below). */
  readonly nudge: Pick<CanvasSceneEditCommandSurface, 'nudgeSelected' | 'endNudge'>
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void; readonly clock: () => number }
  /** Hover restyle and the locked-object affordance: today's deps.setHoveredTarget. */
  readonly hover: (target: SceneDesignObjectTarget | null) => void
  /** The raster inspection probe (CanvasRuntimeAppAdapter.tryInspectAt, passed by scene-runtime.ts); true claims the press. INV-ENT-24. */
  readonly inspect?: (world: WorldPoint) => boolean
  /** Today's notifyTransientHistoryChange: the runtime's transientHistory revision (Edit › Undo during a draft). */
  readonly transientHistoryChanged: () => void
}

export interface ToolSceneSource {
  readonly store: SceneStateReader                              // the runtime's scene store
  readonly sceneRevision: ReadonlySignal<number>                // the index rebuilds when it changes
  readonly selection: () => SceneDesignObjectSelection
  readonly isLayerOpenForCreation: (layer: SceneLayerKind) => boolean
}

export interface ToolHost {
  gesture(g: Gesture): void                                     // editing gestures and drops; converts to world at event time
  command(c: ToolCommand): ToolReply
  /** Hits, retargets and opens the canvas menu through ToolHostDeps.menu. */
  menuAt(at: ScreenPoint | 'selection', source: MenuSource): void
  setTool(id: ToolId, source: ToolSource | null): void
  readonly activeTool: ReadonlySignal<ToolId>
  // Esc chain queries (CanvasKeyboardPort reads these)
  hasLiveGesture(): boolean
  activeToolHasTransient(): boolean
  activeToolIsSelect(): boolean
  escapeHint(): 'drop-transient' | 'leave-tool' | 'clear-selection' | null
  /**
   * Arrow nudge, the one owner of the series: with a selection, the Select tool and site mode, turns the screen direction
   * into a world delta along screenAxesInWorld() (0.1 m, or 1 m when large), calls deps.nudge.nudgeSelected and (re)starts
   * the 800 ms idle timer that commits the series. 'no-selection' tells the keyboard port to pan instead; 'blocked' means nothing.
   */
  nudge(direction: ScreenPoint, large: boolean): 'nudged' | 'blocked' | 'no-selection'
  hasNudgeSeries(): boolean                                     // the Esc layer 65
  endNudgeSeries(commit: boolean): void                         // Esc aborts; idle, focusout, a press or another key commit
  /** Transient history (today's canUndo/…TransientHistory): sends the active tool the 'undo-transient' and 'redo-transient' commands and reads its canUndoTransient?/canRedoTransient?. */
  readonly transientHistory: {
    readonly revision: ReadonlySignal<number>
    canUndo(): boolean; canRedo(): boolean; undo(): boolean; redo(): boolean
  }
  prepareForDocumentReplacement(): void                         // deactivate('document-replaced') and drop live sessions
  refreshTranslations(): void                                   // re-publishes guidance and handle labels
  /** World point under the pointer while hovering the map (null when off it); for the inspection lens and the status line. */
  subscribePointerWorld(listener: (point: WorldPoint | null) => void): () => void
  dispose(): void
}
// Today's SceneInteractionSession members: setTool → ToolHost.setTool; plantRowSpacing → CanvasToolCommandSurface
// (the host forwards to the Plant a row tool); setOverviewMode → none (the host reads ViewFrame.mode); refreshMeasurements
// → none (drafts are world-space, ADR 0019); the four transient-history members → transientHistory; prepareForDocumentReplacement,
// refreshTranslations and dispose → the same names. interaction-session.ts keeps the old session interface over these.
