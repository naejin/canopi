import { afterEach, describe, expect, it, vi } from 'vitest'

const dialog = vi.hoisted(() => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialog.open, save: vi.fn() }))

import { openDesignDialog } from '../ipc/design'
import { designSessionFixture } from './support/design-session-state'

afterEach(() => {
  designSessionFixture.path = null
  dialog.open.mockClear()
})

describe('the Open dialog starts in the current Design’s folder', () => {
  it.each([
    ['/home/ana/Designs/orchard.canopi', '/home/ana/Designs/'],
    ['C:\\Users\\Ana\\Designs\\orchard.canopi', 'C:\\Users\\Ana\\Designs\\'],
  ])('%s', async (path, folder) => {
    designSessionFixture.path = path
    await expect(openDesignDialog()).rejects.toThrow('Dialog cancelled')
    expect(dialog.open).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: folder }))
  })
})
