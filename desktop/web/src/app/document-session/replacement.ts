import { batch } from "@preact/signals";
import {
  CanvasDocumentReplacementNotAdmittedError,
  createCanvasDocumentReplacementToken,
  type CanvasDocumentReplacementToken,
  type CanvasDocumentSurface,
} from "../../canvas/runtime/runtime";
import type { CanopiFile } from "../../types/design";
import { normalizeLoadedDocument, normalizeNewDocument } from "../contracts/document";
import type { DesignSessionStore } from "./store";
import type { DesignSessionWorkflowRunner } from "./workflow-runner";

export type DesignReplacementKind = "new" | "loaded";

export interface ResolvedDesignReplacement {
  readonly file: CanopiFile;
  readonly kind: DesignReplacementKind;
  readonly path: string | null;
  readonly name: string;
  readonly finalizationIdentity?: string;
  readonly onDesignFinalized?: () => void;
}

export interface DesignSessionApplicationReceipt {
  readonly file: CanopiFile | null;
  readonly canvasHydrated: boolean;
}

declare const designSessionPendingCanvasReplacementBrand: unique symbol;

export interface DesignSessionPendingCanvasReplacementIdentity {
  readonly [designSessionPendingCanvasReplacementBrand]: true;
}

export interface DesignSessionReplacement {
  attach(canvas: CanvasDocumentSurface): DesignSessionApplicationReceipt;
  isPendingCanvasReplacementDesignFinalized(
    canvas: CanvasDocumentSurface,
    identity: DesignSessionPendingCanvasReplacementIdentity,
  ): boolean;
  pendingCanvasReplacementIdentity(
    canvas: CanvasDocumentSurface,
  ): DesignSessionPendingCanvasReplacementIdentity | null;
  matchesPendingCanvasReplacement(
    input: ResolvedDesignReplacement,
    canvas: CanvasDocumentSurface,
    identity: DesignSessionPendingCanvasReplacementIdentity,
  ): boolean;
  resumePendingCanvasReplacement(
    canvas: CanvasDocumentSurface,
    identity: DesignSessionPendingCanvasReplacementIdentity,
    options?: { readonly preserveCurrentDesign?: boolean },
  ): boolean;
  settlePendingCanvasReplacementForHandoff(
    canvas: CanvasDocumentSurface,
    identity: DesignSessionPendingCanvasReplacementIdentity,
    options?: { readonly preserveCurrentDesign?: boolean },
  ): boolean;
  replace(
    input: ResolvedDesignReplacement,
    canvas?: CanvasDocumentSurface | null,
  ): DesignSessionApplicationReceipt;
}

export interface DesignSessionReplacementDeps {
  readonly store: DesignSessionStore;
  readonly workflowRunner: DesignSessionWorkflowRunner;
}

interface PendingDesignReplacement {
  readonly identity: DesignSessionPendingCanvasReplacementIdentity;
  readonly key: string;
  readonly file: CanopiFile;
  readonly finalization: DesignReplacementFinalizer;
  canvasApplication: PendingCanvasApplication | null;
  workflowsInstalled: boolean;
}

interface DesignReplacementFinalizer {
  run(): void;
  preserveCurrentDesign(): void;
  wasDesignApplied(): boolean;
}

interface PendingCanvasApplication {
  readonly token: CanvasDocumentReplacementToken;
  readonly canvas: CanvasDocumentSurface;
  canvasReplaced: boolean;
  chromeShown: boolean;
  zoomedToFit: boolean;
}

export function createDesignSessionReplacement({
  store,
  workflowRunner,
}: DesignSessionReplacementDeps): DesignSessionReplacement {
  let pendingReplacement: PendingDesignReplacement | null = null;

  function settleAdmittedCanvasReplacement(
    operation: PendingDesignReplacement,
    canvasApplication: PendingCanvasApplication,
  ): void {
    try {
      settleCanvasReplacement(operation, canvasApplication);
    } catch (error) {
      if (!(error instanceof CanvasDocumentReplacementNotAdmittedError)) throw error;
      if (pendingReplacement === operation) pendingReplacement = null;
      throw error.reason;
    }
  }

  return {
    attach(canvas): DesignSessionApplicationReceipt {
      const file = store.readCurrentDesign();
      if (!file) {
        canvas.hideCanvasChrome();
        workflowRunner.install();
        return { file: null, canvasHydrated: false };
      }

      canvas.loadDocument(file);
      pendingReplacement = null;
      finishCanvasHydration(canvas);
      workflowRunner.install();
      return { file, canvasHydrated: true };
    },

    pendingCanvasReplacementIdentity(canvas) {
      return pendingReplacement?.canvasApplication?.canvas === canvas
        && !pendingReplacement.canvasApplication.canvasReplaced
        ? pendingReplacement.identity
        : null;
    },

    matchesPendingCanvasReplacement(input, canvas, identity) {
      const operation = pendingReplacement;
      return operation?.identity === identity
        && operation.canvasApplication?.canvas === canvas
        && !operation.canvasApplication.canvasReplaced
        && operation.key === designReplacementKey(input, normalizeReplacement(input));
    },

    isPendingCanvasReplacementDesignFinalized(canvas, identity) {
      return pendingReplacement?.identity === identity
        && pendingReplacement.canvasApplication?.canvas === canvas
        && pendingReplacement.finalization.wasDesignApplied();
    },

    resumePendingCanvasReplacement(canvas, identity, options = {}) {
      const operation = pendingReplacement;
      const canvasApplication = operation?.canvasApplication;
      if (
        !operation
        || operation.identity !== identity
        || !canvasApplication
        || canvasApplication.canvas !== canvas
        || canvasApplication.canvasReplaced
      ) return false;

      if (options.preserveCurrentDesign) {
        operation.finalization.preserveCurrentDesign();
      }
      settleAdmittedCanvasReplacement(operation, canvasApplication);
      finishCanvasApplication(operation, canvasApplication, workflowRunner);
      if (pendingReplacement === operation) pendingReplacement = null;
      return true;
    },

    settlePendingCanvasReplacementForHandoff(canvas, identity, options = {}) {
      const operation = pendingReplacement;
      const canvasApplication = operation?.canvasApplication;
      if (
        !operation
        || operation.identity !== identity
        || !canvasApplication
        || canvasApplication.canvas !== canvas
        || canvasApplication.canvasReplaced
      ) return false;

      if (options.preserveCurrentDesign) {
        operation.finalization.preserveCurrentDesign();
      }
      settleAdmittedCanvasReplacement(operation, canvasApplication);
      if (pendingReplacement === operation) pendingReplacement = null;
      return true;
    },

    replace(input, canvas = null): DesignSessionApplicationReceipt {
      const file = normalizeReplacement(input);
      const replacementKey = designReplacementKey(input, file);
      const operation = pendingReplacement?.key === replacementKey
        ? pendingReplacement
        : createPendingDesignReplacement(store, replacementKey, file, input);
      pendingReplacement = operation;

      if (canvas) {
        const canvasApplication = operation.canvasApplication?.canvas === canvas
          ? operation.canvasApplication
          : createPendingCanvasApplication(canvas);
        operation.canvasApplication = canvasApplication;

        settleAdmittedCanvasReplacement(operation, canvasApplication);

        finishCanvasApplication(operation, canvasApplication, workflowRunner);

        const appliedFile = store.readCurrentDesign() ?? operation.file;
        pendingReplacement = null;
        return { file: appliedFile, canvasHydrated: true };
      }

      operation.finalization.run();
      if (!operation.workflowsInstalled) {
        workflowRunner.install();
        operation.workflowsInstalled = true;
      }

      const appliedFile = store.readCurrentDesign() ?? operation.file;
      pendingReplacement = null;
      return { file: appliedFile, canvasHydrated: false };
    },
  };
}

function createPendingDesignReplacement(
  store: DesignSessionStore,
  key: string,
  file: CanopiFile,
  input: ResolvedDesignReplacement,
): PendingDesignReplacement {
  const ownedFile = cloneDocument(file);
  return {
    identity: Object.freeze({}) as DesignSessionPendingCanvasReplacementIdentity,
    key,
    file: ownedFile,
    finalization: createDesignReplacementFinalizer(
      store,
      ownedFile,
      input.path,
      input.name,
      input.onDesignFinalized,
    ),
    canvasApplication: null,
    workflowsInstalled: false,
  };
}

function createPendingCanvasApplication(
  canvas: CanvasDocumentSurface,
): PendingCanvasApplication {
  return {
    token: createCanvasDocumentReplacementToken(),
    canvas,
    canvasReplaced: false,
    chromeShown: false,
    zoomedToFit: false,
  };
}

function cloneDocument(file: CanopiFile): CanopiFile {
  return JSON.parse(JSON.stringify(file)) as CanopiFile;
}

function settleCanvasReplacement(
  operation: PendingDesignReplacement,
  canvasApplication: PendingCanvasApplication,
): void {
  if (canvasApplication.canvasReplaced) return;
  let replacementFinalized = false;
  const replacementReceipt = canvasApplication.canvas.replaceDocument(
    cloneDocument(operation.file),
    canvasApplication.token,
    () => {
      operation.finalization.run();
      replacementFinalized = true;
    },
  );
  if (replacementFinalized !== replacementReceipt.callerFinalizerInvoked) {
    throw new Error("Canvas replacement returned before Design state finalization");
  }
  canvasApplication.canvasReplaced = true;
}

function finishCanvasApplication(
  operation: PendingDesignReplacement,
  canvasApplication: PendingCanvasApplication,
  workflowRunner: DesignSessionWorkflowRunner,
): void {
  if (!canvasApplication.chromeShown) {
    canvasApplication.canvas.showCanvasChrome();
    canvasApplication.chromeShown = true;
  }
  if (!canvasApplication.zoomedToFit) {
    canvasApplication.canvas.zoomToFit();
    canvasApplication.zoomedToFit = true;
  }
  if (!operation.workflowsInstalled) {
    workflowRunner.install();
    operation.workflowsInstalled = true;
  }
}

function createDesignReplacementFinalizer(
  store: DesignSessionStore,
  file: CanopiFile,
  path: string | null,
  name: string,
  onDesignFinalized: () => void = () => {},
): DesignReplacementFinalizer {
  let outcome: "pending" | "applied" | "preserved" = "pending";
  let extensionFinalized = false;
  let preserveCurrentDesign = false;
  const wasDesignApplied = () => outcome === "applied";

  return Object.freeze({
    run() {
      if (outcome !== "pending") return;
      if (preserveCurrentDesign) {
        outcome = "preserved";
        return;
      }
      batch(() => {
        try {
          store.resetDirtyBaselines();
          store.replaceCurrentDesignState(file, path, name);
        } finally {
          const identity = store.readIdentity();
          const identityApplied = identity.file === file
            && identity.path === path
            && identity.name === name;
          if (identityApplied && !extensionFinalized) {
            onDesignFinalized();
            extensionFinalized = true;
          }
          if (identityApplied && extensionFinalized) outcome = "applied";
        }
      });
      if (!wasDesignApplied()) {
        throw new Error("Design Session store did not apply document replacement");
      }
    },
    preserveCurrentDesign() {
      if (outcome === "pending") preserveCurrentDesign = true;
    },
    wasDesignApplied,
  });
}

function designReplacementKey(
  input: ResolvedDesignReplacement,
  file: CanopiFile,
): string {
  return JSON.stringify([
    input.kind,
    input.path,
    input.name,
    input.finalizationIdentity ?? null,
    file,
  ]);
}

function normalizeReplacement(input: ResolvedDesignReplacement): CanopiFile {
  return input.kind === "new"
    ? normalizeNewDocument(input.file)
    : normalizeLoadedDocument(input.file);
}

function finishCanvasHydration(canvas: CanvasDocumentSurface): void {
  canvas.showCanvasChrome();
  canvas.zoomToFit();
}
