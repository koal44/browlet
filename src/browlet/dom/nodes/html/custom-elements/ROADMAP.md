# Custom elements roadmap

## Present

- `names.ts` validates custom-element names for HTML element-interface selection.
- `registry.ts` retains the `CustomElementRegistry` identity, definition set,
  and constructor-identity lookup. Its declaration supports projection from the
  Document getter; public registry members and Window exposure remain absent.
- `definition.ts` supplies the name, local name, constructor identity, and
  construction stack consumed by [HTML §3.2.3](https://html.spec.whatwg.org/multipage/dom.html#html-element-constructors).
  Definitions are not publicly registered yet. Validation, lifecycle callbacks,
  observed attributes, disable-internals/shadow, and form association remain
  explicit dependencies of the definition algorithm.
- `integration/web-idl/html-constructor.ts` implements `[HTMLConstructor]` through
  the existing overridden-constructor binding path. It selects the active
  constructor's registry or current Document's registry, checks the interface,
  creates a custom element or consumes the last upgrade-stack entry, and returns
  its platform object. Web IDL owns prototype selection and cross-realm fallback.
  `WindowAgent.activeCustomElementConstructorMap` stores scoped construction's
  registry selection; construction/upgrade must still install and remove entries.
- Registry association, scoped-registry fields, and element construction state
  are retained by their owners. `NodeImpl.lookupCustomElementRegistry()` selects
  the association for Document, Element, or ShadowRoot.
- `ElementImpl.tryToUpgrade()` is provisional until definition registration and
  upgrade reactions are connected. `enqueueCustomElementCallbackReaction()`
  throws explicitly until callback definitions, queues, and delivery exist.
  Constructing an element with a test-supplied definition does not complete its
  mutation or connection lifecycle.
- `reactions.ts` owns the lifecycle callback argument types; reaction queues and
  delivery remain unimplemented.
- `element-internals.ts` supplies a minimal `ElementInternalsImpl` with its
  `targetElement`, separate weak element associations, and the specified
  `shadowRoot` getter. Reflection uses the target element's lazy internal
  content-attribute map; ordinary DOM writes do not reset internals' associations.
  Its Window interface is declared without an author constructor. Internal
  construction and projection are tested; `HTMLElement.attachInternals()` still
  needs definition lookup, disable-internals, construction-state, and repeated
  attachment checks. Those checks must not be bypassed to expose attachment early.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `definition.ts` and `registry.ts` | Validated definition registration and the remaining definition fields | HTML §§4.13.3–4.13.4 |
| existing `reactions.ts` | Reaction stacks, queues, backup queue, `[CEReactions]` entry/exit | HTML §4.13.6 |
| `upgrade.ts` | Upgrade candidates and upgrade algorithm | HTML §4.13.5 |
| `upgrade.ts` and element creation | Push/pop construction stacks, restore the active-constructor map, and finish upgrade success/failure | HTML §§4.13.3–4.13.5 |
| existing `element-internals.ts` and `HTMLElement` | `attachInternals()`, form-associated state/validation, and ARIAMixin declarations; accessibility consumers of internal defaults | HTML §4.13.7 |
| `custom-state-set.ts` | `CustomStateSet` and custom-state pseudo-class state | HTML §4.13.7.5 |
| existing `registry.ts` | Scoped registries, `whenDefined()`, upgrade candidates, and definition bookkeeping | HTML §§4.13.4–4.13.5 |

The first vertical slice joins the relevant `WindowAgent`'s reaction stack,
Web IDL `[CEReactions]` entry/exit, and the Priority 2 attribute-mutation path.
The Web IDL wrapper must surround the originally specified implementation
steps, invoke the popped queue, and then return or rethrow the original outcome.
It remains Browlet-supplied rather than becoming generic Web IDL behavior. Do
not install a no-op wrapper merely because declarations already retain the
extended attribute.

`BindingWorld` accepts Browlet's `ExtendedAttributeHooks` integration, used
for preparing reflection accessors and HTML constructor overrides. Extend that explicit
composition seam for reaction wrapping when implementing this slice; the current
`prepareAttribute` hook does not wrap operations, setters, or deleters. Preserve
the receiver's relevant agent when a method is borrowed across realms.

Continue with `Document.createElement*`, definitions and upgrade, then tree
connection/disconnection callbacks. HTML parsing consumes the same machinery
through "create an element for the token": it needs the intended parent and
scoped registry, synchronous constructor decision, parser-inserted state, and
a parser-owned reaction queue. The registry alone must not pretend those
reactions exist.

DOM's mutation spine owns pointer changes and the ordering of insertion,
removal, adoption, attribute, and post-connection extension points. This
directory owns the custom-element reactions invoked at those points. Neither
side should introduce a second tree-mutation path to simplify the integration.

Blink's `core/html/custom/*` separates definitions, registry, reactions, and
upgrade candidates. That is useful evidence for ownership, not a required
one-file-per-class pattern.

## Non-extensible upgrade clash

`SPEC_CLASH(html-constructor-nonextensible-upgrade)` follows HTML and Chromium,
as approved on 2026-10-17. The [constructor steps](https://html.spec.whatwg.org/multipage/dom.html#html-element-constructors)
propagate an exception from `[[SetPrototypeOf]]`, but do not reject a `false`
return. A non-extensible upgrade element therefore returns from `super()` with
its old prototype, and its stack entry becomes the already-constructed marker.
The implementation uses `Reflect.setPrototypeOf`, preserving that distinction.

A live probe appended an `x-frozen` element, prevented extensions, then defined
its class extending HTMLElement. Chromium 149.0.7827.55 returned the existing
element; Firefox 151.0 and WebKit 26.5 threw TypeError from `super()`. The old
prototype remained in all three. The local Blink source still contains an
explicit failure check and disagrees with this live Chromium result; it is not
evidence for the current binary. The focused constructor regression retains
the chosen result and stack consumption. Revisit if the specification or
engines converge.

## Removal condition

Burn this file after `[CEReactions]` has end-to-end tests and registry,
construction, and upgrade behavior is implemented.
