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
  lidarGetImportJob,
  lidarRenameLayer,
  lidarLayerHistory,
  lidarStageImport,
  lidarUndoImport,
  type LidarGenerationHistoryEntry,
  type LidarImportJob,
} from '../../ipc/lidar'
import { patchLidarEntryById, removeLidarEntries, upsertLidarEntry } from '../design-edit/lidar'
import {
  ensureLidarPolling,
  openImportJob,
  refreshLidarLibrary,
} from './library-store'

/**
 * Leaf action module for the LiDAR workbench: every UI mutation flows
 * through here so panels never orchestrate IPC sequencing themselves.
 */

export async function createLidarLayer(
  name: string,
  kind: 'GroundElevation' | 'SurfaceElevation' | 'AboveGroundHeight' | 'OtherContinuous',
): Promise<void> {
  const layerId = await lidarCreateLayer(name, kind)
  await refreshLidarLibrary()
  presentEntity('Source', layerId)
}

export async function renameLidarLayer(layerId: string, name: string): Promise<void> {
  await lidarRenameLayer(layerId, name)
  await refreshLidarLibrary()
}

export async function presentEntity(
  kind: LidarPresentationEntryKind,
  entityId: string,
): Promise<void> {
  upsertLidarEntry(kind, entityId)
}

export async function startImportForLayer(layerId: string): Promise<void> {
  const selection = await open({
    multiple: true,
    title: 'Add TIFF sources',
  })
  if (selection === null) {
    return
  }
  const paths = Array.isArray(selection) ? selection : [selection]
  if (paths.length === 0) {
    return
  }
  const jobId = await lidarStageImport(layerId, paths)
  await pollImportJob(jobId)
}

async function pollImportJob(jobId: string): Promise<void> {
  ensureLidarPolling()
  // The staging job settles within seconds at fixture scale; poll until the
  // review is ready, the job fails, or the user gave up on this dialog.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job: LidarImportJob | null = await lidarGetImportJob(jobId)
    if (job === null) {
      return
    }
    openImportJob.value = job
    if (job.state === 'AwaitingReview' || job.state === 'Failed' || job.state === 'Cancelled') {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

export async function applyOpenImport(
  addUncovered: boolean,
  replaceOverlap: boolean,
): Promise<void> {
  const job = openImportJob.value
  if (job === null) {
    return
  }
  await lidarApplyImport(job.job_id, addUncovered, replaceOverlap)
  openImportJob.value = null
  ensureLidarPolling()
  await refreshLidarLibrary()
}

export async function cancelOpenImport(): Promise<void> {
  const job = openImportJob.value
  if (job === null) {
    return
  }
  await lidarCancelImport(job.job_id)
  openImportJob.value = null
  await refreshLidarLibrary()
}

export async function analyseLayerAsSlope(layerId: string): Promise<void> {
  const receipt = await lidarCreateAnalysis(layerId, 'Slope', {
    slope_unit: 'Degrees',
  })
  await refreshLidarLibrary()
  await presentEntity('Analysis', receipt.definition_id)
  ensureLidarPolling()
}

export async function deleteLidarLayer(layerId: string): Promise<void> {
  const impact = await lidarDeleteLayerImpact(layerId)
  // The impact summary gates the deletion: analysis layers and saved Design
  // references are removed together with the source layer.
  await lidarDeleteLayer(layerId)
  await refreshLidarLibrary()
  const ids = [layerId, ...impact.analysis_ids]
  removePresentedEntities(ids)
}

export async function deleteLidarAnalysis(definitionId: string): Promise<void> {
  await lidarDeleteAnalysis(definitionId)
  await refreshLidarLibrary()
  removePresentedEntities([definitionId])
}

export async function fetchLayerHistory(
  layerId: string,
): Promise<LidarGenerationHistoryEntry[]> {
  return lidarLayerHistory(layerId)
}

/** Undo one accepted import; republishes the layer without it. */
export async function undoAcceptedImport(jobId: string): Promise<void> {
  await lidarUndoImport(jobId)
  ensureLidarPolling()
  await refreshLidarLibrary()
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
