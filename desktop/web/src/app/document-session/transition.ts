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
import { buildPersistedDesignSessionContent } from "./persistence";
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
  session?: CanvasDocumentSurface | null;
  load: () => Promise<DocumentTransitionLoadResult>;
  isCancelled?: () => boolean;
  deferWhenDetachedAndEmpty?: () => void;
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
  const session = sessionForOption(options.session);
  const content = buildPersistedDesignSessionContent({
    session,
    name: designName.value,
  });

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
  const session = sessionForOption(options.session);
  const content = buildPersistedDesignSessionContent({
    session,
    name: designName.value,
  });

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
  const session = sessionForTransition(request);
  try {
    if (!session && !currentDesign.value && request.deferWhenDetachedAndEmpty) {
      request.deferWhenDetachedAndEmpty();
      return {
        status: "queued",
        documentLoaded: false,
      };
    }

    if (request.dirtyGuard === "confirm") {
      const decision = await confirmReplacement(session);
      if (decision === "cancel") {
        return cancelledResult(session);
      }
    }

    const loaded = await request.load();
    if (request.isCancelled?.()) {
      return cancelledResult(session);
    }

    const file = normalizeDocumentForSource(request.source, loaded.file);
    applyDocumentTransition({
      source: request.source,
      session,
      file,
      path: loaded.path,
      name: loaded.name,
    });

    return {
      status: "applied",
      documentLoaded: session?.hasLoadedDocument() ?? false,
    };
  } catch (error) {
    if (isCancelled(error)) {
      return cancelledResult(session);
    }
    return {
      status: "failed",
      documentLoaded: session?.hasLoadedDocument() ?? false,
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
  session: CanvasDocumentSurface | null;
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
  if (!session) {
    applyDetachedDocumentTransition({ source, file, path, name });
    return;
  }

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

function applyDetachedDocumentTransition({
  source,
  file,
  path,
  name,
}: Omit<ApplyDocumentTransitionOptions, "session">): void {
  if (source === "mount-existing") {
    throw new Error("mount-existing document transitions require an attached canvas session");
  }

  replaceCurrentDesignState(file, path, name);
  resetDirtyBaselines();
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

function sessionForTransition(request: DocumentTransitionRequest): CanvasDocumentSurface | null {
  return sessionForOption(request.session);
}

function sessionForOption(
  session: CanvasDocumentSurface | null | undefined,
): CanvasDocumentSurface | null {
  return session === undefined
    ? getCurrentCanvasDocumentSurface()
    : session;
}

async function confirmReplacement(session: CanvasDocumentSurface | null): Promise<ReplacementDecision> {
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

function cancelledResult(session: CanvasDocumentSurface | null): DocumentTransitionResult {
  return {
    status: "cancelled",
    documentLoaded: session?.hasLoadedDocument() ?? false,
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
