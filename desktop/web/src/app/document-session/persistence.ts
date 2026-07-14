import {
  CanvasAuthorityBusyError,
  type CanvasDocumentSurface,
  type CanvasPersistenceCapture,
} from "../../canvas/runtime/runtime";
import type { CanopiFile } from "../../types/design";
import {
  designSessionStore,
  type PersistenceCapableDesignSessionStore,
} from "./store";
import {
  captureDesignSessionPersistenceState,
  type DesignSessionPersistenceCapture,
} from "./persistence-capability";
import {
  createDesignWriteAdmission,
  type PreparedDesignWriteDestination,
  type PreparedSynchronousDesignWriteDestination,
} from "./write-admission";

export interface DesignSaveSettlement {
  readonly status: "applied" | "stale";
  readonly path: string | null;
  readonly content: CanopiFile;
}

export interface DesignExistingPathSaveOperation {
  readonly destinationPath: string;
  execute(destination: PreparedDesignWriteDestination): Promise<DesignSaveSettlement>;
}

export interface DesignSaveAsOperation {
  readonly destinationHint: {
    readonly currentPath: string | null;
    readonly suggestedName: string;
  };
  execute(destination: PreparedDesignWriteDestination): Promise<DesignSaveSettlement>;
}

export interface DesignSnapshotSaveOperation {
  execute(destination: PreparedDesignWriteDestination): Promise<DesignSaveSettlement>;
}

export interface DesignSynchronousSnapshotSaveOperation {
  executeImmediately(
    destination: PreparedSynchronousDesignWriteDestination,
  ): DesignSaveSettlement;
}

export interface DesignRecoveryOperation {
  readonly destinationHint: string | null;
  execute(destination: PreparedDesignWriteDestination): Promise<boolean>;
}

export interface DesignPersistenceCanvasLease {
  isCurrent(): boolean;
  assertCurrent(): void;
}

export interface DesignReplacementGuard {
  isCurrent(): boolean;
}

export interface DesignReplacementGuardCapture {
  readonly guard: DesignReplacementGuard | null;
  isDesignBaselineCurrent(): boolean;
  resume(): DesignReplacementGuard | null;
}

export interface DesignReplacementWriteFence {
  invalidatePredecessorWrites(): void;
}

export interface DesignSessionPersistence {
  isCanvasAttached(session: CanvasDocumentSurface): boolean;
  attachCanvas(session: CanvasDocumentSurface): DesignPersistenceCanvasLease;
  acquireDetachedCanvasLease(): DesignPersistenceCanvasLease;
  beginReplacementGuard(): DesignReplacementGuardCapture;
  withReplacementWriteFence<T>(
    replace: (fence: DesignReplacementWriteFence) => Promise<T>,
  ): Promise<T>;
  detachCanvas(session: CanvasDocumentSurface): void;
  beginSave(): DesignExistingPathSaveOperation;
  beginSaveAs(): DesignSaveAsOperation;
  beginBrowserDownload(): DesignSnapshotSaveOperation;
  beginBrowserDraft(): DesignSynchronousSnapshotSaveOperation;
  beginRecovery(): DesignRecoveryOperation;
  captureObservation(session: CanvasDocumentSurface | null): CanopiFile | null;
  settleCanvasHandoff(session: CanvasDocumentSurface): CanopiFile | null;
  dispose(): void;
}

interface DesignSessionPersistenceOptions {
  readonly store?: PersistenceCapableDesignSessionStore;
}

interface PersistenceCapture {
  readonly store: DesignSessionPersistenceCapture;
  readonly canvas: CanvasPersistenceCapture | null;
  readonly leasedCanvas: CanvasDocumentSurface | null;
  readonly attachmentEpoch: number;
  readonly writeEpoch: number;
  readonly canvasLoaded: boolean;
  readonly content: CanopiFile;
}

type SaveIntent = "save" | "save-as" | "browser-download" | "browser-draft";

interface WriteExecution<T> {
  readonly destination: PreparedDesignWriteDestination;
  readonly result: Promise<T>;
}

interface ReservedWriteExecution<T> {
  readonly execution: WriteExecution<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

interface SynchronousWriteExecution<T> {
  readonly destination: PreparedSynchronousDesignWriteDestination;
  readonly outcome:
    | { readonly status: "fulfilled"; readonly result: T }
    | { readonly status: "rejected"; readonly error: unknown };
}

interface SaveIntentState {
  readonly capture: PersistenceCapture;
  readonly intent: number;
  readonly kind: SaveIntent;
  settlement: DesignSaveSettlement | null;
  failed: boolean;
  settlementStarted: boolean;
}

export class DesignPersistenceBusyError extends Error {
  constructor(message = "Design persistence capture crossed a session transition") {
    super(message);
    this.name = "DesignPersistenceBusyError";
  }
}

export class DesignPersistenceLeaseError extends Error {
  constructor(message = "Canvas persistence lease belongs to another session") {
    super(message);
    this.name = "DesignPersistenceLeaseError";
  }
}

export class DesignPersistenceSettlementError extends Error {
  constructor(readonly errors: readonly unknown[]) {
    super("Design write completed, but exact persistence settlement failed");
    this.name = "DesignPersistenceSettlementError";
  }
}

export class DesignPersistenceFailurePolicyError extends Error {
  constructor(
    readonly storageError: unknown,
    readonly publicationError: unknown,
  ) {
    super(
      `Design persistence failed and failure publication also failed: ${formatError(storageError)}`,
    );
    this.name = "DesignPersistenceFailurePolicyError";
  }
}

// One initial attempt plus a retry after each fallible reactive publication:
// Canvas baseline, Design baseline, and Save As destination path.
const EXACT_SETTLEMENT_ATTEMPTS = 4;

export function createDesignSessionPersistence({
  store = designSessionStore,
}: DesignSessionPersistenceOptions = {}): DesignSessionPersistence {
  let attachedCanvas: CanvasDocumentSurface | null = null;
  let attachmentEpoch = 0;
  let writeEpoch = 0;
  let nextSaveIntent = 0;
  let latestSaveIntent = 0;
  let nextRecoveryIntent = 0;
  let latestRecoveryIntent = 0;
  let manualSuccessEpoch = 0;
  const writeAdmission = createDesignWriteAdmission();

  function isCanvasAttached(session: CanvasDocumentSurface): boolean {
    return attachedCanvas === session;
  }

  function attachCanvas(session: CanvasDocumentSurface): DesignPersistenceCanvasLease {
    if (attachedCanvas !== session) {
      if (attachedCanvas) throw new DesignPersistenceLeaseError();
      attachedCanvas = session;
      attachmentEpoch += 1;
    }
    return createCanvasLease(session, attachmentEpoch);
  }

  function acquireDetachedCanvasLease(): DesignPersistenceCanvasLease {
    if (attachedCanvas) throw new DesignPersistenceLeaseError();
    return createCanvasLease(null, attachmentEpoch);
  }

  function createCanvasLease(
    session: CanvasDocumentSurface | null,
    leaseEpoch: number,
  ): DesignPersistenceCanvasLease {
    const leaseIsCurrent = () => attachedCanvas === session && attachmentEpoch === leaseEpoch;
    return Object.freeze({
      isCurrent: leaseIsCurrent,
      assertCurrent() {
        if (!leaseIsCurrent()) {
          throw new DesignPersistenceLeaseError(
            "Canvas persistence lease is no longer current",
          );
        }
      },
    });
  }

  function detachCanvas(session: CanvasDocumentSurface): void {
    if (attachedCanvas !== session) return;
    attachedCanvas = null;
    attachmentEpoch += 1;
  }

  function captureFromStoreBaseline(
    sessionCapture: DesignSessionPersistenceCapture,
    leasedCanvas: CanvasDocumentSurface | null,
    capturedAttachmentEpoch: number,
    capturedWriteEpoch: number,
  ): PersistenceCapture {
    const activeCanvas = leasedCanvas?.hasLoadedDocument() ? leasedCanvas : null;
    const canvasCapture = activeCanvas?.captureForPersistence(
      { name: sessionCapture.name },
      sessionCapture.file,
    ) ?? null;
    const content = canvasCapture?.content ?? {
      ...sessionCapture.file,
      name: sessionCapture.name,
    };

    if (
      !sessionCapture.isCurrent()
      || capturedAttachmentEpoch !== attachmentEpoch
      || leasedCanvas !== attachedCanvas
      || (activeCanvas !== null) !== (leasedCanvas?.hasLoadedDocument() ?? false)
    ) {
      throw new DesignPersistenceBusyError();
    }

    return {
      store: sessionCapture,
      canvas: canvasCapture,
      leasedCanvas,
      attachmentEpoch: capturedAttachmentEpoch,
      writeEpoch: capturedWriteEpoch,
      canvasLoaded: activeCanvas !== null,
      content: cloneDocument(content),
    };
  }

  function capture(): PersistenceCapture {
    const capturedWriteEpoch = writeEpoch;
    return captureFromStoreBaseline(
      captureDesignSessionPersistenceState(store),
      attachedCanvas,
      attachmentEpoch,
      capturedWriteEpoch,
    );
  }

  function captureIsCurrent(persistenceCapture: PersistenceCapture): boolean {
    return captureSessionIsCurrent(persistenceCapture)
      && persistenceCapture.writeEpoch === writeEpoch;
  }

  function captureSessionIsCurrent(
    persistenceCapture: PersistenceCapture,
  ): boolean {
    return persistenceCapture.store.isCurrent()
      && persistenceCapture.attachmentEpoch === attachmentEpoch
      && persistenceCapture.leasedCanvas === attachedCanvas
      && persistenceCapture.canvasLoaded === (
        persistenceCapture.leasedCanvas?.hasLoadedDocument() ?? false
      );
  }

  function beginReplacementGuard(): DesignReplacementGuardCapture {
    const leasedCanvas = attachedCanvas;
    const capturedAttachmentEpoch = attachmentEpoch;
    const capturedWriteEpoch = writeEpoch;
    if (!store.hasCurrentDesign()) {
      const designBaselineIsCurrent = () => !store.hasCurrentDesign()
        && leasedCanvas === attachedCanvas
        && capturedAttachmentEpoch === attachmentEpoch;
      const guard = Object.freeze({
        isCurrent: designBaselineIsCurrent,
      });
      return completedReplacementGuardCapture(guard, designBaselineIsCurrent);
    }

    const storeBaseline = captureDesignSessionPersistenceState(store);
    const designBaselineIsCurrent = () => storeBaseline.isExactCurrent()
      && leasedCanvas === attachedCanvas
      && capturedAttachmentEpoch === attachmentEpoch;
    const captureBaseline = () => captureFromStoreBaseline(
      storeBaseline,
      leasedCanvas,
      capturedAttachmentEpoch,
      capturedWriteEpoch,
    );
    try {
      return completedReplacementGuardCapture(
        createReplacementGuard(captureBaseline()),
        designBaselineIsCurrent,
      );
    } catch (error) {
      // Concrete Scene ownership stays behind the Canvas document contract.
      if (!(error instanceof CanvasAuthorityBusyError)) throw error;
      return Object.freeze({
        guard: null,
        isDesignBaselineCurrent: designBaselineIsCurrent,
        resume() {
          if (!designBaselineIsCurrent()) return null;
          return createReplacementGuard(captureBaseline());
        },
      });
    }
  }

  function createReplacementGuard(
    baseline: PersistenceCapture,
  ): DesignReplacementGuard {
    const contentFingerprint = replacementContentFingerprint(baseline.content);
    return Object.freeze({
      isCurrent() {
        if (
          !baseline.store.isExactCurrent()
          || !captureSessionIsCurrent(baseline)
          || baseline.canvas?.isCurrent() === false
        ) return false;
        try {
          const current = capture();
          return baseline.store.isExactCurrent()
            && captureSessionIsCurrent(baseline)
            && (baseline.canvas?.isCurrent() ?? true)
            && (current.canvas?.isCurrent() ?? true)
            && replacementContentFingerprint(current.content) === contentFingerprint;
        } catch {
          return false;
        }
      },
    });
  }

  function completedReplacementGuardCapture(
    guard: DesignReplacementGuard,
    isDesignBaselineCurrent: () => boolean,
  ): DesignReplacementGuardCapture {
    return Object.freeze({
      guard,
      isDesignBaselineCurrent,
      resume: () => guard,
    });
  }

  function createIntent(kind: SaveIntent): SaveIntentState {
    const intent = ++nextSaveIntent;
    latestSaveIntent = intent;
    const state: SaveIntentState = {
      capture: capture(),
      intent,
      kind,
      settlement: null,
      failed: false,
      settlementStarted: false,
    };
    return state;
  }

  function intentMaySettle(state: SaveIntentState): boolean {
    return !state.failed
      && state.intent === latestSaveIntent
      && captureIsCurrent(state.capture);
  }

  function settleSave(
    state: SaveIntentState,
    path: string | null,
    updatePath: boolean,
  ): DesignSaveSettlement {
    if (state.settlement) return state.settlement;
    if (updatePath && !path) {
      throw new Error("Save As settlement requires a destination path");
    }
    if (!state.settlementStarted) {
      if (!intentMaySettle(state)) return settleStale(state);
      state.settlementStarted = true;
      manualSuccessEpoch += 1;
    } else if (!captureIsCurrent(state.capture)) {
      return settleStale(state);
    }

    if (state.capture.canvas?.acknowledgeSaved() === "stale") {
      return settleStale(state);
    }
    if (!captureIsCurrent(state.capture)) return settleStale(state);

    if (state.capture.store.acknowledgeSaved({
      canvasAcknowledged: state.capture.canvas !== null,
      canvasDetached: state.capture.canvas === null,
    }) === "stale") {
      return settleStale(state);
    }
    if (!captureIsCurrent(state.capture)) return settleStale(state);

    if (updatePath) {
      if (!state.capture.store.updatePath(path!)) return settleStale(state);
      if (!captureIsCurrent(state.capture)) return settleStale(state);
    }

    state.settlement = createSettlement("applied", path, state.capture.content);
    return state.settlement;
  }

  function settleStale(state: SaveIntentState): DesignSaveSettlement {
    state.settlement = createSettlement("stale", null, state.capture.content);
    return state.settlement;
  }

  function failSave(state: SaveIntentState): void {
    if (state.settlement || state.failed || state.settlementStarted) return;
    state.failed = true;
    if (
      state.kind === "browser-draft"
      && state.intent === latestSaveIntent
      && captureIsCurrent(state.capture)
    ) {
      state.capture.store.setAutosaveFailed(true);
    }
  }

  function operationContent(state: SaveIntentState): CanopiFile {
    return cloneDocument(state.capture.content);
  }

  async function executeSave(
    state: SaveIntentState,
    destination: PreparedDesignWriteDestination,
    path: string | null,
    updatePath: boolean,
  ): Promise<DesignSaveSettlement> {
    let writeCompleted = false;
    try {
      const admission = await writeAdmission.execute(
        destination,
        operationContent(state),
        () => !state.failed
          && state.intent === latestSaveIntent
          && captureIsCurrent(state.capture),
        () => {
          writeCompleted = true;
          return settleWrittenOperation(() => settleSave(state, path, updatePath));
        },
      );
      return admission.status === "stale"
        ? settleStale(state)
        : admission.value;
    } catch (error) {
      throw writeCompleted
        ? error
        : preserveFailurePolicyError(error, () => failSave(state));
    }
  }

  function beginSave(): DesignExistingPathSaveOperation {
    const state = createIntent("save");
    const destinationPath = state.capture.store.path;
    let execution: WriteExecution<DesignSaveSettlement> | null = null;
    if (!destinationPath) {
      state.failed = true;
      throw new Error("Existing-path save requires a destination path");
    }
    return Object.freeze({
      destinationPath,
      execute(destination: PreparedDesignWriteDestination) {
        if (execution) return repeatExecution(execution, destination);
        if (writeAdmission.destinationPath(destination) !== destinationPath) {
          return Promise.reject(
            new Error("Existing-path save destination does not match its capture"),
          );
        }
        const reserved = reserveWriteExecution<DesignSaveSettlement>(destination);
        execution = reserved.execution;
        void executeSave(state, destination, destinationPath, false).then(
          reserved.resolve,
          reserved.reject,
        );
        return reserved.execution.result;
      },
    });
  }

  function beginSaveAs(): DesignSaveAsOperation {
    const state = createIntent("save-as");
    let execution: WriteExecution<DesignSaveSettlement> | null = null;
    return Object.freeze({
      destinationHint: Object.freeze({
        currentPath: state.capture.store.path,
        suggestedName: state.capture.content.name || state.capture.store.name || "Untitled",
      }),
      execute(destination: PreparedDesignWriteDestination) {
        if (execution) return repeatExecution(execution, destination);
        const destinationPath = writeAdmission.destinationPath(destination);
        if (!destinationPath) {
          return Promise.reject(new Error("Save As execution requires a destination path"));
        }
        const reserved = reserveWriteExecution<DesignSaveSettlement>(destination);
        execution = reserved.execution;
        void executeSave(state, destination, destinationPath, true).then(
          reserved.resolve,
          reserved.reject,
        );
        return reserved.execution.result;
      },
    });
  }

  function beginBrowserDownload(): DesignSnapshotSaveOperation {
    const state = createIntent("browser-download");
    let execution: WriteExecution<DesignSaveSettlement> | null = null;
    return Object.freeze({
      execute(destination: PreparedDesignWriteDestination) {
        if (execution) return repeatExecution(execution, destination);
        const reserved = reserveWriteExecution<DesignSaveSettlement>(destination);
        execution = reserved.execution;
        void executeSave(state, destination, null, false).then(
          reserved.resolve,
          reserved.reject,
        );
        return reserved.execution.result;
      },
    });
  }

  function beginBrowserDraft(): DesignSynchronousSnapshotSaveOperation {
    const state = createIntent("browser-draft");
    let execution: SynchronousWriteExecution<DesignSaveSettlement> | null = null;
    let executingDestination: PreparedSynchronousDesignWriteDestination | null = null;
    return Object.freeze({
      executeImmediately(destination: PreparedSynchronousDesignWriteDestination) {
        if (execution) return repeatSynchronousExecution(execution, destination);
        if (executingDestination) {
          if (executingDestination !== destination) {
            throw new Error("Design write operation already has a destination");
          }
          throw new DesignPersistenceBusyError(
            "Synchronous Design write operation is already executing",
          );
        }
        executingDestination = destination;
        try {
          const admission = writeAdmission.executeImmediately(
            destination,
            operationContent(state),
            () => intentMaySettle(state),
            () => settleWrittenOperation(() => settleSave(state, null, false)),
          );
          const result = admission.status === "stale"
            ? settleStale(state)
            : admission.value;
          execution = { destination, outcome: { status: "fulfilled", result } };
          return result;
        } catch (error) {
          const preservedError = preserveFailurePolicyError(
            error,
            () => failSave(state),
          );
          execution = {
            destination,
            outcome: { status: "rejected", error: preservedError },
          };
          throw preservedError;
        } finally {
          executingDestination = null;
        }
      },
    });
  }

  function beginRecovery(): DesignRecoveryOperation {
    const intent = ++nextRecoveryIntent;
    latestRecoveryIntent = intent;
    const capturedManualSuccessEpoch = manualSuccessEpoch;
    const persistenceCapture = capture();
    let settled = false;
    let execution: WriteExecution<boolean> | null = null;

    function maySettle(): boolean {
      return !settled
        && intent === latestRecoveryIntent
        && capturedManualSuccessEpoch === manualSuccessEpoch
        && captureIsCurrent(persistenceCapture);
    }

    function mayWrite(): boolean {
      return !settled
        && intent === latestRecoveryIntent
        && capturedManualSuccessEpoch === manualSuccessEpoch
        && captureIsCurrent(persistenceCapture);
    }

    function settleSuccess(): boolean {
      if (!maySettle()) return false;
      const applied = persistenceCapture.store.setAutosaveFailed(false);
      settled = true;
      return applied
        && intent === latestRecoveryIntent
        && capturedManualSuccessEpoch === manualSuccessEpoch
        && captureIsCurrent(persistenceCapture);
    }

    function settleFailure(): void {
      if (!maySettle()) return;
      persistenceCapture.store.setAutosaveFailed(true);
      settled = true;
    }

    return Object.freeze({
      destinationHint: persistenceCapture.store.path,
      execute(destination: PreparedDesignWriteDestination) {
        if (execution) return repeatExecution(execution, destination);
        const reserved = reserveWriteExecution<boolean>(destination);
        execution = reserved.execution;
        void (async () => {
          let writeCompleted = false;
          try {
            const admission = await writeAdmission.execute(
              destination,
              cloneDocument(persistenceCapture.content),
              mayWrite,
              () => {
                writeCompleted = true;
                return settleWrittenOperation(settleSuccess);
              },
            );
            if (admission.status === "stale") {
              settled = true;
              return false;
            }
            return admission.value;
          } catch (error) {
            throw writeCompleted
              ? error
              : preserveFailurePolicyError(error, settleFailure);
          }
        })().then(reserved.resolve, reserved.reject);
        return reserved.execution.result;
      },
    });
  }

  return {
    isCanvasAttached,
    attachCanvas,
    acquireDetachedCanvasLease,
    beginReplacementGuard,
    withReplacementWriteFence: (replace) => writeAdmission.withReplacementFence(() => {
      let invalidated = false;
      const fence = Object.freeze({
        invalidatePredecessorWrites() {
          if (invalidated) return;
          invalidated = true;
          writeEpoch += 1;
        },
      });
      return replace(fence);
    }),
    detachCanvas,
    beginSave,
    beginSaveAs,
    beginBrowserDownload,
    beginBrowserDraft,
    beginRecovery,
    captureObservation(session) {
      if (attachedCanvas !== session) throw new DesignPersistenceLeaseError();
      if (!store.hasCurrentDesign()) return null;
      return cloneDocument(capture().content);
    },
    settleCanvasHandoff(session) {
      if (attachedCanvas !== session) throw new DesignPersistenceLeaseError();
      if (!store.hasCurrentDesign()) return null;
      const errors: unknown[] = [];
      for (let attempt = 0; attempt < EXACT_SETTLEMENT_ATTEMPTS; attempt += 1) {
        if (attachedCanvas !== session) throw new DesignPersistenceLeaseError();
        try {
          const handoff = capture();
          if (!handoff.store.isExactCurrent()) {
            errors.push(new DesignPersistenceBusyError(
              "Design changed while Canvas handoff content was being composed",
            ));
            continue;
          }
          const content = cloneDocument(handoff.content);
          store.replaceCurrentDesignSnapshot(content);
          if (
            handoff.leasedCanvas === session
            && handoff.attachmentEpoch === attachmentEpoch
            && attachedCanvas === session
            && handoff.canvasLoaded === session.hasLoadedDocument()
            && (handoff.canvas?.isCurrent() ?? !handoff.canvasLoaded)
          ) return content;
          errors.push(new DesignPersistenceBusyError(
            "Canvas changed while its handoff snapshot was being published",
          ));
        } catch (error) {
          if (attachedCanvas !== session) throw new DesignPersistenceLeaseError();
          errors.push(error);
        }
      }
      throw new DesignPersistenceSettlementError(errors);
    },
    dispose() {
      attachedCanvas = null;
      attachmentEpoch += 1;
      writeAdmission.dispose();
    },
  };
}

function settleWrittenOperation<T>(succeed: () => T): T {
  const errors: unknown[] = [];
  for (let attempt = 0; attempt < EXACT_SETTLEMENT_ATTEMPTS; attempt += 1) {
    try {
      return succeed();
    } catch (error) {
      errors.push(error);
    }
  }
  throw new DesignPersistenceSettlementError(errors);
}

function preserveFailurePolicyError(
  storageError: unknown,
  publishFailure: () => void,
): unknown {
  try {
    publishFailure();
    return storageError;
  } catch (publicationError) {
    return new DesignPersistenceFailurePolicyError(storageError, publicationError);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repeatExecution<T>(
  execution: WriteExecution<T>,
  destination: PreparedDesignWriteDestination,
): Promise<T> {
  return execution.destination === destination
    ? execution.result
    : Promise.reject(new Error("Design write operation already has a destination"));
}

function reserveWriteExecution<T>(
  destination: PreparedDesignWriteDestination,
): ReservedWriteExecution<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const result = new Promise<T>((resolveResult, rejectResult) => {
    resolve = resolveResult;
    reject = rejectResult;
  });
  return {
    execution: { destination, result },
    resolve,
    reject,
  };
}

function repeatSynchronousExecution<T>(
  execution: SynchronousWriteExecution<T>,
  destination: PreparedSynchronousDesignWriteDestination,
): T {
  if (execution.destination !== destination) {
    throw new Error("Design write operation already has a destination");
  }
  if (execution.outcome.status === "rejected") throw execution.outcome.error;
  return execution.outcome.result;
}

function createSettlement(
  status: DesignSaveSettlement["status"],
  path: string | null,
  content: CanopiFile,
): DesignSaveSettlement {
  const ownedContent = cloneDocument(content);
  return Object.freeze({
    status,
    path,
    get content() {
      return cloneDocument(ownedContent);
    },
  });
}

function cloneDocument(file: CanopiFile): CanopiFile {
  return JSON.parse(JSON.stringify(file)) as CanopiFile;
}

function replacementContentFingerprint(file: CanopiFile): string {
  const { updated_at: _generatedTimestamp, ...stableContent } = file;
  void _generatedTimestamp;
  return JSON.stringify(stableContent);
}
