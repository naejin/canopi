import { open } from '@tauri-apps/plugin-dialog'
import type { LidarPresentationEntryKind } from '../../generated/contracts'
import {
  lidarApplyImport,
  lidarCancelImport,
  lidarCreateAnalysis,
  lidarCreateLayer,
  lidarDeleteAnalysis,
  lidarDeleteLayer,
  lidarDeleteLayerImpact,
  lidarRenameLayer,
  lidarLayerCollection,
  lidarLayerHistory,
  lidarMoveLayerSource,
  lidarRemoveLayerSource,
  lidarRestoreLayerVersion,
  lidarUndoLayerChange,
  lidarPreviewImportDecision,
  lidarStageImport,
  type LidarGenerationHistoryEntry,
  type LidarImportDecisionPreview,
  type LidarLayerCollection,
} from '../../ipc/lidar'
import { patchLidarEntryById, removeLidarEntries, upsertLidarEntry } from '../design-edit/lidar'
import {
  ensureLidarPolling,
  lidarStatusMessage,
  openImportJob,
  refreshOpenImportJob,
  refreshLidarLibrary,
  trackImportJob,
} from './library-store'
import { designSessionStore } from '../document-session/store'

/**
 * Leaf action module for the LiDAR workbench: every UI mutation flows
 * through here so panels never orchestrate IPC sequencing themselves.
 */

export async function createLidarLayer(
  name: string,
  kind: 'GroundElevation' | 'SurfaceElevation' | 'AboveGroundHeight' | 'OtherContinuous',
): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    const layerId = await lidarCreateLayer(name, kind)
    await refreshLidarLibrary()
    if (designSessionStore.sessionIdentity.value === identity) presentEntity('Source', layerId)
  })
}

export async function renameLidarLayer(layerId: string, name: string): Promise<void> {
  await withLidarError(async () => {
    await lidarRenameLayer(layerId, name)
    await refreshLidarLibrary()
  })
}

export async function presentEntity(
  kind: LidarPresentationEntryKind,
  entityId: string,
): Promise<void> {
  upsertLidarEntry(kind, entityId)
}

export async function startImportForLayer(layerId: string): Promise<void> {
  await withLidarError(async () => {
    const selection = await open({
      multiple: true,
      title: 'Add TIFF sources',
    })
    if (selection === null) return
    const paths = Array.isArray(selection) ? selection : [selection]
    if (paths.length === 0) return
    const jobId = await lidarStageImport(layerId, paths)
    await trackImportJob(jobId)
  })
}

export async function applyOpenImport(
  addUncovered: boolean,
  replaceOverlap: boolean,
): Promise<void> {
  const job = openImportJob.value
  if (job === null) {
    return
  }
  await withLidarError(async () => {
    await lidarApplyImport(job.job_id, addUncovered, replaceOverlap)
    await refreshOpenImportJob()
    ensureLidarPolling()
  })
}

export async function previewOpenImportDecision(
  addUncovered: boolean,
  replaceOverlap: boolean,
): Promise<LidarImportDecisionPreview> {
  const job = openImportJob.value
  if (job === null) {
    throw new Error('Import review is no longer open')
  }
  lidarStatusMessage.value = null
  try {
    return await lidarPreviewImportDecision(job.job_id, addUncovered, replaceOverlap)
  } catch (error) {
    lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
    throw error
  }
}

export async function cancelOpenImport(): Promise<void> {
  const job = openImportJob.value
  if (job === null) {
    return
  }
  await withLidarError(async () => {
    await lidarCancelImport(job.job_id)
    await refreshOpenImportJob()
    await refreshLidarLibrary()
  })
}

export async function analyseLayerAsSlope(layerId: string): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    const receipt = await lidarCreateAnalysis(layerId, 'Slope', {
      slope_unit: 'Degrees',
    })
    await refreshLidarLibrary()
    if (designSessionStore.sessionIdentity.value === identity) {
      await presentEntity('Analysis', receipt.definition_id)
    }
    ensureLidarPolling()
  })
}

export async function fetchLidarLayerDeleteImpact(layerId: string) {
  return lidarDeleteLayerImpact(layerId)
}

export async function deleteLidarLayer(layerId: string, analysisIds: string[]): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    await lidarDeleteLayer(layerId)
    await refreshLidarLibrary()
    if (designSessionStore.sessionIdentity.value === identity) {
      removePresentedEntities([layerId, ...analysisIds])
    }
  })
}

export async function deleteLidarAnalysis(definitionId: string): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    await lidarDeleteAnalysis(definitionId)
    await refreshLidarLibrary()
    if (designSessionStore.sessionIdentity.value === identity) {
      removePresentedEntities([definitionId])
    }
  })
}

export async function fetchLayerHistory(
  layerId: string,
): Promise<LidarGenerationHistoryEntry[]> {
  return lidarLayerHistory(layerId)
}

/** The ordered sources and published versions of one Data Layer. */
export async function fetchLayerCollection(layerId: string): Promise<LidarLayerCollection> {
  return lidarLayerCollection(layerId)
}

/**
 * A source-priority edit is library data, so the Design is never dirtied by it.
 * The refresh follows the settlement the backend reports rather than the
 * acknowledgement of the request, and the open collection view is re-read from
 * the same head so a late answer cannot replace a newer list.
 */
async function runCollectionEdit(work: () => Promise<void>): Promise<void> {
  await withLidarError(async () => {
    await work()
    ensureLidarPolling()
    await refreshLidarLibrary()
  })
}

export async function moveLayerSource(
  layerId: string,
  memberId: string,
  towardsTop: boolean,
  expectedHead: string | null,
): Promise<void> {
  await runCollectionEdit(() => lidarMoveLayerSource(layerId, memberId, towardsTop, expectedHead))
}

export async function removeLayerSource(
  layerId: string,
  memberId: string,
  expectedHead: string | null,
): Promise<void> {
  await runCollectionEdit(() => lidarRemoveLayerSource(layerId, memberId, expectedHead))
}

export async function undoLayerChange(
  layerId: string,
  expectedHead: string | null,
): Promise<void> {
  await runCollectionEdit(() => lidarUndoLayerChange(layerId, expectedHead))
}

export async function restoreLayerVersion(
  layerId: string,
  versionId: string,
  expectedHead: string | null,
): Promise<void> {
  await runCollectionEdit(() => lidarRestoreLayerVersion(layerId, versionId, expectedHead))
}

export function setLidarEntryVisibility(id: string, visible: boolean): void {
  patchLidarEntryById(id, { visible })
}

export function setLidarEntryOpacity(id: string, opacity: number): void {
  patchLidarEntryById(id, { opacity })
}

function removePresentedEntities(ids: string[]): void {
  removeLidarEntries(ids)
}

async function withLidarError(work: () => Promise<void>): Promise<void> {
  lidarStatusMessage.value = null
  try {
    await work()
  } catch (error) {
    lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
  }
}
