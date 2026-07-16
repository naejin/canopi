import type { CanvasRuntimeTranslator } from '../app-adapter'
import type { CanvasDesignObjectSelectionModel, CanvasSceneEditCommandSurface } from '../runtime'
import type { ScenePoint } from '../scene'
import { canSaveSelectionAsObjectStamp } from './contextual-selection-actions'

type CanvasContextMenuCommandSurface = Pick<
  CanvasSceneEditCommandSurface,
  'copy' | 'pasteAt' | 'canPaste' | 'deleteSelected'
>

interface CanvasContextMenuOptions {
  readonly container: HTMLElement
  readonly commands: CanvasContextMenuCommandSurface
  readonly getSelection: () => CanvasDesignObjectSelectionModel
  readonly translate: CanvasRuntimeTranslator
  readonly saveSelectionAsObjectStamp?: () => void
}

export interface CanvasContextMenuShowOptions {
  readonly screen: ScenePoint
  readonly world: ScenePoint
  readonly selection?: CanvasDesignObjectSelectionModel
}

export interface CanvasContextMenuController {
  show(options: CanvasContextMenuShowOptions): void
  refreshTranslations(): void
  hide(): void
  contains(target: EventTarget | null): boolean
  dispose(): void
}

interface CanvasContextMenuAction {
  readonly id: 'copy' | 'paste' | 'save-object-stamp' | 'delete'
  readonly labelKey: string
  readonly isEnabled: (selection: CanvasDesignObjectSelectionModel) => boolean
  readonly run: (world: ScenePoint) => void
}

const MENU_MARGIN_PX = 8
const MENU_WIDTH_PX = 148
const MENU_ITEM_HEIGHT_PX = 28
const MENU_PADDING_BLOCK_PX = 8
const MENU_Z_INDEX = 36

export function createCanvasContextMenu(options: CanvasContextMenuOptions): CanvasContextMenuController {
  const root = document.createElement('div')
  root.dataset.canvasContextMenu = 'true'
  root.setAttribute('role', 'menu')
  root.style.cssText = [
    'position: absolute',
    `z-index: ${MENU_Z_INDEX}`,
    'display: none',
    `width: ${MENU_WIDTH_PX}px`,
    'padding: var(--space-1)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border-strong)',
    'border-radius: var(--radius-md)',
    'box-shadow: var(--shadow-md)',
    'box-sizing: border-box',
    'font-family: var(--font-sans)',
    'pointer-events: auto',
  ].join(';')
  root.style.zIndex = String(MENU_Z_INDEX)
  root.addEventListener('pointerdown', stopCanvasEvent)
  root.addEventListener('pointermove', stopCanvasEvent)
  root.addEventListener('pointerup', stopCanvasEvent)
  root.addEventListener('click', stopCanvasEvent)
  root.addEventListener('contextmenu', stopCanvasEvent)

  let activeWorld: ScenePoint | null = null
  const actions: readonly CanvasContextMenuAction[] = [
    {
      id: 'copy',
      labelKey: 'canvas.contextMenu.copy',
      isEnabled: hasEditableOnlySelection,
      run: () => options.commands.copy(),
    },
    {
      id: 'paste',
      labelKey: 'canvas.contextMenu.paste',
      isEnabled: () => options.commands.canPaste(),
      run: (world) => options.commands.pasteAt(world),
    },
    ...options.saveSelectionAsObjectStamp
      ? [{
          id: 'save-object-stamp' as const,
          labelKey: 'canvas.contextMenu.saveObjectStamp',
          isEnabled: canSaveSelectionAsObjectStamp,
          run: () => options.saveSelectionAsObjectStamp?.(),
        }]
      : [],
    {
      id: 'delete',
      labelKey: 'canvas.contextMenu.delete',
      isEnabled: hasEditableOnlySelection,
      run: () => options.commands.deleteSelected(),
    },
  ]
  const buttons = actions.map((action) => createMenuButton(action, () => {
    const world = activeWorld
    if (!world) return
    action.run(world)
    hide()
  }))
  root.replaceChildren(...buttons)
  options.container.appendChild(root)

  function show({ screen, world, selection: selectionOverride }: CanvasContextMenuShowOptions): void {
    activeWorld = world
    const selection = selectionOverride ?? options.getSelection()
    refreshTranslations()
    refreshStates(selection)
    root.style.display = 'block'
    const placement = resolveMenuPlacement(screen, options.container, root, actions.length)
    root.style.left = `${placement.left}px`
    root.style.top = `${placement.top}px`
  }

  function refreshTranslations(): void {
    root.setAttribute('aria-label', options.translate('canvas.contextMenu.ariaLabel'))
    for (const [index, action] of actions.entries()) {
      const button = buttons[index]!
      button.textContent = options.translate(action.labelKey)
    }
  }

  function refreshStates(selection: CanvasDesignObjectSelectionModel): void {
    for (const [index, action] of actions.entries()) {
      const button = buttons[index]!
      setButtonEnabled(button, action.isEnabled(selection))
    }
  }

  function hide(): void {
    root.style.display = 'none'
    activeWorld = null
    if (root.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur()
    }
  }

  return {
    show,
    refreshTranslations,
    hide,
    contains(target) {
      return target instanceof Node && root.contains(target)
    },
    dispose() {
      hide()
      root.remove()
    },
  }
}

function createMenuButton(action: CanvasContextMenuAction, run: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.canvasContextCommand = action.id
  button.setAttribute('role', 'menuitem')
  button.style.cssText = [
    'display: flex',
    'align-items: center',
    'width: 100%',
    'min-height: var(--control-size-md)',
    'padding: 0 var(--space-2)',
    'border: 1px solid transparent',
    'border-radius: var(--radius-sm)',
    'background: transparent',
    'color: var(--color-text)',
    'font: inherit',
    'font-size: var(--text-sm)',
    'font-weight: 600',
    'text-align: left',
    'cursor: pointer',
    'transition: background-color var(--transition-fast), color var(--transition-fast)',
  ].join(';')
  button.addEventListener('pointerenter', () => {
    if (!button.disabled) button.style.background = 'var(--color-control-hover)'
  })
  button.addEventListener('pointerleave', () => {
    button.style.background = 'transparent'
  })
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    if (button.disabled) return
    run()
  })
  return button
}

function setButtonEnabled(button: HTMLButtonElement, enabled: boolean): void {
  button.disabled = !enabled
  button.tabIndex = enabled ? 0 : -1
  button.setAttribute('aria-disabled', enabled ? 'false' : 'true')
  button.style.color = enabled ? 'var(--color-text)' : 'var(--color-text-muted)'
  button.style.cursor = enabled ? 'pointer' : 'not-allowed'
}

function resolveMenuPlacement(
  screen: ScenePoint,
  container: HTMLElement,
  root: HTMLElement,
  actionCount: number,
): { left: number; top: number } {
  const rect = container.getBoundingClientRect()
  const containerWidth = rootFallbackNumber(container.clientWidth, rect.width)
  const containerHeight = rootFallbackNumber(container.clientHeight, rect.height)
  const width = rootFallbackNumber(root.offsetWidth, MENU_WIDTH_PX)
  const height = rootFallbackNumber(root.offsetHeight, actionsHeight(actionCount))
  return {
    left: clamp(screen.x, MENU_MARGIN_PX, Math.max(MENU_MARGIN_PX, containerWidth - width - MENU_MARGIN_PX)),
    top: clamp(screen.y, MENU_MARGIN_PX, Math.max(MENU_MARGIN_PX, containerHeight - height - MENU_MARGIN_PX)),
  }
}

function actionsHeight(actionCount: number): number {
  return MENU_ITEM_HEIGHT_PX * actionCount + MENU_PADDING_BLOCK_PX
}

function hasEditableOnlySelection(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.editableTargets.length > 0
    && lockedTargets(selection).length === 0
    && selection.blockedTargets.length === 0
}

function lockedTargets(selection: CanvasDesignObjectSelectionModel): readonly { kind: string; id: string }[] {
  return selection.lockedTargets ?? []
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function rootFallbackNumber(...values: readonly number[]): number {
  return values.find((value) => Number.isFinite(value) && value > 0) ?? 1
}

function stopCanvasEvent(event: Event): void {
  event.stopPropagation()
}
