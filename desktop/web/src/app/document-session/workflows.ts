import { effect } from "@preact/signals";
import { currentCanvasQuerySurface } from "../../canvas/session";
import { getConsortiumCanonicalName } from "../../target";
import { createDefaultConsortiumEntry } from "../consortium/time-model";
import { mutateCurrentDesign } from "../document/controller";
import { currentDesign } from "./store";
import type { DesignSessionWorkflow } from "./workflow-runner";

let disposer: (() => void) | null = null;

export function installConsortiumSync(): void {
  disposer?.();

  disposer = effect(() => {
    const session = currentCanvasQuerySurface.value;
    void session?.revision.scene.value;
    const design = currentDesign.value;
    if (!design) return;

    if (!session) return;
    const currentPlants = session.getPlacedPlants();
    const currentConsortiums = design.consortiums;
    const currentNames = new Set<string>();
    for (const plant of currentPlants) currentNames.add(plant.canonical_name);

    const existingConsortiumNames = new Set<string>();
    for (const consortium of currentConsortiums) {
      existingConsortiumNames.add(getConsortiumCanonicalName(consortium));
    }

    const toAdd: string[] = [];
    for (const name of currentNames) {
      if (!existingConsortiumNames.has(name)) {
        toAdd.push(name);
      }
    }

    if (toAdd.length === 0) return;

    mutateCurrentDesign((nextDesign) => {
      const newEntries = toAdd.map(createDefaultConsortiumEntry);
      const consortiums = [...nextDesign.consortiums, ...newEntries];
      return { ...nextDesign, consortiums };
    }, { markDirty: false });
  });
}

export function disposeConsortiumSync(): void {
  disposer?.();
  disposer = null;
}

export const consortiumSyncWorkflow: DesignSessionWorkflow = {
  id: "consortium-sync",
  install: () => {
    installConsortiumSync();
    return disposeConsortiumSync;
  },
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeConsortiumSync();
  });
}
