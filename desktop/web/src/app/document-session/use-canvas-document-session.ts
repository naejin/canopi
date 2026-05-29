import { useEffect, useRef } from "preact/hooks";
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

    const lifecycle = createDesignSessionLifecycle({
      canvasArea,
      container,
      rulerOverlay: rulerOverlayRef.current,
    });
    lifecycleRef.current = lifecycle;
    lifecycle.start();

    return () => {
      lifecycleRef.current = null;
      lifecycle.dispose();
    };
  }, []);

  const intervalMs = autoSaveIntervalMs.value;
  useEffect(() => {
    lifecycleRef.current?.updateAutosaveInterval(intervalMs);
  }, [intervalMs]);
}
