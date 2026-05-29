import { setCanvasRuntimeSurfaces } from "../../canvas/session";
import { SceneCanvasRuntime } from "../../canvas/runtime/scene-runtime";
import { createCanvasRuntimeSurfaces } from "../../canvas/runtime/surfaces";
import type {
  CanvasDocumentSurface,
  CanvasRuntimeSurfaces,
  MountedCanvasRuntime,
} from "../../canvas/runtime/runtime";
import { autosaveDesign } from "../../ipc/design";
import {
  autosaveFailed,
  canvasDirty,
  currentDesign,
  designDirty,
  designName,
  designPath,
  markCanvasDetachedDirty,
} from "../../state/design";
import { autoSaveIntervalMs } from "../settings/state";
import { flushSettingsProjection } from "../settings/projection";
import { createAppSceneRuntimePanelTargetAdapter } from "../canvas-runtime/panel-target-adapter";
import {
  beginEmptyDocumentSession,
  consumeQueuedDocumentLoad,
  transitionDocument,
} from "./transition";
import {
  buildPersistedDesignSessionContent,
  disposeDesignSessionPersistence,
  snapshotCanvasIntoDesignSession,
} from "./persistence";

interface DesignSessionLifecycleHost {
  readonly canvasArea: HTMLElement;
  readonly container: HTMLElement;
  readonly rulerOverlay: HTMLElement | null;
}

interface DesignSessionResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

interface DesignSessionLifecycleDeps {
  readonly createRuntime: () => InitializableCanvasRuntime;
  readonly createSurfaces: (runtime: MountedCanvasRuntime) => CanvasRuntimeSurfaces;
  readonly publishSurfaces: (surfaces: CanvasRuntimeSurfaces | null) => void;
  readonly createResizeObserver: (
    callback: ResizeObserverCallback,
  ) => DesignSessionResizeObserver | null;
  readonly readInitialAutosaveInterval: () => number;
  readonly logError: (message?: unknown, ...optionalParams: unknown[]) => void;
}

type InitializableCanvasRuntime = MountedCanvasRuntime & {
  init(container: HTMLElement): Promise<void>;
};

const DEFAULT_LIFECYCLE_DEPS: DesignSessionLifecycleDeps = {
  createRuntime: () => new SceneCanvasRuntime({
    panelTargets: createAppSceneRuntimePanelTargetAdapter(),
  }),
  createSurfaces: createCanvasRuntimeSurfaces,
  publishSurfaces: setCanvasRuntimeSurfaces,
  createResizeObserver: (callback) => {
    if (typeof ResizeObserver === "undefined") return null;
    return new ResizeObserver(callback);
  },
  readInitialAutosaveInterval: () => autoSaveIntervalMs.value,
  logError: console.error,
};

export interface DesignSessionLifecycle {
  start(): void;
  updateAutosaveInterval(intervalMs: number): void;
  dispose(): void;
}

export function createDesignSessionLifecycle(
  host: DesignSessionLifecycleHost,
  deps: Partial<DesignSessionLifecycleDeps> = {},
): DesignSessionLifecycle {
  return new RuntimeDesignSessionLifecycle(host, {
    ...DEFAULT_LIFECYCLE_DEPS,
    ...deps,
  });
}

class RuntimeDesignSessionLifecycle implements DesignSessionLifecycle {
  private readonly runtime: InitializableCanvasRuntime;
  private readonly surfaces: CanvasRuntimeSurfaces;
  private readonly documents: CanvasDocumentSurface;
  private cancelled = false;
  private runtimeInitialized = false;
  private cancelQueuedLoad = () => {};
  private resizeObserver: DesignSessionResizeObserver | null = null;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly host: DesignSessionLifecycleHost,
    private readonly deps: DesignSessionLifecycleDeps,
  ) {
    this.runtime = deps.createRuntime();
    this.surfaces = deps.createSurfaces(this.runtime);
    this.documents = this.surfaces.documents;
  }

  start(): void {
    this.updateAutosaveInterval(this.deps.readInitialAutosaveInterval());

    void this.runtime.init(this.host.container).then(() => {
      if (this.cancelled) return;

      this.runtimeInitialized = true;
      this.deps.publishSurfaces(this.surfaces);
      this.documents.initializeViewport();
      if (this.host.rulerOverlay) {
        this.documents.attachRulersTo(this.host.rulerOverlay);
      }

      if (currentDesign.value) {
        void transitionDocument({
          source: "mount-existing",
          dirtyGuard: "skip",
          session: this.documents,
          load: async () => {
            const file = currentDesign.value;
            if (!file) throw new Error("No current design to mount");
            return { file, path: designPath.value, name: designName.value };
          },
        }).then((result) => {
          if (result.status === "failed") {
            this.deps.logError("Failed to mount current canvas document:", result.error);
          }
        });
      } else {
        beginEmptyDocumentSession(this.documents);
      }

      this.resizeObserver = this.deps.createResizeObserver(() => {
        this.documents.resize(this.host.canvasArea.clientWidth, this.host.canvasArea.clientHeight);
      });
      this.resizeObserver?.observe(this.host.canvasArea);
      this.cancelQueuedLoad = consumeQueuedDocumentLoad(this.documents);
    }).catch((error: unknown) => {
      this.deps.logError("Failed to initialize scene canvas runtime:", error);
    });
  }

  updateAutosaveInterval(intervalMs: number): void {
    this.clearAutosaveTimer();
    this.autosaveTimer = setInterval(() => {
      this.autosave();
    }, intervalMs);
  }

  dispose(): void {
    this.cancelled = true;
    this.clearAutosaveTimer();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.cancelQueuedLoad();
    flushSettingsProjection();
    this.snapshotBeforeTeardown();
    disposeDesignSessionPersistence();
    this.runtime.destroy();
    this.deps.publishSurfaces(null);
  }

  private clearAutosaveTimer(): void {
    if (this.autosaveTimer === null) return;
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  private autosave(): void {
    if (!designDirty.value) return;
    if (!this.runtimeInitialized) return;
    const content = buildPersistedDesignSessionContent({
      session: this.documents,
      name: designName.value,
    });
    autosaveDesign(content, designPath.value)
      .then(() => {
        autosaveFailed.value = false;
      })
      .catch((error) => {
        this.deps.logError("Autosave failed:", error);
        autosaveFailed.value = true;
      });
  }

  private snapshotBeforeTeardown(): void {
    if (!this.runtimeInitialized || !this.documents.hasLoadedDocument() || !currentDesign.value) {
      return;
    }

    try {
      snapshotCanvasIntoDesignSession({
        session: this.documents,
        name: designName.value,
      });
      markCanvasDetachedDirty(canvasDirty.value);
    } catch (error) {
      this.deps.logError("Failed to snapshot canvas before teardown:", error);
    }
  }
}
