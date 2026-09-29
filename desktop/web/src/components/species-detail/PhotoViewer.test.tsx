import { render } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import type { SpeciesPhoto } from './photo-attribution'
import { PhotoViewer, usePhotoList } from './PhotoViewer'
import styles from './SpeciesDetail.module.css'

function Host({ photos }: { readonly photos: readonly SpeciesPhoto[] }) {
  const model = usePhotoList(photos)
  return <PhotoViewer model={model} name="Malus domestica" linkSources />
}

const settle = () => new Promise(resolve => setTimeout(resolve, 80))

describe('usePhotoList', () => {
  let container: HTMLDivElement | null = null

  afterEach(() => {
    if (container) render(null, container)
    container?.remove()
    container = null
  })

  it('keeps a photo that loads before the new list settles', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const photo: SpeciesPhoto = { url: 'https://example.test/apple.jpg', credit: null, source: null, sourcePageUrl: null, license: null }

    render(<Host photos={[]} />, container)
    await settle()
    // No act(): a cached image fires `load` before Preact runs the list's deferred effects.
    render(<Host photos={[photo]} />, container)
    const image = container.querySelector<HTMLImageElement>('[data-testid="species-photo"]')
    expect(image).not.toBeNull()
    image!.dispatchEvent(new Event('load'))
    await settle()

    const shown = container.querySelector<HTMLImageElement>('[data-testid="species-photo"]')
    expect(shown?.classList.contains(styles.photoReady!)).toBe(true)
    expect(container.querySelector(`.${styles.shimmer!}`)).toBeNull()
  })
})
