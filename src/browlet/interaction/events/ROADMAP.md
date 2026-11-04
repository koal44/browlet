# Interaction events roadmap

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
its full algorithm audit is still ahead.
The Input Events reference was cloned on the same date and inspected for its
InputEvent partials, inputType vocabulary, and editing/IME producer boundary;
this does not constitute an audit of that whole specification.
The key/code references were cloned on the same date and inspected for value
selection, modifier/layout distinctions, and virtual-keyboard requirements;
their device-specific mappings remain input-producer work.
Pointer Lock was cloned on the same date for its movement fields, native-input
gaps, and locked-coordinate requirements; its acquisition/release API is not
part of this UI Events audit.

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
| §4: keyboard input and values | Audited below with a five-case browser probe. Key/code mapping, modifier transitions independent of cancellation, and dead-key/IME processing require the input producer; synthetic constructors retain their supplied strings. Virtual-keyboard code guidance conflicts with the companion vocabulary. |
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

## Input producer direction

Node's [readline keypress API](https://nodejs.org/api/readline.html#readlineemitkeypresseventsstream-interface)
and [TTY raw mode](https://nodejs.org/api/tty.html#readstreamsetrawmodemode) provide
terminal input, not a browser window's complete keyboard/pointer/IME input
contract. V8 executes the author handlers; the embedder supplies device input.

Use one input-processing path when those algorithms are reached. Tests or a
headless automation caller can supply explicit key/pointer actions to that path;
an eventual window-system adapter can supply real device actions. Queue the work
through the owning event loop and its user-interaction task source, then apply
the specified focus/target selection, input-state updates, event dispatch, and
default actions in order. Author-created events still use ordinary dispatch and
do not impersonate this host input path.

A native window adapter may use an existing OS/windowing library or external
host process; that is separate from changing Node/V8 or our execution addon.
The exact adapter and input API are undecided until a concrete consumer needs
them. Coordinate-based pointer input still needs real hit testing; a test-supplied
target does not complete that dependency.

The [input-delivery investigation](../../../../node-compat/experimental/input-delivery/README.md)
traces Chromium/Firefox/WebKit production and automation paths. Its browser-only
probe passes six cases in all three engines: driver input performs trusted input
and default actions that author event dispatch does not reproduce. Add a small
programmatic driver alongside the first input producer and use the same scenario
intentions against real browsers. Current Browlet automation has no input-action
implementation; full WebDriver transport is not a prerequisite for this test seam.
Keep physical keys, committed text, and composition updates distinct. A physical
key need not produce text, and text can arrive without a key press. Preserve
coordinate spaces and scale, wheel delta units, repeat/modifier information, and
the selected viewport until the owning algorithm translates them. IME integration
also needs a return path for surrounding text, selection, and caret placement;
it is not just a stream of keyboard events.

Qt and Slint remain candidates for an optional native-window adapter. Neither is
selected or installed. Their Node/event-pump integration belongs at that host
boundary; event implementations must not depend on their input object types.

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

Seventeen enabled [KeyboardEvent tests](../../../../test/browlet/interaction/events/keyboard-event.test.ts)
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
  input adapter and HTML/Input Events owners identified in §3.6 above.
- [UIEvents-Key §2.2](https://w3c.github.io/uievents-key/#key-attr-values) selects
  named keys or effective text, accounts for non-glyph modifiers, and falls back
  to Unidentified. Its NFC requirement applies to produced key strings. Author
  construction continues to preserve converted DOMStrings, including unknown
  names and decomposed text; it has no device/layout mapping step.

The source-side TODOs in [keyboard-event.ts](keyboard-event.ts) identify these
requirements. There is still no device-input entry point: a shared keyboard
producer can be implemented with explicit automation input before selecting a
native GUI library, but focus selection, editing, activation, and IME effects
must call their named owners. This audit does not implement those missing steps.

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

- Pointer Events' "initialize a MouseEvent" must call the movement initializer;
  "handle native mouse move" must run the Window operation before dispatch.
  The MouseEvent constructor/dictionary and Pointer Lock movement partials are
  now connected by the prerequisite slice below. Source TODOs identify the
  still-missing native initializer and caller boundary.
- Ordinary DOM dispatch and author constructors must not run the Window
  operation or replace explicitly supplied movement values. The generic
  EventTarget path remains independent of native input history.
- Pointer Lock §6 requires the producer to clear lastMouseMove when native input
  is interrupted, so the next move is zero. Tests supply that gap notification;
  an OS/input-adapter hookup is still missing.
- Locked screen coordinates are frozen, and clipped/raw motion can differ from
  coordinate subtraction. Those producers need native deltas and must not use
  this unlocked-coordinate recipe. Lock acquisition/release, raw motion, and
  pointermove production remain with Pointer Lock/Pointer Events.

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

## Pointer Events §§3.1.1–3.1.2: button and primary-pointer state

`UserAgent.activePointers` owns the active input sources in `interaction/pointer.ts`.
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

## Pointer Events §3.1.3.2: pending capture and notifications

`PointerCapture` in `interaction/pointer-capture.ts` owns the pending and effective
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

The enabled `test/browlet/interaction/pointer-capture.test.ts` tests supply
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

`PointerEventStream` in `interaction/pointer-event-stream.ts` composes an assigned
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

`PointerEventStream.dispatchToTarget(event, target, getHoverTarget)` completes delivery of a
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

`clearDisconnectedTarget()` is the explicit removal-owner operation. As with
capture cleanup, it must be called during removal before reinsertion; checking
connectivity at the next dispatch cannot reconstruct a missed remove/reinsert.
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
[pointer-boundary.test.ts](../../../../test/browlet/interaction/pointer-boundary.test.ts)
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
[pointer-event-stream.test.ts](../../../../test/browlet/interaction/pointer-event-stream.test.ts)
compose real UserAgent source state, target preparation, and realm-owned DOM
dispatch. They cover mouse/pen chords and canceled/passive touch down delivery.
Canceling down reports failure to the caller without reverting button state or
implicit capture; the subsequent release still dispatches up and releases capture.

The note about `PREVENT MOUSE EVENT` belongs to the optional compatibility mapper
defined in [§§10.2–10.3](https://w3c.github.io/pointerevents/#compatibility-mapping-with-mouse-events).
That owner must consume a canceled primary down, retain the flag per pointerType,
suppress mapped down/move/up, and clear it after up/cancel. It must preserve mouse
boundary events and click/auxclick/contextmenu. The TODO at `dispatchToTarget()`'s
return now identifies those exact requirements. Native input normalization,
source-to-stream composition, compatibility mapping, and default actions remain
explicit future owners; this audit adds no new runtime behavior.

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
[pointer-motion.test.ts](../../../../test/browlet/interaction/pointer-motion.test.ts)
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
notifications. It must connect individual Document teardown and supply the
Pointer Lock owner's required query. No default unlocked state or device
registration is inferred from author construction/dispatch. The shared map makes
these APIs callable once input is supplied; it is not a native input pipeline.

Seventeen tests in
[pointer-capture-api.test.ts](../../../../test/browlet/interaction/pointer-capture-api.test.ts)
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
[pointer-event-handlers.test.ts](../../../../test/browlet/interaction/pointer-event-handlers.test.ts)
cover all includers and event names, secure exposure and branding, content
attributes and removal, insecure expandos, CSP, borrowed accessors, native
capture delivery, erasure, and HTML attribute permissions. All 13 pass on custom
Node, Node 24.19.0, and Node 26.8.1, with and without the addon, without expected
failures or skips.

The broader 28-file interaction, handler, binding, and HTML-attribute run passes
all 476 cases on custom Node with the addon. Typecheck, type contracts, scoped
ESLint, import boundaries, and diff checks pass. The prototype and content-attribute
inventories now reflect the added handlers.

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

[`DirectManipulation`](../direct-manipulation.ts) implements
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

## Next in document order

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
target maintenance are implemented up to the producer dependencies above. Continue
with §10's compatibility mapping with mouse events. Stream registration/retirement
and previous-boundary-target removal notification remain explicit integration work.
Those steps must consume active source
state and expose any reached targeting/input dependencies explicitly in code;
the MouseEvent geometry dependencies remain explicit. Editing and selection producers
remain with their HTML/Input Events/Selection API owners. Complete HTML §6.6
before claiming focus-event production, including the main/legacy focus-order
conflict below.

As each producer is implemented, any reached dependency must be a named callable
operation in code with its owning specification reference and an explicit
unfinished path. This inventory alone does not satisfy a dependency reached by
runtime code. Do not invent an unconnected set of stubs for the whole draft now.

## Source questions to resolve when reached

SPEC_CLASH(ui-events-focus-order-tables): the main and legacy focus-order tables disagree.

The [main table](https://w3c.github.io/uievents/#events-focusevent-event-order)
orders focus before focusin and blur before focusout. The
[legacy table](https://w3c.github.io/uievents/#legacy-focusevent-event-order)
orders focusin before focus and focusout before blur. No focus producer is being
chosen in this audit. Check HTML's focus update steps and browser evidence, then
review the conflict with Eric before connecting that producer.
