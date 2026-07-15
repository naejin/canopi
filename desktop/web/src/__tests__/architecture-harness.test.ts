// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  createTypeScriptSourceGraph,
  parseTypeScriptSource,
} from './support/architecture/source-facts'
import { parseCssDeclarations } from './support/architecture/css-facts'
import {
  collectArchitecturePolicyViolations,
  collectCssPolicyViolations,
  matchesPathPattern,
} from './support/architecture/policy-harness'

describe('TypeScript architecture source facts', () => {
  it('parses static, type-only, mixed, dynamic, and re-export edges through the compiler AST', () => {
    const facts = parseTypeScriptSource('src/fixture.ts', `
      import defaultValue, { named as alias } from './static'
      import type { Shape } from './types'
      import { type MixedType, runtime } from './mixed'
      import * as namespace from './namespace'
      import './side-effect'
      const lazy = import('./lazy')
      export { exposed as renamed } from './reexport'
      export type { Model } from './models'
      export * from './all'
      void defaultValue
      void alias
      void runtime
      void namespace
      void lazy
    `)

    expect(facts.imports.map(({ kind, specifier, bindings }) => ({
      kind,
      specifier,
      bindings,
    }))).toEqual([
      {
        kind: 'static',
        specifier: './static',
        bindings: [
          { importedName: 'default', localName: 'defaultValue', typeOnly: false },
          { importedName: 'named', localName: 'alias', typeOnly: false },
        ],
      },
      {
        kind: 'static',
        specifier: './types',
        bindings: [{ importedName: 'Shape', localName: 'Shape', typeOnly: true }],
      },
      {
        kind: 'static',
        specifier: './mixed',
        bindings: [
          { importedName: 'MixedType', localName: 'MixedType', typeOnly: true },
          { importedName: 'runtime', localName: 'runtime', typeOnly: false },
        ],
      },
      {
        kind: 'static',
        specifier: './namespace',
        bindings: [{ importedName: '*', localName: 'namespace', typeOnly: false }],
      },
      { kind: 'static', specifier: './side-effect', bindings: [] },
      { kind: 'dynamic', specifier: './lazy', bindings: [] },
      {
        kind: 'reexport',
        specifier: './reexport',
        bindings: [{ importedName: 'exposed', localName: 'renamed', typeOnly: false }],
      },
      {
        kind: 'reexport',
        specifier: './models',
        bindings: [{ importedName: 'Model', localName: 'Model', typeOnly: true }],
      },
      {
        kind: 'reexport',
        specifier: './all',
        bindings: [{ importedName: '*', localName: '*', typeOnly: false }],
      },
    ])
    expect(facts.imports[1]).toMatchObject({
      line: 3,
      column: 7,
      typeOnly: true,
      target: './types',
      literalSpecifier: true,
      reexportAll: false,
    })
    expect({ ...facts.imports[1] }).toHaveProperty('target', './types')
  })

  it('resolves repository-relative modules to canonical source paths', () => {
    const graph = createTypeScriptSourceGraph([
      {
        path: 'src/app/entry.ts',
        source: `
          import { command } from '../canvas/command'
          export * from './feature'
          void import('../shared/lazy')
          import '../shared/module'
          import './settings.browser'
          import '#platform'
        `,
      },
      { path: 'src/canvas/command.ts', source: 'export const command = 1' },
      { path: 'src/app/feature/index.ts', source: 'export const feature = 1' },
      { path: 'src/shared/lazy.tsx', source: 'export const lazy = 1' },
      { path: 'src/shared/module.mts', source: 'export const moduleValue = 1' },
      { path: 'src/app/settings.browser.ts', source: 'export const settings = 1' },
    ])

    expect(graph[0]?.imports.map((edge) => edge.target)).toEqual([
      'src/canvas/command.ts',
      'src/app/feature/index.ts',
      'src/shared/lazy.tsx',
      'src/shared/module.mts',
      'src/app/settings.browser.ts',
      '#platform',
    ])
  })

  it('records module exports without leaking names exported only inside a namespace', () => {
    const facts = parseTypeScriptSource('src/fixture.ts', `
      export namespace Internal {
        export interface HiddenDetail {}
      }
      export interface PublicContract {}
    `)

    expect([...facts.exportedNames].sort()).toEqual(['Internal', 'PublicContract'])
  })

  it('tracks aliased and transitive wildcard exports for capability policies', () => {
    const graph = createTypeScriptSourceGraph([
      {
        path: 'src/capability.ts',
        source: 'export const internalCapability = Symbol()',
      },
      {
        path: 'src/alias.ts',
        source: "export { internalCapability as firstAlias } from './capability'",
      },
      {
        path: 'src/barrel.ts',
        source: "export * from './alias'",
      },
      {
        path: 'src/second-alias.ts',
        source: "export { firstAlias as secondAlias } from './alias'",
      },
      {
        path: 'src/default-declaration.ts',
        source: 'export default interface InternalDefaultCapability {}',
      },
      {
        path: 'src/default-expression.ts',
        source: 'const internalDefaultValue = Symbol()\nexport default internalDefaultValue',
      },
      {
        path: 'src/default-parenthesized.ts',
        source: 'const internalParenthesizedValue = Symbol()\nexport default (internalParenthesizedValue as symbol)',
      },
      {
        path: 'src/default-barrel.ts',
        source: "export { default as PublicDefault } from './default-expression'",
      },
      {
        path: 'src/namespace-barrel.ts',
        source: "export * as publicNamespace from './capability'",
      },
      {
        path: 'src/imported-alias.ts',
        source: `
          import { internalCapability as localAlias } from './capability'
          export { localAlias as importedPublic }
        `,
      },
      {
        path: 'src/imported-default.ts',
        source: `
          import localDefault from './default-expression'
          export { localDefault as importedDefaultPublic }
        `,
      },
      {
        path: 'src/imported-namespace.ts',
        source: `
          import * as localNamespace from './capability'
          export { localNamespace as importedNamespacePublic }
        `,
      },
      {
        path: 'src/imported-variable-alias.ts',
        source: `
          import { firstAlias as localAlias } from './alias'
          export const publicVariableAlias = (localAlias as symbol)
        `,
      },
    ])

    expect(collectArchitecturePolicyViolations(graph, [{
      kind: 'forbid-exports',
      name: 'Capability stays private',
      from: [
        'src/alias.ts',
        'src/barrel.ts',
        'src/second-alias.ts',
        'src/default-declaration.ts',
        'src/default-expression.ts',
        'src/default-parenthesized.ts',
        'src/default-barrel.ts',
        'src/namespace-barrel.ts',
        'src/imported-alias.ts',
        'src/imported-default.ts',
        'src/imported-namespace.ts',
        'src/imported-variable-alias.ts',
      ],
      names: [
        'internalCapability',
        'InternalDefaultCapability',
        'internalDefaultValue',
        'internalParenthesizedValue',
      ],
    }])).toEqual([
      '[Capability stays private] src/alias.ts exports forbidden symbol internalCapability',
      '[Capability stays private] src/barrel.ts exports forbidden symbol internalCapability',
      '[Capability stays private] src/second-alias.ts exports forbidden symbol internalCapability',
      '[Capability stays private] src/default-declaration.ts exports forbidden symbol InternalDefaultCapability',
      '[Capability stays private] src/default-expression.ts exports forbidden symbol internalDefaultValue',
      '[Capability stays private] src/default-parenthesized.ts exports forbidden symbol internalParenthesizedValue',
      '[Capability stays private] src/default-barrel.ts exports forbidden symbol internalDefaultValue',
      '[Capability stays private] src/namespace-barrel.ts exports forbidden symbol internalCapability',
      '[Capability stays private] src/imported-alias.ts exports forbidden symbol internalCapability',
      '[Capability stays private] src/imported-default.ts exports forbidden symbol internalDefaultValue',
      '[Capability stays private] src/imported-namespace.ts exports forbidden symbol internalCapability',
      '[Capability stays private] src/imported-variable-alias.ts exports forbidden symbol internalCapability',
    ])
  })

  it('represents non-literal dynamic imports explicitly and rejects them by policy', () => {
    const graph = createTypeScriptSourceGraph([{
      path: 'src/web/consumer.ts',
      source: 'const target = "../ipc/design"\nvoid import(target)',
    }])

    expect(graph[0]?.imports[0]).toMatchObject({
      kind: 'dynamic',
      literalSpecifier: false,
    })
    expect(collectArchitecturePolicyViolations(graph, [{
      kind: 'forbid-nonliteral-dynamic-imports',
      name: 'Production imports stay statically analyzable',
      from: ['src/**'],
    }])).toEqual([
      '[Production imports stay statically analyzable] src/web/consumer.ts:2:6 imports <non-literal dynamic import: target> via "<non-literal dynamic import: target>" (dynamic)',
    ])
  })

  it('reports named declarative policy violations with importer and target context', () => {
    const graph = createTypeScriptSourceGraph([
      {
        path: 'src/web/page.ts',
        source: `
          import { save } from '../ipc/design'
          export { secret } from '../app/secret'
        `,
      },
      { path: 'src/app/other.ts', source: "import { secret } from './secret'" },
      { path: 'src/ipc/design.ts', source: 'export const save = 1' },
      { path: 'src/app/secret.ts', source: 'export const secret = 1' },
      {
        path: 'src/canvas/projection.ts',
        source: 'export interface ProjectionBackend {}',
      },
      {
        path: 'src/app/secret-user.ts',
        source: `
          export const leaked = captureForPersistence
          locale.value = 'fr'
          export const options = { markDirty: false }
        `,
      },
    ])

    expect(collectArchitecturePolicyViolations(graph, [
      {
        kind: 'forbid-imports',
        name: 'Web sources cannot import IPC',
        from: ['src/web/**'],
        targets: ['src/ipc/**'],
      },
      {
        kind: 'confine-importers',
        name: 'Secret capability stays confined',
        targets: ['src/app/secret.ts'],
        allowedFrom: ['src/web/page.ts'],
      },
      {
        kind: 'forbid-exports',
        name: 'Projection exposes operations, not strategies',
        from: ['src/canvas/projection.ts'],
        names: ['ProjectionBackend'],
      },
      {
        kind: 'confine-symbols',
        name: 'Persistence capture stays in its owner',
        from: ['src/app/**'],
        names: ['captureForPersistence'],
        allowedFrom: ['src/app/document-session/persistence.ts'],
      },
      {
        kind: 'forbid-writes',
        name: 'Settings writes cross the projection',
        from: ['src/app/**'],
        targets: ['locale.value'],
      },
      {
        kind: 'forbid-writes',
        name: 'Dirty bypasses stay retired',
        from: ['src/app/**'],
        properties: ['markDirty'],
        values: ['false'],
      },
    ])).toEqual([
      '[Web sources cannot import IPC] src/web/page.ts:2:11 imports src/ipc/design.ts via "../ipc/design" (static)',
      '[Secret capability stays confined] src/app/other.ts:1:1 imports src/app/secret.ts via "./secret" (static); allowed importers: src/web/page.ts',
      '[Projection exposes operations, not strategies] src/canvas/projection.ts exports forbidden symbol ProjectionBackend',
      '[Persistence capture stays in its owner] src/app/secret-user.ts contains confined symbol captureForPersistence; allowed sources: src/app/document-session/persistence.ts',
      '[Settings writes cross the projection] src/app/secret-user.ts:3 writes locale.value = \'fr\'',
      '[Dirty bypasses stay retired] src/app/secret-user.ts:4 writes markDirty = false',
    ])
  })

  it('matches recursive policy globs at both the root and nested directories', () => {
    expect(matchesPathPattern('src/__tests__/root.test.ts', 'src/__tests__/**/*.test.ts')).toBe(true)
    expect(matchesPathPattern('src/__tests__/nested/leaf.test.ts', 'src/__tests__/**/*.test.ts')).toBe(true)
    expect(matchesPathPattern('src/app/entry.ts', 'src/app/**')).toBe(true)
    expect(matchesPathPattern('src/application/entry.ts', 'src/app/**')).toBe(false)
  })

  it('fails closed when a policy that defines a required owner loses its exact source', () => {
    const graph = createTypeScriptSourceGraph([
      { path: 'src/existing.ts', source: 'export const value = 1' },
    ])

    expect(collectArchitecturePolicyViolations(graph, [
      {
        kind: 'require-imports',
        name: 'Required owner',
        from: ['src/missing-owner.ts'],
        targets: ['src/dependency.ts'],
      },
      {
        kind: 'named-imports',
        name: 'Named consumer',
        from: ['src/missing-consumer.ts'],
        target: 'src/dependency.ts',
        requiredNames: ['value'],
        allowedNames: ['value'],
      },
      {
        kind: 'forbid-exports',
        name: 'Public facade',
        from: ['src/missing-facade.ts'],
        names: ['privateValue'],
      },
      {
        kind: 'forbid-imports',
        name: 'Negative owner',
        from: ['src/missing-negative-owner.ts'],
        targets: ['src/dependency.ts'],
      },
      {
        kind: 'forbid-source-symbols',
        name: 'Symbol owner',
        from: ['src/missing-symbol-owner.ts'],
        names: ['privateValue'],
      },
      {
        kind: 'forbid-writes',
        name: 'Write owner',
        from: ['src/missing-write-owner.ts'],
        targets: ['state.value'],
      },
      {
        kind: 'forbid-calls',
        name: 'Call owner',
        from: ['src/missing-call-owner.ts'],
        targets: ['privateCall'],
      },
    ])).toEqual([
      '[Required owner] required policy source is missing: src/missing-owner.ts',
      '[Named consumer] required policy source is missing: src/missing-consumer.ts',
      '[Public facade] required policy source is missing: src/missing-facade.ts',
      '[Negative owner] required policy source is missing: src/missing-negative-owner.ts',
      '[Symbol owner] required policy source is missing: src/missing-symbol-owner.ts',
      '[Write owner] required policy source is missing: src/missing-write-owner.ts',
      '[Call owner] required policy source is missing: src/missing-call-owner.ts',
    ])
  })

  it('distinguishes member calls from similarly named mock properties', () => {
    const graph = createTypeScriptSourceGraph([{
      path: 'src/__tests__/consumer.test.ts',
      source: `
        const mock = { getSceneStore: () => store }
        runtime.getSceneStore()
        runtime['getSceneStore']()
        const { getSceneStore } = runtime
        getSceneStore()
        void mock
      `,
    }])

    expect(collectArchitecturePolicyViolations(graph, [
      {
        kind: 'forbid-calls',
        name: 'Tests use public runtime member surfaces',
        from: ['src/__tests__/**/*.test.ts'],
        properties: ['getSceneStore'],
      },
      {
        kind: 'forbid-calls',
        name: 'Tests use public runtime direct surfaces',
        from: ['src/__tests__/**/*.test.ts'],
        targets: ['getSceneStore'],
      },
    ])).toEqual([
      '[Tests use public runtime member surfaces] src/__tests__/consumer.test.ts:3 calls runtime.getSceneStore',
      '[Tests use public runtime member surfaces] src/__tests__/consumer.test.ts:4 calls runtime[\'getSceneStore\']',
      '[Tests use public runtime direct surfaces] src/__tests__/consumer.test.ts:6 calls getSceneStore',
    ])
  })
})

describe('CSS architecture source facts', () => {
  it('parses multiline and commented declarations without treating comments as code', () => {
    const declarations = parseCssDeclarations('src/fixture.module.css', `
      .item {
        /* padding: 99px; */
        padding:
          var(--space-2)
          calc(var(--space-1) + 1px);
        transition:
          opacity var(--transition-fast),
          transform var(--transition-normal);
      }

      @media (prefers-reduced-motion: reduce) {
        .item { transition: none }
      }
    `)

    expect(declarations.map(({ property, value }) => ({ property, value }))).toEqual([
      {
        property: 'padding',
        value: 'var(--space-2)\n          calc(var(--space-1) + 1px)',
      },
      {
        property: 'transition',
        value: 'opacity var(--transition-fast),\n          transform var(--transition-normal)',
      },
      { property: 'transition', value: 'none' },
    ])
    expect(declarations.map(({ line }) => line)).toEqual([4, 7, 13])
  })

  it('requires tokenized declarations while honoring exact reviewed structural exceptions', () => {
    const files = [{
      path: 'src/fixture.module.css',
      declarations: parseCssDeclarations('src/fixture.module.css', `
        .good { padding: var(--space-2); transition: none; }
        .structural { border-radius: 0 1px 1px 0; }
        .bad { font-size: 13px; gap: 6px; transition: opacity 150ms ease; }
      `),
    }]

    expect(collectCssPolicyViolations(files, [
      {
        name: 'Font sizes use tokens',
        properties: ['font-size'],
        rawValue: /\d+(?:\.\d+)?px/,
        requiredValue: /var\(--/,
        exceptions: [],
      },
      {
        name: 'Spacing uses tokens',
        properties: ['padding*', 'margin*', 'gap', 'row-gap', 'column-gap'],
        rawValue: /\d+(?:\.\d+)?px/,
        requiredValue: /var\(--/,
        exceptions: [],
      },
      {
        name: 'Radii use tokens',
        properties: ['border-radius'],
        rawValue: /\d+(?:\.\d+)?px/,
        requiredValue: /var\(--/,
        exceptions: [{
          file: 'src/fixture.module.css',
          rule: '.structural',
          atRules: [],
          property: 'border-radius',
          value: '0 1px 1px 0',
          reason: 'One-pixel structural edge cap.',
        }],
      },
      {
        name: 'Transitions use tokens',
        properties: ['transition', 'transition-*'],
        rawValue: /\d+(?:\.\d+)?(?:ms|s)/,
        requiredValue: /var\(--/,
        exceptions: [],
      },
    ])).toEqual([
      '[Font sizes use tokens] src/fixture.module.css:4 font-size: 13px',
      '[Spacing uses tokens] src/fixture.module.css:4 gap: 6px',
      '[Transitions use tokens] src/fixture.module.css:4 transition: opacity 150ms ease',
    ])
  })

  it('fails closed for duplicate, unexplained, and unused CSS exceptions', () => {
    const files = [{
      path: 'src/fixture.module.css',
      declarations: parseCssDeclarations(
        'src/fixture.module.css',
        '.item { gap: 6px; }',
      ),
    }]
    const matchingException = {
      file: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'gap',
      value: '6px',
      reason: '',
    }

    expect(collectCssPolicyViolations(files, [{
      name: 'Spacing uses tokens',
      properties: ['gap'],
      rawValue: /px/,
      requiredValue: /var\(--space-/,
      exceptions: [
        matchingException,
        { ...matchingException, reason: 'Duplicate exception.' },
        {
          ...matchingException,
          value: '7px',
          reason: 'No declaration should need this exception.',
        },
      ],
    }])).toEqual([
      '[Spacing uses tokens] CSS exception reason is empty: src/fixture.module.css|<root>|.item|gap|6px',
      '[Spacing uses tokens] duplicate CSS exception: src/fixture.module.css|<root>|.item|gap|6px',
      '[Spacing uses tokens] unused CSS exception: src/fixture.module.css|<root>|.item|gap|7px (No declaration should need this exception.)',
    ])
  })

  it('consumes CSS exceptions once and keeps at-rule contexts distinct', () => {
    const files = [{
      path: 'src/fixture.module.css',
      declarations: parseCssDeclarations('src/fixture.module.css', `
        .item { gap: 6px; }
        .item { gap: 6px; }
        @media (min-width: 1px) {
          .item { gap: 6px; }
        }
      `),
    }]

    expect(collectCssPolicyViolations(files, [{
      name: 'Spacing uses tokens',
      properties: ['gap'],
      rawValue: /px/,
      requiredValue: /var\(--space-/,
      exceptions: [{
        file: 'src/fixture.module.css',
        rule: '.item',
        atRules: [],
        property: 'gap',
        value: '6px',
        reason: 'One reviewed root declaration.',
      }],
    }])).toEqual([
      '[Spacing uses tokens] src/fixture.module.css:3 gap: 6px',
      '[Spacing uses tokens] src/fixture.module.css:5 gap: 6px',
    ])
    expect(files[0]?.declarations[2]?.atRules).toEqual(['@media (min-width: 1px)'])
  })
})
