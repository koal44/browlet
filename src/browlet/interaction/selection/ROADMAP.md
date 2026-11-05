# Selection API

Reference: [Selection API](https://w3c.github.io/selection-api/), local official
checkout `_web-platform/specs/selection-api`, refreshed 2026-11-04 at
`b475d4ba72cbe08f5015040dcd9fb4cf9133dd00`.

## Current slice

§1 is background. §§2–3 now supply the single Selection, all eight getters,
getRangeAt, addRange, removeRange, removeAllRanges, empty, getComposedRanges, and
collapse/setPosition/collapseToStart/collapseToEnd, extend, and setBaseAndExtent,
including composed spans across ordinary roots, plus selectAllChildren,
deleteFromDocument, and containsNode. All §3 members are exposed, but modify
and stringification remain partial. modify is exposed with its argument-validation
and empty-selection steps; rendered movement reaches the explicit dependency described below. Stringification returns
empty for an empty selection/ordinary caret, while selected text reaches the
rendering dependency described below. §§4.1–4.2 expose
Document/Window.getSelection; Documents without a browsing context return null.
§4.3 adds onselectstart/onselectionchange through the existing GlobalEventHandlers
maps and bindings, including HTML/SVG/MathML content attributes.
§5 reuses live Range mutation adjustment. §§6.2.1–6.2.2 now share selectionchange
scheduling/firing for Document, input, and textarea, clearing the per-target
scheduled flag before event dispatch. HTML control selection state remains unfinished.
§§6–6.1 now expose an internal selectFromUser entry for a producer-supplied
ordinary-tree Range and direction, with pre-association selectstart cancellation.

Document lazily owns SelectionImpl. Selection retains its exact public Range.
Only cross-root spans additionally retain two internal collapsed Ranges, reusing
DOM mutation adjustment without a second registry or changing the one-root Range
invariant. All three directly reference Selection through a type-only import. removeAllRanges
explicitly clears every association; removeRange, empty, and Document-membership
loss use that same detach path. Replacing a selected Range detaches the old Range
before attaching the new one, without modifying the old Range's endpoints. Existing
insertion/removal, CharacterData, split/normalize, and Range mutation paths notify after complete
boundary assignments. Selection compares cached endpoints before scheduling;
ordinary ranges do not allocate notification objects. This adds no mutation registry.
Document, input, and textarea each own one scheduled flag and forward to the shared
algorithm. Document tasks retain their explicit Document association, including
when its Window/environment is reused; control tasks have no activity gate. The existing removal
notification additionally checks shadow endpoints after unlinking. Ordinary-tree
endpoints have already been repaired by DOM's Range pre-removal steps.

The implementation lives below DOM nodes and uses type-only node/environment
references. Binding owns conversion, receiver checks, exception realization, and
platform projection. Borrowing another realm's getSelection/getRangeAt preserves
the receiver Selection and the retained Range's original platform identity.
getComposedRanges returns a new StaticRange snapshot on each call, rescoping
unlisted shadow trees to the surrounding host positions. A supplied nested shadow
root also permits exposure of its enclosing roots. Collapse operations create a
new Range in the Selection's realm; snapshots and their arrays also belong to that
realm, independently of the realm that originally created the selected live Range.
The implemented paths use existing DOM ranges. extend retains the anchor while
changing the focus and direction; crossing into another root instead collapses
at the new focus. setBaseAndExtent orders same-root points into a Range while
preserving their supplied anchor/focus direction, including inside a shadow tree.
Both use the existing replacement/detachment and notification path. Cross-root
setBaseAndExtent additionally keeps its full span for getComposedRanges; its
ordinary public Range collapses at the later point. Hidden endpoint changes also
schedule selectionchange, even if that ordinary Range has not changed.

## Browser decisions

The reproducible browser-only probe is
`node-compat/experimental/input-delivery/selection-state.mjs` (run from Experimental
with `node input-delivery/selection-state.mjs`). It ran on 2026-11-04 using
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.

- `SPEC_CLASH(selection-single-range)`: follow the draft and Chromium/WebKit's
  single range; Firefox accepts multiple ranges.
- `SPEC_CLASH(selection-unchanged-boundaries)`: follow the draft and Chromium/WebKit
  by notifying actual endpoint changes; Firefox also notifies same-value setters.
- `SPEC_CLASH(selection-range-document)`: clear a Selection when its selected Range
  moves outside its Document, following Chromium/Firefox. The draft retains it and
  hides endpoints outside the document tree; WebKit can retain an earlier snapshot.
- `SPEC_CLASH(selection-shadow-endpoints)`: follow Chromium/Firefox and §2's allowance
  for shadow endpoints. §3's getter prose instead hides endpoints outside the
  ordinary document tree. WebKit stopped following the probed Range transition.
- `SPEC_CLASH(selection-shadow-removal)`: clear when a selected shadow host is
  removed, following Firefox. Chromium retained endpoints while type/direction no
  longer agreed with them; WebKit had retained an earlier ordinary-tree snapshot.
  Immediate reinsertion does not restore the cleared Selection. State-preserving
  moves and unrelated removal retain it.
- `SPEC_GAP(selection-add-direction)`: addRange does not initialize direction in
  the written algorithm. Establish forward, as all browsers do for a noncollapsed
  added Range and WebKit also does for a collapsed Range.
- `SPEC_CLASH(selection-collapsed-direction)`: preserve that direction through later
  Range mutations, including collapse, following §2 and WebKit. Chromium/Firefox
  report none while collapsed. Empty selections report none everywhere.

These choices were reviewed and approved. All browsers agreed on initial empty
state, Document/Window identity, null for Documents without a browsing context,
exact added Range identity, and trusted non-bubbling/non-cancelable/non-composed
Document notifications.

### Composed snapshots and collapse

The next browser-only probe is
`node-compat/experimental/input-delivery/selection-snapshots.mjs` (run from
Experimental with `node input-delivery/selection-snapshots.mjs`). It ran on
2026-11-04 with the same browser versions. All three agreed on nested closed-root
rescoping, fresh StaticRange snapshots, snapshot stability after text mutation,
Range replacement without mutating the old Range, the collapse validation order,
and suppressing notifications for an identical repeated collapse.

- `SPEC_GAP(selection-collapse-direction)`: §3's collapse algorithms omit direction
  initialization. Establish none for the newly-created collapsed selection.
- `SPEC_CLASH(selection-collapse-direction)`: that choice matches Chromium/Firefox;
  WebKit establishes forward. This does not change the earlier rule preserving
  direction when script mutates an already-selected Range rather than replacing it.
- `SPEC_CLASH(selection-unchanged-replacement)`: §6.2 schedules for every new Range
  association. Like all three browsers, omit a redundant notification when both
  endpoints and direction are unchanged; still replace the Range and detach the old
  notification link. Changed endpoints or direction schedule the existing task.
- `SPEC_CLASH(selection-snapshot-array-realm)`: retain Binding's receiver-realm
  array allocation, following Chromium/WebKit. Firefox uses the borrowed method's
  realm for the array. All three allocate the StaticRange in the receiver's realm.

Eric approved these choices. WebKit's anchor/focus getters still rescope shadow
endpoints, unlike Chromium/Firefox; the existing `selection-shadow-endpoints`
decision continues to expose the live endpoints while composed snapshots perform
explicit rescoping. The probe starts with a backward selection to establish that
Selection collapse resets direction rather than inheriting it.

### Direction operations

`node-compat/experimental/input-delivery/selection-direction.mjs` compares §3's
extend and setBaseAndExtent (run with `node input-delivery/selection-direction.mjs`
from Experimental). On 2026-11-04 the same three browser versions agreed on
ordinary forward/backward points, replacing rather than mutating the old Range,
omitting unchanged notifications, and the core invalid-offset errors.

- `SPEC_CLASH(selection-equal-points-direction)`: use forward for equal points,
  as both written algorithms and WebKit do; Chromium/Firefox expose none. This
  is distinct from the previously approved directionless collapse operations.
- `SPEC_CLASH(selection-extend-validation)`: use the draft/Chromium order:
  ignore nodes outside the associated Document before checking whether Selection
  is empty. Firefox/WebKit check empty first, including for foreign/detached nodes.
- `SPEC_CLASH(selection-base-extent-validation)`: validate each point's node kind
  and offset, anchor first then focus, before Document membership, like all browsers.
  The draft checks both offsets first and defers node-kind rejection to Range setters.
  Thus even a detached DocumentType throws InvalidNodeTypeError; an invalid offset
  on an earlier ordinary anchor still wins over a later DocumentType focus.
- `SPEC_CLASH(selection-base-extent-null)`: retain the declared non-null Node
  arguments, following the draft and Firefox/WebKit. Chromium still accepts null.
- `SPEC_CLASH(selection-extend-root)`: collapse at the new focus when extend
  changes ordinary roots, following the draft and Chromium/Firefox. WebKit retains
  a composed span across roots.
- `SPEC_GAP(selection-extend-root-direction)`: the draft then compares points
  without a shared root. Use directionless collapse as Chromium/Firefox do.

Eric approved these rules and the existing actual-change notification policy.
Live mutation of a backward Range still preserves direction, including collapse;
replacing the Range with equal points instead follows the operation's direction rule.

### Live composed selection state

`node-compat/experimental/input-delivery/selection-cross-root.mjs` probes the
extra composed state, public Range edits, DOM mutations, and host/slot ordering.
It ran on 2026-11-04 with the same browser versions. Local Blink DomSelection,
Gecko Selection, and WebKit DOMSelection also retain selection state separately
from their ordinary Range representation.

- `SPEC_GAP(selection-base-extent-roots)`: the draft compares points in different
  roots without defining an ordering or their additional live representation.
  Retain two internal collapsed Ranges for the composed endpoints. The public
  ordinary Range collapses at the later point, as Chromium/Firefox do; only the
  composed snapshot exposes the full span. The formerly expected-failure regression
  now runs normally and passes.
- `SPEC_CLASH(selection-composed-order)`: follow Chromium/WebKit's shadow-host
  order, without slot redistribution. Firefox follows slot order in the probed
  case. A host's zero offset precedes its shadow content; positive offsets follow
  it. Ordinary-tree endpoint comparisons retain DOM's rules.
- `SPEC_CLASH(selection-composed-type)`: retain existing ordinary getters,
  including isCollapsed=true and type=Caret, following Firefox. Chromium reports
  type=Range for the same collapsed ordinary Range. WebKit rescopes getters and
  can expose no public Range while still retaining a composed span.
- `SPEC_GAP(selection-composed-range-edit)` and
  `SPEC_CLASH(selection-composed-range-edit)`: the draft omits how author edits
  to the public Range affect its separate span. Any explicit Range edit replaces
  that span with the ordinary Range, including same-value setters. Chromium
  updates one composed endpoint and Firefox often retains its older span; both
  discard it on collapse/selectNodeContents. Eric approved the consistent
  replacement policy rather than adopting either partial-update behavior.

Eric approved these choices and the live-Range representation. DOM's five static
mutation adjustment paths identify their notifications as automatic. They preserve
and update the hidden endpoints, like Chromium's text/ordinary-subtree behavior;
Firefox discards the span in several tested cases, and WebKit leaves stale offsets
in the split/normalization probes. Selection queues no author callbacks during
adjustment and never rewrites one tracked Range from another inside that loop,
which avoids applying the same offset change twice. Clearing or replacing Selection
and future Document reset must detach all three Range associations. Disconnection
of either shadow endpoint clears Selection through the existing approved removal
hook; reinsertion does not restore it.

- `SPEC_GAP(selection-composed-move)` and
  `SPEC_CLASH(selection-composed-move)`: a state-preserving move can reverse
  endpoint order without changing either node/offset pair. After reinsertion and
  all live Range adjustments, Node notifies the existing Document Selection once,
  before moving callbacks. Selection reorders the endpoints and reverses direction
  to retain the supplied composed anchor/focus, then refreshes the ordinary Range
  without replacing its identity. The draft leaves this state undefined;
  Chromium/Firefox lose or repair part of the tested span. WebKit's tested build
  lacks moveBefore. Eric approved preserving the full span. Ordinary remove/insert
  still uses the established disconnection policy above.
- `SPEC_GAP(selection-composed-extend)` and
  `SPEC_CLASH(selection-composed-extend)`: extend keeps the exposed ordinary
  anchor and replaces the composed span, as Eric approved. Chromium consults its
  hidden anchor and can collapse at the new focus; Firefox can preserve the hidden
  composed start while changing the ordinary Range. Keeping the existing algorithm
  also means extend into another ordinary root still collapses at the new focus.
  collapseToStart/End continue using the ordinary Range, like Chromium/Firefox;
  WebKit uses its composed endpoints. These operations detach all old trackers.

### Selecting children and requesting caret movement

`node-compat/experimental/input-delivery/selection-children-modify.mjs` probes
these next §3 operations (run with `node input-delivery/selection-children-modify.mjs`
from Experimental). The 2026-11-04 run used Chromium 156.0.8078.4, Firefox 157.0,
and WebKit 27.2. All three agree on direct child counts, zero offsets for Text and
Comment, DocumentType validation before membership, ignoring detached/foreign/Attr
nodes, preserving an old Range when replacing it, and omitting unchanged notifications.

- `SPEC_CLASH(selection-children-shadow)`: accept connected shadow-tree nodes,
  like all browsers; the draft still requires an ordinary root equal to the Document.
  Existing public shadow-endpoint rules continue to apply.
- `SPEC_CLASH(selection-children-direction)`: establish the draft/WebKit's forward
  direction even for a node with no children. Chromium/Firefox report none there.

Eric approved these rules. selectAllChildren uses the existing Range replacement
path, including detachment of any composed span; it counts children rather than
CharacterData's UTF-16 units. Borrowing retains the receiver's Range realm and
Binding's method-realm exception policy.

modify implements §3 steps 1–4: optional DOMString conversion stays in Binding;
ASCII-insensitive validation recognizes the specified alterations, directions, and
nine granularities, with no whitespace trimming or Unicode case folding. Invalid
requests and an empty Selection are no-ops. Conversion completes before any of
these checks, including reentrant conversion that clears Selection.

Steps 5–11 call `SelectionImpl.#modifyRenderedSelection`, which currently throws
`Selection.modify requires rendered caret movement and bidi resolution` before
changing direction or endpoints. Eric approved this explicit boundary and two
expected-failure regressions retaining forward-character and rightward-extension
results. Both were run as ordinary tests and failed at that dependency before
classification. Invalid/empty requests are ordinary passing tests; supported caret
movement is not claimed.

The missing owner must provide rendered caret positions and movement boundaries:
Unicode character/word/sentence navigation, visible/selectable text and editing
limits, line wrapping/paragraph/document navigation, and UAX9 embedding direction
at the focus with caret affinity at bidi boundaries. Browlet's HTML directionality
and Infra firstStrongDirection helpers supply base direction only; they do not
resolve the embedding direction of a character in laid-out text. CSS/text layout
and editing navigation must provide these facilities before the dependency is
replaced. The programmatic operation does not require a physical keyboard adapter.

`SPEC_GAP(selection-modify-granularity)`: the draft explicitly leaves precise
user-requested movement destinations for the granularities undefined. In the probe,
all browsers move/extend by one ASCII character, but Chromium/WebKit's forward word
movement includes the following space while Firefox stops before it; Firefox also
leaves sentence/paragraph and several boundary requests unchanged. Those future
movement policies remain open. Local Blink DomSelection flushes layout then delegates
to FrameSelection; Gecko Selection flushes layout for bidi and delegates to
nsFrameSelection; WebKit DOMSelection likewise delegates to FrameSelection's editing
machinery. None provides a general solution by changing raw Range offsets alone.

### Deletion, containment, and rendered selected text

The next browser-only probe is
`node-compat/experimental/input-delivery/selection-content.mjs` (run with
`node input-delivery/selection-content.mjs` from Experimental). The 2026-11-04
run used Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved
same-root shadow deletion, the DOM containment rules below, and the explicit
rendered-text dependency with two expected-failure regressions.

- `SPEC_CLASH(selection-delete-shadow)`: delete through the associated Range even
  inside a connected shadow tree, like Chromium/Firefox. The draft requires both
  endpoints in the document tree; WebKit did not delete the probed shadow selection.
- `SPEC_CLASH(selection-delete-range)`: retain the exact associated Range, as the
  draft and Chromium/WebKit do for ordinary deletion. Firefox replaces it after
  deletion. The earlier approved §2 direction-preservation rule still applies to
  this Range mutation; Chromium/Firefox report none afterward and WebKit changed
  a backward selection to forward in the probe.
- Empty/collapsed ordinary Ranges are no-ops. In particular, a cross-root composed
  span has a collapsed ordinary Range: deletion changes neither content nor its
  separate composed endpoints, agreeing with all three browsers. Normal deletion
  uses existing CharacterData/removal adjustments and selectionchange coalescing.
- The declaration retains `[CEReactions]`, like Range.deleteContents. Reaction
  stack/queue entry and exit still belong to unfinished HTML §4.13.6 in
  [custom elements](../../dom/nodes/html/custom-elements/ROADMAP.md); this slice
  does not implement that shared owner.

`SPEC_CLASH(selection-contains-boundaries)`: containsNode uses WebKit's ordinary
DOM comparisons: full containment encloses the node's before/after positions;
partial containment uses Range.intersectsNode. Merely touching an outside edge is
not overlap, while a caret inside the node can partially overlap it. Selecting
all of an Element's children does not fully select the Element. Document has no
parent extent, so full containment is false; partial containment is true for an
ordinary-document Range. Firefox differs for full Document containment; Chromium
normalizes its Range using layout and returns false even for partial Document
containment. The draft's boundary points "in" a node and visual-equivalence
wording do not define these DOM rules precisely. No guessed visual equivalence or
layout normalization is supplied.

`SPEC_CLASH(selection-contains-text)`: require whole-node enclosure for Text and
other CharacterData too, like WebKit. Chromium/Firefox accept partially selected
Text as full containment; Firefox does so for Comment too. Membership retains the
draft's ordinary-document-root check, excluding detached, foreign, attribute, and
shadow nodes. Use only our exposed ordinary Range, not its additional composed
span; browsers differ on those extra endpoints. These choices use existing DOM
primitives without allocating temporary Ranges or introducing layout state.

Selection stringification is a rendered-text API, distinct from Range's raw Text
concatenation. The probe confirms hidden/invisible/unselectable text is omitted,
whitespace is processed, block/BR boundaries add separators, and the selected
textarea value uses control offsets. Chromium/WebKit also apply text
transformation, while Firefox retained the original case; Firefox used CRLF block
separators and retained outer spaces where Chromium/WebKit used LF and trimmed.
Those rendering policies remain future work, not adopted output behavior here.

Empty Document selections and ordinary carets return an empty string. A separate
composed span is not mistaken for a caret just because its public Range collapses.
Otherwise `SelectionImpl.#getRenderedSelectedText` throws without changing state.
Its source TODO names processed text fragments, visibility/selectability,
whitespace/transformation, and line/block separators, plus the separate HTML
text-control current-value/selected-offset owner. That control owner must also be
consulted before the DOM-only empty/caret paths once implemented. HTML innerText
collection and [rendering](../../rendering/ROADMAP.md) are unfinished; forwarding
to Range.toString would knowingly return hidden text and lose rendered spacing.
Two required hidden-text/whitespace results were observed failing at this named
dependency, then retained as the approved expected failures.

### Global event handlers

The browser-only probe `node-compat/experimental/input-delivery/selection-handlers.mjs`
ran on 2026-11-04 with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
All three expose both properties on Window, Document, HTMLElement, SVGElement,
and MathMLElement, including body/frameset elements. They agree on callback identity,
receiver, return-false cancellation, property removal, and coalesced trusted
Document selectionchange. Generic Element has neither handler. Programmatic
selection changes do not fire selectstart.

- `SPEC_CLASH(selection-svg-content-handlers)`: use the shared handler maps for
  SVG content attributes, following Chromium/WebKit. Firefox exposes both SVG
  properties but ignores their content attributes. The mixin contribution reaches
  every existing includer; the draft's prose lists HTML elements, Document, and
  Window without enumerating SVG/MathML.
- `SPEC_CLASH(selection-body-content-handler)`: keep a body's onselectionchange
  content attribute on that body, following the draft/Firefox. Chromium/WebKit
  redirect only the content attribute to Document; the JavaScript property remains
  local. Blink's HTMLBodyElement::ParseAttribute and WebKit's
  HTMLBodyElement::attributeChanged contain that special case; WebKit marks it
  for removal once its control selectionchange support replaces the need.

Eric approved both choices. Selection contributes a separate partial mixin
declaration, with no new runtime mixin object, listener registry, or per-node
notification state. Concrete includers merge its two names into their existing
shared static definition maps. Body/frameset handlers remain local. Existing
EventHandlerMap handles lazy compilation, callback invocation, replacement,
removal, and target-wide erasure. Document's scheduled event uses that same path.

### User-selection association and cancellation

[§§6–6.1](https://w3c.github.io/selection-api/#user-interactions) now have the
internal `SelectionImpl.selectFromUser(range, direction)` entry. Eric approved
this producer contract: it accepts an ordinary-tree Range and explicit direction,
copies it into a fresh Range in Selection's realm, and returns whether the
proposal was installed. It adds no author-facing method. It never accepts an
empty-selection request; the future producer must honor §6's rule against
emptying a nonempty selection in response to user input.

- `SPEC_GAP(selection-user-direction)`: §6 describes direction by comparing
  already-ordered Range start/end points. The producer retains the gesture's
  anchor/focus ordering or directionless platform convention and supplies the
  direction explicitly. The Range copy alone cannot reconstruct it.
- `SPEC_CLASH(selection-user-start-gate)`: use the exact §6.1 condition: before
  association, fire a trusted, bubbling, cancelable, non-composed selectstart at
  the proposed start node if the existing associated Range is absent/collapsed.
  This includes caret proposals, like Chromium/WebKit but unlike Firefox. It
  excludes replacing a noncollapsed Range, unlike Chromium/WebKit's new click
  outside that range. The condition uses the associated ordinary Range, consistent
  with our existing cross-root public-Range policy.
- Cancellation returns false without installing the proposal or rolling back
  author changes/DOM adjustments. If uncanceled, the proposal replaces a selection
  established by the listener. The old associated Range and producer's Range
  keep their identities; explicit changes to either do not mutate the private
  copy. Successful replacement uses existing detach and notification machinery.
- `SPEC_GAP(selection-user-reentrancy)`: the draft does not specify what to do
  when listeners invalidate the proposal or its Document. Check full activity and
  shadow-inclusive membership before dispatch and again afterward. Reject original
  endpoint nodes that are disconnected or leave the Document, even when live Range
  removal steps repaired the candidate to a surviving parent. Chromium/WebKit
  abandon the probed removed/replaced target; Firefox's drag continues from repaired
  positions. An existing unrelated selection remains intact.
- `SPEC_CLASH(selection-user-live-proposal)`: retain DOM live-Range adjustment
  of the private proposal during callbacks. Firefox shifts its anchor after the
  probed text insertion; Chromium/WebKit retain the earlier offsets. This also
  handles splitText. Connectivity is checked after the callback: remove/reinsert
  may therefore accept the Range's repaired parent position, rather than restoring
  the old text offsets.

The retained native-input probe is
`node-compat/experimental/input-delivery/selection-user.mjs`, run on 2026-11-04
with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It records state both
after mouse-down and after the full gesture, so later drag updates are not confused
with the first selectstart decision. A click whose listener selects other text and
cancels retains that author selection in Chromium/WebKit; an uncanceled click
replaces it. Firefox does not fire for that caret click and delays until extension.
Dragging inside an existing selection can invoke drag behavior rather than replace
selection, so the separate outside-click cases establish the noncollapsed timing
difference. Local Blink SelectionController and Gecko Selection both dispatch
before selection work and recheck after author code; WebKit FrameSelection also
uses an ordinary bubbling/cancelable event.

The implementation deliberately does not guess hit-tested caret positions,
selectability, gesture recognition, editing/focus rules, or cross-root user
proposals. Those inputs remain required producer work in source. Programmatic
Selection methods continue to bypass selectstart.

### Selectionchange scheduling and control lifetime

[§§6.2.1–6.2.2](https://w3c.github.io/selection-api/#scheduling-selectionchange-event)
use one scheduleSelectionChange(target) function, one boolean directly on each
eligible implementation, and an instance forwarding method. Eric approved that
ownership without a registry or extra state object. The internal flag and method
are not Web IDL members. Callers decide whether the selection extent or direction
actually changed; scheduling coalesces notifications for that target until delivery.
Clearing the flag before dispatch permits a listener to queue the next task.

- `SPEC_GAP(selection-change-task-owner)`: the draft does not supply HTML's event
  loop or Document task arguments. Select the current node Document's loop when
  scheduling, rather than the element's creation global. Document tasks keep their
  existing full-activity gate. Control tasks have no fixed Document association:
  detachment, an inert Document, or adoption does not strand or discard them.
  A pending task stays on its chosen loop; an adopted control's later request uses
  the new Document's loop. Dispatch computes the current propagation path.
- `SPEC_CLASH(selection-control-inactive)`: keep control delivery after its Document
  loses its browsing context, following Firefox; Chromium/WebKit suppress it.
  This does not bypass HTML's independent callback-realm activity check. The probe
  and regression use an observer from a still-active Window in the same agent.
- `SPEC_CLASH(selection-control-shadow)`: fire at the control with bubbles=true,
  cancelable=false, composed=false, following the draft/Firefox/WebKit. Chromium
  instead sends a separate Document event for shadow-tree controls. Document's
  own notification remains non-bubbling. All generated events are trusted.

The retained probe is `node-compat/experimental/input-delivery/selection-controls.mjs`,
run on 2026-11-04 with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three
agree on asynchronous coalescing, control event flags outside shadow trees,
detached/inert-Document delivery, reentrant changes, and pending adoption, including
removal of the original frame after adoption. Local Blink and WebKit control
implementations also retain a direct flag; WebKit queues on UserInteraction while
Blink uses MiscPlatformAPI and contains the shadow-to-Document redirection.
Browlet retains Selection API's user-interaction task source.

## Remaining owner dependencies

1. HTML input/textarea value, offset, and direction state remains unfinished.
   Their scheduleSelectionChange methods now provide the complete notification
   entry, with source TODOs for selection setters, setSelectionRange/setRangeText,
   and value/editing changes. No working public control selection API is claimed.
2. Input/HTML editing must determine endpoints and direction from real input,
   honor selectability/editing/focus policy, and call selectFromUser. Cross-root
   user gestures need a composed proposal representation; do not replace that
   span with an ordinary collapsed Range. §6 prohibits user actions from emptying
   a nonempty Selection. No native selection gesture is claimed yet.
3. HTML document.open owns replacing the Document's Selection object (§2). Before
   replacement, call the old Selection's removeAllRanges to detach every public
   and internal Range reference; overwriting the Document field alone is insufficient.
   The missing hookup remains marked beside Document.getSelection/scheduleSelectionChange.
   Document lifecycle work remains with the HTML owner.
4. Finish §3's called editing/layout dependency for modify and rendered-text
   dependency for stringification when their owners can provide real results.
   Rendering also owns caret/highlight presentation and invalidation. The four
   approved expected failures remain visible; neither API is complete.

The closing read confirms §5 reuses DOM's live Range algorithms and §§6.2.1–6.2.2
now provide Document/control task coalescing/firing. Conformance and security/privacy
add no mandatory runtime algorithm; assistive-technology mouse/keyboard emulation
is optional. This closes the local scheduling/firing work and the document-order
pass through Selection API; the concrete owner dependencies above remain, so it
is not a claim of full Selection API support. Clipboard API is the next adjacent
specification; CSSOM View remains deferred.

## Validation

`test/browlet/interaction/selection.test.ts` covers projected identity and errors,
borrowed methods/realm ownership, actual-change coalescing and reentrant delivery,
cross-Document/shadow lifetime, state-preserving moves, structural mutation, text
replacement/split/normalization, and Range content operations. The new snapshot
and collapse cases cover nested closed roots, explicit root exposure, static
snapshot lifetime, dictionary-conversion reentrancy, borrowed result realms,
validation order, replacement detachment, and unchanged-replacement silence.
The direction cases additionally cover backward Range mutation, parent/child point
ordering, validation precedence, conversion reentrancy, shadow-root changes,
receiver-realm allocation, method-realm exceptions, and direction-only notifications.
The composed cases cover host/nested/sibling/slot ordering, public Range views,
static snapshots, live text/structural changes, either endpoint's disconnection,
explicit Range edits, unchanged replacement, full detachment, state-preserving
move reversal, temporary-unlink handling, and collapse/extend replacement.
The move-order regression first failed at its ordered snapshot expectation and
passed after the completed-move notification. The new children/modify cases cover
child counts, Document/CharacterData/shadow targets, validation order, replacement
and realm behavior, optional/invalid arguments, empty movement, conversion order,
and reentrant conversion. The deletion/containment/stringifier cases additionally
cover Range identity and direction, multi-node and CharacterData deletion, shadow
and composed state, whole-node versus content boundaries, touching edges, root
membership, boolean conversion, borrowed receivers, and empty/caret strings. The
rendered-text regressions failed at their named dependency before the approved
expected-failure classification. The previous combined Selection/DOM Range run
reported 204 ordinary passes plus four approved expected failures (208 tests).
The Selection and selection-event-handlers suites cover all includers,
branded accessors, content attributes, borrowed setters, erasure, and queued
handler replacement/removal/reentrancy. selection-user adds 28 cases for the
pre-association gate, cancellation, live adjustment, invalidation, fresh Range
identity/realm, composed-state replacement, and unchanged notifications. The
new selection-change suite adds 29 cases covering coalescing, event flags/path,
handler replacement, reentrancy, independent targets, shadow trees, detached and
inert Documents, adoption and task cleanup, and Document versus control activity
gates. Its observer is in a still-active same-agent Window. The combined suites
report 202 ordinary passes plus four approved expected failures (206 tests) on
custom Node 27, Node 24.19.0, and Node 26.8.1, each with the addon enabled and disabled. The four failures are
exactly the two movement and two rendered-text dependencies; no new failures
were classified and there are no unexpected failures or skips.
Typecheck, generated declarations, Web IDL type contracts, focused ESLint, import
boundaries, and patch whitespace checks pass.

The first run caught an incorrect test expectation at a character-data replacement
boundary: DOM clamps a point at the replaced span's end to the span's start. The
test now independently checks insertion shifts and replacement clamping; no Range
behavior change was required for that expectation.
