import { invoke } from '@tauri-apps/api/core'
import type {
  LidarDeleteImpact,
  LidarEngineStatus,
  LidarImportJob,
  LidarAnalysisJobStatus,
  LidarAnalysisReceipt,
  LidarAnalysisKind,
  LidarAnalysisParameters,
  LidarLayerCollection,
  LidarLayerEditOutcome,
  LidarLayerHistoryPage,
  LidarLibrarySnapshot,
  LidarMeasurementKind,
  LidarSampleOutcome,
  LidarSampleRequest,
} from '../generated/contracts'

export type {
  LidarTileset,
  LidarGenerationHistoryEntry,
  LidarLayerCollection,
  LidarLayerEditOutcome,
  LidarLayerHistoryPage,
  LidarLayerSource,
  LidarAnalysisSummary,
  LidarLayerSummary,
  LidarDeleteImpact,
  LidarEngineStatus,
  LidarImportJob,
  LidarAnalysisJobStatus,
  LidarAnalysisReceipt,
  LidarAnalysisKind,
  LidarAnalysisParameters,
  LidarLibrarySnapshot,
  LidarMeasurementKind,
} from '../generated/contracts'

export async function lidarEngineStatus(): Promise<LidarEngineStatus> {
  return invoke('lidar_engine_status')
}

export async function lidarListLibrary(): Promise<LidarLibrarySnapshot> {
  return invoke('lidar_list_library')
}

export async function lidarCreateLayer(
  name: string,
  measurementKind: LidarMeasurementKind,
  unit: { label: string | null; unknown: boolean } = { label: null, unknown: false },
): Promise<string> {
  return invoke('lidar_create_layer', {
    name,
    measurementKind,
    unitLabel: unit.label,
    unitUnknown: unit.unknown,
  })
}

export async function lidarRenameLayer(layerId: string, name: string): Promise<void> {
  return invoke('lidar_rename_layer', { layerId, name })
}

export async function lidarDeleteLayerImpact(layerId: string): Promise<LidarDeleteImpact> {
  return invoke('lidar_delete_layer_impact', { layerId })
}

export async function lidarDeleteLayer(layerId: string): Promise<void> {
  return invoke('lidar_delete_layer', { layerId })
}

/**
 * Import selected sources into one Data Layer, in a single job.
 *
 * The Import action is the commit intent: the native side prepares and
 * validates every occurrence and publishes the batch atomically, reporting
 * progress, cancellation and the terminal outcome through the job. There is no
 * review screen to poll and no second decision to apply.
 */
export async function lidarImportSources(layerId: string, paths: string[]): Promise<string> {
  return invoke('lidar_import_sources', { layerId, paths })
}

export async function lidarGetImportJob(jobId: string): Promise<LidarImportJob | null> {
  return invoke('lidar_get_import_job', { jobId })
}

export async function lidarCancelImport(jobId: string): Promise<void> {
  return invoke('lidar_cancel_import', { jobId })
}

export async function lidarCreateAnalysis(
  layerId: string,
  kind: LidarAnalysisKind,
  parameters: LidarAnalysisParameters,
  resultName: string | null = null,
): Promise<LidarAnalysisReceipt> {
  return invoke('lidar_create_analysis', { layerId, kind, parameters, resultName })
}

export async function lidarGetAnalysisJobStatus(
  jobId: string,
): Promise<LidarAnalysisJobStatus | null> {
  return invoke('lidar_get_analysis_job_status', { jobId })
}

export async function lidarCancelAnalysisJob(jobId: string): Promise<void> {
  return invoke('lidar_cancel_analysis_job', { jobId })
}

export async function lidarDeleteAnalysis(definitionId: string): Promise<void> {
  return invoke('lidar_delete_analysis', { definitionId })
}

/**
 * One bounded page of a Data Layer's ordered source composition.
 *
 * `cursor` binds the page to the snapshot it was requested from; a late page of
 * a superseded head is refused rather than mixed into a newer list.
 */
export async function lidarLayerCollection(
  layerId: string,
  cursor: string | null = null,
): Promise<LidarLayerCollection> {
  return invoke('lidar_layer_collection', { layerId, cursor })
}

/** One bounded page of a Data Layer's publication history, newest first. */
export async function lidarLayerHistory(
  layerId: string,
  cursor: string | null = null,
): Promise<LidarLayerHistoryPage> {
  return invoke('lidar_layer_history', { layerId, cursor })
}

/**
 * Move one source one position in the layer's priority list.
 *
 * `expectedHead` is the snapshot the caller saw: a stale edit fails by name
 * instead of being applied to a newer order. The call resolves after the edit
 * has actually settled.
 */
export async function lidarMoveLayerSource(
  layerId: string,
  memberId: string,
  towardsTop: boolean,
  expectedHead: string | null,
): Promise<LidarLayerEditOutcome> {
  return invoke('lidar_move_layer_source', { layerId, memberId, towardsTop, expectedHead })
}

/** Detach one source from the layer's current composition. */
export async function lidarRemoveLayerSource(
  layerId: string,
  memberId: string,
  expectedHead: string | null,
): Promise<LidarLayerEditOutcome> {
  return invoke('lidar_remove_layer_source', { layerId, memberId, expectedHead })
}

/** Undo the layer's last change by publishing the preceding snapshot. */
export async function lidarUndoLayerChange(
  layerId: string,
  expectedHead: string | null,
): Promise<LidarLayerEditOutcome> {
  return invoke('lidar_undo_layer_change', { layerId, expectedHead })
}

/** Publish one older version as the layer's new head. */
export async function lidarRestoreLayerVersion(
  layerId: string,
  versionId: string,
  expectedHead: string | null,
): Promise<LidarLayerEditOutcome> {
  return invoke('lidar_restore_layer_version', { layerId, versionId, expectedHead })
}

/**
 * One bounded numeric inspection lookup.
 *
 * The request carries the generation the caller believes is current, so a head
 * that moved since the user aimed is refused as stale rather than answered from
 * different bytes.
 */
export async function lidarSamplePixel(
  request: LidarSampleRequest,
): Promise<LidarSampleOutcome> {
  return invoke('lidar_sample_pixel', { request })
}

/**
 * Stop one inspection lookup.
 *
 * The request id is the one the sample request carried, so this cancels exactly
 * the lookup that asked for it and nothing else: a superseded pan, a hidden
 * layer or an exited session must not leave bounded native work running.
 */
export async function lidarCancelSamplePixel(requestId: string): Promise<void> {
  if (!requestId) return
  await invoke('lidar_cancel_sample_pixel', { requestId })
}
