import { t } from '../../../i18n'
import type { CameraController, SceneBounds } from '../camera'
import type { CanvasDesignObjectSelectionModel, CanvasDesignObjectSelectionTarget } from '../runtime'
import type { ScenePersistedState, ScenePoint, SceneStore } from '../scene'
import type { SceneEditCoordinator, SceneEditTransaction } from '../scene-runtime/transactions'
import type { SceneInteractionPointerDrag, SceneInteractionPointerEvent } from './frame'

interface SelectionRotationHandleOptions {
  readonly container: HTMLElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly getSelection: () => CanvasDesignObjectSelectionModel
  readonly sceneEdits: SceneEditCoordinator
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly refreshSelectionDependent: () => void
}

export interface SelectionRotationHandleController {
  refresh(): void
  pointerDown(context: SelectionRotationHandlePointerDownContext): SceneInteractionPointerDrag | null
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
  readonly target: RotatableTarget
  readonly pivot: ScenePoint
  readonly startPointerAngleDeg: number
  readonly startRotationDeg: number
  lastDeltaDeg: number
}

interface RotatableTarget {
  readonly kind: 'zone' | 'annotation'
  readonly id: string
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
    'border: 1px solid var(--color-primary-hover)',
    'border-radius: var(--radius-full)',
    'box-shadow: var(--shadow-md)',
    'box-sizing: border-box',
    'color: var(--color-primary-contrast)',
    'cursor: grab',
    'outline: 2px solid var(--color-surface)',
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
  options.container.appendChild(root)
  let activeDrag: ActiveRotationDrag | null = null

  function refresh(): void {
    root.setAttribute('aria-label', t('canvas.rotationHandle.label'))
    const selection = options.getSelection()
    if (!isSingleRotatableSelection(selection)) {
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

  function pointerDown({ event, rawWorld }: SelectionRotationHandlePointerDownContext): SceneInteractionPointerDrag | null {
    if (event.button !== 0) return null
    const selection = options.getSelection()
    const target = resolveRotatableTarget(options.getSceneStore().persisted, selection)
    if (!target || !selection.bounds) {
      hide()
      return null
    }

    event.preventDefault()
    event.stopPropagation()
    const pivot = centerOfBounds(selection.bounds)
    activeDrag = {
      tx: options.sceneEdits.begin('interaction-rotate'),
      target,
      pivot,
      startPointerAngleDeg: angleDeg(pivot, rawWorld),
      startRotationDeg: getTargetRotationDeg(options.getSceneStore().persisted, target),
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

  function updateRotation(context: SceneInteractionPointerEvent): void {
    applyActiveRotation(context)
  }

  function commitRotation(context: SceneInteractionPointerEvent): void {
    if (!activeDrag) return
    const deltaDeg = applyActiveRotation(context)
    const tx = activeDrag.tx
    activeDrag = null
    root.style.cursor = 'grab'
    delete root.dataset.rotationHandleActive
    hideReadout()

    if (Math.abs(deltaDeg) > NO_OP_ROTATION_DELTA_DEG && tx.changed) {
      tx.commit({ invalidate: 'scene' })
    } else {
      tx.abort()
      options.render('scene')
    }
    options.refreshSelectionDependent()
  }

  function cancelActiveDrag(): boolean {
    if (!activeDrag) return false
    activeDrag.tx.abort()
    activeDrag = null
    root.style.cursor = 'grab'
    delete root.dataset.rotationHandleActive
    hideReadout()
    options.render('scene')
    options.refreshSelectionDependent()
    return true
  }

  function applyActiveRotation(context: SceneInteractionPointerEvent): number {
    if (!activeDrag) return 0
    const deltaDeg = resolveDeltaDeg(activeDrag, context)
    if (Math.abs(deltaDeg - activeDrag.lastDeltaDeg) < 0.0001) return deltaDeg
    activeDrag.lastDeltaDeg = deltaDeg
    const target = activeDrag.target
    const rotationDeg = normalizeRotationDeg(activeDrag.startRotationDeg + deltaDeg)
    activeDrag.tx.mutate((draft) => {
      setTargetRotationDeg(draft, target, rotationDeg)
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

  refresh()

  return {
    refresh,
    pointerDown,
    cancelActiveDrag,
    contains(target) {
      return target instanceof Node && root.contains(target)
    },
    dispose() {
      cancelActiveDrag()
      root.remove()
    },
  }
}

function isSingleRotatableSelection(selection: CanvasDesignObjectSelectionModel): selection is CanvasDesignObjectSelectionModel & {
  readonly bounds: SceneBounds
  readonly editableTargets: readonly [CanvasDesignObjectSelectionTarget]
} {
  if (!selection.bounds || selection.blockedTargets.length > 0 || selection.editableTargets.length !== 1) {
    return false
  }
  const target = selection.editableTargets[0]!
  return target.kind === 'zone' || target.kind === 'annotation'
}

function resolveRotatableTarget(
  scene: ScenePersistedState,
  selection: CanvasDesignObjectSelectionModel,
): RotatableTarget | null {
  if (!isSingleRotatableSelection(selection)) return null
  const target = selection.editableTargets[0]
  if (target.kind === 'zone' && scene.zones.some((zone) => zone.name === target.id)) return target
  if (target.kind === 'annotation' && scene.annotations.some((annotation) => annotation.id === target.id)) {
    return target
  }
  return null
}

function centerOfBounds(bounds: SceneBounds): ScenePoint {
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) / 2,
    y: bounds.minY + (bounds.maxY - bounds.minY) / 2,
  }
}

function getTargetRotationDeg(scene: ScenePersistedState, target: RotatableTarget): number {
  if (target.kind === 'zone') {
    return scene.zones.find((zone) => zone.name === target.id)?.rotationDeg ?? 0
  }
  return scene.annotations.find((annotation) => annotation.id === target.id)?.rotationDeg ?? 0
}

function setTargetRotationDeg(scene: ScenePersistedState, target: RotatableTarget, rotationDeg: number): void {
  if (target.kind === 'zone') {
    const zone = scene.zones.find((entry) => entry.name === target.id)
    if (zone) zone.rotationDeg = rotationDeg
    return
  }
  const annotation = scene.annotations.find((entry) => entry.id === target.id)
  if (annotation) annotation.rotationDeg = rotationDeg
}

function resolveDeltaDeg(active: ActiveRotationDrag, context: SceneInteractionPointerEvent): number {
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

function normalizeRotationDeg(degrees: number): number {
  const normalized = degrees % 360
  return cleanDegrees(normalized < 0 ? normalized + 360 : normalized)
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function resolveHandlePlacement(
  bounds: SceneBounds,
  camera: CameraController,
  container: HTMLElement,
): { left: number; top: number } {
  const topLeft = camera.worldToScreen({ x: bounds.minX, y: bounds.minY })
  const bottomRight = camera.worldToScreen({ x: bounds.maxX, y: bounds.maxY })
  const rect = normalizeRect(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y)
  const containerWidth = rootFallbackNumber(container.clientWidth, container.getBoundingClientRect().width)
  const containerHeight = rootFallbackNumber(container.clientHeight, container.getBoundingClientRect().height)
  return {
    left: clamp(
      rect.left + rect.width / 2 - HANDLE_SIZE_PX / 2,
      HANDLE_MARGIN_PX,
      Math.max(HANDLE_MARGIN_PX, containerWidth - HANDLE_SIZE_PX - HANDLE_MARGIN_PX),
    ),
    top: clamp(
      rect.top - HANDLE_GAP_PX - HANDLE_SIZE_PX,
      HANDLE_MARGIN_PX,
      Math.max(HANDLE_MARGIN_PX, containerHeight - HANDLE_SIZE_PX - HANDLE_MARGIN_PX),
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

function cleanDegrees(value: number): number {
  return Math.abs(value) < 0.0000001 ? 0 : value
}

function stopCanvasEvent(event: Event): void {
  event.stopPropagation()
}
