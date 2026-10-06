import type {
  CanvasContextMenuAnchor,
  CanvasContextMenuCommands,
  CanvasContextMenuRequest,
  CanvasRuntimeContextMenuAdapter,
} from '../app-adapter'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { ScenePoint } from '../scene'
import type { ViewTransform, WorldQuad } from '../view/types'

interface CanvasContextMenuOptions {
  readonly container: HTMLElement
  /** The live frame's view, read when the menu opens. */
  readonly view: () => ViewTransform
  readonly adapter: CanvasRuntimeContextMenuAdapter | undefined
  readonly commands: CanvasContextMenuCommands
  readonly saveSelectionAsObjectStamp?: () => void
  readonly placePlantsAt?: (world: ScenePoint) => void
  readonly returnFocus: () => void
}

/**
 * Turns a right-click or the Menu key into one menu request for the app to
 * render. The session owns this controller; the app owns the menu's DOM.
 */
export interface CanvasContextMenuController {
  /** `screen` is container-relative; `selection` is null on the empty map. `turnViewToEdge`: the pointer is on a zone's
   *  edge (the request's entry, spec §4.16). */
  openAtPointer(screen: ScenePoint, selection: CanvasDesignObjectSelectionModel | null, turnViewToEdge?: () => void): void
  /** Menu key or Shift F10: beside the selection's projected hull (`hull`, the world quad of the screen box of the shapes it
   *  draws, tools/select/selection-hull.ts; INV-XF-22), else mid-map (the empty-map menu without a selection). */
  openFromKeyboard(selection: CanvasDesignObjectSelectionModel, hull: WorldQuad | null): void
  /** True from an open until the app closes the menu (the request's `closed`) or close() closes it. */
  isOpen(): boolean
  close(): void
  dispose(): void
}

export function createCanvasContextMenu(options: CanvasContextMenuOptions): CanvasContextMenuController {
  let openRequest: CanvasContextMenuRequest | null = null

  function open(
    anchor: CanvasContextMenuAnchor,
    world: ScenePoint,
    selection: CanvasDesignObjectSelectionModel | null,
    turnViewToEdge?: () => void,
  ): void {
    const adapter = options.adapter
    if (!adapter) return
    const request: CanvasContextMenuRequest = {
      anchor,
      world,
      selection,
      commands: options.commands,
      ...(options.saveSelectionAsObjectStamp
        ? { saveSelectionAsObjectStamp: options.saveSelectionAsObjectStamp }
        : {}),
      ...(options.placePlantsAt ? { placePlantsAt: options.placePlantsAt } : {}),
      ...(turnViewToEdge ? { turnViewToEdge } : {}),
      returnFocus: options.returnFocus,
      closed: () => {
        if (openRequest === request) openRequest = null
      },
    }
    openRequest = request
    adapter.open(request)
  }

  function containerOrigin(): { left: number; top: number } {
    const rect = options.container.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  }

  return {
    openAtPointer(screen, selection, turnViewToEdge) {
      const world = options.view().screenToWorld(screen)
      const origin = containerOrigin()
      const x = origin.left + screen.x
      const y = origin.top + screen.y
      open({ left: x, top: y, right: x, bottom: y }, world, selection, turnViewToEdge)
    },
    openFromKeyboard(selection, hull) {
      const origin = containerOrigin()
      const target = hasSelectedObjects(selection) ? selection : null
      const bounds = target?.bounds ?? null
      const view = options.view()
      if (!bounds || !hull) {
        const centre = { x: view.screen.width / 2, y: view.screen.height / 2 }
        const world = view.screenToWorld(centre)
        const x = origin.left + centre.x
        const y = origin.top + centre.y
        open({ left: x, top: y, right: x, bottom: y }, world, target)
        return
      }
      // The hull's four projected corners: two would miss its box on a turned map.
      const corners = view.worldQuadToScreen(hull)
      const xs = corners.map((corner) => corner.x)
      const ys = corners.map((corner) => corner.y)
      open(
        {
          left: origin.left + Math.min(...xs),
          top: origin.top + Math.min(...ys),
          right: origin.left + Math.max(...xs),
          bottom: origin.top + Math.max(...ys),
        },
        { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
        selection,
      )
    },
    isOpen: () => openRequest !== null,
    close() {
      const request = openRequest
      openRequest = null
      if (request) options.adapter?.close(request)
    },
    dispose() {
      this.close()
    },
  }
}

function hasSelectedObjects(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.editableTargets.length + selection.lockedTargets.length > 0
}
