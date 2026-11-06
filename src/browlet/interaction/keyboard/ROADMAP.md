# Keyboard input roadmap

This owner provides key-value selection, key/code vocabularies, and a UserAgent-owned
KeyboardInputProcessor for queued presses/releases. Native layout/classification,
HTML focus and activation, editing/default actions, and IME effects remain explicit
dependencies. KeyboardEvent itself stays in the shared [event foundation](../events/ROADMAP.md).
HTML §8.1.8.3's Element.fireClick() now provides the firing operation for eligible
non-pointer activation and reads this processor's current modifier snapshot.
applyDefaultAction() retains its named throwing dependency until HTML defines
which keys/elements activate and their concrete actions; this slice supplies no
shortcut, focus, or editing policy.

## Section 4 keyboard mapping and cancellation audit

Reviewed §§4.1–4.3.4 and the companion key/code value-selection rules on
2026-11-02. This section adds requirements for the missing input producer, not
another event interface or constructor conversion:

- §§4.1–4.2 distinguish physical location, key labels, and effective layout.
  `code` identifies the key independently of modifiers/layout; `key` describes
  its current meaning. Releasing Shift before a letter can change that letter's
  keyup value while its code stays the same. Do not replay the keydown payload.
- §4.3.1 distinguishes held modifiers from lock states. The UserAgent needs live
  input state; EventModifierState remains a snapshot belonging to one event.
  The snapshot must include the transition represented by the notification.
- [§4.3.4](https://w3c.github.io/uievents/#keys-cancelable-keys) requires canceled
  keydown to suppress associated text/default actions, but not keyup or modifier
  state changes. Canceling keyup cannot undo an earlier edit. Synthetic dispatch
  does not update the input source's state.
- §§4.3.2–4.3.3 require dead-key/composition state and input-method results.
  Key events do not determine the IME's state, and text may arrive without a
  corresponding key. Native IME commands and session editing remain with the
  input adapter and HTML/Input Events owners identified in the [composition audit](../events/ROADMAP.md#section-36-event-objects-and-composition-dependencies).
- [UIEvents-Key §2.2](https://w3c.github.io/uievents-key/#selecting-key-attribute-values) selects
  named keys or effective text, accounts for non-glyph modifiers, and falls back
  to Unidentified. Its NFC requirement applies to produced key strings. Author
  construction continues to preserve converted DOMStrings, including unknown
  names and decomposed text; it has no device/layout mapping step.

The source-side TODOs in [keyboard-event.ts](../events/keyboard-event.ts) identify these
requirements. At this audit checkpoint there was no device-input entry point.
The queued-delivery slice below now supplies one, using explicit automation/native
input without selecting a GUI library. Focus, editing, activation, and IME still
call their named owners.

The [browser-only probe](../../../../node-compat/experimental/input-delivery/keyboard-state.mjs)
ran five cases on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All agree:
ordinary Shift+Q and canceled Shift keydown insert Q; canceled Q keydown inserts
nothing but still delivers keyup; canceled Q keyup leaves the edit intact; and
an author-dispatched Shift keydown does not shift the next driver-generated Q.
Releasing Shift before Q changes Q's keyup to key=q/code=KeyQ with Shift=false.
These are browser observations, not passing Browlet input-producer regressions.
The probe uses Playwright's key mapping; it does not test native layout changes,
lock-key handling, dead keys, or IME composition.

`SPEC_CLASH(virtual-keyboard-code)` remains a pending producer decision:
[UI Events §4.2.4](https://w3c.github.io/uievents/#code-virtual-keyboards) permits
undefined code for nonstandard virtual keyboards and suggests the factory-reset
key value for modal keys. [UIEvents-Code](https://w3c.github.io/uievents-code/#code-value-tables)
requires its named code vocabulary, with Unidentified when no code can be
determined. A key value such as "a" is not the physical code "KeyA". Resolve this
with browser/input-adapter evidence when implementing virtual-keyboard mapping;
no constructor behavior or producer policy changes in this audit.

## Keyboard companion values, 2026-11-04

[UIEvents-Key §§2.1–2.2](https://w3c.github.io/uievents-key/#key-attr-values)
now have a value-selection implementation in [values.ts](values.ts).
selectKey prefers an appropriate named key, then generated character text, then
text with non-glyph modifiers removed, otherwise Unidentified. Produced text is
normalized to NFC. Shift, CapsLock, and AltGraph are glyph modifiers; removing
Control must not remove their effect or guess a US keyboard layout.

Eric approved representing the specification's implicit native event with
KeyboardKeyInput. It requires the appropriate name, generated text or null,
non-glyph-modifier presence, and glyph-only text or null. The future adapter must
supply these facts afresh for every press/release. Its explicit source TODO owns
native layout translation, key-string classification (non-control base plus Mc
or nonzero-canonical-combining-class marks), and dead-key/IME interpretation.
No Unicode-category approximation, OS scan-code mapping, native dispatcher, or
editing behavior is supplied by this slice. The existing keyboard-event.ts
producer TODO connects that future caller to this algorithm.

isNamedKey covers all 284 distinct names in UIEvents-Key §3, including optional
names; isKeyboardCode covers all 172 explicit codes in UIEvents-Code §3. Both
accept further numbered F keys, and only named keys accept numbered Soft keys.
Code recognition does not infer a physical position from a character or key cap.
The existing virtual-keyboard conflict above remains pending with that adapter.
Synthetic KeyboardEvent construction still preserves arbitrary DOMStrings,
including unknown names, control characters, and decomposed text.

The [vocabulary audit](../../../../node-compat/experimental/input-delivery/check-keyboard-vocabulary.mjs)
compares the production tables against every local specification row; both match.
The [browser-only probe](../../../../node-compat/experimental/input-delivery/keyboard-values.mjs)
agrees across Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 for nine input
cases: Q with ordinary/Shift/Control/Control+Shift modifiers, main/numpad Enter,
Digit1, Space, and F1. All three also preserve the seven constructor strings.
Playwright supplies that layout: these results do not establish native layout,
NFC generation, lock-state, dead-key, or IME behavior.

The 26 [value tests](../../../../test/browlet/interaction/keyboard/values.test.ts)
plus 18 KeyboardEvent tests pass on custom Node 27, Node 24.19.0, and Node 26.8.1,
each with the addon enabled and disabled: 44 ordinary passes per configuration,
no expected failures or skips. Typecheck, generated declarations, type contracts,
focused ESLint, import boundaries, and patch whitespace checks pass. This closes
the bounded companion-value work; the larger keyboard-input pipeline retains
its explicit owners. Clipboard API is the next adjacent specification.

## Queued keyboard delivery, 2026-11-05

UI Events [§3.5.4.1](https://w3c.github.io/uievents/#keyboardevent-global-state),
[§3.5.5](https://w3c.github.io/uievents/#events-keyboard-event-order), and
[§3.5.6](https://w3c.github.io/uievents/#events-keyboardevents) now have a bounded
input coordinator in [input.ts](input.ts). UserAgent lazily owns keyboardInput;
there is no OS listener, timer, polling, or second dispatcher.

Eric approved an adapter record containing complete post-transition modifiers and
reserved-shortcut classification. KeyboardInput also requires key-selection facts,
code/location, repeat, composition state, and native legacy keyCode. Lock states
and left/right aggregation come from the adapter, including changes outside the
page. The processor stores the latest immutable EventModifierState at receipt and
copies each input record before queuing an HTML user-interaction task. Independent
Window queues cannot overwrite one another's captured modifiers. Each release
uses fresh layout facts; repeated presses remain separate notifications.

The queue method owns Browlet integration: destination ownership/lifetime checks,
input snapshots, and task entry. The delivery method applies the specification's
rules: select current focus for each event, select/normalize key, notify HTML of
activation-triggering presses, allocate in the target's realm, dispatch trusted
bubbling/cancelable/composed keydown/keyup, then gate ordinary keydown effects on
cancellation. Escape and adapter-identified reserved shortcuts do not trigger
activation. Timestamps retain input receipt time relative to the event's realm.
Synthetic dispatch never changes the input source or invokes these continuations.

KeyboardEvent.create combines DOM allocation with UI Events' native attributes;
the selected key and captured input are explicit, separate from constructor data.
Its modifier queries retain the existing full EventModifierState behavior.

Dependencies are executable boundaries, not only this inventory:

- Document.hasFocus() and Document.focusedArea retain HTML §6.6's existing throwing
  stubs. Use the actual focus anchor, not activeElement's shadow-retargeted answer.
  A viewport uses body/root fallback. Routing to the receiving Document and input
  eligibility remain with the native adapter and HTML focus owner.
- notifyUserActivation() throws for HTML §6.4's shared notification steps, like the
  existing mouse producer. It does not fabricate an activation timestamp.
- applyDefaultAction() throws for HTML focus traversal, element activation, editing,
  and Clipboard command handling. beforeinput/edit/input and optional legacy
  keypress/textInput remain unimplemented; no platform shortcut map is guessed.
- handleCompositionKey() throws for the IME owner. It receives the keydown result
  even when canceled so that owner can implement composition cancellation rules.
  A supplied isComposing flag does not create a session; standalone text commits,
  dead-key state and composition start/update/end still require that owner.

The focused tests use real Window bindings, DOM dispatch, and task turns, mocking
only these unfinished owner effects/queries. They cover receipt snapshots, NFC,
modifier cancellation, repeats, focus changes, shadow retargeting, body/root
fallback, independent Window realms, timestamps, system focus loss, closed-context
rejection and task activity gating. These tests establish the coordinator's
behavior, not successful native typing or document editing.

Clipboard can proceed without completing HTML §6. The pertinent data prerequisite
is [§6.11.2](https://html.spec.whatwg.org/multipage/dnd.html#the-drag-data-store)
and [§6.11.3](https://html.spec.whatwg.org/multipage/dnd.html#the-datatransfer-interface),
including its item-list/item interfaces. Stubbing those limits ClipboardEvent
handler tests; ClipboardItem and asynchronous clipboard work do not require the
whole dragging gesture model. Focus, activation, native clipboard access, rendered
selection extraction, and cut/paste edits remain distinct owner dependencies.

Validation: the 18 new input tests, 26 key-value tests and 18 KeyboardEvent tests
pass on custom Node 27, Node 24.19.0 and Node 26.8.1, each with the addon enabled
and disabled: 62 ordinary passes per configuration, no expected failures or skips.
Typecheck (including generated platform declarations), focused ESLint, import
boundaries and patch whitespace checks pass. No runtime/addon changes are needed.
