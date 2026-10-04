# Style integration roadmap

## Present

- `integration.ts` connects Browlet Documents/elements/tree scopes to Stylelet
  state and implements the current `DocumentOrShadowRoot`,
  `ElementCSSInlineStyle`, and `LinkStyle` host behavior.
- Stylelet exports those mixins' neutral declarations through
  `styleletIDLDefinitions`; Browlet contributes only their host behavior and
  assembles the declarations into its Web IDL bindings.
- Documents and CSSOM implementations retain their existing environment through
  `StyleletEnvironment`. UserAgent supplies `dom`; `env.exec` supplies the shared
  Promise and background scheduling plus `queueTask('dom-manipulation', steps)`
  for stylesheet delivery.
  There is no separate document execution adapter. Standalone Stylelet uses
  native scheduling without loading Browlet's engine runtime.
- The CSSOM exception factory remains provisional: Browlet's direct CSSOM
  APIs receive platform exceptions from the owning environment, while
  standalone hosts supply their own DOMExceptions. This prevents implementation
  objects from escaping through APIs that do not yet have member bindings.
  Full CSSOM bindings must project new failures in the invoking method's realm.
- Stylelet and Selectlet share Infra's `DOMOperations` through the `dom` option.
  Browlet supplies [implementation operations](../integration/dom.ts), including
  fast HTML class checks and access to existing inline-style state. Engines never
  read host node fields directly. Tests cover Browlet, jsdom, and opaque nodes
  that reject property access while preserving node identity.

## Next boundary change

- [x] Share DOM operations with Selectlet, retaining original node identities
  without requiring host nodes to implement either engine's structural types.
- [ ] Connect focus, editing, custom-element upgrade state, and form/media state
  as Browlet implements those HTML features. Its operations currently report
  the missing feature when requested. Do not synthesize
  checkedness, validity, or focus from attributes to satisfy Stylelet.
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
- [ ] Replace the provisional `projectWindow()` installation of `getComputedStyle`
  with Stylelet's CSSOM Window partial and projected style results. Its current
  adapter only unwraps the Element; it does not complete Web IDL conversion.
- [ ] Restore `ObservableArray<CSSStyleSheet>` for `adoptedStyleSheets` once
  those platform objects exist. Web IDL already supports observable arrays;
  `TreeScope` should retain only the backing collection and CSSOM mutation
  steps, with conversion and proxy ownership in the binding. Move the proxy
  factory into Web IDL and remove `src/infra/observable-array.ts`.
- [ ] Exercise CSSOM exception and promise boundaries through the projected
  APIs, including borrowed cross-realm calls. Replace the interim owner-realm
  exception factory with projection of DOMException implementations in the
  operation's realm, preserving author-thrown exceptions. Complete CSSOM
  projection is still required to exercise this boundary.

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
