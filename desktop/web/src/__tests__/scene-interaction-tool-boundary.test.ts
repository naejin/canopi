import * as fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const { existsSync, readFileSync } = fs
const fsWithDirectoryRead = fs as unknown as {
  readdirSync(
    path: URL,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function sourceExists(path: string): boolean {
  return existsSync(new URL(path, import.meta.url))
}

function sourceUrl(path: string): URL {
  return new URL(path, import.meta.url)
}

function importSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:\bfrom\s+|^\s*import\s+)['"]([^'"]+)['"]/gm),
    (match) => match[1] ?? '',
  )
}

function runtimeModuleSources(
  path = '../canvas/runtime/',
): Array<{ readonly name: string; readonly source: string }> {
  const directory = sourceUrl(path)
  return fsWithDirectoryRead.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const childPath = `${path.replace(/\/$/, '')}/${entry.name}`
      if (entry.isDirectory()) return runtimeModuleSources(`${childPath}/`)
      if (
        !entry.isFile()
        || !entry.name.endsWith('.ts')
        || entry.name.endsWith('.test.ts')
        || childPath === '../canvas/runtime/scene-interaction.ts'
      ) return []
      return [{ name: childPath, source: readSource(childPath) }]
    })
}

describe('Scene Interaction tool module boundaries', () => {
  it('keeps broad Scene Interaction tests on the user-equivalent event harness', () => {
    const guardedSources = [
      readSource('scene-interaction.test.ts'),
      readSource('../canvas/runtime/scene-runtime.test.ts'),
    ]

    for (const source of guardedSources) {
      expect(source).toContain('createSceneInteractionEventHarness')
      expect(source).not.toMatch(/\._on[A-Z]/)
    }
  })

  it('keeps Scene Interaction listener and lifecycle ownership in the Session', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')

    expect(interactionSource).toContain('createSceneInteractionSession')
    expect(interactionSource).toContain("addEventListener('pointerdown'")
    expect(interactionSource).toContain("removeEventListener('pointerdown'")
    expect(interactionSource).toContain("addEventListener('pointercancel'")
    expect(interactionSource).toContain("removeEventListener('pointercancel'")
    expect(interactionSource).toContain("addEventListener('blur'")
    expect(interactionSource).toContain("removeEventListener('blur'")
    expect(interactionSource).toContain('_cancelTransientInteraction')
    expect(interactionSource).toContain('_cancelPendingInteractionHostFocus')
    expect(interactionSource).toContain('_selectionToolbar.dispose()')
    expect(sourceExists('../canvas/runtime/interaction/frame.ts')).toBe(false)
  })

  it('keeps the public Scene Interaction seam limited to Session construction and lifecycle', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const exportedNames = Array.from(
      interactionSource.matchAll(
        /^export\s+(?:(?:abstract|async|declare)\s+)*(?:interface|type|class|function|const|let|var|enum|namespace)\s+(\w+)/gm,
      ),
      (match) => match[1],
    )

    expect(Array.from(interactionSource.matchAll(/^export\b/gm))).toHaveLength(3)
    expect(exportedNames).toEqual([
      'SceneInteractionSessionDeps',
      'SceneInteractionSession',
      'createSceneInteractionSession',
    ])
    expect(interactionSource).not.toMatch(/^export\s+(?:default|\*|(?:type\s+)?\{)/m)
    expect(interactionSource).not.toContain('SceneInteractionFrameHandlers')
  })

  it('prevents canvas runtime modules from acquiring a second host-listener or pointer-session owner', () => {
    for (const { name, source } of runtimeModuleSources()) {
      expect(source, name).not.toMatch(/window\.(?:add|remove)EventListener/)
      expect(source, name).not.toMatch(/(?:\bcontainer|\.container)\.(?:add|remove)EventListener/)
      expect(source, name).not.toContain('SceneInteractionFrame')
      expect(source, name).not.toMatch(/from ['"][^'"]*interaction\/frame['"]/)
    }
  })

  it('keeps shared selection gesture algorithms behind the Session seam', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const sharedGesturesSource = readSource('../canvas/runtime/interaction/shared-gestures.ts')

    expect(interactionSource).toContain('createSceneInteractionSharedGestures')
    expect(interactionSource).not.toContain("this._mode === 'dragging'")
    expect(interactionSource).not.toContain("this._mode === 'band'")
    expect(interactionSource).not.toContain("this._mode === 'panning'")
    expect(interactionSource).not.toContain('captureSceneDragState')
    expect(interactionSource).not.toContain('queryRectTopLevel')
    expect(interactionSource).not.toContain('interaction-drag')
    expect(sharedGesturesSource).toContain('captureSceneDragState')
    expect(sharedGesturesSource).toContain('queryRectTopLevel')
    expect(sharedGesturesSource).toContain('interaction-drag')
  })

  it('keeps the tool registry focused on adapter construction and identity', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const registrySource = readSource('../canvas/runtime/interaction/tool-modules.ts')

    expect(registrySource).toContain('createSceneToolRegistry')
    expect(registrySource).toContain('activeAdapter')
    expect(registrySource).toContain('select(toolName: string)')
    expect(registrySource).not.toContain('SceneToolModules')
    expect(registrySource).not.toContain('transitionTo(')
    expect(registrySource).not.toContain('pointerMoveWithCapture(context')
    expect(interactionSource).toContain('this._activeToolAdapter()?.pointerDown?.(')
    expect(interactionSource).toContain('this._activeToolAdapter()?.pointerMoveWithCapture?.(')
  })

  it('keeps Annotation Text creation editor state behind the text tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const toolModulesSource = readSource('../canvas/runtime/interaction/tool-modules.ts')
    const textToolSource = readSource('../canvas/runtime/interaction/text-annotation-tool.ts')
    const inlineEditorSource = readSource('../canvas/runtime/interaction/annotation-inline-editor.ts')

    expect(interactionSource).toContain('createSceneToolRegistry')
    expect(interactionSource).not.toContain('createTextAnnotationTool')
    expect(interactionSource).not.toContain('createTextAnnotationToolAdapter')
    expect(interactionSource).toContain('createAnnotationInlineEditor')
    expect(toolModulesSource).toContain('createTextAnnotationTool')
    expect(toolModulesSource).toContain('createTextAnnotationToolAdapter')
    expect(interactionSource).not.toContain('_textTool')
    expect(interactionSource).not.toContain('HTMLTextAreaElement')
    expect(interactionSource).not.toContain('_textarea')
    expect(interactionSource).not.toContain('_textWorldPosition')
    expect(textToolSource).toContain('appendTextAnnotationToDraft')
    expect(textToolSource).toContain('createTextAnnotationToolAdapter')
    expect(inlineEditorSource).toContain('HTMLTextAreaElement')
    expect(inlineEditorSource).toContain('hasActiveEditor')
  })

  it('keeps Zone drawing draft state behind the zone drawing tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const toolModulesSource = readSource('../canvas/runtime/interaction/tool-modules.ts')
    const zoneToolSource = readSource('../canvas/runtime/interaction/zone-drawing-tool.ts')

    expect(interactionSource).toContain('createSceneToolRegistry')
    expect(interactionSource).not.toContain('createZoneDrawingTool')
    expect(interactionSource).not.toContain('createZoneDrawingToolAdapters')
    expect(toolModulesSource).toContain('createZoneDrawingTool')
    expect(toolModulesSource).toContain('createZoneDrawingToolAdapters')
    expect(interactionSource).not.toContain('_zoneDrawing')
    expect(interactionSource).not.toContain('hasPolygonDraft')
    expect(interactionSource).not.toContain('preservePolygonDraft')
    expect(interactionSource).not.toContain('_polygonDraftVertices')
    expect(interactionSource).not.toContain('_polygonActiveWorld')
    expect(interactionSource).not.toContain('appendRectangleZoneToDraft')
    expect(interactionSource).not.toContain('appendEllipseZoneToDraft')
    expect(interactionSource).not.toContain('appendPolygonZoneToDraft')
    expect(zoneToolSource).toContain('appendRectangleZoneToDraft')
    expect(zoneToolSource).toContain('appendEllipseZoneToDraft')
    expect(zoneToolSource).toContain('appendPolygonZoneToDraft')
    expect(zoneToolSource).toContain('createZoneDrawingToolAdapters')
  })

  it('keeps Object Stamp source state behind the object stamp tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const toolModulesSource = readSource('../canvas/runtime/interaction/tool-modules.ts')
    const objectStampSource = readSource('../canvas/runtime/interaction/object-stamp-tool.ts')

    expect(interactionSource).toContain('createSceneToolRegistry')
    expect(interactionSource).not.toContain('createObjectStampTool')
    expect(interactionSource).not.toContain('createObjectStampToolAdapter')
    expect(toolModulesSource).toContain('createObjectStampTool')
    expect(toolModulesSource).toContain('createObjectStampToolAdapter')
    expect(interactionSource).not.toContain('_objectStampTool')
    expect(interactionSource).not.toContain('_objectStampSource')
    expect(interactionSource).not.toContain('_sampleObjectStampSource')
    expect(interactionSource).not.toContain('_placeObjectStamp')
    expect(objectStampSource).toContain('ObjectStampSource')
    expect(objectStampSource).toContain('cloneGroupMembersForObjectStamp')
    expect(objectStampSource).toContain('createObjectStampToolAdapter')
  })

  it('routes repeated Scene arrangement placement through the shared kernel', () => {
    const placementSource = readSource('../canvas/runtime/scene-runtime/arrangement-placement.ts')
    const clipboardSource = readSource('../canvas/runtime/scene-runtime/clipboard.ts')
    const mutationsSource = readSource('../canvas/runtime/scene-runtime/mutations.ts')
    const objectStampSource = readSource('../canvas/runtime/interaction/object-stamp-tool.ts')
    const savedStampSource = readSource('../canvas/runtime/interaction/saved-object-stamp-tool.ts')

    expect(placementSource).toContain('createSceneArrangementPlacement')
    expect(new Set(importSpecifiers(placementSource))).toEqual(new Set([
      '../../../utils/ids',
      '../scene',
      './transactions',
    ]))
    expect(clipboardSource).toContain('createClipboardArrangementTemplate')
    for (const source of [mutationsSource, objectStampSource, savedStampSource]) {
      expect(source).toContain('createSceneArrangementPlacement')
    }
    for (const source of [clipboardSource, objectStampSource, savedStampSource]) {
      expect(source).not.toContain('uniqueZoneName')
      expect(source).not.toContain('sourceToCloneId')
      expect(source).not.toContain('selectedTopLevelIds')
    }
  })

  it('keeps Plant Stamp placement state behind the plant stamp tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const toolModulesSource = readSource('../canvas/runtime/interaction/tool-modules.ts')
    const plantStampSource = readSource('../canvas/runtime/interaction/plant-stamp-tool.ts')
    const sourceSeam = readSource('../canvas/plant-stamp-source.ts')

    expect(interactionSource).toContain('createSceneToolRegistry')
    expect(interactionSource).not.toContain('createPlantStampTool')
    expect(interactionSource).not.toContain('createPlantStampToolAdapter')
    expect(toolModulesSource).toContain('createPlantStampTool')
    expect(toolModulesSource).toContain('createPlantStampToolAdapter')
    expect(interactionSource).not.toContain('plantStampSpecies')
    expect(interactionSource).not.toContain('_placePlantFromStamp')
    expect(interactionSource).not.toContain("this._tool === 'plant-stamp'")
    expect(plantStampSource).toContain('readPlantStampSource')
    expect(plantStampSource).toContain('appendPlantStampSourceToDraft')
    expect(sourceSeam).toContain('selectedPlantStampSource')
    expect(sourceSeam).toContain('writePlantStampDragData')
    expect(sourceSeam).toContain('readPlantStampDragData')
  })

  it('keeps Plant Spacing source state behind the plant spacing tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const toolModulesSource = readSource('../canvas/runtime/interaction/tool-modules.ts')
    const plantSpacingSource = readSource('../canvas/runtime/interaction/plant-spacing-tool.ts')

    expect(interactionSource).toContain('createSceneToolRegistry')
    expect(interactionSource).not.toContain('createPlantSpacingTool')
    expect(interactionSource).not.toContain('createPlantSpacingToolAdapter')
    expect(toolModulesSource).toContain('createPlantSpacingTool')
    expect(toolModulesSource).toContain('createPlantSpacingToolAdapter')
    expect(interactionSource).not.toContain('_plantSpacingTool')
    expect(interactionSource).not.toContain('shouldBeginDrag')
    expect(interactionSource).not.toContain('updatePreviewFromEvent')
    expect(interactionSource).not.toContain('commitDragFromEvent')
    expect(interactionSource).not.toContain('_plantSpacingSource')
    expect(interactionSource).not.toContain('_plantSpacingIntervalText')
    expect(interactionSource).not.toContain('_plantSpacingGeneratedPositions')
    expect(interactionSource).not.toContain('_commitPlantSpacingPreview')
    expect(plantSpacingSource).toContain('PlantSpacingSource')
    expect(plantSpacingSource).toContain('createPlantSpacingOverlay')
    expect(plantSpacingSource).toContain('createPlantSpacingToolAdapter')
    expect(plantSpacingSource).toContain('readPlantSpacingIntervalMeters')
    expect(plantSpacingSource).toContain('commitPlantSpacingIntervalMeters')
    expect(toolModulesSource).toContain('readPlantSpacingIntervalMeters: context.readPlantSpacingIntervalMeters')
    expect(toolModulesSource).toContain('commitPlantSpacingIntervalMeters: context.commitPlantSpacingIntervalMeters')
    expect(plantSpacingSource).not.toContain('../../../app/settings')
    expect(plantSpacingSource).not.toContain('../../../app/canvas-settings')
  })

  it('keeps representative Plant Spacing behavior coverage in focused tool tests', () => {
    const broadInteractionTestSource = readSource('scene-interaction.test.ts')

    expect(sourceExists('plant-spacing-tool.test.ts')).toBe(true)
    const plantSpacingToolTestSource = readSource('plant-spacing-tool.test.ts')
    expect(plantSpacingToolTestSource).toContain('createPlantSpacingToolAdapter')
    expect(broadInteractionTestSource).not.toContain(
      'reads and commits Plant Spacing interval through interaction dependencies',
    )
  })

  it('keeps active tool drag state generic in the Scene Interaction Session', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')

    expect(interactionSource).toContain('ToolPointerDrag')
    expect(interactionSource).not.toContain("'plant-spacing-drag'")
    expect(interactionSource).not.toContain("this._mode = 'rectangle'")
    expect(interactionSource).not.toContain("this._mode = 'ellipse'")
    expect(interactionSource).not.toContain("this._mode === 'rectangle'")
    expect(interactionSource).not.toContain("this._mode === 'ellipse'")
  })
})
