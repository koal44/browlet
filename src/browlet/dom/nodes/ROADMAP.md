# DOM nodes roadmap

## Audit outcome

The directory currently covers the core `Node`, `Document`, `XMLDocument`, `DOMImplementation`, `DocumentType`,
`DocumentFragment`, `ShadowRoot`, `Element`, `NamedNodeMap`, `Attr`,
`CharacterData`, `Text`, `CDATASection`, `ProcessingInstruction`, and `Comment` implementation families, together with
collections and the mixins already required by them.

Those familiar interfaces are not the difficult dependency in DOM §4. The
early prerequisite is one normative mutation path shared by script, parsers,
ranges, traversal, MutationObserver, shadow-slot assignment, custom-element
reactions, style/tree-scope invalidation, and HTML's insertion/removal hooks.
`NodeImpl` owns its tree links and mutation ordering. Its private storage
operations update links after the required mutation participants have run.
The 4B–4I implementation supports structural and text mutations with live Range,
NodeIterator, collection, MutationObserver, and slot-assignment participants and
a shared attribute-change path. Custom-element reactions still leave the full
mutation path incomplete.

## Section 4 slices

Follow the dependency order below. Each slice uses public behavioral tests where
the interface exists; implementations receive already-converted values.

| Slice | Scope | Completion proof |
| --- | --- | --- |
| 4A. Tree validity | Pre-insert checks for parent/node kinds, host-including cycles, reference children, fragments, and Document hierarchy | `appendChild()` and `insertBefore()` reject invalid operations before changing either tree |
| 4B. Insert, remove, and adopt | One structural path, fragment splicing, node-document updates, and parser entry points | Public and parser mutations preserve topology, ownership, and ordering |
| 4C. Complete structural mutation | Replace, replace-all, move, and live Range/NodeIterator participation | Atomic failure, boundary-point adjustment, and iterator pre-removal through actual consumers |
| 4D. Attributes | Qualified names, namespaces, Attr, NamedNodeMap, and one attribute-change path | Element, Attr.value, and NamedNodeMap mutations preserve identity and notify the same participants |
| 4E. Character data | Replace-data, Text splitting, normalization, and text content | UTF-16 offsets, live ranges, and node-specific getters/setters behave consistently |
| 4F. Collections and tree mixins | Live/static NodeList and HTMLCollection, convenience mutation, and Selectlet-backed query APIs | Stable live views, static query results, scope matching, and shared mutation behavior |
| 4G. Mutation observers | Registered/transient observers, records, and agent-backed microtask delivery | Correct record contents, batching, reentrancy, and callback ordering |
| 4H. Shadow trees | ShadowRoot, attachment, slottables, assignment, and slotchange delivery | Shadow topology and slot changes use the same mutation and checkpoint machinery |
| 4I. Node and Document completion | Clone/import, equality, namespace lookup, document factories, DOMImplementation, XML leaf nodes, and remaining declared members | Public interface coverage followed by an ordered §4 audit |

[Trusted Types TT-A/TT-B](../../browsing/policy/trusted-types/ROADMAP.md#next-slices) completes
the Window policy/CSP dependency and existing attribute checks between 4D and 4E.
4E's character-data path now includes ProcessingInstruction attribute
synchronization. Collections and mutation observers are implemented in 4F/4G;
4H adds shadow attachment and slot assignment. 4I completes the available
Node/Document and leaf-interface contracts; remaining dependencies are listed below.
Parser options, sanitization, and script/worker enforcement are later branches,
not additions to the current DOM slice.

4A is complete: `NodeImpl.ensurePreInsertValidity()` validates both public insertion entry points,
including host-including cycles and Document hierarchy. The regressions are in
[`mutation.test.ts`](../../../../test/browlet/dom/nodes/mutation.test.ts).
4B is implemented in `NodeImpl.insert()`, `removeNode()`, and `adoptInto()`. Public
insertion/removal, `Document.adoptNode()`, ChildNode removal, and parse5's existing
structural callbacks now enter these algorithms. This includes fragment
splicing, attribute/descendant document updates, shadow-including traversal,
and ordered insertion/removal/adoption/post-connection extension points.
`ownerDocument` reads retained ownership rather than inferring it from the tree.
Text/Comment author constructors select the current document through DOM's own
`DOMRealm` contract; document factories retain their supplied document. DOM's
environment view does not require the complete browser environment for these
constructors. Non-Window realms can have no associated document; the constructors
are exposed only on Window.

4C adds `replaceChild()`, the implementation `replaceAll()` primitive, and
`ParentNode.moveBefore()`. Public Range selection and NodeIterator factories now
exercise live adjustment through those operations. Moves run moving steps rather
than insertion/removal steps; HTML's base element updates the selected base URL.
NodeIterator's early reentrancy guard follows Firefox; the compatibility choice
and regression coverage are recorded in
[`../traversal/ROADMAP.md`](../traversal/ROADMAP.md#reentrant-filter-compatibility-choice).

4D gives `ElementImpl` ownership of its ordered attribute list; `NamedNodeMapImpl`
is its live indexed/named view. Element setters, `Attr.value`, map mutations, and
parser attribute attachment share append/change/replace/remove steps and then
`handleAttributeChanges()`. Attachment updates an Attr's node document without
changing its platform identity or realm. Replacement preserves list position;
namespace/local-name updates preserve the existing prefix and Attr object.
HTML casing applies only to HTML elements in HTML documents.

The [attribute tests](../../../../test/browlet/dom/nodes/attributes.test.ts) cover
namespaces, validation, toggling, attachment, cross-realm identity, and retained
inline style. [NamedNodeMap tests](../../../../test/browlet/dom/nodes/named-node-map.test.ts)
cover live indices, supported names, collisions, and mutation errors. CSSOM reads
and writes the null-namespace style attribute through the shared DOM operations;
namespaced attributes with the same qualified name stay independent.

Trusted Types checks now precede Element setters, Attr attachment, and attached
`Attr.value` changes, including callback-driven replacement, detachment, and
adoption. Element setters preserve the TrustedType union through Web IDL;
`Attr.value` remains a string boundary. Documents capture their construction
Window even when detached, and adoption selects the destination document's
relevant global without changing existing platform identities.
4E's Attr node-value/text-content setters reuse the checked value operation.
Attribute changes queue real records through `NodeImpl.queueMutationRecord()`.
Slot/slottable name changes recompute assignments through 4H's shared algorithms;
notification uses 4G's checkpoint. Custom-element reactions remain with their
own roadmap.

4E makes `CharacterDataImpl.replaceData()` the shared path for data assignment,
append/insert/delete, and the character-data `nodeValue`/`textContent` setters.
It validates UTF-16 offsets, queues the old data, updates live ranges, and then
notifies the parent. `Text.splitText()` inserts and retargets ranges before
truncation; `Node.normalize()` merges exclusive Text runs and retargets all
affected endpoints before removing the old nodes. `wholeText` includes adjacent
CDATA sections; normalization deliberately excludes
them. Element/DocumentFragment text-content writes use `stringReplaceAll()` and
the existing structural mutation path, even for unchanged text.

The current DOM replace-data algorithm also calls ProcessingInstruction's
`updateAttributesFromData()` unless its optional flag says attributes were
already updated. 4I replaces the approved provisional hook with pseudo-attribute
parsing and implements initialization, setters, Web IDL exposure, and document
construction. Character-data changes use the shared mutation-record operation and
4G's observer delivery, as do tree and attribute changes.

Public and parser tests cover topology, document ownership, and existing
extension behavior. Hooks requiring unfinished behavior still throw.
Participant status:

| Owner | Required operation or state |
| --- | --- |
| `../ranges/` | Live ranges register weakly by ordinary root. Structural mutation, CharacterData replacement, text splitting, and normalization adjust boundaries; inserting a detached root relocates registrations |
| `../traversal/` | Iterators register weakly by their fixed traversal root. Pre-removal visits ancestor-rooted iterators and adjusts both committed and in-flight candidate pointers |
| Mutation observers | Nodes retain registered observers and queue tree/attribute/character-data records. `MutationObserverImpl` owns weak observation targets, transient cleanup, and record queues. WindowAgent batches notification through its existing EventLoop; Web IDL projects callback arguments and reports exceptions |
| Slots | Element/Text compose `SlottableMixin` and expose `assignedSlot`. Null-namespace slot/name changes and structural mutations recompute assignments. `HTMLSlotElementImpl` owns named/manual assignment, fallback flattening, and signaling. Closed-root assignments remain hidden from authors; trusted bubbling change events follow observers |
| Custom elements | Registry association/state and lookup exist. `ElementImpl.tryToUpgrade()` currently finds no definitions; `enqueueCustomElementCallbackReaction()` throws if called. Definition registration, construction, and reactions remain absent |

Range and traversal are explicit components below nodes in the import hierarchy.
They retain concrete node types without loading node implementation classes;
operations can use the supplied nodes and their document factories. Review any
future runtime dependency in its own right, including Range's parsing and geometry
extensions. Each participant owns its weak index; the private link operations
have no Range or iterator state, and roots do not keep otherwise unreachable
participants alive.

Mutation traversals use bounded pointer walks. Ordinary walks do not cross shadow
roots; shadow-including walks visit a host's shadow tree before its light children.
Post-connection steps retain a collected snapshot because they can run script.
Tree-order and boundary cases are in `node.test.ts`.

The public and parser tests cover fragment insertion, reinsertion, retained
adoption, and Text/Comment constructor ownership. Structural mutation tests add
atomic replacement/move failures and live Range/NodeIterator adjustment. The
replace-all primitive is exercised through public text-content setters and 4F's
convenience mutations. Observer and slot-change delivery are implemented in 4G,
shadow assignment in 4H, and `[CEReactions]` remains with the custom-elements
roadmap. Completion of the full mutation path requires that final participant.

Range and traversal state belongs to those owners. Observer and slot delivery
use HTML's existing checkpoint; custom-element reactions must join that machinery.

## Attribute lookup and token-list performance follow-up

Attribute lookup currently scans the ordered `AttrImpl[]`. Measure typical small
attribute lists and larger lists before adding an index or replacing storage.
An index must distinguish qualified-name lookup from namespace/local-name lookup,
preserve first-match behavior for duplicate qualified names, and keep attribute
order, `Attr` identity, replacement, and removal consistent with `NamedNodeMap`.

`ElementImpl` lazily caches token-list objects by attribute name. Compare that map
with dedicated fields for common lists such as `classList` when profiling. The
cache retains object identity: attribute changes update the existing list, rather
than invalidating it and creating another. Retained lists must stay live through
attribute removal and replacement; a list also needs its element association so
mutations through a retained reference reach the correct owner.

Keep the existing attribute/NamedNodeMap tests and
[`token-list.test.ts`](../../../../test/browlet/dom/token-list.test.ts) plus
[`reflection/`](../../../../test/browlet/html/reflection/) as behavioral constraints
when changing either representation. Neither optimization is selected yet.

## Collections, tree mixins, and selectors (4F)

`Node.childNodes` and `ParentNode.children` retain stable collection objects.
`NodeListImpl` owns either a static result array or a live child view;
`HTMLCollectionImpl` owns a live filtered element view. Web IDL supplies their
indexed/named properties and iteration. Implementations use `item()` and
iteration, rather than pretending to be platform arrays.

Live views collect lazily and reuse their contents until the owning document's
collection revision changes. Private tree link operations and the common
attribute-change path advance that revision before lifecycle hooks can observe
the mutation. Adoption also checks document identity. This deliberately coarse
invalidation adds constant work to mutations; a change elsewhere in the document
can require recollecting a previously read view on its next access.

ParentNode and ChildNode convenience methods convert strings into Text nodes and
enter the existing mutation algorithms. Sibling methods retain a viable anchor
while argument assembly can move the receiver itself. Document replacement
validates while excluding its old children. NonElementParentNode is a declaration
shared by Document and DocumentFragment, including ShadowRoot through inheritance.

Each document lazily owns one Selectlet instance using its existing DOM adapter.
Public queries provide the scoping root and project fresh static NodeLists;
matching/closest share that engine, and parser failures become realm DOMExceptions.
TreeWalker is unnecessary because Selectlet already supports pointer traversal.
HTML states absent from the adapter (focus, editing, controls, media, and custom
elements) remain explicit dependencies for selectors that inspect those states.

Collection lookup regressions cover empty IDs, HTML/foreign tag-name case,
quirks-mode class matching, null-namespace ID/name/class attributes, and namespace prefixes. The existing
namespace validator and a retained element prefix supply the bounded construction
prerequisite; 4I completes the available document factories.

Public coverage is in `collections.test.ts`, `tree-mixins.test.ts`, and
`selectors.test.ts`; implementation lookup tests exercise the same collection
storage. MutationObserver, custom-element, and slot delivery remain outside 4F.

## HTMLAllCollection

[HTMLAllCollection](html-all-collection.ts) lives beside its owning Document and
reuses [HTMLCollection](collections.ts) for live element membership. It supplies
restricted name matching, name/index dispatch, and the cached, callable
`document.all` platform object. Web IDL owns the reusable indexed/named binding
algorithms. Public regressions are in
[all.test.ts](../../../../test/browlet/html/collections/all.test.ts).

### Native allocation and binding

Ordinary legacy platforms use `LegacyPlatformObjectBinding.createObject()` and
a JavaScript Proxy. Supplying an undetectable backing object to that path
is insufficient: wrapping it loses the required falsiness, typeof and loose
equality behavior.

A focused probe on the configured custom Node 27 runtime used V8's testing
intrinsic `%GetUndetectable()` and an otherwise empty Proxy around its result:

| Value | Boolean | typeof | == null | Call result |
| --- | --- | --- | --- | --- |
| Native object | false | `undefined` | true | null |
| Proxy around it | true | `function` | false | null |

The intrinsic was used only to establish the engine boundary, not as a proposed
production API. Blink's [binding generator](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/bindings/scripts/bind_gen/interface.py)
configures `HTMLAllCollection` with V8's public `SetCallAsFunctionHandler()` and
`MarkAsUndetectable()`. The compatibility addon now uses those public APIs in
`createHTMLDDA(context, call)`, with native regressions for calls, special checks,
realm ownership, direct property handlers, and garbage collection. No additional
V8 patch is needed. The factory invokes supplied call steps without interpreting
their arguments; HTML owns the collection's dispatch and conversion rules.

Web IDL's `HTMLAllCollectionBinding` reuses its indexed/named algorithms through the addon's direct
`setPropertyHandlers()` entry point. The older object-to-object delegate adapter
can split assignment and deletion between the native receiver and the backing
object; it is not the HTMLDDA path. The native callbacks now report physical own
properties and let mutation handlers return undefined for ordinary V8 behavior.
Web IDL intercepts collection properties; ordinary accessors and data properties
remain on the actual platform object. This preserves alternate receivers even on
Node 26+, whose property callbacks expose only the holder. No Node-version branch
is needed in Web IDL. Native and binding regressions cover these receiver cases.
HTML lookup/call steps remain in HTML, allocation in addon/JS Engine, and reusable
indexed/named behavior in Web IDL.

The declaration's `createHTMLAllCollection` hook is specific to this interface.
Native allocation for other objects need not share its undetectable callable and
property-handler contract. JS Engine's shared `isObject`/`isCallable` operations
handle its misleading `typeof`. Web IDL conversion, callback boundaries and
coercion use these predicates without separate author-value variants.
Recognition relies on the native factory's guaranteed callability, without a
temporary Proxy. Regressions cover callback conversion/results, overload and
union selection, nested values, synchronous/asynchronous iterator methods,
coercion, explicit unwrapping, interface projection, and stable platform identity.

Eric approved omitting `Document.prototype.all` when the native capability is
unavailable. Do not install a getter returning undefined or a truthy JavaScript
collection substitute. This is an intentional backend limitation, not an optional
HTML requirement. Native availability gates the exposed API; Node
upstreaming is not a prerequisite for the addon-backed implementation.

### Property enumeration order

`SPEC_CLASH(htmlallcollection-property-order)`: Web IDL's
[legacy [[OwnPropertyKeys]]](https://webidl.spec.whatwg.org/#legacy-platform-object-ownpropertykeys)
orders indices, visible collection names, ordinary own string properties, and
symbols. A live probe with a named element `entry` followed by an author-created
`accessor` property produced these string-key suffixes:

| Engine | Non-index own keys |
| --- | --- |
| Chromium | `accessor`, `entry` |
| Firefox | `entry`, `accessor` |
| WebKit | `entry`, `accessor` |

Browlet currently follows V8/Chromium. Eric approved retaining this clash for the
current slice and discussing an engine-level repair afterward. Native V8 merges
ordinary string keys before intercepted names, regardless of the names returned
by our handler. Keeping ordinary properties physical is what preserves accessor
receivers; an outer Proxy would destroy [[IsHTMLDDA]]. Do not describe this order
as spec-conforming. The focused collection and native tests retain the observed
order; an engine repair must update them to the Web IDL order.

### Assignment and separate receivers

`SPEC_CLASH(htmlallcollection-assignment)`: Web IDL's
[[Set]](https://webidl.spec.whatwg.org/#legacy-platform-object-set) ignores named
properties when obtaining the descriptor for ordinary assignment, but retains
indexed descriptors. For a collection containing a named element `entry`, a live
probe gave the following `Reflect.set()` results:

| Operation | Web IDL / Browlet | Chromium | Firefox / WebKit |
| --- | --- | --- | --- |
| Set `entry` on the collection | false | true (no replacement) | false |
| Set `entry` with a separate ordinary receiver | true; receiver gets the value | false | true; receiver gets the value |
| Set supported index `0` with a separate receiver | false | true | false |

Browlet follows the written rule and Firefox/WebKit. V8's query flags are separate
from the public property descriptor: the native binding permits named assignment
to a separate receiver, while the public descriptor remains read-only and the
collection's define handler rejects replacement. Indexed properties retain their
read-only query flag. This works through the existing addon, without an engine patch.

## Foundational mutation spine

| Source | Contract | Specification |
| --- | --- | --- |
| `node.ts` | Pre-insert validity, insert, append, replace, replace-all, move, pre-remove, remove, adoption, and their specified extension points | DOM §4.2.3, `#mutation-algorithms`; §4.5, `#concept-node-adopt` |
| `slottable.ts` and `html/scripting/slot.ts` | Slottable state and finding/assigning its slot; the slot owns its assigned-node list and change signaling | DOM §4.2.2, `#shadow-trees` |

Public node methods and HTML/XML parser adapters must enter through this
spine. Raw tree operations remain private storage primitives; they must not
become an alternate parser-only mutation model.

The implementation has to preserve the standard's observable ordering rather
than merely run every participant eventually. In particular it must:

1. validate the complete operation before changing pointers;
2. collect the nodes contributed by a `DocumentFragment` and adopt them where
   required;
3. adjust live ranges and run the traversal pre-remove participant at the
   specified mutation points;
4. perform the structural mutation and node-document updates;
5. assign slots and run DOM/HTML insertion, removal, moving, children-changed,
   and post-connection steps in their specified order;
6. enqueue custom-element reactions and mutation records without inventing a
   second callback scheduler.

This pipeline should offer narrow participant hooks owned by the consuming
subsystem. It should not import parser, custom-element, traversal, style, or
Range implementations into the low-level tree store.

## Cross-section prerequisites

| Consumer | Requirement from the mutation spine | Roadmap |
| --- | --- | --- |
| Live ranges | Boundary points are adjusted during insert, remove, move, character-data replacement, and text splitting | `../ranges/ROADMAP.md`, DOM §5 |
| Traversal | NodeIterator pre-removing steps run before removal; traversal owns iterator state | `../traversal/ROADMAP.md`, DOM §6.2 |
| MutationObserver and slots | Observer queues and signal slots live on the similar-origin Window agent and are delivered at its event loop's microtask checkpoint | `../../scripting/ROADMAP.md`, DOM §§4.2.2 and 4.3 |
| Custom elements | Attribute, insertion, removal, adoption, and upgrade reactions use the same operations as script and parsing | `html/custom-elements/ROADMAP.md`, HTML §4.13 |
| DOMTokenList | Every token update and external attribute change uses the same attribute-value and attribute-change paths | `../ROADMAP.md`, DOM §7 |
| Parsing | Tree builders call the same mutation and element-creation contracts, with only the explicitly specified parser suppressions | `../../html/parser/ROADMAP.md`, HTML §§13–14 |
| Selectors and style | Scope matching, tree scopes, connection state, and invalidation observe completed DOM mutations | `../infra/ROADMAP.md` and `../../style/ROADMAP.md` |

The participant seams for Range and NodeIterator must exist before the
mutation algorithms are considered complete, even if the complete public
Range and traversal APIs arrive in later slices.

## Mutation observers (4G)

| Source | Contract | Specification |
| --- | --- | --- |
| `mutation-observer.ts` | Observation options, weak observed and transient targets, record queues, and converted callback invocation | DOM §4.3, `#mutation-observers` and `#interface-mutationobserver` |
| `mutation-record.ts` | Retained mutation data and static `NodeList` objects | DOM §4.3.3, `#interface-mutationrecord` |
| `../../scripting/agents.ts` | WindowAgent creation counter, notification flag, pending observers, and signal slots | DOM §4.3 and HTML's existing microtask checkpoint |

Tree, attribute, and character-data mutation enter `NodeImpl.queueMutationRecord()`.
An ordinary-ancestor walk filters registrations and combines old-value requests,
queuing one record per interested observer. It does not cross a shadow host.
The observer tracks explicit and detached transient targets weakly. Records retain
the nodes they describe. Transient registrations are deduplicated by their original
source and removed at notification, re-observation, or disconnect. `takeRecords()`
drains records without ending transient observation.

The constructor takes its creation position from its environment's Window Agent.
Notification sorts pending observers by that position and snapshots slots before
calling authors.
Each observer drains its current records and clears transient registrations just
before its callback; earlier callbacks can therefore add records to or disconnect
later observers. Reentrant work queues another microtask. Binding supplies the
callback's receiver/arguments and reports exceptions without aborting the batch.
Slot-change events follow observers. Notification tests isolate signal batching;
4H's public slot tests exercise assignment-triggered delivery.

Coverage is in `mutation-observer.test.ts`, `mutation-record.test.ts`, and
`mutation-notification.test.ts`: option conversion, exact record contents and
identities, subtree cleanup, batching/reentrancy, callback exceptions, separate
Agents and shared-Agent realms, independent creation counters, collection of
unrecorded detached nodes, projection, and slot notification.

Checked against the published DOM Standard on 2026-10-10:
[notification](https://dom.spec.whatwg.org/#notify-mutation-observers) specifies
creation order, [record queuing](https://dom.spec.whatwg.org/#queue-a-mutation-record)
returns when no observers are interested, and
[transient registration](https://dom.spec.whatwg.org/#add-transient-registered-observers)
tracks detached nodes weakly and schedules cleanup even without records. These
behaviors are now specified; their former conflict and gap markers have been removed.

### Mutation-observer compatibility

Browser probes on 2026-10-10 used Chromium 149.0.7827.55, Firefox 151.0, and WebKit
26.5. The remaining callback-realm choice is explicit; revisit it when the
algorithms or engines converge.

- `SPEC_CLASH(mutation-observer-callback-realm)`: with an observer from one realm
  and its callback from another, Chromium allocates the array and records in the
  callback realm; Firefox/WebKit use the observer realm for both. Browlet retains
  its existing Web IDL contract, as approved: callback arrays use the callback
  realm, while records and their node lists retain the observer's binding owner.
  Target nodes and the observer retain their existing identities. Broader binding
  changes are deferred for separate review.

## Shadow trees (4H)

`Element.attachShadow()` validates host eligibility and converted options, retains
open/closed roots, and can reuse a compatible declarative root without replacing
its flags or identity. The current node document's factory owns root allocation.
`ShadowRootImpl` retains attachment flags, registry association, and the
`onslotchange` handler; the handler shares ordinary event-listener ordering.

`SlottableMixin` privately owns Element/Text assignment state; those nodes forward
the assignment members and slot lookup. `HTMLSlotElementImpl` owns
named and manual lists, flattened fallback lookup, and notifications. Manual
assignment uses weak ordered membership and a weak back-reference, so assigning
a detached node does not retain it. Public sequence conversion returns fresh
arrays; implementation state stays with its slot. Insertion, removal, moves, and
null-namespace name changes enter the same assignment algorithms.

Public coverage in `shadow-root.test.ts` and `html/scripting/slot.test.ts` includes
attachment errors/defaults, declarative reuse, adopted-document allocation,
closed exposure, event retargeting, ordinary-tree query boundaries, named/manual
assignment, fallback flattening, attribute changes, moves, and observer-before-slot
delivery. The declarative reuse test supplies parser-owned state directly; it
does not claim that declarative parsing is implemented.
Collection regressions retain each side of a manual assignment in turn and
verify that detached Element/Text nodes and their former slot can be reclaimed
after pending notifications drain, through both implementation and platform identities.

Stopping points: custom-element definitions and the definition's
disable-shadow check remain provisional with custom-element construction and
`[HTMLConstructor]`. Registry definition/initialization, ElementInternals attachment, focus
delegation, shadow style scopes, declarative parsing, and markup serialization
belong to their later consumers. 4I retains element `is` values and clones shadow
trees using their attachment flags; this does not implement custom-element construction.

### Shadow-tree compatibility

Probes on 2026-10-10 used Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5.
The approved choices are retained beside the implementation:

- `SPEC_CLASH(manual-slot-insertion)`: DOM's [insertion](https://dom.spec.whatwg.org/#concept-node-insert)
  and [moving](https://dom.spec.whatwg.org/#move) steps refresh only
  named assignments. All three engines also refresh a manual assignment when its
  node enters or returns to the host; Browlet follows them.
- `SPEC_CLASH(stale-assigned-slot)`: [assign slottables](https://dom.spec.whatwg.org/#assign-slotables)
  sets new assigned-slot pointers without clearing obsolete ones. Browlet follows
  all three engines and clears them; renaming or removing an assigned node must
  not leave its old slot in subsequent event paths.
- `SPEC_CLASH(adopted-shadow-root-realm)`: [create a node](https://dom.spec.whatwg.org/#concept-node-create)
  selects the node document's relevant realm. Browlet follows this rule and
  Firefox for an adopted host's new root. Chromium/WebKit keep the host's original
  realm. Existing host and shadow-root identities remain unchanged on adoption.
- `SPEC_CLASH(manual-slot-cross-root)`: HTML's [manual assignment](https://html.spec.whatwg.org/multipage/scripting.html#dom-slot-assign)
  recomputes only the receiving slot's tree. When it takes a node from a slot in
  another tree, Chromium leaves the previous slot's list stale. Browlet follows
  Firefox/WebKit: refresh the previous slot immediately, clear its obsolete
  event-path pointer, and signal the assignment change. Slots in the receiving
  tree keep their ordinary tree-order update; previous slots in other trees are
  refreshed afterward. The regression covers the list, event path, and notification.

The browser probe is retained in `scratch/dom-4h-probe.mjs` for these disagreements.

## Node and Document completion (4I)

Node now exposes names, constants, cloning, equality/identity, namespace lookup,
and complete document-position flags, including attributes and disconnected
nodes. Cloning copies ordinary trees and clonable shadow trees through existing
document allocators and mutation algorithms. Import uses the destination's realm
even for a borrowed method. Boolean and dictionary import options retain their
different depth defaults. Listeners and manual slot assignments are not copied.

Document factories validate names before mutation and distinguish HTML, XHTML,
and XML creation. `DOMImplementation` retains its associated document and creates
XMLDocument, doctypes, and an HTML document's initial tree without parsing.
`CDATASection` and `ProcessingInstruction` are projected, with XML construction
validation and pseudo-attribute parsing/mutation for ProcessingInstruction.
Cloning existing character data does not repeat public XML syntax validation.
Element adds tag-name casing, id/className reflection, and adjacent element/text
insertion through the same mutation path. Internal empty-string namespaces remain
compatible with the host-neutral selector/style contracts; platform getters return null.

DOM §6 supplies `Document.createTreeWalker()` and TreeWalker. DOM §7 supplies
`Element.classList` through the same attribute path. The ordered §4 interface
audit leaves the following explicit dependencies:

- `createEvent()` supports the exposed Event/CustomEvent interfaces and their
  legacy aliases. Other names throw NotSupportedError until their owning event
  interfaces are exposed, as required by DOM's exposure check.
- Custom-element registry selection and retained `is` values do not complete
  definition lookup, construction, upgrade, registry exposure, or `[CEReactions]`.
- HTML cloning steps for template contents, scripts, and form-control state
  remain with those implementations; `cloningSteps()` is their extension point.
- Shadow focus, style, declarative parsing, ElementInternals attachment, and serialization
  remain at their existing consumer gates.

Public coverage is in `cloning.test.ts`, `node-identity.test.ts`,
`namespace-lookup.test.ts`, `document-factories.test.ts`,
`processing-instruction.test.ts`, and `adjacent-insertion.test.ts`.

### Node completion compatibility

The 2026-10-10 probe used Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5:

- `SPEC_CLASH(document-xml-document-equality)`: DOM's [equality algorithm](https://dom.spec.whatwg.org/#concept-node-equals)
  requires the same interfaces. All three engines consider an empty Document
  equal to an empty XMLDocument. Browlet follows the engines for document nodes;
  other node families retain the interface distinction.
- `SPEC_GAP(processing-instruction-clone-attributes)`: [cloning a single node](https://dom.spec.whatwg.org/#concept-node-clone-single)
  copies a ProcessingInstruction's target and data without specifying how to
  initialize its new pseudo-attribute map. Browlet reparses the copied data.
  Thus setter-created names accepted by DOM but rejected by the XML parser do
  not survive as map entries after cloning, although the copied data is unchanged.
  None of the installed engines exposes the new pseudo-attribute API, so this
  choice has public Browlet regressions but no browser oracle yet.

Both choices were reviewed and approved. `scratch/dom-4i-probe.mjs` retains the probe.
The XML stylesheet parser represents pseudo-attributes as an ordered
`Map<string, string>` and signals a parse error with null. ProcessingInstruction
owns the map directly and replaces malformed input with an empty map; parsing
does not throw. This representation has been reviewed and accepted.

## Interface completion

| Family | Remaining contract | Specification |
| --- | --- | --- |
| `Node` and tree mixins | HTML cloning/mutation extension hooks and custom-element reactions | DOM §§4.2.4–4.4 |
| `Document` and `DOMImplementation` | Additional legacy event interfaces when exposed | DOM §§4.5–4.5.1 |
| `Element`, `Attr`, and `NamedNodeMap` | Custom-element reactions/registry exposure, class/token state, and remaining selector host states | DOM §§4.9–4.10 |
| `ShadowRoot` and `Slottable` | Shadow style scopes, custom-element definition checks/registry exposure, and serialization/focus consumers | DOM §§4.2.2, 4.2.9, and 4.8 |
| `CharacterData`, `Text`, and leaf nodes | Implemented for current DOM algorithms; ProcessingInstruction cloning gap recorded above | DOM §§4.6–4.7 and 4.10–4.14 |

HTML's `HTMLAllCollection` lives beside Document, with its native binding and
compatibility evidence [recorded above](#htmlallcollection). Form and options
collections stay with their concrete owners in [html/forms](html/forms/ROADMAP.md).
The standalone [DOMStringList](../string-list.ts) needs no node-collection
machinery; Document retains it for initialized ancestor origins.

## Behavioral coverage

The former `Node.textContent` TODO and Range `.data` expected failure now pass.
`character-data.test.ts`, `text.test.ts`, and `text-content.test.ts` cover UTF-16
operations, conversion ordering, unchanged-value mutation, attached/detached
splits, adopted-document allocation, normalization, live versus static ranges,
iterator pre-removal, and ordinary versus shadow-tree boundaries. Trusted Types
tests cover both inherited Attr setters, including null and reentrant detachment.

The insertion tests cover hierarchy rejection without partial mutation. Existing
Document, stylesheet, and CSP fixtures now build valid trees. Continue public
Browlet coverage for:

- all-or-nothing failure in replacement and movement;
- `DocumentFragment` splicing, cross-document adoption, and connection state;
- exact insertion/removal/reaction/observer ordering;
- live collection identity and updates;
- live Range and NodeIterator adjustment;
- equivalent observable mutation whether initiated by script or a parser.

## Milestone position

1. Implement the mutation spine and its Range/traversal/host participant seams
   before expanding node convenience APIs or parser behavior.
2. Agent-backed MutationObserver and slot delivery now use HTML's existing
   microtask checkpoint; slot assignment enters that path. Add custom-element reactions.
3. Live collections, attributes, CharacterData/Text, shadow trees, XML leaf nodes,
   and document factories are implemented, as are the core DOM §5 Range and §6
   traversal surfaces. Continue with §7 sets in its owning roadmap.
4. Revisit the remaining node hooks alongside custom elements, parsing, and
   concrete HTML element behavior rather than hiding these missing dependencies.

Blink keeps these classes largely flat in `core/dom`. Browlet's single
`nodes/` directory follows that useful boundary without copying Blink's
one-native-class-per-file scale.

## Removal condition

Burn this file after the missing object rows and incomplete existing
contracts have behavior tests through the public DOM surface.
