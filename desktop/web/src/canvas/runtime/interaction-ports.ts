// canvas/runtime/interaction-ports.ts  (types; implementations in input/ and tools/)

import type { ReadonlySignal } from '@preact/signals'
import type { SessionPlane } from '../session-plane'
import type { CanvasToolGuidance } from '../session-state'
import type { CanvasFocusPort } from './app-adapter'
import type { Bindings } from './input/bindings'
import type { Gesture, MenuSource } from './input/gestures'
import type { InputPlatform } from './input/platform'
import type { AdapterEffect, RawInput, TargetClass } from './input/raw-input'
import type { ToolHandleId, ToolId } from './interaction-types'
import type { PlantPresentationContext } from './plant-presentation'
import type { SpeciesCacheEntry } from './presentation-data'
import type { SceneRenderer } from './renderers/scene-types'
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

export interface DomInputSourceDeps {
  readonly host: HTMLElement                                    // the map host; listeners attach here and on window (0B: from attach, as today; from F only during an owned session)
  readonly platform: InputPlatform
  readonly bindings: () => Bindings                             // CURRENT_BINDINGS in production
  readonly keys: { readonly physicalCtrl: () => boolean; readonly lastKeyboardMenuAt: () => number | null }   // the keyboard port's, which the key router feeds
  readonly clock: () => number
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void }
}
export interface DomInputSource {
  /** Installs the listeners; returns the disposer that removes every listener it added (tested: exactly once each) and
   *  releases every pointer capture the source still holds (a press live at disposal), after the sink is gone. A sink
   *  that throws on a press on the map, a release, a contextmenu, a dragover or a drop quarantines that event, then rethrows;
   *  on any other event it rethrows and the event goes on (today's handlers quarantined only around their admitted work). */
  attach(sink: (input: RawInput) => void): () => void
  /** Applies effects to the event being handled: the recogniser's, and a GestureOutcome's as 'prevent-default',
   *  'stop-propagation' and 'drop-effect'. */
  apply(effects: readonly AdapterEffect[]): void
}

/**
 * An adapter over today's controller (`createCanvasContextMenu`, interaction/canvas-context-menu.ts), which builds the
 * app's CanvasContextMenuRequest (canvas/runtime/app-adapter.ts: anchor, world, retargeted selection, commands,
 * placePlantsAt, saveSelectionAsObjectStamp, returnFocus) and hands it to CanvasRuntimeAppAdapter.contextMenu.
 * The host fills the optional entries from its hit and tool state, and the controller carries them onto the request
 * (CanvasContextMenuRequest.turnViewToEdge). finishShape joins in phase 2 with its first caller; there is no highlightEdge (U4).
 */
export interface ContextMenuPort {
  open(request: {
    readonly at: WorldPoint | 'selection'
    readonly source: MenuSource
    readonly screen: ScreenPoint | null
    readonly hit: HitTarget | null
    readonly turnViewToEdge?: () => void                        // a zone-edge hit within the source's tolerance (§4.16)
  }): void
  close(): void
  readonly isOpen: () => boolean
}
export interface InputRouterDeps {
  readonly navigation: Pick<ViewNavigation, 'panByPx' | 'zoomAroundPx' | 'beginRotation'>
  readonly toolHost: ToolHost
}
export interface InputRouter {
  /** Routes one gesture: navigation → ViewNavigation, menu-request → ToolHost.menuAt (the host is the only menu opener), editing and drops → ToolHost.
   *  A pan from a pointer source (middle, Space, the Pan tool's and overview drags; not a wheel) also hands its `at` to
   *  ToolHost.notePointer, so the host's resting pointer moves with the pointer. Computes no geometry. */
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
  readonly renderer: Pick<SceneRenderer, 'setDraft'>
  /** Redraw request after a tool call that mutated an open transaction or changed its draft or handles. */
  readonly invalidate: () => void
  readonly chrome: {
    setHandles(h: readonly ToolHandle[], active: ToolHandleId | null): void; setCursor(c: string): void
    requestTextEntry(r: TextEntryRequest, submit: (text: string) => 'close' | 'keep', onCancel?: () => void): void; closeTextEntry(): void
    /** Submits an open entry that no longer holds focus (its blur commit was refused), which the map taking focus cannot
     *  blur again; an entry that holds focus is left to that blur. A press or a menu calls it before focusing the map. */
    submitUnfocusedTextEntry(): void
    /** Today's hasActiveEditor(), read live wherever the host needs the entry's state (handles hidden while it is open, the
     *  'text-entry-closed' focus reason on the next press); the host keeps no flag of its own. Esc in the entry stays the
     *  entry's own element handler. */
    isTextEntryOpen(): boolean
    setTooltip(t: { readonly target: SceneDesignObjectTarget; readonly at: ScreenPoint } | null): void   // chrome/hover-tooltip.ts
  }
  readonly menu: ContextMenuPort                                // opened only by the host (menuAt)
  readonly focus: CanvasFocusPort                               // ToolEffects.requestFocus
  readonly guidance: (g: Partial<CanvasToolGuidance> | null) => void
  readonly toolState: { readonly active: ReadonlySignal<ToolId>; set(id: ToolId): void }   // the session's tool signal
  readonly settings: ToolSettingsPort
  /** Snap to grid, read at each point (interaction-session.ts wires the runtime settings adapter's readSnapToGridEnabled);
   *  the shape tools/snapping.ts takes. */
  readonly snapping: () => { readonly grid: boolean }
  readonly translate: ToolContext['translate']
  /** "Turn view to this edge" (§4.16): the menu entry's action on a zone-edge hit. */
  readonly navigation: Pick<ViewNavigation, 'turnToEdge'>
  /** Today's deps.nudge (the runtime's scene-edit commands); the host owns the series (nudge below). */
  readonly nudge: Pick<CanvasSceneEditCommandSurface, 'nudgeSelected' | 'endNudge'>
  readonly timers: { set(atMs: number, cb: () => void): number; clear(id: number): void; readonly clock: () => number }
  /** Hover restyle (a directly locked object shows the locked hover stroke): today's deps.setHoveredTarget. */
  readonly hover: (target: SceneDesignObjectTarget | null) => void
  /** The raster inspection probe (CanvasRuntimeAppAdapter.tryInspectAt, passed by scene-runtime.ts); true claims the press. */
  readonly inspect?: (world: WorldPoint) => boolean
  /**
   * Takes an admitted press's pointer capture (the recogniser's, which the session holds back until the host admits the
   * press), before handles, the probe and the tool, as today's _pointerDownWhenSettled did; a refused press takes none.
   * False when the capture was lost while it was taken (a synchronous lostpointercapture ended the press): the host stops
   * the press before the tool hears it.
   */
  readonly capturePress: (pointerId: number) => boolean
  /** Today's notifyTransientHistoryChange: the runtime's transientHistory revision (Edit › Undo during a draft). */
  readonly transientHistoryChanged: () => void
  /**
   * A drop the host placed, once its Scene Edit committed, Select is armed and the map has focus: the session clears the
   * saved stamp's drag source after a saved-stamp drop (today's clearSavedObjectStampDragSource; the panel's dragend
   * clears it too) and focuses the map again on the next animation frame, after the browser's drag end, as today's drop
   * did.
   */
  readonly dropped: (kind: 'species' | 'saved-stamp') => void
}

/** What createToolScene reads (tools/tool-host.ts re-exports the factory). Hit tests need the scale and the plant presentation
 *  for screen-sized plants and notes; the hovered note comes from store.session.hoveredTarget, as today. Nothing is cached in 0B. */
export interface ToolSceneSource {
  readonly store: SceneStateReader                              // the runtime's scene store
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
  /** The active tool's dragSlopPx, sent in the recogniser's configure on every tool change. */
  activeToolDragSlopPx(): number | null
  /**
   * Presses the host never sees as gestures: the session calls it for every raw pointerdown on the map host before routing it
   * (from the source's raw input, not a gesture; the down's role, 'auxiliary' as 'middle'). Commits the nudge series for any
   * button. For an admitted primary or middle press outside the text entry ('owned-text'), with no live press from
   * another pointer id, it also closes the canvas menu and focuses the map (so an open text
   * entry commits on its blur): today's _onPointerDown conditions.
   */
  rawPress(button: 'primary' | 'secondary' | 'middle', target: TargetClass, pointerId?: number): void
  /**
   * Where the pointer is during a pointer-source pan (the router, from the pan's `at`): updates the host's stored resting
   * pointer and emits nothing; the next camera frame re-emits at the updated point, so a ghost stays under the pointer (today
   * it keeps its world point). Wheel and key pans leave the resting pointer where it is. null: no pointer rests on the map.
   */
  notePointer(screen: ScreenPoint | null): void
  /** Scene or selection changed outside a tool call (select all, undo, menu commands, nudges): refresh handles and decorations. */
  sceneChanged(): void
  /** The open text entry's mode, from the request that opened it ('create': a new note's field, 'edit': the in-place
   *  editor), or null with none open. The keyboard port's Space reads it: a new note's field, focused or not, arms no pan,
   *  as today's Text adapter kept its shared keys while the field was open. */
  openTextEntryMode(): 'create' | 'edit' | null
  // Esc chain queries (CanvasKeyboardPort reads these)
  hasLiveGesture(): boolean
  activeToolHasTransient(): boolean
  activeToolIsSelect(): boolean
  escapeHint(): 'drop-transient' | 'leave-tool' | 'clear-selection' | null
  /**
   * Arrow nudge, the one owner of the series: with a selection, the Select tool and site mode, turns the screen direction
   * into a world delta along screenAxesInWorld() (0.1 m, or 1 m when large), calls deps.nudge.nudgeSelected and (re)starts
   * the 800 ms idle timer that commits the series ('handled'). 'refused': the runtime refused the nudge, and the key is
   * swallowed (today). 'pass': Select is not armed, the map is in overview or nothing is selected; the key goes on to the
   * keyboard port's arrow rule (§3.6: with nothing selected it pans; otherwise the key is not consumed).
   */
  nudge(direction: ScreenPoint, large: boolean): 'handled' | 'refused' | 'pass'
  hasNudgeSeries(): boolean                                     // the Esc layer 65
  endNudgeSeries(commit: boolean): void                         // Esc aborts; idle, focusout, a press or another key commit
  /**
   * A pointer release that ended no press of the tool's, which the session reports after routing it: the end or cancel
   * (pointercancel, lost capture, Esc) of a pointer pan (middle, Space, overview or the Pan tool's), or an up with no
   * press of the map's (a right-click release, a release off the map, after a press the scene or the probe refused); not
   * one while another pointer's press is live, in overview, or over the note editor or a handle (today's _onPointerUp
   * exceptions). The host's own tap and drag-end of a press the tool never heard do the same. Today's window pointerup ran _cancelTransientInteraction for each: the series commits, the drop preview
   * and the passive hover clear, the active tool's cancelTransient('navigate') runs (a tool that keeps its draft through a
   * pan keeps it here too) and the cursor returns to the tool's. A press of the tool's still live is left to its own
   * release.
   */
  released(): void
  /**
   * Today's _cancelInterruptedInteraction, which the session calls on window blur after feeding the recogniser (which releases
   * Space and ends the live sessions): commits the nudge series, clears the passive hover and the tooltip, calls the active
   * tool's cancelTransient('navigate') (a tool that keeps its draft through a pan keeps it
   * here too) and resets the cursor to the tool's. A failure aborts whatever Scene Edit was still open.
   */
  interrupted(): void
  /** Transient history (today's canUndo/…TransientHistory): sends the active tool the 'undo-transient' and 'redo-transient' commands and
   *  reads its canUndoTransient?/canRedoTransient?; revision bumps after every call into the tool and after a deferred onCommitted. */
  readonly transientHistory: {
    readonly revision: ReadonlySignal<number>
    canUndo(): boolean; canRedo(): boolean; undo(): boolean; redo(): boolean
  }
  prepareForDocumentReplacement(): void                         // deactivate('document-replaced') and drop live sessions
  refreshTranslations(): void                                   // re-publishes guidance and handle labels
  /** Every hover whose target is the map (`surface`), before the overview and hover-suppression filters; null on hover-end:
   *  the pointer left the map, or moved over owned chrome, the text entry or a handle (U6), so the lens drops its point
   *  there. A hover off the map publishes nothing (spec §1.4 "Hover", §2.2 "Hover"). A hover made with a button held is
   *  published too: the interaction session's subscribePointerWorld drops it (its raw buttonMask, as today's lens skipped a
   *  move with any button held). For the inspection lens, the status line and, later, hover readouts over analysis results: the screen point lets a readout query the map there without projecting (R1, P2). */
  subscribePointerWorld(listener: (point: PointerWorld | null) => void): () => void
  dispose(): void
}

/** The pointer over the map: its Scene point and its map-host screen point. */
export interface PointerWorld { readonly world: WorldPoint; readonly screen: ScreenPoint }
