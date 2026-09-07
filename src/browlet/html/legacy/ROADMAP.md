# HTML legacy compatibility roadmap

HTML §16 separates authoring conformance from user-agent behavior. Browlet does
not need a validator to run documents, but it must eventually preserve the
obsolete syntax and APIs that the standard still requires implementations to
support.

| Planned source or owner | Contract | Specification |
| --- | --- | --- |
| `elements.ts` plus `html/elements/legacy/` | Marquee, frame/frameset, directory, font, param, and other obsolete element identities and behavior | HTML §16.3 |
| `web-idl.ts` | Legacy element interfaces, partial element members, `Document`/`Window` contributions, and `External` | HTML §16.3 |
| `collections.ts` | `document.anchors`, empty `document.applets`, and `document.all`/`HTMLAllCollection` integration | HTML §16.3 and Web IDL legacy platform objects |
| `style/presentational-hints.ts` | Obsolete attributes that still map into the cascade | HTML §§15–16 |
| Existing `html/parser/` | Obsolete tokenizer/tree-builder behavior, including `plaintext`, `xmp`, framesets, and parser recovery | HTML §§13 and 16 |

Authoring warnings and replacement advice belong in a future conformance tool,
not runtime branches. Runtime parsing must accept the markup. No-op historical
methods should be implemented exactly as no-ops rather than routed through a
generic compatibility hook, while `document.all` must retain its specified
Web IDL exotic behavior instead of becoming an ordinary collection property.

This is deliberately later than `iframe`, ordinary forms, and the Document
lifecycle. Parser compatibility remains active from the start because parse5
already recognizes these names; specialized public interfaces and rendering
arrive as a bounded legacy slice.

## Removal condition

Burn this file once every required §16 implementation feature has implemented
source or a narrower element/style/collection owner, and authoring-only rules
are absent from the runtime.
