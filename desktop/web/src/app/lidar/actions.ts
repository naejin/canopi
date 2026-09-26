import { open } from '@tauri-apps/plugin-dialog'
import type {
  AnalysisReceipt,
  AnalysisRequest,
  AnalysisRunStatus,
  LibraryDeleteImpact,
  LibraryItemRole,
  LibrarySnapshot,
  ProcessingHistoryPage,
  RasterQuantity,
} from '../../generated/contracts'
import {
  lidarCancelAnalysisJob,
  lidarCancelImport,
  lidarCreateAnalysis,
  lidarDeleteImpact,
  lidarDeleteItem,
  lidarDismissImport,
  lidarImportItem,
  lidarLayerCollection,
  lidarProcessingHistory,
  lidarRenameItem,
  lidarRerunAnalysis,
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
  presentationEntryKind,
  refreshLidarLibrary,
} from './library-store'
import { designSessionStore } from '../document-session/store'
import { isPresentableOutput } from '../analyses/registry'
import { reconcileInspectionWithPresentation } from './inspection'

/**
 * Leaf action module for the Data Library and the Layers data band: every UI
 * mutation flows through here so panels never orchestrate IPC sequencing.
 *
 * Library operations (import, rename, delete, analyses and their reruns)
 * never dirty a Design.
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
  quantity: RasterQuantity,
  unit: { label: string | null; unknown: boolean },
): Promise<LidarImportReceipt> {
  const receipt = await withLidarError(() => lidarImportItem(name, quantity, unit, paths))
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

export async function renameLibraryItem(id: string, name: string): Promise<void> {
  await withLidarError(() => lidarRenameItem(id, name))
  await refreshLidarLibrary()
}

export async function fetchDeleteImpact(id: string): Promise<LibraryDeleteImpact> {
  return lidarDeleteImpact(id)
}

/**
 * Delete one library item.
 *
 * An item other results were calculated from is refused natively. On success the current
 * Design's reference is removed through Design Edit, but only while the same
 * Design session is still current: Undo can restore that reference, which then
 * honestly shows unavailable data. Other saved Designs keep their references.
 */
export async function deleteLibraryItem(id: string): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(() => lidarDeleteItem(id))
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
export function addToDesign(role: LibraryItemRole, id: string): void {
  upsertLidarEntry(presentationEntryKind(role), id)
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
 * Run one registered analysis as a new definition, saved to the library.
 *
 * Inputs and earlier results never change, and a second run with the same
 * settings is a second definition. When asked from Layers, the finished
 * results join only the Design session that asked: switching Designs while it
 * runs leaves them in the library, never in the replacement Design.
 */
export async function runAnalysis(request: AnalysisRequest, attachToDesign: boolean): Promise<AnalysisReceipt> {
  const identity = designSessionStore.sessionIdentity.value
  const receipt = await withLidarError(() => lidarCreateAnalysis(request))
  if (attachToDesign) {
    pendingAttachments.set(receipt.definition_id, { identity, itemIds: receipt.item_ids })
  }
  await refreshLidarLibrary()
  ensureLidarPolling()
  return receipt
}

/**
 * Run one definition again with its saved inputs and parameters: Retry when
 * it produced no result, Refresh when it did. A refresh republishes in place,
 * so every Design that uses the result sees the new one; the earlier run stays
 * in the processing history. Never automatic.
 */
export async function rerunAnalysis(definitionId: string): Promise<AnalysisReceipt> {
  const receipt = await withLidarError(() => lidarRerunAnalysis(definitionId))
  await refreshLidarLibrary()
  ensureLidarPolling()
  return receipt
}

/** Layers-initiated results waiting to join the Design session that asked. */
const pendingAttachments = new Map<string, { readonly identity: object; readonly itemIds: readonly string[] }>()

/**
 * Attach finished Layers-initiated results to their originating Design
 * session, and drop requests whose session ended or whose run failed.
 *
 * Every presentable output of the definition joins, in registry output order,
 * once all of them are published; outputs kept only for provenance never do.
 */
export function settleResultAttachments(snapshot: LibrarySnapshot | null): void {
  if (!snapshot || pendingAttachments.size === 0) return
  const current = designSessionStore.sessionIdentity.value
  for (const [definitionId, pending] of [...pendingAttachments]) {
    const items = pending.itemIds.map((id) => snapshot.items.find((candidate) => candidate.id === id))
    const settled = items.every((item) => item?.generation_id)
    if (pending.identity !== current || items.some((item) => !item || (item.state === 'Failed' && !item.generation_id))) {
      pendingAttachments.delete(definitionId)
    } else if (settled) {
      pendingAttachments.delete(definitionId)
      for (const item of items) {
        if (item?.provenance && isPresentableOutput(item.provenance.analysis_id, item.provenance.output_key)) {
          upsertLidarEntry('Analysis', item.id)
        }
      }
    }
  }
}

/** Cancel the running job of one derived item; false when nothing runs. */
export async function cancelAnalysisJob(item: { readonly run: AnalysisRunStatus | null }): Promise<boolean> {
  const run = item.run
  if (!run || run.state !== 'Preparing') return false
  await withLidarError(() => lidarCancelAnalysisJob(run.job_id))
  await refreshLidarLibrary()
  return true
}

/** One page of a definition's processing history, newest first. */
export async function fetchProcessingHistory(
  definitionId: string,
  cursor: string | null = null,
): Promise<ProcessingHistoryPage> {
  return lidarProcessingHistory(definitionId, cursor)
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
