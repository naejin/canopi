import { useEffect } from "preact/hooks";
import { setCanvasRuntimeSurfaces, getCurrentCanvasDocumentSurface } from "../../canvas/session";
import { SceneCanvasRuntime } from "../../canvas/runtime/scene-runtime";
import { createCanvasRuntimeSurfaces } from "../../canvas/runtime/surfaces";
import { autosaveDesign } from "../../ipc/design";
import {
  currentDesign,
  designName,
  designPath,
  designDirty,
  autosaveFailed,
  canvasDirty,
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

interface MutableDomRef<T> {
  current: T | null;
}

interface CanvasDocumentSessionRefs {
  canvasAreaRef: MutableDomRef<HTMLDivElement>;
  containerRef: MutableDomRef<HTMLDivElement>;
  rulerOverlayRef: MutableDomRef<HTMLDivElement>;
}

/**
 * Owns the canvas runtime lifecycle for the active document session.
 * CanvasPanel remains responsible for layout and presentation only.
 */
export function useCanvasDocumentSession({
  canvasAreaRef,
  containerRef,
  rulerOverlayRef,
}: CanvasDocumentSessionRefs): void {
  useEffect(() => {
    const container = containerRef.current;
    const canvasArea = canvasAreaRef.current;
    if (!container || !canvasArea) return;

    const runtime = new SceneCanvasRuntime({
      panelTargets: createAppSceneRuntimePanelTargetAdapter(),
    });
    const surfaces = createCanvasRuntimeSurfaces(runtime);
    const documents = surfaces.documents;
    let cancelled = false;
    let runtimeInitialized = false;
    let cancelQueuedLoad = () => {};
    let resizeObserver: ResizeObserver | null = null;

    void runtime.init(container).then(() => {
      if (cancelled) return;

      runtimeInitialized = true;
      setCanvasRuntimeSurfaces(surfaces);
      documents.initializeViewport();
      if (rulerOverlayRef.current) {
        documents.attachRulersTo(rulerOverlayRef.current);
      }

      if (currentDesign.value) {
        void transitionDocument({
          source: "mount-existing",
          dirtyGuard: "skip",
          session: documents,
          load: async () => {
            const file = currentDesign.value;
            if (!file) throw new Error("No current design to mount");
            return { file, path: designPath.value, name: designName.value };
          },
        }).then((result) => {
          if (result.status === "failed") {
            console.error("Failed to mount current canvas document:", result.error);
          }
        });
      } else {
        beginEmptyDocumentSession(documents);
      }

      resizeObserver = new ResizeObserver(() => {
        documents.resize(canvasArea.clientWidth, canvasArea.clientHeight);
      });
      resizeObserver.observe(canvasArea);
      cancelQueuedLoad = consumeQueuedDocumentLoad(documents);
    }).catch((error) => {
      console.error("Failed to initialize scene canvas runtime:", error);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      cancelQueuedLoad();
      flushSettingsProjection();
      if (runtimeInitialized && runtime.hasLoadedDocument() && currentDesign.value) {
        try {
          snapshotCanvasIntoDesignSession({
            session: runtime,
            name: designName.value,
          });
          markCanvasDetachedDirty(canvasDirty.value);
        } catch (error) {
          console.error("Failed to snapshot canvas before teardown:", error);
        }
      }
      disposeDesignSessionPersistence();
      runtime.destroy();
      setCanvasRuntimeSurfaces(null);
    };
  }, []);

  const intervalMs = autoSaveIntervalMs.value;
  useEffect(() => {
    const timer = setInterval(() => {
      if (!designDirty.value) return;
      const session = getCurrentCanvasDocumentSurface();
      if (!session) return;
      const content = buildPersistedDesignSessionContent({
        session,
        name: designName.value,
      });
      autosaveDesign(content, designPath.value)
        .then(() => {
          autosaveFailed.value = false;
        })
        .catch((error) => {
          console.error("Autosave failed:", error);
          autosaveFailed.value = true;
        });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
