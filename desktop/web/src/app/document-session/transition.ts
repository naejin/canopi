import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import type { CanopiFile } from "../../types/design";
import type { DesignTemplateEnvelope } from "../design-template-import/types";
import * as designIpc from "../../ipc/design";
import {
  createDesignSessionStateMachine,
  type AutosaveDesignSessionOptions,
  type DesignSessionState,
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
  type AutosaveDesignSessionOptions,
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

export function getDesignSessionState(): DesignSessionState {
  return designSessionStateMachine.getState();
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

export function saveCurrentDesign(
  options: SaveCurrentDesignOptions = {},
): Promise<DesignSaveSettlement | null> {
  return designSessionStateMachine.saveCurrentDesign(options);
}

export function saveAsCurrentDesign(
  options: SaveCurrentDesignOptions = {},
): Promise<DesignSaveSettlement | null> {
  return designSessionStateMachine.saveAsCurrentDesign(options);
}

export function openDesignSessionFromDialog(): Promise<DocumentTransitionResult> {
  return designSessionStateMachine.transitionDocument({
    source: "open-dialog",
    dirtyGuard: "confirm",
    load: async () => {
      const { file, path } = await designIpc.openDesignDialog();
      return { file, path, name: file.name };
    },
  });
}

export function openDesignSessionFromPath(
  path: string,
  options: DesignSessionLoadOptions = {},
): Promise<DocumentTransitionResult> {
  return designSessionStateMachine.transitionDocument({
    source: "open-path",
    dirtyGuard: "confirm",
    session: options.session,
    load: async () => {
      const file = await designIpc.loadDesign(path);
      return { file, path, name: file.name };
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
  return designSessionStateMachine.transitionDocument({
    source: "template",
    dirtyGuard: "confirm",
    session: options.session,
    load: async () => ({
      file: cloneDocument(envelope.file),
      path: null,
      name: envelope.name,
    }),
    isCancelled: options.isCancelled,
    deferWhenDetachedAndEmpty: () => {
      setPendingTemplateImport(envelope);
    },
  });
}

export function createNewDesignSession(): Promise<DocumentTransitionResult> {
  return designSessionStateMachine.transitionDocument({
    source: "new",
    dirtyGuard: "confirm",
    load: async () => ({
      file: await designIpc.newDesign(),
      path: null,
      name: "Untitled",
    }),
  });
}

export function autosaveDesignSession(
  options: AutosaveDesignSessionOptions,
): Promise<boolean> {
  return designSessionStateMachine.autosaveDesignSession(options);
}

export function teardownAttachedDesignSession(options: TeardownDesignSessionOptions): void {
  designSessionStateMachine.teardownAttachedDesignSession(options);
}

function cloneDocument(file: CanopiFile): CanopiFile {
  return JSON.parse(JSON.stringify(file)) as CanopiFile;
}
