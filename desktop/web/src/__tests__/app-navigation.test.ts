import { beforeEach, describe, expect, it } from 'vitest'
import { activePanel, navigateTo, sidePanel } from '../state/app'

beforeEach(() => {
  activePanel.value = 'canvas'
  sidePanel.value = null
})

describe('app navigation', () => {
  it('opens the location shell as a full-screen panel', () => {
    navigateTo('location')

    expect(activePanel.value).toBe('location')
    expect(sidePanel.value).toBe(null)
  })

  it('opens the plant database as a sidebar panel', () => {
    navigateTo('plant-db')

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
  })

  it('switches between the surviving sidebar panels', () => {
    navigateTo('plant-db')
    navigateTo('favorites')

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('favorites')
  })

  it('returns to the canvas-only layout when navigating home', () => {
    navigateTo('favorites')
    navigateTo('canvas')

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
  })

  it('routes sidebar navigation back through the canvas shell from location', () => {
    navigateTo('location')
    navigateTo('plant-db')

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
  })
})
