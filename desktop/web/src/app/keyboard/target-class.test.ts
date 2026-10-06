import { afterEach, describe, expect, it } from 'vitest'
import { classifyKeyTarget } from './target-class'

const NO_PRESS = { onMap: false, inDock: false }

function mapHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

function child(host: HTMLElement, html: string): HTMLElement {
  host.insertAdjacentHTML('beforeend', html)
  return host.lastElementChild as HTMLElement
}

describe('classifyKeyTarget', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('gives a focused zone corner inside the map host the map, so the map keys (Delete, Esc, undo) reach it', () => {
    const host = mapHost()
    const corner = child(host, '<div role="button" tabindex="0" data-canvas-handle="vertex:z:3" data-canvas-handle-glyph="vertex"></div>')
    expect(classifyKeyTarget(corner, host, false, NO_PRESS).focus).toBe('map')
  })

  it('keeps the rotate button and the other controls inside the map host their own keys', () => {
    const host = mapHost()
    const rotate = child(host, '<div role="button" tabindex="-1" data-canvas-handle="rotate:z" data-canvas-handle-glyph="rotate"></div>')
    const button = child(host, '<button type="button">Fit</button>')
    const roleButton = child(host, '<div role="button" tabindex="0"></div>')
    expect(classifyKeyTarget(rotate, host, false, NO_PRESS).focus).toBe('other')
    expect(classifyKeyTarget(button, host, false, NO_PRESS).focus).toBe('other')
    expect(classifyKeyTarget(roleButton, host, false, NO_PRESS).focus).toBe('other')
  })

  it('leaves a zone corner outside the map host to the page', () => {
    const host = mapHost()
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    const corner = child(elsewhere, '<div role="button" tabindex="0" data-canvas-handle="vertex:z:3" data-canvas-handle-glyph="vertex"></div>')
    expect(classifyKeyTarget(corner, host, false, NO_PRESS).focus).toBe('other')
  })
})
