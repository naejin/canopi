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
  MountedCanvasRuntime,
} from './runtime/runtime'

export const currentCanvasSession = signal<MountedCanvasRuntime | null>(null)
export const currentCanvasCommandSurface = computed<CanvasCommandSurface | null>(() => currentCanvasSession.value)
export const currentCanvasQuerySurface = computed<CanvasQuerySurface | null>(() => currentCanvasSession.value)
export const currentCanvasDocumentSurface = computed<CanvasDocumentSurface | null>(() => currentCanvasSession.value)
export const currentCanvasTool = canvasToolState
export const currentCanvasSelection = canvasSelectionState
export const currentCanvasHasSelection = canvasHasSelectionState
export const currentCanvasReady = canvasReadyState

export function getCurrentCanvasSession(): MountedCanvasRuntime | null {
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

export function setCurrentCanvasSession(session: MountedCanvasRuntime | null): void {
  currentCanvasSession.value = session
  setCanvasReadyState(session !== null)
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
