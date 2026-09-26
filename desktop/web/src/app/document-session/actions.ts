import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import { computed } from "@preact/signals";
import {
  type DocumentTransitionResult,
  consumeQueuedDocumentLoad,
  createNewDesignSession,
  designContinuousSave,
  openDesignDraftSession,
  openDesignSessionFromDialog,
  openDesignSessionFromPath,
  resolveDesignSaveConflict,
  revertDesignSessionToOpenedVersion,
  saveCurrentDesign,
  saveAsCurrentDesign,
} from "./transition";

interface DocumentLoadOptions {
  session?: CanvasDocumentSurface | null;
  isCancelled?: () => boolean;
}

export {
  consumeQueuedDocumentLoad,
  saveCurrentDesign,
  saveAsCurrentDesign,
};

/** Continuous-save status of the current Design. */
export const designSaveStatus = computed(() => designContinuousSave.status.value);

/** The current Design changed since it was opened or created. */
export const designRevertAvailable = computed(() => designContinuousSave.revertAvailable.value);

/** Retry a failed continuous save now. */
export async function retryDesignSave(): Promise<void> {
  await designContinuousSave.flush();
}

/** Open the dialog that resolves a file changed outside Canopi. */
export async function resolveDesignConflict(): Promise<void> {
  throwIfFailed(await resolveDesignSaveConflict());
}

/** Replace the current Design with the version it had when opened. */
export async function revertDesign(): Promise<void> {
  throwIfFailed(await revertDesignSessionToOpenedVersion());
}

/** Open a Design Draft through the shared replacement path. */
export async function openDesignDraft(id: string): Promise<void> {
  throwIfFailed(await openDesignDraftSession(id));
}

/** Open file dialog and replace the active document through the shared guard. */
export async function openDesign(): Promise<void> {
  const result = await openDesignSessionFromDialog();

  throwIfFailed(result);
}

/** Open a design from a known path (for example, recent files). */
export async function openDesignFromPath(
  path: string,
  options: DocumentLoadOptions = {},
): Promise<void> {
  const result = await openDesignSessionFromPath(path, {
    session: options.session,
    isCancelled: options.isCancelled,
  });

  throwIfFailed(result);
}

/** Create a new blank design through the shared replacement guard. */
export async function newDesignAction(): Promise<void> {
  const result = await createNewDesignSession();

  throwIfFailed(result);
}

function throwIfFailed(result: DocumentTransitionResult | null): void {
  if (result?.status === "failed") {
    throw result.error;
  }
}
