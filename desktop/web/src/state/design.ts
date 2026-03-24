import { signal } from '@preact/signals'
import type { CanopiFile } from '../types/design'
import { canvasEngine } from '../canvas/engine'
import { toCanopi, fromCanopi } from '../canvas/serializer'
import * as designIpc from '../ipc/design'

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export const designDirty = signal<boolean>(false)
export const designPath = signal<string | null>(null)
export const designName = signal<string>('Untitled')
export const currentDesign = signal<CanopiFile | null>(null)

// Path queued for loading the next time CanvasPanel mounts its engine.
// Set this before navigating to 'canvas' — CanvasPanel consumes and clears it.
export const pendingDesignPath = signal<string | null>(null)

// ---------------------------------------------------------------------------
// File actions — all async, all update signals on success
// ---------------------------------------------------------------------------

/** Save to the current path (Ctrl+S). Opens Save As dialog if no path yet. */
export async function saveCurrentDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const content = toCanopi(engine, { name: designName.value })

  if (designPath.value) {
    await designIpc.saveDesign(designPath.value, content)
  } else {
    const path = await designIpc.saveDesignAs(content)
    designPath.value = path
    designName.value = _nameFromPath(path)
  }

  currentDesign.value = content
  designDirty.value = false
}

/** Save As — always prompts for a new path (Ctrl+Shift+S). */
export async function saveAsCurrentDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const content = toCanopi(engine, { name: designName.value })
  try {
    const path = await designIpc.saveDesignAs(content)
    designPath.value = path
    designName.value = _nameFromPath(path)
    currentDesign.value = content
    designDirty.value = false
  } catch (e) {
    if (_isCancelled(e)) return
    throw e
  }
}

/** Open file dialog and load the chosen design (Ctrl+O). */
export async function openDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  try {
    const { file, path } = await designIpc.openDesignDialog()
    fromCanopi(file, engine)
    currentDesign.value = file
    designName.value = file.name
    designPath.value = path
    designDirty.value = false
    engine.history.clear()
    engine.showCanvasChrome()
  } catch (e) {
    if (_isCancelled(e)) return
    throw e
  }
}

/** Create a blank design (Ctrl+N). */
export async function newDesignAction(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const file = await designIpc.newDesign()
  fromCanopi(file, engine)
  currentDesign.value = file
  designPath.value = null
  designName.value = 'Untitled'
  designDirty.value = false
  engine.history.clear()
  engine.showCanvasChrome()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _nameFromPath(path: string): string {
  const base = path.split('/').pop() ?? path.split('\\').pop() ?? path
  return base.replace(/\.canopi$/i, '') || 'Untitled'
}

function _isCancelled(e: unknown): boolean {
  return typeof e === 'string'
    ? e.includes('Dialog cancelled') || e.includes('cancelled')
    : e instanceof Error
    ? e.message.includes('cancelled')
    : false
}
