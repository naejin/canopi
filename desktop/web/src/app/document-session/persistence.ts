import type { CanvasDocumentSurface } from "../../canvas/runtime/runtime";
import type { CanopiFile } from "../../types/design";
import { currentDesign } from "../../state/design";
import { replaceCurrentDesignSnapshot } from "./snapshot";
import { disposeConsortiumSync } from "./workflows";

export interface PersistedDesignSessionContentOptions {
  readonly session: CanvasDocumentSurface | null;
  readonly name: string;
}

export interface CanvasDesignSessionSnapshotOptions {
  readonly session: CanvasDocumentSurface;
  readonly name: string;
}

export function buildPersistedDesignSessionContent({
  session,
  name,
}: PersistedDesignSessionContentOptions): CanopiFile {
  const design = requireCurrentDesign("buildPersistedDesignSessionContent");
  if (session) return session.serializeDocument({ name }, design);
  return {
    ...design,
    name,
  };
}

export function snapshotCanvasIntoDesignSession({
  session,
  name,
}: CanvasDesignSessionSnapshotOptions): CanopiFile | null {
  if (!currentDesign.value) return null;
  const file = buildPersistedDesignSessionContent({ session, name });
  replaceCurrentDesignSnapshot(file);
  return file;
}

export function disposeDesignSessionPersistence(): void {
  disposeConsortiumSync();
}

function requireCurrentDesign(operation: string): CanopiFile {
  const design = currentDesign.value;
  if (!design) throw new Error(`${operation}: no design loaded`);
  return design;
}
