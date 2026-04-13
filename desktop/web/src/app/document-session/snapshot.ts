import type { CanopiFile } from "../../types/design";
import { currentDesign } from "../../state/design";

export function replaceCurrentDesignSnapshot(file: CanopiFile): void {
  currentDesign.value = file;
}
