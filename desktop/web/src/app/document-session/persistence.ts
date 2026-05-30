import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import type { CanopiFile } from "../../types/design";
import { disposeConsortiumSync } from "./workflows";
import {
  designSessionStore,
  type DesignSessionStore,
} from "./store";

export interface PersistedDesignSessionContentOptions {
  readonly session: CanvasDocumentSurface | null;
  readonly name: string;
  readonly store?: DesignSessionStore;
}

export interface CanvasDesignSessionSnapshotOptions {
  readonly session: CanvasDocumentSurface;
  readonly name: string;
  readonly store?: DesignSessionStore;
}

export function buildPersistedDesignSessionContent({
  session,
  name,
  store = designSessionStore,
}: PersistedDesignSessionContentOptions): CanopiFile {
  const design = requireCurrentDesign(store, "buildPersistedDesignSessionContent");
  if (session) return session.serializeDocument({ name }, design);
  return {
    ...design,
    name,
  };
}

export function snapshotCanvasIntoDesignSession({
  session,
  name,
  store = designSessionStore,
}: CanvasDesignSessionSnapshotOptions): CanopiFile | null {
  if (!store.hasCurrentDesign()) return null;
  const file = buildPersistedDesignSessionContent({ session, name, store });
  store.replaceCurrentDesignSnapshot(file);
  return file;
}

export function disposeDesignSessionPersistence(): void {
  disposeConsortiumSync();
}

function requireCurrentDesign(store: DesignSessionStore, operation: string): CanopiFile {
  const design = store.readCurrentDesign();
  if (!design) throw new Error(`${operation}: no design loaded`);
  return design;
}
