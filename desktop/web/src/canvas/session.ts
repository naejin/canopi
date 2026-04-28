import { computed, signal } from '@preact/signals'
import {
  canvasHasSelectionState,
  canvasReadyState,
  canvasSelectionState,
  canvasToolState,
  getCanvasTool,
  setCanvasReadyState,
  setCanvasTool,
} from './session-state'
import type {
  CanvasCommandSurface,
  CanvasDocumentSurface,
  CanvasQuerySurface,
  CanvasRuntimeSurfaces,
  MountedCanvasRuntime,
} from './runtime/runtime'
import { createCanvasRuntimeSurfaces } from './runtime/surfaces'

export const currentCanvasSession = signal<CanvasRuntimeSurfaces | null>(null)
export const currentCanvasCommandSurface = computed<CanvasCommandSurface | null>(() =>
  commandSurfaceFrom(currentCanvasSession.value),
)
export const currentCanvasQuerySurface = computed<CanvasQuerySurface | null>(() =>
  querySurfaceFrom(currentCanvasSession.value),
)
export const currentCanvasDocumentSurface = computed<CanvasDocumentSurface | null>(() =>
  documentSurfaceFrom(currentCanvasSession.value),
)
export const currentCanvasTool = canvasToolState
export const currentCanvasSelection = canvasSelectionState
export const currentCanvasHasSelection = canvasHasSelectionState
export const currentCanvasReady = canvasReadyState

export function getCurrentCanvasSession(): CanvasRuntimeSurfaces | null {
  return currentCanvasSession.value
}

export function getCurrentCanvasCommandSurface(): CanvasCommandSurface | null {
  return currentCanvasCommandSurface.value
}

export function getCurrentCanvasQuerySurface(): CanvasQuerySurface | null {
  return currentCanvasQuerySurface.value
}

export function getCurrentCanvasDocumentSurface(): CanvasDocumentSurface | null {
  return currentCanvasDocumentSurface.value
}

export function setCanvasRuntimeSurfaces(surfaces: CanvasRuntimeSurfaces | null): void {
  currentCanvasSession.value = surfaces
  setCanvasReadyState(surfaces !== null)
}

export function setCurrentCanvasSession(session: MountedCanvasRuntime | CanvasRuntimeSurfaces | null): void {
  if (!session) {
    setCanvasRuntimeSurfaces(null)
    return
  }

  if (isCanvasRuntimeSurfaces(session)) {
    setCanvasRuntimeSurfaces(session)
    return
  }

  if (isCompleteMountedRuntime(session)) {
    setCanvasRuntimeSurfaces(createCanvasRuntimeSurfaces(session))
    return
  }

  // Compatibility for narrow fake surfaces in focused tests; production mount
  // should publish explicit CanvasRuntimeSurfaces via setCanvasRuntimeSurfaces.
  currentCanvasSession.value = session as unknown as CanvasRuntimeSurfaces
  setCanvasReadyState(true)
}

export function setCurrentCanvasTool(name: string): void {
  const session = currentCanvasCommandSurface.value
  if (session) {
    setCanvasTool(name)
    session.setTool(name)
    return
  }
  setCanvasTool(name)
}

export function getCurrentCanvasTool(): string {
  return getCanvasTool()
}

function isCanvasRuntimeSurfaces(value: unknown): value is CanvasRuntimeSurfaces {
  return Boolean(
    value
    && typeof value === 'object'
    && 'commands' in value
    && 'queries' in value
    && 'documents' in value,
  )
}

function isCompleteMountedRuntime(value: MountedCanvasRuntime): boolean {
  return typeof value.setTool === 'function'
    && typeof value.getSceneSnapshot === 'function'
    && typeof value.serializeDocument === 'function'
}

function commandSurfaceFrom(session: CanvasRuntimeSurfaces | null): CanvasCommandSurface | null {
  if (!session) return null
  if (isCanvasRuntimeSurfaces(session)) return session.commands
  return session as unknown as CanvasCommandSurface
}

function querySurfaceFrom(session: CanvasRuntimeSurfaces | null): CanvasQuerySurface | null {
  if (!session) return null
  if (isCanvasRuntimeSurfaces(session)) return session.queries
  return session as unknown as CanvasQuerySurface
}

function documentSurfaceFrom(session: CanvasRuntimeSurfaces | null): CanvasDocumentSurface | null {
  if (!session) return null
  if (isCanvasRuntimeSurfaces(session)) return session.documents
  return session as unknown as CanvasDocumentSurface
}
