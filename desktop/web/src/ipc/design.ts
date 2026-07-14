import { invoke } from '@tauri-apps/api/core'
import { save, open } from '@tauri-apps/plugin-dialog'
import type {
  AutosaveEntry,
  CanopiFile,
  DesignNotebookSection,
  DesignNotebookSnapshot,
  DesignSummary,
} from '../types/design'
import { designPath } from '../app/document-session/store'
import {
  prepareDesignWriteDestination,
  type PreparedDesignWriteDestination,
} from '../app/document-session/write-admission'

// ---------------------------------------------------------------------------
// File dialogs — run in the frontend (JS) to avoid GTK deadlock on Linux.
// The Rust side only handles file read/write, never shows dialogs.
// ---------------------------------------------------------------------------

export interface DesignSaveDestinationHint {
  readonly currentPath: string | null
  readonly suggestedName: string
}

/** Select a native Design destination without starting external I/O. */
export async function selectDesignSavePath({
  currentPath,
  suggestedName,
}: DesignSaveDestinationHint): Promise<string> {
  const filePath = await save({
    defaultPath: currentPath ?? `${suggestedName || 'Untitled'}.canopi`,
    filters: [{ name: 'Canopi Design', extensions: ['canopi'] }],
  })
  if (!filePath) throw new Error('Dialog cancelled')
  return filePath
}

/** Couple one native target family to its matching write effect. */
export function prepareDesignWrite(path: string): PreparedDesignWriteDestination {
  return prepareDesignWriteDestination({
    resource: `native-design:${path}`,
    destinationPath: path,
    write: (content) => saveDesign(path, content).then(() => undefined),
  })
}

/** Couple recovery to the shared autosave store and its pruning side effect. */
export function prepareRecoveryWrite(
  destinationHint: string | null,
): PreparedDesignWriteDestination {
  return prepareDesignWriteDestination({
    resource: 'native-recovery-store',
    write: (content) => autosaveDesign(content, destinationHint),
  })
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
// Direct IPC wrappers — keep Design writers private to prepared destinations.
// ---------------------------------------------------------------------------

/** Save design to an existing path (Ctrl+S after first save). */
async function saveDesign(path: string, content: CanopiFile): Promise<string> {
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

/** Get saved Design references for the Design Notebook. */
export async function getDesignNotebookEntries(): Promise<DesignSummary[]> {
  return invoke('get_design_notebook_entries')
}

/** Get saved Design references plus user-owned Notebook Section organization. */
export async function getDesignNotebook(): Promise<DesignNotebookSnapshot> {
  return invoke('get_design_notebook')
}

export async function createNotebookSection(name: string): Promise<DesignNotebookSection> {
  return invoke('create_notebook_section', { name })
}

export async function addDesignReferenceToNotebook(
  path: string,
  content: CanopiFile,
): Promise<void> {
  return invoke('add_design_reference_to_notebook', { path, content })
}

export async function renameNotebookSection(sectionId: string, name: string): Promise<void> {
  return invoke('rename_notebook_section', { sectionId, name })
}

export async function deleteNotebookSection(sectionId: string): Promise<void> {
  return invoke('delete_notebook_section', { sectionId })
}

export async function moveDesignReferenceToSection(
  path: string,
  sectionId: string | null,
): Promise<void> {
  return invoke('move_design_reference_to_section', { path, sectionId })
}

export async function removeDesignReference(path: string): Promise<void> {
  return invoke('remove_design_reference', { path })
}

export async function reorderNotebookSections(sectionIds: string[]): Promise<void> {
  return invoke('reorder_notebook_sections', { sectionIds })
}

export async function reorderDesignReferences(paths: string[]): Promise<void> {
  return invoke('reorder_design_references', { paths })
}

/** Silent autosave to app data dir. */
async function autosaveDesign(content: CanopiFile, path: string | null): Promise<void> {
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
