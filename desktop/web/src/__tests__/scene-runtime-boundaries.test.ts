// Source rules over the canvas runtime that no import policy expresses: the Settled Scene Authority's write and history
// roles, typed Scene identity, the shared arrangement kernel, the interaction session's public seam, and the
// end-to-end suites' event harness. Kept from scene-interaction-tool-boundary.test.ts when the legacy bridge went (end
// of 0B); its tool rules and its single listener owner moved to the ToolHost's tests and the policies (plan §5).
import * as fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const { readFileSync } = fs
const fsWithDirectoryRead = fs as unknown as {
  readdirSync(
    path: URL,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function sourceUrl(path: string): URL {
  return new URL(path, import.meta.url)
}

/** The canvas interaction end-to-end suites and their shared setup, read as one source. */
function sceneInteractionSuitesSource(): string {
  const suites = fsWithDirectoryRead.readdirSync(sourceUrl('./'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^canvas-interaction-e2e\.[^.]+\.test\.ts$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  return [...suites, 'support/canvas-interaction-setup.ts'].map(readSource).join('\n')
}

function importSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:\bfrom\s+|^\s*import\s+)['"]([^'"]+)['"]/gm),
    (match) => match[1] ?? '',
  )
}

function importsSceneHistory(source: string): boolean {
  return importSpecifiers(source).some((specifier) =>
    /(?:^|\/)scene-history(?:\.[cm]?[jt]sx?)?$/.test(specifier),
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
      ) return []
      return [{ name: childPath, source: readSource(childPath) }]
    })
}

describe('Scene runtime module boundaries', () => {
  it('keeps persisted Scene writes behind the Settled Scene Authority', () => {
    const runtimeSources = runtimeModuleSources()
    const authorityPath = '../canvas/runtime/scene-runtime/transactions.ts'
    const concreteStoreOwners = [
      '../canvas/runtime/scene/store.ts',
      '../canvas/runtime/scene-runtime/construction.ts',
      authorityPath,
    ]
    const removedBypasses = [
      'historyRuntime',
      'SceneCommandRuntime',
      'currentPresentationRevision',
      'applyPresentationBackfillsIfCurrent',
    ]

    for (const { name, source } of runtimeSources) {
      for (const bypass of removedBypasses) expect(source, name).not.toContain(bypass)
      if (!concreteStoreOwners.includes(name)) {
        expect(source, `${name} should receive a read-only Scene role`).not.toMatch(
          /\bSceneStore\b/,
        )
      }
      if (name !== authorityPath) {
        expect(source, name).not.toContain('.updatePersisted(')
        expect(source, name).not.toContain('.restoreSnapshot(')
        expect(source, name).not.toContain('.commitReorigin(')
      }
      if (name !== '../canvas/runtime/scene-runtime.ts') {
        expect(source, name).not.toContain('_sceneStore.setSelection(')
      }
      if (
        name !== authorityPath
        && name !== '../canvas/runtime/scene-runtime/document.ts'
      ) {
        expect(source, name).not.toContain('.hydrate(')
      }
      if (importsSceneHistory(source)) {
        expect([authorityPath, '../canvas/runtime/scene-runtime/construction.ts']).toContain(name)
      }
    }

    const documentSource = readSource('../canvas/runtime/scene-runtime/document.ts')
    expect(documentSource).not.toContain('.updatePersisted(')
    expect(documentSource).not.toContain("from '../scene-history'")
    expect(documentSource).toContain('this._authority.hydrate(file,')
    expect(documentSource).toContain('this._authority.replaceDocument(file, {')
    expect(documentSource).toContain('token: CanvasDocumentReplacementToken,')
    expect(documentSource).toContain('this._authority.replaceDocument(file, {\n      token,')
    expect(documentSource).toContain('finalizeReplacement: () => void,')
    expect(documentSource).toContain('): CanvasDocumentReplacementReceipt {')
    expect(documentSource).toContain('return { callerFinalizerInvoked }')
    expect(documentSource).not.toContain('finalizeReplacement: () => void = () => {}')
    expect(documentSource.indexOf('this._prepareForDocumentReplacement()'))
      .toBeGreaterThan(documentSource.indexOf('this._authority.replaceDocument(file, {'))

    const toolActionsSource = readSource('../canvas/runtime/tools/tool-actions.ts')
    const dragOpsSource = readSource('../canvas/runtime/scene-runtime/drag-state.ts')
    expect(toolActionsSource).not.toContain('appendRectangleZone(store')
    expect(toolActionsSource).not.toContain('appendTextAnnotation(\n  store')
    expect(dragOpsSource).not.toContain('applySceneDragDelta(\n  store')
  })

  it('gives the runtime shell only explicit Scene read, session-write, and command roles', () => {
    const constructionSource = readSource('../canvas/runtime/scene-runtime/construction.ts')
    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')
    const storeSource = readSource('../canvas/runtime/scene/store.ts')

    expect(constructionSource).toContain('readonly sceneState: SceneStateReader')
    expect(constructionSource).toContain('readonly sceneSession: SceneSessionWriter')
    expect(constructionSource).toContain(
      'readonly sceneCommands: SceneEditCoordinator & SceneCommandAdmission',
    )
    expect(constructionSource).not.toContain('readonly sceneStore: SceneStore')
    expect(constructionSource).not.toContain('readonly sceneEdits: SceneRuntimeAuthority')
    expect(constructionSource).not.toContain('readonly mutations: SceneRuntimeMutationController')
    expect(constructionSource).not.toContain('readonly documents: SceneRuntimeDocumentBridge')
    expect(runtimeSource).not.toContain("SceneRuntimeConstruction['sceneStore']")
    expect(runtimeSource).not.toContain('this._construction.sceneStore')
    expect(runtimeSource).not.toContain("SceneRuntimeConstruction['sceneEdits']")
    const sessionWriterSource = storeSource.slice(
      storeSource.indexOf('export type SceneSessionWriter'),
      storeSource.indexOf('\n\nexport {'),
    )
    expect(sessionWriterSource).toContain(
      "'setSelection' | 'setHoveredTarget'",
    )
    expect(sessionWriterSource).not.toContain('setViewport')
    expect(sessionWriterSource).not.toContain('updateSession')
    expect(runtimeSource).toContain('this._sceneSession.setHoveredTarget(target)')
    expect(runtimeSource).not.toContain('this._sceneSession.updateSession(')
  })

  it('keeps typed Scene identity across production session and interaction boundaries', () => {
    const forbiddenRawIdentityNames = [
      'selectedEntityIds',
      'hoveredEntityId',
      'setHoveredEntityId',
      'getLockedSceneDesignObjectIds',
      'selectedTopLevelIds',
    ]

    const typedIdentitySources = runtimeModuleSources()

    for (const { name, source } of typedIdentitySources) {
      for (const forbidden of forbiddenRawIdentityNames) {
        expect(source, name).not.toContain(forbidden)
      }
    }
  })

  it('separates Scene history commands from persistence authority', () => {
    const commandSource = readSource('../canvas/runtime/command-surface.ts')
    const documentSource = readSource('../canvas/runtime/scene-runtime/document.ts')

    expect(commandSource).toContain('readonly history: SceneHistoryCommands')
    expect(commandSource).not.toContain('readonly history: SettledSceneHistory')
    expect(documentSource).toContain(
      'authority: SceneDocumentAuthority & ScenePersistenceAuthority',
    )
    expect(documentSource).not.toContain('SceneSavedCheckpoint')
    expect(documentSource).not.toContain('SettledSceneHistory')
  })

  it('recognizes SceneHistory imports independently of relative depth', () => {
    expect(importsSceneHistory("import type { SceneHistory } from '../../scene-history'"))
      .toBe(true)
    expect(importsSceneHistory("import { SceneHistory } from './scene-history.ts'"))
      .toBe(true)
    expect(importsSceneHistory("import { SceneHistoryTool } from './scene-history-tools'"))
      .toBe(false)
  })

  it('keeps broad Scene Interaction tests on the user-equivalent event harness', () => {
    const guardedSources = [
      sceneInteractionSuitesSource(),
      readSource('../canvas/runtime/scene-runtime.test.ts'),
    ]

    for (const source of guardedSources) {
      expect(source).toContain('createSceneInteractionEventHarness')
      expect(source).not.toMatch(/\._on[A-Z]/)
    }
  })

  it('keeps the public Scene Interaction seam limited to Session construction and lifecycle', () => {
    const sessionSource = readSource('../canvas/runtime/interaction-session.ts')
    const exportedNames = Array.from(
      sessionSource.matchAll(
        /^export\s+(?:(?:abstract|async|declare)\s+)*(?:interface|type|class|function|const|let|var|enum|namespace)\s+(\w+)/gm,
      ),
      (match) => match[1],
    )

    expect(Array.from(sessionSource.matchAll(/^export\b/gm))).toHaveLength(3)
    expect(exportedNames).toEqual([
      'SceneInteractionSessionDeps',
      'SceneInteractionSession',
      'createSceneInteractionSession',
    ])
    expect(sessionSource).not.toMatch(/^export\s+(?:default|\*|(?:type\s+)?\{)/m)
    expect(sessionSource).not.toContain('SceneInteractionFrameHandlers')
  })

  it('routes repeated Scene arrangement placement through the shared kernel', () => {
    const placementSource = readSource('../canvas/runtime/scene-runtime/arrangement-placement.ts')
    const clipboardSource = readSource('../canvas/runtime/scene-runtime/clipboard.ts')
    const mutationsSource = readSource('../canvas/runtime/scene-runtime/mutations.ts')
    const objectStampSource = readSource('../canvas/runtime/tools/object-stamp.ts')
    const savedStampSource = readSource('../canvas/runtime/tools/saved-object-stamp.ts')
    const stampGhostSource = readSource('../canvas/runtime/tools/stamp-rotation.ts')

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
    for (const source of [clipboardSource, objectStampSource, savedStampSource, stampGhostSource]) {
      expect(source).not.toContain('uniqueZoneName')
      expect(source).not.toContain('sourceToCloneId')
      expect(source).not.toContain('selectedTopLevelIds')
    }
  })
})
