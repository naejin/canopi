import { invoke } from '@tauri-apps/api/core'
import type {
  AnalysisReceipt,
  AnalysisRequest,
  LibraryDeleteImpact,
  LibrarySnapshot,
  LidarDisplayDescriptor,
  LidarDisplayRequest,
  LidarImportReceipt,
  LidarLayerCollection,
  LidarSampleOutcome,
  LidarSampleRequest,
  ProcessingHistoryPage,
  RasterQuantity,
} from '../generated/contracts'

export type {
  AnalysisReceipt,
  LibraryDeleteImpact,
  LidarDisplayDescriptor,
  LidarImportReceipt,
  LidarLayerCollection,
  ProcessingHistoryPage,
} from '../generated/contracts'

export async function lidarListLibrary(): Promise<LibrarySnapshot> {
  return invoke('lidar_list_library')
}

/**
 * Import the chosen files as one new fixed library item.
 *
 * The item and its job are created together only on submission; the files'
 * order is the item's source priority. Import never attaches to a Design.
 * Only importable quantities are accepted; derived ones are refused by name.
 */
export async function lidarImportItem(
  name: string,
  quantity: RasterQuantity,
  unit: { label: string | null; unknown: boolean },
  paths: string[],
): Promise<LidarImportReceipt> {
  return invoke('lidar_import_item', {
    name,
    quantity,
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

/** Rename one library item, source or derived. */
export async function lidarRenameItem(itemId: string, name: string): Promise<void> {
  return invoke('lidar_rename_item', { itemId, name })
}

export async function lidarDeleteImpact(itemId: string): Promise<LibraryDeleteImpact> {
  return invoke('lidar_delete_impact', { itemId })
}

/** Refused natively while other derived items use this item as an input. */
export async function lidarDeleteItem(itemId: string): Promise<void> {
  return invoke('lidar_delete_item', { itemId })
}

export async function lidarCancelImport(jobId: string): Promise<void> {
  return invoke('lidar_cancel_import', { jobId })
}

/** Create one analysis definition from a registry entry and start its first run. */
export async function lidarCreateAnalysis(request: AnalysisRequest): Promise<AnalysisReceipt> {
  return invoke('lidar_create_analysis', { request })
}

/**
 * Run one definition again with its saved inputs and parameters.
 *
 * Retry when it has no result yet; Refresh when it has one, which republishes
 * in place under the same item ids while the earlier run stays in history.
 */
export async function lidarRerunAnalysis(definitionId: string): Promise<AnalysisReceipt> {
  return invoke('lidar_rerun_analysis', { definitionId })
}

export async function lidarCancelAnalysisJob(jobId: string): Promise<void> {
  return invoke('lidar_cancel_analysis_job', { jobId })
}

/** One bounded page of a definition's runs, newest first. */
export async function lidarProcessingHistory(
  definitionId: string,
  cursor: string | null = null,
): Promise<ProcessingHistoryPage> {
  return invoke('lidar_processing_history', { definitionId, cursor })
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
