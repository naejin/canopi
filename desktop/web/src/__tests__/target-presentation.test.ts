import { afterEach, describe, expect, it } from 'vitest'
import {
  createPanelTargetPresentationController,
  getCanvasHoveredSpeciesCanonical,
  getSpeciesCanonicalFromTargets,
  setCanvasHoveredTargets,
} from '../app/panel-targets/presentation'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from '../app/panel-targets/state'
import { MANUAL_TARGET, speciesBudgetTarget, speciesTarget } from '../target'

describe('Target Presentation', () => {
  afterEach(() => {
    hoveredCanvasTargets.value = []
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
  })

  it('keeps origin-owned selection lifecycle behind the presentation controller', () => {
    const budgetPresentation = createPanelTargetPresentationController('budget')
    const timelinePresentation = createPanelTargetPresentationController('timeline')

    budgetPresentation.setSelectedTargets([speciesBudgetTarget('Malus domestica')])

    const budgetSelection = budgetPresentation.readSelection()
    const timelineSelection = timelinePresentation.readSelection()

    expect(
      budgetPresentation.selectionMatches(
        budgetSelection,
        [speciesBudgetTarget('Malus domestica')],
      ),
    ).toBe(true)
    expect(
      timelinePresentation.selectionMatches(
        timelineSelection,
        [speciesBudgetTarget('Malus domestica')],
      ),
    ).toBe(false)

    timelinePresentation.pruneSelection([])
    expect(selectedPanelTargets.value).toEqual([speciesBudgetTarget('Malus domestica')])
    expect(selectedPanelTargetOrigin.value).toBe('budget')

    budgetPresentation.pruneSelection([[speciesBudgetTarget('Prunus avium')]])
    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
  })

  it('bridges canvas-origin and panel-origin species hover through Target values', () => {
    const consortiumPresentation = createPanelTargetPresentationController('consortium')

    setCanvasHoveredTargets([MANUAL_TARGET, speciesTarget('Acer campestre')])

    expect(getSpeciesCanonicalFromTargets(hoveredCanvasTargets.value)).toBe('Acer campestre')
    expect(getCanvasHoveredSpeciesCanonical()).toBe('Acer campestre')
    expect(consortiumPresentation.readCanvasHoveredSpeciesCanonical()).toBe('Acer campestre')

    consortiumPresentation.setHoveredSpecies('Malus domestica')
    expect(hoveredPanelTargets.value).toEqual([speciesTarget('Malus domestica')])

    consortiumPresentation.clearHoveredTargets()
    expect(hoveredPanelTargets.value).toEqual([])
  })

  it('cleans up only the selected targets owned by its origin', () => {
    const budgetPresentation = createPanelTargetPresentationController('budget')
    const timelinePresentation = createPanelTargetPresentationController('timeline')

    budgetPresentation.setHoveredTargets([speciesTarget('Hovered')])
    timelinePresentation.setSelectedTargets([speciesTarget('Timeline selected')])

    budgetPresentation.dispose()

    expect(hoveredPanelTargets.value).toEqual([])
    expect(selectedPanelTargets.value).toEqual([speciesTarget('Timeline selected')])
    expect(selectedPanelTargetOrigin.value).toBe('timeline')

    timelinePresentation.dispose()

    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
  })
})
