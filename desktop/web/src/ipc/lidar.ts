import { invoke } from '@tauri-apps/api/core'
import type {
  LidarDeleteImpact,
  LidarEngineStatus,
  LidarImportJob,
  LidarImportReceipt,
  LidarAnalysisJobStatus,
  LidarAnalysisReceipt,
  LidarAnalysisKind,
  LidarAnalysisParameters,
  LidarLayerCollection,
  LidarLibrarySnapshot,
  LidarMeasurementKind,
  LidarSampleOutcome,
  LidarSampleRequest,
  LidarDisplayDescriptor,
  LidarDisplayRequest,
} from '../generated/contracts'

export type {
  LidarDisplayAsset,
  LidarDisplayDescriptor,
  LidarDisplayState,
  LidarTileset,
  LidarLayerCollection,
  LidarLayerSource,
  LidarAnalysisSummary,
  LidarLayerSummary,
  LidarDeleteImpact,
  LidarEngineStatus,
  LidarImportJob,
  LidarImportReceipt,
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

/**
 * Import the chosen files as one new fixed library item.
 *
 * The item and its job are created together only on submission; the files'
 * order is the item's source priority. Import never attaches to a Design.
 */
export async function lidarImportItem(
  name: string,
  measurementKind: LidarMeasurementKind,
  unit: { label: string | null; unknown: boolean },
  paths: string[],
): Promise<LidarImportReceipt> {
  return invoke('lidar_import_item', {
    name,
    measurementKind,
    unitLabel: unit.label,
    unitUnknown: unit.unknown,
    paths,
  })
}

/** Retry a failed or cancelled import with its saved selection and identity. */
export async function lidarRetryImport(layerId: string): Promise<LidarImportReceipt> {
  return invoke('lidar_retry_import', { layerId })
}

/** Remove an unpublished item whose import failed or was cancelled. */
export async function lidarDismissImport(layerId: string): Promise<void> {
  return invoke('lidar_dismiss_import', { layerId })
}

export async function lidarRenameLayer(layerId: string, name: string): Promise<void> {
  return invoke('lidar_rename_layer', { layerId, name })
}

export async function lidarRenameAnalysis(definitionId: string, name: string): Promise<void> {
  return invoke('lidar_rename_analysis', { definitionId, name })
}

export async function lidarDeleteLayerImpact(layerId: string): Promise<LidarDeleteImpact> {
  return invoke('lidar_delete_layer_impact', { layerId })
}

/** Refused natively while saved results were calculated from this source. */
export async function lidarDeleteLayer(layerId: string): Promise<void> {
  return invoke('lidar_delete_layer', { layerId })
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

/**
 * Retry one failed analysis operation with its saved definition.
 *
 * The definition identity, parameters and published name are preserved: a
 * retry is a new job for the same definition, not a second definition.
 */
export async function lidarRetryAnalysis(
  definitionId: string,
  expectedSourceGenerationId: string,
): Promise<LidarAnalysisReceipt> {
  return invoke('lidar_retry_analysis', {
    definitionId,
    expectedSourceGenerationId,
  })
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
 * One bounded page of an item's ordered sources, read-only: details show the
 * source files; published items are never edited.
 */
export async function lidarLayerCollection(
  layerId: string,
  cursor: string | null = null,
): Promise<LidarLayerCollection> {
  return invoke('lidar_layer_collection', { layerId, cursor })
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

/**
 * Describe one entity's display derivatives, starting their preparation when
 * missing. The expected generation fences the answer: a head that moved since
 * the caller aimed returns `Stale`, never newer data under the old identity.
 */
export async function lidarDisplayDescriptor(
  request: LidarDisplayRequest,
): Promise<LidarDisplayDescriptor> {
  return invoke('lidar_display_descriptor', { request })
}
