import { effect } from "@preact/signals";
import { currentCanvasSession } from "../../canvas/session";
import { STRATA_ROWS } from "../../canvas/consortium-renderer";
import { consortiumTarget, getConsortiumCanonicalName } from "../../panel-targets";
import { sceneEntityRevision } from "../../state/canvas";
import { currentDesign } from "../../state/design";
import { mutateCurrentDesign } from "../document/controller";

const DEFAULT_STRATUM: string = STRATA_ROWS[STRATA_ROWS.length - 1]!;

let disposer: (() => void) | null = null;

export function installConsortiumSync(): void {
  disposer?.();

  disposer = effect(() => {
    void sceneEntityRevision.value;
    const design = currentDesign.value;
    if (!design) return;

    const session = currentCanvasSession.peek();
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
      const newEntries = toAdd.map((name) => ({
        target: consortiumTarget(name),
        stratum: DEFAULT_STRATUM,
        start_phase: 0,
        end_phase: 2,
      }));
      const consortiums = [...nextDesign.consortiums, ...newEntries];
      return { ...nextDesign, consortiums };
    }, { markDirty: false });
  });
}

export function disposeConsortiumSync(): void {
  disposer?.();
  disposer = null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeConsortiumSync();
  });
}
