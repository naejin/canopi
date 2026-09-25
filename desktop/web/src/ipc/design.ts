import { invoke } from '@tauri-apps/api/core'
import { save, open } from '@tauri-apps/plugin-dialog'
import type {
  CanopiFile,
  DesignDraftSummary,
  DesignNotebookSection,
  DesignNotebookSnapshot,
  DesignSaveOutcome,
  DesignSummary,
  LoadedDesign,
} from '../types/design'
import { designPath } from '../app/document-session/store'
import { encodeCanopiDesign } from '../app/contracts/canopi-design-wire'
import { DesignHomeConflictError } from '../app/document-session/continuous-save'
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

/**
 * Couple one native Design file to its write. The write refuses to replace a
 * file that no longer holds `expectedFingerprint` (`null` overwrites) and
 * reports the written fingerprint before the save settles.
 */
export function prepareDesignWrite(
  path: string,
  expectedFingerprint: string | null,
  onWritten: (fingerprint: string) => void,
): PreparedDesignWriteDestination {
  return prepareDesignWriteDestination({
    resource: `native-design:${path}`,
    destinationPath: path,
    write: async (content) => {
      const outcome = await saveDesign(path, content, expectedFingerprint)
      if (outcome.kind === 'conflict') {
        throw new DesignHomeConflictError(outcome.current_fingerprint === null)
      }
      onWritten(outcome.fingerprint)
    },
  })
}

/** Couple one Design Draft in app data to its write. */
export function prepareDraftWrite(id: string): PreparedDesignWriteDestination {
  return prepareDesignWriteDestination({
    resource: `native-draft:${id}`,
    write: (content) => saveDesignDraft(id, content),
  })
}

/**
 * Show a native Open dialog, then load the chosen design.
 * Returns the loaded CanopiFile. Throws "Dialog cancelled" if user dismisses.
 */
export async function openDesignDialog(): Promise<LoadedDesign & { path: string }> {
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
  const loaded = await loadDesign(filePath)
  return { ...loaded, path: filePath }
}

// ---------------------------------------------------------------------------
// Direct IPC wrappers — keep Design writers private to prepared destinations.
// ---------------------------------------------------------------------------

/** Write a Design file unless it changed on disk since `expectedFingerprint`. */
async function saveDesign(
  path: string,
  content: CanopiFile,
  expectedFingerprint: string | null,
): Promise<DesignSaveOutcome> {
  return invoke('save_design', {
    path,
    content: encodeCanopiDesign(content),
    expectedFingerprint,
  })
}

/** Load a design from a known path (e.g. recent files) with its fingerprint. */
export async function loadDesign(path: string): Promise<LoadedDesign> {
  return invoke('load_design', { path })
}

async function saveDesignDraft(id: string, content: CanopiFile): Promise<void> {
  return invoke('save_design_draft', { id, content: encodeCanopiDesign(content) })
}

export async function loadDesignDraft(id: string): Promise<CanopiFile> {
  return invoke('load_design_draft', { id })
}

export async function listDesignDrafts(): Promise<DesignDraftSummary[]> {
  return invoke('list_design_drafts')
}

export async function deleteDesignDraft(id: string): Promise<void> {
  return invoke('delete_design_draft', { id })
}

/** Create a new empty design with default layers. */
export async function newDesign(): Promise<CanopiFile> {
  return invoke('new_design')
}

/** Get recently opened files list. */
export async function getRecentFiles(): Promise<DesignSummary[]> {
  return invoke('get_recent_files')
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

export async function relocateDesignReference(
  path: string,
  sectionId: string | null,
  paths: string[],
): Promise<void> {
  return invoke('relocate_design_reference', { path, sectionId, paths })
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
