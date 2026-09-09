export interface LabelBounds { x: number; y: number; width: number; height: number }
const intersects = (a: LabelBounds, b: LabelBounds) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/** Screen-space buckets keep ordinary label admission local, including dense sites. */
export class LabelCollisionIndex {
  private readonly cells = new Map<string, LabelBounds[]>()
  private readonly large: LabelBounds[] = []
  private readonly all: LabelBounds[] = []

  add(rect: LabelBounds): void {
    this.all.push(rect)
    const keys = this.keys(rect)
    if (!keys) { this.large.push(rect); return }
    for (const key of keys) {
      const cell = this.cells.get(key)
      if (cell) cell.push(rect)
      else this.cells.set(key, [rect])
    }
  }

  overlaps(rect: LabelBounds): boolean {
    const keys = this.keys(rect)
    if (!keys) return this.all.some((other) => intersects(rect, other))
    return this.large.some((other) => intersects(rect, other))
      || keys.some((key) => this.cells.get(key)?.some((other) => intersects(rect, other)))
  }

  private keys(rect: LabelBounds): string[] | null {
    const left = Math.floor(rect.x / 64), top = Math.floor(rect.y / 64)
    const right = Math.floor((rect.x + rect.width) / 64), bottom = Math.floor((rect.y + rect.height) / 64)
    if ((right - left + 1) * (bottom - top + 1) > 256) return null
    const result: string[] = []
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) result.push(`${x}:${y}`)
    return result
  }
}
