import { signal, type ReadonlySignal } from "@preact/signals";

export interface BrowserShellNotice {
  readonly tone: "info" | "error";
  readonly title: string;
  readonly message: string;
}

// One dismissible notice under the Web shell header; a new notice replaces it.
const notice = signal<BrowserShellNotice | null>(null);

export const browserShellNotice: ReadonlySignal<BrowserShellNotice | null> = notice;

export function showBrowserShellNotice(next: BrowserShellNotice): void {
  notice.value = next;
}

export function dismissBrowserShellNotice(): void {
  notice.value = null;
}
