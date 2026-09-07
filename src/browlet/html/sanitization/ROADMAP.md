# HTML sanitization roadmap

HTML §8.6 defines a security-sensitive DOM transformation API. It is not an
event-loop prerequisite and should be implemented only after fragment parsing
and custom-element reaction integration are stable.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `sanitizer.ts` | `Sanitizer` state, construction, safe/unsafe element and fragment operations | HTML §8.6.2 |
| `config.ts` | Configuration dictionaries, canonicalization, invariants, defaults, and allow/remove/replace sets | HTML §8.6.3 |
| `algorithms.ts` | Element/attribute filtering, replacement, flattening, and safe-method restrictions | HTML §§8.6.4–8.6.5 |
| `web-idl.ts` | Sanitizer interfaces, dictionaries, enums, and Element/ShadowRoot contributions | HTML §8.6 |

Safe setters must not be aliases for unsafe parsing followed by a casual
blocklist. They require the specified baseline configuration, URL/namespace
handling, and custom-element/Trusted Types integration. Mutation still runs
through ordinary DOM algorithms and `[CEReactions]`.

## Removal condition

Burn this file once safe and unsafe markup APIs have distinct tested contracts
and every sanitizer configuration invariant is represented in source.
