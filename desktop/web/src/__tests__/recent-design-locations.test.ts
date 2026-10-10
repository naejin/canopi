import { describe, expect, it } from 'vitest'
import { recentDesignLocations } from '../app/recent-files/locations'

describe('recentDesignLocations', () => {
  it('leaves rows with a unique name alone', () => {
    expect(recentDesignLocations([
      { name: 'Orchard', path: '/d/orchard.canopi' },
      { name: 'Pond', path: '/d/orchard.canopi' },
    ])).toEqual([null, null])
  })

  it('names the file when the names match but the file names differ', () => {
    expect(recentDesignLocations([
      { name: 'Orchard', path: '/d/orchard.canopi' },
      { name: 'orchard', path: '/d/orchard-copy.canopi' },
    ])).toEqual([{ kind: 'file', text: 'orchard.canopi' }, { kind: 'file', text: 'orchard-copy.canopi' }])
  })

  it('names the shortest distinct folder when the file names match too, on any platform', () => {
    expect(recentDesignLocations([
      { name: 'Hedge', path: '/home/ana/2025/farm/hedge.canopi' },
      { name: 'Hedge', path: '/home/ana/2026/farm/hedge.canopi' },
      { name: 'Hedge', path: 'C:\\Users\\ana\\Desktop\\hedge.canopi' },
    ])).toEqual([
      { kind: 'folder', text: '2025/farm' },
      { kind: 'folder', text: '2026/farm' },
      { kind: 'folder', text: 'Desktop' },
    ])
  })

  it('names the file for a row whose file name is its own, and the folder for rows that share one', () => {
    expect(recentDesignLocations([
      { name: 'Hedge', path: '/a/hedge.canopi' },
      { name: 'Hedge', path: '/b/hedge.canopi' },
      { name: 'Hedge', path: '/a/hedge-old.canopi' },
    ])).toEqual([
      { kind: 'folder', text: 'a' },
      { kind: 'folder', text: 'b' },
      { kind: 'file', text: 'hedge-old.canopi' },
    ])
  })

  it('gives nothing for rows without a path', () => {
    expect(recentDesignLocations([{ name: 'A', path: undefined }, { name: 'A', path: undefined }])).toEqual([null, null])
  })
})
