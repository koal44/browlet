# HTML roadmap

HTML node implementations, custom elements, and their declaration collection
live under `dom/nodes/html/`. This folder retains the parser and provisional
roadmaps for supporting HTML algorithms; it is not an umbrella runtime barrel.

## HTML section 1 and generated-index ownership

Section 1 explains the standard's scope, conformance model, design constraints,
and HTML-versus-XML distinction. It guides architecture and tests but creates
no Browlet runtime object. In particular, serializable script execution and
extensibility constrain `scripting/` and unknown-element handling without
justifying an `html/introduction` module.

The generated element, attribute, interface, event, header, and MIME indices
are completeness checklists, not another implementation domain. Use them to
audit the narrower roadmaps; do not mirror them in a catch-all registry. IANA
registrations describe protocol/documentation metadata. Runtime MIME and
header behavior remains with Fetch, the loader, and the owning API.

## HTML section 2 ownership

HTML's common infrastructure is deliberately distributed by responsibility;
there is no catch-all `html/infra` module.

| Section | Owner |
| --- | --- |
| §2.1.1 parallelism | `src/infra/parallel-queue.ts` for the cross-project serial queue; each consumer supplies host scheduling and retains its own algorithm state |
| §2.1.2 resources | `loader/` for resource lifecycles and critical subresources; the user-agent/transport boundary reports supported formats |
| §2.1.3 XML compatibility | `dom/` for namespace-aware trees; an eventual XML parser boundary, not the HTML parser, owns XML syntax |
| §2.1.4 DOM trees | `dom/` mutation primitives plus HTML insertion, post-connection, removing, and moving hooks |
| §2.1.5 scripting | `scripting/` and Web IDL; this subsection otherwise defines terminology rather than a new object |
| §2.1.6 plugins | `dom/nodes/html/embedded/` plus a user-agent content-handler capability |
| §2.1.7 character encodings | `html/parser/encoding.ts` over the Encoding Standard |
| §§2.1.8–2.1.9 conformance and dependencies | Test/documentation policy and project boundaries; no runtime module |
| §2.1.10 extensibility | Neutral unknown-element handling in the parser/DOM and feature exposure in the host's Web IDL assembly |
| §2.1.11 XPath and XSLT | `dom/xpath/` and `dom/xslt/` |
| §2.2 policy-controlled features | `browsing/policy/` |
| §2.3 common microsyntaxes | `html/microsyntaxes/`, with media-query evaluation delegated to `style/` |
| §2.4 URLs | `src/url` for URL semantics; Document, `<base>`, and `html/reflection/` for HTML integration |
| §2.5 fetching resources | `loader/` over the sibling `src/fetch` project; resource sniffing and parser encoding extraction retain their named dependencies |
| §§2.6.1–2.6.3 reflection | `html/reflection/`, with reusable value parsing in `html/microsyntaxes/` |
| §§2.6.4–2.6.5 collections | `html/collections/` over DOM live-collection machinery |
| §2.7 safe passing of structured data | `scripting/structured-data/` |

### Sections 2.1 and 2.2 audit

The 2026-10-10 pass found normative requirements among the terminology. They
belong to the existing owners, not new terminology or resource abstractions:

- Parallel-queue ordering already lives in Infra. Resource readiness and
  critical subresources belong to each loading algorithm; §2.1.2 alone does
  not establish one universal resource record or completion check.
- Namespace-based element identity and live DOM views use the existing DOM
  and binding machinery. Treating a value as absent or invalid for processing
  must not rewrite the stored DOM value.
- DOM mutations already invoke insertion, post-connection, removal, and move
  hooks. That dispatch does not complete HTML's §2.1.4 steps: form-owner resets,
  removal-time focus repair without blur/change events, popover hiding, and
  processing internal resource links (`link rel=expect`) await their owners.
  Insertion also needs the specified parser-inserted/open-element conditions;
  the current parser/style deferral is not a general substitute.
- Equal-value attribute assignments require consumer-specific review. The
  [base-URL clash](../dom/nodes/html/ROADMAP.md) follows the HTML reading and
  Firefox after review; the [style-block question](../style/ROADMAP.md#unchanged-style-type)
  stays with HTML style processing. DOM mutation notification remains unconditional.
- The conformance/dependency sections impose requirements on the referenced
  implementations, including JavaScript proposals, Intl, and Temporal. They
  do not establish that those implementations are complete. Optional plugin
  support must exclude `text/plain` and `application/octet-stream`; unknown
  markup stays in the DOM, and deliberately disabled features must be absent
  from exposed interfaces rather than present but throwing.
- XPath/XSLT have explicit HTML namespace and output-processing rules, retained
  in their [XPath](../dom/xpath/ROADMAP.md) and [XSLT](../dom/xslt/ROADMAP.md)
  roadmaps until those engines are implemented.
- §2.2 defines `autoplay`, `cross-origin-isolated`, and
  `focus-without-user-activation`, each with default allowlist `'self'`.
  [Permissions Policy](../browsing/policy/ROADMAP.md) still needs declared,
  inherited, and container policies plus actual feature checks. Register these
  defaults with that implementation, not in an unused standalone table.

The subsequent [§2.3 slices](microsyntaxes/ROADMAP.md) are complete within their
bounded scope. These passes identify remaining
dependencies, rather than marking §§2.1–2.2 fully implemented.

### Section 2.4 audit

The 2026-10-11 audit of [HTML §2.4](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#urls)
found the URL primitives and document-base selection in place. **§2.4.2 is now
implemented** on Document and the browser environment. Section 2.4 as a whole
remains incomplete: its base-change response now calls explicitly provisional
consumers. After reviewing the missing dependencies, Eric approved a basic script
implementation and typed stubs so the surrounding URL behavior remains testable.
The bounded pass can close with these explicit dependencies; this does not
complete browser UI, hyperlink state, script preparation, or speculative loading.

| Requirement | Current implementation and remaining work |
| --- | --- |
| §2.4.1 URL authoring terminology | These definitions distinguish valid authoring syntax from recoverable parser input. No standalone HTML conformance validator is present; do not make runtime parsing reject recoverable input merely to implement these definitions. |
| Reserved `about:` URLs | Fetch returns a network error for the unresolvable `legacy-compat`, `html-kind`, and `srcdoc` paths. Their identifiers still belong to the doctype, media-track, and iframe consumers. |
| `about:` matching | Document fallback implements the `about:blank` test, including permitted query/fragment components. There is no shared `about:srcdoc` matcher; future consumers must require a null query, while allowing a fragment. A URL spelling `about:srcdoc` does not itself make the Document an iframe srcdoc document. |
| §2.4.2 parsing wrappers | Document and BrowletEnvironment supply `parseHTMLURL()`, `encodingParseURL()`, and `encodingParseAndSerializeURL()`. They return a URL record/string or null on failure. `BrowletEnvironment.parseURL()` remains the explicit-base primitive; Fetch's Request/Response consumers already select `apiBaseURL` and UTF-8 themselves. |
| §2.4.3 document and fallback bases | Document selects the first descendant `base[href]` and its frozen URL, otherwise the specified fallback. The existing regressions cover changes, removal/reordering, about-base inheritance, and the reviewed equal-value-write clash. `<base>` deliberately parses against the fallback with the Document encoding, avoiding recursive base selection. |
| Set the Document URL and respond to base changes | `Document.setURL()` assigns first, then calls `respondToBaseURLChanges()`. Successful frozen-base updates also call it. Construction and cloning still assign initial URL state directly. The response connects the provisional UserAgent, Document, and Window consumers described below. |

The HTML parsing methods retain the owner's UserAgent for Blob URL resolution.
Encoding-aware Window parsing reads its associated **current Document**;
Document parsing uses that Document even when it is detached. Other settings
use UTF-8. The tests distinguish all three cases and cover live base selection,
replacement Documents, legacy query encoding, serialization, failure, and URL
parser recovery. `<base>` processing retains the explicit-base primitive.

**Base lookup cost.** `getBaseURL()` reads the retained `#firstBaseElement` or
the fallback; it does not traverse the document. `updateBaseElement()` searches
in ordinary tree order when a base is inserted, removed, moved, or changes href.
It stops at the first qualifying element, and ignores detached/shadow trees and
non-HTML or namespaced lookalikes. An index is not needed for repeated reads.

The 2026-10-11 local source audit found the same read/update split in all three
engines. These are implementation observations, not a new browser behavior probe:

- [Blink `Document::BaseURL()` / `ProcessBaseElement()`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/dom/document.cc):
  cached `base_url_` on reads; base-element traversal on relevant mutations.
- [Gecko `Document::GetDocBaseURI()`](https://github.com/mozilla-firefox/firefox/blob/main/dom/base/Document.h)
  reads the retained URI or fallback;
  [`SetBaseURIUsingFirstBaseWithHref()`](https://github.com/mozilla-firefox/firefox/blob/main/dom/html/HTMLSharedElement.cpp)
  searches the ordinary tree and stops at its first qualifying base.
- [WebKit `Document::baseURL()`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.h)
  reads `m_baseURL`;
  [`processBaseElement()`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.cpp)
  searches base descendants when their state changes.

The larger stopping point is [respond to base URL changes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#respond-to-base-url-changes):

- Notify the UserAgent to update affected browser UI before the other response
  steps. `UserAgent.updateURLDisplays(document)` is an explicit provisional
  no-op until a UI host supplies displays of URLs or data derived from them.
- Update hyperlink styling/state. Selectlet's script-visible selector behavior
  does not supply browser visited-link history or its rendering invalidation.
  `Document.updateLinkStates()` is an explicit provisional no-op;
  the [style integration roadmap](../style/ROADMAP.md) records the dependency.
- Reparse and update existing speculation-rule results on shadow-including
  descendant scripts. `HTMLScriptElementImpl` now supplies recognition, an
  initially uninitialized result, and its relevant Window from its existing realm.
  Parsed and created HTML scripts have their own platform interface, without
  reflected script members or preparation behavior yet.
  `Document.createSpeculationRulesParseResult(input)` currently initializes only
  the two-field record from [HTML §8.1.4.9](https://html.spec.whatwg.org/multipage/webappapis.html#speculation-rules-parse-results):
  `speculationRuleSet: null` and `errorToRethrow: null`. The shared type lives in
  `scripting/speculation-rules.ts`; real rule-set parsing and error capture remain
  missing. `Window.updateSpeculationRules(oldResult, newResult)` is a provisional
  no-op pending registration and queued error reporting. The response uses the
  current Document for parsing and the script's original Window for updating,
  including after adoption. When classic/module script and import-map records
  are added, extend the result union and distinguish speculation records here.
- Consider speculative loads. The [loader roadmap](../loader/ROADMAP.md) owns
  this missing subsystem under HTML §7.6. `Document.considerSpeculativeLoads()`
  is an explicit provisional no-op pending rule matching, candidate selection,
  prefetch, and prerender lifecycles.

The approved stubs preserve call ownership and sequencing for later slices;
they do not claim those effects are implemented. Changing a base must not restart an
already loaded image merely because its reflected URL would now differ.
The written frozen-base algorithm returns before notification for invalid,
forbidden-scheme, and CSP-blocked URLs; this draft preserves that return.
Its notification paths when the last base disappears or a valid base becomes
invalid still need review with the link-state consumer; returning the correct
base URL alone does not establish correct style invalidation.

Focused regressions cover assignment order, frozen-URL retention, notification
selection, UI notification before link state, and the real provisional path.
Script coverage checks interface selection, shadow-including update order,
immediate child text, and relevant-Window ownership after adoption. A separately
approved expected failure records the
existing parser callback evaluating `application/json` data blocks as JavaScript;
complete script preparation in HTML §4.12.1 must resolve it. The existing loaded-
srcdoc-iframe expected failure remains a separate iframe lifecycle gate.

**Proposed bounded follow-ups, for review:** first complete the nested branch
of browsing-context creation (creator/embedder state, inherited base/origin,
referrer, and policy/sandbox inputs). Then connect an iframe's initial
`about:blank` child through creation, container/parent associations, nested
history, and removal. That work spans HTML §4.8.5 and §7.3; the present
`Navigable.container` placeholder and embedded-sandboxing failure are explicit
dependencies, not reasons to claim an empty iframe is complete. Follow with
`srcdoc` using the existing Document and parser machinery, preserving its
distinct document flag and inherited base. Review further navigation, history,
and policy gaps as they appear. Speculation-rule processing and speculative
loads remain separate §7.6 work; they need not be the first loading excursion.

### Section 2.5 audit

The 2026-10-11 ordered audit implements the bounded §2.5.2 resource-reader
integration and §2.5.3 meta encoding extraction. The next review point is
**§2.5.4, CORS settings attributes**: raw attribute interpretation, reflection,
and element fetch consumers are not yet connected.

| Requirement | Current implementation and remaining work |
| --- | --- |
| §2.5.1 response terminology | FetchResponse already represents the six response types and exposes the underlying response through `isFilteredResponse()` and `internalResponse`. HTML's CORS-same-origin classification covers basic/cors/default; CORS-cross-origin covers opaque/opaqueredirect. Network errors belong to neither group. These definitions do not require another response representation. |
| §2.5.1 potential-CORS request | `UserAgent.createPotentialCORSRequest()` creates the existing FetchRequest with the required destination, mode, credentials mode, and use-URL-credentials flag. Its caller still supplies client and other feature-specific fields. Tests cover all three CORS states with and without same-origin fallback. Element fetch consumers and raw crossorigin attribute interpretation (§2.5.4) remain later work. |
| §2.5.2 resource type detection | Loader's ResourceReader retains response metadata, computes a MIME type with existing MIME algorithms, and preserves the bounded sniffed prefix and any pending read for subsequent consumption. Real HTTP tests pass the same reader to the HTML parser. General handler selection and actual content support remain explicit §7.5 gates. |
| §2.5.3 meta encoding extraction | `html/microsyntaxes/meta-encoding.ts` implements the shared string algorithm with Encoding's label lookup, below both future meta elements and parser consumers. Tests cover quoted/unquoted labels, repeated candidates, ASCII whitespace, and the deliberate differences from HTTP parameter parsing. Meta element processing, the encoding prescan, and restart remain §§4.2.5/13.2.3 work. |
| §2.5.4 CORS settings attributes | The request factory accepts an interpreted state, but `script` and `link` only list `crossOrigin` in IDL comments, without implementing the member. Their fetch/preparation algorithms and the image/media/iframe consumers remain unfinished. Continue here with attribute ownership and actual consumers rather than claiming the existing state union completes this section. |

The request factory lives on UserAgent, the owner retained by FetchRequest even
before an HTML caller selects a client. The same-origin fallback flag defaults
to false. This ownership choice has been reviewed; no Fetch protocol algorithm
was duplicated.

For §2.5.2, the [loader roadmap](../loader/ROADMAP.md#section-252-resource-reading)
records the implemented response/header owner and byte-prefix retention, plus
the remaining support policy and handler selection. `Navigable.loadHTMLDocument()` is specifically an HTML
consumer, not that selection layer. `UserAgent.supportsMIMEType()` currently
returns false as a provisional Resource Timing policy; wiring it into sniffing
does not establish browser content support.

§§2.5.5–2.5.9 remain unaudited in this pass: referrer policy, nonce, lazy loading,
blocking, and fetch priority attributes.
Their existing roadmap entries are dependency locations, not completion claims.

## HTML section 3 ownership

Section 3 defines the common Document and element substrate used by the
element-specific chapters. Its algorithms cross several Browlet domains, so it
must not become one oversized HTML Document module.

| Section | Owner |
| --- | --- |
| §3.1.1 `Document` object | `dom/nodes/document.ts` for the implementation and co-located HTML partial declaration; policy, scripting, and navigation retain their contributed state |
| §3.1.2 `DocumentOrShadowRoot` | DOM's mixin implementation; focus management supplies `activeElement` |
| §3.1.3 ancestor origins | Document lifecycle and `browsing/window/location.ts`, using referrer policy, origin records, and `html/collections/` |
| §3.1.4 resource metadata | Document accessors over URL, Fetch response metadata, cookies, and loader state |
| §3.1.5 document loading status | `html/parser/`, `loader/`, `scripting/`, and `performance/` coordination |
| §3.1.6 render blocking | `loader/` and `style/`, with the blocking set stored by Document |
| §3.1.7 DOM tree accessors | `dom/nodes/document.ts`, HTML element implementations, and live collection machinery |
| §§3.2.1 and 3.2.4–3.2.5 semantics, definitions, and content models | Element metadata, conformance tests, and accessibility; most authoring requirements create no runtime algorithm |
| §3.2.2 elements in the DOM | `dom/nodes/html/` over DOM Element, including unknown-element and namespace behavior |
| §3.2.3 HTML element constructors | `ctor.ts`, `dom/nodes/html/`, custom-element construction stacks, and Web IDL |
| §3.2.6 global attributes | `html/global-attributes.ts`, reflection, custom-element reactions, and Stylelet integration |
| §3.2.7 `innerText` | DOM mutation plus style/layout-derived text collection; it must not be approximated by `textContent` |
| §3.2.8 bidirectional requirements | Style/layout integration over Unicode bidirectional processing |
| §3.2.9 ARIA and accessibility APIs | A future `accessibility/` domain consuming semantic element state and the rendered tree |

## HTML section 4 ownership

Section 4 defines every HTML element, but only a small subset is prerequisite
to exercising Document loading and navigation. `dom/nodes/html/ROADMAP.md`
records that early slice and the complete element-family inventory.

| Section | Owner |
| --- | --- |
| §§4.1–4.2 document and metadata elements | `dom/nodes/html/document/` and `dom/nodes/html/metadata/`, with URL state in Document and loading in `loader/` |
| §§4.3–4.7 semantic, grouping, text, links, and edits | `dom/nodes/html/sections/`, `grouping/`, and `text/`; hyperlink activation crosses into `browsing/navigation/` |
| §4.8 embedded content | `dom/nodes/html/embedded/`; `iframe` delegates nested navigables to `browsing/`, while image and media resource work delegates to `loader/` |
| §§4.9–4.11 tables, forms, and interactive elements | Corresponding `dom/nodes/html/` areas, with form infrastructure retained under `forms/` and focus/input under the future `interaction/` domain |
| §4.12 scripting elements and canvas | `dom/nodes/html/scripting/` for script/template/slot; script execution belongs to `scripting/` and loading to `loader/`; canvas is a later graphics subsystem |
| §4.13 custom elements | `dom/nodes/html/custom-elements/`, integrated with DOM mutations and Web IDL `[CEReactions]` |

Element interfaces do not own the subsystems they expose. In particular,
`HTMLIFrameElement` does not own WindowProxy or navigation, `HTMLScriptElement`
does not own script records, and `HTMLLinkElement` does not own style-sheet
semantics.

## HTML section 5 ownership

Current HTML §5 defines Microdata attributes and extraction algorithms, but no
Microdata Web IDL interfaces. `html/microdata/` owns item/property discovery
and JSON extraction over the DOM; global-attribute reflection remains in
`html/global-attributes.ts`. See its narrower roadmap for the deliberately
deferred vocabulary conversions.

## HTML sections 8–9 ownership

These application APIs cross the full browser host and are deliberately not
collected under one HTML application module.

| Section | Owner |
| --- | --- |
| §8.1 scripting, host hooks, and event loops | `scripting/` |
| §§8.2–8.3 global-scope and base64 utilities | [`global-scope.ts`](../global-scope.ts) |
| §8.4 dynamic markup insertion | `html/parser/dynamic-markup.ts` |
| §8.5 DOM parsing and serialization | `dom/parsing/`, consuming `html/parser/fragment.ts` |
| §8.6 sanitization | `html/sanitization/` |
| §§8.7–8.8 timers and microtasks | `scripting/` over its event loop |
| §8.9 prompts and printing | Window methods over a future embedder/UI capability |
| §8.10 system state and Navigator | `navigator/` |
| §8.11 image data and bitmaps | `graphics/` |
| §8.12 animation frames | `scripting/animation-frame.ts`, integrated with rendering opportunities |
| §9 communication | `communication/`, consuming structured data and the target event loop |

## HTML sections 10–14 ownership

The final non-rendering chapters mostly select existing Browlet domains. The
syntax chapters are different: their parsers are early infrastructure, while
their DOM APIs and full navigation integration arrive in bounded slices.

| Section | Owner |
| --- | --- |
| §10 workers | `workers/`, consuming `scripting/`, `loader/`, communication, and storage-key machinery |
| §11 worklets | `worklets/` for shared infrastructure; concrete worklet globals remain with their defining specification |
| §12 Web Storage | `storage/` over a Storage Standard implementation and storage-key derivation |
| §13 HTML syntax | parse5 owns tokenizer/tree-builder semantics; `html/parser/` owns Browlet's DOM, script, encoding, fragment, and lifecycle adapter; `dom/parsing/` owns HTML fragment serialization |
| §14 XML syntax | `dom/parsing/xml-parser.ts` over a qualified strict evented XML 1.0 engine for character parsing; `loader/` later supplies XML navigation bytes and completion; `dom/parsing/xml-serializer.ts` owns serialization |

## HTML sections 15–16 ownership

Section 15 is optional only for a user agent that does not claim HTML's
suggested default rendering. Browlet's headless-browser direction does claim
that behavior eventually, but the section divides cleanly between style input
and a later renderer.

| Section | Owner |
| --- | --- |
| §15 introduction and box-derived predicates | `rendering/` for layout boxes, viewports, “being rendered”, intersection, and rendering delegation; observer APIs consume those results |
| §15 user-agent style sheet and presentational hints | `style/` for the HTML UA sheet and the author-origin, zero-specificity hint source; `html/microsyntaxes/` parses legacy attribute values |
| §15 ordinary and replaced content, widgets, frames, and print | `rendering/` consuming HTML element state, Stylelet computed styles, graphics/decoder capabilities, interaction state, and nested navigables |
| §15 interactive/native UI | `interaction/` plus an embedder UI capability for tooltips, editing carets, selection, navigation affordances, and native text direction |
| §15 unstyled XML documents | `rendering/` over namespace-aware DOM trees; this is a fallback view, not XML parser behavior |
| §16 obsolete authoring rules and warnings | Conformance tooling only; Browlet runtime must not reject obsolete markup merely because authors should not emit it |
| §16 implementation requirements | `html/legacy/` coordinates legacy elements, partial IDL, collections, no-op APIs, and `document.all`; `html/parser/` and `style/` retain syntax and presentational behavior |

Obsolete does not mean unimplemented. Section 16 deliberately retains public
interfaces such as `HTMLMarqueeElement`, `HTMLFrameElement`, legacy partial
members, and `External`. They are a later compatibility slice, not part of the
initial Document lifecycle.

## Present

- The HTML partial `Document` interface and its implemented members live with
  `dom/nodes/document.ts`; HTML does not define a second public Document class.
- HTML element implementations live under `dom/nodes/html/`. `web-idl.ts`
  retains their declaration collection alongside the custom-element registry;
  SVG and MathML retain their own collectors under `dom/nodes/`.

## Missing document-level contracts

| Planned source or owner | Contract | Specification |
| --- | --- | --- |
| `document.ts` only if the algorithms outgrow `dom/nodes/document.ts` | HTML Document coordination that cannot remain with a narrower loader, policy, timing, or node owner | HTML §3.1 |
| `global-attributes.ts` | HTML global attributes and shared element algorithms | HTML §3.2.6 |
| `document-metadata.ts` only if a shared record emerges | Metadata common to Document and response/navigation state that does not belong to an element or Fetch response | HTML §§3.1 and 7.5 |
| `microdata/` | Microdata item/property semantics and JSON extraction, without reviving the removed Microdata DOM API | HTML §5 |

Do not introduce `HTMLDocumentImpl`: HTML augments `Document`, and Browlet now
owns the DOM and HTML implementation in one project. Blink has an internal
`HTMLDocument`, but its shared document behavior still lives on `Document`;
that split does not solve a Browlet boundary problem.

## Removal condition

Burn this file when HTML's common infrastructure and Document augmentation
have explicit, tested owners and Sections 4–16 are represented entirely by
their narrower roadmaps or implemented source.
