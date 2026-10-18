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

Configuration and filtering also need the per-element sanitization categories
and navigating URL attributes identified by
[HTML §3.2.4](https://html.spec.whatwg.org/multipage/dom.html#concept-element-sanitization).
That inventory is not implemented. The reviewed direction is to attach these
fixed facts to the tag-specific element implementation classes while reading
their definitions. Revisit that ownership when implementing this subsystem:
configuration construction can derive centralized lookups, while filtering and
configurable policy remain here. Combine the element facts with the sanitizer's
built-in configuration rules; do not infer them from reflection metadata or
supply permissive defaults.

Safe setters must not be aliases for unsafe parsing followed by a casual
blocklist. They require the specified baseline configuration, URL/namespace
handling, and custom-element/Trusted Types integration. Mutation still runs
through ordinary DOM algorithms and `[CEReactions]`.

## Removal condition

Burn this file once safe and unsafe markup APIs have distinct tested contracts
and every sanitizer configuration invariant is represented in source.
