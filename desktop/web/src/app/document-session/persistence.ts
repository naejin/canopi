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

export interface DesignSaveSettlement {
  readonly status: "applied" | "stale";
  readonly path: string | null;
  readonly content: CanopiFile;
}

export interface DesignPersistenceWriteOperation {
  readonly content: CanopiFile;
  fail(error?: unknown): void;
}

export interface DesignExistingPathSaveOperation extends DesignPersistenceWriteOperation {
  readonly destinationPath: string;
  succeed(): DesignSaveSettlement;
}

export interface DesignSaveAsOperation extends DesignPersistenceWriteOperation {
  succeed(path: string): DesignSaveSettlement;
}

export interface DesignSnapshotSaveOperation extends DesignPersistenceWriteOperation {
  succeed(): DesignSaveSettlement;
}

export interface DesignRecoveryOperation {
  readonly content: CanopiFile;
  readonly destinationHint: string | null;
  succeed(): boolean;
  fail(error?: unknown): void;
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

export interface DesignSessionPersistence {
  isCanvasAttached(session: CanvasDocumentSurface): boolean;
  attachCanvas(session: CanvasDocumentSurface): DesignPersistenceCanvasLease;
  acquireDetachedCanvasLease(): DesignPersistenceCanvasLease;
  beginReplacementGuard(): DesignReplacementGuardCapture;
  detachCanvas(session: CanvasDocumentSurface): void;
  beginSave(): DesignExistingPathSaveOperation;
  beginSaveAs(): DesignSaveAsOperation;
  beginBrowserDownload(): DesignSnapshotSaveOperation;
  beginBrowserDraft(): DesignSnapshotSaveOperation;
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
  readonly canvasLoaded: boolean;
  readonly content: CanopiFile;
}

type SaveIntent = "save" | "save-as" | "browser-download" | "browser-draft";

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

// One initial attempt plus a retry after each fallible reactive publication:
// Canvas baseline, Design baseline, and Save As destination path.
const EXACT_SETTLEMENT_ATTEMPTS = 4;

export function createDesignSessionPersistence({
  store = designSessionStore,
}: DesignSessionPersistenceOptions = {}): DesignSessionPersistence {
  let attachedCanvas: CanvasDocumentSurface | null = null;
  let attachmentEpoch = 0;
  let nextSaveIntent = 0;
  let latestSaveIntent = 0;
  let nextRecoveryIntent = 0;
  let latestRecoveryIntent = 0;
  let manualSuccessEpoch = 0;

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
      canvasLoaded: activeCanvas !== null,
      content: cloneDocument(content),
    };
  }

  function capture(): PersistenceCapture {
    return captureFromStoreBaseline(
      captureDesignSessionPersistenceState(store),
      attachedCanvas,
      attachmentEpoch,
    );
  }

  function captureIsCurrent(persistenceCapture: PersistenceCapture): boolean {
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
          || !captureIsCurrent(baseline)
          || baseline.canvas?.isCurrent() === false
        ) return false;
        try {
          const current = capture();
          return baseline.store.isExactCurrent()
            && captureIsCurrent(baseline)
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

  function beginSave(): DesignExistingPathSaveOperation {
    const state = createIntent("save");
    const destinationPath = state.capture.store.path;
    if (!destinationPath) {
      state.failed = true;
      throw new Error("Existing-path save requires a destination path");
    }
    return Object.freeze({
      get content() {
        return operationContent(state);
      },
      destinationPath,
      succeed: () => settleSave(state, destinationPath, false),
      fail: () => failSave(state),
    });
  }

  function beginSaveAs(): DesignSaveAsOperation {
    const state = createIntent("save-as");
    return Object.freeze({
      get content() {
        return operationContent(state);
      },
      succeed: (path: string) => settleSave(state, path, true),
      fail: () => failSave(state),
    });
  }

  function beginSnapshotSave(
    kind: "browser-download" | "browser-draft",
  ): DesignSnapshotSaveOperation {
    const state = createIntent(kind);
    return Object.freeze({
      get content() {
        return operationContent(state);
      },
      succeed: () => settleSave(state, null, false),
      fail: () => failSave(state),
    });
  }

  function beginRecovery(): DesignRecoveryOperation {
    const intent = ++nextRecoveryIntent;
    latestRecoveryIntent = intent;
    const capturedManualSuccessEpoch = manualSuccessEpoch;
    const persistenceCapture = capture();
    let settled = false;

    function maySettle(): boolean {
      return !settled
        && intent === latestRecoveryIntent
        && capturedManualSuccessEpoch === manualSuccessEpoch
        && captureIsCurrent(persistenceCapture);
    }

    return Object.freeze({
      get content() {
        return cloneDocument(persistenceCapture.content);
      },
      destinationHint: persistenceCapture.store.path,
      succeed() {
        if (!maySettle()) return false;
        const applied = persistenceCapture.store.setAutosaveFailed(false);
        settled = true;
        return applied
          && intent === latestRecoveryIntent
          && capturedManualSuccessEpoch === manualSuccessEpoch
          && captureIsCurrent(persistenceCapture);
      },
      fail() {
        if (!maySettle()) return;
        persistenceCapture.store.setAutosaveFailed(true);
        settled = true;
      },
    });
  }

  return {
    isCanvasAttached,
    attachCanvas,
    acquireDetachedCanvasLease,
    beginReplacementGuard,
    detachCanvas,
    beginSave,
    beginSaveAs,
    beginBrowserDownload: () => beginSnapshotSave("browser-download"),
    beginBrowserDraft: () => beginSnapshotSave("browser-draft"),
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
    },
  };
}

export function settleWrittenDesignOperation<T>(operation: { succeed(): T }): T {
  const errors: unknown[] = [];
  for (let attempt = 0; attempt < EXACT_SETTLEMENT_ATTEMPTS; attempt += 1) {
    try {
      return operation.succeed();
    } catch (error) {
      errors.push(error);
    }
  }
  throw new DesignPersistenceSettlementError(errors);
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
