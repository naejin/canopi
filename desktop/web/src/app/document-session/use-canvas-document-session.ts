import { useEffect, useRef } from "preact/hooks";
import { acquireCanvasRuntimeLifecycle } from "../../canvas/runtime/lifecycle-owner";
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

    let cancelled = false;
    let lifecycle: DesignSessionLifecycle | null = null;
    let lifecycleCreationSettlement: Promise<void> | null = null;
    let releaseLease: (() => Promise<void>) | null = null;
    const release = () => {
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      const releaseCurrentLease = releaseLease;
      if (!releaseCurrentLease) return;
      void releaseCurrentLease().catch((error: unknown) => {
        console.error("Failed to release Design Session Canvas runtime:", error);
      });
    };

    void (async () => {
      const lease = await acquireCanvasRuntimeLifecycle(async () => {
        const pendingCreation = lifecycleCreationSettlement;
        if (pendingCreation) await pendingCreation;
        await lifecycle?.dispose();
      });
      releaseLease = lease.release;
      if (cancelled) {
        release();
        return;
      }

      try {
        let finishCreation!: () => void;
        lifecycleCreationSettlement = new Promise<void>((resolve) => {
          finishCreation = resolve;
        });
        try {
          lifecycle = createDesignSessionLifecycle({
            canvasArea,
            container,
            rulerOverlay: rulerOverlayRef.current,
          }, {
            onInitializationFailure: release,
          });
        } finally {
          finishCreation();
          lifecycleCreationSettlement = null;
        }
        lifecycleRef.current = lifecycle;
        if (cancelled) {
          release();
          return;
        }
        lifecycle.start();
      } catch (error) {
        release();
        throw error;
      }
    })().catch((error: unknown) => {
      if (!cancelled) {
        console.error("Failed to acquire Design Session Canvas runtime:", error);
      }
    });

    return () => {
      cancelled = true;
      release();
    };
  }, []);

  const intervalMs = autoSaveIntervalMs.value;
  useEffect(() => {
    lifecycleRef.current?.updateAutosaveInterval(intervalMs);
  }, [intervalMs]);
}
