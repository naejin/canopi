import { theme } from "../app/settings/state";
import { invalidateCssVarCache } from "../canvas/canvas2d-utils";
import type { Theme } from "../types/settings";

export function applyBrowserTheme(nextTheme: Theme): void {
  document.documentElement.setAttribute("data-theme", nextTheme);
  invalidateCssVarCache();
  theme.value = nextTheme;
}
