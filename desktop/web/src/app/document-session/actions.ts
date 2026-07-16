import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import type { DesignTemplateEnvelope } from "../design-template-import/types";
import {
  type DocumentTransitionResult,
  consumeQueuedDocumentLoad,
  createNewDesignSession,
  openDesignSessionFromDialog,
  openDesignSessionFromPath,
  openTemplateDesignSession,
  saveCurrentDesign,
  saveAsCurrentDesign,
} from "./transition";

interface DocumentLoadOptions {
  session?: CanvasDocumentSurface | null;
  isCancelled?: () => boolean;
}

export type TemplateOpenResult = "opened" | "queued" | "cancelled";

export {
  consumeQueuedDocumentLoad,
  saveCurrentDesign,
  saveAsCurrentDesign,
};

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

/** Open a decoded template as a new unsaved design through the shared guard. */
export async function openDesignAsTemplate(
  envelope: DesignTemplateEnvelope,
  options: DocumentLoadOptions = {},
): Promise<TemplateOpenResult> {
  const result = await openTemplateDesignSession(envelope, {
    session: options.session,
    isCancelled: options.isCancelled,
  });

  throwIfFailed(result);
  if (result.status === "queued") return "queued";
  return result.status === "applied" ? "opened" : "cancelled";
}

/** Create a new blank design through the shared replacement guard. */
export async function newDesignAction(): Promise<void> {
  const result = await createNewDesignSession();

  throwIfFailed(result);
}

function throwIfFailed(result: DocumentTransitionResult): void {
  if (result.status === "failed") {
    throw result.error;
  }
}
