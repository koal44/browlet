# Wheel input roadmap

[input.ts](input.ts) owns queued delivery and transaction state for one Document.
[WheelEvent](../events/wheel-event.ts) remains in the shared event foundation.
Native gesture boundaries, hit testing, and scrolling/zooming are explicit
producer/layout dependencies; Pointer Lock supplies its existing retained state.

## Pointer Events §12: wheel input and transactions

`Document.wheelInput` lazily owns `WheelInputProcessor`. This ownership, receipt
snapshots, and HTML task entry are Browlet integration, approved by Eric on
2026-11-04. §12 supplies the transaction-target, trusted-event, and cancellation
requirements; it does not prescribe a queue API or a Document-owned class.

`queue(input)` copies normalized mouse/wheel data and shared time at receipt,
then delivers on the existing user-interaction task source. A required
`startsTransaction` flag selects a new gesture; continuing and momentum updates
retain its initial target. `queueEnd()` ends that gesture in queue order without
inventing an event. No polling, guessed inactivity timer, or per-event device-unit
conversion is introduced. The adapter owns physical input normalization, sign
consistency, units, inertia, gesture timing for devices without phases, and
cross-Document routing/coordinate translation before this entry.

DOM builds the dispatch path once. Its existing pre-listener callback asks each
path target whether it has an effective non-passive wheel listener, including
slots, shadow roots, and Window. Registration has already resolved passive
defaults. Only uncanceled delivery requests a default action; that operation
receives the private input snapshot, so author changes to event properties cannot
change the requested measurements. Event allocation uses the selected target's
creation realm, while view uses its current Document. Synthetic dispatch has no
transaction or native-default-action effect.

The existing post-unlink Document notification now releases removed wheel targets
as well as repairing legacy mouse position. It does not allocate unused input
state. Removal/reinsertion releases retention; a state-preserving move keeps it.
Inactivity clears the target and invalidates queued input even after reactivation;
Document destruction also removes queued tasks through its existing cleanup.

Browser evidence: `node input-delivery/native-wheel.mjs` in Experimental, using
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It checks trusted delivery,
passive defaults, cancellation, and target mutations. Playwright exposes wheel
notifications without native gesture-phase control: its two-event relocation
results do not prove behavior within a single physical gesture. Blink's
`MouseWheelEventManager` retains a frame-local target and consumes input phases;
Gecko's `WheelTransaction` retains event/scroll targets with preference-based
timing. These support explicit adapter timing rather than a guessed timeout here.

Approved choices and recorded differences:

- `SPEC_CLASH(wheel-related-target)`: null, matching all three browsers. The
  draft's wheel table names the pointer's current target, which can instead suppress
  DOM shadow dispatch when it equals the event target.
- `SPEC_CLASH(native-wheel-which)`: inherit MouseEvent's button+1 value, yielding
  one for native button zero, as Firefox/WebKit do. Chromium reports zero.
- `SPEC_CLASH(wheel-passive-cancelability)`: no non-passive listener on the actual
  path means noncancelable, following §12/DOM and Chromium/Firefox. WebKit keeps
  cancelable=true in the probe, although passive preventDefault still does nothing.
- `SPEC_CLASH(wheel-canceled-transaction)`: cancellation blocks one default
  action without ending the gesture. Blink's manager also clears its target on
  cancellation; §12 does not require that policy. Eric approved retaining the
  target until adapter boundaries, removal, or owner lifetime changes.
- `SPEC_GAP(wheel-removed-target)`: §12 supplies no removal-recovery algorithm.
  End retention at unlinking, informed by Blink's ElementRemoved hook, so reinsertion
  cannot silently restore the old gesture target.

Reached owner dependencies are callable and throwing in `wheel/input.ts`:

- `hitTest(clientX, clientY)`: Pointer Events §12/CSSOM View hit testing, with
  painted text containment and HTML inertness/input eligibility supplied by layout.
- `getLockedElement()`: Pointer Lock's pointer-lock state redirects wheel input;
  that owner/adapter must also supply frozen absolute coordinates when locked.
- `applyDefaultAction(target, input)`: §12's scroll/zoom action and CSSOM View
  scrolling, including scrollable-target choice, line/page geometry, and platform
  preferences. A modifier alone does not identify whether the intended effect is zoom.

Validation: the 22 new input tests and 49 WheelEvent/MouseEvent/UIEvent tests pass
on custom Node, Node 24.19.0, and Node 26.8.1, with the addon disabled and enabled:
71 ordinary passes per configuration, no skips or expected failures. The custom
addon run also passes 218 tests including existing DOM dispatch, mouse/removal,
pointer capture, and Document lifecycle coverage. Project typecheck, focused lint,
and import-boundary checks pass.
