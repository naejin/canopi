// canvas/runtime/interaction-ports.ts  (types; implementations in input/ and tools/)

import type { ReadonlySignal } from '@preact/signals'
import type { SessionPlane } from '../session-plane'
import type { CanvasToolGuidance } from '../session-state'
import type { CanvasFocusPort } from './app-adapter'
import type { Bindings } from './input/bindings'
import type { Gesture, MenuSource } from './input/gestures'
import type { InputPlatform } from './input/platform'
import type { AdapterEffect, RawInput } from './input/raw-input'
import type { ToolHandleId, ToolId } from './interaction-types'
import type { PlantPresentationContext } from './plant-presentation'
import type { SpeciesCacheEntry } from './presentation-data'
import type { SceneRendererV2 } from './renderers/scene-types'
import type { CanvasDesignObjectSelectionModel, CanvasSceneEditCommandSurface } from './runtime'
import type { SceneDesignObjectSelection, SceneDesignObjectTarget } from './scene/design-object-targets'
import type { SceneStateReader } from './scene/store'
import type { SceneCommandAdmission, SceneEditCoordinator, SettledSceneReader } from './scene-runtime/transactions'
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

/** What a route answers for the event being handled; the source applies it. Every field optional; {} changes nothing. */
export interface GestureOutcome {
  /** preventDefault and stopImmediatePropagation (an unsettled scene, a pending failed cancellation, a refused drop). */
  readonly quarantine?: boolean
  /** dragover and drop: dataTransfer.dropEffect. */
  readonly dropEffect?: 'copy' | 'move' | 'none'
  /** A refused press: its capture is not taken and its recogniser session ends without a gesture (later moves are hovers). */
  readonly rejectSession?: boolean
}

/** Ruler guide creation, implemented by chrome/rulers.ts: today's gutter, overlay-origin and visibility checks. */
export interface RulerGuidePort {
  createGuideAt(axis: 'h' | 'v', at: ScreenPoint): void
}

export interface DomInputSourceDeps {
  readonly host: HTMLElement                                    // the map host; listeners attach here and on window (0B: from attach, as today; from F only during an owned session)
  readonly platform: InputPlatform
  readonly bindings: () => Bindings                             // CURRENT_BINDINGS in production
  readonly keys: { readonly physicalCtrl: () => boolean; readonly lastKeyboardMenuAt: () => number | null }   // from the KeyRouter
  readonly clock: () => number
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void }
  /** 0B only: today's window keydown (capture) and keyup (bubble), handed to keyboard-port.ts; 0C removes it. */
  readonly legacyKeys?: { keydown(e: KeyboardEvent): void; keyup(e: KeyboardEvent): void }
  /** Present when rulers are mounted: the source listens at document capture for ruler pointerdowns. */
  readonly rulers?: RulerGuidePort
}
export interface DomInputSource {
  /** Installs the listeners; returns the disposer that removes every listener it added (tested: exactly once each). A throwing
   *  sink quarantines the event, then rethrows (today). */
  attach(sink: (input: RawInput) => void): () => void
  /** Applies effects to the event being handled: the recogniser's, and a GestureOutcome's as 'prevent-default',
   *  'stop-propagation' and 'drop-effect'. */
  apply(effects: readonly AdapterEffect[]): void
  /** 0B only, for the legacy bridge: the DOM event being handled, or null (removed at the end of 0B). */
  currentEvent(): Event | null
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
  route(g: Gesture): GestureOutcome
}

/** Built by interaction-session.ts; everything the host needs, so tools stay narrow. */
export interface ToolHostDeps {
  readonly frames: ViewFrameSource                              // ToolView, re-emit on onViewFrame('tools'), plane changes
  readonly scene: ToolScene                                     // from createToolScene below
  readonly edits: SceneEditCoordinator
  readonly admission: SceneCommandAdmission                     // presses, menus, drops and commands run when settled (today's quarantine)
  readonly settled: SettledSceneReader                          // dragover reads
  /** History-free, dirty-free selection (today's deps.setSelection/clearSelection); backs ToolEffects.setSelection and the menu retarget. */
  readonly setSelection: (targets: readonly SceneDesignObjectTarget[]) => void
  readonly plane: () => SessionPlane                            // CanvasTool.planeChanged when its identity changes
  readonly renderer: Pick<SceneRendererV2, 'setDraft' | 'setSelectionPreview'>
  /** Redraw request after a tool call that mutated an open transaction or changed its draft or handles. */
  readonly invalidate: () => void
  readonly chrome: {
    setHandles(h: readonly ToolHandle[], active: ToolHandleId | null): void; setCursor(c: string): void
    requestTextEntry(r: TextEntryRequest, submit: (text: string) => 'close' | 'keep'): void; closeTextEntry(): void
    setTooltip(t: { readonly target: SceneDesignObjectTarget; readonly at: ScreenPoint } | null): void   // chrome/hover-tooltip.ts
    /** chrome/locked-affordance.ts; its factory takes onUnlock, wired by interaction-session.ts. */
    setLockedAffordance(a: { readonly target: SceneDesignObjectTarget; readonly at: ScreenPoint } | null): void
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
  /** The same port as DomInputSourceDeps.rulers: the host creates the guide at a ruler-target drag-end, only while north is up. */
  readonly rulers?: RulerGuidePort
  /** Today's notifyTransientHistoryChange: the runtime's transientHistory revision (Edit › Undo during a draft). */
  readonly transientHistoryChanged: () => void
}

/** What createToolScene reads (tools/tool-host.ts re-exports the factory). Hit tests need the scale and the plant presentation
 *  for screen-sized plants and notes; the hovered note comes from store.session.hoveredTarget, as today. Nothing is cached in 0B. */
export interface ToolSceneSource {
  readonly store: SceneStateReader                              // the runtime's scene store
  readonly sceneRevision: ReadonlySignal<number>                // unread in 0B (nothing is cached); a later index would rebuild on it
  readonly selection: () => SceneDesignObjectSelection
  readonly isLayerOpenForCreation: (layer: SceneLayerKind) => boolean
  readonly pixelsPerMetre: () => number                         // frame.view.pixelsPerMetre: exact at bearing 0 (metresPerPixelAt is not)
  readonly speciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly plantContext: (pixelsPerMetre: number) => PlantPresentationContext   // incl. localised common names
  readonly selectionModel: () => CanvasDesignObjectSelectionModel               // querySurface.getDesignObjectSelection
}

export interface ToolHost {
  /** Editing gestures, hovers and drops (drops go to the host's shared drop handler, whatever tool is armed); converts to world at event time. */
  gesture(g: Gesture): GestureOutcome
  command(c: ToolCommand): ToolReply
  /** Hits, retargets and opens the canvas menu through ToolHostDeps.menu; quarantines a menu the scene does not admit. */
  menuAt(at: ScreenPoint | 'selection', source: MenuSource): GestureOutcome
  setTool(id: ToolId, source: ToolSource | null): void
  /** A new source for the armed tool (the session's read-model bridge): forwards to CanvasTool.sourceChanged. */
  sourceChanged(source: ToolSource | null): void
  readonly activeTool: ReadonlySignal<ToolId>
  /** 0B only (goes with the legacy bridge): true when tools/registry.ts lists the tool. The session routes a registered armed
   *  tool's input to the host and every other tool's to the bridge; the host's shared duties switch on it (§1.4). */
  isRegistered(id: ToolId): boolean
  /** The active tool's dragSlopPx, sent in the recogniser's configure on every tool change. */
  activeToolDragSlopPx(): number | null
  /** Asked by the session before it routes any source or key event: true while a failed cancellation was pending and has now
   *  been retried, so the event is quarantined (today's app-wide swallow). */
  retryPendingCancellation(): boolean
  /** Scene or selection changed outside a tool call (select all, undo, menu commands, nudges): refresh handles and decorations. */
  sceneChanged(): void
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
  /** Transient history (today's canUndo/…TransientHistory): sends the active tool the 'undo-transient' and 'redo-transient' commands and
   *  reads its canUndoTransient?/canRedoTransient?; revision bumps after every call into the tool and after a deferred onCommitted. */
  readonly transientHistory: {
    readonly revision: ReadonlySignal<number>
    canUndo(): boolean; canRedo(): boolean; undo(): boolean; redo(): boolean
  }
  prepareForDocumentReplacement(): void                         // deactivate('document-replaced') and drop live sessions
  refreshTranslations(): void                                   // re-publishes guidance and handle labels
  /** Every button-less move over the surface, before the overview and hover-suppression filters; null on hover-end (the pointer
   *  left the map or moved over owned chrome, text or a handle). For the inspection lens and the status line. */
  subscribePointerWorld(listener: (point: WorldPoint | null) => void): () => void
  dispose(): void
}
// Today's SceneInteractionSession members: setTool → ToolHost.setTool; plantRowSpacing (CanvasToolCommandSurface) → ToolHost.command
// with the spacing kinds; the four transient-history members → transientHistory; refreshMeasurements → ToolHost.sceneChanged();
// setOverviewMode → through 0B a mode override the session feeds to the recogniser's configure and to the host's frames;
// prepareForDocumentReplacement, refreshTranslations and dispose → the same names. interaction-session.ts keeps the old session
// interface over these, and bridges the plant and saved-stamp read models to setTool and sourceChanged.
