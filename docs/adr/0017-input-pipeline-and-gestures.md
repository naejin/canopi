# Input pipeline and gestures

Status: Accepted (2026-09-29, Canopi v2); amended 2026-09-30

Amends [ADR 0004](0004-one-renderer.md) (a tool's gesture no longer turns off map navigation). Product rules: [ADR 0015](0015-rotating-map-and-canvas-controls.md).

## Context

Pointer, wheel, context-menu and drag listeners were spread over the scene interaction layer, tools, rulers and chrome. Right-click versus right-drag could not be told apart because Linux and macOS fire `contextmenu` at press and Windows at release. Pointer Events deliver a second button pressed during a drag as a `pointermove`, not a `pointerdown`, so "right-drag pans mid-draw" needs a recogniser that sees the whole stream. None of this could be tested without a browser.

## Decision

- **Stages.** `DomInputSource` (the only DOM listener and pointer-capture owner for canvas input, rulers included) feeds a pure `normalise`, then a pure `recognise` reducer returning `{ state, gestures, effects }`, then a thin `InputRouter`. Clock and platform are injected; timers are inputs the source schedules because the recogniser asked; side effects (prevent default, stop propagation, capture, release, drop effect) are `AdapterEffect`s the source executes, including the tool host's answer to each gesture (quarantine, drop effect, reject the press), which the router returns.
- **One screen-space gesture vocabulary.** Editing kinds (hover, press, tap, drag, drop) go to the tool host; navigation kinds (`pan`, `zoom`, `rotate`) go to view navigation and never reach tools; `menu-request` and `cancel` are requests. Pinch, twist, wheel and keys are sources of `zoom` and `rotate`, not kinds. Keys are not gestures: key navigation goes through the keyboard owner ([ADR 0020](0020-focus-and-keyboard-ownership.md)).
- **Bindings are data.** One `Bindings` constant per phase (legacy, rotation, controls, touch) configures the recogniser; changing phase changes one constant. F1's gesture list is generated from the active bindings.
- **Secondary button.** A copy of GeoLibre's context-menu gesture tracker (MIT, ADR 0002) decides pan versus menu on one stream: past 3 px it pans (Shift: rotates); a still release opens the menu at the release point on every OS. Native mouse `contextmenu` on the map, its handles, rulers and chrome is prevented unless it came from the keyboard; text fields and panels keep the native menu. On macOS Ctrl+click is secondary.
- **Nested navigation.** A secondary or auxiliary bit added during a primary drag opens a navigation sub-session (pan, or rotate with Shift); the primary drag's point freezes and resumes when the bit clears. The tool host re-emits the drag in world space so the draft stays under the cursor.
- **Pointing device.** Mouse: wheel zooms about the pointer. Trackpad: wheel pans, pinch zooms. Trackpad rotation needs 10° of accumulated twist; touch twist 25 px of arc; the threshold is subtracted so the view does not jump.
- **Cancel fences.** `pointercancel`, lost capture, blur, hidden page, Esc, and tool change end every session exactly once. Leaving the host ends the hover; focus leaving it ends a nudge series.

## Options considered

- **MapLibre's handlers** (`interactive: true`): right-drag rotates, left-drag pans and Shift box-zooms, against ADR 0015.
- **A single legacy-menu flag**: whole bindings constants per phase are the cleaner switch.
- **Arbiter, control scheme and intent router as three layers**: one reducer and a router suffice.
- **Timers scheduled through gesture output**: side effects belong in effects.
- **Automatic mouse/trackpad detection**: unreliable across engines.
- **A new stored enum for the pointing device**: older builds would reset settings; `scroll_wheel` is reused.
- **Ignoring the wheel or a second button during a tool drag**: breaks the navigation-live convention.
- **Unthresholded trackpad rotation**: every pinch carries a few degrees of twist; the map would wobble.
- **Separate `pinch`/`twist` kinds, or one `navigate { intent }` kind**: tools never see them; intent would fold camera policy into input types.
- **World-space gestures from the recogniser**: it stays camera-free; the tool host converts at event time.
- **Window-listener or `touch-action` changes in the refactor**: behaviour changes; they ship later with their own tests.

## Consequences

- Recogniser fixtures cover about 60 sequences per platform and bindings (Windows release-time menus, Mac Ctrl+click, pen barrel, touch, wheel, chords) without a browser; a property test checks every session ends once and every capture is released.
- Policy tests confine pointer capture and canvas `addEventListener` to the source and keep the input core browser-free.
- A new gesture is a new bindings row and fixtures, not a new listener.
- Details: [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).

## Amended 2026-09-30

Phase 0B found that the tool host decides admission, drop acceptance and the retry of a failed cancellation, but had no way back to the DOM event, and that the source had no channel for keys, `focusout` or `pointerleave`.

The pipeline gains a return channel (the router returns the host's outcome) and three raw inputs (`leave`, `focus-out`, and `reject`, which ends a refused press's session with no gesture). Today's window pointer listeners and the overview pointerup swallow stay until phase F. Until 0C hands keys to the key router, the source also holds today's window key listeners and passes keys to the keyboard port. Details: spec §1.2–1.2a.
