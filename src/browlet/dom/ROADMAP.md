# DOM roadmap

The local source follows the DOM Standard's major ownership boundaries. The
more focused roadmaps below are the implementation queues.

## Sections 1-3 audit

The 2026-09-28 audit of the implemented §1–3 algorithms is complete. Default
abort-reason creation and borrowed-method realm regressions are fixed; see
`abort/ROADMAP.md` for the browser disagreement. No further gap was found in the
current Window implementation. Continue at §4; the integration work below remains.

| Section | Current state | Boundary to close |
| --- | --- | --- |
| DOM §1, infrastructure | Tree topology, ordered sets, name validation, and Selectlet-backed public scope matching exist | Selector host states follow the owning HTML features; see `infra/ROADMAP.md` |
| DOM §2, events | Event/CustomEvent, EventTarget, dispatch/firing, timestamps, callback lifecycle, and Browlet signal-bound listeners exist | Complete the concrete HTML element, error-reporting, timing, and worker consumers in `events/ROADMAP.md` |
| DOM §3, aborting | Controller/signal projection, composition, retention, EventTarget integration, onabort, and active-time timeout delivery exist | Worker lifecycle and retention-evidence limits remain in `abort/ROADMAP.md` |

Event dispatch is synchronous. DOM §2 does not require an event loop merely to
dispatch or fire an event. A producer from HTML or another specification might
queue a task and then use DOM's firing algorithm; that producer remains the
owner of the scheduling. `AbortSignal.timeout()` is the first Sections 1-3 API
that directly requires HTML's timeout and global-task machinery.

## Near-term order from sections 1-3

1. Preserve DOM §1.3 scope matching through the public selector methods; extend
   their host states alongside the owning HTML implementations.
2. Extend event hooks with real HTML activation, error-reporting, and worker
   consumers. Keep synchronous DOM dispatch separate from producer-owned tasks.
3. Carry the implemented abort/timer contracts into worker lifecycle when it
   arrives; do not introduce a separate DOM timer or cancellation stack.

## Sections 4-5 audit

| Section | Current state | Boundary to close |
| --- | --- | --- |
| DOM §4, nodes | Slices 4A–4I implement mutation, collections/mixins, selectors, observers, shadow/slots, clone/import, namespace/equality queries, document factories, and XML leaf nodes; §7 supplies classList | Custom elements and HTML extension hooks retain their owner gates; see `nodes/ROADMAP.md` |
| DOM §4.3, mutation observers | Observation, records, transient cleanup, and Agent-backed microtask delivery are implemented | Recorded browser/spec differences remain in `nodes/ROADMAP.md`; slot assignment uses the same notification checkpoint |
| DOM §5, ranges | AbstractRange, StaticRange validity, and the complete DOM Range surface use the shared structural/text mutation path | HTML contextual fragments, CSSOM View geometry, and a WebKit collapse discrepancy stay in `ranges/ROADMAP.md` |

The [project priority](../../PRIORITY.md) divides DOM §4 into bounded work.
Its first DOM milestone is the mutation spine plus live Range and
NodeIterator participant points. MutationObserver and slot signaling now use the
HTML event loop; shadow assignment is implemented and custom-element reactions
remain separate work. The 4I interface audit records the outstanding cross-owner
dependencies without projecting placeholders for missing APIs.

## Sections 6-11 audit

| Section | Current state | Priority and boundary |
| --- | --- | --- |
| DOM §6, traversal | NodeFilter, NodeIterator, and TreeWalker are projected through the Document factories; NodeIterator participates in structural mutation | Core traversal is complete; compatibility evidence remains in `traversal/ROADMAP.md` |
| DOM §7, sets | DOMTokenList and stable Element.classList use the shared attribute mutation path, with indexed/iterable projection and stringification | HTML token attributes and custom-element reaction delivery remain with their owners |
| DOM §8, XPath | Absent | Late XML/query subsystem; the current DOM Standard preserves Web IDL but explicitly lacks complete behavioral definitions; see `xpath/ROADMAP.md` |
| DOM §9, XSLT | Absent | Late optional XML transformation subsystem requiring a qualified XSLT engine and HTML/parser/navigation integration; see `xslt/ROADMAP.md` |
| DOM §10, security and privacy | The section states that DOM itself has no known considerations | No runtime module. External XPath/XSLT engines still need Browlet-controlled resource and host-I/O boundaries |
| DOM §11, historical | No removed interfaces or members were found in Browlet source | Treat the list as an exclusion audit. Do not revive Mutation Events, Entity/Notation objects, DOM Level 3 configuration/user-data APIs, or removed node members |

## DOMStringList

HTML §2.6.5's [DOMStringList](string-list.ts) is a standalone string-list interface
beside DOMTokenList. It depends only on Web IDL, with no tree or form dependency.
Length, indexed reads, `item()`, and exact `contains()` membership use the associated
list directly, preserving order, duplicates, and exact strings. Its owner supplies
the list and determines whether it changes; replacing the owner's array variable
does not replace the retained list. New APIs should use sequences instead.

Document's ancestor-origins creation takes a fresh list of serialized origins and
retains a DOMStringList over that snapshot. Current top-level initialization
creates an empty list; nested ancestry still throws explicitly until its origin
chain and referrer-policy rules are implemented. The
[Window roadmap](../browsing/window/ROADMAP.md) records the separate
`Location.ancestorOrigins` getter and security integration.

Web IDL supplies conversion, readonly indexed properties, iteration, receiver
checks, realm ownership, and the non-constructible Window/Worker interface object.
The [string-list tests](../../../test/browlet/dom/string-list.test.ts) cover those
contracts, retained-list updates, and Document list identity. Worker exposure is
tested through Web IDL; actual Worker globals remain with the worker subsystem.
No additional dependency is missing from §2.6.5 itself.

## DOMTokenList

| Source | Contract | Specification |
| --- | --- | --- |
| `token-list.ts` | `DOMTokenList`, ordered token state, indexed/iterable projection, stringification, and live element-attribute synchronization | DOM §7, `#interface-domtokenlist` |

`DOMTokenListImpl` retains its owning Element and attribute local name.
`Element.classList` creates the list lazily and forwards matching attribute
changes to it. Tokens use an ordered, unique array for indexed access, parsed
only when the attribute changes. Writes use the existing attribute-value
algorithm, including observer records, collection invalidation, and the
custom-element enqueue hook. Binding supplies indexed properties, live Array
iteration, stringification, and `[PutForwards=value]` assignment.

Preserve the less obvious observable rules:

- validate every argument before changing the token set so multi-token calls
  fail atomically;
- preserve the raw attribute spelling for `value`/stringification until a
  token operation serializes the ordered set;
- keep `supports()` separate from token membership: the consuming
  specification supplies supported tokens, matching is ASCII case-insensitive,
  and attributes without such a definition throw `TypeError`; and
- use the existing Web IDL iterable/indexed machinery rather than making the
  implementation inherit from `Array`.

The [token-list tests](../../../test/browlet/dom/token-list.test.ts) cover
validation order, duplicate replacement order, operation-specific attribute
writes, raw spelling, all ordinary attribute entry points, mutation records,
live iteration, argument conversion, XML/foreign elements, selectors/collections,
and identity across realm borrowing, adoption, and cloning.

Custom-element reaction delivery remains the existing HTML dependency. The
mutating members declare `[CEReactions]` and reach the same enqueue hook as
other attribute setters; this pass does not complete the reaction stack.
HTML's `relList`, `sizes`, `blocking`, `sandbox`, and future token attributes
remain with their element implementations. They can supply supported tokens
and forward their attribute-change steps to the shared token-list implementation.

### Empty add compatibility

`SPEC_CLASH(domtokenlist-empty-add)` records one browser disagreement. DOM's
[update steps](https://dom.spec.whatwg.org/#concept-dtl-update) return without
writing when the attribute is absent and the token set is empty. Thus
`document.createElement('div').classList.add()` leaves `class` absent and queues
no mutation record. WebKit 26.5 agrees; Chromium 149.0.7827.55 and Firefox 151
instead create `class=""` and queue an attributes record with a null old value.
Browlet follows DOM and WebKit: an absent attribute remains absent, with no
mutation record queued. Keep the clash marker until the implementations converge.

The [2026-10-10 comparison](../../../scratch/DOM-7-PROBE.mjs) covers 207 cases
across raw attribute values, operations, validation order, mutation records,
iteration, conversion, and forwarding. WebKit matched all 207; Chromium and
Firefox each differed only on the absent-attribute, zero-argument `add()` case.
The ordinary mutation-record test retains the specification expectation, and
the comparison still reports the browser differences as failures.

## Late XML query and transformation

The `xpath/` and `xslt/` directories contain roadmaps only. Do not add empty
Web IDL shells before selecting and qualifying the underlying XPath 1.0 and
XSLT 1.0 engines: the interfaces would appear complete while their actual
contracts remained unspecified or absent.

Blink keeps these objects in `core/dom`; Browlet separates only the domains
large enough to carry their own algorithms.

## Removal condition

Burn this file when the narrower roadmaps or implemented source own all DOM
sections, `DOMTokenList` exists, and XPath/XSLT have either been implemented or
deliberately moved beyond Browlet's supported browser profile.
