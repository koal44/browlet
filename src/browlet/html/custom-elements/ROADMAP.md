# Custom elements roadmap

## Present

- `registry.ts` reserves the `CustomElementRegistry` identity required by
  Document and realm setup. Most registry behavior remains absent.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| `definition.ts` | Custom-element definitions and constructor lookup | HTML §4.13.3 |
| `names.ts` | Valid custom-element names | HTML §4.13.3 |
| `reactions.ts` | Reaction stacks, queues, backup queue, `[CEReactions]` entry/exit | HTML §4.13.6 |
| `upgrade.ts` | Upgrade candidates and upgrade algorithm | HTML §4.13.5 |
| `construction-stack.ts` | HTMLElement constructor and construction-stack rules | HTML §4.13.3 |
| `element-internals.ts` | `ElementInternals`, shadow-root access, form-associated state/validation, and accessibility reflection | HTML §4.13.7 |
| `custom-state-set.ts` | `CustomStateSet` and custom-state pseudo-class state | HTML §4.13.7.5 |
| existing `registry.ts` | Scoped registries, `whenDefined()`, upgrade candidates, and definition bookkeeping | HTML §§4.13.4–4.13.5 |

The first vertical slice joins the relevant `WindowAgent`'s reaction stack,
Web IDL `[CEReactions]` entry/exit, and the Priority 2 attribute-mutation path.
The Web IDL wrapper must surround the originally specified implementation
steps, invoke the popped queue, and then return or rethrow the original outcome.
It remains Browlet-supplied rather than becoming generic Web IDL behavior. Do
not install a no-op wrapper merely because declarations already retain the
extended attribute.

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

## Removal condition

Burn this file after `[CEReactions]` has end-to-end tests and registry,
construction, and upgrade behavior is implemented.
