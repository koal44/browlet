# DOM XSLT roadmap

## Status: optional, implementation undecided

[HTML §2.1.11](https://html.spec.whatwg.org/multipage/infrastructure.html#interactions-with-xpath-and-xslt)
now explicitly discourages client-side XSLT and warns that it is being removed
from the web platform. As checked on 2026-10-12,
[Chromium's published plan](https://developer.chrome.com/docs/web-platform/deprecating-xslt)
targets Chrome 158 (2026-11-17) for disabling it on Stable, with temporary
origin-trial and enterprise exceptions. This is a planned transition, not a
claim that all browsers have already removed it.

The entries below preserve implementation requirements if Browlet elects to
support XSLT; they are not a commitment to implement it. Reassess browser support
and an actual Browlet use case before selecting an engine. XPath remains an
independent feature and is not deferred by this XSLT decision.

## Standards boundary

DOM §9 preserves the `XSLTProcessor` Web IDL but explicitly does not provide a
complete behavioral definition. HTML §2.1.11 adds DOM-output rules and also
acknowledges that XSLT's parser, navigation, event-loop, and error-page
integration remain incompletely specified. The short interface is therefore
not a small transcription task.

**SPEC_CLASH(html-xslt-dom-output): HTML overrides XSLT 1.0 DOM output.**
[HTML's required override](https://html.spec.whatwg.org/multipage/infrastructure.html#dom-based-xslt-1.0-processors)
is explicitly described as a willful violation: for the HTML output method,
no-namespace elements acquire the HTML namespace, and their local names and
non-namespaced attribute names are ASCII-lowercased before DOM construction.
This does not alter serialized output. Any Browlet implementation must apply
the HTML rule rather than blindly forward an engine's DOM output.

## Planned surface

| Planned source | Contract | Specification |
| --- | --- | --- |
| `engine.ts` | Qualified XSLT 1.0 transformation capability, stylesheet compilation/import, parameters, reset, URI resolution, and result events/records | XSLT 1.0 plus interoperability tests |
| `processor.ts` | `XSLTProcessor` state and Web IDL operations without exposing engine-specific documents or values | DOM §9, `#interface-xsltprocessor` |
| `output.ts` | Translate transformation output through Browlet's Document/Element construction and mutation contracts | DOM §9; HTML §2.1.11 |
| `web-idl.ts` | `XSLTProcessor` definition, `[CEReactions]`, and parameter conversion boundary | DOM §9 |
| loader/parser integration when consumed | XML stylesheet processing instructions, imports/includes and `document()`, parsing completion, readiness, and navigation/error handling | HTML §§2.1.11, 7, 13–14; XSLT 1.0 |

## Engine and host boundary

This needs a real transformation engine. Blink delegates its implementation to
libxslt and wraps the result back into Blink DOM objects; Gecko carries a large
in-tree XPath/XSLT subsystem. Neither architecture supports casually rewriting
XSLT in the Browlet binding layer, and a native-only dependency would undermine
the portable TypeScript package boundary.

Qualify future JavaScript/Wasm/host candidates for XSLT 1.0 conformance,
XPath behavior, namespace handling, output methods, sorting, parameters,
imports/includes, extension behavior, deterministic failures, and supported
Node/browser builds. The engine must accept a controlled resource resolver:
never grant it direct filesystem or network access. Browlet's loader retains
URL resolution, Fetch, origin/policy, cancellation, and document-lifecycle
ownership.

DOM output must use Browlet's construction/mutation pipeline rather than an
engine-private tree. For the HTML output method, no-namespace elements become
HTML-namespace elements and their local names and non-namespaced attribute
names are ASCII-lowercased before construction. `transformToFragment()` and
`transformToDocument()` must run their specified `[CEReactions]` scopes and
return projected Browlet platform objects rather than engine-private wrappers.

Keep the synchronous `XSLTProcessor` API separate from XML navigation through
a stylesheet processing instruction. The latter additionally requires parser
termination, readiness transitions, loading, event-loop integration, and an
explicit error-page policy which the current standards do not completely
define.

## Delivery position

Treat XSLT as a late, optional browser-profile subsystem after XML parsing,
serialization, XPath, the DOM mutation/construction spine, Fetch/loader, and
document lifecycle are stable. It should not block ordinary HTML browsing,
style, scripting, or automation milestones.

## Removal condition

Burn this file once a qualified engine, the synchronous DOM API, HTML-output
rules, and any claimed XML-navigation integration have explicit behavioral
coverage and controlled resource access.
