// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  createTypeScriptSourceGraph,
  discoverTypeScriptSourceGraph,
} from './support/architecture/source-facts'
import {
  collectArchitecturePolicyViolations,
  type ArchitecturePolicy,
} from './support/architecture/policy-harness'

const TEST_SOURCE_PATTERNS = [
  'src/__tests__/**',
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
] as const

const FORBIDDEN_IMPORT_POLICIES = [
  {
    kind: 'forbid-nonliteral-dynamic-imports',
    name: 'Production imports stay statically analyzable',
    from: ['src/**'],
    exceptFrom: [...TEST_SOURCE_PATTERNS],
  },
  {
    kind: 'forbid-imports',
    name: 'Production code cannot import frontend test support',
    from: ['src/**'],
    exceptFrom: [...TEST_SOURCE_PATTERNS],
    targets: [...TEST_SOURCE_PATTERNS],
  },
  {
    kind: 'forbid-imports',
    name: 'Web entry stays outside the Desktop app graph',
    from: ['src/main.web.tsx'],
    targets: ['src/app.tsx', 'src/app/**', '@tauri-apps/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Web Edition sources stay free of Desktop-only capabilities',
    from: ['src/web/**'],
    targets: [
      '@tauri-apps/**',
      'src/ipc/**',
      'src/components/shared/TitleBar.tsx',
      'src/components/shared/MenuBar.tsx',
      'src/components/shared/ProblemReportDialog.tsx',
      'src/components/panels/DesignNotebookPanel.tsx',
      'src/components/panels/CanvasPanel.tsx',
      'src/components/canvas/BottomPanel.tsx',
      'src/components/canvas/TimelineTab.tsx',
      'src/components/canvas/BudgetTab.tsx',
      'src/components/canvas/ConsortiumChart.tsx',
      'src/components/canvas/DisplayLegend.tsx',
      'src/app/design-notebook/**',
      'src/app/document-session/actions.ts',
      'src/app/document-session/lifecycle.ts',
      'src/app/document-session/transition.ts',
      'src/app/document-session/state-machine.ts',
      'src/app/problem-report/**',
      'src/app/location/index.ts',
      'src/app/location/coordinate-workbench.ts',
      'src/app/location/search-controller.ts',
      'src/commands/registry.ts',
      'src/commands/graph/**',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Settings Projection stays platform-neutral',
    from: ['src/app/settings/projection.ts'],
    targets: ['src/ipc/settings.ts', 'src/web/browser-app-data.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Web Species detail stays behind the reduced adapter',
    from: ['src/web/WebSpeciesCatalogPanel.tsx'],
    targets: ['src/components/plant-detail/**', 'src/app/plant-detail/**', 'src/ipc/species.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Workflow components do not import Design IPC',
    from: ['src/components/shared/WelcomeScreen.tsx', 'src/components/canvas/BudgetTab.tsx'],
    targets: ['src/ipc/design.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Runtime does not import app-owned Panel Target state',
    from: ['src/canvas/runtime/scene-runtime.ts', 'src/canvas/runtime/scene-runtime/effects.ts'],
    targets: ['src/app/panel-targets/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Panel Target adapters do not bypass presentation ownership',
    from: [
      'src/app/canvas-runtime/panel-target-adapter.ts',
      'src/app/canvas-map-surface/snapshot.ts',
      'src/components/canvas/maplibre-surface-controller.ts',
    ],
    targets: ['src/app/panel-targets/state.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Map surface controller reads the app snapshot instead of authorities',
    from: ['src/components/canvas/maplibre-surface-controller.ts'],
    targets: [
      'src/maplibre/loader.ts',
      'src/canvas/session.ts',
      'src/app/location/index.ts',
      'src/app/settings/state.ts',
      'src/canvas/scene-metadata-state.ts',
      'src/app/canvas-settings/signals.ts',
      'src/app/panel-targets/presentation.ts',
      'src/app/panel-targets/state.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'MapLibre Host stays infrastructure-only',
    from: ['src/maplibre/host.ts'],
    targets: [
      'src/app.tsx',
      'src/app/**',
      'src/components/**',
      'src/app/document-session/**',
      'src/app/canvas-map-surface/**',
      'src/app/panel-targets/**',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Map Surface lifecycle does not depend on retired component loaders',
    from: ['src/app/canvas-map-surface/lifecycle.ts'],
    targets: ['src/components/canvas/maplibre-loader.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Map Surface snapshot does not bypass presentation seams',
    from: ['src/app/canvas-map-surface/snapshot.ts'],
    targets: [
      'src/app/canvas-settings/signals.ts',
      'src/app/document-session/store.ts',
      'src/canvas/scene-metadata-state.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Runtime reads do not depend on mirror modules',
    from: ['src/canvas/runtime/**'],
    exceptFrom: [
      'src/canvas/runtime/**/*.test.ts',
      'src/canvas/runtime/**/*.test.tsx',
      'src/canvas/runtime/scene-runtime/scene-sync.ts',
    ],
    targets: ['src/canvas/scene-metadata-state.ts', 'src/canvas/runtime-mirror-state.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas guides do not read scene metadata mirrors',
    from: ['src/canvas/guides.ts'],
    targets: ['src/canvas/scene-metadata-state.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'App-facing tests use explicit Canvas Runtime surfaces',
    from: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    exceptFrom: [
      'src/__tests__/canvas-runtime-surfaces.test.ts',
      'src/__tests__/frontend-architecture-policies.test.ts',
    ],
    targets: ['src/canvas/runtime/scene-runtime.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Layer Panel renders Canvas Layer Presentation',
    from: ['src/components/canvas/LayerPanel.tsx'],
    targets: ['src/app/canvas-settings/state.ts', 'src/app/canvas-settings/controller.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Planning Projection does not depend on Canvas2D renderers',
    from: ['src/app/planning-projection/consortium.ts'],
    targets: ['src/canvas/consortium-renderer.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas2D consortium renderer does not depend on Planning Projection',
    from: ['src/canvas/consortium-renderer.ts'],
    targets: ['src/app/planning-projection/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Live Species Catalog Workbench stays behind platform adapters',
    from: ['src/app/plant-browser/workbench.ts'],
    targets: ['src/ipc/species.ts', 'src/ipc/favorites.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Command Registry depends only on the command graph interface',
    from: ['src/commands/registry.ts'],
    targets: [
      'src/commands/graph/catalog.ts',
      'src/commands/graph/projections.ts',
      'src/commands/graph/shortcuts.ts',
      'src/app/canvas-settings/signals.ts',
      'src/app/settings/state.ts',
      'src/i18n/index.ts',
      'src/shortcuts/definitions.ts',
      'src/canvas/session.ts',
      'src/canvas/runtime/interaction/pointer-utils.ts',
      'src/app/shell/state.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Command consumers do not bypass the registry',
    from: [
      'src/shortcuts/manager.ts',
      'src/components/shared/MenuBar.tsx',
      'src/components/panels/PanelBar.tsx',
      'src/components/canvas/CanvasToolbar.tsx',
      'src/components/shared/menu-definitions.ts',
      'src/components/shared/CommandPalette.tsx',
    ],
    targets: ['src/commands/graph/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Command consumers do not bypass their projections',
    from: ['src/shortcuts/manager.ts'],
    targets: ['src/app/document-session/actions.ts', 'src/canvas/session.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Menu Bar does not own session or Canvas state',
    from: ['src/components/shared/MenuBar.tsx'],
    targets: ['src/app/document-session/store.ts', 'src/canvas/session.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Panel Bar does not own shell or settings state',
    from: ['src/components/panels/PanelBar.tsx'],
    targets: [
      'src/app/document-session/store.ts',
      'src/app/shell/state.ts',
      'src/app/settings/state.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Toolbar does not mutate Canvas settings directly',
    from: ['src/components/canvas/CanvasToolbar.tsx'],
    targets: ['src/app/canvas-settings/signals.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Command Palette does not own shortcut registration',
    from: ['src/components/shared/CommandPalette.tsx'],
    targets: ['src/shortcuts/manager.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Design Template common orchestration stays platform-neutral',
    from: [
      'src/app/community/controller.ts',
      'src/app/design-template-import/coordinator.ts',
      'src/app/design-template-import/types.ts',
      'src/app/design-template-import/workflow.ts',
    ],
    targets: ['src/ipc/community.ts', 'src/app/document-session/actions.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Browser Design Template adapters stay free of Desktop IPC',
    from: [
      'src/app/design-template-import/workflow.browser.ts',
      'src/app/community/catalog.browser.ts',
    ],
    targets: ['src/ipc/community.ts', 'src/app/document-session/actions.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'World Map requests MapLibre through the Surface Adapter',
    from: ['src/components/world-map/WorldMapSurface.tsx'],
    targets: ['maplibre-gl'],
  },
  {
    kind: 'forbid-imports',
    name: 'Production app and components do not import MapLibre directly',
    from: ['src/app/**', 'src/components/**'],
    targets: ['maplibre-gl'],
  },
  {
    kind: 'forbid-imports',
    name: 'Planning surfaces do not read Canvas or document authorities directly',
    from: [
      'src/components/canvas/BudgetTab.tsx',
      'src/components/canvas/InteractiveTimeline.tsx',
      'src/components/canvas/ConsortiumChart.tsx',
    ],
    targets: [
      'src/canvas/runtime-mirror-state.ts',
      'src/canvas/session.ts',
      'src/app/document-session/store.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Budget component uses its Workbench instead of projection or export internals',
    from: ['src/components/canvas/BudgetTab.tsx'],
    targets: [
      'src/app/planning-projection/**',
      'src/app/budget/controller.ts',
      'src/app/budget/export.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Budget export stays outside Design IPC and component code',
    from: ['src/app/budget/export.ts'],
    targets: ['src/ipc/design.ts', 'src/components/canvas/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Planning Projection runtime does not use retired mirrors',
    from: ['src/app/planning-projection/runtime.ts'],
    targets: ['src/canvas/runtime-mirror-state.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'App presentation layers do not import retired runtime mirrors',
    from: ['src/app/**', 'src/components/**', 'src/maplibre/**'],
    targets: ['src/canvas/runtime-mirror-state.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Document Session workflows do not own stores or Canvas sessions',
    from: ['src/app/document-session/workflows.ts'],
    targets: [
      '@preact/signals',
      'src/canvas/session.ts',
      'src/app/document/controller.ts',
      'src/app/document-session/store.ts',
      'src/app/consortium/time-model.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Consortium workflow does not depend on its orchestrators',
    from: ['src/app/consortium/workflow.ts'],
    targets: [
      'src/app/document-session/lifecycle.ts',
      'src/app/document-session/state-machine.ts',
      'src/app/document-session/workflows.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Non-canvas Design writes do not use retired controller seams',
    from: ['src/app/**', 'src/components/**'],
    exceptFrom: ['src/app/design-edit/**'],
    targets: [
      'src/app/document/controller.ts',
      'src/app/document/edit-transaction.ts',
      'src/app/budget/controller.ts',
      'src/app/timeline/controller.ts',
      'src/app/consortium/controller.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Planning Projection does not own Target presentation lifecycle',
    from: ['src/app/planning-projection/index.ts'],
    targets: ['src/app/planning-projection/target-presentation.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Document Session lifecycle does not call Design IPC directly',
    from: ['src/app/document-session/lifecycle.ts'],
    targets: ['src/ipc/design.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Design Session replacement stays platform-neutral',
    from: ['src/app/document-session/replacement.ts'],
    targets: ['@tauri-apps/**', 'src/ipc/**', 'src/web/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Design persistence does not orchestrate workflows or Scene edits',
    from: ['src/app/document-session/persistence.ts'],
    targets: [
      'src/app/consortium/workflow.ts',
      'src/app/document-session/workflow-runner.ts',
      'src/app/document-session/workflows.ts',
      'src/canvas/runtime/scene-runtime/transactions.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Runtime clean-state code does not import the Design Session store',
    from: [
      'src/canvas/runtime/scene-history.ts',
      'src/canvas/runtime/scene-runtime.ts',
      'src/canvas/runtime/scene-runtime/construction.ts',
    ],
    targets: ['src/app/document-session/store.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Runtime document code does not import app document composition',
    from: ['src/canvas/runtime/scene-runtime/document.ts', 'src/canvas/runtime/scene-runtime.ts'],
    targets: ['src/app/contracts/document.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Runtime settings stay behind the App Adapter',
    from: [
      'src/canvas/runtime/scene-runtime.ts',
      'src/canvas/runtime/scene-runtime/effects.ts',
      'src/canvas/runtime/scene-runtime/scene-sync.ts',
      'src/canvas/runtime/scene-interaction.ts',
    ],
    targets: ['src/app/settings/**', 'src/app/canvas-settings/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Runtime presentation data stays behind the App Adapter',
    from: ['src/canvas/runtime/scene-runtime/construction.ts'],
    targets: ['src/canvas/runtime/plant-labels.ts', 'src/canvas/runtime/species-cache.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas Runtime core stays free of app imports',
    from: ['src/canvas/runtime/**'],
    exceptFrom: ['src/canvas/runtime/**/*.test.ts', 'src/canvas/runtime/**/*.test.tsx'],
    targets: ['src/app.tsx', 'src/app/**'],
  },
  {
    kind: 'forbid-transitive-imports',
    name: 'Canvas Runtime translations and settings stay behind the App Adapter',
    from: ['src/canvas/runtime/**'],
    exceptFrom: ['src/canvas/runtime/**/*.test.ts', 'src/canvas/runtime/**/*.test.tsx'],
    targets: ['src/i18n/**', 'src/app/settings/**', 'src/app/canvas-settings/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Problem Report dialog delegates to the submission module',
    from: ['src/components/shared/ProblemReportDialog.tsx'],
    targets: [
      'src/app/problem-report/diagnostics.ts',
      'src/app/problem-report/attachments.ts',
      'src/ipc/problem-report.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Problem Report attachments observe through session transition',
    from: ['src/app/problem-report/attachments.ts'],
    targets: [
      'src/app/document-session/persistence.ts',
      'src/app/document-session/store.ts',
      'src/canvas/session.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Planning Canvas does not depend on Scene interaction internals',
    from: ['src/app/planning-canvas/interaction-frame.ts'],
    targets: ['src/canvas/runtime/interaction/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Scene interaction does not depend on Planning Canvas',
    from: ['src/canvas/runtime/scene-interaction.ts'],
    targets: ['src/app/planning-canvas/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Timeline component renders through the Timeline Canvas module',
    from: ['src/components/canvas/InteractiveTimeline.tsx'],
    targets: [
      'src/app/timeline/controller.ts',
      'src/app/settings/state.ts',
      'src/canvas/timeline-renderer.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Timeline Canvas barrel exposes only the host model',
    from: ['src/app/timeline/canvas/index.ts'],
    targets: [
      'src/app/timeline/canvas/controller.ts',
      'src/app/timeline/canvas/interaction-frame.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Timeline host does not own interaction internals',
    from: ['src/app/timeline/canvas/host-model.ts'],
    targets: [
      'src/app/timeline/canvas/interaction-frame.ts',
      'src/app/timeline/interaction.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Canvas document hook delegates runtime and transition ownership',
    from: ['src/app/document-session/use-canvas-document-session.ts'],
    targets: [
      'src/canvas/runtime/scene-runtime.ts',
      'src/canvas/runtime/surfaces.ts',
      'src/app/document-session/transition.ts',
      'src/app/document-session/persistence.ts',
      'src/app/document-session/state-machine.ts',
      'src/ipc/**',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Design Session lifecycle does not construct runtime internals',
    from: ['src/app/document-session/lifecycle.ts'],
    targets: [
      'src/canvas/runtime/scene-runtime.ts',
      'src/canvas/runtime/surfaces.ts',
      'src/app/document-session/persistence.ts',
      'src/app/document-session/state-machine.ts',
    ],
  },
  {
    kind: 'forbid-imports',
    name: 'Timeline component stays behind the Timeline Canvas barrel',
    from: ['src/components/canvas/InteractiveTimeline.tsx'],
    targets: ['src/app/timeline/**', 'src/app/design-edit/**'],
    exceptTargets: ['src/app/timeline/canvas/index.ts'],
  },
  {
    kind: 'forbid-imports',
    name: 'Consortium component delegates document edits to its Workbench',
    from: ['src/components/canvas/ConsortiumChart.tsx'],
    targets: ['src/app/consortium/interaction.ts', 'src/app/design-edit/**'],
  },
  {
    kind: 'forbid-imports',
    name: 'Canonical projection math and precision policy have no dependencies',
    from: ['src/canvas/projection.ts'],
    targets: ['**'],
    edgeKinds: ['static', 'dynamic', 'import-type', 'reexport'],
  },
  {
    kind: 'forbid-imports',
    name: 'Scene physical extent depends only on canonical Zone geometry',
    from: ['src/canvas/runtime/scene-physical-extent.ts'],
    targets: ['**'],
    exceptTargets: ['src/canvas/runtime/zone-geometry.ts'],
    allowTypeOnlyTargets: ['src/canvas/runtime/scene/index.ts'],
    edgeKinds: ['static', 'dynamic', 'import-type', 'reexport'],
  },
] satisfies readonly ArchitecturePolicy[]

const CONFINED_IMPORTER_POLICIES = [
  {
    kind: 'confine-importers',
    name: 'Web settings mutations use the shared Settings Projection',
    from: ['src/web/**'],
    targets: ['src/app/settings/projection.ts'],
    allowedFrom: ['src/web/BrowserAppShell.tsx', 'src/web/browser-canvas-runtime.ts'],
  },
  {
    kind: 'confine-importers',
    name: 'Species Catalog state stays private to its Workbench',
    targets: ['src/app/plant-browser/search-session.ts'],
    allowedFrom: [
      'src/app/plant-browser/workbench.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'confine-importers',
    name: 'Prepared Design write destinations stay in persistence adapters',
    targets: ['src/app/document-session/write-admission.ts'],
    allowedFrom: [
      'src/app/document-session/persistence.ts',
      'src/ipc/design.ts',
      'src/web/browser-design-session.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'confine-importers',
    name: 'Persistence capture capability stays private',
    targets: ['src/app/document-session/persistence-capability.ts'],
    allowedFrom: [
      'src/app/document-session/persistence.ts',
      'src/app/document-session/store.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'confine-importers',
    name: 'Design Edit authority capability stays private',
    targets: ['src/app/design-edit/authority-capability.ts'],
    allowedFrom: [
      'src/app/design-edit/core.ts',
      'src/app/design-edit/index.ts',
      'src/app/document-session/store.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'confine-importers',
    name: 'Generated Species Search facts stay behind the shared normalizer',
    targets: ['src/generated/species-search-normalization.ts'],
    allowedFrom: [
      'src/utils/species-search-normalization.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
] satisfies readonly ArchitecturePolicy[]

const REQUIRED_IMPORT_POLICIES = [
  {
    kind: 'require-imports',
    name: 'Species Search consumers delegate shared normalization',
    from: [
      'src/app/plant-browser/search-session.ts',
      'src/web/reduced-species-catalog.ts',
      'src/web/duckdb-wasm-catalog.ts',
    ],
    targets: ['src/utils/species-search-normalization.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Control Point adapters delegate shared lifecycle ownership',
    from: [
      'src/canvas/runtime/interaction/zone-control-points.ts',
      'src/canvas/runtime/interaction/measurement-guide-control-points.ts',
    ],
    targets: ['src/canvas/runtime/interaction/control-point-overlay.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Panel resize surfaces delegate pointer lifecycle ownership',
    from: [
      'src/app.tsx',
      'src/components/canvas/BottomPanel.tsx',
      'src/components/panels/FavoritesPanel.tsx',
    ],
    targets: ['src/components/shared/usePointerResize.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Desktop and Web entries select a compile-time platform adapter',
    from: ['src/main.tsx', 'src/main.web.tsx'],
    targets: ['#platform'],
  },
  {
    kind: 'require-imports',
    name: 'Web entry installs MapLibre styles',
    from: ['src/main.web.tsx'],
    targets: ['maplibre-gl/dist/maplibre-gl.css'],
  },
  {
    kind: 'require-imports',
    name: 'Platform bootstraps install their settings adapters',
    from: ['src/platform/browser.ts'],
    targets: ['src/platform/settings.browser.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Desktop bootstrap installs its settings adapter',
    from: ['src/platform/desktop.ts'],
    targets: ['src/platform/settings.desktop.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Web settings callers mutate through the shared projection',
    from: ['src/web/BrowserAppShell.tsx', 'src/web/browser-canvas-runtime.ts'],
    targets: ['src/app/settings/projection.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Panel Target adapters consume presentation, not state',
    from: ['src/app/canvas-runtime/panel-target-adapter.ts', 'src/app/canvas-map-surface/snapshot.ts'],
    targets: ['src/app/panel-targets/presentation.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Panel Target presentation owns its signal state',
    from: ['src/app/panel-targets/presentation.ts'],
    targets: ['src/app/panel-targets/state.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Canvas Map Surface controller reads the app snapshot',
    from: ['src/components/canvas/maplibre-surface-controller.ts'],
    targets: ['src/app/canvas-map-surface/snapshot.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Canvas Map Surface snapshot composes presentation authorities',
    from: ['src/app/canvas-map-surface/snapshot.ts'],
    targets: [
      'src/canvas/session.ts',
      'src/app/canvas-layer-presentation/presentation.ts',
      'src/app/location/index.ts',
      'src/app/panel-targets/presentation.ts',
    ],
  },
  {
    kind: 'require-imports',
    name: 'Canvas Map Surface lifecycle requests low-level map ownership',
    from: ['src/app/canvas-map-surface/lifecycle.ts'],
    targets: ['src/maplibre/surface-adapter.ts', 'src/maplibre/host.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Target barrel exposes identity, resolution, and map projection',
    from: ['src/target/index.ts'],
    targets: [
      'src/target/identity.ts',
      'src/target/resolution.ts',
      'src/target/map-projection.ts',
    ],
    edgeKinds: ['reexport'],
  },
  {
    kind: 'require-imports',
    name: 'Map overlays and Canvas Runtime consume the Target module',
    from: ['src/maplibre/canvas-overlays.ts', 'src/canvas/runtime/scene-runtime.ts'],
    targets: ['src/target/index.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Live Species Catalog selects a compile-time adapter',
    from: ['src/app/plant-browser/index.ts'],
    targets: ['#species-catalog-live'],
  },
  {
    kind: 'require-imports',
    name: 'Saved Object Stamp live owner constructs its Workbench',
    from: ['src/app/saved-object-stamps/index.ts'],
    targets: ['src/app/saved-object-stamps/workbench.ts'],
    edgeKinds: ['static'],
  },
  {
    kind: 'require-imports',
    name: 'Command graph composes its catalog and projections',
    from: ['src/commands/graph/index.ts'],
    targets: [
      'src/commands/graph/catalog.ts',
      'src/commands/graph/projections.ts',
      'src/commands/graph/shortcuts.ts',
    ],
  },
  {
    kind: 'require-imports',
    name: 'Command projections consume the catalog',
    from: ['src/commands/graph/projections.ts', 'src/commands/graph/shortcuts.ts'],
    targets: ['src/commands/graph/catalog.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Command Registry consumes the graph interface',
    from: ['src/commands/registry.ts'],
    targets: ['src/commands/graph/index.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Command consumers depend on the registry',
    from: [
      'src/shortcuts/manager.ts',
      'src/components/panels/PanelBar.tsx',
      'src/components/canvas/CanvasToolbar.tsx',
      'src/components/shared/menu-definitions.ts',
      'src/components/shared/CommandPalette.tsx',
    ],
    targets: ['src/commands/registry.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Menu Bar consumes menu definitions',
    from: ['src/components/shared/MenuBar.tsx'],
    targets: ['src/components/shared/menu-definitions.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Design Template orchestration selects platform adapters',
    from: ['src/app/community/controller.ts'],
    targets: ['src/app/design-template-import/workflow.ts', '#design-template-catalog'],
  },
  {
    kind: 'require-imports',
    name: 'Design Template workflow selects platform implementation',
    from: ['src/app/design-template-import/workflow.ts'],
    targets: ['#design-template-import-workflow'],
  },
  {
    kind: 'require-imports',
    name: 'Desktop Design Template adapters own IPC',
    from: ['src/app/design-template-import/workflow.desktop.ts'],
    targets: ['src/app/document-session/actions.ts', 'src/ipc/community.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Browser Design Template workflow owns browser ingestion',
    from: ['src/app/design-template-import/workflow.browser.ts'],
    targets: [
      'src/app/contracts/design-ingestion.ts',
      'src/web/browser-design-session.ts',
    ],
  },
  {
    kind: 'require-imports',
    name: 'Desktop Design Template catalog owns Community IPC',
    from: ['src/app/community/catalog.desktop.ts'],
    targets: ['src/ipc/community.ts'],
  },
  {
    kind: 'require-imports',
    name: 'World Map uses the MapLibre Surface Adapter',
    from: ['src/components/world-map/WorldMapSurface.tsx'],
    targets: ['src/maplibre/surface-adapter.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Layer Panel consumes Canvas Layer Presentation',
    from: ['src/components/canvas/LayerPanel.tsx'],
    targets: ['src/app/canvas-layer-presentation/presentation.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Species Catalog UI consumes the public Workbench',
    from: [
      'src/components/panels/PlantDbPanel.tsx',
      'src/components/panels/FavoritesPanel.tsx',
      'src/components/plant-db/SearchBar.tsx',
      'src/components/plant-db/ResultsList.tsx',
      'src/components/plant-db/FilterStrip.tsx',
      'src/components/plant-db/ActiveChips.tsx',
      'src/components/plant-db/MoreFiltersPanel.tsx',
      'src/components/plant-db/PlantRow.tsx',
      'src/components/plant-db/PlantCard.tsx',
      'src/components/plant-db/ViewModeToggle.tsx',
    ],
    targets: ['src/app/plant-browser/index.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Plant cards use the shared stamp source',
    from: ['src/components/plant-db/PlantRow.tsx', 'src/components/plant-db/PlantCard.tsx'],
    targets: ['src/canvas/plant-stamp-source.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Budget surface uses its Workbench',
    from: ['src/components/canvas/BudgetTab.tsx'],
    targets: ['src/app/budget/workbench.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Budget Workbench consumes Planning Projection and Design Edit',
    from: ['src/app/budget/workbench.ts'],
    targets: ['src/app/planning-projection/index.ts', 'src/app/design-edit/index.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Budget export owns export IPC',
    from: ['src/app/budget/export.ts'],
    targets: ['src/ipc/export.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Planning Projection runtime reads Canvas and document query authorities',
    from: ['src/app/planning-projection/runtime.ts'],
    targets: ['src/canvas/session.ts', 'src/app/document-session/store.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Document workflows invoke the Consortium workflow',
    from: ['src/app/document-session/workflows.ts'],
    targets: ['src/app/consortium/workflow.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Consortium workflow owns Design Edit and workflow execution',
    from: ['src/app/consortium/workflow.ts'],
    targets: [
      'src/canvas/session.ts',
      'src/app/design-edit/index.ts',
      'src/app/document-session/store.ts',
      'src/app/document-session/workflow-runner.ts',
      'src/app/consortium/time-model.ts',
    ],
  },
  {
    kind: 'require-imports',
    name: 'Non-canvas Design writers consume Design Edit',
    from: [
      'src/app/location/controller.ts',
      'src/app/budget/workbench.ts',
      'src/app/timeline/workbench.ts',
      'src/app/timeline/interaction.ts',
      'src/app/consortium/interaction.ts',
      'src/app/consortium/workflow.ts',
    ],
    targets: ['src/app/design-edit/index.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Design Edit core owns the document store capability',
    from: ['src/app/design-edit/core.ts'],
    targets: ['src/app/document-session/store.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Planning workbenches consume Target presentation',
    from: [
      'src/app/budget/workbench.ts',
      'src/app/timeline/workbench.ts',
      'src/app/consortium/workbench.ts',
    ],
    targets: ['src/app/panel-targets/presentation.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Canvas document hook delegates to Design Session lifecycle',
    from: ['src/app/document-session/use-canvas-document-session.ts'],
    targets: ['src/app/document-session/lifecycle.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Design Session state machine composes persistence and workflows',
    from: ['src/app/document-session/state-machine.ts'],
    targets: [
      'src/app/document-session/persistence.ts',
      'src/app/document-session/replacement.ts',
      'src/app/document-session/workflow-runner.ts',
      'src/app/document-session/workflows.ts',
    ],
  },
  {
    kind: 'require-imports',
    name: 'Browser Design Session composes shared persistence and replacement',
    from: ['src/web/browser-design-session.ts'],
    targets: [
      'src/app/document-session/persistence.ts',
      'src/app/document-session/replacement.ts',
    ],
  },
  {
    kind: 'require-imports',
    name: 'Canvas Runtime app adapter owns document and store integration',
    from: ['src/app/canvas-runtime/app-adapter.ts'],
    targets: [
      'src/canvas/runtime/app-adapter.ts',
      'src/app/document-session/store.ts',
      'src/app/contracts/document.ts',
    ],
  },
  {
    kind: 'require-imports',
    name: 'Canvas Runtime host constructs the app adapter',
    from: ['src/app/canvas-runtime/host.ts'],
    targets: ['src/app/canvas-runtime/app-adapter.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Canvas Runtime construction consumes its core App Adapter contract',
    from: ['src/canvas/runtime/scene-runtime/construction.ts'],
    targets: ['src/canvas/runtime/app-adapter.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Canvas Runtime document bridge consumes its document adapter contract',
    from: ['src/canvas/runtime/scene-runtime/document.ts'],
    targets: ['src/canvas/runtime/app-adapter.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Browser Canvas Runtime uses detached presentation data',
    from: ['src/web/browser-canvas-runtime.ts'],
    targets: ['src/canvas/runtime/presentation-data.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Problem Report dialog consumes submission',
    from: ['src/components/shared/ProblemReportDialog.tsx'],
    targets: ['src/app/problem-report/submission.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Problem Report attachments observe Design Session transition',
    from: ['src/app/problem-report/attachments.ts'],
    targets: ['src/app/document-session/transition.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Design Session test state uses the real store authority',
    from: ['src/__tests__/support/design-session-state.ts'],
    targets: ['src/app/document-session/store.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Timeline component renders through the Timeline Canvas barrel',
    from: ['src/components/canvas/InteractiveTimeline.tsx'],
    targets: ['src/app/timeline/canvas/index.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Timeline Canvas barrel exposes the host model',
    from: ['src/app/timeline/canvas/index.ts'],
    targets: ['src/app/timeline/canvas/host-model.ts'],
    edgeKinds: ['reexport'],
  },
  {
    kind: 'require-imports',
    name: 'Timeline host composes controller and Workbench',
    from: ['src/app/timeline/canvas/host-model.ts'],
    targets: ['src/app/timeline/canvas/controller.ts', 'src/app/timeline/workbench.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Timeline controller owns its interaction frame and geometry',
    from: ['src/app/timeline/canvas/controller.ts'],
    targets: [
      'src/app/timeline/canvas/interaction-frame.ts',
      'src/app/timeline/canvas/geometry.ts',
    ],
  },
  {
    kind: 'require-imports',
    name: 'Timeline interaction frame reuses Planning Canvas lifetime',
    from: ['src/app/timeline/canvas/interaction-frame.ts'],
    targets: ['src/app/planning-canvas/interaction-frame.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Consortium component uses its Workbench',
    from: ['src/components/canvas/ConsortiumChart.tsx'],
    targets: ['src/app/consortium/workbench.ts'],
  },
  {
    kind: 'require-imports',
    name: 'Consortium Workbench composes interaction and Planning Canvas lifetime',
    from: ['src/app/consortium/workbench.ts'],
    targets: [
      'src/app/consortium/interaction.ts',
      'src/app/planning-canvas/interaction-frame.ts',
    ],
  },
] satisfies readonly ArchitecturePolicy[]

const NAMED_IMPORT_POLICIES = [
  {
    kind: 'named-imports',
    name: 'Scene physical extent delegates every Zone shape to canonical geometry',
    from: ['src/canvas/runtime/scene-physical-extent.ts'],
    target: 'src/canvas/runtime/zone-geometry.ts',
    requiredNames: ['getZoneRadialExtentMeters'],
    allowedNames: ['getZoneRadialExtentMeters'],
  },
  {
    kind: 'named-imports',
    name: 'Layer Presentation uses layer commands and Canvas queries only',
    from: ['src/app/canvas-layer-presentation/presentation.ts'],
    target: 'src/canvas/session.ts',
    requiredNames: ['getCurrentCanvasLayerCommandSurface', 'currentCanvasQuerySurface'],
    allowedNames: ['getCurrentCanvasLayerCommandSurface', 'currentCanvasQuerySurface'],
  },
  {
    kind: 'named-imports',
    name: 'Favorites controller uses Scene Edit commands only',
    from: ['src/app/favorites/controller.ts'],
    target: 'src/canvas/session.ts',
    requiredNames: ['currentCanvasSceneEditCommandSurface'],
    allowedNames: ['currentCanvasSceneEditCommandSurface'],
  },
  {
    kind: 'named-imports',
    name: 'Zoom Controls use viewport commands and Canvas queries only',
    from: ['src/components/canvas/ZoomControls.tsx'],
    target: 'src/canvas/session.ts',
    requiredNames: ['currentCanvasQuerySurface', 'currentCanvasViewportCommandSurface'],
    allowedNames: ['currentCanvasQuerySurface', 'currentCanvasViewportCommandSurface'],
  },
  {
    kind: 'named-imports',
    name: 'Plant database rows use tool commands only',
    from: ['src/components/plant-db/PlantRow.tsx', 'src/components/plant-db/PlantCard.tsx'],
    target: 'src/canvas/session.ts',
    requiredNames: ['currentCanvasToolCommandSurface'],
    allowedNames: ['currentCanvasToolCommandSurface'],
  },
  {
    kind: 'named-imports',
    name: 'Plant Color Menu uses presentation, query, and selection surfaces only',
    from: ['src/components/canvas/PlantColorMenu.tsx'],
    target: 'src/canvas/session.ts',
    requiredNames: [
      'currentCanvasPlantPresentationCommandSurface',
      'currentCanvasQuerySurface',
      'currentCanvasSelection',
    ],
    allowedNames: [
      'currentCanvasPlantPresentationCommandSurface',
      'currentCanvasQuerySurface',
      'currentCanvasSelection',
    ],
  },
  {
    kind: 'named-imports',
    name: 'Canvas Toolbar reads Canvas queries and selection only',
    from: ['src/components/canvas/CanvasToolbar.tsx'],
    target: 'src/canvas/session.ts',
    requiredNames: ['currentCanvasQuerySurface', 'currentCanvasSelection'],
    allowedNames: ['currentCanvasQuerySurface', 'currentCanvasSelection'],
  },
] satisfies readonly ArchitecturePolicy[]

const FORBIDDEN_EXPORT_POLICIES = [
  {
    kind: 'forbid-exports',
    name: 'Scene contracts expose only live runtime authorities',
    from: ['src/canvas/runtime/scene/types.ts'],
    names: ['SceneEntity', 'SceneState'],
  },
  {
    kind: 'forbid-exports',
    name: 'Renderer contracts omit retired priority and probe aliases',
    from: ['src/canvas/runtime/renderers/types.ts'],
    names: ['RendererBackendPriority', 'RendererBackendProbe'],
  },
  {
    kind: 'forbid-exports',
    name: 'Projection exposes canonical operations instead of strategies',
    from: ['src/canvas/projection.ts'],
    names: [
      'ProjectionBackend',
      'LOCAL_MERCATOR_PROJECTION_BACKEND',
      'getActiveProjectionBackend',
    ],
  },
  {
    kind: 'forbid-exports',
    name: 'Plant Browser barrel does not expose implementation state',
    from: ['src/app/plant-browser/index.ts'],
    names: ['plantSearchSession', 'dynamicOptionsCache', 'dynamicOptionsErrors', 'dynamicOptionsPending'],
  },
  {
    kind: 'forbid-exports',
    name: 'Planning Projection does not expose Target presentation state',
    from: ['src/app/planning-projection/index.ts'],
    names: ['PlanningSelection'],
  },
  {
    kind: 'forbid-exports',
    name: 'Public Design Edit surface does not expose authority capabilities',
    from: ['src/app/design-edit/index.ts'],
    names: [
      'DesignPreviewTransaction',
      'designEditAuthorityCapability',
      'disposeDesignEditAuthority',
    ],
  },
  {
    kind: 'forbid-exports',
    name: 'Design IPC does not expose retired write orchestration',
    from: ['src/ipc/design.ts'],
    names: ['saveDesignAs', 'saveDesign', 'autosaveDesign'],
  },
] satisfies readonly ArchitecturePolicy[]

const SOURCE_TOMBSTONE_POLICIES = [
  {
    kind: 'source-tombstones',
    name: 'Retired frontend seams stay deleted',
    files: [
      'src/app/adaptation/index.ts',
      'src/app/adaptation/controller.ts',
      'src/ipc/adaptation.ts',
      'src/components/canvas/TemplateAdaptation.tsx',
      'src/components/canvas/maplibre-loader.ts',
      'src/panel-targets.ts',
      'src/panel-target-identity.ts',
      'src/panel-target-resolution.ts',
      'src/panel-target-map-projection.ts',
      'src/canvas/runtime-mirror-state.ts',
      'src/app/document/controller.ts',
      'src/app/document/edit-transaction.ts',
      'src/app/budget/controller.ts',
      'src/app/timeline/controller.ts',
      'src/app/consortium/controller.ts',
      'src/app/planning-projection/target-presentation.ts',
      'src/app/timeline/canvas-workbench.ts',
      'src/app/timeline/interaction-workbench.ts',
      'src/app/timeline/interaction-frame.ts',
      'src/app/plant-browser/state.ts',
      'src/app/plant-browser/controller.ts',
      'src/web/browser-theme.ts',
      'src/state/design.ts',
    ],
  },
] satisfies readonly ArchitecturePolicy[]

const SYMBOL_OWNERSHIP_POLICIES = [
  {
    kind: 'forbid-source-symbols',
    name: 'Scene Interaction uses the Control Point Overlay collection',
    from: ['src/canvas/runtime/scene-interaction.ts'],
    names: ['_zoneControlPoints', '_measurementGuideControlPoints'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Scene Session keeps retired active entity and Layer mirrors deleted',
    from: [
      'src/canvas/runtime/scene/types.ts',
      'src/canvas/runtime/scene/defaults.ts',
      'src/canvas/runtime/scene/store.ts',
    ],
    names: ['activeEntityId', 'activeLayerName', 'setActiveLayerName'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Renderer definitions keep retired priority metadata deleted',
    from: ['src/canvas/runtime/renderers/types.ts'],
    names: ['RendererBackendPriority', 'RendererBackendProbe', 'priority'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Projection source does not revive retired strategy symbols',
    from: ['src/canvas/projection.ts'],
    names: [
      'ProjectionBackend',
      'LOCAL_MERCATOR_PROJECTION_BACKEND',
      'getActiveProjectionBackend',
    ],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Plant Browser public barrel does not mention private state symbols',
    from: ['src/app/plant-browser/index.ts'],
    names: ['plantSearchSession', 'dynamicOptionsCache', 'dynamicOptionsErrors', 'dynamicOptionsPending'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Saved Object Stamp factory does not own the live Workbench',
    from: ['src/app/saved-object-stamps/workbench.ts'],
    names: ['savedObjectStampWorkbench'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Planning Projection public barrel does not mention private Target state',
    from: ['src/app/planning-projection/index.ts'],
    names: ['PlanningSelection'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Design Edit public barrel does not mention authority capabilities',
    from: ['src/app/design-edit/index.ts'],
    names: [
      'DesignPreviewTransaction',
      'designEditAuthorityCapability',
      'disposeDesignEditAuthority',
    ],
  },
  {
    kind: 'confine-symbols',
    name: 'Raw Design persistence capture stays in persistence',
    from: ['src/app/**', 'src/components/**', 'src/ipc/**', 'src/state/**', 'src/web/**'],
    names: ['captureForPersistence'],
    allowedFrom: ['src/app/document-session/persistence.ts', ...TEST_SOURCE_PATTERNS],
  },
  {
    kind: 'confine-symbols',
    name: 'Design persistence capability stays with its owner and adapter',
    from: ['src/**'],
    names: ['captureDesignSessionPersistenceState'],
    allowedFrom: [
      'src/app/document-session/persistence-capability.ts',
      'src/app/document-session/persistence.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'confine-symbols',
    name: 'Design persistence capability registration stays in the store',
    from: ['src/**'],
    names: ['registerDesignSessionPersistenceCapability'],
    allowedFrom: [
      'src/app/document-session/persistence-capability.ts',
      'src/app/document-session/store.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'confine-symbols',
    name: 'Design Edit authority disposal stays in the capability owner',
    from: ['src/**'],
    names: ['disposeDesignEditAuthority'],
    allowedFrom: [
      'src/app/design-edit/authority-capability.ts',
      'src/app/design-edit/core.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'confine-symbols',
    name: 'Design Edit authority registration stays in the document store',
    from: ['src/**'],
    names: ['registerDesignEditAuthorityCapability'],
    allowedFrom: [
      'src/app/design-edit/authority-capability.ts',
      'src/app/document-session/store.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
  },
  {
    kind: 'confine-symbols',
    name: 'Committed Design state stays private to the document store',
    from: ['src/**'],
    names: ['committedDesign'],
    allowedFrom: ['src/app/document-session/store.ts', ...TEST_SOURCE_PATTERNS],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Retired Design mutation escape hatches stay absent',
    from: ['src/app/**', 'src/canvas/**', 'src/components/**', 'src/ipc/**', 'src/state/**', 'src/web/**'],
    names: ['DocumentMutationOptions', 'markDesignEdited'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Canvas lock authority is not mirrored as an ID collection',
    from: ['src/canvas/**'],
    names: ['lockedObjectIds'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Planning surfaces delegate document listener ownership to their frame',
    from: [
      'src/app/timeline/canvas/host-model.ts',
      'src/app/timeline/canvas/controller.ts',
      'src/app/timeline/canvas/interaction-frame.ts',
      'src/app/consortium/workbench.ts',
      'src/components/canvas/InteractiveTimeline.tsx',
      'src/components/canvas/ConsortiumChart.tsx',
    ],
    names: ['addEventListener', 'removeEventListener'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Web Edition keeps Desktop-only products out of browser code',
    from: ['src/web/**'],
    names: ['saveAs', 'geocode', 'WebLocation', 'DesignNotebook', 'ProblemReport'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Web App does not own settings persistence',
    from: ['src/web/WebApp.tsx'],
    names: ['loadSettings', 'saveSettings', 'onSettingsChange'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Scene Runtime keeps retired signal-backed writes deleted',
    from: [
      'src/canvas/runtime/scene-runtime.ts',
      'src/canvas/runtime/scene-runtime/effects.ts',
      'src/canvas/runtime/scene-runtime/document.ts',
    ],
    names: ['applySignalBackedSceneState'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Scene effects do not own persisted layer or guide state',
    from: ['src/canvas/runtime/scene-runtime/effects.ts'],
    names: ['layerVisibility', 'guides'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Scene document bridge does not publish revision ownership',
    from: ['src/canvas/runtime/scene-runtime/document.ts'],
    names: ['incrementSceneRevision', 'sceneEntityRevision'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Design Template controller does not acquire assets directly',
    from: ['src/app/community/controller.ts'],
    names: ['acquireDesignTemplate', 'downloadTemplate'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Design Template adapters keep retired path and raw-text handoff deleted',
    from: [
      'src/app/design-template-import/workflow.desktop.ts',
      'src/app/design-template-import/workflow.browser.ts',
      'src/app/document-session/actions.ts',
      'src/app/document-session/transition.ts',
      'src/web/browser-design-session.ts',
    ],
    names: ['downloadTemplate', 'BrowserTemplateCanopiFile'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Browser template workflow keeps retired adaptation out',
    from: ['src/app/design-template-import/workflow.browser.ts'],
    names: ['TemplateAdaptation'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'World Map delegates map construction and observation to infrastructure',
    from: ['src/components/world-map/WorldMapSurface.tsx'],
    names: ['createMapLibreBasemapStyle', 'ResizeObserver'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'App presentation does not construct basemap styles',
    from: ['src/app/**', 'src/components/**'],
    names: ['createMapLibreBasemapStyle'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Design Session adapters do not call the state machine directly',
    from: [
      'src/app/document-session/use-canvas-document-session.ts',
      'src/app/document-session/lifecycle.ts',
      'src/app/document-session/actions.ts',
    ],
    names: ['transitionDocument', 'buildPersistedDesignSessionContent'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Design Session state machine keeps retired settlement APIs deleted',
    from: ['src/app/document-session/state-machine.ts'],
    names: [
      'buildPersistedDesignSessionContent',
      'applyDocumentTransition',
      'markSaved',
      'replaceCurrentDesignState',
    ],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Browser Design Session uses shared replacement and persistence',
    from: ['src/web/browser-design-session.ts'],
    names: [
      'buildPersistedDesignSessionContent',
      'settleWrittenDesignOperation',
      'markSaved',
      'replaceCurrentDesignState',
      'normalizeLoadedDocument',
      'normalizeNewDocument',
    ],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Design persistence keeps retired write-operation APIs deleted',
    from: ['src/app/document-session/persistence.ts'],
    names: [
      'SceneEditBusyError',
      'DesignPersistenceWriteOperation',
      'settleWrittenDesignOperation',
    ],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Web Canvas Workspace delegates document replacement',
    from: ['src/web/WebCanvasWorkspace.tsx'],
    names: ['syncCanvasDocument', 'loadDocument', 'replaceDocument', 'useSignalEffect'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Canvas Runtime Host delegates presentation data to the App Adapter',
    from: ['src/app/canvas-runtime/host.ts'],
    names: ['CanvasPlantLabelResolver', 'CanvasSpeciesCache'],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Public Design Session store keeps mutation capabilities private',
    from: ['src/app/document-session/store.ts'],
    names: [
      'capturePersistence',
      'mutateCurrentDesign',
      'reconcileCurrentDesign',
      'markDocumentDirty',
      'updateDesignArray',
      'syncExternallyInstalledDesign',
    ],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Timeline component delegates edit and form behavior',
    from: ['src/components/canvas/InteractiveTimeline.tsx'],
    names: [
      'beginDocumentArrayEdit',
      'beginTimelineActionEdit',
      'createTimelineActionFromFormData',
      'formDataFromTimelineAction',
      'timelineActionPatchFromFormData',
    ],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Timeline interaction frame delegates Target presentation',
    from: ['src/app/timeline/canvas/interaction-frame.ts'],
    names: [
      'setTimelineHoveredPanelTargets',
      'setTimelineSelectedPanelTargets',
      'clearTimelineHoveredPanelTargets',
      'clearTimelineSelectedPanelTargets',
    ],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Consortium component delegates document edits',
    from: ['src/components/canvas/ConsortiumChart.tsx'],
    names: [
      'beginDocumentArrayEdit',
      'moveConsortiumEntryInArray',
      'reorderConsortiumEntryInArray',
    ],
  },
  {
    kind: 'forbid-source-symbols',
    name: 'Consortium Workbench does not revive direct hover ownership',
    from: ['src/app/consortium/workbench.ts'],
    names: ['setHoveredSpecies'],
  },
  {
    kind: 'forbid-writes',
    name: 'Web settings mutations cross the shared projection',
    from: ['src/web/BrowserAppShell.tsx'],
    targets: ['locale.value', 'theme.value'],
  },
  {
    kind: 'forbid-writes',
    name: 'Web Canvas settings mutations cross the shared projection',
    from: ['src/web/browser-canvas-runtime.ts'],
    targets: ['plantSpacingIntervalM.value', 'snapToGridEnabled.value'],
  },
  {
    kind: 'forbid-writes',
    name: 'Design mutation dirty-state bypass stays retired',
    from: ['src/app/**', 'src/canvas/**', 'src/components/**', 'src/ipc/**', 'src/state/**', 'src/web/**'],
    exceptFrom: [...TEST_SOURCE_PATTERNS],
    properties: ['markDirty'],
    values: ['false'],
  },
  {
    kind: 'forbid-calls',
    name: 'App-facing tests use public Canvas Runtime surfaces',
    from: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    properties: ['getSceneStore'],
  },
  {
    kind: 'forbid-calls',
    name: 'App-facing tests do not call an unbound Scene Store escape hatch',
    from: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    targets: ['getSceneStore'],
  },
  {
    kind: 'forbid-calls',
    name: 'Design mutation capability calls stay in store and Design Edit core',
    from: ['src/app/**', 'src/canvas/**', 'src/components/**', 'src/ipc/**', 'src/state/**', 'src/web/**'],
    exceptFrom: [
      'src/app/document-session/store.ts',
      'src/app/design-edit/core.ts',
      ...TEST_SOURCE_PATTERNS,
    ],
    properties: ['mutateCurrentDesign', 'reconcileCurrentDesign', 'updateDesignArray'],
  },
  {
    kind: 'confine-symbols',
    name: 'Production code cannot acquire the Design Session test fixture',
    from: ['src/**'],
    names: ['createDesignSessionStoreTestFixture'],
    allowedFrom: ['src/app/document-session/store.ts', ...TEST_SOURCE_PATTERNS],
  },
  {
    kind: 'forbid-calls',
    name: 'App presentation does not construct MapLibre classes directly',
    from: ['src/app/**', 'src/components/**'],
    targets: ['maplibre.**', 'maplibregl.**'],
    callKinds: ['new'],
  },
  {
    kind: 'forbid-calls',
    name: 'World Map delegates resize observation to the MapLibre Host',
    from: ['src/components/world-map/WorldMapSurface.tsx'],
    targets: ['ResizeObserver'],
    callKinds: ['new'],
  },
] satisfies readonly ArchitecturePolicy[]

const FRONTEND_ARCHITECTURE_POLICIES = [
  ...FORBIDDEN_IMPORT_POLICIES,
  ...CONFINED_IMPORTER_POLICIES,
  ...REQUIRED_IMPORT_POLICIES,
  ...NAMED_IMPORT_POLICIES,
  ...FORBIDDEN_EXPORT_POLICIES,
  ...SOURCE_TOMBSTONE_POLICIES,
  ...SYMBOL_OWNERSHIP_POLICIES,
] satisfies readonly ArchitecturePolicy[]

const DESIGN_SESSION_TEST_BOUNDARY_POLICY_NAMES = new Set([
  'Production code cannot acquire the Design Session test fixture',
  'Production code cannot import frontend test support',
])

function designSessionTestBoundaryPolicies(): readonly ArchitecturePolicy[] {
  return FRONTEND_ARCHITECTURE_POLICIES.filter(({ name }) =>
    DESIGN_SESSION_TEST_BOUNDARY_POLICY_NAMES.has(name)
  )
}

const DESIGN_SESSION_TEST_FIXTURE_OWNER_SOURCE = {
  path: 'src/app/document-session/store.ts',
  source: 'export function createDesignSessionStoreTestFixture() {}',
} as const

const DESIGN_SESSION_TEST_FIXTURE_ALLOWED_SOURCES =
  'src/app/document-session/store.ts, src/__tests__/**, src/**/*.test.ts, src/**/*.test.tsx'

describe('declarative frontend architecture policies', () => {
  it.each([
    {
      caseName: 'root production entry',
      path: 'src/main.tsx',
      source: `
          import { createDesignSessionStoreTestFixture } from './app/document-session/store'
          createDesignSessionStoreTestFixture()
        `,
    },
    {
      caseName: 'aliased import',
      path: 'src/app/fixture-consumer.ts',
      source: `
          import {
            createDesignSessionStoreTestFixture as acquireFixture,
          } from './document-session/store'
          acquireFixture()
        `,
    },
    {
      caseName: 'namespace import',
      path: 'src/commands/fixture-consumer.ts',
      source: `
          import * as designSession from '../app/document-session/store'
          designSession.createDesignSessionStoreTestFixture()
        `,
    },
  ])('rejects Design Session test fixture acquisition through a $caseName', ({ path, source }) => {
    const graph = createTypeScriptSourceGraph([
      DESIGN_SESSION_TEST_FIXTURE_OWNER_SOURCE,
      { path, source },
    ])

    expect(collectArchitecturePolicyViolations(
      graph,
      designSessionTestBoundaryPolicies(),
    )).toEqual([
      `[Production code cannot acquire the Design Session test fixture] ${path} contains confined symbol createDesignSessionStoreTestFixture; allowed sources: ${DESIGN_SESSION_TEST_FIXTURE_ALLOWED_SOURCES}`,
    ])
  })

  it('rejects production imports from frontend test support', () => {
    const graph = createTypeScriptSourceGraph([
      {
        path: 'src/__tests__/support/design-session-state.ts',
        source: 'export const designSessionFixture = {}',
      },
      {
        path: 'src/platform/fixture-consumer.ts',
        source: `
          import { designSessionFixture } from '../__tests__/support/design-session-state'
          void designSessionFixture
        `,
      },
    ])

    expect(collectArchitecturePolicyViolations(
      graph,
      designSessionTestBoundaryPolicies(),
    )).toEqual([
      '[Production code cannot import frontend test support] src/platform/fixture-consumer.ts:2:11 imports src/__tests__/support/design-session-state.ts via "../__tests__/support/design-session-state" (static)',
    ])
  })

  it('allows the Design Session store and frontend tests to use test support', () => {
    const graph = createTypeScriptSourceGraph([
      DESIGN_SESSION_TEST_FIXTURE_OWNER_SOURCE,
      {
        path: 'src/__tests__/support/design-session-state.ts',
        source: `
          import { createDesignSessionStoreTestFixture } from '../../app/document-session/store'
          export const designSessionFixture = createDesignSessionStoreTestFixture()
        `,
      },
      {
        path: 'src/__tests__/consumer.test.ts',
        source: `
          import { designSessionFixture } from './support/design-session-state'
          void designSessionFixture
        `,
      },
      {
        path: 'src/canvas/runtime/consumer.test.ts',
        source: `
          import { designSessionFixture } from '../../__tests__/support/design-session-state'
          void designSessionFixture
        `,
      },
    ])

    expect(collectArchitecturePolicyViolations(
      graph,
      designSessionTestBoundaryPolicies(),
    )).toEqual([])
  })

  it('keeps Saved Object Stamp HMR disposal with the live Workbench owner', () => {
    const ownerSource = readFileSync(
      new URL('../app/saved-object-stamps/index.ts', import.meta.url),
      'utf8',
    )
    expect(ownerSource).toMatch(
      /const\s+liveSavedObjectStampWorkbench\s*=\s*createSavedObjectStampWorkbench\(\)/,
    )
    expect(ownerSource).toMatch(
      /export\s+const\s+savedObjectStampWorkbench(?:\s*:\s*SavedObjectStampWorkbench)?\s*=\s*liveSavedObjectStampWorkbench/,
    )
    expect(ownerSource).toMatch(/if\s*\(\s*import\.meta\.hot\s*\)/)
    expect(ownerSource).toMatch(
      /import\.meta\.hot\.dispose\(\s*\(\)\s*=>\s*(?:\{\s*)?liveSavedObjectStampWorkbench\.dispose\(\)\s*;?\s*(?:\})?\s*\)/,
    )
  })

  it('keeps every discovered TypeScript source within its owned dependency seams', () => {
    const graph = discoverTypeScriptSourceGraph(new URL('../', import.meta.url), 'src')
    const paths = graph.map(({ path }) => path)

    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)))
    expect(paths).toContain('src/main.tsx')
    expect(paths).toContain('src/canvas/runtime/scene-runtime.ts')
    expect(paths).toContain('src/generated/web-catalog-artifact.d.mts')
    expect(paths.length).toBeGreaterThan(400)
    expect(collectArchitecturePolicyViolations(graph, FRONTEND_ARCHITECTURE_POLICIES)).toEqual([])
  }, 20_000)
})
