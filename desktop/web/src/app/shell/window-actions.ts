import { getCurrentWindow } from '@tauri-apps/api/window'

/** Desktop window chrome actions, so components never reach Tauri directly. */
export function minimizeAppWindow(): Promise<void> {
  return getCurrentWindow().minimize()
}

export function toggleMaximizeAppWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize()
}

export function startDraggingAppWindow(): Promise<void> {
  return getCurrentWindow().startDragging()
}

export function closeAppWindow(): Promise<void> {
  return getCurrentWindow().close()
}
