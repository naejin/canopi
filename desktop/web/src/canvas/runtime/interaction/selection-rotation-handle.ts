import type { CanvasRuntimeTranslator } from '../app-adapter'
import type { WorkspaceCameraFrameReader, SceneBounds } from '../camera'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { ScenePoint, SceneStateReader } from '../scene'
import {
  applyRotationTransformToDraft,
  captureRotationTransformState,
  centerOfBounds,
  isRotatableSelection,
  type RotationTransformState,
} from '../scene-runtime/selection-rotation'
import type { SceneEditCoordinator, SceneEditTransaction } from '../scene-runtime/transactions'
import { runCanvasRuntimeCleanups } from '../cleanup'
import type { SceneToolPointerDrag, SceneToolPointerEvent } from './tool-adapter'

interface SelectionRotationHandleOptions {
  readonly container: HTMLElement
  readonly camera: WorkspaceCameraFrameReader
  readonly getSceneStore: () => SceneStateReader
  readonly getSelection: () => CanvasDesignObjectSelectionModel
  readonly sceneEdits: SceneEditCoordinator
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly translate: CanvasRuntimeTranslator
  readonly refreshSelectionDependent: () => void
}

export interface SelectionRotationHandleController {
  readonly dragActive: boolean
  refresh(): void
  refreshTranslations(): void
  hide(): void
  pointerDown(context: SelectionRotationHandlePointerDownContext): SceneToolPointerDrag | null
  cancelActiveDrag(): boolean
  contains(target: EventTarget | null): boolean
  dispose(): void
}

interface SelectionRotationHandlePointerDownContext {
  readonly event: PointerEvent
  readonly rawWorld: ScenePoint
}

interface ActiveRotationDrag {
  readonly tx: SceneEditTransaction
  readonly state: RotationTransformState
  readonly pivot: ScenePoint
  readonly startPointerAngleDeg: number
  lastDeltaDeg: number
}

const HANDLE_SIZE_PX = 28
const HANDLE_MARGIN_PX = 8
const HANDLE_GAP_PX = 14
const NO_OP_ROTATION_DELTA_DEG = 0.25
const SNAP_DEGREES = 15
const SVG_NS = 'http://www.w3.org/2000/svg'

export function createSelectionRotationHandle(
  options: SelectionRotationHandleOptions,
): SelectionRotationHandleController {
  const root = document.createElement('div')
  root.dataset.rotationHandle = 'true'
  root.setAttribute('role', 'button')
  root.tabIndex = -1
  root.style.cssText = [
    'position: absolute',
    'z-index: 27',
    'display: none',
    'align-items: center',
    'justify-content: center',
    `width: ${HANDLE_SIZE_PX}px`,
    `height: ${HANDLE_SIZE_PX}px`,
    'padding: 0',
    'background: var(--color-primary)',
    'border-width: 1px',
    'border-style: solid',
    'border-color: var(--color-primary-hover)',
    'border-radius: var(--radius-full)',
    'box-shadow: var(--shadow-md)',
    'box-sizing: border-box',
    'color: var(--color-primary-contrast)',
    'cursor: grab',
    'outline-width: 2px',
    'outline-style: solid',
    'outline-color: var(--color-surface)',
    'outline-offset: 1px',
    'pointer-events: auto',
    'touch-action: none',
    'user-select: none',
  ].join(';')
  root.appendChild(createRotateIcon())
  const readout = document.createElement('span')
  readout.dataset.rotationHandleReadout = 'true'
  readout.setAttribute('aria-hidden', 'true')
  readout.style.cssText = [
    'position: absolute',
    'left: 50%',
    'top: calc(100% + var(--space-1))',
    'display: none',
    'min-width: 42px',
    'justify-content: center',
    'padding: var(--space-1) var(--space-2)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border-strong, var(--color-border))',
    'border-radius: var(--radius-sm)',
    'box-shadow: var(--shadow-sm)',
    'box-sizing: border-box',
    'color: var(--color-text)',
    'font-family: var(--font-mono)',
    'font-size: var(--text-xs)',
    'font-weight: 600',
    'line-height: 1.2',
    'transform: translateX(-50%)',
    'white-space: nowrap',
    'pointer-events: none',
  ].join(';')
  root.appendChild(readout)
  root.addEventListener('click', stopCanvasEvent)
  root.addEventListener('keydown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  let activeDrag: ActiveRotationDrag | null = null

  function refreshTranslations(): void {
    root.setAttribute('aria-label', options.translate('canvas.rotationHandle.label'))
  }

  function refresh(): void {
    refreshTranslations()
    const selection = options.getSelection()
    if (!isRotatableSelection(selection)) {
      hide()
      return
    }

    const placement = resolveHandlePlacement(selection.bounds, options.camera, options.container)
    Object.assign(root.style, {
      display: 'inline-flex',
      left: `${placement.left}px`,
      top: `${placement.top}px`,
    })
  }

  function hide(): void {
    root.style.display = 'none'
  }

  function pointerDown({ event, rawWorld }: SelectionRotationHandlePointerDownContext): SceneToolPointerDrag | null {
    if (event.button !== 0) return null
    const selection = options.getSelection()
    const transformState = captureRotationTransformState(options.getSceneStore().persisted, selection)
    if (!transformState || !selection.bounds) {
      hide()
      return null
    }

    event.preventDefault()
    event.stopPropagation()
    const pivot = centerOfBounds(selection.bounds)
    activeDrag = {
      tx: options.sceneEdits.begin('interaction-rotate'),
      state: transformState,
      pivot,
      startPointerAngleDeg: angleDeg(pivot, rawWorld),
      lastDeltaDeg: 0,
    }
    root.style.cursor = 'grabbing'
    root.dataset.rotationHandleActive = 'true'
    showReadout(0)

    return {
      update: updateRotation,
      commit: commitRotation,
    }
  }

  function updateRotation(context: SceneToolPointerEvent): void {
    applyActiveRotation(context)
  }

  function commitRotation(context: SceneToolPointerEvent): void {
    const drag = activeDrag
    if (!drag) return
    const deltaDeg = applyActiveRotation(context)
    let transactionFinished = false
    try {
      if (Math.abs(deltaDeg) > NO_OP_ROTATION_DELTA_DEG && drag.tx.changed) {
        drag.tx.commit({ invalidate: 'scene' })
        transactionFinished = true
      } else {
        drag.tx.abort()
        transactionFinished = true
        options.render('scene')
      }
    } finally {
      if (transactionFinished) {
        activeDrag = null
        root.style.cursor = 'grab'
        delete root.dataset.rotationHandleActive
        hideReadout()
        options.refreshSelectionDependent()
      }
    }
  }

  function cancelActiveDrag(): boolean {
    const drag = activeDrag
    if (!drag) return false
    let transactionFinished = false
    try {
      drag.tx.abort()
      transactionFinished = true
    } finally {
      if (transactionFinished) activeDrag = null
      root.style.cursor = 'grab'
      delete root.dataset.rotationHandleActive
      hideReadout()
      try {
        options.render('scene')
      } finally {
        options.refreshSelectionDependent()
      }
    }
    return true
  }

  function applyActiveRotation(context: SceneToolPointerEvent): number {
    if (!activeDrag) return 0
    const deltaDeg = resolveDeltaDeg(activeDrag, context)
    if (Math.abs(deltaDeg - activeDrag.lastDeltaDeg) < 0.0001) return deltaDeg
    activeDrag.lastDeltaDeg = deltaDeg
    const state = activeDrag.state
    const pivot = activeDrag.pivot
    activeDrag.tx.mutate((draft) => {
      applyRotationTransformToDraft(draft, state, pivot, deltaDeg)
    })
    showReadout(deltaDeg)
    options.render('scene')
    options.refreshSelectionDependent()
    return deltaDeg
  }

  function showReadout(deltaDeg: number): void {
    const rounded = Math.round(deltaDeg)
    readout.textContent = `${rounded > 0 ? '+' : ''}${rounded}°`
    readout.style.display = 'inline-flex'
  }

  function hideReadout(): void {
    readout.style.display = 'none'
  }

  try {
    options.container.appendChild(root)
    refresh()
  } catch (error) {
    root.remove()
    throw error
  }

  return {
    get dragActive() {
      return activeDrag !== null
    },
    refresh,
    refreshTranslations,
    hide,
    pointerDown,
    cancelActiveDrag,
    contains(target) {
      return target instanceof Node && root.contains(target)
    },
    dispose() {
      runCanvasRuntimeCleanups([
        () => cancelActiveDrag(),
        () => root.remove(),
      ], 'Selection Rotation Handle disposal failed')
    },
  }
}

function resolveDeltaDeg(active: ActiveRotationDrag, context: SceneToolPointerEvent): number {
  const currentAngleDeg = angleDeg(active.pivot, context.rawWorld)
  const rawDeltaDeg = signedAngleDeltaDeg(active.startPointerAngleDeg, currentAngleDeg)
  if (!context.event.shiftKey) return rawDeltaDeg
  return Math.round(rawDeltaDeg / SNAP_DEGREES) * SNAP_DEGREES
}

function angleDeg(center: ScenePoint, point: ScenePoint): number {
  return radiansToDegrees(Math.atan2(point.y - center.y, point.x - center.x))
}

function signedAngleDeltaDeg(startDeg: number, currentDeg: number): number {
  let delta = (currentDeg - startDeg) % 360
  if (delta > 180) delta -= 360
  if (delta <= -180) delta += 360
  return delta
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

/**
 * Centred above the selection, kept inside the visible map area: the camera's
 * frame insets are the floating chrome (title bar, tool rail, open dock), so
 * the handle never slides under the tool rail near the map's left edge.
 */
function resolveHandlePlacement(
  bounds: SceneBounds,
  camera: WorkspaceCameraFrameReader,
  container: HTMLElement,
): { left: number; top: number } {
  const topLeft = camera.worldToScreen({ x: bounds.minX, y: bounds.minY })
  const bottomRight = camera.worldToScreen({ x: bounds.maxX, y: bounds.maxY })
  const rect = normalizeRect(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y)
  const containerWidth = rootFallbackNumber(container.clientWidth, container.getBoundingClientRect().width)
  const containerHeight = rootFallbackNumber(container.clientHeight, container.getBoundingClientRect().height)
  const insets = camera.frameInsets
  const minLeft = insets.left + HANDLE_MARGIN_PX
  const minTop = insets.top + HANDLE_MARGIN_PX
  return {
    left: clamp(
      rect.left + rect.width / 2 - HANDLE_SIZE_PX / 2,
      minLeft,
      Math.max(minLeft, containerWidth - insets.right - HANDLE_SIZE_PX - HANDLE_MARGIN_PX),
    ),
    top: clamp(
      rect.top - HANDLE_GAP_PX - HANDLE_SIZE_PX,
      minTop,
      Math.max(minTop, containerHeight - insets.bottom - HANDLE_SIZE_PX - HANDLE_MARGIN_PX),
    ),
  }
}

function createRotateIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M15 8a5 5 0 10-1.5 3.6M15 8h-4M15 8V4')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.8')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  return svg
}

function normalizeRect(left: number, top: number, right: number, bottom: number): {
  left: number
  top: number
  width: number
} {
  const x1 = Math.min(left, right)
  const y1 = Math.min(top, bottom)
  const x2 = Math.max(left, right)
  return {
    left: x1,
    top: y1,
    width: x2 - x1,
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
