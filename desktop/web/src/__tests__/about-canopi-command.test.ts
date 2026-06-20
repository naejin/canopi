import { describe, expect, it } from 'vitest'
import { getMenuDefinitions } from '../commands/registry'

describe('About Canopi command', () => {
  it('appears in the Help menu', () => {
    const helpMenu = getMenuDefinitions().find((menu) => menu.id === 'help')
    const labels = helpMenu?.items
      .filter((item) => item.type === 'action')
      .map((item) => item.label)

    expect(labels).toContain('About Canopi')
  })
})
