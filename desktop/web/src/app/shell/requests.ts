import { signal } from '@preact/signals'

/**
 * One-shot requests from commands to title-bar chrome. Each request bumps a
 * counter the owning component watches, so repeating a command re-requests.
 */
export const designRenameRequest = signal(0)

/** File › Rename… (F2): the title bar turns the Design name into a field. */
export function requestDesignRename(): void {
  designRenameRequest.value += 1
}
