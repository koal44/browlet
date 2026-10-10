# DOM nodes roadmap

## Audit outcome

The directory currently covers the core `Node`, `Document`, `DocumentType`,
`DocumentFragment`, `ShadowRoot`, `Element`, `NamedNodeMap`, `Attr`,
`CharacterData`, `Text`, and `Comment` implementation families, together with
collections and the mixins already required by them.

Those familiar interfaces are not the difficult dependency in DOM §4. The
early prerequisite is one normative mutation path shared by script, parsers,
ranges, traversal, MutationObserver, shadow-slot assignment, custom-element
reactions, style/tree-scope invalidation, and HTML's insertion/removal hooks.
`NodeImpl` owns its tree links and mutation ordering. Its private storage
operations update links after the required mutation participants have run.
The 4B–4G implementation supports structural and text mutations with live Range,
NodeIterator, collection, and MutationObserver participants and a shared
attribute-change path. Slot-change notification is implemented; shadow assignment
and custom-element reactions still leave the full mutation path incomplete.

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
4E is implemented for the available node types; ProcessingInstruction's
attribute synchronization remains explicitly provisional below. Collections and
mutation observers are implemented in 4F/4G; shadow trees follow in 4H.
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
Slot/slottable name changes enter their assignment hooks, but assignment still
belongs to 4H; notification is implemented in 4G. Custom
element reactions remain with their own roadmap.

4E makes `CharacterDataImpl.replaceData()` the shared path for data assignment,
append/insert/delete, and the character-data `nodeValue`/`textContent` setters.
It validates UTF-16 offsets, queues the old data, updates live ranges, and then
notifies the parent. `Text.splitText()` inserts and retargets ranges before
truncation; `Node.normalize()` merges exclusive Text runs and retargets all
affected endpoints before removing the old nodes. `wholeText` includes adjacent
CDATA sections once that node class exists; normalization deliberately excludes
them. Element/DocumentFragment text-content writes use `stringReplaceAll()` and
the existing structural mutation path, even for unchanged text.

The current DOM replace-data algorithm also calls ProcessingInstruction's
`updateAttributesFromData()` unless its optional flag says attributes were
already updated. `ProcessingInstructionImpl` now supplies target/data storage
and an approved provisional no-op for this hook. Initialization validation,
pseudo-attribute algorithms, Web IDL exposure, and document construction remain
4I work. Character-data changes now use the shared mutation-record operation and
4G's observer delivery, as do tree and attribute changes.

Public and parser tests cover topology, document ownership, and existing
extension behavior. Hooks requiring unfinished behavior still throw.
Participant status:

| Owner | Required operation or state |
| --- | --- |
| `../ranges/` | Live ranges register weakly by ordinary root. Structural mutation, CharacterData replacement, text splitting, and normalization adjust boundaries; inserting a detached root relocates registrations |
| `../traversal/` | Iterators register weakly by their fixed traversal root. Pre-removal visits ancestor-rooted iterators and adjusts both committed and in-flight candidate pointers |
| Mutation observers | Nodes retain registered observers and queue tree/attribute/character-data records. `MutationObserverImpl` owns weak observation targets, transient cleanup, and record queues. WindowAgent batches notification through its existing EventLoop; Web IDL projects callback arguments and reports exceptions |
| Slots | Element/Text compose `SlottableMixin` and expose `assignedSlot`. Null-namespace slot/name changes enter assignment hooks. `HTMLSlotElementImpl` owns recognition, assigned-node state, assignment, and signaling. Lookup handles no-slot and closed-root cases; actual assignment still throws, while signaling delivers a trusted bubbling event after observers |
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
shadow assignment belongs to 4H, and `[CEReactions]` to the custom-elements roadmap. Completion
of the full mutation path requires observable tests with those real participants.

Range and traversal state belongs to those owners. Observer and slot delivery
use HTML's existing checkpoint; custom-element reactions must join that machinery.

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
prerequisite; broader factory completion remains in 4I.

Public coverage is in `collections.test.ts`, `tree-mixins.test.ts`, and
`selectors.test.ts`; implementation lookup tests exercise the same collection
storage. MutationObserver, custom-element, and slot delivery remain outside 4F.

## Foundational mutation spine

| Source | Contract | Specification |
| --- | --- | --- |
| `node.ts` | Pre-insert validity, insert, append, replace, replace-all, move, pre-remove, remove, adoption, and their specified extension points | DOM §4.2.3, `#mutation-algorithms`; §4.5, `#concept-node-adopt` |
| `slottable.ts` and `html/slot.ts` | Slottable state and finding/assigning its slot; the slot owns its assigned-node list and change signaling | DOM §4.2.2, `#shadow-trees` |

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
Slot-change events follow observers. Tests invoke slot signaling directly because
assignment and public `attachShadow()` remain 4H work.

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

## Missing or unprojected objects

| Planned source | Contract | Specification |
| --- | --- | --- |
| `dom-implementation.ts` | `DOMImplementation` | DOM §4.5.1, `#interface-domimplementation` |
| `cdata-section.ts` | `CDATASection` | DOM §4.12, `#interface-cdatasection` |
| `processing-instruction.ts` | Complete the provisional target/data implementation with validation, pseudo-attributes, document construction, and Web IDL exposure | DOM §4.13, `#interface-processinginstruction` |

`CDATASection` and `ProcessingInstruction` are small, but they are prerequisites
for a faithful XML parser rather than prerequisites for the browser lifecycle
spine. `DOMImplementation` similarly follows the element/document construction
contract instead of defining it.

## Interface completion

| Family | Remaining contract | Specification |
| --- | --- | --- |
| `Node` and tree mixins | Complete cloning, equality, namespace lookup, and remaining declared members; collections and convenience mutations are implemented | DOM §§4.2.4–4.4 |
| `Document` and `DOMImplementation` | Complete construction, import/adopt, lookup, event, Range, traversal, and document-factory methods | DOM §§4.5–4.5.1 |
| `Element`, `Attr`, and `NamedNodeMap` | Custom-element reactions, class/token state, shadow attachment, remaining selector host states, and adjacent insertion | DOM §§4.9–4.10 |
| `ShadowRoot` and `Slottable` | Complete tree-scope, slot-assignment, cloning/serialization flags, and public shadow-root behavior | DOM §§4.2.2, 4.2.7, and 4.8 |
| `CharacterData` and `Text` | Provisional ProcessingInstruction attribute-synchronization hook | DOM §§4.11–4.11.1 |
| Leaf nodes | Complete `DocumentType`, `DocumentFragment`, `CDATASection`, `ProcessingInstruction`, and `Comment` | DOM §§4.6–4.7 and 4.12–4.14 |

HTML's `HTMLAllCollection`, `HTMLFormControlsCollection`,
`HTMLOptionsCollection`, `RadioNodeList`, and `DOMStringList` build upon this
machinery but remain owned by `html/collections/`.

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
   microtask checkpoint. Add real slot assignment and custom-element reactions.
3. Complete live collections, attributes, CharacterData/Text, shadow trees,
   and the public node interfaces as consumers demand them.
4. Add the XML leaf nodes before the XML parser milestone; finish remaining
   convenience surfaces and `DOMImplementation` afterward.

Blink keeps these classes largely flat in `core/dom`. Browlet's single
`nodes/` directory follows that useful boundary without copying Blink's
one-native-class-per-file scale.

## Removal condition

Burn this file after the missing object rows and incomplete existing
contracts have behavior tests through the public DOM surface.
