import { signal } from '@preact/signals'
import {
  canvasHasSelectionState,
  canvasReadyState,
  canvasSelectionState,
  canvasToolState,
  getCanvasTool,
  setCanvasReadyState,
  setCanvasTool,
} from './session-state'
import type { CanvasRuntime } from './runtime/runtime'

export const currentCanvasSession = signal<CanvasRuntime | null>(null)
export const currentCanvasTool = canvasToolState
export const currentCanvasSelection = canvasSelectionState
export const currentCanvasHasSelection = canvasHasSelectionState
export const currentCanvasReady = canvasReadyState

export function getCurrentCanvasSession(): CanvasRuntime | null {
  return currentCanvasSession.value
}

export function setCurrentCanvasSession(session: CanvasRuntime | null): void {
  currentCanvasSession.value = session
  setCanvasReadyState(session !== null)
}

export function setCurrentCanvasTool(name: string): void {
  const session = currentCanvasSession.value
  if (session) {
    session.setTool(name)
    return
  }
  setCanvasTool(name)
}

export function getCurrentCanvasTool(): string {
  return getCanvasTool()
}
