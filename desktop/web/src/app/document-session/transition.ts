import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import {
  createDesignSessionStateMachine,
  type AutosaveDesignSessionOptions,
  type DesignSessionState,
  type DocumentTransitionRequest,
  type DocumentTransitionResult,
  type QueuedDocumentLoadOptions,
  type SaveCurrentDesignOptions,
  type TeardownDesignSessionOptions,
} from "./state-machine";

export {
  createDesignSessionStateMachine,
  isCancelled,
  nameFromPath,
  type AutosaveDesignSessionOptions,
  type DesignSessionState,
  type DesignSessionStateMachineDeps,
  type DesignSessionStateStatus,
  type DirtyGuardMode,
  type DocumentTransitionLoadResult,
  type DocumentTransitionRequest,
  type DocumentTransitionResult,
  type DocumentTransitionSource,
  type DocumentTransitionStatus,
  type QueuedDocumentLoadOptions,
  type SaveCurrentDesignOptions,
  type TeardownDesignSessionOptions,
} from "./state-machine";

const designSessionStateMachine = createDesignSessionStateMachine();

export function getDesignSessionState(): DesignSessionState {
  return designSessionStateMachine.getState();
}

export function resetDesignSessionStateForTests(): void {
  designSessionStateMachine.resetState();
}

export function startAttachedDesignSession(
  session: CanvasDocumentSurface,
): Promise<DocumentTransitionResult | null> {
  return designSessionStateMachine.startAttachedDesignSession(session);
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

export function saveCurrentDesign(options: SaveCurrentDesignOptions = {}): Promise<void> {
  return designSessionStateMachine.saveCurrentDesign(options);
}

export function saveAsCurrentDesign(options: SaveCurrentDesignOptions = {}): Promise<void> {
  return designSessionStateMachine.saveAsCurrentDesign(options);
}

export function transitionDocument(
  request: DocumentTransitionRequest,
): Promise<DocumentTransitionResult> {
  return designSessionStateMachine.transitionDocument(request);
}

export function autosaveDesignSession(
  options: AutosaveDesignSessionOptions,
): Promise<boolean> {
  return designSessionStateMachine.autosaveDesignSession(options);
}

export function teardownAttachedDesignSession(options: TeardownDesignSessionOptions): void {
  designSessionStateMachine.teardownAttachedDesignSession(options);
}
