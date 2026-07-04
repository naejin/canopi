import { bootstrapShell } from "../app/shell/bootstrap";
import { registerCloseGuard } from "../app/shell/close-guard";

export function bootstrapPlatform(): void {
  bootstrapShell();
  registerCloseGuard();
}
