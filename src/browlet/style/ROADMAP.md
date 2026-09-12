# Style integration roadmap

## Present

- `integration.ts` connects Browlet Documents/elements/tree scopes to Stylelet
  state and implements the current `DocumentOrShadowRoot`,
  `ElementCSSInlineStyle`, and `LinkStyle` host behavior.
- Stylelet exports those mixins' neutral declarations through
  `styleletIDLDefinitions`; Browlet contributes only their host behavior and
  assembles the declarations into its Web IDL bindings.
- Documents supply Stylelet's `RuntimeCaps` at construction; `StyleletContext`
  retains them alongside its normalized DOM access hooks. CSSOM replacement uses the
  owner's Promise facility and HTML's cooperative parallel scheduling; all
  Stylelet DOM exceptions use the host's factory. The standalone host uses
  native scheduling and DOMException without loading Browlet's engine runtime.

## Next boundary change

- [x] Move host-neutral Web IDL declaration contributions for Stylelet-owned
  CSSOM objects and mixins into the Stylelet package.
- [x] Let Browlet bind those declarations to Browlet-specific implementation
  adapters; let jsdom generate or bind its own wrappers from the same semantic
  contribution.
- [x] Keep style-sheet fetching and HTML `<link>` processing in `loader/` and
  HTML; keep semantic sheet/declaration mutation in Stylelet.
- [ ] Finish projecting `CSSStyleSheet` and the CSSOM objects it exposes through
  the active host's Web IDL binding. Stylelet retains their implementation
  state and mutation behavior. Verify the declared API surface as well as
  behavior: ambient `implements` clauses do not check the implementation's
  converted values, and declarations alone do not establish conformance.
- [ ] Restore `ObservableArray<CSSStyleSheet>` for `adoptedStyleSheets` once
  those platform objects exist. Web IDL already supports observable arrays;
  `TreeScope` should retain only the backing collection and CSSOM mutation
  steps, with conversion and proxy ownership in the binding. Move the proxy
  factory into Web IDL and remove `src/infra/observable-array.ts`.
- [ ] Exercise CSSOM exception and promise boundaries through the projected
  APIs, including borrowed cross-realm calls. Realize requested DOMExceptions
  in the operation's realm and preserve author-thrown exceptions. The runtime
  and exception-request providers are connected; complete CSSOM projection is
  still required to exercise this author-facing boundary.

The contracts come from CSSOM, CSSOM View, CSS Style Attributes, and HTML's
style/link processing rather than one WHATWG HTML section. This file records
the host boundary, not the CSS feature backlog.

HTML §2.3.10's “matches the environment” operation belongs at this boundary:
Stylelet owns media-query parsing/evaluation, while Browlet supplies the active
environment and the HTML empty/whitespace-list behavior.

## HTML rendering inputs

HTML §15 contributes two kinds of style input that Browlet must not bury in
element implementations:

- a versioned HTML user-agent style sheet at the UA cascade origin; and
- presentational hints derived from content attributes at the author origin
  with zero specificity.

`ua-sheet.ts` should own the former and `presentational-hints.ts` the latter.
Hint extraction consumes HTML microsyntax parsers and produces ordinary
Stylelet declarations; it must not mutate inline style or special-case the
computed-style resolver. This includes both current and obsolete attributes.

Stylelet decides cascade, inheritance, and computed values. The future
`rendering/` domain consumes those values to create boxes, replaced content,
widgets, and print output. Predicates such as “being rendered” cannot be
answered from `display` alone because SVG boxes, `display: contents`, native
widgets, and suppressed replaced content participate in the result.

## Removal condition

Burn this file after Stylelet owns its neutral declarations and Browlet's
integration is only the host adapter, HTML rendering inputs, and loader
connection.
