import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  message: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: mocks.message,
}))

vi.mock('../i18n', () => ({
  t: (key: string) => {
    switch (key) {
      case 'canvas.file.save':
        return 'Save'
      case 'canvas.file.dontSave':
        return "Don't Save"
      case 'canvas.file.cancel':
        return 'Cancel'
      case 'canvas.file.saveBeforeClose':
        return 'Save before closing?'
      case 'canvas.file.saveBeforeCloseMessage':
        return 'You have unsaved changes. Save before closing?'
      default:
        return key
    }
  },
}))

import { confirmCloseWithUnsavedChanges } from '../app/shell/close-guard'

describe('close guard', () => {
  beforeEach(() => {
    mocks.message.mockReset()
  })

  it('returns save when the user chooses save', async () => {
    mocks.message.mockResolvedValue('Save')

    await expect(confirmCloseWithUnsavedChanges()).resolves.toBe('save')
  })

  it('returns discard when the user chooses dont save', async () => {
    mocks.message.mockResolvedValue("Don't Save")

    await expect(confirmCloseWithUnsavedChanges()).resolves.toBe('discard')
  })

  it('returns cancel when the user cancels the close prompt', async () => {
    mocks.message.mockResolvedValue('Cancel')

    await expect(confirmCloseWithUnsavedChanges()).resolves.toBe('cancel')
  })
})
