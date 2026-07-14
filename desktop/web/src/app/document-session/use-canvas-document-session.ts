import { useEffect, useRef } from "preact/hooks";
import {
  claimCanvasRuntimeLifecycle,
  ensureCanvasRuntimeLifecycleAvailable,
} from "../../canvas/runtime/lifecycle-owner";
import { autoSaveIntervalMs } from "../settings/state";
import { createDesignSessionLifecycle, type DesignSessionLifecycle } from "./lifecycle";

interface MutableDomRef<T> {
  current: T | null;
}

interface CanvasDocumentSessionRefs {
  canvasAreaRef: MutableDomRef<HTMLDivElement>;
  containerRef: MutableDomRef<HTMLDivElement>;
  rulerOverlayRef: MutableDomRef<HTMLDivElement>;
}

/**
 * Connects CanvasPanel DOM refs to the Design Session lifecycle.
 * CanvasPanel remains responsible for layout and presentation only.
 */
export function useCanvasDocumentSession({
  canvasAreaRef,
  containerRef,
  rulerOverlayRef,
}: CanvasDocumentSessionRefs): void {
  const lifecycleRef = useRef<DesignSessionLifecycle | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvasArea = canvasAreaRef.current;
    if (!container || !canvasArea) return;

    ensureCanvasRuntimeLifecycleAvailable();
    let lifecycle: DesignSessionLifecycle | null = null;
    const runtimeLease = claimCanvasRuntimeLifecycle(() => lifecycle?.dispose());
    const releaseLifecycle = () => {
      runtimeLease.release();
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
    };
    try {
      lifecycle = createDesignSessionLifecycle({
        canvasArea,
        container,
        rulerOverlay: rulerOverlayRef.current,
      }, {
        onInitializationFailure: releaseLifecycle,
      });
      lifecycleRef.current = lifecycle;
      lifecycle.start();
    } catch (error) {
      releaseLifecycle();
      throw error;
    }

    return releaseLifecycle;
  }, []);

  const intervalMs = autoSaveIntervalMs.value;
  useEffect(() => {
    lifecycleRef.current?.updateAutosaveInterval(intervalMs);
  }, [intervalMs]);
}
