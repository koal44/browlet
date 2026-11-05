# Selection API

Reference: [Selection API](https://w3c.github.io/selection-api/), local official
checkout `_web-platform/specs/selection-api`, refreshed 2026-11-04 at
`b475d4ba72cbe08f5015040dcd9fb4cf9133dd00`.

## Current slice

§1 is background. §§2–3 now supply the single Selection, all eight getters,
getRangeAt, addRange, removeRange, removeAllRanges, empty, getComposedRanges, and
collapse/setPosition/collapseToStart/collapseToEnd, extend, and setBaseAndExtent,
including composed spans across ordinary roots. §§4.1–4.2 expose
Document/Window.getSelection; Documents without a browsing context return null.
§5 reuses live Range mutation adjustment. §6.2 queues and coalesces Document
selectionchange notifications, clearing the scheduled flag before event dispatch.

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
Document owns the scheduled flag and queues a task explicitly associated with that
Document, including when its Window/environment is reused. The existing removal
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

## Next bounded slice and dependencies

1. Continue §3 with selectAllChildren, modify, deleteFromDocument, containsNode,
   and stringification. The ordinary Range primitives already exist, but audit
   how each operation treats a composed span before using them. modify requires
   a separate text/layout/input audit; those missing owners must remain explicit.
2. Add §4.3's GlobalEventHandlers declaration contribution and implementation fields
   for onselectstart/onselectionchange. The current notification is observable through
   addEventListener; these handler attributes are not exposed yet.
3. HTML document.open owns replacing the Document's Selection object (§2). Before
   replacement, call the old Selection's removeAllRanges to detach every public
   and internal Range reference; overwriting the Document field alone is insufficient. This missing
   hookup is marked beside Document.getSelection/scheduleSelectionChange.
   Document lifecycle work remains with the HTML owner.
4. Input/HTML editing owns user selection and §6.1 selectstart cancellation, plus
   input/textarea selection notifications. Programmatic addRange does not synthesize
   those actions. Rendering owns caret/highlight presentation and its invalidation;
   none is claimed by this state/API slice. Source TODOs retain these boundaries.

CSSOM View, native input adapters, focus changes, and editing are not prerequisites
for the implemented programmatic range/state operations. No placeholder behavior
stands in for those later producers.

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
passed after the completed-move notification. The combined custom/addon run passes
83 Selection, 71 DOM Range, and 25 structural-mutation tests: 179 ordinary passes,
with no expected failures or skips. Selection also passes all 83 tests on custom
Node 27, Node 24.19.0, and Node 26.8.1, each with the addon enabled and disabled.
The former cross-root expected failure is an ordinary passing regression. Typecheck
and Web IDL type contracts, focused ESLint, import-boundary checks, and patch
whitespace checks pass. No generated platform declarations changed.

The first run caught an incorrect test expectation at a character-data replacement
boundary: DOM clamps a point at the replaced span's end to the span's start. The
test now independently checks insertion shifts and replacement clamping; no Range
behavior change was required for that expectation.
