import { invoke } from '@tauri-apps/api/core'
import type {
  LidarDeleteImpact,
  LidarGenerationHistoryEntry,
  LidarEngineStatus,
  LidarImportJob,
  LidarAnalysisJobStatus,
  LidarAnalysisReceipt,
  LidarAnalysisKind,
  LidarAnalysisParameters,
  LidarLayerCollection,
  LidarLibrarySnapshot,
  LidarMeasurementKind,
} from '../generated/contracts'

export type {
  LidarTileset,
  LidarGenerationHistoryEntry,
  LidarLayerCollection,
  LidarLayerSource,
  LidarAnalysisSummary,
  LidarLayerSummary,
  LidarDeleteImpact,
  LidarEngineStatus,
  LidarImportJob,
  LidarImportDecisionPreview,
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
): Promise<string> {
  return invoke('lidar_create_layer', { name, measurementKind })
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

export async function lidarStageImport(layerId: string, paths: string[]): Promise<string> {
  return invoke('lidar_stage_import', { layerId, paths })
}

export async function lidarGetImportJob(jobId: string): Promise<LidarImportJob | null> {
  return invoke('lidar_get_import_job', { jobId })
}

export async function lidarApplyImport(
  jobId: string,
  addUncovered: boolean,
  replaceOverlap: boolean,
): Promise<void> {
  return invoke('lidar_apply_import', { jobId, addUncovered, replaceOverlap })
}

export async function lidarCancelImport(jobId: string): Promise<void> {
  return invoke('lidar_cancel_import', { jobId })
}

export async function lidarCreateAnalysis(
  layerId: string,
  kind: LidarAnalysisKind,
  parameters: LidarAnalysisParameters,
): Promise<LidarAnalysisReceipt> {
  return invoke('lidar_create_analysis', { layerId, kind, parameters })
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

export async function lidarLayerHistory(
  layerId: string,
): Promise<LidarGenerationHistoryEntry[]> {
  return invoke('lidar_layer_history', { layerId })
}

/** The ordered sources and published versions of one Data Layer. */
export async function lidarLayerCollection(layerId: string): Promise<LidarLayerCollection> {
  return invoke('lidar_layer_collection', { layerId })
}

/**
 * Move one source one position in the layer's priority list.
 *
 * `expectedHead` is the snapshot the caller saw: a stale edit fails by name
 * instead of being applied to a newer order.
 */
export async function lidarMoveLayerSource(
  layerId: string,
  memberId: string,
  towardsTop: boolean,
  expectedHead: string | null,
): Promise<void> {
  return invoke('lidar_move_layer_source', { layerId, memberId, towardsTop, expectedHead })
}

/** Detach one source from the layer's current composition. */
export async function lidarRemoveLayerSource(
  layerId: string,
  memberId: string,
  expectedHead: string | null,
): Promise<void> {
  return invoke('lidar_remove_layer_source', { layerId, memberId, expectedHead })
}

/** Undo the layer's last change by publishing the preceding snapshot. */
export async function lidarUndoLayerChange(
  layerId: string,
  expectedHead: string | null,
): Promise<void> {
  return invoke('lidar_undo_layer_change', { layerId, expectedHead })
}

/** Publish one older version as the layer's new head. */
export async function lidarRestoreLayerVersion(
  layerId: string,
  versionId: string,
  expectedHead: string | null,
): Promise<void> {
  return invoke('lidar_restore_layer_version', { layerId, versionId, expectedHead })
}
