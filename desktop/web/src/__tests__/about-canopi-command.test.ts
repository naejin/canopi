import { describe, expect, it } from 'vitest'
import { appCommandGraphChromeProjection } from '../commands/registry'

describe('About Canopi command', () => {
  it('appears in the Help menu', () => {
    const helpMenu = appCommandGraphChromeProjection.value.menus.find((menu) => menu.id === 'help')
    const labels = helpMenu?.items
      .filter((item) => item.type === 'action')
      .map((item) => item.label)

    expect(labels).toContain('About Canopi')
  })
})
