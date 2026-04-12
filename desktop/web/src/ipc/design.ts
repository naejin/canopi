import { invoke } from '@tauri-apps/api/core'
import { save, open } from '@tauri-apps/plugin-dialog'
import type { CanopiFile, DesignSummary, AutosaveEntry } from '../types/design'
import { designPath } from '../state/design'

// ---------------------------------------------------------------------------
// File dialogs — run in the frontend (JS) to avoid GTK deadlock on Linux.
// The Rust side only handles file read/write, never shows dialogs.
// ---------------------------------------------------------------------------

/**
 * Show a native Save-As dialog, then write the design to the chosen path.
 * Returns the saved path. Throws "Dialog cancelled" if user dismisses.
 */
export async function saveDesignAs(content: CanopiFile): Promise<string> {
  const currentPath = designPath.peek()
  const defaultName = `${content.name || 'Untitled'}.canopi`
  const filePath = await save({
    defaultPath: currentPath ?? defaultName,
    filters: [{ name: 'Canopi Design', extensions: ['canopi'] }],
  })
  if (!filePath) throw new Error('Dialog cancelled')
  // Write file via Rust (atomic write + backup)
  return invoke('save_design', { path: filePath, content })
}

/**
 * Show a native Open dialog, then load the chosen design.
 * Returns the loaded CanopiFile. Throws "Dialog cancelled" if user dismisses.
 */
export async function openDesignDialog(): Promise<{ file: CanopiFile; path: string }> {
  const currentPath = designPath.peek()
  const defaultDir = currentPath ? currentPath.substring(0, currentPath.lastIndexOf('/') + 1) : undefined
  const selected = await open({
    defaultPath: defaultDir,
    filters: [{ name: 'Canopi Design', extensions: ['canopi'] }],
    multiple: false,
  })
  if (!selected) throw new Error('Dialog cancelled')
  // open() returns string | string[] | null depending on `multiple`
  const filePath = typeof selected === 'string' ? selected : (selected as string[])[0]!
  const file: CanopiFile = await invoke('load_design', { path: filePath })
  return { file, path: filePath }
}

// ---------------------------------------------------------------------------
// Direct IPC wrappers — no dialogs involved
// ---------------------------------------------------------------------------

/** Save design to an existing path (Ctrl+S after first save). */
export async function saveDesign(path: string, content: CanopiFile): Promise<string> {
  return invoke('save_design', { path, content })
}

/** Load a design from a known path (e.g. recent files). */
export async function loadDesign(path: string): Promise<CanopiFile> {
  return invoke('load_design', { path })
}

/** Create a new empty design with default layers. */
export async function newDesign(): Promise<CanopiFile> {
  return invoke('new_design')
}

/** Get recently opened files list. */
export async function getRecentFiles(): Promise<DesignSummary[]> {
  return invoke('get_recent_files')
}

/** Silent autosave to app data dir. */
export async function autosaveDesign(content: CanopiFile, path: string | null): Promise<void> {
  return invoke('autosave_design', { content, path })
}

/** List available autosave files for crash recovery. */
export async function listAutosaves(): Promise<AutosaveEntry[]> {
  return invoke('list_autosaves')
}

// ---------------------------------------------------------------------------
// Export / Import — also use frontend dialogs
// ---------------------------------------------------------------------------

/** Show save dialog for text files (SVG, CSV), then write via Rust. */
export async function exportFile(
  data: string,
  defaultName: string,
  filterName: string,
  filterExt: string[],
): Promise<string> {
  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions: filterExt }],
  })
  if (!filePath) throw new Error('Dialog cancelled')
  return invoke('export_file', { data, path: filePath })
}

/** Show save dialog for binary files (PNG), then write via Rust. */
export async function exportBinary(
  data: number[],
  defaultName: string,
  filterName: string,
  filterExt: string[],
): Promise<string> {
  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions: filterExt }],
  })
  if (!filePath) throw new Error('Dialog cancelled')
  return invoke('export_binary', { data, path: filePath })
}

/** Show open dialog for importing files, return bytes + filename via Rust. */
export async function importFileDialog(
  filterName: string,
  filterExt: string[],
): Promise<[number[], string]> {
  const selected = await open({
    filters: [{ name: filterName, extensions: filterExt }],
    multiple: false,
  })
  if (!selected) throw new Error('Dialog cancelled')
  const filePath = typeof selected === 'string' ? selected : (selected as string[])[0]!
  return invoke('read_file_bytes', { path: filePath })
}
