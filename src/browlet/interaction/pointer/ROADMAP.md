# Pointer processing roadmap

Active source state, per-context delivery streams, capture, and direct-manipulation
decisions live here. UserAgent, TopLevelTraversable, and per-gesture ownership stay
unchanged. [PointerEvent](../events/pointer-event.ts) remains in the shared event
foundation. [Mouse delivery](../mouse/ROADMAP.md), [wheel input](../wheel/ROADMAP.md),
and [Pointer Lock](../pointer-lock/ROADMAP.md) have their own implementation roadmaps.

Local Pointer Events reference: _web-platform/specs/pointerevents/index.html,
revision 7affe62fa4332543f8b13c56292104e4e9dfa517, checked 2026-11-04.
[Editor's Draft](https://w3c.github.io/pointerevents/).

## Pointer Events §§3.1.1–3.1.2: button and primary-pointer state

`UserAgent.activePointers` owns the active input sources in `interaction/pointer/active-pointers.ts`.
Activation creates a retained `ActivePointer`; retirement removes that source.
An active mouse or hovering pen need not have any buttons pressed. The first
source of each pointer type is primary; removing it does not promote remaining
sources, and a new primary is selected only after that type has no active sources.
Vendor pointer-type strings use the same rules.

`ActivePointer.changeButton()` accepts one normalized contact/button action and
updates the held-button mask before returning its transition. The first press
selects pointerdown; the last release selects pointerup; intermediate chord
changes select pointermove. Unchanged actions return null. Touch/pen contact uses
the primary-button bit; middle/right button numbers map to their distinct mask
bits. Movement without a button transition separately uses button=-1 in the producer.
These are internal state operations, not a new event-dispatch API.

Eric approved `SPEC_CLASH(pointer-chord-release)`: follow
[§3.1.1](https://w3c.github.io/pointerevents/#button-states) and Chromium/Firefox.
The manual `node-compat/experimental/input-delivery/pointer-state.mjs` probe found
that WebKit 27.2 emits pointerup while another mouse button remains held. Chromium
156.0.8078.4 and Firefox 157.0 emit pointermove, then pointerup on the final release.
Canceling pointerdown and dispatching an unrelated author-created event do not
change the next hardware button mask. The Chromium-only CDP multi-touch probe
confirms no primary promotion or replacement while other contacts remain; it
does not establish Firefox/WebKit touch behavior. Blink's PointerEventFactory
also retains the primary ID until removal and chooses a new primary only when
the type's active count was zero.

The state intentionally has no numeric pointer IDs. §3.1 requires author-visible
IDs to be mapped independently within each top-level context. The eventual
producer must retain source identity, supply activation/retirement notifications,
and consume button transitions through §3.1.3's target/capture/dispatch steps.
It must also supply the aggregate mouse input and platform device lifecycle.
No adapter, WebDriver input command, trusted-event creation, or background task
is connected by this slice. Source-side TODOs identify these producer boundaries;
event constructors and dispatch never update active input state.

Seventeen new enabled state/ownership tests pass in all six runtime configurations.
The 222-test interaction/DOM-event/binding/factory suite has 222 passes on each
addon build and 221 passes plus the existing WindowProxy descriptor expected
failure on each stock build. Type checks, type contracts, scoped lint, import
boundaries, and diff checks pass. No new expected failures or skips were added.

## Pointer Events §3.1.3.2: pending capture and notifications

`PointerCapture` in `interaction/pointer/capture.ts` owns the pending and effective
target of one pointer stream. It is separate from UserAgent's device/source
state; the future context-local pointer-ID owner must retain it. This slice
implements [pending-capture processing](https://w3c.github.io/pointerevents/#process-pending-pointer-capture),
not the complete §3.1.3 firing algorithm or the public Element capture methods.

Processing snapshots the pending target, sends loss before gain, and preserves
listener requests for the next pass. Unchanged targets produce no notifications.
Disconnected pending targets cannot gain capture. Effective capture on a removed
target becomes loss at its Document; removal by a gain listener causes immediate
Document loss. `clearDisconnectedTargets()` exposes the §8.5 cleanup operation
explicitly. The future removal/input integration must call it on disconnection,
before possible reinsertion. Processing also checks current connectivity, but
cannot reconstruct a missed removal/reinsertion. These owner requirements remain
beside the callable operations in source.

Notifications use DOM's existing trusted event creation in the target's realm.
MouseEvent and PointerEvent copy the triggering input fields, including view,
timestamp, modifiers, coordinates, button state, and pointer geometry. The
attribute initializer supplies capture's type/flags/detail. Dispatch state and
cancellation are fresh; §9's coalesced/predicted lists stay empty. Modifier
snapshots can be shared because legacy initialization replaces them rather than
mutating them. Author-created or dispatched capture events do not alter capture.

Eric approved the following continuing differences, observed with
`node-compat/experimental/input-delivery/pointer-capture.mjs` in Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2:

- `SPEC_CLASH(pointer-capture-pending-snapshot)`: follow all three browsers.
  When a loss listener redirects pending capture from B to C, this pass still
  gains B; the following pass transfers B to C. A literal live-state reading of
  the draft can instead apply C immediately.
- `SPEC_CLASH(pointer-capture-event-data)`: follow the draft and Chromium's
  copying of the triggering event. Firefox also copies ordinary transfer data,
  but supplies defaults for detached-target loss. WebKit usually supplies
  default coordinates, modifiers, and view rather than the input values.
- `SPEC_CLASH(pointer-capture-removed-pending)`: follow Chromium/Firefox when
  a loss listener removes the pending target. It receives neither gain nor a
  later loss. WebKit can emit a later loss at the Document for that target.

Blink's `PointerEventManager::ProcessPendingPointerCapture` independently
corroborates the snapshot, post-listener connectivity checks, and immediate
Document loss after removal during gain. Its PointerEventFactory copies the
input attributes separately from capture's flags and empty sample lists.
These browser observations do not establish full Browlet native input delivery
or identical ordering of the subsequent ordinary pointer event.

The enabled `test/browlet/interaction/pointer/capture.test.ts` tests supply
normalized input and explicit internal requests, using real Binding projection
and DOM listeners. They cover transitions, listener redirection/release,
disconnection/reinsertion, attribute isolation, target-realm allocation, and
independent streams. No public pointer-capture API is implied by these tests.

All 14 new tests pass in all six runtime configurations. The focused 17-file
interaction/DOM-event/binding/factory suite has 261 passes on each addon build
and 260 passes plus the existing WindowProxy descriptor expected failure on each
stock build. No new expected failures or skips were added. Typecheck, type
contracts, scoped lint, import boundaries, and diff checks pass.

## Pointer Events §3.1.3: target preparation

`PointerEventStream` in `interaction/pointer/event-stream.ts` composes an assigned
context-local pointer ID, `PointerCapture`, and the pointer's active Document.
Its `prepareTarget()` operation applies the input event's ID and attribute-table
rules, processes pending capture, selects the effective capture target or calls
the required hit test, then records the active Document for down/move/up only.
Raw updates, cancellation, and boundary events do not change that Document.
Capture notifications and click/auxclick/contextmenu use their separate paths
and are excluded from the preparatory method's event-type input.

This is an extracted portion of
[fire a pointer event](https://w3c.github.io/pointerevents/#firing-events-using-the-pointerevent-interface).
Its reviewed callable shape takes a normalized input snapshot plus a required
hit-test callable, and returns the
selected node before boundary ordering or ordinary dispatch. The following
slice adds implicit capture after target selection.
The callable is evaluated only when effective capture is absent. A missing
geometry implementation propagates its failure; no default target is supplied.
The future producer must supply the context's current input position and geometry
at invocation, including the hit-test owner's inert/disabled-element rules.

Eric approved `SPEC_CLASH(pointer-hit-test-after-capture)`: follow the draft's
post-notification target selection and Firefox. The manual browser-only
`node-compat/experimental/input-delivery/pointer-targeting.mjs` probe establishes
capture at A, moves over B, and releases capture. A's loss listener moves C under
the pointer and confirms `elementFromPoint()` returns C. Firefox 157.0 targets C
for that move. Chromium 156.0.8078.4 and WebKit 27.2 still target B, then C on the
next move. This choice does not change the already approved capture-target
snapshot rule: capture requests made by a notification listener remain pending
until the next processing pass.

No top-level registry, device adapter, or public input API is connected by this
slice. Source TODOs require the context-local owner to assign/retain IDs and
release stream references on retirement or Document teardown. The input producer
must subsequently send boundary events, dispatch the input, and retain/repair
previousTarget and needsOverEvent. Public capture lookup, DOM-removal notification, task delivery,
sample generation, and compatibility default actions also remain with their
specified owners. The preparatory operation does not silently run past these
steps or claim complete native firing.

The enabled `pointer-event-stream.test.ts` cases supply the narrow geometry
result and use real DOM/Binding capture notifications. They cover capture
bypassing hit testing, late hit testing after loss, listener redirection,
removed targets, ID/attribute preparation, active Documents across a child
navigable, unchanged state for other event types, and independent streams.

All 17 new cases pass on all six runtimes. The focused 18-file suite has 278
passes on each addon build and 277 passes plus the existing WindowProxy descriptor
expected failure on each stock build. No new expected failures or skips were
added. Typecheck, type contracts, scoped lint, import boundaries, and diff checks
pass.

## Pointer Events §3.1.3: implicit capture and its §8 request dependency

`prepareTarget()` now requests implicit capture for a direct-manipulation
pointerdown targeting an Element, after updating the active Document and before
the caller can dispatch down listeners. The input owner explicitly supplies the
device's direct-manipulation capability; a `"pen"` or vendor-specific pointerType
does not determine whether the device manipulates the display directly.

The reached [§8.2 request algorithm](https://w3c.github.io/pointerevents/#setting-pointer-capture)
lives on the stream as `setPointerCapture(element, buttons)`. It rejects a
disconnected element before consulting Pointer Lock, rejects a locked Document,
then silently returns for no pressed buttons or a different active Document.
A successful request replaces only the pending target. `releasePointerCapture(element)`
clears that element's pending request without changing effective capture yet.
Failed set requests and release requests from a different element retain the
earlier pending state.

The reviewed callable shape replaces pointerId lookup with this resolved stream
and supplies its current button mask. The public Element methods
must still resolve an active context-local ID and throw NotFoundError for an
unknown ID before entering these operations. The constructor requires the
Document's locked-element query from the unfinished Pointer Lock owner; no
production default assumes an unlocked Document. Source TODOs retain that
dependency and the missing public lookup and retirement responsibilities.

The manual browser-only `pointer-implicit-capture.mjs` probe in Experimental
observes identical touch timing in Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2: pending capture is visible inside pointerdown; the next input
activates capture. Releasing inside down prevents gain. This adds no browser
disagreement or expected failure. Enabled Browlet tests exercise the prepared
state through real DOM/Binding dispatch and test the validation order with only
geometry and Pointer Lock supplied by the test. They do not claim complete
native input delivery or public Element capture APIs.

All 25 added cases pass on all six runtimes. The focused 18-file suite reports
303 passes on each addon build and 302 passes plus the existing WindowProxy
descriptor expected failure on each stock build. Typecheck, type contracts,
scoped lint, import boundaries, and diff checks pass.

## Pointer Events §3.1.3: boundary sequence, dispatch, and previous-target repair

`PointerEventStream.dispatchToTarget(event, target, getHoverTarget, mouseClickCount, samples?)` completes delivery of a
prepared, realm-owned ordinary input. It sends out/leave, then over/enter, then
the ordinary event, and returns its cancellation result. The reviewed callable extracts the
remaining dispatch steps of "fire a pointer event" rather than creating an input
event or implementing geometry itself. The later §8.5 slice adds the required
post-release hover-target query described below. The input owner must supply the event
in the selected target's realm after target/capture preparation. Boundary events
are freshly allocated by their own targets and do not re-enter pending capture.

The boundary definitions are §§3.3.1–3.3.2 and §§3.3.8–3.3.9. Ancestor chains use
the existing flattened-tree operation, including assigned slots and shadow hosts.
Common ancestors receive no leave/enter pair; leave runs inward-to-outward and
enter outward-to-inward. DOM retains ownership of bubbling, composed paths, and
related-target retargeting. Canceling a boundary event does not cancel the main input.

Eric approved these choices from `pointer-boundaries.mjs` in Experimental,
run on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2:

| Marker | Chosen behavior and competing result |
| --- | --- |
| `pointer-boundary-ancestor-snapshot` | Snapshot both chains before notifications, as Firefox/WebKit do. Chromium snapshots after out; moving the destination in that listener changes its enter ancestors. All three retain the old enter list when moved during leave. |
| `pointer-target-after-boundary-mutation` | Keep the selected main-event target, following §3.1.3 and Chromium/Firefox. WebKit redirects the probed move after boundary-time reparenting. |
| `pointer-boundary-document-entry` | Send enter/leave only to Elements, following the type definitions and Firefox/WebKit. Chromium also sends enter to Document on initial entry. |
| `pointer-boundary-related-target` | Use the opposite target, as all three browsers do. The draft's boundary tables reverse the entering/leaving descriptions. |
| `pointer-boundary-removed-related-target` | Use the repaired previous target as relatedTarget, matching Chromium/Firefox. WebKit uses null in the removal case. |

DOM dispatch now accepts an optional internal path-capture callback, approved by
Eric, invoked after building the path and before listeners. Pointer delivery
retains that array without copying; DOM still clears the event's path at dispatch
completion. The stream uses the original path to find a surviving connected
ancestor if a listener removes or reparents/removes the target. It sets
needsOverEvent so a subsequent delivery sends over even at that same ancestor.

`clearDisconnectedTarget()` is the explicit removal-owner operation. The closing
audit now connects it to DOM removal through the existing top-level stream scan,
alongside capture cleanup, before reinsertion. Checking connectivity at the next
dispatch cannot reconstruct a missed remove/reinsert.
§3.1.4 layout-triggered delivery is separate: Chromium/Firefox can deliver the
removal recovery before the next native move; this slice performs it on the next
input-owner call. No layout wake-up, top-level ID registry, native adapter,
public capture API, or compatibility default action is claimed here. §8.5's
post-up/cancel release is connected by the following slice.

Enabled tests cover initial entry, common ancestors, target changes, cancellation,
capture transitions and listener requests, mutation snapshots, closed roots,
slots, actual-path retention, repeated ancestor removal, and owner notification
before reinsertion. The DOM regression verifies that path capture precedes author
listeners and survives cleanup without changing the exposed event path.

All 20 added cases pass on all six runtimes. The focused 19-file suite reports
323 passes on each addon build and 322 passes plus the existing WindowProxy
descriptor expected failure on each stock build. No new expected failures or
skips were added. Typecheck, type contracts, scoped lint, import boundaries,
and diff checks pass.

## Pointer Events §3.1.3.3: suppression and §8.5 implicit release

`PointerEventStream.suppress(hitTest)` implements cancellation, capture release,
out, and leave for a delivered stream. It uses one private, reused input snapshot
that is never projected or dispatched. Author reinitialization of a previous
event cannot change the later cancellation fields. Cancellation has fresh realm
ownership, trust, dispatch state, and creation time, with empty sample lists and
the last input's coordinates, pressure, and orientation as §3.3.7 requires.
After suppression, repeated calls do nothing until another input is delivered.

`dispatchToTarget()` now takes a required `getHoverTarget()` callable. After
pointerup it releases capture, then calls this dependency to obtain the current
hit target or null for non-hover input/outside the context. The input producer
supplies device capability explicitly; pointerType does not determine hover.
For pointercancel it exits without querying a hover destination. The restored
over event's actual DOM path supports removal recovery even when a boundary
listener removes the target. These added callable arguments expose input-owner
dependencies instead of introducing ambient device or geometry lookup.

Eric approved the following choices from the browser-only
`input-delivery/pointer-suppression.mjs` probe in Experimental (2026-11-03):

| Marker | Choice and evidence |
| --- | --- |
| `pointer-implicit-release-order` | Follow §8.5: immediately release capture after up/cancel, before exit events. Chromium/Firefox agree on native drag cancellation; all three agree on touch up. §3.1.3.3's list puts release after exit events. WebKit did not generate cancel in the native drag probe. |
| `pointer-up-hover-target` | Restore the uncaptured hit target after up, following §8.5 and Chromium/Firefox. WebKit sent out/leave but missed entry to the destination in the captured-mouse probe. |
| `pointer-cancel-last-input` | Follow §3.3.7's explicit field preservation. Chromium reset pressure on touch cancel and also reset coordinates on drag cancel; Firefox retained drag pressure but used a newer position. |

The probe used Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Native
touch cancellation was available through Chromium's protocol only. Browser-only
evidence is separate from the enabled Browlet suppression/release tests, which
exercise real Binding and DOM dispatch with supplied geometry and lock queries.

Source TODOs identify the unconnected triggers: device loss, modal UI,
viewport manipulation (§7), and HTML drag initiation. Those owners must call
`suppress()`; this does not implement their detection. Context-local active IDs,
source retirement, public capture APIs, DOM removal notifications, and the
§§10–11 compatibility/default-action producer remain separate dependencies.

All 16 new cases pass on all six runtimes. The focused 20-file suite reports
339 passes on each addon build and 338 passes plus the existing WindowProxy
descriptor expected failure on each stock build. No new expected failures or
skips were added. Typecheck, type contracts, scoped lint, import boundaries,
and diff checks pass.

## Pointer Events §3.1.4: stationary-pointer boundaries after layout

`PointerEventStream.updateAfterLayout(hitTest, timeStamp)` performs one boundary
refresh using the retained pointer input. It processes pending capture, repairs
a disconnected previous target, then uses effective capture or the supplied hit
test. It sends the existing out/leave/over/enter sequence without pointermove or
pointerrawupdate, and retains the over event's actual path for subsequent removal
recovery. Stable capture bypasses hit testing; an unchanged target sends nothing.
The active Document changes only for the existing down/move/up input paths.

The section defines a requirement rather than a named callable algorithm. The
method makes its two external inputs explicit: hit testing at the stationary
pointer position and the current event timestamp from the caller's realm.
Coordinates, held buttons, modifiers, and pointer fields are retained; movement
deltas become zero and button becomes -1 because no button changed. Author-held
events are not mutated. Suppressed/non-hover-ended streams have no retained input
and do nothing. A layout hit test returning null sends exit events while retaining
the pointer data for possible later re-entry.

The browser-only `input-delivery/pointer-layout.mjs` probe ran on Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2 on 2026-11-03. Chromium/WebKit sent
the ordinary layout transition without a move; Firefox sent removal recovery
but no ordinary position-swap events during the 250ms observation. That observation
does not establish an upper limit on delivery delay: §3.1.4 explicitly allows
deferral. Where events were delivered, the probes used fresh timestamps, unchanged
coordinates, zero movement, and button -1. All three kept stable capture.

Eric approved `SPEC_CLASH(pointer-layout-pending-capture)`: reuse the draft's
capture-first order. Chromium applied a pending transfer during layout but sent
boundary events before gotpointercapture. Firefox/WebKit did not process the
pending transfer/release during the observation. Existing approved ancestor
snapshots, hit testing after capture listeners, and removal-relatedTarget choices
also apply to this operation.

The required hit-test callable and source TODO identify the remaining owners:
the context-local input producer must retain live streams and their coordinate
mapping; the layout owner must schedule updates after relevant invalidation.
Listeners can change layout again; the caller may coalesce those changes and
schedule another pass. This method deliberately performs one pass, with no timer,
recursive layout loop, invented geometry, or native-input registration. The
existing HTML rendering hooks do not yet supply a layout implementation or this
stream registry, so automatic rendering integration remains unfinished.

All 11 new cases pass on all six runtimes. The focused 20-file suite reports
350 passes on each addon build and 349 passes plus the existing WindowProxy
descriptor expected failure on each stock build. No new expected failures or
skips were added. Typecheck, type contracts, scoped lint, import boundaries,
and diff checks pass.

## Pointerover and pointerenter audited

[§3.3.1](https://w3c.github.io/pointerevents/#the-pointerover-event) and
[§3.3.2](https://w3c.github.io/pointerevents/#the-pointerenter-event) need no new
runtime behavior beyond the existing boundary machinery:

- Movement into a target sends over, then outer-to-inner entry for newly entered
  Element ancestors. A common ancestor is not entered again when moving between
  its descendants.
- `updateAfterLayout()` uses the same transition for a stationary pointer while
  respecting capture. Layout invalidation and actual geometry remain required
  input/layout-owner dependencies at that method's source-side TODO and hit-test
  callable.
- A non-hover contact starts with entry before its down event. Returning null
  from the required post-up hover query leaves the next contact with no previous
  target, so another contact at the same position enters again. A button press
  while already hovering does not duplicate entry. Hover capability remains an
  input-owner decision, not a deduction from the pointerType string.

Over bubbles and is cancelable/composed; enter is a separate non-bubbling,
noncancelable, noncomposed event for each newly entered Element. DOM still
delivers an enter event to ancestor capture listeners. Both events carry the
opposite target through relatedTarget, retaining the approved table-wording,
Document-entry, and shadow-retargeting choices recorded above.

Five added cases in
[boundary.test.ts](../../../../test/browlet/interaction/pointer/boundary.test.ts)
cover successive non-hover touch/pen contacts, hover-to-press entry suppression,
and propagation/independent ancestor events after movement and layout changes.
These exercise the internal input pipeline with real bindings; they do not
connect native devices or implement layout hit testing. Existing tests cover
target ancestry, capture, removal, and shadow boundaries.

Validation: all 35 boundary tests, including the five new cases, pass on custom
Node, Node 24.19.0, and Node 26.8.1 with and without the addon. There are no
expected failures or skips in this focused suite. Typecheck, type contracts,
scoped lint, import boundaries, and diff checks pass.

## Pointerdown audited

[§3.3.3](https://w3c.github.io/pointerevents/#the-pointerdown-event) is covered by
the existing source transitions and stream dispatch. `ActivePointer.changeButton()`
selects down only when entering the active-buttons state. Mouse first press,
touch contact, pen contact, and a hovering pen's first barrel press all use that
transition. Additional buttons or contact while a barrel button is held select
move. Non-hover over/enter ordering is covered by the preceding slice.

Four added cases in
[event-stream.test.ts](../../../../test/browlet/interaction/pointer/event-stream.test.ts)
compose real UserAgent source state, target preparation, and realm-owned DOM
dispatch. They cover mouse/pen chords and canceled/passive touch down delivery.
Canceling down reports failure to the caller without reverting button state or
implicit capture; the subsequent release still dispatches up and releases capture.

The note about `PREVENT MOUSE EVENT` belongs to the compatibility mapper
defined in [§§10.2–10.3](https://w3c.github.io/pointerevents/#compatibility-mapping-with-mouse-events).
That owner now consumes a canceled primary down, retains the flag per pointerType,
suppresses mapped down/move/up, and clears it after up/cancel, as documented in
the §§10.2–10.3 slice below. Mouse boundaries and click/auxclick/contextmenu remain
independent. Native input normalization, source-to-stream composition, and default
actions still need their owners; this earlier audit added no runtime behavior.

Validation: the source-state, stream, and boundary suites pass all 98 cases on
custom Node, Node 24.19.0, and Node 26.8.1, each with and without the addon.
These focused runs have no expected failures or skips. Typecheck, type contracts,
scoped lint, import boundaries, and diff checks pass.

## Pointer Events §§3.3.4–3.3.11: motion, release, and capture

This slice audits the remaining ordinary event types together, repairing two
requirements in the existing native path:

- [§3.3.5 pointerrawupdate](https://w3c.github.io/pointerevents/#the-pointerrawupdate-event):
  `dispatchToTarget()` checks the selected target document's existing
  `isSecureContext` classification. Insecure raw delivery returns without firing
  boundaries, dispatching the raw event, or replacing retained input/target state.
  Target preparation, including pending capture, remains a separate preceding
  stage. Author dispatch still uses ordinary DOM dispatch.
- [§3.3.6 pointerup](https://w3c.github.io/pointerevents/#the-pointerup-event):
  native attribute preparation now sets pressure to zero before capture
  processing and dispatch. Capture and exit notifications therefore copy zero
  from the release. Author constructors retain their Web IDL-converted pressure.

Both focused regressions failed before the repairs: insecure raw delivery emitted
five events, and an up packet with pressure 0.8 retained it on up, capture gain/loss,
and exit notifications. Seven cases in
[motion.test.ts](../../../../test/browlet/interaction/pointer/motion.test.ts)
also cover secure raw flags and boundary ordering, pending capture, retention of
the last raw input for cancellation despite author reinitialization, and author
construction/dispatch independence.

The `node-compat/experimental/input-delivery/pointer-motion.mjs` browser-only probe
used Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Chromium/Firefox delivered
raw updates only on HTTPS; WebKit delivered none in either context in this probe.
All three reported zero pressure on up. Eric approved
`SPEC_CLASH(pointer-rawupdate-boundary-order)`: retain the shared §3.1.3 firing
order and Firefox's boundaries-before-raw behavior. Chromium sends raw first,
then boundaries before move. The existing approved raw-cancelability difference
remains: Firefox's raw event was cancelable; the draft and Chromium say false.
Blink's `PointerEventManager::HandlePointerEvent()` corroborates its separate
raw-dispatch path and secure-context check. These probes do not establish WebKit
raw-update behavior when delivered by a different device/platform path.

The other requirements reuse existing owners and acceptance tests:

| Sections | Implemented path and remaining dependency |
| --- | --- |
| §3.3.4 move, §3.3.5 raw update | Prepared input fields, flags, targeting, and dispatch are retained. The input producer must recognize non-position changes, deliver raw before its corresponding move, and hit test each event's final coordinates. Scheduling/optional coalescing and §9's chronological sample generation remain explicit TODOs at `prepareTarget()` and PointerEventImpl. No native packet-to-task pipeline is claimed. |
| §3.3.6 up | ActivePointer selects up on the last release; stream dispatch releases capture even after cancellation, then restores hover or exits. Pressure normalization is repaired above. |
| §3.3.7 cancel | `suppress()` copies the last delivered input, including raw updates, into noncancelable cancellation with empty sample lists. Physical loss, modal UI, viewport manipulation, and drag triggers remain with the owners named at that operation. |
| §§3.3.8–3.3.9 out/leave | Existing movement/layout transitions, non-hover up, and suppression send exit notifications. Ancestor filtering, shadow retargeting, removal recovery, and the approved ordering differences retain their boundary/suppression coverage. |
| §§3.3.10–3.3.11 capture notifications | Pending-capture processing sends loss/gain before subsequent input and retains the approved mutation/removal behavior. Context-local active-ID lookup and public capture methods remain explicit §8 integration work. §3.3.12's click-target exception is next. |

Validation: all seven new cases pass on custom Node, Node 24.19.0, and Node 26.8.1,
with and without the addon. The 23-file focused interaction/DOM-event/binding/factory
run has 398 passes on each addon build, and 397 passes plus the existing WindowProxy
descriptor expected failure on each stock build. No new expected failures or skips
were added. Typecheck, type contracts, scoped lint, import boundaries, and diff
checks pass.

## Pointer Events §3.3.12: click, auxclick, and contextmenu

The three activation-event subsections now have internal creation and dispatch:

- `PointerEventImpl.createActivation(type, target, source)` copies only the
  mouse/UI input into a fresh, trusted, bubbling/cancelable/composed event in the
  selected target's realm. It uses that target's Window view, fresh creation time,
  integer screen/client coordinates, default pointer fields, and empty sample
  lists. Non-pointer input keeps pointerId -1 and pointerType empty.
- `PointerEventStream` retains the press target and one reusable private down/up
  snapshot with its actual dispatch target and effective capture state. This
  survives up's capture release, non-hover exit, and author reinitialization.
  Cancellation clears both retained activation records; the next down replaces
  the press. The existing stream-retirement dependency includes these references.
- `dispatchActivation(type, detail)` uses the context-menu interaction target,
  or the captured release target even after loss. Uncaptured click/auxclick uses
  the current nearest common ancestor, following flat-tree parents through slots
  and shadow hosts. With no completed pair/common ancestor, no click is dispatched.
  Activation neither processes pending capture nor changes ordinary boundary state.

The reviewed callable shape follows §3.3.12.3's event/userEvent dispatch steps. The stream
retains the interaction facts before author callbacks and accepts the activation
type and UI Events detail, creating the event only after choosing its allocation
target. This avoids retaining a mutable author event as native input state.

The browser-only `node-compat/experimental/input-delivery/pointer-activation.mjs`
probe exercised Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved:

- `SPEC_CLASH(pointer-activation-defaults)`: follow §3.3.12.1 and Chromium's
  pointer-specific defaults. Firefox/WebKit retained isPrimary=true, including
  keyboard clicks; WebKit also retained nonzero contextmenu pressure. All three
  retained pointer ID/type for device input and used -1/empty for keyboard input.
- `SPEC_CLASH(pointer-activation-live-ancestry)`: follow the draft/Firefox's
  current common ancestor after a press target is reparented by an up listener.
  Chromium/WebKit suppressed that click. All three suppressed the tested case
  with the press target removed and no common ancestor.
- `SPEC_CLASH(pointer-activation-shadow-ancestry)`: follow all three browsers
  across shadow hosts and slots; literal DOM-tree ancestry cannot connect the
  observed targets. The slotted-to-shadow case targeted their shared shadow
  ancestor, retargeted to the host outside it. Blink's
  `event_handling_util::ParentForClickEvent()` uses `FlatTreeTraversal::Parent()`.

All three preserved a captured release's click target after lostpointercapture.
The context-menu probe also confirmed differing platform timing: Chromium fired
after up, Firefox/WebKit after down. The caller therefore chooses when to invoke
the operation; this slice does not impose one timing convention.

Explicit owners remain in source: UI Events/input production must qualify gestures,
count clicks, choose context-menu timing, and invoke dispatch; default actions
remain with HTML/UI Events. HTML §8.1.8.3 must supply current keyboard modifiers
and its not-trusted flag before its synthetic-click callers can be connected.
Non-pointer producers use the factory and ordinary DOM dispatch, without a pointer
stream or target override. CSSOM View's page/offset/x/y attributes remain with
their existing unfinished geometry owner. Author constructors/dispatch are unchanged.

Fifteen focused tests cover defaults, identity, coordinates, capture, mutation,
shadow/slot targeting, cancellation, non-pointer allocation, and author independence.
All 15 pass on custom Node, Node 24.19.0, and Node 26.8.1, with and without the
addon, without expected failures or skips. The broader 24-file interaction/DOM
event/binding/factory run passes all 413 cases on custom Node with the addon.
Typecheck, type contracts, scoped ESLint, import boundaries, and diff checks pass.

## Pointer Events §4: Element pointer capture

[§4](https://w3c.github.io/pointerevents/#extensions-to-the-element-interface)
now exposes `setPointerCapture(long)`, `releasePointerCapture(long)`, and
`hasPointerCapture(long)` on Element. The methods live on ElementImpl, with the
Pointer Events partial declaration beside the capture owner. Ordinary Binding
provides required arguments, long conversion, receiver branding, and realm-owned
exceptions; HTML, SVG, and MathML elements inherit the same methods.

`TopLevelTraversable.pointerEventStreams` indexes active streams by context-local
ID, shared with descendant documents but isolated from other top-level contexts.
This follows [pointerId's scope](https://w3c.github.io/pointerevents/#dom-pointerevent-pointerid)
without moving UserAgent's source/primary-pointer state. Top-level destruction
clears its map after Document teardown. Element resolves the receiver's current
context even for borrowed methods, then delegates to the existing
[§8.2](https://w3c.github.io/pointerevents/#setting-pointer-capture) and
[§8.3](https://w3c.github.io/pointerevents/#releasing-pointer-capture) checks.
Unknown IDs throw NotFoundError before connectivity or Pointer Lock is inspected;
`hasPointerCapture()` simply tests the pending target. Setting and releasing only
change pending state; notifications remain with the next processing pass.

The browser-only `node-compat/experimental/input-delivery/pointer-capture-api.mjs`
probe exercised Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three
agreed on unknown IDs in active documents, disconnected targets, unpressed
pointers, immediate pending visibility, replacement, wrong-element release, and
the active-Document restriction across a child frame. Eric approved:

- `SPEC_CLASH(pointer-capture-no-context)`: without an active browsing context,
  set/release do nothing and has returns false, following Chromium/WebKit.
  The draft has no no-context exception, and Firefox rejects an unknown ID even
  for an inert Document. Blink's Element methods similarly require GetFrame();
  WebKit's require a Page before reaching its PointerCaptureController.
- `SPEC_CLASH(pointer-capture-up-buttons)`: capture requests use current zero
  buttons during pointerup, following §8.2 and Chromium/WebKit. Firefox temporarily
  accepts recapture in its up listener. Target preparation records buttons before
  capture notifications as well as the ordinary input listener, independently
  of author-visible event mutation.

The source retains the unfinished owners explicitly: the input producer must
assign IDs, register streams before delivery, and retire them after final
notifications. Individual Document teardown is connected by the
[closing lifecycle integration](#document-lifetime-integration). Producers must
supply the Pointer Lock owner's required query. No default unlocked state or device
registration is inferred from author construction/dispatch. The shared map makes
these APIs callable once input is supplied; it is not a native input pipeline.

Seventeen tests in
[capture-api.test.ts](../../../../test/browlet/interaction/pointer/capture-api.test.ts)
cover exposure/conversion, pending/effective state, implicit capture, release
timing, cross-Window borrowing, child-document sharing, top-level isolation,
no-context behavior, producer retirement, and author-event independence. Existing
top-level destruction coverage also checks that only the destroyed context's map
is cleared. All 17 API tests pass on custom Node, Node 24.19.0, and Node 26.8.1,
with and without the addon, without expected failures or skips.

The broader 26-file interaction/DOM-event/binding/factory/teardown run passes all
441 cases on custom Node with the addon. Typecheck, type contracts, scoped ESLint,
import boundaries, and diff checks pass. The existing Element-prototype inventory
now includes the three newly exposed methods.

## Pointer Events §6: Navigator touch capacity

[§6](https://w3c.github.io/pointerevents/#extensions-to-the-navigator-interface)
contributes `Navigator.maxTouchPoints` through a separate partial in `../pointer.ts`.
The primary Navigator implementation asks its UserAgent for the relevant
environment's BiDi override first, then for device capacity. It does not cache the
answer or infer it from active pointers, pointer events, or current contacts.
The attribute is read-only on secure and insecure Window globals; this partial
does not extend WorkerNavigator.

Two dependencies remain explicit in UserAgent:

- `webDriverBiDiEmulatedMaxTouchPoints(env)` returns null because Browlet has no
  active BiDi sessions. [BiDi §7.4.2.14](https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-max-touch-points)
  must later select top-level traversable, user-context, then session-default
  overrides. This slice does not implement `emulation.setTouchOverride` or sessions.
- `getMaxTouchPoints()` is a throwing native-input host boundary. §6 requires the
  maximum capacity of the individual digitizers, not their sum (2, 5, 10 gives 10).
  A known non-touch host supplies zero; an unknown precise capacity can use the
  minimum guaranteed by that host. Node has no built-in digitizer query, and the
  planned native input adapter is not connected. Ordinary reads therefore still
  throw until this operation is supplied; an emulated value bypasses it.

The browser-only `input-delivery/max-touch-points.mjs` probe in Experimental checked
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All agree on HTTP/HTTPS
exposure, descriptors, aliases, and receiver branding. Chromium's CDP overrides
are reflected immediately (5, 10, then 0 after disabling); this is CDP evidence,
not a test of BiDi. Playwright's `hasTouch` flag changes only Chromium's capacity
in these builds, so it is not a portable hardware-capacity oracle. Source owners
agree on keeping this separate from active pointers: Blink's `NavigatorEvents`
reads frame settings, Gecko's Navigator queries its widget after emulation/privacy
selection, and WebKit's Navigator uses platform/quirk defaults.

Seven focused tests use real bindings and supplied hardware/BiDi queries to cover
exposure, current capacity including zero, emulation precedence and clearing,
active-pointer independence, borrowed getters, and retained Navigator ownership.
All seven pass on custom Node, Node 24.19.0, and Node 26.8.1, with and without the
addon, without expected failures or skips. These checks do not establish native
hardware discovery or BiDi session selection.

The combined Navigator touch/permissions/storage run passes all 20 cases on
custom Node with the addon. Typecheck, type contracts, scoped ESLint, import
boundaries, and diff checks pass.

## Pointer Events §7.1: touch-action CSS property

[§7.1](https://w3c.github.io/pointerevents/#the-touch-action-css-property) now has
a Stylelet property definition in `props/built-in/touch-action.ts`. It supports
the exclusive auto/none/manipulation keywords, one horizontal and/or vertical
pan keyword, and the pinch-zoom contribution from
[Compatibility §3.5.1](https://compat.spec.whatwg.org/#touch-action), which §7.3
explicitly references. That reference is cloned locally at
`_web-platform/specs/whatwg-compat/compatibility.bs`.

The ordinary value retains keywords in grammar order. Stylelet's existing
WholeValue, cascade, and CSSOM paths supply CSS-wide defaulting, custom-property
substitution, non-inheritance, importance, mutation, and the touchAction/dashed
attributes. The initial value is auto, percentages are not applicable, the
resolved-value stage is Computed, and the property is not animatable.

The browser-only `input-delivery/touch-action.mjs` probe in Experimental checked
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved both choices:

- `SPEC_CLASH(touch-action-directions)`: follow the specified directional pan
  keywords and Chromium; Firefox/WebKit reject pan-left/right/up/down.
- `SPEC_CLASH(touch-action-computed-alias)`: preserve the specified
  pan-x pan-y pinch-zoom combination at Computed, following the property table
  and Firefox/WebKit. Chromium exposes manipulation for that combination.
  This does not change the equivalence of their eventual gesture permissions.

Forty-nine focused value/CSSOM tests pass on custom Node, Node 24.19.0, and
Node 26.8.1, with and without the addon, without expected failures or skips.
The broader property/engine/Browlet-style run passes 389 tests with seven
unchanged skips. Typecheck, type contracts, scoped ESLint, import boundaries,
and diff checks pass.

This slice implements the CSS property, not gesture arbitration. Its `appliesTo`
operation explicitly throws until layout supplies box classification: exclude
non-replaced inline elements and table rows, row groups, columns, and column groups.
Computing the property on such an element remains valid. The next slice below
implements permission decisions and the takeover guard. Layout classification,
transforms, scroll containers, gesture recognition, and actual viewport manipulation
remain separate owners; selection and link/control activation must not be blocked
by touch-action.

## Pointer Events §7.2–§7.3: direct-manipulation decisions

[`DirectManipulation`](direct-manipulation.ts) implements
[§7.2's permission rules](https://w3c.github.io/pointerevents/#determining-supported-direct-manipulation-behavior)
using [§7.3's value meanings](https://w3c.github.io/pointerevents/#details-of-touch-action-values)
and [Compatibility's pinch-zoom extension](https://compat.spec.whatwg.org/#touch-action).
Eric approved a per-contact snapshot with required layout inputs. It reads real
computed values, follows flat-tree ancestry, includes the nearest scroll container's
own restriction for panning, and continues checking zoom restrictions above it.
Non-applicable boxes do not restrict either behavior. Supplied direction mappings
are consumed once, before listeners, separately for each applicable element.
The snapshot retains no elements, style objects, or live layout callbacks.

The first recognized pan direction commits acceptance or rejection for that
contact. Accepted directional pans may reverse; excluded axes remain excluded.
Later style, ancestry, or direction changes cannot turn a rejected gesture into
a permitted pan. Auto permits pan, continuous zoom, and timed multi-activation zoom;
manipulation and pan-x pan-y pinch-zoom omit the timed gestures. Multi-finger
panning/zooming requires every participating contact to permit pinch-zoom; grouping
those contacts and recognizing gestures remain input-producer work.

`SPEC_CLASH(touch-action-frame-zoom)`: §7.1 says touch-action does not cross
embedded contexts, while §7.2 extends zoom checks to the top-level document.
Eric approved the latter for zoom, following Blink's
[`AdjustEffectiveTouchAction`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/resolver/style_adjuster.cc).
Pan checks stop at the child document; zoom checks continue through the embedding
element and its ancestors. Firefox's
[`TouchActionHelper`](https://searchfox.org/mozilla-central/source/gfx/layers/apz/util/TouchActionHelper.cpp)
also keeps separate pan and zoom ancestor limits. This is source evidence, not a
claim of a cross-frame native gesture comparison on all three browsers.

`PointerEventStream.suppressForDirectManipulation()` implements §7.1's takeover
conditions after the producer chooses an allowed gesture: require direct-manipulation
capability and a delivered down with no subsequent up/cancel, then use existing
trusted cancellation, capture release, and boundary exit. Prepared-but-undelivered
down, hover, ended contacts, and repeated takeover do nothing. Canceling pointerdown
does not block this operation. Selection, activation, and author event dispatch
do not consult this policy.

Experimental's `input-delivery/direct-manipulation.mjs` drove eleven native-touch
cases on Chromium 156.0.8078.4. It confirmed axis/direction restrictions, suppression
on takeover, frozen styles despite pointerdown changes in either direction, and
continued scrolling after canceling pointerdown. Direction names describe scrolling:
pan-left permits the finger moving right, decreasing scrollLeft. The enabled
Browlet tests exercise computed styles and real Binding/DOM dispatch with supplied
layout facts, including a frozen snapshot followed by author mutation and takeover.

Missing dependencies remain explicit at construction and producer call sites:
CSS box applicability, CSS Overflow scroll-container classification, transform-aware
local directions, gesture recognition/grouping, and actual viewport manipulation.
No default layout or native adapter is manufactured. A slot/shadow-host test reaches
Stylelet's existing `Computed-style shadow-scope selection is not implemented` stub;
Eric approved retaining that required-behavior regression as an expected failure
until CSSOM/CSS Scoping query selection and cross-scope inheritance are implemented.

The focused permission/suppression suites pass 46 tests with that one expected
failure on custom Node, Node 24.19.0, and Node 26.8.1, with and without the addon.
The broader pointer/property run passes 259 tests with the same expected failure.
There are no ordinary failures or skipped tests in these runs.

## Pointer Events §8: capture audit and DOM removal

[§8.2–§8.4](https://w3c.github.io/pointerevents/#setting-pointer-capture) reuse the
existing Element bindings and stream operations: active-ID lookup, connectivity,
Pointer Lock, current buttons, active Document, pending requests, release, and
implicit direct-manipulation capture before down listeners. §8.5's immediate
up/cancel release and subsequent hover boundaries were already covered.

The missing [§8.5 removal hookup](https://w3c.github.io/pointerevents/#implicit-release-of-pointer-capture)
is now connected. DOM removal notifies the existing TopLevelTraversable once,
immediately after unlinking the subtree and before removal steps. It scans that
context's active streams and releases disconnected pending targets through the
existing stream method. This covers descendants and shadow trees without a
reverse registry or another subtree walk. A connected replacement request survives
removal of the old effective target. DOM's state-preserving move bypasses this hook.

`SPEC_CLASH(pointer-capture-reinserted-loss)`: Eric approved Chromium/Firefox's
deferred loss at a reconnected element. The draft recommends redirecting effective
capture to Document upon disconnection; WebKit adds Document notifications in the
probed removal/reinsertion cases. Browlet immediately clears pending capture but
retains effective capture until processing. If still disconnected then, it receives
loss at Document. No event is dispatched during DOM removal, and a pending request
that never became effective generates no loss. A capture pass retains its existing
pending-target snapshot even if a listener removes and reinserts that target;
the cleared request takes effect on the next pass.

Experimental's `input-delivery/pointer-capture-removal.mjs` checked six native-mouse
scenarios on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Chromium/Firefox
also preserve capture across moveBefore; WebKit lacked that method in this probe.
Blink's
[`ElementRemoved` and `ProcessPendingPointerCapture`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/input/pointer_event_manager.cc)
separate pending-request removal from effective-target processing. Firefox's
[`ReleaseIfCaptureByDescendant`](https://searchfox.org/mozilla-central/source/dom/events/PointerEventHandler.cpp)
likewise releases pending descendant targets. These support the existing stream
map scan; no change to the capture-processing algorithm was needed.

The new removal suite initially had seven failures and three passes: pending
capture incorrectly survived removal/reinsertion. All ten now pass. The four
focused capture suites pass 87 tests on custom Node, Node 24.19.0, and Node 26.8.1,
with and without the addon. The broader DOM mutation/range/iterator and pointer
boundary/suppression run passes 191 tests. Neither run has skips or expected failures.

Remaining dependencies are explicit in source: the future input producer must
register/retire streams, and Pointer Lock success must call the existing release
operation for affected pending targets. Compatibility mouse mapping belongs to
§10; optional widget-specific implicit capture belongs to its HTML control owner.
The separate §3.1.3 previous-boundary-target removal hook remains unfinished;
this capture hookup does not claim to recover every remove/reinsert boundary path.

## Pointer Events §9.1–§9.3: trusted sample lists

[§9](https://w3c.github.io/pointerevents/#coalesced-and-predicted-events) now has
trusted sample preparation in `PointerEventImpl.initializeSampleLists()`, called
by native stream delivery before boundary notifications. The callable change is
an optional final `PointerEventSamples` argument to `dispatchToTarget()`: the
producer supplies its measured coalesced inputs and optional predictions together.
The event owner creates fresh target-realm events, preserving measurements and
timestamps while applying parent pointerId/pointerType/isPrimary and trust.
Sources are unchanged; the same inputs may supply independent raw/move lists.

Unbatched move/raw delivery creates one coalesced sample. Only pointermove accepts
predictions; other native event types retain empty lists. Samples are not dispatched,
have false bubbles/cancelable/composed, empty nested sample lists, and no currentTarget
or event path. Invalid producer chronology or timestamps on the wrong side of the
parent fail explicitly before input delivery. Equal timestamps are valid. There is
no silent sorting, timestamp clamping, or prediction synthesized from an idle input.

Eric approved two continuing conflicts:

- `SPEC_CLASH(pointer-sample-data)`: retain measured input/timestamps, as all three
  browsers do, rather than applying §9.3's blanket defaulting to meaningful sample
  data. Keep composed=false like Chromium; Firefox/WebKit expose true.
- `SPEC_CLASH(pointer-sample-targets)`: follow §9.3/WebKit on each parent target
  change, including shadow cleanup. Chromium retains the original inner target
  even outside a closed shadow root; Firefox retains the first observed target.
  The approved Event target-change hook lets PointerEvent maintain its lists
  without adding pointer knowledge to DOM. Parent author redispatch/reinitialization
  does not rewrite samples, and redispatching a sample does not generate nested lists.

Experimental's `input-delivery/pointer-samples.mjs` checked native mouse movement,
raw updates, down/up, closed-shadow listeners, and redispatch on Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2. All produced nonempty coalesced lists
for movement; Chromium/Firefox also delivered raw updates. Chromium produced a
prediction in the observed sequence; prediction is optional, and this probe does
not establish support or absence for other devices/platforms.
Blink's [`PointerEvent::DispatchEvent`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/events/pointer_event.cc),
Gecko's [`GetCoalescedEvents`](https://searchfox.org/mozilla-central/source/dom/events/PointerEvent.cpp),
and WebKit's [`receivedTarget`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/PointerEvent.cpp)
explain the observed target differences.

The initial three regressions failed: native move/raw lists were empty and sample
targets stayed null across retargeting. The 26 sample tests now pass; together with
motion and constructor tests, 50 pass on all six supported runtime configurations,
without expected failures or skips. The broader DOM-event/interaction/Window dispatch
run passes 490 tests with the one existing, approved Stylelet shadow-scope expected
failure. No new expected failures were added. Typecheck, type contracts, scoped lint,
import boundaries, and diff checks pass.

Native batching and optional prediction algorithms are deliberately unspecified
by §9, but the future input producer still must supply real samples, map their
timestamps to the parent realm, preserve raw/move sample correspondence, and flush
earlier movement before later down/up delivery. These dependencies are explicit
beside `prepareTarget()`; this slice does not claim a device scheduling pipeline.

## Pointer Events §§13–16: closing audit

Reviewed the remaining local draft at the revision above:

| Section | Result |
| --- | --- |
| §13 Examples | Informative uses of existing constructors, listeners, pointer types, sample lists, and device IDs. No additional event algorithm. |
| §14 Security and privacy | Sensor-disclosure choices belong to future device acquisition. Prediction must not draw on extra sensitive data such as cross-site input history; the existing producer TODO and sample-input contract now say so. |
| §15 Glossary | Confirms active source versus nonzero buttons, per-pointer active Document, measurable input fields, and layout-owned topmost targeting. Touchpad wheel input is not itself direct-manipulation input. No additional implementation class. |
| §16 Legacy event initializers | The separate MouseEvent partial already supplies initMouseEvent with every declared default/type. Existing tests cover all arguments, conversion before the dispatch guard, inherited reset behavior, retained unaddressed fields, and receiver/realm identity. |

The closing appendices contain acknowledgments, revision history, and generated
IDL; they introduce no further runtime steps. No new browser policy was selected.

§3.1's device identity requirement remains a producer obligation:
persistentDeviceId is zero when the generating device is not identified. An
identified device needs a page/session association and a newly randomized ID for
a new session, rather than its hardware identifier. The current aggregate mouse
source supplies no hardware identity and keeps zero. Author constructor inputs
are untrusted data and are not randomized or interpreted as device registration.
The source field and producer/sample contracts name these future obligations.
No prediction algorithm or hardware identity store is introduced by this audit.

### Earlier local hookup found during the audit

The existing pointer removal operation had no DOM caller. Two new regressions
through the queued mouse producer failed: after removing a target's subtree,
with or without immediate reinsertion, previousTarget still referred to the
disconnected child instead of the surviving dispatch ancestor. Reinsertion made
the next dispatch's connectivity check miss the removal altogether.

TopLevelTraversable's existing post-unlink stream scan now calls
clearDisconnectedTarget() alongside pending-capture release. Its helper is
renamed notifyPointerTargetRemoval(); no extra traversal, registry, or author
callback is added. The next input sends the required pointerover using the
repaired ancestor. The third regression confirms that state-preserving moves
do not trigger this repair. This retains the already approved boundary policy.

Validation: 66 movement/boundary/capture tests pass on custom Node, Node 24.19.0,
and Node 26.8.1, each with the addon disabled and enabled. The broader custom-addon
run passes 171 tests including sample lists, legacy MouseEvent initialization,
PointerEvent construction, legacy mouse processing, and wheel delivery. No expected
failures or skips were added. Typecheck, focused lint, import checks, and diff
checks pass.

### Document lifetime integration

The existing [HTML destroy operation](https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document)
already performs single-active-Document cleanup from its event-loop task.
Browlet now connects retained pointer cleanup there, alongside the existing
legacy mouse and wheel cleanup. This is implementation lifetime work, not an
additional Pointer Events firing algorithm or an implementation of unloading.

Destroying a Document does not disconnect its retained DOM tree. The regression
therefore cannot rely on isConnected: before the repair, old capture redirected
later queued mouse movement into the destroyed Document, completed activation
still fired there, and adopting an old pressed element afterward revived its
click pair.

TopLevelTraversable scans its existing stream map and delegates selective cleanup
to PointerEventStream and PointerCapture. It clears the destroyed Document's
active selection, pending/effective capture, boundary path, input view and button
history without dispatching author events. Stream identity, device capabilities,
physical button state and surviving Documents' targets/pairs remain intact.
DOM's captured path is retained as nodes only; unused related-target and Window
metadata cannot keep another Document alive. Document task removal remains the
existing event-loop operation, including queued mouse input.

This closes the identified local pointer/wheel lifecycle hooks. It does not
implement HTML §7.5.9 unloading, §7.5.10 recursive/inactive destruction or bfcache
policy. Those existing throwing dependencies remain with their HTML owner, and
their eventual destruction paths must retain this per-Document cleanup.

Validation: all five new regressions first failed against the previous code.
The focused 59-test destruction/boundary/capture run passes on custom Node,
Node 24.19.0 and Node 26.8.1, each stock and addon. The broader custom-addon
run passes 147 tests, including queued mouse input and top-level destruction.
No skips or expected failures were added. Typecheck and focused lint pass.

## Status and remaining work

The document-order reading and algorithm audit has reached the end of the draft.
It does not make every producer and owner integration complete. This status also
includes the [event foundation](../events/ROADMAP.md), [mouse](../mouse/ROADMAP.md),
and [wheel](../wheel/ROADMAP.md) sections now recorded in their owning roadmaps.

- **HTML lifecycle owner:** the existing single-Document destruction path now
  clears retained input state. Recursive/inactive destruction and unloading
  remain explicit HTML §§7.5.9–7.5.10 dependencies, not new input algorithms.
- **Other-device producers:** source registration/retirement, context-local IDs,
  session device identity, sensor acquisition, batching, and optional prediction.
- **Other specification or host owners:** Pointer Lock, layout hit testing and
  coordinates, scrolling/zooming, HTML activation/focus/editing/drag behavior,
  native menus, device adapters, and WebDriver Actions. Reached operations retain
  their named throwing dependencies; optional future producers are not simulated.


§3.1.5's orientation conversion is already covered by PointerEvent construction.
§3.2's initialization/creation algorithms are implemented, and §§3.3.1–3.3.11's
ordinary event types are audited to the explicit producer boundaries above.
§3.3.12's activation attributes and target selection are implemented with the
explicit producer and HTML caller dependencies above. §4's capture bindings now
use the existing stream operations and top-level context map. §5's handler
contribution is connected, including secure-context raw-update exposure and
content attributes. §6's Navigator getter and IDL are connected up to the explicit
device-capacity and BiDi dependencies above. §7 now has its CSS property,
permission snapshot, and takeover guard, up to the explicit layout, Stylelet, and
input-owner dependencies above. §8's capture audit and DOM removal hookup are
complete up to the owner dependencies above. §9's trusted sample preparation and
target maintenance are implemented up to the producer dependencies above. §10's
shared position, hover/non-hover mapping, and suppression are connected to the
internal stream. §11's audit has reached the end of §11.4, with mouse-button, qualifying
click/double-click, unlocked movement, and mouse context-menu production
implemented up to the dependencies above. §12 now supplies WheelEvent and queued
wheel transactions, cancellation, and lifecycle cleanup up to its explicit owner
dependencies. The closing audit above completes the reading pass and connects
per-pointer previous-boundary-target removal notifications. Individual Document
cleanup is connected at the existing destroy hook; other-device
registration/retirement remains explicit integration work. Those producers must
consume active source state and expose reached targeting/input dependencies in code;
the MouseEvent geometry dependencies remain explicit. Editing and selection producers
remain with their HTML/Input Events/Selection API owners. Complete HTML §6.6
before claiming focus-event production, including the
[main/legacy focus-order conflict](../events/ROADMAP.md#source-questions-to-resolve-when-reached).

As each producer is implemented, any reached dependency must be a named callable
operation in code with its owning specification reference and an explicit
unfinished path. This inventory alone does not satisfy a dependency reached by
runtime code. Do not invent an unconnected set of stubs for the whole draft now.
