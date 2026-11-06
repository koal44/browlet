# Interaction event objects roadmap

Start with UI Events. PointerEvent inherits MouseEvent, which inherits UIEvent;
MouseEventInit also needs UI Events' EventModifierInit dictionary. The current
[UI Events draft](https://w3c.github.io/uievents/#previous-events) has moved mouse
and wheel definitions to [Pointer Events](https://w3c.github.io/pointerevents/).
There is no separate wheel checkout needed for these drafts.

The UI Events and Pointer Events repositories were cloned and checked against
their upstream tracking branches on 2026-11-02. Local reference root:
`C:\Users\rando\source\repos\_web-platform\specs`.

| Standard | Checkout and revision | Primary source |
| --- | --- | --- |
| UI Events, Editor's Draft dated 2026-02-21 | `uievents`, `main`, `8c1b80982c16b10f28a210e4541ac799dbe39a51` | `index.bs` and its `sections/*.txt` sources |
| Pointer Events | `pointerevents`, `gh-pages`, `7affe62fa4332543f8b13c56292104e4e9dfa517` | `index.html` (ReSpec source) |
| Input Events Level 2, referenced extension | `input-events`, `gh-pages`, `e69ef15b60bd4516417bfef5c88e7d0ca007d1cf` | `index.html` (ReSpec source) |
| UI Events KeyboardEvent key Values, referenced vocabulary | `uievents-key`, `gh-pages`, `140cae88d6039b3fb1a51787978678115111c433` | `index-source.txt` (Bikeshed source) |
| UI Events KeyboardEvent code Values, referenced vocabulary | `uievents-code`, `gh-pages`, `b201684d1de0af90bc403814bbdee6aa96647130` | `index-source.txt` (Bikeshed source) |
| Pointer Lock, §5's referenced owner | `pointerlock`, `gh-pages`, `c2692a6b6016d67dd6b1e311e130f17a384826e8` | `index.html` (ReSpec source) |

The complete main UI Events draft was skimmed for this inventory. The separate
`uievents/event-algo.bs` companion has `Status: DREAM`; its exploratory algorithms
are research material, not a substitute for the main draft. Pointer Events was
checked for the shared interface dependencies and input-processing boundaries;
its audit now reaches the WheelEvent interface, with explicit unfinished owner dependencies.
Pointer Events was rechecked against upstream on 2026-11-04 at the same revision.
The Input Events reference was cloned on 2026-11-02 and inspected for its
InputEvent partials, inputType vocabulary, and editing/IME producer boundary;
this does not constitute an audit of that whole specification.
The key/code references were cloned on the same date, then refreshed with
fast-forward-only updates on 2026-11-04; both remain at the revisions above.
The [companion-values slice](../keyboard/ROADMAP.md#keyboard-companion-values-2026-11-04)
implements key selection and both vocabularies.
Device-specific mappings and key-string classification remain adapter work.
Pointer Lock was cloned on the same date for its movement fields, native-input
gaps, and locked-coordinate requirements; its acquisition/release API is not
part of this UI Events audit.

Producer and retained-state audits now live with [keyboard](../keyboard/ROADMAP.md),
[mouse](../mouse/ROADMAP.md), [pointer](../pointer/ROADMAP.md), and [wheel](../wheel/ROADMAP.md).
This roadmap retains the event classes, declarations, creation algorithms, and
shared constructor/dispatch contracts. [Interaction](../ROADMAP.md) owns the overall sequence.

## Sequence and ownership

UI, focus, keyboard, composition, input, mouse, wheel, and pointer event
implementations and declarations will live in `interaction/events/`. Existing
DOM Event/EventTarget and dispatch stay in `dom/events/`. This follows the
feature-owned event pattern already used by navigation and storage.

[UIEvent](ui-event.ts) and the [MouseEvent implementation](mouse-event.ts)
now live here. DOM dispatch uses Event's `isMouseEvent()` implementation predicate
plus the `click` type check; an ordinary Event or UIEvent named `click` does not
trigger activation. This component is a foundation below DOM nodes, independently
of the higher interaction producers, just as `storage/events/` and
`browsing/navigation/events/` already are. MouseEvent now supplies its constructor,
modifier/related-target state, legacy initializer, and movement partials. Its
layer coordinates explicitly require unfinished CSS layout/painting geometry;
native input production remains separate.

Input processing and retained device state belong with
[interaction](../ROADMAP.md#ui-and-pointer-event-production) on the Window, Document,
or UserAgent selected by the relevant algorithm. Event classes can retain type-only
references to those owners. The event hierarchy does not own OS input collection,
hit testing, or the editing/focus implementation. This needs no new subsystem
or environment.

| UI Events section | Work and boundary |
| --- | --- |
| §§1–2: introduction, conformance, conventions | Apply the draft's distinction between author-created events and events produced by the user agent. No new runtime component. |
| §3 introduction and §3.1: shared rules and event-type list | Audited against existing DOM construction, initialization, trusted firing, and Document's legacy factory. Individual event producers own their event-type requirements. |
| §3.2: UIEvent | §§3.2.1–3.2.2 implement UIEvent/UIEventInit and initialization. §3.2.3's event types are audited below against their existing producers and unfinished HTML owners. |
| §3.3: FocusEvent | §3.3.1's event object, relatedTarget conversion/dispatch, and DOM legacy factory are implemented. §§3.3.2–3.3.4's actual focus transitions require HTML §6.6's focused-area and focus-chain model; Document.focusedArea currently throws. |
| §3.4: InputEvent | §3.4.1 implements the base event object and dictionary. §§3.4.2–3.4.3's ordering/default-action requirements remain with HTML editing/controls, Input Events, and Selection API; the dataTransfer/target-range partials are separate Input Events work. |
| §3.5: KeyboardEvent | Event objects, location constants, EventModifierInit, and modifier queries are implemented, along with the legacy initializer/codes and DOM factory. §§3.5.4–3.5.6's UserAgent modifier state, device sequencing, and default actions still need the input producer and its focus/editing/activation owners. |
| §3.6: CompositionEvent | The event object, legacy initializer, and DOM factory are implemented. Composition sequencing/cancellation and keyboard/input isComposing values still need the editing/IME producer; UI Events and Input Events disagree on composition-update order/cancelability. |
| §4: keyboard input and values | [Audited with the keyboard owner](../keyboard/ROADMAP.md#section-4-keyboard-mapping-and-cancellation-audit) using a five-case browser probe. The companion key-selection algorithm and key/code vocabularies are now implemented. Native mapping, modifier transitions independent of cancellation, and dead-key/IME processing still require the input producer; synthetic constructors retain their supplied strings. Virtual-keyboard code guidance conflicts with the companion vocabulary. |
| §5: external algorithms | §5.1 contains no algorithms. §5.2's movement initialization and Window-owned mousemove deltas are implemented internally, with the approved Y-axis correction. The MouseEvent binding is now connected below. Native production, gap notifications, and locked/raw input remain explicit dependencies. |
| §6: legacy initializers | Audited against the existing UIEvent, KeyboardEvent, and CompositionEvent initializers and their approved browser policies. No additional initializer is missing here. |
| §7: legacy attributes | The informative which/charCode/keyCode surface is implemented for the exposed interfaces, including MouseEvent's button-derived which. Native key-code selection still needs OS/IME input state. |
| §8: legacy event types | TextEvent's nonconstructible interface, initializer, and DOM factory are implemented. Optional DOMActivate/DOMFocusIn/DOMFocusOut/keypress and trusted textInput production still require their activation, focus, and editing producers. Native event-order conflicts are recorded below. |
| §§9–12: extension guidance, security, acknowledgements, glossary | Audited below against CustomEvent, DOM dispatch, and their existing tests. No additional runtime algorithm; native-input exposure and resource-loading policy remain with their owners. |

## Sections 1–2 reviewed

Reviewed the local draft's introduction, all conformance classes, and stylistic
conventions on 2026-11-02.

- §1.2.1 requires the non-deprecated interfaces and event behavior, appropriate
  event production, Web IDL conformance, and key/code values subject to platform
  availability. Implementing constructors alone does not finish the standard;
  partial implementation can claim only its supported portions.
- Deprecated APIs are optional for UI Events conformance. Compatibility can
  justify implementing them, but each belongs with its interface's review.
- The draft's older DOM Level 3 Core references do not create a second DOM
  implementation. Continue using our current WHATWG DOM dispatch and Web IDL
  machinery; review any concrete contradictory requirement when reached.
- §2 distinguishes the printed key cap, a character glyph, a Unicode value, a
  KeyboardEvent.key value, and a physical KeyboardEvent.code. Keep those roles
  distinct in subsequent input algorithms; no new runtime operation is defined
  by this notation.

No runtime edits are needed for these sections. Subsequent algorithms specify
the constructor, dispatch, and input behavior still to be implemented or audited.

## UIEvent foundation implemented

Reviewed §3's shared rules and §3.1 on 2026-11-02. DOM already owns Event flags,
timestamps, inheritance, propagation, cancellation, and trusted firing. UI Events'
constructor guidance does not require a second dispatcher or producer framework.

[ui-event.ts](ui-event.ts) implements §§3.2.1–3.2.2: UIEvent/UIEventInit, converted
`view` and `detail`, and `initializeUIEvent()`. The same slice supplies legacy
`initUIEvent()` (§6.1.1), `which` (§7.1), and Document.createEvent's UIEvent/UIEvents
aliases. Partial declarations remain separate. Constructor timestamps use the
event's realm; a supplied view may belong to another realm.

The host initializer accepts a Node or Window target. The printed algorithm
accepts EventTarget but immediately requires its node document. The narrower
callable contract makes that requirement explicit, with Window as the other
supported UI-event target. An adopted node selects its current node document's
Window, independently of the event's allocation realm. The UI Events source links
its InitializeEvent step to DOM's initialization algorithm, which clears trust.
Producers using this initializer must establish `isTrusted` afterwards; ordinary
`fireEvent()` still creates trusted events, while author dispatch clears trust.

The projected tests exposed a pre-existing input-conversion gap: member calls
resolved a declared WindowProxy to its current Window, but interface arguments
did not. Binding now shares that existing resolution for interface inputs,
union selection, and overload selection. It checks the same binding world and
retains the selected Window implementation rather than a live proxy handle.
Explicit WindowProxy-typed, `any`, and `object` arguments keep their existing
representations. No engine or addon change was needed.

Coverage lives in [ui-event.test.ts](../../../../test/browlet/interaction/events/ui-event.test.ts),
DOM dispatch tests, and Binding's proxy tests. It covers dictionary conversion,
receiver checks, subclasses, realm and Window identity, legacy initialization,
dispatch-time guards, adoption, trust, cancellation, and navigation. These are
enabled Browlet regressions, separate from the explicitly invoked browser-only
[comparison probe](../../../../node-compat/experimental/input-delivery/ui-event.mjs).

Validation: 53 focused UIEvent, DOM dispatch, Window-target, and proxy-input tests
pass on custom Node, Node 24.19.0, and Node 26.8.1, each with and without the addon.
The wider Web IDL and event integration run has 754 passes and four existing
expected failures. This slice adds no expected failures.

### Approved compatibility choices

Eric approved these choices after Chromium, Firefox, and WebKit comparison:

- `SPEC_CLASH(ui-event-legacy-reset)`: follow DOM's initialization rules, clearing
  target and retaining composed. Chromium retains target; Firefox resets composed;
  WebKit matches both chosen rules. All three preserve timestamps and ignore
  initialization during dispatch.
- `SPEC_CLASH(ui-event-retired-view)`: retain the selected Window and use our
  existing outward projection, returning null after replacement. Chromium agrees;
  Firefox and WebKit return the reused WindowProxy. A view obtained before
  replacement remains the stable proxy already returned to author code.
- `SPEC_CLASH(ui-event-which-init)`: plain UIEvent.which returns zero and its
  constructor does not read `which`. All three browsers agree. The draft's
  informative §7.1 dictionary extension suggests accepting that member instead.
  Derived key/button event interfaces will supply their own compatibility rules.

## Section 3.2.3 event-type audit

The draft itself distinguishes UI-generated UIEvents from other producers'
Events. The shared type string does not select an interface or replace a
feature's loading, reporting, or selection algorithm.

| Type | Existing path and remaining owner |
| --- | --- |
| load | `Document.finishLoading()` fires an Event at Window with HTML's legacy Document target override. Its provisional parser milestones and `completelyFinishLoading()`'s child-container task TODO remain HTML parsing/child-loading work. |
| unload | `Document.unloadAndDescendants()` explicitly throws pending HTML §7.5.9's traversal, descendant ordering, pagehide/unload dispatch, timing, and bfcache decisions. |
| abort | `Document.abort()` cancels its fetch group and parser under HTML's lifecycle rules; it is not a generic UI abort producer. Image/media resource-abort delivery belongs to their unfinished loaders. DOM's AbortSignal abort Event is a separate producer. |
| error | HTML's `BrowletEnvironment.reportException()` already dispatches a cancelable ErrorEvent. Resource-loading error events belong to the resource's loader; the UI Events overview does not change the exception reporter's interface or flags. |
| select | Control text-selection processing remains HTML §4.10.18.5 work on input/textarea, with document selection owned by Selection API. Constructing or dispatching a synthetic event does not supply that state or processing. |

No producer was replaced by a generic UIEvent factory in this slice. The event
type audit is complete; these lifecycle dependencies are not implemented by it.

## Section 3.3 event objects and dispatch

[FocusEvent](focus-event.ts) implements the constructor, inherited UIEventInit
dictionary, and nullable EventTarget relatedTarget. DOM's case-insensitive
`Document.createEvent('FocusEvent')` entry creates an uninitialized event in the
Document's realm. There is no additional legacy FocusEvent initializer in this
draft; inherited initialization remains available.

The implementation reuses Event's related-target slot and DOM dispatch's existing
retargeting, path suppression, and shadow-target cleanup. Binding converts and
projects every EventTarget subtype, including WindowProxy, without restricting
author-provided targets to focusable elements. Constructor flags stay at the
dictionary defaults even when the event is named `focusin` or `focusout`.

The §3.3.2–§3.3.4 production rules were reviewed. HTML §6.6's
[focus update steps](https://html.spec.whatwg.org/multipage/interaction.html#focus-update-steps)
must choose old/new focus-chain targets and update state before notification;
blur/focus are nonbubbling, focusout/focusin bubble, and all four are composed,
noncancelable events with a Window view and zero detail. Nested-context related
target privacy is a producer responsibility, not a constructor restriction.
`Document.focusedArea` remains the existing throwing dependency, now also naming
the event-producing focus update steps. OS/application focus, focusable-area
selection, and focus-chain maintenance remain with that owner. This event-object
slice does not implement automatic focus transitions.

Fourteen enabled [FocusEvent tests](../../../../test/browlet/interaction/events/focus-event.test.ts)
cover construction, dictionary order, invalid inputs, EventTarget and WindowProxy
identity, borrowed getters, subclasses, legacy creation, host-created delivery,
and related-target shadow behavior. Together with UIEvent, all 33 tests pass on
Node 24.19.0, Node 26.8.1, and custom Node, with and without the addon. The broader
DOM dispatch/Window target/handler/error-reporting run has 94 passes and two
existing skipped attribution tests. No new expected failures or skips were added.

### Approved FocusEvent browser differences

The explicitly invoked [browser probe](../../../../node-compat/experimental/input-delivery/focus-event.mjs)
ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 on 2026-11-02.
Eric approved following DOM and Chromium on both differences:

- `SPEC_CLASH(focus-event-legacy-view)`: DOM dictionary defaults give a legacy
  FocusEvent a null view. Chromium/WebKit agree; Firefox supplies the Window.
- `SPEC_CLASH(event-related-target-suppression)`: when a shadow host is the
  dispatch target and its descendant is relatedTarget, DOM suppresses the entire
  dispatch. A fresh event retains target=null and the original relatedTarget,
  matching Chromium. Firefox additionally clears relatedTarget; WebKit sets
  target to the host. No DOM dispatch logic changed for this slice.

All three agree on ordinary related-target retargeting, stopping propagation
when both targets retarget to one host, and clearing private targets after that
dispatch. Chromium additionally reads UIEventInit.sourceCapabilities from the
separate InputDeviceCapabilities extension, which Browlet does not implement.

## Section 3.4 event objects and producer boundary

[InputEvent](input-event.ts) implements the UI Events constructor and dictionary:
nullable data, isComposing, and inputType, with inherited view/detail and Event
flags. Web IDL owns all author conversion. Supplied data stays distinct from
null/empty defaults, and constructor flags do not change with the event's name.
Inherited initEvent/initUIEvent leave the input-specific payload intact. DOM's
legacy createEvent table has no InputEvent entry; all three tested browsers reject
that name as NotSupportedError.

The §3.4.2–§3.4.3 order is beforeinput, editing, then input. A synthetic dispatch
only delivers the supplied event; it neither performs an edit nor creates a
second event or a composition session. Existing onbeforeinput/oninput handlers
already use the shared HTML handler and DOM dispatch machinery. Trusted event
production must select an editing host and selection, choose the inputType and
data, observe composition state, and honor cancellation before applying an edit.
HTML §6.8 and controls' value/selection algorithms own those effects. Input and
textarea's current-value dependencies still throw; no replacement editor was
added to EventTarget. Source TODOs identify the producer and partial-interface
dependencies directly in input-event.ts.

The separately referenced [Input Events extension](https://w3c.github.io/input-events/#interface-InputEvent)
adds dataTransfer and getTargetRanges/targetRanges. Neither is exposed by this
UI Events slice. StaticRange already exists, but the partial declaration and its
retained target-range behavior remain to implement with that specification.
DataTransfer needs HTML §6.11's drag data store and projection. The extension also
refines producer cancelability, notably during IME composition; a constructor
must not infer those rules from an author-supplied inputType.

### Approved InputEvent string choices

The [browser-only probe](../../../../node-compat/experimental/input-delivery/input-event.mjs)
ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 on 2026-11-02.
Eric approved preserving supplied strings:

- `SPEC_CLASH(input-event-data-string)`: the draft declares the attribute as
  USVString but its dictionary input as DOMString. All three engines preserve
  lone surrogates and decomposed text from author construction. Browlet uses
  DOMString for both, without introducing scalar-value replacement or NFC
  normalization at construction/readback. Input-method normalization is a
  separate producer concern.
- `SPEC_CLASH(input-event-input-type)`: retain the converted DOMString as
  Firefox/WebKit do, including unknown strings and case. Chromium converts
  through its internal input-type enum and replaces unrecognized names with
  empty, including some names present in Input Events' vocabulary. There is no
  constructor filtering algorithm in UI Events' DOMString declaration.

Fourteen enabled [InputEvent tests](../../../../test/browlet/interaction/events/input-event.test.ts)
cover defaults, dictionary order, coercion errors, Unicode preservation, open
input-type strings, receiver/realm ownership, subclasses, legacy initialization,
synthetic cancellation, and trusted host-created delivery. All 47 UIEvent,
FocusEvent, and InputEvent tests pass on all six runtime configurations. The
broader event integration run has 108 passes and two existing skipped attribution
tests. No new expected failures or skips were added.

## Section 3.5 event objects and keyboard ordering

[KeyboardEvent](keyboard-event.ts) implements the constructor, key/code/location,
four convenience modifier attributes, repeat/isComposing, getModifierState(),
and location constants. [EventModifierInit](event-modifiers.ts) supplies all 14
specified modifiers for keyboard events and the later MouseEventInit dictionary.
Each event captures an independent modifier snapshot. Author construction neither
updates device state nor derives key/code/legacy numbers from other fields.
The supplied strings remain DOMStrings; location and legacy codes undergo Web IDL
unsigned-long conversion without restricting author values to device mappings.

The §6.1.2 initializer and §7.2 legacy attributes/dictionary remain separate
partial declarations. initKeyboardEvent uses the existing UIEvent/DOM reset and
dispatch guard, sets the supplied key/location and four modifiers, clears other
modifiers, and sets detail to zero. It preserves code, repeat, isComposing,
charCode, and keyCode. which uses keyCode for every event type, without deriving
a character code or reading a separate which constructor input. DOM's singular,
case-insensitive createEvent('KeyboardEvent') entry creates an uninitialized event.

### Ordering belongs to the input producer

The §3.5.5 order is executable behavior, not constructor metadata. For an ordinary
text-producing key the producer must dispatch keydown, then beforeinput, perform
the edit, and dispatch input. Repeated keydowns carry repeat=true and rerun those
steps; release produces keyup. Canceling keydown suppresses its default actions
and input events, while canceling beforeinput suppresses the edit and input.
Neither cancellation suppresses the eventual keyup. Focus can move during the
sequence, so keyup must select the then-current target instead of retaining the
keydown target. IME and non-text keys require their own specified paths.

The explicit browser probe exercised a repeated ordinary key, cancellation at
each stage, and Tab. Chromium, Firefox, and WebKit agreed on all four cases:
input listeners observed the edited value, canceled edits produced no input, and
Tab's keydown/keyup reached different inputs after focus traversal.

There is no Browlet device-input entry point yet. The remaining dependencies are:

- UI Events §3.5.4's UserAgent-owned key modifier state, and §4's native key/code
  mapping, repetition, and layout input. An event snapshot is not that live state.
- HTML §6.6 focused-area selection and sequential focus navigation, including the
  existing throwing Document.focusedArea dependency.
- HTML §6.8/control-value algorithms, Selection API, and Input Events for editing
  targets, selection, inputType, cancellation, and the edit itself.
- HTML §6.5 activation and UI Events §3.6 composition/IME processing.

keyboard-event.ts names these missing producer steps beside the implementation.
No reached producer is silently skipped, and no unused input façade or artificial
global modifier state was introduced. Future automation and native input must
enter the same producer. The existing fireEvent factory can already allocate and
deliver KeyboardEvents, but its generic notification API does not implement a
keystroke. Author dispatch remains synchronous and may deliver any event order;
it must not implicitly edit, move focus, or start a composition session.

### Approved KeyboardEvent browser differences

The [browser-only probe](../../../../node-compat/experimental/input-delivery/keyboard-event.mjs)
ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 on 2026-11-02.
Eric approved the following choices:

- `SPEC_CLASH(event-modifier-support)`: honor all 14 specified initializers with
  exact key names. Chromium omits FnLock/Hyper/Super/SymbolLock; Firefox omits
  Hyper/Super; WebKit supports only the four convenience modifiers, AltGraph,
  and CapsLock. Chromium/Firefox also recognize Accel. Browlet adds neither
  Accel nor OS aliases.
- `SPEC_CLASH(keyboard-event-which)`: follow Chromium's keyCode-derived which.
  Firefox/WebKit use an independent constructor input, defaulting to zero even
  when keyCode is nonzero. This preserves the existing choice to ignore
  UIEventInit.which rather than adding an independent keyboard-only member.
- `SPEC_CLASH(keyboard-event-legacy-init)`: use the draft's key argument and
  preserve unaddressed fields. Chromium retains the old key and resets repeat;
  Firefox sets key and preserves code/repeat/isComposing but clears legacy codes;
  WebKit clears key/code/repeat/isComposing and legacy codes. All three clear the
  extra modifiers and set detail to zero. The draft's locale note is stale:
  its actual IDL has no locale parameter.
- `SPEC_CLASH(keyboard-event-legacy-factory)`: follow DOM's singular entry and
  dictionary-default null view. Chromium/WebKit additionally accept KeyboardEvents;
  Firefox supplies a Window view for legacy creation.

Eighteen enabled [KeyboardEvent tests](../../../../test/browlet/interaction/events/keyboard-event.test.ts)
cover construction, constants, dictionary conversion, modifier independence,
coercion failures, realm/receiver ownership, subclasses, legacy creation and
initialization, synthetic ordering/cancellation, and host-created delivery.
All 64 interaction-event tests pass in all six runtime configurations. The broader
event integration run has 125 passes and two existing skipped attribution tests.
There are no new expected failures or skips. This completes the event-object
slice, not the native keyboard producer or all of §3.5.

## Section 3.6 event objects and composition dependencies

[CompositionEvent](composition-event.ts) implements the constructor and data
dictionary, the §6.1.3 legacy initializer, and DOM's singular createEvent entry.
Constructor and initializer data use Web IDL DOMString conversion, preserving
empty strings, decomposed text, and lone surrogates. Explicit null becomes the
string "null". No Unicode normalization is introduced at construction/readback.

The legacy initializer takes the specified WindowProxy input. Binding supplies
its handle, and the implementation selects its current Window for the inherited
view slot; it does not retain a new proxy-based view lifecycle. It reuses
UIEvent's reset/dispatch guard, resets detail to zero, and sets data. Inherited
initEvent/initUIEvent leave composition data intact. HTML does not declare general
oncompositionstart/oncompositionupdate/oncompositionend handler properties;
ordinary addEventListener listeners receive these notifications.

Sections 3.6.2–3.6.7 were audited. A real input producer still needs to own the
session and its start/update/end sequence, select the focused target through
HTML §6.6, and update the editing host/selection through HTML §6.8 and Input Events.
The source TODO identifies these dependencies. In particular:

- Canceling a triggering keydown should suppress the composition it would start.
- Canceling compositionstart should terminate the session where supported by the
  input system, but the producer must still send compositionend.
- Key events within the session carry isComposing=true; the initiating keydown
  and keyup after the end lie outside that interval. Handwriting/speech input
  need not generate keyboard events at all.
- The start reports selected/original text where available; updates report the
  current composition text before the control changes, and end reports the final
  text after the control changes. Some input systems cannot expose updates.

`SPEC_CLASH(composition-input-order)` remains a pending producer decision:
[UI Events §3.6.6](https://w3c.github.io/uievents/#events-composition-input-events)
orders beforeinput before compositionupdate and describes canceling the edit.
[Input Events §7](https://w3c.github.io/input-events/#input-event-order-during-composition)
orders compositionupdate before beforeinput and makes the composition input pair
noncancelable, with inputType=insertCompositionText. Both place the edit before
input. The producer must resolve this conflict with browser IME evidence and Eric
before implementing that sequence; this event-object slice chooses neither.
Synthetic dispatch does not fabricate a session, edit text, derive another event's
isComposing flag, or automatically send an end notification after cancellation.

### Approved CompositionEvent browser differences

The [browser-only probe](../../../../node-compat/experimental/input-delivery/composition-event.mjs)
ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 on 2026-11-02.
It covers event objects and synthetic dispatch, not native IME production.
Eric approved the following choices and continued the existing UIEvent reset/view
rules:

- `SPEC_CLASH(composition-event-data-string)`: the draft's attribute says
  USVString, while constructor and initializer inputs say DOMString. All three
  engines preserve UTF-16 text, including lone surrogates and decomposed strings;
  Browlet uses DOMString for the attribute as well.
- `SPEC_CLASH(composition-event-legacy-data)`: omitted/undefined legacy data
  defaults to empty, following the draft/WebKit. Chromium uses the literal
  "undefined" string; Firefox uses null and also preserves explicit null.
- `SPEC_CLASH(composition-event-legacy-view)`: DOM legacy creation defaults view
  to null, matching Chromium/WebKit; Firefox supplies the Window.

All three reject the plural CompositionEvents factory name, set legacy detail
to zero, and expose none of the general oncomposition* handler properties. The
initializer reuses the already-approved DOM reset behavior despite the existing
Chromium target/Firefox composed differences. The draft's locale note is stale:
the actual IDL contains no locale argument.

Seventeen enabled [CompositionEvent tests](../../../../test/browlet/interaction/events/composition-event.test.ts)
cover construction, conversion, Unicode, receiver/realm ownership, subclasses,
legacy creation/reset, dispatch-time conversion/guarding, inherited initialization,
synthetic listener delivery/cancellation, and trusted host-created notifications.
All 81 interaction-event tests pass on all six runtime configurations. The broader
event integration run has 142 passes and two existing skipped attribution tests;
no new expected failures or skips were added. The composition input producer
remains unfinished.

## Section 5 movement algorithms

Reviewed §5 and Pointer Lock's MouseEvent extensions on 2026-11-02. §5.1's
"Core DOM Algorithms" heading contains no actual algorithms. Section 5.2 now has:

- `MouseEventImpl.initializePointerLockAttributes()`, which zeros movementX/Y
  without changing screen coordinates or the event's other state.
- `WindowImpl.lastMouseMove`, initially undefined, retaining copied coordinates
  from that Window's last producer mousemove. Separate Windows have separate
  histories; navigation that replaces a Window starts fresh even when the
  WindowProxy identity is reused.
- `WindowImpl.setPointerLockAttributesForMousemove(event)`, which returns without
  changing the event or history for any type other than mousemove. A first move
  has zero relative motion; later moves subtract each previous coordinate and
  then store the new position before dispatch. It does not retain the event.

`SPEC_CLASH(pointer-lock-movement-y)`: Eric approved using current screenY minus
previous Y. [UI Events §5.2](https://w3c.github.io/uievents/#set-pointerlock-attributes-for-mousemove-id)
instead prints screenX in that calculation. [Pointer Lock §6](https://w3c.github.io/pointerlock/#extensions-to-the-mouseevent-interface)
defines relative motion along the corresponding axes. Chromium's
`core/input/mouse_event_manager.cc::UpdateMouseMovementXY` and Firefox's
`dom/events/MouseEvent.cpp::GetMovementPoint` use axis-matched differences.

The [browser-only probe](../../../../node-compat/experimental/input-delivery/mouse-movement.mjs)
confirms nonzero X/Y deltas and zero button-event motion in Chromium 156.0.8078.4
and Firefox 157.0. Synthetic dispatch preserves supplied movement values and does
not change their next native delta. All three engines preserve constructor data
on synthetic mousemove and mousedown. WebKit 27.2's Windows automation supplies
changing client coordinates but zero screen coordinates/deltas throughout, so
it provides no nonzero native-axis evidence. The initial probe incorrectly
expected driver viewport displacement to imply screen displacement there; the
retained probe compares actual screen coordinates and reports that evidence limit.

These are internal algorithms, not a complete MouseEvent or Pointer Lock API:

- Pointer Events' "initialize a MouseEvent" calls the movement initializer;
  §11.2.17's native movement processor runs the Window operation once on its
  private pointermove snapshot before raw/pointer/mouse dispatch. The approved
  helper extension uses MouseEvent-rounded positions while PointerEvent retains
  fractional coordinates; no intermediate MouseEvent is allocated.
- Ordinary DOM dispatch and author constructors must not run the Window
  operation or replace explicitly supplied movement values. The generic
  EventTarget path remains independent of native input history.
- Pointer Lock §6 requires the producer to clear lastMouseMove when native input
  is interrupted, so the next move is zero. Tests supply that gap notification;
  an OS/input-adapter hookup is still missing.
- Locked screen coordinates are frozen, and clipped/raw motion can differ from
  coordinate subtraction. Those producers need native deltas and must not use
  this unlocked-coordinate recipe. Lock acquisition/release and native relative
  motion remain Pointer Lock work; the movement processor throws on locked input.

Twelve enabled [internal algorithm tests](../../../../test/browlet/interaction/events/mouse-movement.test.ts)
cover initialization, first/subsequent moves, independent axes, copied history,
non-mousemove guards, input-gap reset, Window ownership/navigation, and synthetic
dispatch. The 109-test interaction/DOM-event slice passes in all six runtime
configurations; adding the Window-event suite gives 117 passes on custom/compat.
Typecheck, Web IDL type contracts, scoped lint, and import boundaries pass. No
new expected failures or skips were introduced.

## Sections 6–8 legacy audit and TextEvent

Reviewed all three sections on 2026-11-02. §6 revisits the initializers already
implemented alongside their interfaces: dispatch guards, Web IDL conversion,
inherited event reset, view selection, and data defaults. Keep their separate
partial declarations and existing approved SPEC_CLASH choices. The initializer
prose still mentions locale despite omitting it from IDL, and says detail remains
undefined while browsers reset it to zero. The earlier KeyboardEvent and
CompositionEvent slices already selected zero. This audit adds no locale member.

§7 is informative, and its legacy key-code models are not a rule for coercing
constructor key strings. KeyboardEvent retains supplied charCode/keyCode;
which still follows the approved keyCode policy. Plain UIEvent.which remains
zero and ignores the informative dictionary member. Native virtual-key codes,
IME processing code 229, layout-dependent character codes, and keypress mapping
need the native keyboard producer. The source TODO names §§7.3/8.3. MouseEvent's
button-to-which behavior is now connected by the prerequisite slice below.

[TextEvent](text-event.ts) implements [§8.4](https://w3c.github.io/uievents/#legacy-textevent-events)
and [DOM's legacy factory entry](https://dom.spec.whatwg.org/#dom-document-createevent):

- Expose the Window interface and UIEvent inheritance without an author
  constructor. Document.createEvent accepts the singular name case-insensitively,
  retains the Document's realm, and returns an event requiring initialization.
- Fresh data is the empty string. initTextEvent's omitted/undefined data is the
  literal string "undefined", as the IDL and all three browsers specify. Text
  undergoes DOMString conversion, preserving lone surrogates and decomposed text.
- The initializer checks the dispatch flag after Binding converts its arguments,
  resets UIEvent detail to zero, and preserves the timestamp. Inherited
  initializers leave data alone. Existing DOM reset and Window-view policies apply.
- Internal creation uses the existing event factory, including realm-owned
  timestamps and projection. There is no new event adapter or engine work.

The linked [UI Events Algorithms companion](https://w3c.github.io/uievents/event-algo.html#textevent)
describes initTextEvent but still references an unbound eventTarget and notes its
duplicated initialization. It has Status: DREAM. Reusing initUIEvent with the
explicit view and zero detail agrees with Blink, Gecko, and WebKit; this does not
adopt the companion's unfinished editing pipeline.

The [manual browser-only probe](../../../../node-compat/experimental/input-delivery/text-event.mjs)
ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three agree on
interface exposure, constructor rejection, singular factory names, data conversion,
detail reset, dispatch guards, and invalid argument handling.
`SPEC_CLASH(text-event-legacy-view)` repeats the approved UIEvent-family choice:
DOM's initial null view agrees with Chromium/WebKit; Firefox supplies the Window.
The existing `ui-event-legacy-reset` choice also applies: clear target as DOM
requires, whereas Chromium retains it after initialization.

Eric approved `SPEC_CLASH(synthetic-textinput-editing)`: author dispatch only
delivers listeners/cancellation, matching Chromium/Firefox. WebKit additionally
edits a focused input and fires trusted beforeinput/input events. The explicit
untrusted-event/default-action rule cited during review is in the
[older UI Events text](https://w3c.github.io/uievents/TR.html#trusted-events), not
the current draft's reorganized sections. Current DOM dispatch supplies no
text-editing step; Browlet preserves that separation. The enabled regression
checks generic dispatch on a contenteditable element. It is not a full focused
input-control regression: HTMLInputElement's live value and focus remain missing.

Legacy producer boundaries remain explicit:

- §8.1's optional DOMActivate is not synthesized. Its UIEvent representation
  needs no new subclass; activation belongs to HTML §6.5 and the input producer.
- §8.2's DOMFocusIn/DOMFocusOut require HTML §6.6 focus transitions, with null
  relatedTarget for these legacy types. Document.focusedArea remains the named
  throwing dependency. The main/legacy focus-order conflict below is unresolved.
- §8.3's optional keypress and §8.4's trusted textInput need the keyboard,
  editing, and IME pipeline. Supplying an event object or calling dispatchEvent
  does not implement those producers. No production caller reaches a fake edit.
- `SPEC_CLASH(keypress-input-order)`: §8.3.2 places keypress after beforeinput,
  but all three browsers deliver it before beforeinput for the probed KeyA.
- `SPEC_CLASH(textinput-beforeinput-order)`: Chromium/Firefox deliver
  keydown -> keypress -> beforeinput -> textInput -> input -> keyup; WebKit
  moves textInput before beforeinput. Canceling keypress suppresses all editing
  events in all three. Canceling textInput suppresses editing/input in all three,
  but WebKit has not delivered beforeinput yet. Both ordering choices remain
  pending for the producer; the probe does not cover IME or clipboard input.

Eleven new enabled tests cover TextEvent construction restrictions, realm ownership,
conversion, receivers, initialization, dispatch, and internal creation. All 128
interaction/DOM-event tests pass on custom, Node 24.19.0, and Node 26.8.1 with and
without the addon. No expected failures or skips were added.

## Sections 9–12 reviewed

Reviewed the remaining main sections on 2026-11-02 against the same local draft
and its published Editor's Draft. They require no runtime changes in this slice.

- [§9](https://w3c.github.io/uievents/#extending-events) is non-normative guidance
  for custom events and vendor extensions. Existing CustomEvent construction,
  detail storage, initCustomEvent, and Document.createEvent cover its example;
  EventTarget accepts arbitrary event names. Vendor prefixes are naming advice,
  not a new event namespace, registration table, or dispatch restriction.
- [§10](https://w3c.github.io/uievents/#security-considerations) describes input
  disclosure and resource-load/error side channels. It permits mitigations but
  supplies no blanket filtering algorithm. Native input exposure belongs to the
  input producer; network/resource decisions belong to Fetch and the relevant
  HTML loader. This review does not certify those separate implementations or
  suppress ordinary author events. Event.isTrusted remains unforgeable at Binding,
  and public dispatchEvent clears trust before synchronous DOM dispatch.
- §11 is acknowledgements. [§12](https://w3c.github.io/uievents/#glossary) defines
  vocabulary rather than another dispatch engine. Per-feature algorithms own
  default actions and cancellation; DOM already has the MouseEvent-click
  activation hook. Focus rings remain HTML §6.6 work, key mapping and IME state
  remain input-producer work, and wheel delta units/direction belong with Pointer
  Events' wheel algorithms. Deprecated features remain optional compatibility
  work. Document.createEvent already supplies the glossary's uninitialized state.

The existing DOM Event/EventTarget, Binding, and Document-factory suites pass:
63 tests on custom/compat, with no expected failures or skips. They cover the
reused CustomEvent state/initialization, factory, realm timestamp, trust descriptor,
and dispatch machinery. This documentation-only slice needs no new runtime tests.

The main UI Events draft has now been reviewed in document order through §12.
Its event objects and §5 movement algorithms are implemented to the boundaries
above; native input, focus, editing, IME, and default-action production are still
unfinished. The audit's completion is not a claim of complete UI Events support.

## Pointer Events §§1–2 and the §3 MouseEvent prerequisite

Reviewed the local Pointer Events draft at `7affe62fa4332543f8b13c56292104e4e9dfa517`
and its published Editor's Draft on 2026-11-02. The introduction establishes a
device-independent pointer model, optional compatibility mouse events, and the
accessibility need for higher-level activation/focus and keyboard alternatives.
The [conformance section](https://www.w3.org/TR/pointerevents4/#conformance)
distinguishes normative requirements from examples/notes and defines BCP 14
keywords; it adds no separate runtime algorithm. Neither section
selects an OS adapter, requires Touch Events, or makes synthetic dispatch native input.

§3's PointerEvent inherits MouseEvent. This bounded slice implements that
concrete prerequisite from the draft's later
[MouseEvent interface](https://w3c.github.io/pointerevents/#mouseevent-interface),
constructing steps, and legacy initializer. It includes MouseEventInit,
EventModifierInit inheritance, all fourteen modifier queries, button/buttons,
relatedTarget, DOM's MouseEvent/MouseEvents factory names, and Pointer Lock's
movement interface/dictionary partials. DOM dispatch supplies retargeting and
the existing MouseEvent-click activation hook; HTML still owns actual activation.

The browser-only `node-compat/experimental/input-delivery/mouse-event.mjs` probe
used Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved:

- `SPEC_CLASH(mouse-event-coordinates)`: use [CSSOM View's double coordinate
  inputs](https://drafts.csswg.org/cssom-view/#extensions-to-the-mouseevent-interface),
  rather than Pointer Events' long inputs, and floor constructor screen/client
  coordinates as all three browsers do. Reject nonfinite values as required by
  double conversion (Chromium/Firefox; WebKit substitutes zero). Large finite
  values remain numbers without Firefox's int32 overflow. The legacy initializer
  keeps its specified long conversion, matching Chromium/Firefox rather than
  WebKit's flooring of negative fractions.
- `SPEC_CLASH(mouse-event-fractional-movement)`: keep Pointer Lock's double
  movement values like WebKit; Chromium/Firefox truncate synthetic movement.
- `SPEC_CLASH(mouse-event-legacy-buttons)`: preserve buttons, which the legacy
  initializer does not address, like Firefox/WebKit. Chromium clears it.
  All three preserve movement and replace the modifier snapshot.
- `SPEC_CLASH(mouse-event-which)`: derive unsigned-long which from button + 1,
  as UI Events describes and Chromium/Firefox do. Ignore constructor which.
  WebKit instead returns zero for negative buttons and fresh legacy events.
- Existing approved UIEvent reset/view and full modifier support rules carry
  through. `SPEC_CLASH(mouse-event-legacy-view)` records Firefox's Window view
  for factory-created events versus DOM/Chromium/WebKit's null.

`MouseEventImpl.layerX` and `layerY` are explicit throwing dependencies, with
TODOs naming the nearest positioned/stacking-context ancestor and CSS painting
geometry. Their layout algorithms, including synthetic-coordinate behavior,
are not implemented by this slice. CSSOM View's page/offset coordinates and x/y
aliases remain with that owner's extensions. Native mouse initialization,
hit testing, click counting, device/modifier state, movement-gap delivery, and
Pointer Lock remain explicit producer dependencies. No engine changes were made.

Fifteen new enabled MouseEvent tests pass in all six runtime configurations.
The complete 182-test interaction/DOM-event/binding/factory slice has 182 passes
on each addon build and 181 passes plus the existing WindowProxy unforgeable
descriptor expected failure on each stock build. No new expected failures or
skips were added. Type checks, type contracts, scoped lint, import boundaries,
and diff checks pass. The layer-coordinate stubs are excluded from the completed
behavior above; a passing constructor suite does not validate CSS geometry.

## Pointer Events §3.1: PointerEvent objects and orientation

This bounded slice implements [PointerEvent and PointerEventInit](https://w3c.github.io/pointerevents/#pointerevent-interface),
including inherited MouseEvent data, the constructor's copied coalesced/predicted
lists, and [§3.1.5's orientation conversion](https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle).
The four orientation dictionary members deliberately have no IDL defaults:
their presence determines whether to derive the other representation. Supplying
any member from each pair preserves explicit values and defaults the absent
members; it does not reconcile inconsistent supplied pairs.

The constructor does not register a device or infer hardware state. Explicit
pointer IDs, primary flags, pressure, dimensions, and pointer types are retained
after Web IDL conversion. Hardware ranges/defaults describe producer obligations;
they do not clamp author-created snapshots. All coordinates remain flat fields.

Binding supplies fresh mutable sequence arrays, retaining contained event
identities and their realms. Constructor lists are copied independently; neither
synthetic dispatch nor author redispatch rewrites child samples. getCoalescedEvents
is exposed only in secure contexts; getPredictedEvents is available in both.
This covers the author-created list behavior in [§9](https://w3c.github.io/pointerevents/#coalesced-and-predicted-events),
not native sample collection or prediction.

The manual browser-only `node-compat/experimental/input-delivery/pointer-event.mjs`
probe ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 on Windows.
Eric approved these choices:

- `SPEC_CLASH(pointer-event-coordinate-reinitialization)`: preserve fractions
  except for construction as click/auxclick/contextmenu, whose coordinates are
  floored under §3.3.12.2. All three agree at construction. Later initEvent calls
  retain that choice like Firefox/WebKit; Chromium recalculates it from the new type.
- `SPEC_CLASH(pointer-event-orientation-support)`: follow the draft and
  Chromium/Firefox's defaults and omitted-pair derivation. The probed WebKit
  lacks altitudeAngle, azimuthAngle, and persistentDeviceId and loses some
  explicit tilts. This is evidence for that build, not every WebKit platform.
- `SPEC_GAP(pointer-event-orientation-range)`: the draft leaves normalization
  of out-of-range constructor orientation unspecified. Preserve explicit fields
  and wrap only calculation inputs like Chromium; Firefox clamps altitude.
  Use bounded modulo operations, avoiding Blink's repeated-subtraction loops
  for very large finite inputs. Blink's pointer_event.cc and pointer_event_util.cc
  corroborate the pair-presence and normalization behavior.
- `SPEC_CLASH(pointer-event-list-realm)`: retain Binding's existing receiver-realm
  allocation, matching Chromium/WebKit. Firefox allocates arrays in the borrowed
  method's realm. All retain each contained event's identity.

Native production remains explicit in PointerEventImpl's TODOs: §§3.1.3–3.1.4
need capture and hit testing plus connection to the active state below;
§§3.2–3.3 need internal initialization/creation and firing/order algorithms;
§9 needs timestamp-ordered trusted samples and target propagation. Constructor
and accessor paths operate only on supplied data. DOM dispatch already
recognizes PointerEvent through its MouseEvent base; this does not implement
HTML's synthetic-pointer-event operation or CSS geometry.

Seventeen new PointerEvent tests pass on all six runtimes. The complete focused
199-test interaction/DOM-event/binding/factory suite has 199 passes on each addon
build and 198 passes plus the existing WindowProxy descriptor expected failure
on each stock build. No new expected failures or skips were added. Type checks,
type contracts, scoped lint, import boundaries, and diff checks pass.

## Pointer Events §3.1.3.1: internal event attributes

`PointerEventImpl.setPointerEventAttributes()` extracts attribute assignment from
[fire a pointer event](https://w3c.github.io/pointerevents/#firing-events-using-the-pointerevent-interface).
It takes one of the eleven event names in the attribute table and updates the
fresh event's type, bubbles, cancelable, composed, detail, and relatedTarget.
This reviewed extraction is not the complete firing operation.
The caller supplies pointer data and owns allocation and trust through
DOM's existing event creation. No Binding or addon change is needed.

Enter/leave neither bubble nor cross shadow roots and are not cancelable. Raw
updates, cancellation, and capture notifications bubble and are composed, but
cannot be canceled. Over/down/move/up/out bubble, are composed, and are cancelable.
All eleven types have detail zero. Boundary events keep the supplied opposite
target; capture notifications keep the triggering event's supplied relatedTarget.
Other types clear relatedTarget. The initializer leaves view, pointer data,
samples, timestamp, and trust unchanged. Constructors and author dispatch never
invoke it or substitute native defaults for author-supplied attributes.

Eric approved two continuing browser differences from the manual
`node-compat/experimental/input-delivery/pointer-attributes.mjs` probe:

- `SPEC_CLASH(pointer-rawupdate-cancelable)`: follow the draft and Chromium;
  Firefox 157.0 reports cancelable=true and accepts preventDefault() on raw
  updates. Chromium 156.0.8078.4 reports false and rejects cancellation. The
  WebKit 27.2 run did not deliver raw updates, so it supplies no evidence here.
- `SPEC_CLASH(pointer-event-detail)`: follow the draft and Chromium/Firefox's
  zero. WebKit 27.2 reports detail=1 for the probed pointerdown/pointerup pair.

The other observed table flags agree across the three browsers. Direct enter/leave
listeners were needed to observe those events consistently. Capture notifications
were observed in all three; pointercancel was driven only in Chromium using CDP.
Blink's PointerEventFactory::SetEventSpecificFields independently matches the
table's four scalar assignments. Browser observations are not Browlet test passes.

Remaining dependencies are kept beside the initializer and at the existing
PointerEvent/ActivePointer producer boundary:

- §3.1.3 still needs hit testing or capture-target selection, active-document
  updates, implicit capture, previous-target repair, and boundary event ordering.
- The §3.1.3.2 slice below now supplies pending capture and notification copying.
  §8's public capture requests, implicit capture/release, and lifecycle hookup
  still need the input producer.
- §10's optional compatibility mouse mapping owns suppression after canceled
  pointerdown. §11's Mouse Events and their HTML owners supply default actions.
  Exposing cancelability does not implement those actions. Viewport panning and
  zooming are controlled separately by §7 touch-action, not event cancellation.
- The input producer still needs context-local IDs, normalized device samples,
  target/view selection, and user-interaction task delivery. There is no native
  adapter or automation input command connected by this slice.

The enabled attribute tests use real DOM creation, Binding projection, and
dispatch to check all eleven types, cancellation, retained/cleared related targets,
pointer-data preservation, shadow boundaries, and author construction/redispatch.
This tests attribute preparation and dispatch, not a complete input sequence.

All 25 new tests pass in all six runtime configurations. The focused 16-file
interaction/DOM-event/binding/factory suite has 247 passes on each addon build
and 246 passes plus the existing WindowProxy descriptor expected failure on each
stock build. No new expected failures or skips were added. Typecheck, type
contracts, scoped lint, import boundaries, and diff checks pass.

## PointerEvent initialization and creation implemented

Pointer Events §§3.2.1–3.2.2 now have `initializePointerEvent()` and
`PointerEventImpl.create()`. Their reached MouseEvent initializer is implemented
as `initializeMouseEvent()`, using the existing UIEvent/DOM initialization path.
It supplies target/view, input coordinates, held buttons, modifier state, and
zeroed relative motion. Pointer initialization then resets pointer-specific data
and replaces the coalesced/predicted lists with empty lists. It preserves fractional
coordinates except for click/auxclick/contextmenu, matching the existing constructor rule.

The three callable signatures add a required final `MouseEventInput` argument.
The draft reads current coordinates, a mouse-button bitmask, and key-modifier
state implicitly. Browlet passes a normalized snapshot with required screen/client
coordinates, buttons, and an `EventModifierState`. Native input and CSSOM View must
eventually supply these values; no zero-input fallback or ambient device lookup
is installed. The target is a Node or Window, following the already reviewed
UIEvent initializer contract. These explicit-input signatures were reviewed and accepted.

The native modifier algorithm sets altKey for either Alt or AltGraph while
preserving the distinct flags exposed by `getModifierState()`. Constructor and
legacy initialization keep their explicit altKey input; copied events retain the
source's choice. No platform declaration or generated type changes are needed.

Creation uses the target's existing environment event factory, retaining Binding's
realm-owned identity and timestamp. An adopted target's current Document selects
`view` independently of that allocation realm. As with the reviewed UIEvent
initializer, the linked DOM initialization clears `isTrusted`: creation returns
an initialized event, and the producer must establish trust before dispatch.
This slice does not dispatch, infer type-specific firing flags, register an active
pointer, or manufacture device input. Existing stream/capture notification paths
already retain their copied input and trust and do not need this reset operation.

Coverage in [pointer-event-initialization.test.ts](../../../../test/browlet/interaction/events/pointer-event-initialization.test.ts)
uses real bindings for field reset, preserved sample identities, native AltGraph,
coordinate rules, explicit flags, fresh identities/timestamps, adoption, Window
targets, and producer/author dispatch trust.

Validation: all 17 new cases pass on Node 24.19.0, 26.8.1, and custom Node,
with and without the addon. The focused 21-file interaction/DOM run has
367 passes on each addon build and 366 passes plus the existing WindowProxy
descriptor expected failure on each stock build. No new expected failures or
skips were added. Typecheck, type contracts, scoped lint, import boundaries,
and diff checks pass.

## PointerEvent creation from MouseEvent implemented

[§3.2.3](https://w3c.github.io/pointerevents/#dfn-create-pointerevent-from-mouseevent)
now has `PointerEventImpl.fromMouseEvent(type, source, bubbles, cancelable)`.
It takes the source's already-selected Node or Window target, allocates through
that target's environment, and initializes a fresh event. A missing target or a
generic EventTarget is an explicit producer-precondition error before allocation,
consistent with the existing UIEvent initializer's node-document requirement.

Only mouse/UI input data is copied: view, detail, coordinates, movement, buttons,
relatedTarget, and modifiers, including the native AltGraph/altKey distinction.
The new event retains its own creation timestamp in the target realm. This avoids
copying a source timestamp measured against a different realm's time origin.
The base copier still retains triggering timestamps for its existing notification
callers; this creation algorithm restores the newly allocated event's timestamp.
Pointer fields remain at their defaults and sample lists remain empty, even when
the source is a PointerEvent. Click/auxclick/contextmenu retain their specified
coordinate rounding. Trust, composed, cancellation, and dispatch state are not
copied; the producer still owns trust and the subsequent firing steps.

SPEC_GAP(pointer-from-mouse-flags): the draft omits the required bubbles/cancelable
arguments when calling its initializer. Eric approved requiring both from the
caller, matching the existing `create()` contract. This avoids assuming that a
mouse event's flags also describe the resulting pointer-event type.

The browser source comparison supports keeping flag selection separate from
input copying; these are native producer implementations, not an author-facing
conversion API that can be directly tested in a page:

- [Blink PointerEventFactory](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/events/pointer_event_factory.cc)
  uses `SetEventSpecificFields()` to select flags from the pointer type.
- [WebKit PointerEvent](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/PointerEvent.cpp)
  has MouseEvent-based creation with type-derived flags and an overload receiving
  bubbles/cancelable explicitly. Its constructor copies mouse input separately.
- [Gecko pointer conversion](https://github.com/mozilla-firefox/firefox/blob/main/dom/events/PointerEventHandler.cpp)
  uses [WidgetPointerEvent's native copy constructor](https://github.com/mozilla-firefox/firefox/blob/main/widget/MouseEvents.h),
  which retains the mouse record's flags before changing its class and message.
  Its separate pointer-class defaults therefore do not establish a rule for this
  targeted DOM-event conversion. These native structures carry input timing and
  device metadata beyond the draft's default-pointer recipe.

The helper creates no active source, capture request, task, or notification.
Native input and HTML synthetic-pointer firing remain separate integration work.
Coverage in [pointer-event-from-mouse.test.ts](../../../../test/browlet/interaction/events/pointer-event-from-mouse.test.ts)
exercises real bindings, all explicit flag combinations, defaults/samples,
coordinate rounding, modifier lifetime, foreign source clocks, Window targets,
invalid-target rejection, and conversion during DOM dispatch.

Validation: all 15 new cases pass across Node 24.19.0, 26.8.1, and custom Node,
each with and without the addon. The focused 22-file run has 382 passes per addon
build and 381 passes plus the existing WindowProxy descriptor expected failure
per stock build. An initial parallel Node 26 addon run timed out in the existing
user-activation suite; that file and the entire focused run passed when rerun
alone, without changing timeouts or test classification. Typecheck, type contracts,
scoped lint, import boundaries, and diff checks pass.

## Pointer Events §5: GlobalEventHandlers

[§5](https://w3c.github.io/pointerevents/#extensions-to-the-globaleventhandlers-mixin)
now contributes eleven handler attributes through a separate partial mixin in
`pointer-event-handlers.ts`. The declaration reuses HTML's `eventHandlerMapAttr()`;
its supported-name table is composed once into each includer's existing table.
Window, Document, HTMLElement, SVGElement, and MathMLElement share their existing
callback conversion, listener activation, lazy content compilation, CSP checks,
and erasure paths. Body/frameset pointer handlers remain local, unlike their
specified Window-forwarding handlers. Base Element and foreign-namespace
elements gain no handler properties. HTML's content-attribute permission check
also recognizes the Pointer Events contribution.

The browser-only `node-compat/experimental/input-delivery/pointer-event-handlers.mjs`
probe exercised Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 on HTTPS and
HTTP. All three agree on the ten ordinary handlers, their includers, callback
identity, receiver, false-return cancellation, and local body/frameset behavior.
Eric approved `SPEC_CLASH(pointer-rawupdate-handler-exposure)`: implement the
draft/Chromium/Firefox raw-update handler; WebKit implements neither its IDL
property nor its content attribute in this build.

`[SecureContext]` hides only the `onpointerrawupdate` IDL property on insecure
globals. Chromium/Firefox still compile its content attribute and invoke it for
an author-dispatched Event, which Browlet now also does. An independently assigned
same-named JavaScript expando does not become a registered handler. Native raw
delivery keeps its existing target-document secure-context restriction. No new
dispatch path, callback factory, source registration, or native-input assumption
is introduced here. Blink's `global_event_handlers.idl` and Gecko's
`EventHandler.webidl` corroborate secure property exposure; Blink's ordinary
`HTMLElement` attribute table separately recognizes the raw content attribute.

Thirteen focused tests in
[pointer-event-handlers.test.ts](../../../../test/browlet/interaction/events/pointer-event-handlers.test.ts)
cover all includers and event names, secure exposure and branding, content
attributes and removal, insecure expandos, CSP, borrowed accessors, native
capture delivery, erasure, and HTML attribute permissions. All 13 pass on custom
Node, Node 24.19.0, and Node 26.8.1, with and without the addon, without expected
failures or skips.

The broader 28-file interaction, handler, binding, and HTML-attribute run passes
all 476 cases on custom Node with the addon. Typecheck, type contracts, scoped
ESLint, import boundaries, and diff checks pass. The prototype and content-attribute
inventories now reflect the added handlers.

## Pointer Events §11.1 and §§11.2.1–11.2.9: MouseEvent creation

The MouseEvent interface and the first nine algorithm subsections are audited
against the already implemented event foundation. The remaining addition is
`MouseEventImpl.create(type, target, bubbles, cancelable, input)`, which reuses
`initializeMouseEvent()` and the target's existing realm-owned event allocation.
The draft's [cancelable creator](https://w3c.github.io/pointerevents/#dfn-create-a-cancelable-mouseevent)
uses true/true flags; its [non-cancelable creator](https://w3c.github.io/pointerevents/#dfn-create-a-non-cancelable-mouseevent)
uses false/false. One explicit-flag factory covers both, matching
`PointerEventImpl.create()`; that derived factory is now an explicit override.
The explicit-flag callable shape was reviewed and accepted.

| Section | Implementation and boundary |
| --- | --- |
| §11.1 MouseEvent interface | Existing bindings supply the interface, dictionary, modifier query and legacy initialization. The approved coordinate and legacy conflicts remain. `layerX`/`layerY` still throw at their explicit CSS layout/painting dependencies. |
| §11.2.1 Native OS requirements | The input producer must supply normalized coordinates, modifiers and button state. Click/double-click recognition and thresholds are still native-input work, not inferred by this factory. |
| §11.2.2 Constructing Mouse Events | Existing constructor and EventModifierState retain the declared modifier snapshot through real Binding conversion. |
| §11.2.3 Global state | UserAgent's active sources already retain source button state; the native mouse producer must provide the aggregate mouse mask in `MouseEventInput.buttons`. Window-native delivery and its target/path bookkeeping remain with the later native handlers. The existing Document-owned compatibility mouse state is unchanged. |
| §11.2.4 Internal state | EventModifierState owns the key flags. Native altKey combines Alt/AltGraph while the queried states stay distinct. |
| §11.2.5 Hit test | CSSOM View/layout geometry remains explicit through the stream's required hit-test callable, including inert/disabled filtering. Creation takes an already selected target. |
| §§11.2.6–11.2.7 Initialization and modifiers | Existing initialization uses required MouseEventInput, UIEvent/DOM reset, coordinate rounding, held buttons, native modifiers, and zeroed movement. |
| §§11.2.8–11.2.9 Creation | The new factory allocates the MouseEvent itself, initializes it, and returns it without dispatch. |

The required final input parameter follows the reviewed PointerEvent initialization
contract: coordinates and device state are supplied, not read from ambient globals.
Node and Window targets retain the existing UIEvent contract. Target allocation
realm and current Document view remain distinct after adoption. Creation gets a
fresh timestamp and platform identity. The linked DOM initialization clears trust,
as in the existing PointerEvent factory, so native producers must establish it
and event-specific fields before dispatch. Author construction is unchanged.

This slice stops before §11.2.10's native button mapping and the later native
dispatch algorithms. It does not introduce another input adapter, add Window
state speculatively, or replace the completed §10 compatibility-mapping path.
The latter retains the triggering input's timestamp and uses its separate
`fromPointerEvent()` factory. Layout getters and required normalized-input/hit-test
arguments keep reached dependencies explicit in code.

The focused `mouse-event-creation.test.ts` exercises both flag variants, native
modifiers, input snapshot retention, target-realm allocation and timestamps,
adoption, Window targets, and producer/author dispatch trust through real bindings.
All seven new cases and the 89-test MouseEvent/PointerEvent creation and
compatibility-mapping run pass on Node 24.19.0, Node 26.8.1, and custom Node 27,
each with and without the addon. These runs have no expected failures or skips.
Typecheck, type contracts, scoped lint, import boundaries, and diff checks pass.

## Pointer Events §12.1: WheelEvent

`WheelEventImpl` extends MouseEvent in this event foundation. Its declarations
supply the Window constructor, inherited MouseEventInit conversion, three delta
unit constants, double-valued deltaX/Y/Z, unsigned-long deltaMode, and momentum.
Binding supplies timestamps, readonly accessors, receiver checks, realm-owned
errors, and subclass construction. No new native hooks or event-dispatch path
are needed.

Author construction does not infer trusted wheel flags or convert the supplied
units. Inherited initEvent/initUIEvent/initMouseEvent preserve wheel-specific
fields. DOM's legacy createEvent table has no WheelEvent entry; all three browsers
also reject the singular/plural names, and no initWheelEvent is added.
Existing onwheel handlers and DOM passive-listener cancellation rules apply.

The browser-only probe is
`node-compat/experimental/input-delivery/wheel-event.mjs`; run it with
`node input-delivery/wheel-event.mjs` from Experimental. Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2 agree on defaults, full double precision, nonfinite
delta rejection, constants, inherited initialization, and borrowed getter brands.
Eric approved these choices on 2026-11-04:

- `SPEC_CLASH(wheel-event-delta-mode)`: follow the constructor's unsigned-long
  IDL and all three browsers, accepting converted values outside 0/1/2. The
  prose says deltaMode must be a DOM_DELTA constant; native input must select
  one of those units, without restricting arbitrary author construction.
- `SPEC_CLASH(wheel-event-momentum)`: expose the draft's boolean field, as
  Chromium does. Firefox/WebKit do not yet expose it.
- `SPEC_CLASH(wheel-event-negative-zero)`: retain negative zero under Web IDL
  double conversion, as Firefox does. Chromium/WebKit normalize the probed deltaX
  to positive zero; this probe did not establish every axis.

Native delivery is covered by the following §12 slice. Author construction and
synthetic dispatch do not enter that producer or request scrolling/zooming.

Validation: all 15 new WheelEvent tests pass on custom Node, Node 24.19.0, and
Node 26.8.1, each with the addon disabled and enabled. With the existing MouseEvent
and UIEvent tests, each configuration passes 49 tests, with no expected failures
or skips. Project typecheck, targeted lint, and import-boundary checks pass.

## Source questions to resolve when reached

SPEC_CLASH(ui-events-focus-order-tables): the main and legacy focus-order tables disagree.

The [main table](https://w3c.github.io/uievents/#events-focusevent-event-order)
orders focus before focusin and blur before focusout. The
[legacy table](https://w3c.github.io/uievents/#legacy-focusevent-event-order)
orders focusin before focus and focusout before blur. No focus producer is being
chosen in this audit. Check HTML's focus update steps and browser evidence, then
review the conflict with Eric before connecting that producer.

## HTML §8.1.8.3: synthetic pointer and click firing

Reviewed [HTML's event-firing subsection](https://html.spec.whatwg.org/multipage/webappapis.html#event-firing)
on 2026-11-05 at local revision 5955a33, refreshed from upstream. Pointer Events
was also refreshed and remains at 7affe62. Element.fireSyntheticPointerEvent()
implements the named operation; fireClick() calls it with click and default trust.
Both return DOM dispatch's cancellation result. This actor-to-instance placement
keeps PointerEvent above DOM's generic EventTarget machinery without adding a
registry, environment service, input processor, or second dispatcher.

The event is allocated through the current node Document, including after adoption.
Its creation realm supplies its timestamp and platform object; the element retains
its own original realm. Bubbles, cancelable, and composed are true; the optional
not-trusted flag clears the creation operation's default trust. The current
UserAgent keyboard snapshot supplies all modifier states. No input device has
reported state initially, so every modifier is false. Native AltGraph-to-altKey
mapping remains in native MouseEvent initialization; synthetic firing describes
Alt and AltGraph independently. The immutable snapshot survives later device input
and reentrant firing without a per-event copy.

The node Document supplies view, including for a detached element; a Document
without a browsing context supplies null. Pointer Events' reserved non-pointer
identity is -1 with an empty pointerType. Other pointer and mouse fields retain
their specified defaults. No pointer stream is registered, no mouse position is
updated, and no keyboard event is fabricated. DOM dispatch continues to own
shadow retargeting, listeners, cancellation, and click activation.

Eric approved the following evidence-based choices. The browser-only
[probe](../../../../node-compat/experimental/input-delivery/synthetic-pointer.mjs)
and [findings](../../../../node-compat/experimental/input-delivery/SYNTHETIC-POINTER.md)
use public HTMLElement.click() and browser keyboard activation to observe the
internal operation; they do not claim that Browlet exposes HTMLElement.click().

- SPEC_CLASH(synthetic-pointer-modifiers): HTML requires current device state for
  both trusted and untrusted firing. All three browsers clear modifiers for
  HTMLElement.click(), including from a keydown listener; Firefox also omitted
  Shift on the probed keyboard activation. Follow HTML and the approved current
  UserAgent state. Real OS key mapping remains the adapter's responsibility.
- SPEC_CLASH(synthetic-pointer-detached-view): Firefox gives detached elements a
  null view. Follow HTML and Chromium/WebKit's node-Document Window, while all
  three give an inert Document null. All three allocate adopted-target events in
  the current Document's realm and use its Window.
- Existing SPEC_CLASH(pointer-activation-defaults): retain the specified defaults
  as Chromium does; Firefox/WebKit set isPrimary=true. WebKit also supplies target
  coordinates on keyboard activation, while HTML leaves them at their defaults.
  All three use pointerId=-1 and pointerType empty.

This completes the local §8.1.8.3 operation and is Vin's consolidation checkpoint.
HTML §6.5 still owns HTMLElement.click()'s disabled-form-control check and
click-in-progress guard; its declaration remains an explicit TODO rather than an
incomplete public method. KeyboardInputProcessor.applyDefaultAction() still
throws until key eligibility, focus, and element activation policy are implemented;
eligible non-pointer callers will use fireClick(). Concrete control/link actions
remain with their HTML implementations. Synthetic firing itself needs neither
layout nor an OS adapter, and does not perform those missing effects.

Validation: all 287 cases in 19 event/keyboard/DOM suites pass on Node 24.19.0,
26.8.1, and custom, each in stock and compat mode; no expected failures or skips.
The ten new cases cover trust/defaults, named firing, cancellation/activation,
shared modifier snapshots, reentrancy, AltGraph, cross-realm adoption, inert and
detached targets, and closed-shadow dispatch. Typechecking, declaration contracts,
scoped ESLint, import hierarchy, and diff checks complete the slice.
