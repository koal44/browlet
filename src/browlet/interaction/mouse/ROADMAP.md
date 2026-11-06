# Mouse input roadmap

[input.ts](input.ts) owns UserAgent mouse receipt and queued delivery.
[legacy/processor.ts](legacy/processor.ts) owns each Document's compatibility mouse
state and delivery. Its separate [entry point](legacy/index.ts) remains below DOM
nodes; Document does not load the higher mouse coordinator. Event classes and
creation live in the shared [event foundation](../events/ROADMAP.md).

## Pointer Events §10.1: effective legacy mouse position

[§10.1](https://w3c.github.io/pointerevents/#tracking-the-effective-position-of-the-legacy-mouse-pointer)
now has a lazy `Document.legacyMouse` owner in `interaction/mouse/`.
Its `updatePosition(event, target)` shares one position across all primary pointer
types. The selected target is explicit because this precedes DOM dispatch's
assignment to `event.target`; null means leaving the window. Unchanged targets
return before allocating ancestor lists or events. Transitions send mouseout,
inner-to-outer mouseleave, mouseover, then outer-to-inner mouseenter, excluding
shared ancestors. Cancellation never suppresses the remaining transition.

`MouseEventImpl.fromPointerEvent()` creates a fresh trusted MouseEvent in each
target's realm. It copies the input timestamp, coordinates, buttons and modifiers,
applies MouseEvent coordinate rounding, resets button/detail/movement, and selects
§11's boundary flags. DOM retains all dispatch and shadow-retargeting ownership.

Eric approved Document ownership and the following browser choices:

- `SPEC_CLASH(mouse-boundary-document-entry)`: notify only Element ancestors,
  following §11/Firefox/WebKit; Chromium additionally enters Document.
- `SPEC_CLASH(mouse-boundary-ancestor-snapshot)`: snapshot both ancestor chains
  before notifications, like Firefox/WebKit; Chromium recomputes the destination
  chain after mouseout when a listener reparents it.
- `SPEC_CLASH(mouse-boundary-removed-related-target)`: after removal, retain the
  surviving ancestor as relatedTarget on the next over event, like Chromium/Firefox;
  WebKit uses null. The same distinction holds after reinsertion.
- `SPEC_CLASH(mouse-boundary-related-target)`: use the opposite target, extending
  the approved pointer-boundary choice and matching all three browsers. §11's
  mouseenter/mouseleave table descriptions reverse entering and exiting.

DOM removal notifies only existing mouse state, once immediately after unlinking.
The old parent supplies the ancestor at removal time; no old dispatch path or
reverse registry is retained. State-preserving moves leave the position intact,
and destruction clears it. The selected target is retained before boundary
callbacks so this hook also records removal/reinsertion inside those callbacks;
local snapshots determine the transition already in progress.

Experimental's `input-delivery/legacy-mouse-boundaries.mjs` checked native mouse
movement, initial entry, closed shadow roots, reparenting during mouseout, and
removal/reinsertion in Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
The ordinary order, flags, zero boundary button/detail/movement, and shadow
retargeting agree. Chromium/Firefox deliver the removal recovery during their
stationary refresh; WebKit waits for the next movement in this probe. Blink's
[`MouseEventManager`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/input/mouse_event_manager.cc)
likewise retains one position, updates it before callbacks, and receives subtree
removal notifications separately from pointer capture.

The focused regression covers independent Documents, multiple primary pointer
types, nonprimary exclusion, unchanged-target allocation avoidance, related targets,
flags and realm identity, cancellation, ancestor snapshots, slots/shadow hosts,
removal-time ancestry, reinsertion, state-preserving moves, synthetic dispatch,
and destruction. The §§10.2–10.3 slice below connects this operation before
primary down/up/move/window-leave delivery even when PREVENT MOUSE EVENT is set.
This earlier slice supplied the shared position without a native producer,
mouse suppression flag, or ordinary compatibility down/move/up dispatch.

Validation: all 25 new regressions and the 9 Document-destruction tests pass on
custom Node 27, Node 24.19.0, and Node 26.8.1, each with and without the addon.
The broader interaction/DOM mutation, shadow, range, traversal and destruction
run passes 666 tests with the one existing Stylelet shadow-scope expected failure.
No new expected failures were added. Typecheck, type contracts, scoped lint,
import boundaries and diff checks pass. Browser temporary profiles were removed;
the reproducible probe remains in Experimental.

## Pointer Events §§10.2–10.3: compatibility mouse mapping

The [hover](https://w3c.github.io/pointerevents/#mapping-for-devices-that-support-hover)
and [non-hover](https://w3c.github.io/pointerevents/#mapping-for-devices-that-do-not-support-hover)
algorithms now surround ordinary dispatch in `PointerEventStream`. The existing
Document-owned `LegacyMouseProcessor` updates boundaries before primary down/move/up,
then maps down/move/up/cancel after pointer listeners. Cancellation sends mouseup
to Window before capture loss and boundary exit. Nonprimary input produces no
compatibility events. Raw updates produce no ordinary mapped mouse motion.

The callable arrangement splits preparation and completion around the existing
pointer dispatch, rather than dispatching the pointer again inside the mapper.
Eric approved the required `supportsHover` constructor input and
`mouseClickCount` delivery argument. Hover capability is independent of direct
manipulation and pointerType; click counting is independent of PointerEvent's
required zero detail. The optional sample-list argument remains last.

`LegacyMouseProcessor` owns a per-pointer-type PREVENT MOUSE EVENT set. A canceled
primary down suppresses mapped down/move/up until up/cancel; a hover move with
zero buttons also clears a stale flag after a release outside the context.
Passive listeners cannot set it, and canceling later pointer events does not set
it. Mouse boundaries and click/auxclick/contextmenu remain independent.
Mouse cancellation is separate from the pointer dispatch's return value.

The selected target is retained before pointer boundary listeners run, alongside
the effective mouse position. DOM's existing post-unlink notification repairs
both using ancestry at removal time. A regression first failed when pointerover
removed the destination before pointerdown: mousedown reached the detached child
instead of its parent. Retaining the pending target fixes that gap and preserves
the approved remove/reinsert behavior without another registry or DOM hook.

Eric approved these browser/specification choices:

- `compatibility-mouse-touch-timing`: use §10.3's immediate interleaving, including
  the initial mousemove before a non-hover pointerover. Chromium/Firefox defer
  touch mouse events until release; WebKit supplied none in the probe. §10 permits
  such gesture grouping, but this implementation does not add buffering.
- `compatibility-mouse-chords`: a pointermove that represents a button transition
  produces mousedown/mouseup. All three browsers and §11 preserve those mouse
  transitions; §10's literal list maps every pointermove to mousemove.
- `compatibility-mouse-removed-target`: mapped events use the repaired ancestor
  even after reinsertion, like Chromium/Firefox. WebKit drops the removed-target
  mousedown or uses the reinserted target in the probed cases.

The browser-only `compatibility-mouse.mjs` probe remains in Experimental's
`input-delivery/`. Ordinary mapping, canceled/passive down, later cancellation,
chords, removal, and touch input were checked in Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. Cancellation via native touch was additionally
probed with Chromium CDP; its delayed policy produced no mapped mouseup.
The required Window mouseup here follows the chosen immediate algorithm.

Remaining dependencies are explicit beside their operations: native device
scheduling and source-to-stream composition; layout/hit testing; UI Events
click-count and movement inputs; HTML focus/editing/drag default actions; and
avoiding duplicate compatibility delivery when a Touch Events producer is added.
`updateAfterLayout()` also refreshes mouse boundaries without inventing a move.
Author dispatch never enters the compatibility mapper.

Validation: all 25 new mapping regressions, 25 legacy-position regressions, and
11 top-level destruction tests pass on custom Node 27, Node 24.19.0, and Node
26.8.1, each with and without the addon. The broader custom/compat interaction,
DOM event, structural-mutation, and destruction run passes 568 tests with the
one previously approved Stylelet shadow-scope expected failure. No new expected
failures were added. Typecheck, type contracts, scoped lint, and import-boundary
checks pass. Browser temporary profiles were removed; the probe remains in
Experimental.

## Pointer Events §§11.2.10–11.2.13: mouse-button input

`UserAgent.mouseInput` lazily owns one `MouseInputProcessor`. Its `queueButton()`
entry receives normalized logical buttons, CSS-pixel coordinates, a modifier
snapshot, and explicit click count. `PointerButton` already represents §11.2.10's
logical button values; OS-specific codes remain the adapter's responsibility.
The existing mouse mapper applies §11.2.11's changed-button field. There is no
second pointer/mouse dispatch path, and chorded transitions retain the previously
approved §3/§10 behavior rather than the draft's unconditional "maybe pointerdown/up".

Eric approved UserAgent ownership, shared mouse button state, reserving ID 1 in
each top-level context's existing stream map, and user-interaction task delivery.
`queueButton()` is explicitly Browlet integration: ownership/lifetime checks,
snapshots, duplicate filtering, task queueing, and stream registration. Its private
`handleButton()` contains the adapted delivery portion of the native down/up
algorithms. Eric reviewed and accepted this separation and combined callable shape.
The button-state update runs at receipt, while delivery reuses §§3/10's pointer
pipeline. Inline comments distinguish these choices and realm-allocation machinery
from the steps supplied by Pointer Events and HTML. Actions
copy their data and held-button result at receipt, so different Window loops
cannot make a queued press observe a later release. The first delivery registers
the stream before author capture requests. Top-level teardown still clears that
map; a queued action cannot recreate it after the destination leaves browser
ownership. No reverse source/stream registry is added.

The processor lives directly in `interaction/`, above DOM nodes and navigation.
The lower `interaction/mouse/` remains the Document-owned legacy position/mapping
foundation. Target preparation uses a private input snapshot; the actual pointer
event is allocated through the target's environment, retaining its creation realm
and timestamp separately from its current Document view. The existing mapper
allocates the mouse event and supplies its actual cancellation result to the
focusing continuation. Canceling pointerdown suppresses the mouse event; canceling
mousedown suppresses focus without undoing the physical button state.

Reached dependencies are callable throwing methods, with owner references:

- `hitTest`: §11.2.5/CSSOM View geometry, inert/disabled targeting, and the later
  Pointer Lock/cross-document coordinate integration. There is no body fallback.
- `hasLockedElement`: Pointer Lock's state used by capture requests.
- `notifyUserActivation`: HTML §6.4 before activation-triggering press listeners.
- `focusOnMouseDown`: HTML §6.6 click focusability and focusing after an uncanceled
  mapped mousedown, using that event's actual target.
- `maybeShowContextMenu` was the §11.2.18 continuation at this boundary; the later
  context-menu slice below implements its mouse dispatch/cancellation. Only its
  `showContextMenu` native UI effect remains throwing.

`mouse-input.test.ts` feeds actions into this owner through real Window bindings
and task turns. It controls only those missing owner dependencies. Coverage includes
all five mouse buttons, chords, suppression and mouse cancellation, author capture,
queued input snapshots across Windows, adopted-target realm/view ownership,
synthetic-event isolation, removed destinations, and explicit missing dependencies.
All 17 new tests and the 159-test mouse/stream/capture/activation selection pass on
Node 24.19.0, Node 26.8.1, and custom Node 27, each with and without the addon.
These runs have no expected failures or skips. Typecheck, type contracts, scoped
lint, import boundaries, and diff checks pass; no addon or engine changes are used.
This is an internal mouse-button producer; native adapters, WebDriver Actions,
motion/sample collection, click recognition, and real default actions remain unfinished.

## Pointer Events §§11.2.14–11.2.15: native clicks

`MouseButtonInput.click` is a required adapter decision: false on presses, true
only for releases that qualify as clicks. Eric approved this contract. The
processor snapshots it with the input, then dispatches primary `click` or
non-primary `auxclick` after mouseup in the same user-interaction task. It does
not infer a click from cancellation, movement thresholds, or the click count.
§3.3.12's retained press/release/capture target overrides §11.2.14's ordinary
hit-test target; the existing activation factory supplies coordinates, pointer
identity/defaults, trust, and target-realm allocation. Capture release and hover
restoration do not replace the retained interaction target.

DOM dispatch already calls the target's activation behavior after an uncanceled
click. The producer adds no duplicate default-action continuation. Concrete HTML
element actions remain HTML §6.5 work. §11.2.15's null-native callers now have
[HTML §8.1.8.3's Element firing operations](../events/ROADMAP.md#html-8183-synthetic-pointer-and-click-firing),
which use current keyboard modifiers without fabricating mouse input.
HTMLElement.click() and keyboard activation remain explicit caller dependencies:
disabled-control/reentry policy, key eligibility, and concrete element actions
belong to HTML §6.5. The mouse producer continues to use measured pointer input.

`SPEC_CLASH(pointer-activation-chord-pairing)` records the approved extension of
§3.3.12's pointerdown/up-only description: a chorded release produces pointermove,
but can still cause a click. Each held button retains its own press target and
the release consumes that pair, as §11.3's mouse sequence and Firefox require.
Cancellation clears all held pairs; raw updates do not consume them. A focused
regression first failed with zero clicks for a chorded primary release.

Experimental's `input-delivery/native-click.mjs` ran on Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. All three deliver a primary click while another
button remains held, and keep clicks despite canceled pointerdown. In the
A-primary/B-middle chord, Firefox targets the primary click at their common
ancestor and the middle auxclick at B. Chromium/WebKit target the primary click
at B and do not recognize the final middle release as a click. Gesture recognition
stays with the adapter; Browlet follows the approved per-button targeting rule
for each release the adapter qualifies. Previously approved pointer-field and
capture-order differences continue to apply.

Enabled regressions exercise all five mouse buttons, same-task ordering, input
snapshots, cancellation/default-action dispatch, chord pairing, capture, listener
reinitialization, and adopted-target realm/view ownership. No native engine or
addon changes are needed.

All 277 focused mouse/stream/capture/activation tests pass on custom Node 27,
Node 24.19.0, and Node 26.8.1, each with and without the addon, with no expected
failures or skips. Typecheck, type contracts, scoped lint, and import checks pass.

## Pointer Events §11.2.16: native double-clicks

The approved `MouseButtonInput.doubleClick` flag accompanies an adapter-qualified
click release. The processor supplies it to the existing stream activation
operation, which sends a primary-button `dblclick` immediately after click in the
same task, independently of either pointer/mouse or click cancellation. A count
of two alone does not invent another event, and non-primary buttons cannot send
double-clicks. Synthetic DOM dispatch remains outside this input pipeline.

`MouseEventImpl.createDoubleClick(target, source, clickCount)` extracts creation
from `handle native mouse double click(native)`; the stream retains targeting and
dispatch, while the adapter owns gesture recognition. Eric reviewed and accepted
this callable split. Construction uses private input, a new timestamp,
the selected target's realm, zeroed movement, and existing coordinate/modifier
initialization. Author reinitialization of the preceding click cannot change it.

Eric approved three recorded conflicts:

- `native-double-click-interface`: §11.4 and all three browsers use MouseEvent;
  §11.2.16 instead calls for PointerEvent. Follow the event definition/browsers.
- `native-double-click-target`: retain the preceding click's selected target,
  like all three browsers, including capture and common-ancestor targeting.
  §11.2.16's fresh hit test could change it after a click listener moves the target.
- `native-double-click-removal`: suppress while the target is disconnected,
  following §11.3/Firefox. Chromium/WebKit dispatch to the detached target. All
  three allow dispatch after immediate reinsertion, which Browlet also does.

Experimental's `input-delivery/native-double-click.mjs` ran on Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2. It covers primary/auxiliary input,
pointerdown/click cancellation, layout mutation, removal/reinsertion, capture,
different down/up targets, and four successive clicks. All three emit dblclick
only at count two in that sequence, but recognition remains explicit adapter input.
Enabled regressions cover delivery order, event attributes/realm, snapshots,
targeting, cancellation, and separation from author dispatch. DOM's click
activation hook does not run twice. Selection default actions remain the explicit
§11.4/HTML editing/Selection API dependency in the dispatch code; this slice
implements event delivery without claiming text selection or native input acquisition.

The 296 focused mouse/stream/capture/activation cases pass across custom Node 27,
Node 24.19.0, and Node 26.8.1, with and without the addon. No expected failures or
skips were added. Typecheck, type contracts, scoped lint, and import checks pass.

## Pointer Events §11.2.17: native movement

`MouseInputProcessor.queueMove(input, document)` receives normalized CSS-pixel
coordinates and modifiers, snapshots the UserAgent's held buttons and shared
clock, and schedules one HTML user-interaction task. `MouseInput` holds the
shared position/modifier fields; `MouseButtonInput` adds button/click recognition.
Receipt validation, task entry and lazy stream registration remain visibly
Browlet integration, separate from the private adapted delivery algorithm.
Eric reviewed and accepted this callable split: the draft's implicit native
input becomes an explicit input snapshot, saved buttons/time, stream and Document.

Delivery reuses §§3.1.3/10's capture-aware targeting, boundary notifications and
compatibility mapping. Secure input emits pointerrawupdate before pointermove;
the latter produces mousemove unless a canceled down suppresses it. Raw updates
have no separate mouse counterpart. Each event prepares its target after pending
capture notifications, so a raw listener can change the following move's capture
or hit-test result. Motion uses button=-1, detail=0 and the received held-button
state. There is no batching: queued movement precedes subsequent button input.

Eric approved two existing-contract extensions:

- Window's movement helper accepts the private pointermove snapshot as well as
  mousemove, once per received position. It uses MouseEvent-rounded screen
  coordinates and shares the delta across raw, pointer and mapped mouse events.
  Canceled compatibility delivery still advances history; author dispatch does not.
- `eventTimeStamp(time?)` optionally translates a shared-clock reading using the
  event's creation realm and precision. Raw and move retain one reading even if a
  listener changes their target realms. View follows the target's current Document.
  Button actions use the same receipt-time facility, including their chorded pairs.

The new chord regression first observed two pointermoves with no preceding raw
updates. §3.3.5 requires raw delivery for these button changes too. The button
producer now supplies it through the same event-allocation and stream machinery.
Experimental's `input-delivery/native-mouse-move.mjs` confirms that ordering and
matching raw/pointer/mouse timestamps/deltas in Chromium 156.0.8078.4 and Firefox
157.0. WebKit 27.2 emitted no raw updates and again supplied zero screen positions
and movement in Windows automation, so it supplies no nonzero-axis evidence.
Blink's `PointerEventManager::SendMousePointerEvent` also explicitly synthesizes
raw updates for chorded button moves. Eric approved `pointer-chord-samples`:
retain §9.1/Firefox's nonempty coalesced list, including chords; Chromium/WebKit
instead expose empty lists for the chorded pointermoves in this probe.

Locked targeting and native relative/unadjusted motion remain a named throwing
Pointer Lock path. Layout hit testing, input eligibility and cross-document
coordinate translation retain their existing explicit dependency. The adapter
must report input interruptions/exit by clearing Window's last position; GUI/OS
acquisition is still absent. Selection extension and drag initiation remain with
Selection API/HTML §6.11. This slice implements event production without claiming
those default actions, prediction, or display-aligned coalescing.

Enabled tests cover task entry, snapshot retention, secure gating, raw/move/mouse
ordering, chorded input, capture changes, boundary order, cancellation, timestamps,
adopted-target realm ownership, synthetic dispatch, lifetime and unavailable owners.
All 325 focused mouse/stream/capture/activation tests pass on custom Node 27,
Node 24.19.0 and Node 26.8.1, with and without the addon. No expected failures or
skips were added. Typecheck, type contracts, scoped lint and import checks pass.
The stock-runtime fixture must leave navigation's host turn before manually
advancing its event loop; otherwise its await can resume within that same task's
checkpoint. This is test scheduling, not a runtime delay or production repair.

## Pointer Events §11.2.18: mouse context menus

`MouseButtonInput.contextMenu` is a required adapter decision, independently of
button identity and click recognition. Eric approved both press and release
timing. The queued action retains this flag alongside coordinates, modifiers,
held buttons, and click qualification. After pointer/mouse delivery and any
mousedown focus continuation, the processor dispatches the requested contextmenu
before a qualifying click/auxclick in the same task. Neither pointerdown nor
mousedown cancellation cancels the menu request.

`maybeShowContextMenu(input, target)` uses the existing activation-event factory,
the private normalized pointer snapshot, and the triggering pointer target. The
snapshot replaces the native OS event in the specification's callable shape,
which Eric reviewed and accepted. It preserves pointer ID/type and
mouse input, uses default pointer fields and detail zero, and allocates at the
target's creation realm with its current Document view. Author reinitialization
of the pointer event or contextmenu cannot alter the retained native input.

If DOM dispatch succeeds, `showContextMenu(target, screenX, screenY)` requests
the native menu at the adapter's original CSS-pixel screen position. This is a
named throwing GUI dependency for display, placement, and modal input handling;
it does not silently succeed. Cancellation prevents reaching it. Keyboard/null-
native invocation remains the keyboard/HTML §6.6 caller's dependency: current
focus, modifier input, and keyboard menu placement are not supplied by this
mouse processor. Its required snapshot makes that unavailable input explicit.

`node-compat/experimental/input-delivery/native-context-menu.mjs` probes Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved:

- `native-context-menu-target`: retain §3.3.12's triggering pointer target instead
  of repeating hit testing. Firefox/WebKit retargeted after mousedown moved the
  target; Chromium's release path retargeted after mouseup removed it.
- `native-context-menu-removal`: §11.3 suppresses further delivery while that
  target is disconnected. Browsers instead targeted the newly exposed element.
  Immediate reinsertion allows delivery in Browlet and all three browsers.
- `native-context-menu-detail`: use §11.4/Chromium/WebKit's zero. Firefox supplied
  one in this probe. Previously approved pointer-default choices still apply.
- `native-context-menu-order`: contextmenu precedes auxclick as §11.4 states.
  Chromium's release-timed menu followed auxclick; Firefox/WebKit's press-timed
  menus preceded it. The adapter still chooses press versus release.

All three delivered contextmenu after pointerdown/mousedown cancellation. Captured
button transitions retained the capture target; chords retained held-button input.
These observations do not demonstrate native UI because the probe cancels menus.
The enabled Browlet regressions use real queues, bindings, capture, and listeners,
controlling only the unfinished layout, Pointer Lock, HTML focus/activation, and
native UI effects. Coverage includes timing, cancellation, chords, input mutation,
layout changes, removal/reinsertion, capture release, adopted-target realm/view
ownership, and synthetic dispatch isolation.

All 105 focused mouse-input/movement/activation tests, including 20 context-menu
cases, pass on custom Node 27, Node 24.19.0, and Node 26.8.1, each with and without
the addon. There are no expected failures or skips in this selection. The final
20-case rerun also verifies reinitialization after pointer dispatch has returned.
Typecheck, type contracts, scoped lint, import boundaries, and diff checks pass.
No addon or engine changes are involved.

## Pointer Events §§11.3–11.4: mouse order and event-type audit

The mouse-delivery pass is audited through §11.4. It does not complete the HTML,
layout, editing, or native UI owners listed below. No new event class or general
event-definition registry is needed for these sections.

| Requirement | Implementation and evidence |
| --- | --- |
| Nested/overlapping target order | `LegacyMouseProcessor.updatePosition()` sends out/leave before over/enter, leaves inside-out, enters outside-in, and excludes common ancestors. A new queued-input regression covers entry into three nested elements, return to an ancestor, and exit. All three browser probes agree on this ordinary sequence. |
| Stationary layout boundaries | `PointerEventStream.updateAfterLayout()` updates pointer and mouse boundaries without inventing a move. The new integration test verifies this after a producer-delivered position; layout still owns detecting/scheduling changes and hit testing. |
| Button/click sequence and counts | The producer sends down/up before adapter-qualified click/auxclick, then any recognized primary dblclick. `clickCount` is explicitly the gesture's UI Events detail, including the upcoming click count on down/up. Recognition, tolerances, count reset, and OS timing remain adapter inputs. |
| Removal during mouseup | Four new regressions first exposed click/auxclick on a detached target, with and without capture. `dispatchActivation()` now checks the selected target's connectivity before allocating or dispatching the activation. All three browsers suppress this detached case. Immediate reinsertion follows the approved Firefox choice below. |
| §11.4 interfaces and flags | click/auxclick/contextmenu use PointerEvent; dblclick and down/up/move/boundaries use MouseEvent. All bubble and are cancelable/composed except enter/leave, whose three flags are false. Existing factory and producer tests cover these defaults. Author construction/dispatch retains author-supplied flags. |
| Targets, related targets, and input | Hit testing is an explicit missing layout/input-eligibility operation, including normalization of text-run hits to Elements. Capture and activation targeting keep their approved rules. Boundary relatedTarget is the opposite target; mouse coordinates, button masks, modifiers, and realm/view ownership retain the earlier tested policies. |

`node-compat/experimental/input-delivery/native-mouse-audit.mjs` exercised
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved:

- `mouse-click-reinsertion`: allow click/auxclick when the removed release target
  is immediately reinserted, as Firefox does. Chromium/WebKit suppress it after
  reinsertion too. The connectivity check deliberately adds no removal registry.
- `mouse-default-activation`: retain DOM's click-only activation hook. §11.4's
  generic auxclick/dblclick default-action wording is broader; middle-click
  toggled a checkbox in WebKit but not Chromium/Firefox. Auxiliary link actions
  remain HTML §4.6/§6.5 work, not a reason to run every control's click behavior.
- `mouse-click-focus`: keep §11.2.12's focus after an uncanceled mousedown.
  §11.4 also lists focus as a click action, but all three browsers leave the
  checkbox unfocused after mousedown is canceled even though click toggles it.

The native probe listens directly on enter/leave targets. Its initial Window-only
capture listeners did not observe those events in Chromium/WebKit. No change to
Browlet's normal DOM propagation is inferred from that recording difference.

Default actions remain with their actual owners. `focusOnMouseDown()` and
`notifyUserActivation()` throw until HTML §§6.4/6.6 supplies eligibility and
focus/activation state. `showContextMenu()` is the explicit native menu effect.
DOM invokes the existing click activation contract; concrete link and form-control
actions remain HTML §§4.6/4.10/6.5 dependencies. Selection, editing, drag initiation,
and optional middle-button panning remain Selection API/HTML §§6.8/6.11 and native
input work, with TODOs at the consuming dispatch algorithms. This audit neither
implements those subsystems nor inserts a generic default-action dispatcher.

All 165 focused input, movement, context-menu, activation, compatibility-mouse,
and legacy-position tests pass on custom Node 27, Node 24.19.0, and Node 26.8.1,
each with and without the addon. This selection includes ten new audit/regression
cases and has no expected failures or skips. Typecheck, type contracts, scoped
lint, import boundaries, and diff checks pass. The only runtime change is the
activation target's connectivity guard; no addon or engine changes are needed.
