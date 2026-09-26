/** The Dropdown trigger whose accessible name starts with `label` (its name is the label then the current value). */
export function dropdownTrigger(scope: ParentNode, label: string): HTMLButtonElement | null {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"][aria-labelledby]'))
    .find((button) => {
      const labelId = button.getAttribute('aria-labelledby')!.split(/\s+/)[0]!
      return button.ownerDocument.getElementById(labelId)?.textContent === label
    }) ?? null
}
