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
`tree.ts` supplies protected pointer-storage primitives. `NodeImpl` owns the
mutation ordering and calls those primitives after its participants have run.
The 4B implementation supports ordinary tree mutations with explicitly
provisional participants; the full mutation path remains incomplete.

## Section 4 slices

Follow the dependency order below. Each slice uses public behavioral tests where
the interface exists; implementations receive already-converted values.

| Slice | Scope | Completion proof |
| --- | --- | --- |
| 4A. Tree validity | Pre-insert checks for parent/node kinds, host-including cycles, reference children, fragments, and Document hierarchy | `appendChild()` and `insertBefore()` reject invalid operations before changing either tree |
| 4B. Insert, remove, and adopt | One structural path, fragment splicing, node-document updates, and parser entry points | Public and parser mutations preserve topology, ownership, and ordering |
| 4C. Complete structural mutation | Replace, replace-all, move, and live Range/NodeIterator participation | Atomic failure, boundary-point adjustment, and iterator pre-removal through actual consumers |
| 4D. Attributes | Qualified names, namespaces, Attr, NamedNodeMap, and one attribute-change path | All attribute entry points preserve identity and notify the same participants |
| 4E. Character data | Replace-data, Text splitting, normalization, and text content | UTF-16 offsets, live ranges, and node-specific getters/setters behave consistently |
| 4F. Collections and tree mixins | Live/static NodeList and HTMLCollection, convenience mutation, and Selectlet-backed query APIs | Stable live views, static query results, scope matching, and shared mutation behavior |
| 4G. Mutation observers | Registered/transient observers, records, and agent-backed microtask delivery | Correct record contents, batching, reentrancy, and callback ordering |
| 4H. Shadow trees | ShadowRoot, attachment, slottables, assignment, and slotchange delivery | Shadow topology and slot changes use the same mutation and checkpoint machinery |
| 4I. Node and Document completion | Clone/import, equality, namespace lookup, document factories, DOMImplementation, XML leaf nodes, and remaining declared members | Public interface coverage followed by an ordered §4 audit |

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

**4B's structural slice is complete with provisional participants.** Public
and parser tests cover topology, document ownership, and existing extension
behavior. This does not complete the full mutation path: empty collections need
no work while their public construction or registration is unavailable, and
hooks which actually require missing behavior still throw. The remaining
participant contracts are:

| Owner | Required operation or state |
| --- | --- |
| `../ranges/` | `RangeImpl.adjustForInsertion(parent, index, count)` and `preRemove(node)` are empty hooks while construction is disabled. Implement live registrations and boundary-point adjustment together |
| `../traversal/` | `NodeIteratorImpl.preRemove(node)` is empty while construction is disabled. Implement iterator registration and pre-removal adjustment together |
| Mutation observers | Each node has a typed registered-observer list and owns `queueTreeMutationRecord(added, removed, previous, next)`. Record creation/delivery remains absent; observer construction is disabled |
| Slots | Element/Text compose `SlottableMixin` and expose `assignedSlot`. `HTMLSlotElementImpl` owns recognition, assigned-node state, `assignSlottables()`, and `signalSlotChange()`. Lookup handles no-slot and closed-root cases; actual assignment and delivery still throw |
| Custom elements | Registry association/state and lookup exist. `ElementImpl.tryToUpgrade()` currently finds no definitions; `enqueueCustomElementCallbackReaction()` throws if called. Definition registration, construction, and reactions remain absent |

Range and traversal are explicit components below nodes in the import hierarchy.
They retain concrete node types without loading node implementation classes;
operations can use the supplied nodes and their document factories. Review any
future runtime dependency in its own right, including Range's parsing and geometry
extensions. The static participant calls remain provisional, not a decision to
use global registries.

Mutation traversals use bounded pointer walks. Ordinary walks do not cross shadow
roots; shadow-including walks visit a host's shadow tree before its light children.
Post-connection steps retain a collected snapshot because they can run script.
Tree-order and boundary cases are in `node.test.ts`.

The passing public and parser tests cover fragment insertion, reinsertion,
retained adoption, and Text/Comment constructor ownership. Replace, replace-all,
move, and live Range/NodeIterator participation remain 4C work. Observer delivery
belongs to 4G, shadow assignment and signaling to 4H, and `[CEReactions]` to the
custom-elements roadmap. Completion of the full mutation path requires observable
tests with those real participants.

Range and traversal state belongs to those owners. Observer, slot, and
custom-element delivery must join HTML's existing checkpoint, not a new scheduler.

## Foundational mutation spine

| Source | Contract | Specification |
| --- | --- | --- |
| `node.ts` | Pre-insert validity, insert, append, pre-remove, remove, adoption, and their specified extension points; move, replace, and replace-all follow in 4C | DOM §4.2.3, `#mutation-algorithms`; §4.5, `#concept-node-adopt` |
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

## Mutation observers

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `mutation-observer.ts` | Complete the provisional observer identity and registered-observer types with observation, record queues, and callback delivery | DOM §4.3, `#mutation-observers` and `#interface-mutationobserver` |
| `mutation-record.ts` | `MutationRecord` | DOM §4.3.3, `#interface-mutationrecord` |

Each `WindowAgent` needs the specified mutation-observer-microtask flag,
pending-observer set, and signal-slot set. The DOM layer owns record creation
and delivery semantics; HTML's event loop owns the microtask checkpoint and
wake-up. Synchronous mutation algorithms can be implemented before the full
checkpoint, but observable observer and `slotchange` delivery cannot be
declared complete until that host machinery exists.

## Missing or unprojected objects

| Planned source | Contract | Specification |
| --- | --- | --- |
| `dom-implementation.ts` | `DOMImplementation` | DOM §4.5.1, `#interface-domimplementation` |
| `collections.ts` | Replace the temporary Array-backed collection with projected `NodeList` and `HTMLCollection` objects supporting live/static views and indexed/named access | DOM §4.2.10, `#old-style-collections` |
| `cdata-section.ts` | `CDATASection` | DOM §4.12, `#interface-cdatasection` |
| `processing-instruction.ts` | `ProcessingInstruction` | DOM §4.13, `#interface-processinginstruction` |

`CDATASection` and `ProcessingInstruction` are small, but they are prerequisites
for a faithful XML parser rather than prerequisites for the browser lifecycle
spine. `DOMImplementation` similarly follows the element/document construction
contract instead of defining it.

## Interface completion

| Family | Remaining contract | Specification |
| --- | --- | --- |
| `Node` and tree mixins | Complete tree constraints, cloning, equality, namespace lookup, text content, normalization, convenience mutation methods, selectors, and every declared member | DOM §§4.2.4–4.4 |
| `Document` and `DOMImplementation` | Complete construction, import/adopt, lookup, event, Range, traversal, and document-factory methods | DOM §§4.5–4.5.1 |
| `Element`, `Attr`, and `NamedNodeMap` | Complete qualified-name/namespace APIs, class/token state, shadow attachment, selectors, adjacent insertion, and attribute mutation semantics | DOM §§4.9–4.10 |
| `ShadowRoot` and `Slottable` | Complete tree-scope, slot-assignment, cloning/serialization flags, and public shadow-root behavior | DOM §§4.2.2, 4.2.7, and 4.8 |
| Collections | Implement live, identity-stable `NodeList` and `HTMLCollection` plus projected indexed/named behavior; replace snapshot/Array mechanics | DOM §4.2.10 |
| `CharacterData` and `Text` | Replace-data, substring/append/insert/delete, `splitText()`, `wholeText`, Range adjustment, and mutation records | DOM §§4.11–4.11.1 |
| Leaf nodes | Complete `DocumentType`, `DocumentFragment`, `CDATASection`, `ProcessingInstruction`, and `Comment` | DOM §§4.6–4.7 and 4.12–4.14 |

HTML's `HTMLAllCollection`, `HTMLFormControlsCollection`,
`HTMLOptionsCollection`, `RadioNodeList`, and `DOMStringList` build upon this
machinery but remain owned by `html/collections/`.

## Behavioral coverage

`test/browlet/dom/nodes/node.test.ts` retains an approved TODO regression for
the missing projected `Node.textContent` getter. Navigation testing observed
undefined for a parsed paragraph's text; its own parser check uses the existing
`Text.data` contract. Complete text content's node-specific getter and mutation
behavior with the Node interface work above.

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
2. Add agent-backed MutationObserver and slot delivery with the first real
   HTML microtask checkpoint and custom-element reactions.
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
