# User interaction roadmap

HTML §6 combines several independent interaction systems. Keep their shared
cross-document state under `interaction/`, but do not turn the chapter into one
large manager or make input, editing, and drag-and-drop prerequisites for the
Document lifecycle.

## Organization and dependency boundaries

| Owner | Scope |
| --- | --- |
| [events](events/ROADMAP.md) | Shared event classes, modifier snapshots, creation algorithms, and Web IDL declarations. |
| [keyboard](keyboard/ROADMAP.md) | UserAgent keyboard input queue and modifier state, key selection, and key/code vocabularies. |
| [mouse](mouse/ROADMAP.md) | UserAgent input delivery, with lower-level Document compatibility state in mouse/legacy. |
| [pointer](pointer/ROADMAP.md) | Active sources, per-context streams, capture, and direct-manipulation decisions. |
| [pointer-lock](pointer-lock/ROADMAP.md) | UserAgent lock state, host operations, declarations, and lifetime integration. |
| [wheel](wheel/ROADMAP.md) | Document-owned input queue and retained gesture target. |
| [selection](selection/ROADMAP.md) | Document selection, live ranges, and change notifications. |
| [drag-drop](drag-drop/ROADMAP.md) | DataTransfer store access, items, Files, and queued string reads; native dragging and image feedback remain explicit. |
| [clipboard](clipboard/ROADMAP.md) | ClipboardEvent and ClipboardChangeEvent data/synthetic delivery; §5.2.1 native change notifications remain next. |

Folders follow feature ownership; their dependency levels remain explicit in the
import hierarchy. Document imports mouse/legacy/index directly so constructing its
compatibility state does not load the mouse input coordinator. Shared event classes
stay below DOM nodes. Mouse delivery consumes the pointer component. Root index.ts
composes existing exports; focus.ts remains the small shared focusable-area type.
Tests use the same topic groups. Detailed specification evidence and unfinished
work live in the owning roadmaps, with the overall sequence retained here.

## Constraints to preserve early

- Page visibility is mutable Document state initialized from the top-level
  traversable's system visibility state. Visibility transitions must run one
  ordered integration algorithm, fire `visibilitychange`, and create a
  `VisibilityStateEntry`; they are not inferred from whether a Window exists.
- A Window owns last-activation and last-history-action-activation timestamps.
  Activation notification and consumption operate across related navigables,
  so a process-global or element-local `isActive` boolean cannot implement the
  model.
- User activation and element activation are different systems. DOM event
  dispatch needs a narrow activation-behavior hook, while HTML elements own
  the action that hook invokes; neither should be encoded as a synthetic
  `click()` listener.
- HTML §7.3.3 forbids user interaction with child navigables whose container
  Documents are not fully active. The future input-targeting and delivery
  pipeline must use `Document.isFullyActive()`; checking only the parent
  navigable's current Document loses retained inactive ancestors. Task
  runnability already checks full activity, but does not implement input
  targeting. Programmatic DOM dispatch follows its own specified rules.
- Focus is a chain through focusable areas, Documents, shadow trees, child
  navigables, and the top-level traversable. `activeElement`, `hasFocus()`,
  autofocus, and Window focus must derive from that shared model rather than
  maintain independent answers.
- Inertness is a shared predicate consumed by focus, event targeting, text
  selection, find-in-page, editing, and accessibility. The `inert` and
  `hidden=until-found` attributes must not be approximated as CSS-only state.

Visibility initialization is reached by the current navigable skeleton and
should be connected while completing lifecycle. User activation enters before
activation-gated navigation or popup behavior; cross-document focus enters
with nested browsing. The rest of this chapter can wait for interaction work.

DOM event dispatch already provides overridable activation methods.
Section 6 work supplies the HTML element behaviors, commands, and
user-activation consequences.

## UI and pointer event production

The [UI Events audit](events/ROADMAP.md) places the event hierarchy and bindings
in `interaction/events/`, above DOM's shared Event/EventTarget machinery and
below input producers. Input processing belongs here, with state retained by
the specified Window, Document, or UserAgent owner.
Synthetic construction and dispatch do not themselves supply native input,
focus changes, editing, pointer capture, or scrolling.

UserAgent.keyboardInput now accepts normalized key transitions through the
[queued keyboard coordinator](keyboard/ROADMAP.md#queued-keyboard-delivery-2026-11-05).
It captures modifier/layout facts before task delivery, selects current focus for
each event, and gates ordinary keydown effects on cancellation. Existing Document
focus stubs and named activation/default-action/IME operations remain explicit.

`MouseInputProcessor` now provides normalized button and movement entries through
UserAgent, using real user-interaction tasks and existing pointer/mouse delivery.
An explicit adapter flag delivers qualifying click/auxclick immediately after
the release in the same task, retaining each button's press/release target.
An independently supplied double-click flag follows the primary click with a
MouseEvent at that same target; recognition remains with the adapter.
Movement delivers secure raw input before pointermove and mapped mousemove,
updating Window motion once. Button and movement actions retain receipt-time
state/timestamps; events translate that shared time into their creation realms.
An explicit context-menu flag selects press or release timing. Trusted dispatch
and cancellation precede the native menu request and any qualifying click.
It queries the UserAgent's Pointer Lock state and calls explicit throwing
dependencies for layout targeting, HTML activation/focus, and native menu UI.
Its focused tests control these owners; physical mouse input, real focus, and
a native menu are not claimed.
See the [button-input slice](mouse/ROADMAP.md#pointer-events-1121011213-mouse-button-input)
and [native-click slice](mouse/ROADMAP.md#pointer-events-1121411215-native-clicks)
plus [native movement](mouse/ROADMAP.md#pointer-events-11217-native-movement)
and [context menus](mouse/ROADMAP.md#pointer-events-11218-mouse-context-menus)
for the boundary and next algorithms.

The [§§11.3–11.4 audit](mouse/ROADMAP.md#pointer-events-113114-mouse-order-and-event-type-audit)
closes the mouse-delivery pass at its explicit owner dependencies. §12 now
provides WheelEvent construction and Document-owned queued wheel delivery.
The adapter supplies normalized measurements and explicit gesture boundaries;
transactions retain their initial target, observe DOM listeners for cancelability,
and request default actions only after uncanceled dispatch. Named operations throw
until hit testing and scrolling/zooming are connected. Its lock query now reads
UserAgent's Pointer Lock controller.
See the [wheel-input slice](wheel/ROADMAP.md#pointer-events-12-wheel-input-and-transactions).
The [closing audit](pointer/ROADMAP.md#pointer-events-1316-closing-audit) is complete;
legacy initialization was already implemented. It also connects the missing
previous-pointer-target repair to DOM removal.
[Individual Document cleanup](pointer/ROADMAP.md#document-lifetime-integration)
now clears retained pointer state through the existing Document.destroy() hook.
The identified local pointer/wheel plumbing is complete. Recursive/inactive
destruction remains HTML §7.5.10 work, separate from the unfinished input/layout owners.

The first visible dependencies are HTML §6.6's focus model; HTML §6.8 editing,
Selection API and Input Events; keyboard layout/modifier input and IME behavior;
and HTML §6.5 element activation. FocusEvent and KeyboardEvent constructors can
be implemented before those producers. Actual default actions must call their
owners rather than approximate the effect in an event listener.

Pointer Events additionally needs hit testing and coordinate geometry from
CSSOM View/layout, computed touch-action and pointer-events values from CSS,
scrolling/zooming, and device-input timing. Pointer capture methods belong on
Element, backed by shared active-pointer state. Panning and zooming follow
touch-action rules, not a general pointer-event cancellation shortcut. Keep these
dependencies explicit at the algorithms that consume them; this audit does not
claim that the CSS, layout, or input implementations are already available.

The [§7.3.3 audit](../browsing/navigation/ROADMAP.md#html-733-fully-active-documents)
covers the activity predicate and existing consumers. The normalized mouse input
processor above is connected; physical input adapters and WebDriver input commands
remain explicit consumer dependencies.

## Planned ownership

| Planned source or owner | Contract | Specification |
| --- | --- | --- |
| `visibility.ts` plus `performance/visibility.ts` | Document visibility state, initial/update steps, `visibilitychange`, and `VisibilityStateEntry` | HTML §6.2 |
| `inertness.ts` plus `html/global-attributes.ts` | Inert subtrees, modal blocking, `inert`, and `hidden=until-found` integration | HTML §§6.1 and 6.3 |
| `user-activation.ts` | Window activation timestamps, notification/consumption propagation, `UserActivation`, the Navigator contribution, and automation hooks | HTML §6.4 |
| `activation.ts` | HTML element activation behavior, command/invoker resolution, and use of the existing DOM click-dispatch hook | HTML §6.5 |
| `events.ts` | `ToggleEvent`, `CommandEvent`, and their initialization dictionaries | HTML §6.5 |
| `focus.ts` | Focusable-area model, focus chains, `tabindex`, `FocusOptions`, `activeElement`, `hasFocus()`, autofocus, and Window/element focus APIs | HTML §6.6 |
| `access-key.ts` | `accesskey`, label selection, assignment, and invocation | HTML §6.7 |
| `editing.ts` plus `html/global-attributes.ts` | `ElementContentEditable`, editing hosts, selection/editing commands, spellcheck, writing suggestions, autocapitalization, autocorrection, `inputmode`, and `enterkeyhint` | HTML §6.8 |
| `find.ts` | Find-in-page, `hidden=until-found`, details/dialog interaction, and selection updates through a user-agent search capability | HTML §6.9 |
| `close-watcher.ts` | Window close-watcher manager, internal watcher records, `CloseWatcher`, activation gating, abort integration, and close/cancel events | HTML §6.10 |
| `drag-drop/` | Drag data store, `DataTransfer`, item/list objects and callbacks, `DragEvent`, security modes, and input-event processing | HTML §6.11 |
| `popover.ts` | Popover state, top-layer transitions, invoker relationships, light dismiss, and `PopoverTargetAttributes` | HTML §6.12 |

For §6.11.5's `application/microdata+json` entry, use
[`extractMicrodataJSON(nodes)`](../html/microdata/json.ts) with the dragged node list.
The extractor is implemented; creating the drag data store entry remains drag-and-drop work.

`ToggleEvent`, `CommandEvent`, `DragEvent`, and `CloseWatcher` use Browlet's DOM
event machinery but remain HTML-owned interfaces. Generic event dispatch must
not acquire their state. Likewise, `VisibilityStateEntry` uses the shared
Performance timeline while the visibility transition itself remains an HTML
lifecycle concern.

## History-action activation dependency

Navigation event cancellation now uses Window's two retained activation
timestamps, `hasHistoryActionActivation()`, and
`consumeHistoryActionUserActivation()`. Consumption covers the active Windows
of the top-level traversable, including nested and shadow-tree navigables of
other origins. Document's `getInclusiveDescendantNavigables()` supplies that tree
with parents before children, including the top-level Window first; the
Window methods keep this foundation below the full interaction subsystem.

The timestamps still have no input-event or automation producer. Activation
notification must select ancestors and same-origin descendants, record current
high-resolution time, and notify close watchers before dispatch. Transient
duration/expiry, `UserActivation`/Navigator, and
the WebDriver notification hook remain §6.4 work. Tests supply activation times
directly; this does not claim that a click or an automation request activates a Window.

New-target selection now calls `Window.consumeUserActivation()`. It uses the same
top-level inclusive descendants, preserves +Infinity for never-activated Windows,
and changes other last-activation timestamps to -Infinity without modifying the
history-action timestamp. Detached/other-tab Windows are excluded, and a retained
Window without a navigable is unchanged. This does not implement the missing
activation producer or expiry predicate; the
[target-selection audit](../browsing/navigation/ROADMAP.md#html-7317-new-target-selection)
records its caller and remaining dependencies.

Beforeunload now uses `Window.hasStickyActivation()`: compare the Window's current
high-resolution time with its last-activation timestamp. The initial +Infinity
is inactive, while consumed -Infinity remains sticky. This small predicate uses
the same retained state; it does not supply the missing activation producer.

## Focused-area dependency

HTML §3.1.2 exposes `DocumentOrShadowRoot.activeElement`; its implementation
follows the [§6.6 getter](https://html.spec.whatwg.org/multipage/interaction.html#dom-document-activeelement)
in the DOM mixin. `focus.ts` currently describes only the focused area's DOM
anchor, which can be a Document (viewport) or an Element (including a control
subpart). It does not yet model the focusable area kinds or their lifecycles.

`Document.focusedArea` and `Document.hasFocus()` are explicit throwing dependencies.
Pointer Lock consumes hasFocus internally; its public binding remains deferred.
Replace these stubs with the shared focus model when implementing initialization, focusing and
unfocusing, removal/inertness fixup, focus events, and the navigable focus chain.
Keep the focused area distinct from the top-level traversable's system focus:
an inactive document can retain its focused area. `activeElement`, `hasFocus`,
selector state, and focus APIs must consume that same model.

The active-element tests supply only this missing state. Ordinary public
`activeElement` reads still throw, and no focus/blur API has been approximated.

Navigation's §7.2.6.10.5 finishing policy now consumes
`NavigationImpl.focusChangedDuringOngoingNavigation` before considering automatic
reset. Focus update steps must produce that flag; tests currently supply it.
Automatic reset still throws after its guards. Its remaining sequence is
autofocus delegate, body/document-element fallback, focusing with a viewport
fallback, then moving the sequential focus navigation starting point. Keep this
on the shared focus model, including focus-event reentrancy and Document teardown.
Fragment scrolling has a separate focusing step; manual navigation focus reset
does not suppress that step.

## Pointer Lock and adjacent specifications

[Pointer Lock §§2–5](pointer-lock/ROADMAP.md) supplies the lazy UserAgent lock owner,
request/release API, Document notifications, and Document/ShadowRoot projection.
Native effects and HTML focus/activation remain explicit throwing dependencies.
§§6–7 now connect locked relative delivery and frozen mouse/wheel coordinates
through the existing pointer/mouse pipeline. Native sensor/gap notification and
cross-Document routing remain adapter duties. §8 now releases disconnected locks,
rechecks queued requests, and retains notification Documents across adoption.
Native unlock/focus-loss signals and HTML teardown remain explicit owner dependencies.
The closing §§9–12 audit found no additional runtime algorithm. Native Pointer Lock
remains blocked on those owners. [Selection API](selection/ROADMAP.md) now supplies
shared Document/Window Selection, live and composed ranges, deletion/containment,
coalesced Document/control selectionchange, and §4.3 event-handler properties/content attributes.
modify and stringification retain called editing/layout dependencies and four
approved expected failures. §§6–6.1 now provide the internal selectFromUser entry,
selectstart cancellation, and post-listener lifetime checks. §§6.2.1–6.2.2 now share
scheduling/firing across Document, input, and textarea, including adoption and
shadow-tree delivery. The local specification pass is complete; input/editing
connections, cross-root user proposals, document reset, and HTML text-control
state remain explicit dependencies.
The [keyboard coordinator](keyboard/ROADMAP.md#queued-keyboard-delivery-2026-11-05)
now supplies receipt-time modifier snapshots and queued trusted keydown/keyup,
using the existing key selection/NFC and vocabularies. Native layout/classification,
HTML focus/activation, ordinary default actions, and IME effects remain explicit
throwing dependencies. The local delivery slice is complete at those boundaries.
The [Clipboard opening review](clipboard/ROADMAP.md#opening-review-2026-11-05)
covers §§1–4 and identifies §5.1 ClipboardEvent as the first API implementation.
The [HTML §§6.11.2–6.11.3 data slice](drag-drop/ROADMAP.md) now supplies the
DataTransfer prerequisite. [Clipboard §5.1](clipboard/ROADMAP.md) now exposes
ClipboardEvent through existing handlers and DOM dispatch. §5.2.1's
ClipboardChangeEvent data interface is also implemented. Its native change
notifications, focus replay and storage-key change IDs remain next; native
clipboard/focus/permission effects require explicit owner connections.
CSSOM View remains deferred.

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

The [input-delivery investigation](../../../node-compat/experimental/input-delivery/README.md)
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

## Removal condition

Burn this file once visibility, activation, focus, and inertness have shared
state models and every deferred interaction family has implemented source or a
narrower surviving roadmap.
