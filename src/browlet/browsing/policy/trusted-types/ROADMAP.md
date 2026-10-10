# Trusted Types roadmap

TT-A/TT-B's Window factories, trusted values, policy callbacks, sink metadata,
default-policy processing, attribute enforcement, and CSP checks are implemented.
DOM 4D's accepted string-only dependency is closed, and 4E reuses its checked
attribute path for `Attr.nodeValue` and `textContent`;
the later branches are separate consumer gates.
[Project priority](../../../../PRIORITY.md) owns that order.

Reviewed against the [October 7, 2026 Working Draft](https://www.w3.org/TR/2026/WD-trusted-types-20261007/)
and the local `w3c-trusted-types/spec/index.bs`. Recheck the
[editor's draft](https://w3c.github.io/trusted-types/dist/spec/) when implementing
each branch. DOM supplies the attribute entry points; HTML supplies markup,
script, timer, and navigation consumers.

## Ownership and available dependencies

| Owner | Responsibility |
| --- | --- |
| `trusted-types/` | Trusted value implementations, policy callbacks and factories, sink metadata, default-policy processing, and compliant-value algorithms |
| [Global-scope mixin](../../../global-scope.ts) | One policy factory per global, including created policy names, the default policy, and empty trusted values; expose the `trustedTypes` partial beside the existing mixin declaration |
| [CSP](../csp/ROADMAP.md) | Directive matching, policy-creation restrictions, sink requirements, and violation creation/reporting |
| [DOM nodes](../../../dom/nodes/ROADMAP.md) | Invoke checks at the specified attribute entry points, then retain the existing mutation path |
| [Parsing](../../../dom/parsing/ROADMAP.md), [sanitization](../../../html/sanitization/ROADMAP.md), and [scripting](../../../scripting/ROADMAP.md) | Supply the later consumers and their actual parser, sanitizer, and execution behavior |

Web IDL already supplies interface identity, unions, dictionaries, callback
conversion/invocation, and realm-owned projection. Keep declarations beside their
implementations and reuse these facilities; implementations receive converted
callbacks and concrete trusted values, not Binding Context. Brand predicates on
author `any` values need binding-aware recognition without consulting overridable
properties or relying on the caller's realm-local prototypes.

The global owns the factory; UserAgent and BindingWorld must not share policy
names or a default policy between globals. Use existing environments for owner
selection. No additional environment object, ambient registry, or new scheduler
is required. CSP already retains arbitrary directive tokens and both dispositions,
and delivers Window violations; parsing a directive alone does not enforce it.

Trusted Types sits alongside CSP in `browsing/policy/`, with its own barrel
above CSP and below DOM nodes/global scope in the import hierarchy. Retain
type-only references to supplied owners; sink metadata consumes local names and
namespaces without loading or constructing HTML/SVG elements.
Review the later sanitizer entry's dependencies separately when it becomes real.

## Next slices

### TT-A: trusted values, policies, and the Window factory

Implemented. Projected tests cover callback conversion/identity, brands and
cross-realm ownership, factory state, sink metadata, and CSP checks/reporting:
[core tests](../../../../../test/browlet/browsing/policy/trusted-types/),
[CSP tests](../../../../../test/browlet/browsing/policy/csp/trusted-types.test.ts).
Generated declarations and their contract fixture include the supported API.

- Implement `TrustedHTML`, `TrustedScript`, and `TrustedScriptURL`, their immutable
  data, stringification/JSON behavior, and the `TrustedType` typedef. Authors
  obtain values through policies rather than public constructors.
- Implement `TrustedTypePolicy`, the three string callbacks, and
  `TrustedTypePolicyFactory`: creation, brand queries, empty values, default-policy
  state, and attribute/property type queries. Keep namespace/name metadata shared
  with the enforcement path rather than maintaining a second sink table.
- Include the `trusted-types` CSP policy-creation algorithm in this slice:
  allowlists, wildcard/`'none'`, duplicate names, the special default policy,
  multiple policies, and enforce/report-only violations. Never temporarily
  replace this dependency with an allow-all callback.
- Compose the factory into each Window's global-scope mixin. Bindings project
  the existing implementation graph and register the declarations.

Completion proof: projected factory/policy tests establish conversion order,
callback arguments and thrown-value propagation, missing/null callback results,
unforgeable brands across realms, policy-name restrictions, and independent
factory state. Explicit string-policy calls retain their specified empty-string
result for null callback results. No parser or script execution is required.

The current draft also declares `createParserOptions`, its callback, and
`TrustedHTMLParserOptions`. They remain absent until TT-C's real dependencies
exist; record the partial API in LIMITATIONS and generated-declaration coverage.
Do not register unresolved references to Sanitizer or substitute an empty type.

### TT-B: default policies and DOM attribute enforcement

Implemented through the existing attribute mutation path. The factory owns
compliant-string processing; Element selects it from its node document's
retained relevant Window. Documents capture that Window at construction, including
`new Document()`, without becoming the Window's associated active document.
Default callbacks return converted strings directly; the algorithm's temporary
trusted object need not be allocated just to read its data immediately.

Projected regressions cover [attribute checks](../../../../../test/browlet/browsing/policy/trusted-types/attributes.test.ts),
[default policies](../../../../../test/browlet/browsing/policy/trusted-types/default-policy.test.ts),
[callback ordering](../../../../../test/browlet/browsing/policy/trusted-types/attribute-callbacks.test.ts),
[ownership](../../../../../test/browlet/browsing/policy/trusted-types/attribute-ownership.test.ts),
and [CSP reporting](../../../../../test/browlet/browsing/policy/csp/trusted-types-sinks.test.ts).

- Implement compliant-string and compliant-attribute-value checks, including
  expected-type handling, default-policy calls, `require-trusted-types-for`, and
  sink-mismatch violations. Reuse CSP's report delivery. Callback exceptions
  propagate even in report-only mode; an unsuccessful conversion follows the
  specified report-only/enforcement decision. Test null default-policy results
  separately from TT-A's explicit policy calls; they signal failed conversion.
- Restore `(TrustedType or DOMString)` at the Element setter boundaries.
  Wire `setAttribute`, `setAttributeNS`, Attr attachment (including both
  NamedNodeMap setters), and attached `Attr.value` writes. Attr's own declared
  value type remains a string. Ordinary attributes and detached Attr values
  retain their specified behavior.
- Preserve the specified order around author callbacks: validation, current
  attribute lookup, attachment errors, and owner rechecks happen at their
  algorithm's actual steps. A default policy can detach or replace an Attr or
  adopt its element. Rejection must not add a DOM mutation, although author
  callbacks can make their own changes before throwing.
- Select enforcement from the element's node document's relevant global,
  including adopted nodes and inactive documents. Resolve any missing Document
  association explicitly; do not fall back to the method's realm or the current
  active Window. Keep existing Attr platform identity independent of adoption.

Enforce at DOM's specified entry points, not inside every append/change storage
primitive. Parser-created attributes and other internal mutations must not
accidentally acquire author-setter enforcement. This slice does not change
parse5, add parsing APIs, or implement event-handler compilation.

Completion proof: real Window bindings reject or transform protected attribute
values, produce correct CSP events/reports, and preserve mutation order and
identity. Cover no policy, enforce/report-only combinations, namespace/case
matching, ordinary attributes, wrong trusted types, every Attr/NamedNodeMap route,
borrowed methods, cross-realm values, adoption, and reentrant callbacks. These
tests can assert rejection or the stored attribute value without executing its
contents. Extend the selected WPT coverage only for supported paths.

TT-A resolves the draft's event-handler ambiguity with the explicit list recorded
below. Reuse it in attribute enforcement; an `on*` prefix heuristic is insufficient.
Keep newly found disagreements and missing dependencies visible for discussion.
Incomplete script/iframe implementations must not silently erase the applicable
name/namespace classifications.

**Stop after TT-B.** DOM 4E now reuses the checked existing-attribute-value
operation for `Attr.nodeValue`/`textContent`. Observer delivery stays in 4G, slot delivery
in 4H, and custom-element reactions in their owner; Trusted Types does not pull
those unfinished participants into this pass. The pending attribute mutation
record `SPEC_MISMATCH` stays for the observer implementation review.

## Later slices and dependency gates

These branches follow their consumers rather than one mandatory serial queue.
None is a prerequisite for TT-A/TT-B.

| Slice | Required dependency | Scope and stopping point |
| --- | --- | --- |
| TT-C. Trusted parser options | HTML-owned `SetHTMLUnsafeOptions`, Sanitizer/configuration/preset types, configuration validation/copying, and realm-correct Sanitizer construction | `TrustedHTMLParserOptions`, `createParserOptions`, its callback, and compliant-options processing. Configuration is independently testable; defer it rather than inventing a permissive Sanitizer. No tokenization/tree-builder changes belong here |
| TT-D. Markup consumers | The actual DOM/HTML parsing API, shared fragment/document parsing as applicable, and TT-C wherever parser options participate | Integrate each available markup sink, including the distinct HTML/XML and streaming rules. Safe setters additionally require real sanitization. Dynamic document writes need their active-parser lifecycle; a helper-only test does not complete the consumer |
| TT-E. Script and navigation consumers | HTML script preparation/trustedness, string-timer compilation, `javascript:` navigation, and the relevant JS Engine host hooks | Add each consumer with its owner. Parser-created script trustedness needs the real parser lifecycle. `HostGetCodeForEval` and `HostEnsureCanCompileStrings` remain [engine work](../../../../js-engine/ROADMAP.md#other-engine-hooks-and-facts); replacing global `eval` is not equivalent |
| TT-F. Workers | Worker globals/settings, CSP initialization and violation construction, script loading, and lifetime | Per-global factories and enforcement through actual worker consumers. Window-only tests do not establish Worker support |

Sanitizer configuration work can eventually be separated from tree walking;
its data model and invariants still belong to HTML sanitization. Full sanitization
and markup insertion wait for their parser/mutation prerequisites. parse5 retains
tokenization and tree construction, with browser-side integration owned by the
[parser roadmap](../../../html/parser/ROADMAP.md).

## Validation and closure

### Reviewed choices

**`SPEC_CLASH(trusted-types-policy-creation)`**, approved October 10, 2026:
follow the [CSP policy-creation algorithm](https://w3c.github.io/trusted-types/dist/spec/#should-block-create-policy).
Wildcard permits otherwise unusual names, and a duplicate `default` accepted by
CSP's `'allow-duplicates'` is rejected separately by the factory without a CSP
violation. Local source inspection found the same division in Gecko
(`dom/security/nsCSPUtils.cpp` and `TrustedTypePolicyFactory.cpp`). Chromium's
`core/frame/csp/trusted_types_directive.cc` and WebKit's
`page/csp/ContentSecurityPolicyTrustedTypesDirective.cpp` additionally apply name
character checks and reject duplicate `default` in the CSP check. The focused
CSP tests preserve the approved behavior, including report-only delivery.

**`SPEC_GAP(trusted-types-event-handler-attributes)`**, approved October 10, 2026:
the draft's [open issue #520](https://github.com/w3c/trusted-types/issues/520)
does not supply a definitive content-handler list. Use the standard HTML
GlobalEventHandlers/WindowEventHandlers names, standard contributions to those
mixins, and the Encrypted Media and SVG animation content handlers. This follows
the categories in [WPT's support list](https://github.com/web-platform-tests/wpt/blob/master/trusted-types/support/event-handler-attributes.mjs).
HTML's own legacy `onwebkit*` entries remain included. Arbitrary `on*` names,
non-content handlers such as `onopen`/`onreadystatechange`, and browser-specific
additions outside those standards remain excluded. Query tests cover all three
element namespaces and reject non-null attribute namespaces.

Browser source inspection confirms explicit name registries, with differing
coverage: Blink generates from all EventHandler IDL attributes, Gecko consults
its event-name registry excluding XUL, and WebKit uses `allEventHandlerNames()`.
Keep [sinks.ts](sinks.ts)'s list in sync when the relevant standards add handlers;
do not derive it from Browlet's presently incomplete exposed event-handler APIs.

### Checks

The selected [WPT suite](../../../../../wpt/suites/trusted-types.json) exercises
trusted attribute conversion, SVG sink queries, and Window factory exposure.
Enforcement WPTs still need CSP meta delivery; broader attribute matrices also
need reflected element properties; 4E supplies Attr node-value/text-content
behavior. Keep the remaining dependencies explicit rather than modifying upstream tests.

Put core tests under `test/browlet/browsing/policy/trusted-types/`; extend existing DOM attribute
and CSP suites at their actual entry points. Run focused public regressions with
each slice, declaration validation/generation, typechecking/lint, and the normal
build/test checks before closing the pass. Keep the broader WPT suite's missing
markup, script, sanitizer, and worker consumers explicit rather than weakening
their expectations to make this subset appear complete.

Remove 4D's provisional Trusted Types markers only when the corresponding checks
and regressions exist. Keep LIMITATIONS explicit about unsupported API members
and sinks; TT-A/TT-B completion does not establish complete Trusted Types
enforcement. Retire this roadmap when all retained consumer gates are implemented
or deliberately outside Browlet's supported profile.
