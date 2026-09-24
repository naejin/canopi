import { open } from '@tauri-apps/plugin-dialog'
import type {
  LidarMeasurementKind,
  LidarPresentationEntryKind,
} from '../../generated/contracts'
import {
  lidarCancelAnalysisJob,
  lidarCancelImport,
  lidarDeleteAnalysis,
  lidarDeleteLayer,
  lidarDeleteLayerImpact,
  lidarDismissImport,
  lidarImportItem,
  lidarLayerCollection,
  lidarRenameAnalysis,
  lidarRenameLayer,
  lidarRetryAnalysis,
  lidarRetryImport,
  type LidarImportReceipt,
  type LidarLayerCollection,
} from '../../ipc/lidar'
import {
  moveLidarEntry,
  patchLidarEntryById,
  removeLidarEntries,
  upsertLidarEntry,
} from '../design-edit/lidar'
import {
  ensureLidarPolling,
  lidarStatusMessage,
  refreshLidarLibrary,
} from './library-store'
import { designSessionStore } from '../document-session/store'
import { reconcileInspectionWithPresentation } from './inspection'

/**
 * Leaf action module for the Data Library and the Layers data band: every UI
 * mutation flows through here so panels never orchestrate IPC sequencing.
 *
 * Library operations (import, rename, delete, retry) never dirty a Design.
 * Design references change only through Add to Design, visibility, opacity,
 * order and Remove from Design, which are Design Edits and undoable.
 */

/**
 * Let the user choose source files, without creating anything yet.
 *
 * Cancelling the chooser creates no item, no job and no asset, which is why
 * the chooser comes first and the interpretation is confirmed afterwards.
 */
export async function chooseImportFiles(title: string): Promise<string[] | null> {
  const selection = await open({ multiple: true, title })
  if (selection === null) return null
  const paths = Array.isArray(selection) ? selection : [selection]
  return paths.length > 0 ? paths : null
}

/**
 * Import the chosen files as one new library item.
 *
 * The listed order is the item's source priority: the first listed valid
 * value wins where files overlap. Import saves to the library only; it never
 * attaches to a Design or moves the camera.
 */
export async function importLibraryItem(
  paths: string[],
  name: string,
  kind: LidarMeasurementKind,
  unit: { label: string | null; unknown: boolean },
): Promise<LidarImportReceipt> {
  const receipt = await withLidarError(() => lidarImportItem(name, kind, unit, paths))
  await refreshLidarLibrary()
  ensureLidarPolling()
  return receipt
}

/** Retry a failed or cancelled import with its saved selection. */
export async function retryLibraryImport(layerId: string): Promise<void> {
  await withLidarError(() => lidarRetryImport(layerId))
  await refreshLidarLibrary()
  ensureLidarPolling()
}

/** Cancel one running import; only explicit Cancel stops library work. */
export async function cancelLibraryImport(jobId: string): Promise<void> {
  await withLidarError(() => lidarCancelImport(jobId))
  await refreshLidarLibrary()
}

/** Remove a never-published failed or cancelled import. */
export async function dismissLibraryImport(layerId: string): Promise<void> {
  await withLidarError(() => lidarDismissImport(layerId))
  await refreshLidarLibrary()
}

export async function renameLibraryItem(
  kind: LidarPresentationEntryKind,
  id: string,
  name: string,
): Promise<void> {
  await withLidarError(() => (kind === 'Analysis' ? lidarRenameAnalysis(id, name) : lidarRenameLayer(id, name)))
  await refreshLidarLibrary()
}

export async function fetchDeleteImpact(layerId: string) {
  return lidarDeleteLayerImpact(layerId)
}

/**
 * Delete one library item.
 *
 * A source with saved results is refused natively. On success the current
 * Design's reference is removed through Design Edit, but only while the same
 * Design session is still current: Undo can restore that reference, which then
 * honestly shows unavailable data. Other saved Designs keep their references.
 */
export async function deleteLibraryItem(
  kind: LidarPresentationEntryKind,
  id: string,
): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(() => (kind === 'Analysis' ? lidarDeleteAnalysis(id) : lidarDeleteLayer(id)))
  await refreshLidarLibrary()
  if (designSessionStore.sessionIdentity.value === identity) {
    removePresentedEntities([id])
  }
}

/** Read the first page of an item's source files, for details. */
export async function fetchItemSources(layerId: string): Promise<LidarLayerCollection> {
  return lidarLayerCollection(layerId, null)
}

/**
 * Add a library item to the current Design.
 *
 * Idempotent: an existing reference keeps its visibility, opacity and order.
 * A new reference is visible at the top of the data band and dirties the
 * Design; the camera does not move.
 */
export function addToDesign(kind: LidarPresentationEntryKind, id: string): void {
  upsertLidarEntry(kind, id)
}

/**
 * Remove one reference from the current Design.
 *
 * A Design Edit, not a library operation: the item stays in the library and
 * in other Designs, and the change is undoable with the Design's history.
 */
export function removeFromDesign(id: string): void {
  removePresentedEntities([id])
}

export function setLidarEntryVisibility(id: string, visible: boolean): void {
  patchLidarEntryById(id, { visible })
  // Hiding the inspected reference ends inspection in the same interaction.
  reconcileInspectionWithPresentation()
}

export function setLidarEntryOpacity(id: string, opacity: number): void {
  patchLidarEntryById(id, { opacity })
}

/**
 * Move one reference one position towards the front or the back of the data
 * band. Display order only: it never changes an item's source priority.
 */
export function moveReference(id: string, towards: 'front' | 'back'): void {
  // Saved order renders back to front, so "front" is a higher order.
  moveLidarEntry(id, towards === 'front' ? 'down' : 'up')
}

/**
 * Retry one failed calculation with its saved definition and input.
 *
 * A published result is never recalculated in place; Retry exists only for an
 * operation that produced no result.
 */
export async function retryFailedCalculation(
  definitionId: string,
  inputGenerationId: string,
): Promise<void> {
  const receipt = await withLidarError(() => lidarRetryAnalysis(definitionId, inputGenerationId))
  runningAnalysisJobs.set(receipt.definition_id, receipt.job_id)
  await refreshLidarLibrary()
  ensureLidarPolling()
}

function removePresentedEntities(ids: string[]): void {
  removeLidarEntries(ids)
  // Removing a reference removes its reason to be inspected.
  reconcileInspectionWithPresentation()
}

/**
 * Run one library action, surfacing its failure through the shared status.
 * The message is published and re-thrown so callers can show it inline.
 */
async function withLidarError<T>(work: () => Promise<T>): Promise<T> {
  lidarStatusMessage.value = null
  try {
    return await work()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    lidarStatusMessage.value = message
    throw error instanceof Error ? error : new Error(message)
  }
}

/** Calculation jobs this session started, by definition, for Cancel. */
const runningAnalysisJobs = new Map<string, string>()

export function runningAnalysisJobId(definitionId: string): string | null {
  return runningAnalysisJobs.get(definitionId) ?? null
}

/** Cancel the calculation this session started for one definition. */
export async function cancelAnalysisJob(definitionId: string): Promise<boolean> {
  const jobId = runningAnalysisJobs.get(definitionId)
  if (!jobId) return false
  await withLidarError(() => lidarCancelAnalysisJob(jobId))
  runningAnalysisJobs.delete(definitionId)
  await refreshLidarLibrary()
  return true
}
