import {
  getCurrentCanvasSession,
  setCanvasRuntimeSurfaces,
} from "../../canvas/session";
import type {
  CanvasDocumentSurface,
  CanvasRuntimeHost,
  CanvasRuntimeSurfaces,
} from "../../canvas/runtime/runtime";
import { runCanvasRuntimeCleanups } from "../../canvas/runtime/cleanup";
import { autoSaveIntervalMs } from "../settings/state";
import { flushSettingsProjection } from "../settings/projection";
import { createAppCanvasRuntimeHost } from "../canvas-runtime/host";
import {
  abortFailedAttachedDesignSessionStart,
  autosaveDesignSession,
  consumeQueuedDocumentLoad,
  startAttachedDesignSession,
  teardownAttachedDesignSession,
} from "./transition";

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
  readonly createRuntimeHost: () => CanvasRuntimeHost;
  readonly publishSurfaces: (surfaces: CanvasRuntimeSurfaces | null) => void;
  readonly createResizeObserver: (
    callback: ResizeObserverCallback,
  ) => DesignSessionResizeObserver | null;
  readonly readInitialAutosaveInterval: () => number;
  readonly logError: (message?: unknown, ...optionalParams: unknown[]) => void;
  readonly onInitializationFailure: () => void;
}

const DEFAULT_LIFECYCLE_DEPS: DesignSessionLifecycleDeps = {
  createRuntimeHost: createAppCanvasRuntimeHost,
  publishSurfaces: setCanvasRuntimeSurfaces,
  createResizeObserver: (callback) => {
    if (typeof ResizeObserver === "undefined") return null;
    return new ResizeObserver(callback);
  },
  readInitialAutosaveInterval: () => autoSaveIntervalMs.value,
  logError: (message, ...optionalParams) => console.error(message, ...optionalParams),
  onInitializationFailure: () => {},
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
  private readonly runtimeHost: CanvasRuntimeHost;
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
    this.runtimeHost = deps.createRuntimeHost();
    this.surfaces = this.runtimeHost.surfaces;
    this.documents = this.surfaces.documents;
  }

  start(): void {
    this.updateAutosaveInterval(this.deps.readInitialAutosaveInterval());

    void this.runtimeHost.init(this.host.container).then(async () => {
      if (this.cancelled) return;

      this.runtimeInitialized = true;
      this.documents.initializeViewport();
      if (this.cancelled) return;
      if (this.host.rulerOverlay) {
        this.documents.attachRulersTo(this.host.rulerOverlay);
        if (this.cancelled) return;
      }

      const result = await startAttachedDesignSession(this.documents);
      if (this.cancelled) return;
      if (result?.status === "failed") {
        abortFailedAttachedDesignSessionStart(this.documents, this.deps.logError);
        throw result.error;
      }

      const resizeObserver = this.deps.createResizeObserver(() => {
        this.documents.resize(this.host.canvasArea.clientWidth, this.host.canvasArea.clientHeight);
      });
      if (this.cancelled) {
        this.disconnectLateResizeObserver(resizeObserver);
        return;
      }
      this.resizeObserver = resizeObserver;
      resizeObserver?.observe(this.host.canvasArea);
      if (this.cancelled) return;

      const cancelQueuedLoad = consumeQueuedDocumentLoad(this.documents);
      if (this.cancelled) {
        try {
          cancelQueuedLoad();
        } catch (error) {
          this.deps.logError("Failed to cancel a late document load:", error);
        }
        return;
      }
      this.cancelQueuedLoad = cancelQueuedLoad;
      this.deps.publishSurfaces(this.surfaces);
    }).catch((error: unknown) => {
      if (this.cancelled) return;
      this.deps.logError("Failed to initialize scene canvas runtime:", error);
      try {
        this.deps.onInitializationFailure();
      } catch (cleanupError) {
        this.deps.logError(
          "Failed to clean up after Canvas runtime initialization failure:",
          cleanupError,
        );
      }
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
    this.teardownDocumentSession();
    try {
      runCanvasRuntimeCleanups([
        () => this.clearAutosaveTimer(),
        () => this.disconnectResizeObserver(),
        () => this.cancelPendingDocumentLoad(),
        () => flushSettingsProjection(),
        () => this.runtimeHost.destroy(),
        () => {
          if (getCurrentCanvasSession() === this.surfaces) {
            this.deps.publishSurfaces(null);
          }
        },
      ], "Design Session lifecycle cleanup failed");
    } catch (error) {
      this.deps.logError("Failed to dispose Design Session lifecycle:", error);
    }
  }

  private clearAutosaveTimer(): void {
    if (this.autosaveTimer === null) return;
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  private disconnectResizeObserver(): void {
    const observer = this.resizeObserver;
    this.resizeObserver = null;
    observer?.disconnect();
  }

  private cancelPendingDocumentLoad(): void {
    const cancel = this.cancelQueuedLoad;
    this.cancelQueuedLoad = () => {};
    cancel();
  }

  private disconnectLateResizeObserver(observer: DesignSessionResizeObserver | null): void {
    try {
      observer?.disconnect();
    } catch (error) {
      this.deps.logError("Failed to disconnect a late Canvas resize observer:", error);
    }
  }

  private autosave(): void {
    void autosaveDesignSession({
      session: this.documents,
      runtimeInitialized: this.runtimeInitialized,
      logError: this.deps.logError,
    }).catch((error: unknown) => {
      this.deps.logError("Autosave failed:", error);
    });
  }

  private teardownDocumentSession(): void {
    teardownAttachedDesignSession({
      session: this.documents,
      runtimeInitialized: this.runtimeInitialized,
      logError: this.deps.logError,
    });
  }
}
