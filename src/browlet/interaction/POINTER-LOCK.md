# Pointer Lock 2.0

Local draft: `_web-platform/specs/pointerlock/index.html`, revision
`c2692a6b6016d67dd6b1e311e130f17a384826e8`, refreshed 2026-11-04.
[Editor's Draft](https://w3c.github.io/pointerlock/).

## Implemented: §§2–5

Section 1 is informative. UserAgent now lazily owns one PointerLock controller:
lock target/options/cursor position, the ordered requests queue, Element's request
API, Document's exit API and handlers, and DocumentOrShadowRoot's retargeted getter.

The existing ParallelQueue serializes acquisition. Element tasks deliver the
notification and settle the realm-owned promise afterward. Activity, focus,
sandboxing and the API-release exemption belong to the current node Document;
transient activation belongs to the element's relevant global, including after
adoption. Notifications retain the affected Document when queued. A weak set remembers which
Documents have successfully released a lock through the API.

Native acquisition is an explicit synchronous host operation run in the parallel
queue: return the saved screen and client coordinates on success or null on refusal. It must
finish before returning and cannot invoke author code. This is an integration
boundary, not an adapter implementation or a claim that every GUI toolkit has
this callable shape. An asynchronous adapter needs a reviewed completion contract;
the current queue must not silently accept a Promise result. No scheduler or
Node/V8 change was added.

Successful application calls the existing stream releasePointerCapture operation
for pending captures (§8.5 of Pointer Events). Effective loss remains deferred
until capture processing. Mouse/capture and wheel lock queries now read this owner.

## Implemented: §§6–7 locked input delivery

MouseEvent/MouseEventInit movement members were already declared and tested in
the UI Events pass. The new production connection is `queueRelativeMove()`:
the adapter supplies measured movement/modifiers, while PointerLock supplies the
frozen screen/client position. The existing task, pointer stream, sample-list and
compatibility-mouse pipeline delivers secure raw updates, pointermove and mousemove.
No screen-edge clamp or subtraction of frozen coordinates invents relative motion.

Button/click/double-click and wheel entries use the same acquisition snapshot
when routed to the lock's Document. Mouse boundaries are suppressed, while pointer
boundaries, capture processing, cancellation and dispatch retain their normal
owners. Click targeting preserves the locked release target across same-Document
retargeting instead of choosing the press/release common ancestor.

Acquisition, retargeting, option changes and exit identify native input generations.
Queued locked input from a superseded generation is discarded. A raw listener that
exits or changes lock prevents the remaining move from that packet. Exit clears
the Window's unlocked motion history so resumed absolute input begins with zero
movement. Synthetic author dispatch remains independent.

The approved host contract now returns a `MousePosition` (screenX/Y and clientX/Y)
from acquisition. It remains flat data, shared by input typings without additional
coordinate objects per event. Native cursor restoration still uses ScreenPosition.
Native routing across Documents, CSS-pixel normalization, acceleration/raw selection,
OS interruption notification, and wheel gesture boundaries remain adapter duties.

## Implemented: §8 disconnection and queued-request lifetime

The existing post-unlink Document input notification asks UserAgent to release
its already-allocated controller's disconnected target. Removing the element or
a containing shadow subtree clears lock synchronously, restores the cursor once,
and queues the ordinary change event. Immediate reinsertion does not undo that
release. Unrelated removals and DOM's state-preserving moveBefore retain lock.
No new subtree walk, reverse registry, or per-element state is introduced.

Queued requests recheck membership in their original Document, full activity and
focus before native acquisition or retargeting. Invalid requests reject with the
existing WrongDocumentError policy; a target reinserted into its original Document
before processing is allowed. A failed retarget leaves the existing lock intact.
Once acquired, a request remains successful even if removal precedes its queued
notification. The synchronous native acquisition contract cannot run author code;
there is no separate asynchronous native-completion window in this implementation.

Notification tasks retain the affected Document, so later adoption cannot redirect
an unlock or request error into another Document. They still use the element's
creation-global task queue and the approved event-before-promise-settlement order.
Automatic removal uses exitPointerLock(), not the public Document exit operation,
and therefore does not grant the API-release activation exemption.

## Closing audit: §§9–12

The 2026-11-04 pass covers the complete draft, including its remaining sections:

| Section | Audit result |
| --- | --- |
| §9 Use Cases | Informative examples; no additional runtime algorithm or API. Synthetic cursors, panning and game controls are applications of relative input, not new browser operations. |
| §10 Security | Informative guidance. The default escape and actual focus-loss requirements already belong to §8. Native UI must explain escape; origin restrictions, prompts and repeated-lock policy remain host choices, not a new Permissions API integration. |
| §11 FAQs | Informative rationale. Wheel routing, movement fields and independent keyboard focus are covered by the existing pipeline or named dependencies. Proposed hybrid capture and future input capabilities do not define new algorithms. |
| §12 Conformance | Identifies the user agent as the conforming product; no additional runtime algorithm. |

The closing pass adds no event, Web IDL member, scheduling path or default policy.
It also checks that §§2–8's unfinished requirements remain attached to their
actual owners below. In particular, reading Document focus is HTML work; native
lock acquisition cannot make that state available by itself.

## Explicit dependencies

- **HTML §6.6 focus:** `Document.hasFocus()` is the throwing dependency for
  HTML's has-focus steps: top-level system focus and the focused-area chain through
  child navigables. The query belongs to Document, not the PointerLock controller.
  Visibility/full activity cannot replace it; public hasFocus exposure is deferred.
- **HTML §6.4 activation:** the existing `Window.hasTransientActivation()`
  throws pending duration/expiry and input notification.
- **Native input:** `acquire()`, `supportsUnadjustedMovement()`, and
  `restoreCursor()` throw. The adapter owns cursor visibility/restoration,
  raw motion, acquisition refusal, OS routing and §2.3 assistive-technology
  notification. It must prevent mouse-driven native focus changes while locked
  (§2.1); §10's escape instructions and optional prompt/relock policies belong to
  the eventual native UI, not author-dispatched events.
- **§6 input interruption:** the future native adapter must supply zero relative
  motion after an OS notification gap and clear Window.lastMouseMove before
  resumed unlocked input, as marked on its movement helper. Pointer Lock exit
  already clears that history. Absolute queueMove input while locked throws;
  the adapter must use queueRelativeMove rather than inventing relative deltas.
- **HTML drag/drop:** no native producer exists yet. Its future mouse default-action
  caller must honor the explicit lockedTarget dependency and suppress drag/drop
  during lock; emitting movement does not implement dragging.
- **§8 native unlock signals:** the future native adapter must guarantee an
  always-available default unlock gesture and call exitPointerLock() for actual
  browser/window/tab focus loss. acquire() and the exit algorithm name this
  contract in source. Author-dispatched key/blur events are not native signals.
  HTML §6.6 element/frame focus changes must retain lock; fullscreen entry/exit
  alone also retains it, except when native UI, a shared unlock gesture or real
  top-level focus loss requires release. No keyboard/focus/fullscreen producer
  exists yet; these signals cannot be synthesized from DOM events.
- **HTML unloading/destruction:** its lifecycle owner must release the existing
  lock before detaching the Document. Destroying a Document does not run DOM
  removal, so this remains an explicit connection for Ged. Pending acquisition
  rechecks do not substitute for teardown of an already-acquired lock.

The local §8 disconnection path and the full draft audit are complete. The
remaining host/lifecycle connections above prevent claiming complete native
Pointer Lock. None requires expanding this pass before beginning the Selection
API; keep those owner dependencies explicit as their implementations proceed.

A real native lock cannot yet be acquired. Tests control the narrow unfinished
effects while using real bindings, realms, queues, DOM dispatch and capture state.
They do not establish native input or completed focus/lifecycle behavior.
No expected failures are introduced.

## Approved conflicts

- SPEC_GAP(pointer-lock-pending-lifetime): §3 does not revalidate a request after
  queuing it. Browlet rechecks original-Document membership, activity and focus.
- SPEC_CLASH(pointer-lock-pending-result): Firefox's queued request rejects on
  removal/adoption and accepts same-Document reinsertion. Browlet follows that
  lifetime rule, keeping its existing WrongDocumentError rather than Firefox's
  InvalidStateError. Chromium fulfills these removed requests but holds no lock,
  including immediate reinsertion. WebKit cannot acquire a lock in this probe.
- SPEC_CLASH(pointer-lock-notification-document): retain the affected Document,
  matching Chromium/Firefox adoption results. A late reading of the draft's
  element node-document expression would notify its new Document instead.
- SPEC_CLASH(pointer-lock-state-preserving-move): retain lock for DOM moveBefore,
  which runs moving steps instead of removal steps. Chromium/Firefox release
  lock in the probe, even after acquisition notification. Eric approved preserving
  Browlet's existing state-preserving move contract.

Evidence: Experimental's input-delivery/pointer-lock-lifetime.mjs, run with
Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2 on 2026-11-04. Chromium/Firefox
both release synchronously on removal/reinsertion and on shadow-host removal,
and notify the old Document after adoption. WebKit rejects initial acquisition
with WrongDocumentError in Windows headless mode; no successful-lock inference
is made from those cases. Gecko's dom/base/PointerLockManager.cpp also explicitly
rechecks the queued request's captured Document. The draft references are
[§8 requirements](https://w3c.github.io/pointerlock/#requirements),
[requestPointerLock](https://w3c.github.io/pointerlock/#requestPointerLock), and
[DOM move](https://dom.spec.whatwg.org/#move).

- `SPEC_CLASH(pointer-lock-mouse-boundaries)`: suppress mouse boundaries per
  §2.1 and Firefox; Chromium emits them on entry/retargeting. Both browsers
  retain pointer boundaries, which Pointer Lock does not prohibit. The new
  `pointer-lock-input.mjs` probe records this separately from API behavior.

Browser-only evidence is in Experimental's `input-delivery/pointer-lock.mjs`
and README (2026-11-04, Windows headless Playwright).

- `SPEC_CLASH(pointer-lock-event-flags)`: false bubbles/cancelable/composed,
  following the draft/DOM and Chromium. Firefox/WebKit bubble notifications.
- `SPEC_CLASH(pointer-lock-promise-order)`: notification before settlement in
  its queued task, following the draft. All three probes settled before notifying.
- `SPEC_CLASH(pointer-lock-document-checks)`: detached/inactive targets reject
  with WrongDocumentError (Chromium/WebKit). The draft's focus precondition is
  unclear about disconnection; Firefox uses InvalidStateError.
- `SPEC_CLASH(pointer-lock-conflicting-document)`: retain the draft's
  InvalidStateError for a competing Document. Blink's
  `core/page/pointer_lock_controller.cc` uses WrongDocumentError. Terminal
  branches return after scheduling their result rather than falling through.

Chromium 156.0.8078.4 and Firefox 157.0 acquired ordinary and closed-shadow locks;
Document exposed the host and the closed root exposed its inner target. WebKit
27.2 rejected these requests with WrongDocumentError in this environment, so the
probe does not establish its successful native-lock behavior. All raw-motion
requests failed here; this does not establish support on other native platforms.

## Adjacent references

Prepared local official checkouts for later, with no implementation in this slice:

- [Selection API](https://w3c.github.io/selection-api/):
  `_web-platform/specs/selection-api`,
  `b475d4ba72cbe08f5015040dcd9fb4cf9133dd00`.
- [Clipboard API](https://w3c.github.io/clipboard-apis/):
  `_web-platform/specs/clipboard-apis`,
  `6201fd15cf28cfefbcf3b920dd04edfc0fa61753`.

CSSOM View remains deferred by agreement.

## Validation

The 31 API/lifetime tests plus 10 locked-input tests pass on custom Node 27,
Node 24.19.0 and Node 26.8.1, with and without the addon: 41 ordinary passes per
configuration, no skips or expected failures. A wider custom/addon run passes
199 tests across nine files covering DOM mutation, capture removal, Document
cleanup, legacy mouse state, mouse movement and wheel input. Typecheck, ESLint,
import boundaries and patch whitespace checks pass.

The 11 new §8 tests first exposed nine failures: ordinary/shadow removal left
lock retained, removal/adoption notification was absent, invalid queued requests
acquired, and a detached retarget reported the wrong error. The removal hook,
queue-time check and retained notification Document fix those cases. Reinsertion
before pending acquisition and state-preserving movement remain enabled checks.
