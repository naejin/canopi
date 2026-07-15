import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('plant detail boundary', () => {
  it('keeps plant detail components free of direct species ipc imports', () => {
    const detailSource = readSource('../components/plant-detail/PlantDetailCard.tsx')
    const mediaSource = readSource('../components/plant-detail/PhotoCarousel.tsx')

    expect(detailSource).not.toContain('ipc/species')
    expect(mediaSource).not.toContain('ipc/species')
    expect(detailSource).toContain("from '../../app/plant-detail'")
    expect(mediaSource).toContain("from '../../app/plant-detail'")
  })
})
