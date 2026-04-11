/** Toggle a value in a nullable string array. Returns null when empty. */
export function toggleArrayValue(arr: string[] | null, val: string): string[] | null {
  if (arr === null) return [val];
  if (arr.includes(val)) {
    const next = arr.filter((v) => v !== val);
    return next.length === 0 ? null : next;
  }
  return [...arr, val];
}
