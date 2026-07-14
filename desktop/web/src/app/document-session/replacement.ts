import { batch } from "@preact/signals";
import {
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
}

export interface DesignSessionApplicationReceipt {
  readonly file: CanopiFile | null;
  readonly canvasHydrated: boolean;
}

export interface DesignSessionReplacement {
  attach(canvas: CanvasDocumentSurface): DesignSessionApplicationReceipt;
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
  readonly key: string;
  readonly file: CanopiFile;
  readonly finalizeDesignReplacement: () => void;
  canvasApplication: PendingCanvasApplication | null;
  workflowsInstalled: boolean;
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

        if (!canvasApplication.canvasReplaced) {
          let replacementFinalized = false;
          const replacementReceipt = canvas.replaceDocument(
            cloneDocument(operation.file),
            canvasApplication.token,
            () => {
              operation.finalizeDesignReplacement();
              replacementFinalized = true;
            },
          );
          if (replacementFinalized !== replacementReceipt.callerFinalizerInvoked) {
            throw new Error("Canvas replacement returned before Design state finalization");
          }
          canvasApplication.canvasReplaced = true;
        }

        if (!canvasApplication.chromeShown) {
          canvas.showCanvasChrome();
          canvasApplication.chromeShown = true;
        }
        if (!canvasApplication.zoomedToFit) {
          canvas.zoomToFit();
          canvasApplication.zoomedToFit = true;
        }
        if (!operation.workflowsInstalled) {
          workflowRunner.install();
          operation.workflowsInstalled = true;
        }

        const appliedFile = store.readCurrentDesign() ?? operation.file;
        pendingReplacement = null;
        return { file: appliedFile, canvasHydrated: true };
      }

      operation.finalizeDesignReplacement();
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
    key,
    file: ownedFile,
    finalizeDesignReplacement: createDesignReplacementFinalizer(
      store,
      ownedFile,
      input.path,
      input.name,
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

function createDesignReplacementFinalizer(
  store: DesignSessionStore,
  file: CanopiFile,
  path: string | null,
  name: string,
): () => void {
  let applied = false;

  return () => {
    if (applied) return;
    batch(() => {
      store.resetDirtyBaselines();
      try {
        store.replaceCurrentDesignState(file, path, name);
      } finally {
        const identity = store.readIdentity();
        applied = identity.file === file
          && identity.path === path
          && identity.name === name;
      }
    });
    if (!applied) {
      throw new Error("Design Session store did not apply document replacement");
    }
  };
}

function designReplacementKey(
  input: ResolvedDesignReplacement,
  file: CanopiFile,
): string {
  return JSON.stringify([input.kind, input.path, input.name, file]);
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
