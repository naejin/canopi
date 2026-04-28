import { message } from "@tauri-apps/plugin-dialog";
import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import { getCurrentCanvasDocumentSurface } from "../../canvas/session";
import { normalizeLoadedDocument, normalizeNewDocument } from "../contracts/document";
import * as designIpc from "../../ipc/design";
import { t } from "../../i18n";
import type { CanopiFile } from "../../types/design";
import {
  currentDesign,
  designDirty,
  designName,
  designPath,
  pendingDesignPath,
  pendingTemplateImport,
  markSaved,
  replaceCurrentDesignState,
  resetDirtyBaselines,
} from "../../state/design";
import { buildPersistedDocumentContent } from "./runtime";
import { installConsortiumSync } from "./workflows";

export type DocumentTransitionSource =
  | "new"
  | "open-path"
  | "open-dialog"
  | "template"
  | "queued-path"
  | "queued-template"
  | "mount-existing";

export type DirtyGuardMode = "confirm" | "skip";

export interface DocumentTransitionLoadResult {
  file: CanopiFile;
  path: string | null;
  name: string;
}

export interface DocumentTransitionRequest {
  source: DocumentTransitionSource;
  dirtyGuard: DirtyGuardMode;
  session: CanvasDocumentSurface;
  load: () => Promise<DocumentTransitionLoadResult>;
  isCancelled?: () => boolean;
}

export type DocumentTransitionStatus = "applied" | "cancelled" | "queued" | "failed";

export interface DocumentTransitionResult {
  status: DocumentTransitionStatus;
  documentLoaded: boolean;
  error?: unknown;
}

interface SaveCurrentDesignOptions {
  session?: CanvasDocumentSurface | null;
}

interface QueuedDocumentLoadOptions {
  onResult?: (result: DocumentTransitionResult) => void;
}

type ReplacementDecision = "proceed" | "cancel";

export async function saveCurrentDesign(options: SaveCurrentDesignOptions = {}): Promise<void> {
  const session = options.session ?? getCurrentCanvasDocumentSurface();
  const content = buildPersistedDocumentContent(session, designName.value);

  if (designPath.value) {
    await designIpc.saveDesign(designPath.value, content);
    replaceCurrentDesignState(content, designPath.value, designName.value);
  } else {
    const path = await designIpc.saveDesignAs(content);
    replaceCurrentDesignState(content, path, nameFromPath(path));
  }

  markSaved(session);
}

export async function saveAsCurrentDesign(options: SaveCurrentDesignOptions = {}): Promise<void> {
  const session = options.session ?? getCurrentCanvasDocumentSurface();
  const content = buildPersistedDocumentContent(session, designName.value);

  try {
    const path = await designIpc.saveDesignAs(content);
    replaceCurrentDesignState(content, path, nameFromPath(path));
    markSaved(session);
  } catch (error) {
    if (isCancelled(error)) return;
    throw error;
  }
}

export async function transitionDocument(
  request: DocumentTransitionRequest,
): Promise<DocumentTransitionResult> {
  try {
    if (request.dirtyGuard === "confirm") {
      const decision = await confirmReplacement(request.session);
      if (decision === "cancel") {
        return cancelledResult(request.session);
      }
    }

    const loaded = await request.load();
    if (request.isCancelled?.()) {
      return cancelledResult(request.session);
    }

    const file = normalizeDocumentForSource(request.source, loaded.file);
    applyDocumentTransition({
      source: request.source,
      session: request.session,
      file,
      path: loaded.path,
      name: loaded.name,
    });

    return {
      status: "applied",
      documentLoaded: request.session.hasLoadedDocument(),
    };
  } catch (error) {
    if (isCancelled(error)) {
      return cancelledResult(request.session);
    }
    return {
      status: "failed",
      documentLoaded: request.session.hasLoadedDocument(),
      error,
    };
  }
}

export function beginEmptyDocumentSession(session: CanvasDocumentSurface): void {
  installConsortiumSync();
  session.hideCanvasChrome();
}

export function consumeQueuedDocumentLoad(
  session: CanvasDocumentSurface,
  options: QueuedDocumentLoadOptions = {},
): () => void {
  const queuedTemplate = pendingTemplateImport.value;
  if (queuedTemplate) {
    return startQueuedDocumentLoad({
      session,
      options,
      source: "queued-template",
      label: queuedTemplate.name,
      load: async () => ({
        file: await designIpc.loadDesign(queuedTemplate.path),
        path: null,
        name: queuedTemplate.name,
      }),
      isStillPending: () => pendingTemplateImport.value?.path === queuedTemplate.path,
      clearPending: () => {
        if (pendingTemplateImport.value?.path === queuedTemplate.path) {
          pendingTemplateImport.value = null;
        }
      },
      restorePending: () => {
        pendingTemplateImport.value = queuedTemplate;
      },
    });
  }

  const queuedPath = pendingDesignPath.value;
  if (!queuedPath) return () => {};

  return startQueuedDocumentLoad({
    session,
    options,
    source: "queued-path",
    label: nameFromPath(queuedPath),
    load: async () => {
      const file = await designIpc.loadDesign(queuedPath);
      return {
        file,
        path: queuedPath,
        name: file.name,
      };
    },
    isStillPending: () => pendingDesignPath.value === queuedPath,
    clearPending: () => {
      if (pendingDesignPath.value === queuedPath) {
        pendingDesignPath.value = null;
      }
    },
    restorePending: () => {
      pendingDesignPath.value = queuedPath;
    },
  });
}

interface ApplyDocumentTransitionOptions {
  source: DocumentTransitionSource;
  session: CanvasDocumentSurface;
  file: CanopiFile;
  path: string | null;
  name: string;
}

function applyDocumentTransition({
  source,
  session,
  file,
  path,
  name,
}: ApplyDocumentTransitionOptions): void {
  if (source === "mount-existing") {
    session.loadDocument(file);
  } else {
    session.replaceDocument(file);
    replaceCurrentDesignState(file, path, name);
    resetDirtyBaselines();
  }

  session.clearHistory();
  session.showCanvasChrome();
  session.zoomToFit();
  installConsortiumSync();
}

interface QueuedDocumentLoadRequest {
  session: CanvasDocumentSurface;
  options: QueuedDocumentLoadOptions;
  source: "queued-path" | "queued-template";
  label: string;
  load: () => Promise<DocumentTransitionLoadResult>;
  isStillPending: () => boolean;
  clearPending: () => void;
  restorePending: () => void;
}

function startQueuedDocumentLoad({
  session,
  options,
  source,
  label,
  load,
  isStillPending,
  clearPending,
  restorePending,
}: QueuedDocumentLoadRequest): () => void {
  let cancelled = false;

  void transitionDocument({
    source,
    dirtyGuard: "skip",
    session,
    load,
    isCancelled: () => cancelled,
  }).then((result) => {
    options.onResult?.(result);
    if (cancelled) return;
    if (result.status === "applied") {
      if (isStillPending()) clearPending();
      return;
    }
    if (result.status === "failed") {
      restorePending();
      console.error("Queued document load failed:", result.error);
      void message(`Failed to open ${label}.\n\n${formatError(result.error)}`, {
        title: "Open failed",
        kind: "error",
      });
    }
  });

  return () => {
    cancelled = true;
  };
}

async function confirmReplacement(session: CanvasDocumentSurface): Promise<ReplacementDecision> {
  if (!currentDesign.value) return "proceed";
  if (!designDirty.value) return "proceed";

  const saveLabel = t("canvas.file.save");
  const discardLabel = t("canvas.file.dontSave");
  const cancelLabel = t("canvas.file.cancel");

  const result = await message(t("canvas.file.unsavedChanges"), {
    title: t("canvas.file.unsavedChanges"),
    kind: "warning",
    buttons: {
      yes: saveLabel,
      no: discardLabel,
      cancel: cancelLabel,
    },
  });

  if (result === cancelLabel) return "cancel";
  if (result === saveLabel) {
    try {
      await saveCurrentDesign({ session });
    } catch (error) {
      if (isCancelled(error)) return "cancel";
      throw error;
    }
  }

  return "proceed";
}

function normalizeDocumentForSource(
  source: DocumentTransitionSource,
  file: CanopiFile,
): CanopiFile {
  if (source === "new") return normalizeNewDocument(file);
  if (source === "mount-existing") return file;
  return normalizeLoadedDocument(file);
}

function cancelledResult(session: CanvasDocumentSurface): DocumentTransitionResult {
  return {
    status: "cancelled",
    documentLoaded: session.hasLoadedDocument(),
  };
}

export function nameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.canopi$/i, "") || "Untitled";
}

export function isCancelled(error: unknown): boolean {
  return typeof error === "string"
    ? error.includes("Dialog cancelled") || error.includes("cancelled")
    : error instanceof Error
      ? error.message.includes("cancelled")
      : false;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
