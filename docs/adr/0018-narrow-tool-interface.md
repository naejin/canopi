# Narrow tool interface

Status: Accepted (2026-09-29, Canopi v2); amended 2026-09-30, 2026-10-03 (stamp picks), 2026-10-05 (U33: no ruler presses) and 2026-10-06 (phase 2's design check: run-once operations, one fault rule, the re-origin hold)

Builds on [ADR 0016](0016-one-view-transform.md) and [ADR 0017](0017-input-pipeline-and-gestures.md). Product rules: [ADR 0015](0015-rotating-map-and-canvas-controls.md).

## Context

Tools implemented a wide `SceneToolAdapter`: raw pointer events, DOM predicates, `clientX` reads, their own DOM overlays and cached screen positions such as a drag's start corner. Those caches went stale on any camera move, so zooming during a drag misplaced the draft, and a rotated view would have broken every tool that assumed screen axes equal world axes.

## Decision

- **Tools are plain objects** driven by world-space `ToolGesture`s and `ToolCommand`s through one `ToolHost`. They read only `ToolView` (bearing, mode, metres per pixel, screen axes in world, screen-aligned rectangles) and `ToolScene` (persisted state, hit tests, selection model).
- **They act only through `ToolEffects`**: the unchanged Scene Edit transaction API, world-space drafts and selection previews drawn by the renderer, DOM handles, guidance, cursor, tool requests, text entry, menu and focus requests routed to their owners. There is no navigation handle: a tool cannot move the camera.
- **Tools never import** MapLibre, Pixi, signals, DOM types, app or component modules, the view module's values, the input pipeline or renderers. The vocabulary shared with input (pointer kind, modifiers, cancel reasons, tool and handle ids, drop payloads) lives in one neutral types file both import.
- **The ToolHost** converts screen to world at event time, constrains and snaps once: a tool names its constraint (`constraint()`: a direction from the last corner, the row source or the line start at 45°; for the rotate handle, a 15° step of the angle turned since the press, as today). The host turns the direction against the screen axes and keeps the length, then rounds the length along the ray to the grid interval, one order for every tool (from phase 2); the grid stays on world axes.
- **The ToolHost also** classifies handle presses, runs interceptors (unsettled-scene quarantine, text-entry commit, inspection probe, overview rule), re-emits the last drag or hover on every camera frame so a draft's fixed corner stays on the ground and its free corner under the cursor, and holds re-origin while a press, a tool transient or the text entry is open, so no tool re-projects anything; re-origin then runs on the last frame, and a plane change hides ghosts (amended 2026-10-06, P8).
- **Screen-relative behaviour lives in the host:** arrows become world vectors along the screen axes; the host is the only opener of the canvas menu: it retargets the selection and offers "Turn view to this edge" and "Finish shape"; modifiers are resolved from the event's own flags, with no platform dependency (additive Shift, Ctrl or Cmd; subtractive Alt; constrain Shift; Plant a row's no-snap Ctrl or Cmd; ADR 0017).
- **The Pan tool** keeps an id and a module for cursor and guidance only; its drags become `pan` in the recogniser and never reach it.
- **Esc queries** (`hasTransient`, `escapeHint`, `cancelTransient`) feed the keyboard owner's Esc chain; a tool's Esc only drops its transient.
- **One fault rule** (amended 2026-10-06, P18): at the outermost tool call, once, a call that throws aborts the host's open edits, ends the live press, arms a fresh instance of the current tool (Select if activation threw) and rethrows; a failure during the re-arm is not handled again. No tool keeps a commit-fault branch.

## Options considered

- **Pure reducer tools**: edit effects are closures, so purity is nominal and the ceremony real.
- **Keep `SceneToolAdapter`** with DOM predicates and raw events: it is the source of the screen caches and overlays.
- **Tools holding screen caches** (`startScreen`): stale under navigation; everything is world-space from the first event.
- **Tools applying their own angle constraint** through a view query: the host's snapped point would then be wrong under Shift, and each tool would repeat the order of constraint and snapping.
- **Global window events for arming** (GeoLibre): one arming function instead ([ADR 0020](0020-focus-and-keyboard-ownership.md)).
- **Saved-stamp picks north-relative on a rotated map**: the ghost would appear turned against the screen, unlike rectangles and notes. (Narrowed 2026-10-03: an Object stamp pick starts at 0 and keeps its source's orientation, ADR 0015.)
- **Overview left-drag inert**: reads as broken; it band-selects.
- **Delete the Pan tool**: overruled by the user.

## Consequences

- Every existing tool (Select with its band, move, rotate handle and reshape; Pan; plant stamp; text; line, rectangle, ellipse; polygon; measure; object and saved-object stamps; Plant a row) is ported behaviour-preserving first, then changed per ADR 0015.
- Policy tests forbid the listed imports and DOM symbols in tool files. Tool modules are value-imported only inside `tools/` and by the composition root through the host (P5b).
- Tools are tested through a gesture harness over the real host, with a fake view at any bearing, without jsdom.
- Details: [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).

## Amended 2026-09-30

Building phase 0B showed that the narrow contract could not carry several tested behaviours. The core stands (plain tools, world points, no DOM, MapLibre, Pixi, signals, input or camera imports, screen-to-world only in the host); the contract grows additively:

- **Feedback to the DOM.** The router and the host answer each gesture with an outcome (quarantine, drop effect, reject the press), which the input source applies; the host asks the scene's admission itself. A Scene operation runs its steps once (amended 2026-10-06, P1): an edit that throws before history accepts restores its before-state, one that throws after runs each remaining publication step once, and either releases the authority and rethrows; undo moves its cursor first and rolls it back if the store update throws; nothing resumes or retries an operation.
- **The host owns drops and selection decorations.** One drop handler serves every tool (placement code from the plant and saved-stamp modules); the selected zone's chips and the handles belong to the host whichever tool is armed, and show as today (chips under every tool, handles while Select is armed).
- **Tools gain** a history-free selection effect, the host's snapping of any point, a text entry that stays open while a commit is refused, a view hook for frames with nothing to re-emit, a clamp-to-view flag, spacing-field commands, plant presentation reads and a handle readout. A tool's `'handled'` hover skips the host's passive hover.
- **Phase 0B ran unported tools through a legacy bridge** in the interaction session, so every tool could be ported and merged alone; the host served only registered tools, and each shared duty moved to it with the tool that owned it. The bridge went by the end of 0B: every tool and drop runs on the host.

Details: spec §1.2–1.4, plan §4 0B.

## Amended 2026-10-03

The rejected "stamp picks north-relative" alternative now covers saved stamps only. An Object stamp pick starts at 0, so its copies keep their source's orientation like Paste (ADR 0015 conventions, spec §4.7).
