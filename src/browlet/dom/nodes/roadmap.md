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
The existing `dom/infra/tree.ts` is useful pointer storage, but direct writes
through it do not yet provide that contract.

## Foundational mutation spine

| Planned source | Contract | Specification |
| --- | --- | --- |
| `mutation.ts` | Ensure pre-insert validity, pre-insert, insert, append, move, replace, replace-all, pre-remove, remove, adoption, and their specified extension points | DOM §4.2.3, `#mutation-algorithms` |
| `slots.ts` if the algorithms outgrow `slottable.ts` | Finding, assigning, and signaling slots and slottables; the concrete `HTMLSlotElement` remains owned by HTML | DOM §4.2.2, `#shadow-trees` |

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
| Live ranges | Boundary points are adjusted during insert, remove, move, character-data replacement, and text splitting | `../ranges/roadmap.md`, DOM §5 |
| Traversal | NodeIterator pre-removing steps run before removal; traversal owns iterator state | `../traversal/roadmap.md`, DOM §6.2 |
| MutationObserver and slots | Observer queues and signal slots live on the similar-origin Window agent and are delivered by its microtask checkpoint | `../../scripting/roadmap.md`, DOM §§4.2.2 and 4.3 |
| Custom elements | Attribute, insertion, removal, adoption, and upgrade reactions use the same operations as script and parsing | `../../html/custom-elements/roadmap.md`, HTML §4.13 |
| DOMTokenList | Every token update and external attribute change uses the same attribute-value and attribute-change paths | `../roadmap.md`, DOM §7 |
| Parsing | Tree builders call the same mutation and element-creation contracts, with only the explicitly specified parser suppressions | `../../html/parser/roadmap.md`, HTML §§13–14 |
| Selectors and style | Scope matching, tree scopes, connection state, and invalidation observe completed DOM mutations | `../infra/roadmap.md` and `../../style/roadmap.md` |

The participant seams for Range and NodeIterator must exist before the
mutation algorithms are considered complete, even if the complete public
Range and traversal APIs arrive in later slices.

## Mutation observers

| Planned source | Contract | Specification |
| --- | --- | --- |
| `mutation-observer.ts` | `MutationObserver`, registered and transient observers, record queues, and callback delivery | DOM §4.3, `#mutation-observers` and `#interface-mutationobserver` |
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

Review existing direct-implementation tests before refactoring. In particular,
tests must not preserve structurally invalid conveniences such as appending a
`Text` child to a `Document`. Establish public Browlet coverage for:

- document hierarchy validation and all-or-nothing failure;
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
