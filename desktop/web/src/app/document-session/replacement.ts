import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
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

export function createDesignSessionReplacement({
  store,
  workflowRunner,
}: DesignSessionReplacementDeps): DesignSessionReplacement {
  return {
    attach(canvas): DesignSessionApplicationReceipt {
      const file = store.readCurrentDesign();
      if (!file) {
        canvas.hideCanvasChrome();
        workflowRunner.install();
        return { file: null, canvasHydrated: false };
      }

      canvas.loadDocument(file);
      finishCanvasHydration(canvas);
      workflowRunner.install();
      return { file, canvasHydrated: true };
    },

    replace(input, canvas = null): DesignSessionApplicationReceipt {
      const file = normalizeReplacement(input);

      if (canvas) {
        canvas.replaceDocument(file);
      }
      store.replaceCurrentDesignState(file, input.path, input.name);
      store.resetDirtyBaselines();
      if (canvas) {
        finishCanvasHydration(canvas);
      }
      workflowRunner.install();

      return { file, canvasHydrated: canvas !== null };
    },
  };
}

function normalizeReplacement(input: ResolvedDesignReplacement): CanopiFile {
  return input.kind === "new"
    ? normalizeNewDocument(input.file)
    : normalizeLoadedDocument(input.file);
}

function finishCanvasHydration(canvas: CanvasDocumentSurface): void {
  canvas.clearHistory();
  canvas.showCanvasChrome();
  canvas.zoomToFit();
}
