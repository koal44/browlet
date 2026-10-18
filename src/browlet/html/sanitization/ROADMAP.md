# HTML sanitization roadmap

HTML §8.6 defines a security-sensitive DOM transformation API. It is not an
event-loop prerequisite. Tree sanitization and safe markup setters follow stable
fragment parsing and custom-element reaction integration. Configuration
validation/copying can be a separate earlier slice when a consumer needs it.

[Trusted Types TT-C](../../browsing/policy/trusted-types/ROADMAP.md#later-slices-and-dependency-gates)
is such a consumer: parser-option policies require real Sanitizer construction,
presets, configuration invariants, and independent copies. Those contracts remain
owned here. They remain deferred after the completed TT-A/TT-B policy/attribute pass;
do not supply an empty Sanitizer or permissive placeholder to remove the dependency.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `sanitizer.ts` | `Sanitizer` state, construction, safe/unsafe element and fragment operations | HTML §8.6.2 |
| `config.ts` | Configuration dictionaries, canonicalization, invariants, defaults, and allow/remove/replace sets | HTML §8.6.3 |
| `algorithms.ts` | Element/attribute filtering, replacement, flattening, and safe-method restrictions | HTML §§8.6.4–8.6.5 |
| `web-idl.ts` | Sanitizer interfaces, dictionaries, enums, and Element/ShadowRoot contributions | HTML §8.6 |

Configuration and filtering also need the per-element sanitization categories,
default attribute allowances, and navigating URL attributes identified by
[HTML §3.2.4](https://html.spec.whatwg.org/multipage/dom.html#concept-element-sanitization).
Prototype `sanitization` records on the tag-specific implementations now cover
article, a, script, and form. Their definitions live in
[`dom/nodes/element-definitions/sanitization.ts`](../../dom/nodes/element-definitions/sanitization.ts), independently
of the HTMLElement implementation. Their numeric category distinguishes `Default`,
`Unsafe`, and `Uncategorized`; omitted attribute lists mean no element-specific
entries. The lists contain namespace-less HTML names. An absent record means
unfinished inventory and must not be treated as `Uncategorized` or allowed by
default. Continue the inventory alongside the individual element definitions.
Revisit that ownership when implementing this subsystem:
configuration construction can derive centralized lookups, while filtering and
configurable policy remain here. Combine the element facts with the sanitizer's
built-in configuration rules; do not infer them from reflection metadata or
supply permissive defaults.

Shared default attributes, event-handler removal, SVG/MathML names and namespaces,
URL inspection, and the remaining built-in lists are still dependencies of this
subsystem. Element content-attribute permissions do not supply sanitizer defaults.

Safe setters must not be aliases for unsafe parsing followed by a casual
blocklist. They require the specified baseline configuration, URL/namespace
handling, and custom-element/Trusted Types integration. Mutation still runs
through ordinary DOM algorithms and `[CEReactions]`.

## Removal condition

Burn this file once safe and unsafe markup APIs have distinct tested contracts
and every sanitizer configuration invariant is represented in source.
