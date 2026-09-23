import { open } from '@tauri-apps/plugin-dialog'
import type {
  LidarMeasurementKind,
  LidarPresentationEntryKind,
} from '../../generated/contracts'
import {
  lidarImportSources,
  lidarCancelAnalysisJob,
  lidarCancelImport,
  lidarCreateAnalysis,
  lidarRetryAnalysis,
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
  type LidarLayerCollection,
  type LidarLayerEditOutcome,
  type LidarLayerHistoryPage,
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
  openImportJob,
  refreshOpenImportJob,
  refreshLidarLibrary,
  trackImportJob,
} from './library-store'
import { designSessionStore } from '../document-session/store'
import {
  recordImportAttachmentIntent,
} from './workflow'
import { reconcileInspectionWithPresentation } from './inspection'

/**
 * Leaf action module for the LiDAR workbench: every UI mutation flows
 * through here so panels never orchestrate IPC sequencing themselves.
 */

export async function createLidarLayer(
  name: string,
  kind: 'GroundElevation' | 'SurfaceElevation' | 'AboveGroundHeight' | 'OtherContinuous',
  // An "other continuous" dataset has no inherent unit, so its author declares
  // one here; elevation and height leave this unset and are always metres.
  unit: { label: string | null; unknown: boolean } = { label: null, unknown: false },
): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    const layerId = await lidarCreateLayer(name, kind, unit)
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

/**
 * Let the user choose source files, without creating anything yet.
 *
 * This is Data's primary import entry: cancelling the chooser creates no
 * dataset, no job and no asset, which is why the chooser comes first and the
 * interpretation is confirmed afterwards rather than before.
 */
export async function chooseImportFiles(): Promise<string[] | null> {
  const selection = await open({
    multiple: true,
    title: 'Add TIFF sources',
  })
  if (selection === null) return null
  const paths = Array.isArray(selection) ? selection : [selection]
  return paths.length > 0 ? paths : null
}

/**
 * Import the chosen files into a new Data Layer.
 *
 * The dataset is created first because the interpretation must be explicit and
 * attached before anything is prepared, and the one-step job then prepares,
 * validates and publishes the batch. A failure leaves the empty dataset
 * retryable rather than presenting it as ready. Attachment is deferred to the
 * workflow owner: it happens once on committed success, and only in the Design
 * session that submitted the import.
 */
export async function importSourcesIntoNewLayer(
  paths: string[],
  name: string,
  kind: LidarMeasurementKind,
  unit: { label: string | null; unknown: boolean },
): Promise<void> {
  // Capture the submitting Design before any await, so a replacement during
  // the import cannot receive an attachment the user made in this document.
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    const layerId = await lidarCreateLayer(name, kind, unit)
    await refreshLidarLibrary()
    const jobId = await lidarImportSources(layerId, paths)
    recordImportAttachmentIntent(jobId, layerId, identity)
    await trackImportJob(jobId)
  })
}

/**
 * Import the chosen files into an existing dataset.
 *
 * The dataset already declares how its values are measured, so its
 * interpretation is reused rather than asked for again; the chosen files are
 * what the user is confirming. Attachment uses the same session-fenced intent
 * as a new-dataset import.
 */
export async function importSourcesIntoLayer(
  layerId: string,
  paths: string[],
): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    const jobId = await lidarImportSources(layerId, paths)
    recordImportAttachmentIntent(jobId, layerId, identity)
    await trackImportJob(jobId)
  })
}

export async function cancelOpenImport(): Promise<void> {
  const job = openImportJob.value
  if (job === null) {
    return
  }
  await withLidarError(async () => {
    await lidarCancelImport(job.job_id)
    // Cancellation is a request, not a decision. The observed terminal result
    // owns attachment: a job that already committed still attaches; a genuine
    // Cancelled/Failed consumes the intent without attachment. Discarding the
    // intent here would lose a late Complete.
    await refreshOpenImportJob()
    await refreshLidarLibrary()
  })
}

/**
 * Create a slope analysis for one ground-elevation layer.
 *
 * The unit is the recipe's own parameter, so a degrees and a percent result are
 * distinct definitions with distinct provenance rather than one result relabelled.
 */
export async function analyseLayerAsSlope(
  layerId: string,
  slopeUnit: 'Degrees' | 'Percent' = 'Degrees',
  resultName: string | null = null,
): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    const receipt = await lidarCreateAnalysis(
      layerId,
      'Slope',
      {
        slope_unit: slopeUnit,
        // The name travels with the request; a blank one stays null so an
        // unnamed result is shown by kind rather than given an invented name.
        name: resultName,
      },
      resultName,
    )
    // Remember the job the user actually started, because that is the only
    // handle that can cancel *this* run. The library snapshot reports result
    // state but not job identity, so without this the Cancel action would have
    // nothing to name.
    runningAnalysisJobs.set(receipt.definition_id, receipt.job_id)
    await refreshLidarLibrary()
    if (designSessionStore.sessionIdentity.value === identity) {
      await presentEntity('Analysis', receipt.definition_id)
    }
    ensureLidarPolling()
  })
}

/**
 * Retry one existing analysis definition against its expected source head.
 *
 * The definition identity, parameters and published name are preserved: a
 * retry is a new job for the same definition, not a second definition. A
 * changed source head is refused before work so the previous valid result
 * survives and the caller can re-aim.
 */
export async function retryAnalysis(
  definitionId: string,
  expectedSourceGenerationId: string,
): Promise<void> {
  const identity = designSessionStore.sessionIdentity.value
  await withLidarError(async () => {
    const receipt = await lidarRetryAnalysis(definitionId, expectedSourceGenerationId)
    runningAnalysisJobs.set(receipt.definition_id, receipt.job_id)
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

/** One bounded page of a layer's publication history. */
export async function fetchLayerHistory(
  layerId: string,
  cursor: string | null = null,
): Promise<LidarLayerHistoryPage> {
  return lidarLayerHistory(layerId, cursor)
}

/** One bounded page of a Data Layer's ordered source composition. */
export async function fetchLayerCollection(
  layerId: string,
  cursor: string | null = null,
): Promise<LidarLayerCollection> {
  return lidarLayerCollection(layerId, cursor)
}

/**
 * Run one awaited ordered-layer edit.
 *
 * A source-priority edit is library data, so the Design is never dirtied by it.
 * The backend resolves this call only after the edit has settled, so the
 * library refresh that follows reflects the publication rather than the
 * request; a refusal is surfaced as a message and re-thrown so the caller can
 * re-read the head it actually has.
 */
async function runCollectionEdit(
  work: () => Promise<LidarLayerEditOutcome>,
): Promise<LidarLayerEditOutcome> {
  lidarStatusMessage.value = null
  try {
    const outcome = await work()
    await refreshLidarLibrary()
    ensureLidarPolling()
    if (outcome.message) lidarStatusMessage.value = outcome.message
    return outcome
  } catch (error) {
    lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
    await refreshLidarLibrary()
    throw error
  }
}

export async function moveLayerSource(
  layerId: string,
  memberId: string,
  towardsTop: boolean,
  expectedHead: string | null,
): Promise<LidarLayerEditOutcome> {
  return runCollectionEdit(() => lidarMoveLayerSource(layerId, memberId, towardsTop, expectedHead))
}

export async function removeLayerSource(
  layerId: string,
  memberId: string,
  expectedHead: string | null,
): Promise<LidarLayerEditOutcome> {
  return runCollectionEdit(() => lidarRemoveLayerSource(layerId, memberId, expectedHead))
}

export async function undoLayerChange(
  layerId: string,
  expectedHead: string | null,
): Promise<LidarLayerEditOutcome> {
  return runCollectionEdit(() => lidarUndoLayerChange(layerId, expectedHead))
}

export async function restoreLayerVersion(
  layerId: string,
  versionId: string,
  expectedHead: string | null,
): Promise<LidarLayerEditOutcome> {
  return runCollectionEdit(() => lidarRestoreLayerVersion(layerId, versionId, expectedHead))
}

export function setLidarEntryVisibility(id: string, visible: boolean): void {
  patchLidarEntryById(id, { visible })
  // Hiding the inspected entity ends the mode in the same interaction that hid
  // it, rather than leaving a session pointed at something no longer drawn.
  reconcileInspectionWithPresentation()
}

export function setLidarEntryOpacity(id: string, opacity: number): void {
  patchLidarEntryById(id, { opacity })
}

/**
 * Move one presentation entry earlier or later in the Design's own display
 * order. Order is display-only: it reorders references and never reorders the
 * sources inside a Data Layer, which is numeric priority and lives in the
 * library instead.
 */
export function movePresentationEntry(id: string, direction: 'up' | 'down'): void {
  moveLidarEntry(id, direction)
}

function removePresentedEntities(ids: string[]): void {
  removeLidarEntries(ids)
  // Removing a presented entity removes its reason to be inspected.
  reconcileInspectionWithPresentation()
}

/**
 * Remove one entry from the Design's presentation.
 *
 * This is a document edit, not a library operation: the layer or result stays
 * in the library, the change is undoable with the rest of the Design's history,
 * and it applies to unavailable references too, which is their only remedy.
 * Library deletion remains a separate, confirmed Data action.
 */
export function removePresentationEntry(id: string): void {
  removePresentedEntities([id])
}

/**
 * Run one library action, surfacing its failure through the shared status.
 *
 * The message is published *and* re-thrown. Publishing alone left a caller that
 * renders its own error state with nothing to show — an Analysis run could fail
 * with no visible explanation anywhere — while a caller that only awaited would
 * have seen a resolved promise for a failed action.
 */
async function withLidarError(work: () => Promise<void>): Promise<void> {
  lidarStatusMessage.value = null
  try {
    await work()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    lidarStatusMessage.value = message
    throw error instanceof Error ? error : new Error(message)
  }
}

/**
 * Analysis jobs this session started, by definition.
 *
 * The library snapshot reports each result's state, but cancelling needs the job
 * identity, and only the receipt that created the run carries it. Keeping it here
 * means Cancel names the run the user started rather than guessing at one.
 */
const runningAnalysisJobs = new Map<string, string>()

/** The job id for a definition this session started, if any. */
export function runningAnalysisJobId(definitionId: string): string | null {
  return runningAnalysisJobs.get(definitionId) ?? null
}

/**
 * Cancel the run this session started for one definition.
 *
 * Cancellation is explicit and never implicit: closing or switching panels must
 * leave jobs running, so nothing calls this except the Cancel action itself.
 */
export async function cancelAnalysisJob(definitionId: string): Promise<boolean> {
  const jobId = runningAnalysisJobs.get(definitionId)
  if (!jobId) return false
  await withLidarError(async () => {
    await lidarCancelAnalysisJob(jobId)
    runningAnalysisJobs.delete(definitionId)
    await refreshLidarLibrary()
  })
  return true
}
