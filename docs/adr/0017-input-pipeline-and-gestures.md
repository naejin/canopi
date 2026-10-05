# Input pipeline and gestures

Status: Accepted (2026-09-29, Canopi v2); amended 2026-09-30, 2026-10-01 and 2026-10-05 (U33: key admission, no rulers)

Amends [ADR 0004](0004-one-renderer.md) (a tool's gesture no longer turns off map navigation). Product rules: [ADR 0015](0015-rotating-map-and-canvas-controls.md).

## Context

Pointer, wheel, context-menu and drag listeners were spread over the scene interaction layer, tools, rulers and chrome. Right-click versus right-drag could not be told apart because Linux and macOS fire `contextmenu` at press and Windows at release. Pointer Events deliver a second button pressed during a drag as a `pointermove`, not a `pointerdown`, so a recogniser must see the whole stream to keep that press from starting anything. None of this could be tested without a browser.

## Decision

- **Stages.** `DomInputSource` (the only DOM listener and pointer-capture owner for canvas input) feeds a pure `normalise`, then a pure `recognise` reducer returning `{ state, gestures, effects }`, then a thin `InputRouter`. Clock and platform are injected; timers are inputs the source schedules because the recogniser asked; side effects (prevent default, stop propagation, capture, release, drop effect) are `AdapterEffect`s the source executes, including the tool host's answer to each gesture (quarantine, drop effect, reject the press), which the router returns.
- **One screen-space gesture vocabulary.** Editing kinds (hover, press, tap, drag, drop) go to the tool host; navigation kinds (`pan`, `zoom`, `rotate`) go to view navigation and never reach tools; `menu-request` and `cancel` are requests. Pinch, twist, wheel and keys are sources of `zoom` and `rotate`, not kinds. Keys are not gestures: key navigation goes through the keyboard owner ([ADR 0020](0020-focus-and-keyboard-ownership.md)).
- **Bindings are data.** One `Bindings` constant configures the recogniser; each phase edits the fields it changes in place, and since everything ships as one release (2026-10-01) the fields that end with one value are hard-coded at the end. F1's gesture list is a static list with per-platform notes.
- **Secondary button.** A copy of GeoLibre's context-menu gesture tracker (MIT, ADR 0002) decides pan versus menu on one stream: past 3 px it pans (Shift: rotates); a still release opens the menu at the release point on every OS. Native mouse `contextmenu` on the map, its handles and chrome is prevented unless it came from the keyboard; text fields and panels keep the native menu. On macOS Ctrl+click is secondary.
- **No second button during a drag** (user, 2026-10-01). A secondary or auxiliary bit added during a primary drag is ignored for the rest of that session: no nested pan or rotate, no two-level Esc. Wheel zoom and keys stay live during a drag, and the tool host re-emits the drag in world space so the draft stays under the cursor.
- **Keys during a gesture** (user, 2026-10-05, U33). Today's key denylist stays, with one condition: Delete, Backspace's selection fallback and Ctrl+X delete nothing while a pointer gesture or a tool draft is live (canopi-f47t.21). Every other key stays live. Modifier state has one source (U16).
- **Pointing device.** Mouse: wheel zooms about the pointer. Trackpad: wheel pans, pinch zooms. Trackpad rotation needs 10° of accumulated twist; touch twist 25 px of arc; the threshold is subtracted so the view does not jump.
- **Cancel fences.** `pointercancel`, lost capture, blur, hidden page, Esc, and tool change end every session exactly once. Leaving the host ends the hover; focus leaving it ends a nudge series.

## Options considered

- **MapLibre's handlers** (`interactive: true`): right-drag rotates, left-drag pans and Shift box-zooms, against ADR 0015.
- **Arbiter, control scheme and intent router as three layers**: one reducer and a router suffice.
- **Timers scheduled through gesture output**: side effects belong in effects.
- **Automatic mouse/trackpad detection**: unreliable across engines.
- **A new stored enum for the pointing device**: older builds would reset settings; `scroll_wheel` is reused.
- **Ignoring the wheel during a tool drag**: breaks the navigation-live convention.
- **An allowlist of keys that act mid-gesture** (U16, 2026-10-01; dropped 2026-10-05, U33): every keymap row would need an admission class, a missed row becomes a dead key mid-drag, and it did not fix canopi-f47t.21, which happens between polygon clicks.
- **A nested pan or rotate when a second button joins a drag**: rejected by the user (2026-10-01); it needed a frozen primary point, a two-level Esc and four fixtures for a gesture nobody asked for.
- **One bindings constant per phase** (2026-09-29 design): with one release, a constant that lives one phase only doubles the fixtures.
- **Unthresholded trackpad rotation**: every pinch carries a few degrees of twist; the map would wobble.
- **Separate `pinch`/`twist` kinds, or one `navigate { intent }` kind**: tools never see them; intent would fold camera policy into input types.
- **World-space gestures from the recogniser**: it stays camera-free; the tool host converts at event time.
- **Window-listener or `touch-action` changes in the refactor**: behaviour changes; they ship later with their own tests.

## Consequences

- Recogniser fixtures cover about 60 sequences per platform (Windows release-time menus, Mac Ctrl+click, pen barrel, touch, wheel, ignored chords) without a browser; each phase rewrites the expectations it changes; a property test checks every session ends once and every capture is released.
- Policy tests confine pointer capture and canvas `addEventListener` to the source and keep the input core browser-free.
- A new gesture is a new bindings row and fixtures, not a new listener.
- Details: [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).

## Amended 2026-09-30 and 2026-10-01

Phase 0B found that the tool host decides admission and drop acceptance but had no way back to the DOM event, and that the source had no channel for keys, `focusout` or `pointerleave`. The pipeline gains a return channel (the router returns the host's outcome) and three raw inputs (`leave`, `focus-out`, and `reject`, which ends a refused press's session with no gesture).

The value audit of 2026-10-01 removed what only acted after a programming error: a cancellation that throws aborts the open edit instead of fencing every later event, and a throwing sink quarantines only a press on the map. The overview pointerup swallow goes as a bug fix; today's window pointer listeners stay until phase F, and until F's key router the source holds today's window key listeners. Details: spec §1.2–1.2a.
