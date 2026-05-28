import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import * as designIpc from "../../ipc/design";
import { pendingDesignPath, pendingTemplateImport } from "../../state/design";
import {
  transitionDocument,
  type DocumentTransitionResult,
  consumeQueuedDocumentLoad,
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
  const result = await transitionDocument({
    source: "open-dialog",
    dirtyGuard: "confirm",
    load: async () => {
      const { file, path } = await designIpc.openDesignDialog();
      return { file, path, name: file.name };
    },
  });

  throwIfFailed(result);
}

/** Open a design from a known path (for example, recent files). */
export async function openDesignFromPath(
  path: string,
  options: DocumentLoadOptions = {},
): Promise<void> {
  const result = await transitionDocument({
    source: "open-path",
    dirtyGuard: "confirm",
    session: options.session,
    load: async () => {
      const file = await designIpc.loadDesign(path);
      return { file, path, name: file.name };
    },
    isCancelled: options.isCancelled,
    deferWhenDetachedAndEmpty: () => {
      pendingDesignPath.value = path;
    },
  });

  throwIfFailed(result);
}

/** Open a downloaded template as a new unsaved design through the shared guard. */
export async function openDesignAsTemplate(
  path: string,
  name: string,
  options: DocumentLoadOptions = {},
): Promise<TemplateOpenResult> {
  const result = await transitionDocument({
    source: "template",
    dirtyGuard: "confirm",
    session: options.session,
    load: async () => ({
      file: await designIpc.loadDesign(path),
      path: null,
      name,
    }),
    isCancelled: options.isCancelled,
    deferWhenDetachedAndEmpty: () => {
      pendingTemplateImport.value = { path, name };
    },
  });

  throwIfFailed(result);
  if (result.status === "queued") return "queued";
  return result.status === "applied" ? "opened" : "cancelled";
}

/** Create a new blank design through the shared replacement guard. */
export async function newDesignAction(): Promise<void> {
  const result = await transitionDocument({
    source: "new",
    dirtyGuard: "confirm",
    load: async () => ({
      file: await designIpc.newDesign(),
      path: null,
      name: "Untitled",
    }),
  });

  throwIfFailed(result);
}

function throwIfFailed(result: DocumentTransitionResult): void {
  if (result.status === "failed") {
    throw result.error;
  }
}
