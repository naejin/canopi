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
} from './runtime/runtime'

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

export function setCurrentCanvasSession(session: CanvasRuntimeSurfaces | null): void {
  if (!session) {
    setCanvasRuntimeSurfaces(null)
    return
  }

  if (isCanvasRuntimeSurfaces(session)) {
    setCanvasRuntimeSurfaces(session)
    return
  }

  throw new Error('Canvas session publication requires explicit canvas runtime surfaces.')
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

function commandSurfaceFrom(session: CanvasRuntimeSurfaces | null): CanvasCommandSurface | null {
  if (!session) return null
  return session.commands
}

function querySurfaceFrom(session: CanvasRuntimeSurfaces | null): CanvasQuerySurface | null {
  if (!session) return null
  return session.queries
}

function documentSurfaceFrom(session: CanvasRuntimeSurfaces | null): CanvasDocumentSurface | null {
  if (!session) return null
  return session.documents
}
