import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import type { CanopiFile } from "../../types/design";
import type { DesignTemplateEnvelope } from "../design-template-import/types";
import * as designIpc from "../../ipc/design";
import {
  createDesignSessionStateMachine,
  type DocumentTransitionResult,
  type QueuedDocumentLoadOptions,
  type SaveCurrentDesignOptions,
  type TeardownDesignSessionOptions,
} from "./state-machine";
import type { DesignSaveSettlement } from "./persistence";
import {
  setPendingDesignPath,
  setPendingTemplateImport,
} from "./store";

export {
  createDesignSessionStateMachine,
  isCancelled,
  nameFromPath,
  type DesignSessionState,
  type DesignSessionStateMachineDeps,
  type DesignSessionStateStatus,
  type DocumentTransitionResult,
  type QueuedDocumentLoadOptions,
  type SaveCurrentDesignOptions,
  type TeardownDesignSessionOptions,
} from "./state-machine";

const designSessionStateMachine = createDesignSessionStateMachine();

interface DesignSessionLoadOptions {
  readonly session?: CanvasDocumentSurface | null;
  readonly isCancelled?: () => boolean;
}

export function captureCurrentDesignObservation() {
  return designSessionStateMachine.captureCurrentDesignObservation();
}

export function resetDesignSessionStateForTests(): void {
  designSessionStateMachine.resetState();
}

export function startAttachedDesignSession(
  session: CanvasDocumentSurface,
): Promise<DocumentTransitionResult | null> {
  return designSessionStateMachine.startAttachedDesignSession(session);
}

export function abortFailedAttachedDesignSessionStart(
  session: CanvasDocumentSurface,
  logError: (message?: unknown, ...optionalParams: unknown[]) => void = console.error,
): void {
  designSessionStateMachine.teardownAttachedDesignSession({
    session,
    runtimeInitialized: false,
    logError,
  });
}

export function beginEmptyDocumentSession(session: CanvasDocumentSurface): void {
  designSessionStateMachine.beginEmptyDocumentSession(session);
}

export function consumeQueuedDocumentLoad(
  session: CanvasDocumentSurface,
  options: QueuedDocumentLoadOptions = {},
): () => void {
  return designSessionStateMachine.consumeQueuedDocumentLoad(session, options);
}

/** The continuous-save core of the Desktop Design Session. */
export const designContinuousSave = designSessionStateMachine.continuousSave;

/** Install continuous save for the Desktop application lifetime. */
export function installDesignContinuousSave(): () => void {
  return designContinuousSave.install();
}

export function saveCurrentDesign(
  options: SaveCurrentDesignOptions = {},
): Promise<boolean> {
  return designSessionStateMachine.saveCurrentDesign(options);
}

export function resolveDesignSaveConflict(): Promise<DocumentTransitionResult | null> {
  return designSessionStateMachine.resolveSaveConflict();
}

export function revertDesignSessionToOpenedVersion(): Promise<DocumentTransitionResult> {
  return designSessionStateMachine.revertToOpenedVersion();
}

export function saveAsCurrentDesign(
  options: SaveCurrentDesignOptions = {},
): Promise<DesignSaveSettlement | null> {
  return designSessionStateMachine.saveAsCurrentDesign(options);
}

export function openDesignSessionFromDialog(): Promise<DocumentTransitionResult> {
  return designSessionStateMachine.transitionDocument({
    source: "open-dialog",
    dirtyGuard: "flush",
    load: async () => {
      const { file, path, fingerprint } = await designIpc.openDesignDialog();
      return { file, path, name: file.name, fingerprint };
    },
  });
}

export function openDesignSessionFromPath(
  path: string,
  options: DesignSessionLoadOptions = {},
): Promise<DocumentTransitionResult> {
  return designSessionStateMachine.transitionDocument({
    source: "open-path",
    dirtyGuard: "flush",
    session: options.session,
    load: async () => {
      const { file, fingerprint } = await designIpc.loadDesign(path);
      return { file, path, name: file.name, fingerprint };
    },
    isCancelled: options.isCancelled,
    deferWhenDetachedAndEmpty: () => {
      setPendingDesignPath(path);
    },
  });
}

export function openTemplateDesignSession(
  template: DesignTemplateEnvelope,
  options: DesignSessionLoadOptions = {},
): Promise<DocumentTransitionResult> {
  const envelope = {
    identity: Object.freeze({}),
    file: cloneDocument(template.file),
    name: template.name,
  };
  const draftId = createDraftId();
  return designSessionStateMachine.transitionDocument({
    source: "template",
    dirtyGuard: "flush",
    session: options.session,
    load: async () => ({
      file: cloneDocument(envelope.file),
      path: null,
      name: envelope.name,
      draftId,
      writePending: true,
    }),
    isCancelled: options.isCancelled,
    deferWhenDetachedAndEmpty: () => {
      setPendingTemplateImport(envelope);
    },
  });
}

export function createNewDesignSession(): Promise<DocumentTransitionResult> {
  const draftId = createDraftId();
  return designSessionStateMachine.transitionDocument({
    source: "new",
    dirtyGuard: "flush",
    load: async () => ({
      file: await designIpc.newDesign(),
      path: null,
      name: "Untitled",
      draftId,
    }),
  });
}

export function openDesignDraftSession(id: string): Promise<DocumentTransitionResult> {
  return designSessionStateMachine.transitionDocument({
    source: "open-draft",
    dirtyGuard: "flush",
    load: async () => {
      const file = await designIpc.loadDesignDraft(id);
      return { file, path: null, name: file.name, draftId: id };
    },
  });
}

export function teardownAttachedDesignSession(options: TeardownDesignSessionOptions): void {
  designSessionStateMachine.teardownAttachedDesignSession(options);
}

function cloneDocument(file: CanopiFile): CanopiFile {
  return JSON.parse(JSON.stringify(file)) as CanopiFile;
}

function createDraftId(): string {
  return globalThis.crypto.randomUUID();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    designContinuousSave.dispose();
  });
}
