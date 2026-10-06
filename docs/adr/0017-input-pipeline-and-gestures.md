# Input pipeline and gestures

Status: Accepted (2026-09-29, Canopi v2); amended 2026-09-30, 2026-10-01, 2026-10-05 (U33: key admission, no rulers) and 2026-10-06 (phase 2's design check and U34: one context-menu listener, one modifier source; phase 3's design check, U41: the held touch press, no bindings constant)

Amends [ADR 0004](0004-one-renderer.md) (a tool's gesture no longer turns off map navigation). Product rules: [ADR 0015](0015-rotating-map-and-canvas-controls.md).

## Context

Pointer, wheel, context-menu and drag listeners were spread over the scene interaction layer, tools, rulers and chrome. Right-click versus right-drag could not be told apart because Linux and macOS fire `contextmenu` at press and Windows at release. Pointer Events deliver a second button pressed during a drag as a `pointermove`, not a `pointerdown`, so a recogniser must see the whole stream to keep that press from starting anything. None of this could be tested without a browser.

## Decision

- **Stages.** `DomInputSource` (the only DOM listener and pointer-capture owner for canvas input) feeds a pure `normalise`, then a pure `recognise` reducer returning `{ state, gestures, effects }`, then a thin `InputRouter`. Clock and platform are injected; timers are inputs the source schedules because the recogniser asked; side effects (prevent default, stop propagation, capture, release, drop effect) are `AdapterEffect`s the source executes, including the tool host's answer to each gesture (quarantine, drop effect, reject the press), which the router returns.
- **One screen-space gesture vocabulary.** Editing kinds (hover, press, tap, drag, drop) go to the tool host; navigation kinds (`pan`, `zoom`, `rotate`) go to view navigation and never reach tools; `menu-request` and `cancel` are requests. Pinch, twist, wheel and keys are sources of `zoom` and `rotate`, not kinds. Keys are not gestures: key navigation goes through the keyboard owner ([ADR 0020](0020-focus-and-keyboard-ownership.md)).
- **Rules are code, thresholds are data.** There is no bindings constant: phase 2 hard-coded its final behaviour and phase 3 deletes `Bindings` (2026-10-06). The recogniser reads one `Thresholds` record (drag slop per pointer kind, long press, multi-click, twist and pinch thresholds), which tests may replace. F1's gesture list is a static list with per-platform notes.
- **Touch** (user, 2026-10-06, U41). The recogniser holds every touch press, in every tool, until 8 px, the lift or 500 ms: a tap acts at the lift at the down point, a pinch never changes the selection or adds anything, and a long press opens only the menu, which its lift cannot close. Two fingers pan, zoom and turn about their moving centroid with MapLibre's thresholds; a pair's cancel ends in place. Timers are base-free: a deadline is measured from the last input's time.
- **Secondary button.** The recogniser's secondary session decides pan versus menu on one stream, with no copied tracker (U33): past 3 px it pans (Shift at the press: rotates); a still release opens the menu at the release point on every OS. On macOS Ctrl+click is secondary, and a pen barrel is too.
- **Native menu.** The DOM source owns one `contextmenu` listener, which feeds the recogniser nothing: it prevents the native menu over the map host, during a canvas press and within 500 ms of a secondary release; the note editor and panel fields keep the native menu. A native menu with no right, pen-barrel or Mac Control press opens nothing (user, 2026-10-06, U34); the Menu key and Shift+F10 reach the selection menu. Firefox's own Shift+right-click menu cannot be prevented (a named Web limitation).
- **No second button during a drag** (user, 2026-10-01). A secondary or auxiliary bit added during a primary drag is ignored for the rest of that session: no nested pan or rotate, no two-level Esc. Wheel zoom and keys stay live during a drag, and the tool host re-emits the drag in world space so the draft stays under the cursor.
- **Keys during a gesture** (user, 2026-10-05, U33). Today's key denylist stays, with one condition: Delete, Backspace's selection fallback and Ctrl+X delete nothing while a pointer gesture or a tool transient (a draft, a Plant a row source, Place plants' waiting point, a held Object stamp pick) is live (canopi-f47t.21). Every other key stays live.
- **One modifier source** (U16, made concrete 2026-10-06). Gesture modifiers are read from the pointer or wheel event that carries them. A modifier or Space key reaches the recogniser only as key-state, to re-step a live rotate and hold Space; the recogniser's held Space is the one record of a held key, and the key router's held-key list only synthesises lost keyups. The tool host needs no platform ([ADR 0018](0018-narrow-tool-interface.md)); a modifier change with the pointer still applies at the next move, and only a live rotate re-steps at once.
- **Pointing device.** Mouse: wheel zooms about the pointer. Trackpad: wheel pans, pinch zooms. A wheel and a pinch zoom continuously, with no notch detection (phase 2). Trackpad rotation needs 10° of accumulated twist; touch twist 25 px of arc; the threshold is subtracted so the view does not jump.
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
- **A bindings constant** (2026-09-29 design, then one constant edited in place): with one release every field ends with one value, so phase 3 deletes it.
- **A held press in the tool host for the tools that act at press** (spec, 2026-09-29): Select still acted at press, so a pinch cleared the selection and a long press lost Cut and Delete; the recogniser's hold covers every tool.
- **Unthresholded trackpad rotation**: every pinch carries a few degrees of twist; the map would wobble.
- **Separate `pinch`/`twist` kinds, or one `navigate { intent }` kind**: tools never see them; intent would fold camera policy into input types.
- **World-space gestures from the recogniser**: it stays camera-free; the tool host converts at event time.
- **Window-listener or `touch-action` changes in the refactor**: behaviour changes; they ship later with their own tests.

## Consequences

- Recogniser fixtures cover about 60 sequences per platform (Windows release-time menus, Mac Ctrl+click, pen barrel, touch, wheel, ignored chords) without a browser; each phase rewrites the expectations it changes; a property test checks every session ends once and every capture is released.
- Policy tests confine pointer capture and canvas `addEventListener` to the source and keep the input core browser-free.
- A new gesture is a recogniser rule and fixtures, not a new listener.
- Details: [`canvas-v2-spec.md`](../plans/canvas-v2-spec.md).

## Amended 2026-09-30 and 2026-10-01

Phase 0B found that the tool host decides admission and drop acceptance but had no way back to the DOM event, and that the source had no channel for keys, `focusout` or `pointerleave`. The pipeline gains a return channel (the router returns the host's outcome) and three raw inputs (`leave`, `focus-out`, and `reject`, which ends a refused press's session with no gesture).

The value audit of 2026-10-01 removed what only acted after a programming error: a cancellation that throws aborts the open edit instead of fencing every later event, and a throwing sink quarantines only a press on the map. The overview pointerup swallow goes as a bug fix; today's window pointer listeners stay until phase F, and until F's key router the source holds today's window key listeners. Details: spec §1.2–1.2a.
