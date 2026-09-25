# One renderer: PixiJS inside MapLibre

Status: Accepted (2026-09-25, Canopi v2)

## Context

Canopi v1 drew the scene with PixiJS as a MapLibre custom layer (`maplibre-pixi`) and kept a Canvas2D fallback plus a standalone Pixi canvas backend. The fallback needed its own camera handoff, its own drawing code and its own tests. With the map as the canvas ([ADR 0001](0001-geolocated-map-canvas.md)), a scene without a map has no use.

## Decision

- The only interactive renderer is the PixiJS scene inside a MapLibre custom layer (`canvas/runtime/renderers/maplibre-scene.ts`, id `maplibre-pixi`).
- The Canvas2D renderer, the standalone Pixi canvas backend, renderer fallback selection and camera code that only aligned a metre canvas with the map are deleted.
- If WebGL2 or MapLibre cannot start, the workspace shows an explicit "map unavailable" state.
- MapLibre owns the WebGL2 context, framebuffer, camera, frame scheduling, resize and context lifecycle. The adapter owns only its scene subscriptions and graphics resources. It never clears or loses the shared context, starts an application ticker, resizes the canvas or renders outside MapLibre's custom-layer callback. Scene edits request `triggerRepaint`.
- Pixi's normal renderer destroy path loses the WebGL context, so the adapter uses a direct `WebGLRenderer`, explicit state reset, MapLibre-frame-only submission and resource-only teardown.
- One pointer sequence picks its owner at gesture start. Canopi tools keep scene mutation, hit testing, locks, grouping and history; a tool-owned gesture disables map navigation until it ends, is cancelled or the tool changes.
- The adapter reuses renderer-neutral scene snapshots, zone geometry, plant symbol recipes, colours, label admission and interaction visuals. It never creates a DOM node or MapLibre style layer per plant.
- PDF and inspection lens output stay renderer-neutral and need neither MapLibre nor the network.

## Consequences

- One drawing path to optimise and test; the 2,200-plant scene is the performance reference.
- Devices without WebGL2 cannot edit Designs; they see the unavailable state instead of a degraded canvas.
- Style reload and context restore recreate graphics resources from scene authority.
