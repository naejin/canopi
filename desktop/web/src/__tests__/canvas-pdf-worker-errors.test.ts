import { expect, it, vi } from 'vitest'
vi.mock('../app/canvas-pdf/prepare', () => ({ preparePdf: vi.fn() }))
import { preparePdf } from '../app/canvas-pdf/prepare'
import '../app/canvas-pdf/worker'
it('reports excessive coverage through the actual worker boundary', async () => {
  const post = vi.spyOn(self, 'postMessage').mockImplementation(() => {})
  vi.mocked(preparePdf).mockRejectedValueOnce(new Error('coverage-too-large'))
  try {
    await self.onmessage!.call(self, new MessageEvent('message', { data: {} }))
    expect(post).toHaveBeenCalledWith({ error: 'coverage-too-large' })
  } finally { post.mockRestore(); self.onmessage = null }
})
