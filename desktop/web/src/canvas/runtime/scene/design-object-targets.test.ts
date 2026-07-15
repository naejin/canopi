import { describe, expect, it } from 'vitest'

import { sceneDesignObjectTargetsEqual } from './design-object-targets'

describe('Scene Design Object targets', () => {
  it('compares typed selection membership safely before normalization', () => {
    const duplicatePlants = [
      { kind: 'plant' as const, id: 'shared-id' },
      { kind: 'plant' as const, id: 'shared-id' },
    ]

    expect(sceneDesignObjectTargetsEqual(duplicatePlants, [
      { kind: 'plant', id: 'shared-id' },
      { kind: 'zone', id: 'other-id' },
    ])).toBe(false)
    expect(sceneDesignObjectTargetsEqual(duplicatePlants, [
      { kind: 'plant', id: 'shared-id' },
    ])).toBe(true)
  })
})
