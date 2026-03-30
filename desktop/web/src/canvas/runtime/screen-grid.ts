import Konva from 'konva'

export interface ScreenPlant {
  group: Konva.Group
  sx: number
  sy: number
}

export class ScreenGrid {
  private readonly _cells = new Map<string, ScreenPlant[]>()

  constructor(private readonly _cellSize: number) {}

  rebuild(plants: ScreenPlant[]): void {
    this._cells.clear()
    for (const plant of plants) {
      const key = this._keyFor(plant.sx, plant.sy)
      const current = this._cells.get(key)
      if (current) {
        current.push(plant)
      } else {
        this._cells.set(key, [plant])
      }
    }
  }

  queryNeighbors(x: number, y: number, radius: number): ScreenPlant[] {
    const minX = Math.floor((x - radius) / this._cellSize)
    const maxX = Math.floor((x + radius) / this._cellSize)
    const minY = Math.floor((y - radius) / this._cellSize)
    const maxY = Math.floor((y + radius) / this._cellSize)
    const results: ScreenPlant[] = []

    for (let cellX = minX; cellX <= maxX; cellX++) {
      for (let cellY = minY; cellY <= maxY; cellY++) {
        const cell = this._cells.get(`${cellX}:${cellY}`)
        if (cell) results.push(...cell)
      }
    }

    return results
  }

  private _keyFor(x: number, y: number): string {
    return `${Math.floor(x / this._cellSize)}:${Math.floor(y / this._cellSize)}`
  }
}
