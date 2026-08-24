# DOM roadmap

The local source follows the DOM Standard's major ownership boundaries. The
more focused roadmaps below are the implementation queues.

## Sections 1-3 audit

| Section | Current state | Boundary to close |
| --- | --- | --- |
| DOM §1, infrastructure | Tree topology, ordered sets, and name validation exist | DOM §1.3 scope matching is not yet exposed through the DOM selector APIs; see `infra/roadmap.md` |
| DOM §2, events | `Event`, `CustomEvent`, `EventTarget`, listener invocation, dispatch, and firing substantially exist | Replace the temporary native-`AbortSignal` path, finish shared timing ownership, and connect only the concrete HTML host hooks described in `events/roadmap.md` |
| DOM §3, aborting | Not implemented as Browlet platform objects | Implement the synchronous controller/signal core first; composition, retention, event-listener integration, and HTML-scheduled timeout behavior are mapped in `abort/roadmap.md` |

Event dispatch is synchronous. DOM §2 does not require an event loop merely to
dispatch or fire an event. A producer from HTML or another specification might
queue a task and then use DOM's firing algorithm; that producer remains the
owner of the scheduling. `AbortSignal.timeout()` is the first Sections 1-3 API
that directly requires HTML's timeout and global-task machinery.

## Near-term order from sections 1-3

1. Add the DOM §1.3 scope-match adapter over Selectlet and exercise it through
   the public DOM selector methods when their DOM §4 members are projected.
2. Implement the synchronous portion of DOM §3: `AbortController`,
   `AbortSignal.abort()`, `AbortSignal.any()`, abort reasons, abort algorithms,
   dependent signals, and abort-event ordering.
3. Change `AddEventListenerOptions.signal` from an unbranded object/native
   `AbortSignal` shortcut to the Browlet interface and its internal abort
   algorithm contract.
4. Route all event timestamps through the shared High Resolution Time clock.
5. Add `AbortSignal.timeout()` once HTML's active-time timeout and global timer
   task destination exist; do not substitute a direct Node timer in DOM.

## Sections 4-5 audit

| Section | Current state | Boundary to close |
| --- | --- | --- |
| DOM §4, nodes | Core implementation classes exist, but many public members, collections, shadow/slot behavior, and leaf types are partial or absent | Build one normative mutation spine before treating interface breadth as progress; see `nodes/roadmap.md` |
| DOM §4.3, mutation observers | Not implemented | Put observer/signal-slot state on the Window agent and deliver it through HTML's microtask checkpoint; DOM owns records and callback semantics |
| DOM §5, ranges | Not implemented | Establish boundary points and live-range mutation adjustment alongside the mutation spine; see `ranges/roadmap.md` |

The future project-priority file should not schedule “DOM §4” as one enormous
feature. Its first DOM milestone is the mutation spine plus live Range and
NodeIterator participant points. MutationObserver, slot signaling, and custom
element reactions form the next lifecycle milestone with the HTML event loop.
Public interface breadth, convenience methods, and XML-only leaf nodes can then
land in bounded consumer-driven slices.

## Sections 6-11 audit

| Section | Current state | Priority and boundary |
| --- | --- | --- |
| DOM §6, traversal | `Document` carries type-only factory declarations; the public objects are absent | Reserve NodeIterator pre-remove participation with the mutation spine, then implement the complete API as a bounded post-spine slice; see `traversal/roadmap.md` |
| DOM §7, sets | `DOMTokenList` is absent; ordered-set parsing/serialization already exists | Early interface-completion work because `classList` and several HTML token attributes exercise ordinary attribute mutation, CE reactions, observers, and style invalidation |
| DOM §8, XPath | Absent | Late XML/query subsystem; the current DOM Standard preserves Web IDL but explicitly lacks complete behavioral definitions; see `xpath/roadmap.md` |
| DOM §9, XSLT | Absent | Late optional XML transformation subsystem requiring a qualified XSLT engine and HTML/parser/navigation integration; see `xslt/roadmap.md` |
| DOM §10, security and privacy | The section states that DOM itself has no known considerations | No runtime module. External XPath/XSLT engines still need Browlet-controlled resource and host-I/O boundaries |
| DOM §11, historical | No removed interfaces or members were found in Browlet source | Treat the list as an exclusion audit. Do not revive Mutation Events, Entity/Notation objects, DOM Level 3 configuration/user-data APIs, or removed node members |

## DOMTokenList

| Planned source | Contract | Specification |
| --- | --- | --- |
| `token-list.ts` | `DOMTokenList`, ordered token state, indexed/iterable projection, stringification, and live element-attribute synchronization | DOM §7, `#interface-domtokenlist` |

`DOMTokenList` consumes `infra/ordered-set.ts`, but it is not merely a wrapper
around a `Set<string>`. Each instance belongs to an Element/attribute pair,
must be identity-stable for `[SameObject]` consumers, and updates through the
normal attribute-value algorithm. Attribute changes in any direction run its
attribute-change steps, so mutation records, custom-element reactions, and
style invalidation must not be bypassed.

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

Implement it after the normative attribute-mutation path and `[CEReactions]`,
then expose `Element.classList`. HTML's `relList`, `sizes`, `blocking`,
`sandbox`, and future token attributes reuse the same object with their own
supported-token definitions.

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
