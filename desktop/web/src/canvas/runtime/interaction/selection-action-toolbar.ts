import { t } from '../../../i18n'
import type { CameraController, SceneBounds } from '../camera'
import type { CanvasDesignObjectSelectionModel, CanvasSceneEditCommandSurface } from '../runtime'
import { getSelectionLayer } from '../scene-runtime/selection'

type SelectionActionCommandSurface = Pick<
  CanvasSceneEditCommandSurface,
  | 'duplicateSelected'
  | 'deleteSelected'
  | 'bringToFront'
  | 'sendToBack'
  | 'selectSameSpecies'
  | 'lockSelected'
  | 'unlockSelected'
  | 'groupSelected'
  | 'ungroupSelected'
>

interface SelectionActionToolbarOptions {
  readonly container: HTMLElement
  readonly camera: CameraController
  readonly getSelection: () => CanvasDesignObjectSelectionModel
  readonly commands: SelectionActionCommandSurface
}

export interface SelectionActionToolbarController {
  refresh(): void
  contains(target: EventTarget | null): boolean
  dispose(): void
}

interface SelectionAction {
  readonly id: string
  readonly labelKey: string
  readonly shortcut: string | null
  readonly icon: readonly SvgPath[]
  readonly isAvailable: (selection: CanvasDesignObjectSelectionModel) => boolean
  readonly run: () => void
}

interface SvgPath {
  readonly d?: string
  readonly points?: string
  readonly fill?: string
}

const TOOLBAR_MARGIN_PX = 8
const TOOLBAR_GAP_PX = 14
const ROTATION_HANDLE_RESERVE_PX = 42
const TOOLBAR_WIDTH_PX = 142
const TOOLBAR_HEIGHT_PX = 34
const SVG_NS = 'http://www.w3.org/2000/svg'

export function createSelectionActionToolbar(
  options: SelectionActionToolbarOptions,
): SelectionActionToolbarController {
  const root = document.createElement('div')
  root.dataset.selectionActionToolbar = 'true'
  root.setAttribute('role', 'toolbar')
  root.style.cssText = [
    'position: absolute',
    'z-index: 26',
    'display: none',
    'align-items: center',
    'gap: var(--space-1)',
    'height: 34px',
    'padding: var(--space-1)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border-strong, var(--color-border))',
    'border-radius: var(--radius-md)',
    'box-shadow: 0 2px 6px rgba(44, 36, 24, 0.10)',
    'box-sizing: border-box',
    'font-family: Inter, sans-serif',
    'color: var(--color-text)',
    'pointer-events: auto',
  ].join(';')
  root.addEventListener('pointerdown', stopCanvasEvent)
  root.addEventListener('pointermove', stopCanvasEvent)
  root.addEventListener('pointerup', stopCanvasEvent)
  root.addEventListener('click', stopCanvasEvent)

  const actions: readonly SelectionAction[] = [
    {
      id: 'duplicate',
      labelKey: 'canvas.selectionActions.duplicate',
      shortcut: 'Cmd+D',
      icon: [
        { d: 'M8 7h9v9H8z', fill: 'none' },
        { d: 'M5 4h9v9H5z', fill: 'none' },
      ],
      isAvailable: hasEditableSelection,
      run: () => options.commands.duplicateSelected(),
    },
    {
      id: 'bring-forward',
      labelKey: 'canvas.selectionActions.bringForward',
      shortcut: ']',
      icon: [
        { d: 'M8 4h8v8H8z', fill: 'none' },
        { d: 'M4 8h8v8H4z', fill: 'none' },
        { points: '14,5 17,5 17,8' },
      ],
      isAvailable: hasEditableSelection,
      run: () => options.commands.bringToFront(),
    },
    {
      id: 'send-backward',
      labelKey: 'canvas.selectionActions.sendBackward',
      shortcut: '[',
      icon: [
        { d: 'M8 4h8v8H8z', fill: 'none' },
        { d: 'M4 8h8v8H4z', fill: 'none' },
        { points: '6,15 3,15 3,12' },
      ],
      isAvailable: hasEditableSelection,
      run: () => options.commands.sendToBack(),
    },
    {
      id: 'select-same-species',
      labelKey: 'canvas.selectionActions.selectSameSpecies',
      shortcut: null,
      icon: [
        { d: 'M6 13c0-3 2-5 5-5', fill: 'none' },
        { d: 'M11 8c0 4-2 6-5 6', fill: 'none' },
        { d: 'M11 8c-3 0-5-2-5-5', fill: 'none' },
        { d: 'M14 16c0-2 1.5-3.5 3.5-3.5', fill: 'none' },
        { d: 'M17.5 12.5c0 2.5-1.5 4-3.5 4', fill: 'none' },
      ],
      isAvailable: isSelectSameSpeciesAvailable,
      run: () => options.commands.selectSameSpecies(),
    },
    {
      id: 'group',
      labelKey: 'canvas.selectionActions.group',
      shortcut: 'Cmd+G',
      icon: [
        { d: 'M5 5h5v5H5z', fill: 'none' },
        { d: 'M10 10h5v5h-5z', fill: 'none' },
        { d: 'M4 12v4h4', fill: 'none' },
        { d: 'M16 8V4h-4', fill: 'none' },
      ],
      isAvailable: isGroupAvailable,
      run: () => options.commands.groupSelected(),
    },
    {
      id: 'ungroup',
      labelKey: 'canvas.selectionActions.ungroup',
      shortcut: 'Shift+Cmd+G',
      icon: [
        { d: 'M5 5h5v5H5z', fill: 'none' },
        { d: 'M10 10h5v5h-5z', fill: 'none' },
        { d: 'M4 16h4', fill: 'none' },
        { d: 'M4 16v-4', fill: 'none' },
        { d: 'M16 4h-4', fill: 'none' },
        { d: 'M16 4v4', fill: 'none' },
      ],
      isAvailable: isUngroupAvailable,
      run: () => options.commands.ungroupSelected(),
    },
    {
      id: 'lock',
      labelKey: 'canvas.selectionActions.lock',
      shortcut: 'Cmd+L',
      icon: [
        { d: 'M7 9V7a3 3 0 016 0v2', fill: 'none' },
        { d: 'M5 9h10v7H5z', fill: 'none' },
        { d: 'M10 12v2', fill: 'none' },
      ],
      isAvailable: isLockAvailable,
      run: () => options.commands.lockSelected(),
    },
    {
      id: 'delete',
      labelKey: 'canvas.selectionActions.delete',
      shortcut: 'Del',
      icon: [
        { d: 'M6 7h10', fill: 'none' },
        { d: 'M9 7V5h4v2', fill: 'none' },
        { d: 'M8 9l1 7h4l1-7', fill: 'none' },
      ],
      isAvailable: hasEditableSelection,
      run: () => options.commands.deleteSelected(),
    },
  ]

  const actionButtons = actions.map((action) => ({
    action,
    button: createActionButton(action, () => {
      action.run()
      refresh()
    }),
  }))
  let renderedActionIds = ''
  options.container.appendChild(root)

  function refresh(): void {
    root.setAttribute('aria-label', t('canvas.selectionActions.ariaLabel'))
    for (const { action, button } of actionButtons) refreshButtonLabel(button, action)

    const selection = options.getSelection()
    if (selection.editableTargets.length === 0 || !selection.bounds) {
      hide()
      return
    }

    const availableActionButtons = actionButtons.filter(({ action }) => action.isAvailable(selection))
    const nextActionIds = availableActionButtons.map(({ action }) => action.id).join('|')
    if (nextActionIds !== renderedActionIds) {
      root.replaceChildren(...availableActionButtons.map(({ button }) => button))
      renderedActionIds = nextActionIds
    }
    const placement = resolveToolbarPlacement(selection.bounds, options.camera, options.container)
    Object.assign(root.style, {
      display: 'flex',
      left: `${placement.left}px`,
      top: `${placement.top}px`,
    })
  }

  function hide(): void {
    root.style.display = 'none'
    if (renderedActionIds !== '') {
      root.replaceChildren()
      renderedActionIds = ''
    }
  }

  refresh()

  return {
    refresh,
    contains(target) {
      return target instanceof Node && root.contains(target)
    },
    dispose() {
      root.remove()
    },
  }
}

function createActionButton(action: SelectionAction, run: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.selectionActionCommand = action.id
  button.style.cssText = [
    'position: relative',
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
    'width: var(--control-size-md)',
    'height: var(--control-size-md)',
    'padding: 0',
    'border: 1px solid transparent',
    'border-radius: var(--radius-sm)',
    'background: transparent',
    'color: var(--color-text)',
    'cursor: pointer',
    'outline: none',
  ].join(';')
  button.appendChild(createIcon(action.icon))
  button.appendChild(createTooltip(action))
  refreshButtonLabel(button, action)
  button.addEventListener('pointerenter', () => {
    button.style.background = 'var(--color-primary-bg)'
    showTooltip(button)
  })
  button.addEventListener('pointerleave', () => {
    if (document.activeElement !== button) button.style.background = 'transparent'
    hideTooltip(button)
  })
  button.addEventListener('focus', () => {
    button.style.borderColor = 'var(--color-primary)'
    button.style.background = 'var(--color-primary-bg)'
    showTooltip(button)
  })
  button.addEventListener('blur', () => {
    button.style.borderColor = 'transparent'
    button.style.background = 'transparent'
    hideTooltip(button)
  })
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    run()
  })
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    run()
  })
  return button
}

function refreshButtonLabel(button: HTMLButtonElement, action: Pick<SelectionAction, 'labelKey' | 'shortcut'>): void {
  const label = t(action.labelKey)
  button.setAttribute('aria-label', action.shortcut ? `${label} (${action.shortcut})` : label)
  const text = button.querySelector<HTMLElement>('[data-selection-action-tooltip-label]')
  const shortcut = button.querySelector<HTMLElement>('[data-selection-action-shortcut]')
  if (text) text.textContent = label
  if (shortcut) shortcut.textContent = action.shortcut ?? ''
}

function createTooltip(action: SelectionAction): HTMLSpanElement {
  const tooltip = document.createElement('span')
  tooltip.dataset.selectionActionTooltip = 'true'
  tooltip.setAttribute('aria-hidden', 'true')
  tooltip.style.cssText = [
    'position: absolute',
    'left: 50%',
    'top: calc(100% + var(--space-1))',
    'display: none',
    'gap: var(--space-2)',
    'align-items: center',
    'padding: var(--space-1) var(--space-2)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border-strong, var(--color-border))',
    'border-radius: var(--radius-sm)',
    'font-size: var(--text-xs)',
    'font-weight: 600',
    'line-height: 1.2',
    'color: var(--color-text)',
    'white-space: nowrap',
    'transform: translateX(-50%)',
    'pointer-events: none',
  ].join(';')
  const label = document.createElement('span')
  label.dataset.selectionActionTooltipLabel = 'true'
  label.textContent = t(action.labelKey)
  tooltip.appendChild(label)
  if (action.shortcut) {
    const shortcut = document.createElement('span')
    shortcut.dataset.selectionActionShortcut = 'true'
    shortcut.textContent = action.shortcut
    shortcut.style.cssText = [
      'font-size: var(--text-xs)',
      'font-weight: 400',
      'color: var(--color-text-muted)',
      'font-variant-numeric: tabular-nums',
    ].join(';')
    tooltip.appendChild(shortcut)
  }
  return tooltip
}

function showTooltip(button: HTMLButtonElement): void {
  const tooltip = button.querySelector<HTMLElement>('[data-selection-action-tooltip]')
  if (tooltip) tooltip.style.display = 'inline-flex'
}

function hideTooltip(button: HTMLButtonElement): void {
  const tooltip = button.querySelector<HTMLElement>('[data-selection-action-tooltip]')
  if (tooltip) tooltip.style.display = 'none'
}

function createIcon(paths: readonly SvgPath[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const pathSpec of paths) {
    const element = document.createElementNS(SVG_NS, pathSpec.points ? 'polyline' : 'path')
    if (pathSpec.d) element.setAttribute('d', pathSpec.d)
    if (pathSpec.points) element.setAttribute('points', pathSpec.points)
    element.setAttribute('fill', pathSpec.fill ?? 'none')
    element.setAttribute('stroke', 'currentColor')
    element.setAttribute('stroke-width', '1.7')
    element.setAttribute('stroke-linecap', 'round')
    element.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(element)
  }
  return svg
}

function resolveToolbarPlacement(
  bounds: SceneBounds,
  camera: CameraController,
  container: HTMLElement,
): { left: number; top: number } {
  const topLeft = camera.worldToScreen({ x: bounds.minX, y: bounds.minY })
  const bottomRight = camera.worldToScreen({ x: bounds.maxX, y: bounds.maxY })
  const rect = normalizeRect(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y)
  const size = {
    width: rootFallbackNumber(container.clientWidth, container.getBoundingClientRect().width),
    height: rootFallbackNumber(container.clientHeight, container.getBoundingClientRect().height),
  }
  const maxLeft = Math.max(TOOLBAR_MARGIN_PX, size.width - TOOLBAR_WIDTH_PX - TOOLBAR_MARGIN_PX)
  const left = clamp(rect.left + rect.width / 2 - TOOLBAR_WIDTH_PX / 2, TOOLBAR_MARGIN_PX, maxLeft)
  const aboveTop = rect.top - TOOLBAR_HEIGHT_PX - ROTATION_HANDLE_RESERVE_PX
  if (aboveTop >= TOOLBAR_MARGIN_PX) {
    return { left, top: aboveTop }
  }
  const maxTop = Math.max(TOOLBAR_MARGIN_PX, size.height - TOOLBAR_HEIGHT_PX - TOOLBAR_MARGIN_PX)
  return {
    left,
    top: clamp(rect.bottom + TOOLBAR_GAP_PX, TOOLBAR_MARGIN_PX, maxTop),
  }
}

function normalizeRect(left: number, top: number, right: number, bottom: number): {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
} {
  const x1 = Math.min(left, right)
  const y1 = Math.min(top, bottom)
  const x2 = Math.max(left, right)
  const y2 = Math.max(top, bottom)
  return {
    left: x1,
    top: y1,
    right: x2,
    bottom: y2,
    width: x2 - x1,
    height: y2 - y1,
  }
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

function hasEditableSelection(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.editableTargets.length > 0
}

function isGroupAvailable(selection: CanvasDesignObjectSelectionModel): boolean {
  if (selection.blockedTargets.length > 0 || selection.editableTargets.length < 2) return false
  if (selection.editableTargets.some((target) => target.kind === 'group')) return false
  const layer = getSelectionLayer(selection.editableTargets[0]!)
  return selection.editableTargets.every((target) => getSelectionLayer(target) === layer)
}

function isUngroupAvailable(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.blockedTargets.length === 0
    && selection.editableTargets.some((target) => target.kind === 'group')
}

function isLockAvailable(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.blockedTargets.length === 0 && selection.editableTargets.length > 0
}

function isSelectSameSpeciesAvailable(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.blockedTargets.length === 0
    && selection.sameSpeciesReferenceCanonicalName !== null
}
