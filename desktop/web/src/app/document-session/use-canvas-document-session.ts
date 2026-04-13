import { useEffect } from "preact/hooks";
import { setCurrentCanvasSession, getCurrentCanvasSession } from "../../canvas/session";
import { SceneCanvasRuntime } from "../../canvas/runtime/scene-runtime";
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
import { flushQueuedSettingsPersist } from "../settings/persistence";
import { consumeQueuedDocumentLoad } from "./actions";
import {
  disposeDocumentWorkflows,
  installConsortiumSync,
  loadCanvasFromDocument,
  writeCanvasIntoDocument,
  snapshotCanvasIntoCurrentDocument,
} from "./runtime";

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

    const runtime = new SceneCanvasRuntime();
    let cancelled = false;
    let cancelQueuedLoad = () => {};
    let resizeObserver: ResizeObserver | null = null;

    void runtime.init(container).then(() => {
      if (cancelled) return;

      setCurrentCanvasSession(runtime);
      runtime.initializeViewport();
      if (rulerOverlayRef.current) {
        runtime.attachRulersTo(rulerOverlayRef.current);
      }

      if (currentDesign.value) {
        loadCanvasFromDocument(currentDesign.value, runtime);
        runtime.showCanvasChrome();
      } else {
        // Queued file-open flows can replace the document without going
        // through loadCanvasFromDocument, so the sync must already be active.
        installConsortiumSync();
        runtime.hideCanvasChrome();
      }

      resizeObserver = new ResizeObserver(() => {
        runtime.resize(canvasArea.clientWidth, canvasArea.clientHeight);
      });
      resizeObserver.observe(canvasArea);
      cancelQueuedLoad = consumeQueuedDocumentLoad(runtime);
    }).catch((error) => {
      console.error("Failed to initialize scene canvas runtime:", error);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      cancelQueuedLoad();
      flushQueuedSettingsPersist();
      if (currentDesign.value) {
        try {
          snapshotCanvasIntoCurrentDocument(runtime, designName.value);
          markCanvasDetachedDirty(canvasDirty.value);
        } catch (error) {
          console.error("Failed to snapshot canvas before teardown:", error);
        }
      }
      disposeDocumentWorkflows();
      runtime.destroy();
      setCurrentCanvasSession(null);
    };
  }, []);

  const intervalMs = autoSaveIntervalMs.value;
  useEffect(() => {
    const timer = setInterval(() => {
      if (!designDirty.value) return;
      const session = getCurrentCanvasSession();
      if (!session) return;
      const content = writeCanvasIntoDocument(session, designName.value);
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
