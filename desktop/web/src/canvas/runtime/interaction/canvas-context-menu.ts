import type {
  CanvasContextMenuAnchor,
  CanvasContextMenuCommands,
  CanvasContextMenuRequest,
  CanvasRuntimeContextMenuAdapter,
} from '../app-adapter'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { ScenePoint } from '../scene'
import type { ViewTransform } from '../view/types'

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
  /** `screen` is container-relative; `selection` is null on the empty map. */
  openAtPointer(screen: ScenePoint, selection: CanvasDesignObjectSelectionModel | null): void
  /** Menu key or Shift F10: beside the selection's bounds, else mid-map (the empty-map menu without a selection). */
  openFromKeyboard(selection: CanvasDesignObjectSelectionModel): void
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
    openAtPointer(screen, selection) {
      const world = options.view().screenToWorld(screen)
      if (!world) return
      const origin = containerOrigin()
      const x = origin.left + screen.x
      const y = origin.top + screen.y
      open({ left: x, top: y, right: x, bottom: y }, world, selection)
    },
    openFromKeyboard(selection) {
      const origin = containerOrigin()
      const target = hasSelectedObjects(selection) ? selection : null
      const bounds = target?.bounds ?? null
      const view = options.view()
      if (!bounds) {
        const centre = { x: view.screen.width / 2, y: view.screen.height / 2 }
        const world = view.screenToWorld(centre)
        if (!world) return
        const x = origin.left + centre.x
        const y = origin.top + centre.y
        open({ left: x, top: y, right: x, bottom: y }, world, target)
        return
      }
      const a = view.worldToScreen({ x: bounds.minX, y: bounds.minY })
      const b = view.worldToScreen({ x: bounds.maxX, y: bounds.maxY })
      open(
        {
          left: origin.left + Math.min(a.x, b.x),
          top: origin.top + Math.min(a.y, b.y),
          right: origin.left + Math.max(a.x, b.x),
          bottom: origin.top + Math.max(a.y, b.y),
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
  return selection.editableTargets.length + (selection.lockedTargets?.length ?? 0) > 0
}
