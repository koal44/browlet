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
| §2.5 fetching resources | `dom/nodes/html/attributes/` for shared element attribute definitions below node implementations; `loader/` over the sibling `src/fetch` project for resource lifecycles; sniffing and parser encoding extraction retain their named dependencies |
| §§2.6.1–2.6.3 reflection | `html/reflection/`, with reusable value parsing in `html/microsyntaxes/` |
| §§2.6.4–2.6.5 collections | `dom/nodes/` and `dom/nodes/html/forms/` own implementations over shared live collections; `dom/string-list.ts` supplies the independent DOMStringList interface |
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
  Parsed and created HTML scripts have their own platform interface; the later
  §2.5 slices add fetch-attribute reflection, while preparation remains missing.
  `Document.createSpeculationRulesParseResult(input)` now invokes the
  [§8.1.4.9 parse-result constructor](../scripting/speculation-rules.ts), retaining
  a rule set or an author parse exception. The §7.6 parser explicitly throws
  InternalError until implemented, and the rule-set model is currently empty-only.
  `Window.updateSpeculationRules(oldResult, newResult)` removes the old set,
  registers the replacement, and queues any new parse error as a DOM manipulation
  task. The response uses the current Document for parsing and the script's
  original Window for updating, including after adoption. Tests supply parser
  results and preserve that ownership; the result union already distinguishes
  speculation results from classic/module scripts and import-map results.
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

The ordered audit implements the bounded §2.5.2 resource-reader integration,
§2.5.3 meta encoding extraction, and, as of 2026-10-12, §§2.5.4–2.5.5's shared
CORS/referrer attribute rules and reflection on the existing link/script elements.
The subsequent §2.5.7 slice connects the lazy-loading consumer to a provisional
observer and a provisional no-session automation hook; see below.
**Element fetch integration, document policy delivery, and custom-element
reactions** remain explicit dependencies, not completed by attribute reflection.

| Requirement | Current implementation and remaining work |
| --- | --- |
| §2.5.1 response terminology | FetchResponse already represents the six response types and exposes the underlying response through `isFilteredResponse()` and `internalResponse`. HTML's CORS-same-origin classification covers basic/cors/default; CORS-cross-origin covers opaque/opaqueredirect. Network errors belong to neither group. These definitions do not require another response representation. |
| §2.5.1 potential-CORS request | `UserAgent.createPotentialCORSRequest()` creates the existing FetchRequest with the required destination, mode, credentials mode, and use-URL-credentials flag. Its caller still supplies client and other feature-specific fields. Tests cover all three CORS states with and without same-origin fallback, including states interpreted from raw attribute values. Production element fetch consumers remain missing. |
| §2.5.2 resource type detection | Loader's ResourceReader retains response metadata, computes a MIME type with existing MIME algorithms, and preserves the bounded sniffed prefix and any pending read for subsequent consumption. Real HTTP tests pass the same reader to the HTML parser. General handler selection and actual content support remain explicit §7.5 gates. |
| §2.5.3 meta encoding extraction | `html/microsyntaxes/meta-encoding.ts` implements the shared string algorithm with Encoding's label lookup, below both future meta elements and parser consumers. Tests cover quoted/unquoted labels, repeated candidates, ASCII whitespace, and the deliberate differences from HTTP parameter parsing. Meta element processing, the encoding prescan, and restart remain §§4.2.5/13.2.3 work. |
| §2.5.4 keywords and defaults | `dom/nodes/html/attributes/cors.ts` reuses `EnumeratedAttribute`: ASCII-insensitive keywords without trimming; absence selects No CORS, while empty and invalid values select Anonymous. The shared definition also supplies canonical reflected keywords. |
| §2.5.4 credentials translation | `getCORSSettingsCredentialsMode()` implements the always-CORS translation: No CORS/Anonymous select `same-origin`, Use Credentials selects `include`. This deliberately differs from potential-CORS request creation, where No CORS selects `include`. The helper takes the already-interpreted attribute state used by the specification's switch; the rule needs no element argument. |
| §2.5.4 element consumers | Link and script expose nullable `crossOrigin` reflection through their actual Web IDL declarations, preserving raw text and using DOM mutation for writes/removal. Linked-resource processing (§4.2.4), script preparation/fetching (§§4.12.1/8.1.5), and image/audio/video implementations (§4.8) still need their request consumers. There is no iframe `crossorigin` attribute. `[CEReactions]` declarations and the DOM callback-enqueue hook remain visible; reaction stacks, delivery, and custom-element construction are unfinished §4.13 work. |
| §2.5.5 keywords and defaults | `dom/nodes/html/attributes/referrer-policy.ts` reuses Fetch's policy values and `EnumeratedAttribute`. Each keyword names its state, including the empty string; absent/invalid attributes select that empty state. Matching is ASCII-insensitive without trimming or header-style comma splitting. Fetch resolves an empty request policy from its policy container. |
| §2.5.5 reflection and request boundary | Link and script expose non-nullable `referrerPolicy` strings, limited to known values on reads while preserving assigned text. Tests carry the interpreted state through real Fetch request preparation to the outgoing Referer header. Production element loading remains with the same missing consumers as CORS; the other referrer-bearing element surfaces remain unimplemented. |
| §2.5.5 policy delivery and precedence | The section's precedence note summarizes separate owners: hyperlink `rel=noreferrer`, element attributes, meta referrer processing, and response-header policy delivery. The header parser, redirect updates, and request calculations exist. Hyperlink activation, meta processing, and navigation response-to-Document policy association do not; `Navigable.createNavigationParams()` already marks complete policy-container selection as missing. See the [policy roadmap](../browsing/policy/ROADMAP.md#referrer-policy). |

The CORS tests cover both the shared rules and real platform objects, including
Web IDL conversion, null/undefined removal, namespaced-attribute isolation,
attached Attr changes, and MutationObserver records for equal-value writes.
They do not certify resource loading or custom-element reaction delivery.
No fetching algorithm was replaced with a successful no-op to make this slice pass.

The referrer tests distinguish one attribute keyword from the response header's
comma-separated fallback list. Platform tests cover DOMString conversion,
empty-attribute creation, equal-value writes, namespaces, and attached Attr
changes. Unlike nullable `crossOrigin`, `referrerPolicy = null` stores `"null"`;
both its invalid spelling and an absent attribute read back as `""`.

**SPEC_CLASH(script-referrer-policy-null): script null/undefined assignments.**
[HTML's script IDL](https://html.spec.whatwg.org/multipage/scripting.html#htmlscriptelement)
declares non-nullable DOMString. The 2026-10-12 Playwright probe found Firefox
151.0 and WebKit 26.5 storing `"null"` / `"undefined"`, while Chromium 149.0.7827.55
removed the attribute for both inputs. All three use the HTML behavior for link.
The local [Blink script declaration](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/html_script_element.idl)
is nullable; [Gecko](https://github.com/mozilla-firefox/firefox/blob/main/dom/webidl/HTMLScriptElement.webidl)
and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLScriptElement.idl)
are not. Eric approved HTML/Firefox/WebKit: retain ordinary DOMString conversion,
with a regression in `test/browlet/dom/nodes/html/referrer-policy.test.ts`.

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

The remaining shared attributes (§§2.5.6–2.5.9) and reflection (§§2.6.1–2.6.3)
are covered below. The [collection overview](#collections-and-domstringlist) links the implementations
and their remaining owner dependencies.

### Section 2.5.6 nonce attributes

The shared `HTMLOrSVGOrMathMLElementMixin` in `dom/nodes/` owns the internal
nonce. HTML, SVG, and MathML implementations privately compose it and forward
the nonce member and lifecycle hooks. Generic XML elements do not include it.
The mixin's other members belong to their later HTML sections and remain TODOs.

| Requirement | Implementation and evidence |
| --- | --- |
| Initial value and IDL | `nonce` starts as the empty string. Ordinary DOMString conversion occurs in Web IDL; the setter only changes internal state, without changing attributes or queuing mutation records. HTML intentionally omits `[CEReactions]` on this member. |
| Content attribute changes | Null-namespace `nonce` writes, attached Attr updates/replacement, and removal update internal state through the existing DOM attribute-change hooks. Namespaced lookalikes do not. Empty/removal values clear the nonce; equal-value writes still run DOM's attribute-change steps. |
| Browsing-context connection | The insertion hook checks the shadow-including root's browsing context and current policy container, using CSP's existing `hasHeaderDeliveredPolicy()`. A nonempty content attribute becomes empty while the separately retained nonce is restored. Both enforce and report-only header policies qualify; meta-only policies and documents without a browsing context do not. |
| Observable mutation | Hiding uses normal attribute mutation, preserving MutationObserver records and selector/collection invalidation. Absent/empty attributes are not rewritten. Setting an attribute on an already connected element does not itself trigger the insertion algorithm. |
| Cloning | Each including implementation copies the internal nonce after DOM has cloned attributes. Deep clones and imports preserve it independently of the visible attribute. |
| Integration boundary | Existing parser attribute creation uses the same hooks. Navigation/meta CSP delivery and actual script/style fetch/inline checks remain with their owners; tests install real policy records directly, without claiming those missing consumers are complete. |

**SPEC_CLASH(nonce-empty-attribute): empty writes.**
[HTML §2.5.6](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#nonce-attributes)
sets the internal nonce to the new content-attribute value, including the empty
string. The 2026-10-12 Playwright probe found Firefox 151.0 and WebKit 26.5 doing
so for HTML/SVG, while Chromium 149.0.7827.55 retained the previous nonce after
`setAttribute('nonce', '')`. All three cleared it on removal. Eric approved
HTML/Firefox/WebKit; the empty-write regression retains that result.

**SPEC_CLASH(mathml-nonce): complete MathML inclusion.**
Current HTML includes MathML in the nonce mixin. In the same probe, WebKit
provided the property, attribute synchronization, connection-time hiding, and
cloning. Chromium provided the property and copied it, but did not synchronize
or hide the MathML attribute. Firefox exposed no nonce property; assignment
created an ordinary expando that cloning did not copy. Eric approved HTML/WebKit
for MathML. The same nonce contract tests run across all three namespaces.

Tests live in `test/browlet/dom/nodes/html/nonce.test.ts`. They cover real
platform conversion and mutation, header/meta/no-policy distinctions, shadow
subtree connection, adoption, cloning/importing, parser input, and generic XML
exclusion. CSP nonce matching itself remains in the existing policy tests.

### Section 2.5.7 lazy loading

The 2026-10-12 slice implements the HTML decisions and records the missing
dependencies explicitly. Eric accepted this bounded slice as complete; it does
**not** implement viewport-driven loading. The [Intersection Observer roadmap](../dom/intersection-observer/ROADMAP.md)
and [rendering roadmap](../rendering/ROADMAP.md) own the remaining dependencies.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| Lazy/Eager keywords and defaults | `dom/nodes/html/attributes/loading.ts` uses the common enumerated-attribute definition. Missing, empty, and invalid values select Eager. Matching is ASCII-insensitive without trimming. |
| Element state and reflection | Basic `HTMLImageElementImpl`, `HTMLIFrameElementImpl`, `HTMLMediaElementImpl`, `HTMLAudioElementImpl`, and `HTMLVideoElementImpl` live in `dom/nodes/html/embedded/`. Image, iframe, and media retain initially-null lazy-load resumption steps; video also retains initially-null poster steps. Their limited `loading` reflection uses normal DOM mutation. Other element APIs, constructors, and loaders remain unfinished. |
| Will lazy load | Each loading element asks its original `env.isScriptingEnabledFor(this)`, which checks settings policy and its current node document's browsing context, then tests the interpreted loading state. A detached element in an active document may qualify; a node belonging to a document without a browsing context may not. |
| Scripting disabled | `BrowletEnvironment.isScriptingEnabled()` accounts for Browlet's JavaScript support, a UserAgent scripting preference, and the original realm's currently associated document's sandbox flag. `UserAgent.webDriverBiDiScriptingIsEnabled(env)` has an approved provisional true result for the absence of BiDi sessions. Scoped override storage/selection remains unfinished. HTML's script runners now consume the same policy; script preparation/parser integration remains unfinished. |
| Document observer | Document retains one observer, creates it in its own environment with typed margins and the other IntersectionObserverInit defaults, and directly observes/unobserves implementation targets. The provisional observer now retains real registrations, options, callbacks, and entry queues. Complete option initialization, entry geometry, bindings, and automatic delivery remain in the [observer roadmap](../dom/intersection-observer/ROADMAP.md). |
| Intersection callback | Internal entries bypass author-replaceable iteration and getters. Resumption functions are captured before either runs; observation stops first, then each retained function is cleared immediately before invocation. Video poster loading can resume without a media continuation. |
| Becoming eager | The image, iframe, and media attribute-change hooks resume a retained load when the interpreted state changes from Lazy to Eager, including removal and invalid text. Same-state spelling changes and namespaced lookalikes do not resume it. Video captures both continuations before running either. |
| Scroll margin | HTML explicitly leaves the value to the implementation. UserAgent defaults to `100%` on each of four typed Stylelet sides, following WebKit's fallback, and Document captures them at observer creation without string parsing. Dynamic retuning remains the upstream [immutable-options issue](https://github.com/w3c/IntersectionObserver/issues/428), not a second local observer API. |
| Resource consumers | Image update/selection (§4.8.4), iframe attribute processing/navigation (§4.8.5), and media/poster loading (§4.8.8 onward) must install the actual continuation and call `element.nodeDocument.startObservingLazyLoadingElement(element)`. The new element classes do not synthesize a fetch, navigation, or successful media load. |
| Intersection delivery | Real root/target geometry, scroll clipping, thresholds, initial entries, queued notifications, and lifecycle/adoption behavior belong to Intersection Observer and rendering. The existing `updateIntersectionObservations` rendering phase is available but unconnected. This is the stopping point for this slice. |

The live [HTML callback](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#start-intersection-observing-a-lazy-loading-element),
checked on 2026-10-12, now says to continue when both resumption functions are
null. It agrees with Browlet's approved behavior and the prior Blink, Gecko,
and WebKit source evidence. The older local HTML snapshot still says return.
The resolved clash marker has been removed; the regression remains.

The section's red editorial warnings concern missing low-level observer hooks
([issue 464](https://github.com/w3c/IntersectionObserver/issues/464)), repeatedly
requiring original constructors/getters/methods and iteration immune to author
changes. Browlet uses implementation objects and indexed internal-entry access.
The separate [issue 428](https://github.com/w3c/IntersectionObserver/issues/428)
concerns dynamic margin suggestions versus immutable observer options. The
current integration captures its implementation-defined margin at construction;
dynamic retuning remains deferred. These upstream integration warnings do not
mean the otherwise specified HTML steps were omitted.

Tests cover attribute conversion/mutation, original-realm versus adopted-document
scripting eligibility, eager transitions, shared observer ownership, callback
ordering, poster-only work, and immunity to entry-array iterator replacement.
They use real Browlet realms, nodes, and observer registrations while controlling
the automation answer. The default spy calls the actual provisional no-session
hook. Explicit entry injection and direct notification
exercise the HTML consumer without claiming geometry or task-scheduling coverage.
The observer module no longer needs a Vitest mock or a temporary test resolver.
Its own tests cover registration history, independent observers, removal,
reobservation, queue draining, callback reentrancy, and adopted targets.
The provisional BiDi hook removes the missing-method dependency; it does not
implement automation override selection or make real lazy loading operational.

### Section 2.5.8 blocking attributes

The attribute and potential-blocking decisions are implemented. The Document
mechanism is now supplied by [§3.1.6](#section-316-render-blocking); resource-loading
integration remains a separate dependency, listed explicitly below.

| Requirement | Implementation and boundary |
| --- | --- |
| Supported tokens | `dom/nodes/html/attributes/blocking.ts` defines the supported `render` token and the blocking-tokens-set algorithm. It ASCII-lowercases and splits on ASCII whitespace, filters unknown tokens, and deduplicates without modifying the attribute. |
| Author API | Link, style, and script expose stable `DOMTokenList` objects through `[SameObject, PutForwards=value]`. The existing token-list implementation preserves raw spelling, retains unknown tokens, synchronizes through DOM attribute mutation, and supplies case-insensitive `supports()`. Token mutations and forwarded assignment retain the existing provisional custom-element reaction dependency. |
| Explicit potential blocking | The three element implementations interpret the shared blocking tokens. Arbitrary HTML elements and foreign-namespace lookalikes do not acquire a blocking attribute or qualify just because their attribute list contains `blocking="render"`. |
| Implicit stylesheet blocking | Style and stylesheet-link elements retain the document whose parser created them. They qualify while that document remains their node document; link additionally requires the ASCII-insensitive `stylesheet` relationship. Parser completion and detachment do not by themselves end potential eligibility. Clones/imports do not copy parser origin. |
| Implicit script blocking | A script must have prepared type `classic`, a non-null parser document, and no null-namespace `async` or `defer` attribute. `scriptType` stores the prepared type separately from the raw attribute. The parser supplies its document, but script preparation must populate the type and perform its specified parser-document clearing/restoration. The current ad hoc script handler still does neither preparation nor render blocking. |
| Parser integration | `HTMLTreeAdapter` calls each element's `initializeFromParser()` before adding attributes or inserting the element. The default hook needs no state; link/style/script retain their own association. XML and fragment parsing must enter the appropriate creation path when those consumers exist. This does not complete intended-parent, custom-element, force-async, or other script parser flags. |
| Actual rendering dependency | §3.1.6 supplies Document's blocking set, HTML-content/body eligibility, timeout predicate, disconnection/attribute cleanup, and rendering-opportunity filtering. Element loading/preparation must still add eligible blockers, remove them on completion/failure, and propagate actual blocking into Fetch request flags. The script-blocking stylesheet set is separate. |

**SPEC_CLASH(blocking-token-case): case-insensitive interpretation.**
[HTML §2.5.8](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#blocking-tokens-set)
explicitly lowercases tokens before filtering. The 2026-10-12 Chromium
149.0.7827.55 probe loaded delayed async scripts with `render`, `RENDER`, and
`Render`: Resource Timing reported `blocking` only for the lowercase spelling.
[Blink's implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/blocking_attribute.cc)
and [WebKit's script implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLScriptElement.cpp)
use case-sensitive membership. WebKit 26.5 did not expose the Resource Timing
field, so its rendering evidence here is source inspection, not a measured
timing result. Firefox 151.0 did not expose the `blocking` property on any of
the three elements. Eric approved HTML's case-insensitive interpretation;
the internal-predicate regression retains uppercase and mixed-case coverage.

Chromium and WebKit agreed on the public token-list cases: `supports('RENDER')`
is true, `contains()` is case-sensitive, raw spelling/unknown tokens remain,
and assignment forwards to the retained list's `value`. Their zero-argument
`add()` disagreement is the already-approved `domtokenlist-empty-add` clash,
not a new blocking-specific decision.

`test/browlet/dom/nodes/html/blocking.test.ts` covers the public contracts,
ordinary attribute/Attr mutation, namespaced lookalikes, cloning/adoption,
parser-origin stylesheet eligibility, and the script predicate with explicitly
supplied preparation output. It does not claim script preparation, real
resource loading, or paint scheduling coverage.

### Section 2.5.9 fetch-priority attributes

`dom/nodes/html/attributes/fetch-priority.ts` defines High, Low, and Auto using
Fetch's existing `RequestPriority` values. Missing, empty, and invalid attributes
select `auto`; valid keywords match ASCII case-insensitively without trimming.
Empty and otherwise invalid text still fail the authoring-syntax check.
The priority is a hint relative to requests with the same destination, not an
absolute queue position or a promise of completion order.

Image, link, and script expose `fetchPriority` through non-nullable DOMString
bindings, limited to known values on reads. Setters preserve the converted
text and use ordinary DOM attribute mutation. Parser-created attributes,
attached Attr changes, cloning/import/adoption, namespace isolation, and
MutationObserver delivery use the existing DOM mechanisms. `[CEReactions]`
remains declared with its existing unfinished delivery dependency.

**SPEC_CLASH(fetch-priority-case): ASCII-insensitive keywords.**
[HTML §2.5.9](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fetch-priority-attribute)
uses the [enumerated-attribute algorithm](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#keywords-and-enumerated-attributes).
The 2026-10-12 Playwright probe found Chromium 149.0.7827.55 and Firefox 151.0
recognizing uppercase/mixed-case keywords, while WebKit 26.5 returned `auto`
for `HIGH` and `LOW` on all three elements. Eric approved HTML/Chromium/Firefox;
the shared definition and platform tests retain case-folding regressions.
All three agreed on the tested absent/empty/invalid defaults, whitespace
rejection, raw-text preservation, null/undefined stringification, object
conversion, equal-write mutation records, and namespaced-attribute isolation.

The two `fetch-priority.test.ts` files under `test/browlet/dom/nodes/html/`
and its `attributes/` folder cover reflection and the shared state definition.
The latter also supplies that state to a real FetchRequest and verifies that
Fetch passes it to UserAgent's priority-selection hook. It does not simulate an
element loader or claim actual network scheduling. Remaining consumers are:

- Link processing options, preload/modulepreload, and HTTP Link processing
  (§4.2.4 and the relevant §4.6 link types) must transfer the selected hint.
- Image update/fetch algorithms (§4.8.4) must copy the current attribute state
  to the selected request at their specified steps.
- Script preparation (§4.12.1) must capture the state in script fetch options;
  the hint does not propagate to module imports (§4.12.1's attribute table).
- `UserAgent.determineFetchPriority()` remains provisional. Actual scheduling
  must consider the hint, destination, initiator, and render-blocking state.

These are existing loader/scheduler gates, not omitted steps in §2.5.9's
attribute definition. See the [loader roadmap](../loader/ROADMAP.md).

## HTML §§2.6.1–2.6.3 reflection

The [reflection roadmap](reflection/ROADMAP.md) records the shared adapter,
value algorithms, weak element associations, stable token views, and binding-owned
frozen-array cache. Existing fetching attributes, base target/href setters, and
slot name now use it. Internal consumers read raw attributes or associated-element
algorithms as §2.6.3 requires. The two approved browser clashes and unused
double-with-fallback specification gap are recorded there.

Minimal ElementInternals (§4.13.7) now provides internal defaults, separate
associations, and shadow-root access. Attachment still needs custom-element
definition/construction checks; reaction delivery (§4.13.6) remains provisional.
This reflection slice does not add ARIA or form-associated internals.

## Collections and DOMStringList

Collection implementations live with the state and algorithms they use. Shared
NodeList/HTMLCollection storage and live invalidation remain in
[DOM node collections](../dom/nodes/collections.ts); specialized form collections
retain their concrete element owners.

| Section | Implementation and remaining work |
| --- | --- |
| §2.6.4.1 HTMLAllCollection | [Document-owned live collection](../dom/nodes/html-all-collection.ts) and native callable binding. The [nodes roadmap](../dom/nodes/ROADMAP.md#htmlallcollection) retains the unsupported-backend policy and browser/specification clashes. |
| §2.6.4.2 HTMLFormControlsCollection and RadioNodeList | [Form collections](../dom/nodes/html/forms/form-controls-collection.ts) implement named lookup and radio values; form membership and radio-group exclusion remain explicit [owner dependencies](../dom/nodes/html/forms/ROADMAP.md#missing-owner-algorithms). |
| §2.6.4.3 HTMLOptionsCollection | [Options collection](../dom/nodes/html/forms/options-collection.ts) implements length/indexed mutations, add/remove, and selected-index forwarding. Automatic selection, selectedcontent, mutation hooks, and custom-element reactions remain with the [owners](../dom/nodes/html/forms/ROADMAP.md#missing-owner-algorithms). |
| §2.6.5 DOMStringList | [Independent string list](../dom/string-list.ts), retained by Document ancestry initialization. Its [DOM roadmap](../dom/ROADMAP.md#domstringlist) records the list contract; nested ancestry and [Location's getter/security integration](../browsing/window/ROADMAP.md) remain pending. |

The three approved form-membership, radio-group, and automatic-selection
regressions remain expected failures. These collection interfaces do not complete
their consumers' HTML §4.10 algorithms.

## HTML section 3 ownership

Section 3 defines the common Document and element substrate used by the
element-specific chapters. Its algorithms cross several Browlet domains, so it
must not become one oversized HTML Document module.

| Section | Owner |
| --- | --- |
| §3.1.1 `Document` object | `dom/nodes/document.ts` for the implementation and co-located HTML partial declaration; policy, scripting, and navigation retain their contributed state |
| §3.1.2 `DocumentOrShadowRoot` | DOM's mixin implementation; focus management supplies `activeElement` |
| §3.1.3 ancestor origins | Document lifecycle and `browsing/window/location.ts`, using referrer policy, origin records, and `dom/string-list.ts` |
| §3.1.4 resource metadata | Document accessors over URL, Fetch response metadata, cookies, and loader state |
| §3.1.5 document loading status | Document owns readiness and timing records; `html/parser/` and navigation drive transitions, while `performance/` exposes timing |
| §3.1.6 render blocking | `loader/` and `style/`, with the blocking set stored by Document |
| §3.1.7 DOM tree accessors | `dom/nodes/document.ts`, HTML element implementations, and live collection machinery |
| §§3.2.1 and 3.2.4–3.2.5 semantics, definitions, and content models | Element metadata, conformance tests, and accessibility; most authoring requirements create no runtime algorithm |
| §3.2.2 elements in the DOM | `dom/nodes/html/` over DOM Element, including unknown-element and namespace behavior |
| §3.2.3 HTML element constructors | `integration/web-idl/html-constructor.ts`, element declarations, custom-element definition/registry state, and Web IDL |
| §3.2.6 global attributes | `dom/nodes/html/attributes/` for shared definitions, HTML element implementations for instance behavior, plus reflection, custom-element reactions, and Stylelet integration |
| §3.2.7 `innerText` | DOM mutation plus style/layout-derived text collection; it must not be approximated by `textContent` |
| §3.2.8 bidirectional requirements | Style/layout integration over Unicode bidirectional processing |
| §3.2.9 ARIA and accessibility APIs | A future `accessibility/` domain consuming semantic element state and the rendered tree |

### Section 3.1 audit (2026-10-16)

Compared the implementation and executable declarations with the current
[HTML Documents section](https://html.spec.whatwg.org/multipage/dom.html#documents).
The HTML IDL comment in `document.ts` is an inventory, not evidence that those
members are implemented. The §3.1.1 slice below adds `referrer` and `readyState`
to the existing `all`, `head`, read-only `body`, `write`, and `defaultView` surface.

| Section | Present | Missing or incomplete |
| --- | --- | --- |
| §3.1 opening requirements | Document URL/origin/referrer state; both DOMImplementation factories now set the post-load-ready flag | URL and origin changes during later navigation/history/domain algorithms remain with those owners. |
| §3.1.1 Document | Required initial state, about-base-URL cloning hook, declaration types, and concrete dialog/SVG-script identities | Dialog lifecycle and the remaining HTML partial members are explicitly assigned below. |
| §3.1.2 DocumentOrShadowRoot | HTML partial declaration and shared `activeElement` getter, including retargeting and body/document-element fallback; Selectlet uses the same getter | `Document.focusedArea` is an explicit throwing dependency until §6.6 supplies focus state and its lifecycle. |
| §3.1.3 ancestor origins | Both list-creation algorithms, referrer-policy masking, retained string snapshots, and explicit parent input before activation | Child navigable/container association and fully-active ancestry remain explicit dependencies. `Location.ancestorOrigins` still needs its §7.2.4 relevant-document/security behavior. |
| §3.1.4 resource metadata | Referrer, non-HTTP access to the shared cookie store, retained response modification time, and local-time `lastModified` formatting | File navigation must supply filesystem modification times. The source-only route has no response headers; its modification time remains unknown. Cookie-averse browser differences are recorded below. |
| §3.1.5 loading status | Readiness-update algorithm, `readystatechange` dispatch/handler, HTML/XML parser lifecycle contract, load/unload timing records, and redirect flag | XML parser implementation and previous-document unload capture remain missing. Existing HTML routes use the shared transitions; full §13 completion scheduling remains provisional. |
| §3.1.6 render blocking | Document blocking set, HTML-content/body eligibility, timeout predicate, element block/unblock operations, disconnection/attribute cleanup, and rendering-opportunity filtering | Element preparation/loading must register and release actual pending work and populate Fetch request flags. Production rendering remains unfinished; script-blocking stylesheets remain a separate mechanism. |
| §3.1.7 tree accessors | HTML/SVG title, head/body accessors, stable live collections and plugins alias, live name lookup, currentScript state, and Document named properties with object/embed exposure | Object loading must update fallback state; child navigation must populate iframe content navigables; script execution must maintain currentScript. `dir` is defined with the later global attribute. Browser disagreements are recorded below. |

The audit first reproduced two omissions in
[`document.test.ts`](../../../test/browlet/dom/nodes/document.test.ts): both factory
flags remained false, and cloning lost the inherited base URI. The §3.1.1 slice
fixes both and retains the regressions, including shallow and deep cloning.

Continue with §3.2.3 after the §3.2.2 slice below. Preserve the existing boundaries: Document owns its state,
focus supplies active-element behavior, navigation supplies ancestry, loaders
consume render-blocking state, and Web IDL projects the resulting interfaces.

### Section 3.1.1 Document state and declarations

[`DocumentImpl`](../dom/nodes/document.ts) now accounts for every initial-state
item in [§3.1.1](https://html.spec.whatwg.org/multipage/dom.html#the-document-object):
policy container, permissions policy, module map, opener policy,
`isInitialAboutBlank`, `duringLoadingNavigationID`, `aboutBaseURL`,
`bfcacheBlockingDetails`, and `openDialogs`. Mutable containers are allocated per
document. HTML's cloning extension copies `aboutBaseURL` through Node's existing
cloning hook; navigation, policy, and dialog state are not copied by that hook.
The opening §3.1 factory requirement is applied in `DOMImplementation`, leaving
generic Document allocation's post-load-ready default unchanged.

Both Document enums and `HTMLOrSVGScriptElement` are registered declarations.
The existing referrer and readiness implementation state is now projected as
readonly attributes. The §3.1.5 slice below supplies readiness transitions.
The minimal [`HTMLDialogElementImpl`](../dom/nodes/html/interactive/dialog.ts)
and [`SVGScriptElementImpl`](../dom/nodes/svg/script-element.ts) supply concrete
implementation/platform identities for the list and typedef. Their specialized
APIs and lifecycle algorithms remain explicit TODOs; introducing these identities
does not implement dialog opening or SVG script execution.

The full copied Document IDL remains beside its executable declaration. These
are all its members and contributions, with the current implementation boundary:

| Members or contribution | State and next owner |
| --- | --- |
| `DocumentReadyState`, `DocumentVisibilityState`, `HTMLOrSVGScriptElement` | Registered in this slice; SVG script's remaining URI/attribute/execution dependencies are in its [roadmap](../dom/nodes/svg/ROADMAP.md). |
| `parseHTMLUnsafe`, `parseHTML` | Missing §8.5 parsing and §8.6 sanitization algorithms. `ParseHTMLUnsafeOptions`, `TrustedHTMLParserOptions`, and `SetHTMLOptions` remain undeclared dependencies. TrustedHTML values already exist; parser-specific policy/options processing does not. |
| `location`, `domain` | Missing §7.2 relevant-document, navigation, and origin/security behavior. Existing Location is still a URL snapshot; retain PutForwards/LegacyUnforgeable requirements when connecting it. |
| `referrer` | Implemented projection over existing Document state. |
| `cookie`, `lastModified` | Implemented §3.1.4 accessors over the shared cookie store and retained source metadata; file metadata awaits its loader. |
| `readyState` | Implemented projection and §3.1.5 readiness-update algorithm. |
| Anonymous named getter and `LegacyOverrideBuiltIns` | Implemented §3.1.7 selection/exposure, projection, and live collection identity; child/fallback producers remain explicit. |
| `title`, `body`, `head` | Implemented §3.1.7 HTML/SVG title, head/body getters, and body replacement/adoption. |
| `dir` | §3.2.6.4 forwards known-keyword reflection to the HTML html element; no such root means an empty getter and an ignored setter. |
| `images`, `embeds`, `plugins`, `links`, `forms`, `scripts`, `getElementsByName` | Implemented live collection consumers, including SameObject attributes and exact embeds/plugins identity. |
| `currentScript` | Implemented initially-null state and readonly projection for either script type; §4.12 script execution must set/restore it. |
| Both `open` overloads, `close`, `write`, `writeln` | §8.4 remains pending. Existing write only forwards DOMStrings to an active parser callback; TrustedHTML conversion, policy enforcement, and the complete insertion lifecycle are absent. The three-argument open overload also needs Window navigation. |
| `defaultView` | Implemented through the associated browsing context's stable WindowProxy. |
| `hasFocus`, `designMode` | Missing §6 focus management and editing behavior. |
| `execCommand`, `queryCommandEnabled`, `queryCommandIndeterm`, `queryCommandState`, `queryCommandSupported`, `queryCommandValue` | Missing editing-command subsystem referenced by HTML; no substitute return values are exposed. |
| `hidden`, `visibilityState` | Missing Document accessors and visibility-change integration; the enum alone supplies no visibility behavior. |
| `onreadystatechange` | Implemented with shared EventHandler conversion/storage and `LegacyLenientThis`. |
| `onvisibilitychange`, `GlobalEventHandlers` | Missing Document handler members/mixin integration; dispatch and ownership need the relevant visibility/event-handler algorithms. |
| Obsolete members | `all` is implemented with the recorded native capability gate. The remaining obsolete surface belongs to §16.2. |

`[CEReactions]` on these declarations still depends on custom-element reaction
delivery. The missing Document members are listed at the declaration site and
above; they are not enabled through placeholder getters that return defaults.
This slice completes the subsection's state and type prerequisites, not the
later chapters' APIs collected in its IDL block.

### Section 3.1.2 DocumentOrShadowRoot contribution

The [HTML partial mixin](https://html.spec.whatwg.org/multipage/dom.html#the-documentorshadowroot-interface)
lives beside DOM's primary declaration and its shared implementation. Document
and ShadowRoot forward `activeElement` to that mixin. The
[getter algorithm](https://html.spec.whatwg.org/multipage/interaction.html#dom-document-activeelement)
reads the node document's focused area's DOM anchor, reuses DOM retargeting,
checks the resulting tree root, and applies the document body/root fallback.
The selector adapter reads the same implementation getter.

`interaction/focus.ts` supplies only the `FocusableArea` DOM-anchor contract.
`Document.focusedArea` deliberately throws until the focus subsystem can supply
its state. Initialization, focusing/unfocusing, removal fixup, focus events,
focusable subparts, and cross-document focus chains remain §6.6 work, tracked in
the [interaction roadmap](../interaction/ROADMAP.md#focused-area-dependency).
There is no provisional body-as-focus state or independent active-element cache.

The focused tests supply that missing focus state while retaining real DOM
trees, retargeting, and platform bindings. They cover both includers, nested
open/closed shadow roots, unrelated trees, body/frameset/root fallbacks, XML
documents, adoption, selector access, and borrowed getters. These are getter
tests, not evidence that author `focus()`/`blur()` or ordinary active-element
reads work before the dependency is implemented.

### Section 3.1.3 ancestor origins

Document's `initializeAncestry()` now performs both
[list-creation algorithms](https://html.spec.whatwg.org/multipage/dom.html#ancestor-origins).
It starts from the container document's retained origin objects, applies the
iframe referrer policy, and creates a separate DOMStringList of serialized
origins. The string list is a creation-time snapshot; later ancestry or origin
changes do not update it. Top-level documents receive distinct empty lists.

`no-referrer` masks the immediate parent and its consecutive same-origin
ancestors. `same-origin` does so only when parent and child origins differ.
Each new mask uses a fresh opaque origin. Masking stops at the first different
origin, and previously masked entries remain opaque. Other referrer policies
need no extra treatment here; the specification relies on mixed-content checks
elsewhere. Same-origin comparisons ignore `document.domain` relaxation.

`Document.containerDocument` and `Navigable.containerDocument` follow the
specified lookups through the embedding element, rather than substituting the
parent navigable's current document. Child navigable/container association is
still an explicit throwing dependency in `Navigable.container`; child creation,
iframe policy selection, and fully-active ancestry remain navigation work.
The algorithm's fully-active-parent assertion is a caller precondition.
HTML also reads an unused `container` local; the implementation notes that
step rather than performing a redundant lookup.

SPEC_CLASH(ancestor-origins-before-activation): the
[document creation steps](https://html.spec.whatwg.org/multipage/document-lifecycle.html#create-and-initialize-a-document-object)
request ancestry before the new document is the navigable's active document,
but the [container-document lookup](https://html.spec.whatwg.org/multipage/document-sequences.html#doc-container-document)
uses [node navigable](https://html.spec.whatwg.org/multipage/document-sequences.html#node-navigable),
which requires that active-document identity. Initial child creation also runs
before its navigable is initialized. Browlet therefore accepts the parent
document explicitly: Navigable passes `this.containerDocument`, while initial
browsing-context creation uses the embedder's node document. This reviewed
signature adjustment preserves creation and activation order. The conflict is
our reading of those definitions, not a confirmed upstream issue or evidence of
deliberately different behavior. Revisit the comment when the specification
clarifies the lookup; child-container association remains unfinished separately.

SPEC_CLASH(ancestor-origin-policy-masking): Browlet follows HTML's referrer-policy
masking. Local source inspection on 2026-10-16 found that
[Blink's Location getter](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/frame/location.cc)
and [WebKit's Location getter](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Location.cpp)
collect unmasked ancestor origins. Gecko's
[normal-navigation implementation](https://searchfox.org/mozilla-central/source/docshell/base/CanonicalBrowsingContext.cpp)
uses the known browsing context and the new document's supplied origin to apply
both masking policies, with an additional
[initial about:blank special case](https://searchfox.org/mozilla-central/source/docshell/base/nsDocShell.cpp).
These are source observations, not a live-browser interoperability run.

The focused tests cover all four specification examples, every referrer-policy
value, opaque identity, origin-domain distinctions, snapshots, container
ownership after parent navigation, and creation before activation or navigable
initialization. They supply only the missing container
association and fully-active child state. `Location.ancestorOrigins` remains
absent pending its [§7.2.4 integration](../browsing/window/ROADMAP.md); these tests
do not claim working iframe navigation or public Location access.

### Section 3.1.4 resource metadata

[`DocumentImpl`](../dom/nodes/document.ts) implements the
[resource metadata accessors](https://html.spec.whatwg.org/multipage/dom.html#resource-metadata-management).
`referrer` continues to expose the value retained during document creation.
`cookie` uses a document-owned cookie URL captured at creation,
and delegates parsing, selection, replacement, and eviction to the UserAgent's
existing HTTP cookie store. Non-HTTP access excludes HttpOnly cookies and
cannot create or replace them. The Web IDL setter converts to USVString;
HTML then encodes UTF-8 bytes for the store and decodes returned bytes without
stripping a BOM. `cookiesEnabled`, Secure, expiry, domain/path, and SameSite
rules apply through the existing policy and store.

Document owns the live `hasCrossSiteAncestor` query previously implemented
by WindowEnvironment; the environment forwards to its associated document.
This is the query defined by HTML's
[Window settings setup](https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object),
exposed as the settings object's
[has cross-site ancestor](https://html.spec.whatwg.org/multipage/webappapis.html#concept-settings-object-has-cross-site-ancestor).
Fetch still consumes that environment property when selecting SameSite cookies;
Document shares the ancestor walk for its non-HTTP API.
Non-HTTP reads permit Strict/Lax/default cookies only in a same-site context,
and writes use the same condition for accepting them. Cross-site access can
use Secure SameSite=None cookies. This supplies the browser inputs expected by
the [layered cookie algorithms](https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html#section-5.6),
consistent with [non-HTTP retrieval](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-21#section-5.8.2).
HTML's [COOKIES reference](https://html.spec.whatwg.org/multipage/references.html#refsCOOKIES)
still points to RFC 6265. The `6265bis` revision supplies supporting SameSite
detail; it is not the source of HTML's environment property.
The HTTP roadmap retains the existing third-party-policy and CHIPS boundaries;
this slice does not implement iframe navigation.

SPEC_CLASH(document-cookie-averse): approved 2026-10-16, use an inherited cookie
URL for about:blank/srcdoc, matching Chromium 149.0.7827.55, Firefox 151.0, and
Windows WebKit 26.5. HTML's literal current-document-URL rule would deny access.
Detached documents and documents without an HTTP(S) cookie URL still return
empty and ignore writes. Chromium additionally throws for initial opaque blank
and data: documents; Browlet retains HTML/Firefox/WebKit's empty/no-op behavior
when there is no inherited cookie URL. The local
`scratch/RESOURCE-METADATA-PROBE.mjs` records these cases.
Relevant source owners are [Blink Document](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/dom/document.cc),
[Gecko Document](https://searchfox.org/mozilla-central/source/dom/base/Document.cpp),
and [WebKit Document](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.cpp).

The retained evidence for the approved choice and any future upstream report:

- [WHATWG HTML #332](https://github.com/whatwg/html/issues/332) has tracked this
  exact disagreement since November 2015 and remains open. In the originating
  [Mozilla bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1223885#c7), the
  discussion favored fixing the specification, citing iframe compatibility;
  Mozilla closed the browser bug as invalid. These documents already inherit
  their creator's origin, so their cookie access was not judged a same-origin
  policy violation.
- Browsers inherit a lookup URL, not a snapshot of cookies. Blink and WebKit
  retain a document cookie URL; Gecko uses the URI retained by its principal.
  This retains the scheme, host, and path needed by cookie selection. An origin
  alone has no path, and the document's base URL can be changed by author markup.
  See [the implementer explanation](https://github.com/whatwg/html/issues/332#issuecomment-156138064)
  and [Blink's current initialization](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/dom/document_init.cc).
- [Policy-container work](https://github.com/whatwg/html/issues/4926#issuecomment-740644312)
  explicitly deferred cookie URL integration. A
  [2024 WebKit fix](https://github.com/WebKit/WebKit/commit/4973ae3a5e854e1e056dedcbced9c1db450bc6f0)
  also adopted the inherited cookie URL for Cookie Store API access from
  about:blank/srcdoc frames. This is maintained behavior, not just an old accident.
- The local `scratch/COOKIE-INHERITANCE-PROBE.mjs` confirms the common behavior
  in Chromium 149.0.7827.55, Firefox 151.0, and Windows WebKit 26.5. From a
  parent at `/a/page`, both inherited frames read `/a` cookies, see subsequent
  shared-store updates, and use `/a` as the default path for writes. A `<base>`
  pointing at `/unrelated/` does not alter this. A separate `/b/check` document
  cannot see those path-scoped writes.
- The cookie URL is copied when creating a document. It is independent of
  `baseURI`, `document.domain`, subsequent URL mutation, and the creator's later
  navigation; cookie contents remain live in the shared store. Initial blank
  and srcdoc creation use creator/embedder provenance; later about:blank
  navigations need the initiator. Blink still records incomplete initiator
  handling in [bug 1176291](https://crbug.com/1176291).

`NavigationParams.cookieURL` carries the selected URL into document creation,
defaulting to the response URL for ordinary navigation. Missing iframe and
initiator navigation must supply the inherited cookie URL together with their
origin/base/policy inputs. Initial blank creation includes the creator copy,
but still throws at its existing creator/embedder dependency gates. The source
route has no initiator and does not guess one from the departing document.
History restoration must preserve the captured cookie URL if it recreates a
Document; that integration remains with navigation. These are explicit gaps,
not claims that iframe loading or History APIs work.

SPEC_CLASH(document-cookie-url-history): approved 2026-10-16, preserve the captured
cookie URL. The same probe found that all three
engines retain `/a` cookie access after `history.replaceState()` changes the
parent's document URL to `/b/after`; the existing blank/srcdoc children retain
it too. HTML's literal current-document-URL rule would select `/b` cookies for
the parent. Browlet follows the browsers.

SPEC_CLASH(document-cookie-sandbox): approved 2026-10-16, throw SecurityError for
sandboxed srcdoc with an inherited HTTP(S) cookie URL and an opaque origin.
With `sandbox="allow-scripts"`
and no `allow-same-origin`, Chromium and Firefox throw SecurityError for both
accessors. Windows WebKit returns empty and ignores writes, consistent with
HTML's literal cookie-averse-before-opaque-origin ordering. HTML's introductory
description says sandboxed opaque documents throw, so its own prose and detailed
steps disagree here too. All three engines deny cookie access. The probe retains
a failing SecurityError expectation for WebKit; its exit status is nonzero.
Browlet follows Chromium/Firefox's exception behavior and can revisit this
separately from inherited cookie access.

Response integration parses `Last-Modified` once into optional Unix milliseconds.
It reuses HTTP's `parseHTTPDate()`. Cookie Expires parsing remains in HTTP's
`parseCookieDate()` and needs no new HTML parser. HTML's date microsyntaxes use
ISO-style input forms, while HTTP's date serializer emits UTC IMF-fixdate;
neither produces this accessor's required local `MM/DD/YYYY hh:mm:ss` format.
The getter formats local calendar components with ASCII padding and reads the
current time on each access when the date is unknown. The current local timezone
comes from the host Date implementation. The source-only route has no response
date; a future file loader must provide filesystem modification time through
`lastModificationTime`. No filesystem read is hidden in the getter.

SPEC_CLASH(document-last-modified-timezone): approved 2026-10-16, preserve Date's
historical local-time conversion. On Windows in Pacific time, the response date
`Sun, 06 Nov 1994 08:49:37 GMT` produced `11/06/1994 00:49:37` in Chromium
149.0.7827.55 but `11/06/1994 01:49:37` in Firefox 151.0 and WebKit 26.5.
All three browsers' JavaScript Date objects reported `00:49:37 GMT-0800` for
that instant. The difference persisted without a Playwright timezone override.
This is observed Windows behavior, not a claim about all Gecko/WebKit platforms;
the test preserves the source instant after local formatting and parsing.

[`resource-metadata.test.ts`](../../../test/browlet/dom/nodes/resource-metadata.test.ts)
covers the projected accessors, Fetch sharing, policy checks, UTF-8 bytes,
cookie URL inheritance and independence, sandbox exceptions, exception realms,
response retention, and date formatting. The inheritance tests supply the
missing navigation inputs explicitly; the History regression applies its URL
mutation directly until the public API exists.
The existing environment tests also exercise non-HTTP reads and writes through
real document ancestry, including a live transition from cross-site to same-site.

### Section 3.1.5 document loading status

[`DocumentImpl`](../dom/nodes/document.ts) implements the
[readiness-update algorithm](https://html.spec.whatwg.org/multipage/dom.html#update-the-current-document-readiness):
unchanged values do nothing; a change stores the new value, records the first
interactive/complete timestamp for an associated HTML parser, and synchronously
fires a trusted `readystatechange` event. `onreadystatechange` uses the existing
event-handler machinery and preserves its declared `LegacyLenientThis` behavior.
Fresh documents remain complete; navigation initialization still assigns loading
before exposing the new document, as the specification requires.

The associated `parser` is distinct from `activeParser`, which is null once the
parser stops or aborts. The parser-owned `DocumentParser` base class retains the
document, stopped state, and association lifecycle, with a kind distinguishing
HTML from XML and an abstract abortion operation. `HTMLDocumentParser` retains
its association through the completion timestamps. Completion
or abortion releases it afterward so Document does not keep parse5's input and
script callback alive. The XML implementation is an explicit missing dependency;
the lifecycle contract alone does not provide XML parsing.

Both load and previous-document unload records have the specified zero defaults,
and the cross-origin-redirect flag retains its false default. Navigation must
still capture the departing document's unload timestamps and supply them to the
new document. Performance entry exposure remains with the
[performance roadmap](../performance/ROADMAP.md).

The source and Fetch HTML routes now report interactive at parsing completion,
then `DOMContentLoaded`, complete, and Window load with Document as its target.
This connects the existing provisional completion path; it does not complete
[§13's stop-parsing algorithm](https://html.spec.whatwg.org/multipage/parsing.html#stop-parsing).
Separate DOM-manipulation tasks, deferred/async script waits, load-event delays,
Service Worker client-message enablement, BiDi notifications, pageshow, printing,
and navigation-timing delivery remain in the [parser roadmap](parser/ROADMAP.md).
Abort emits the two readiness changes but still lacks open-element cleanup and
speculative-parser integration. The synchronous tree-only parsing convenience
does not implement the navigation lifecycle.

[`loading-status.test.ts`](../../../test/browlet/dom/nodes/loading-status.test.ts)
retains the original failure: a navigated page observed only loading, with
neither readiness notification. It covers defaults, synchronous event delivery,
first-write timing, stopped/HTML/XML parser distinctions, handler conversion,
and event order. Its load-target regression also failed before enabling DOM's
existing legacy target override. Parser tests cover readiness during abortion,
including an EOF/abort race where queued completion previously restored
interactive readiness after abortion. The stopped state rejects that stale
completion without restarting the loading lifecycle.

### Section 3.1.6 render blocking

[HTML §3.1.6](https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism)
now lives on Document and Element. Document owns `renderBlockingElements`,
admits new blockers only for exact `text/html` content without a body/frameset,
and tests both pending work/body eligibility and the high-resolution-time cutoff.
Elements expose `isRenderBlocking()`, `blockRendering()`, and `unblockRendering()`.
Block admission deliberately does not repeat potential eligibility: the resource
algorithm decides when to invoke it. Attribute assignment alone does not start work.

The shared Element attribute/removal paths release blockers when a blocking
attribute loses potential eligibility or removal disconnects the element,
including descendants inside shadow trees. State-preserving moves do not release
them; adoption removes the old-document dependency before changing ownership.
The Document browsing-context setter releases connected blockers when the context
changes from non-null to null, as required by
[browsing-context disconnection](https://html.spec.whatwg.org/multipage/infrastructure.html#becomes-browsing-context-disconnected).
Document destruction and other detach paths share this cleanup through assignment.

`UserAgent.renderBlockingTimeout` defaults to 5000 milliseconds from the relevant
global's time origin. This is an implementation-defined policy, not a new timer
started for each resource. The cutoff is inclusive; expiration changes whether
rendering is blocked without clearing pending resource membership. Completion can
still call `unblockRendering()` afterward. Rendering opportunities consult this
Document predicate directly, replacing their provisional injected filter.

The five-second value is informed by WebKit's
[`IncrementalRenderingSuppressionTimeout`](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml)
and [Document suppression timer](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.cpp).
WebKit starts its timer when suppression begins; Browlet follows HTML's stated
global-clock comparison. The other inspected engines use different mechanisms:
[Blink's resource manager](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/loader/render_blocking_resource_manager.cc)
has font-specific timers, while [Gecko's paint suppression](https://searchfox.org/mozilla-central/source/layout/base/PresShell.cpp)
uses an initial-paint delay. These are not evidence of one shared timeout policy.

Script preparation, linked-resource processing (including `rel=expect`), and
stylesheet critical-resource loading still need their specified block/unblock
calls and Fetch request flags. Neither the ad hoc parser script handler nor
the current inline stylesheet association claims those loading algorithms.
The [loader](../loader/ROADMAP.md), [style integration](../style/ROADMAP.md), and
[rendering pipeline](../scripting/ROADMAP.md#deferred-processing-model-tails)
retain those dependencies, including real rendering opportunities and display.

[`render-blocking.test.ts`](../../../test/browlet/dom/nodes/render-blocking.test.ts)
covers admission, body/frameset and namespace handling, cutoff boundaries,
potential versus actual blockers, attribute changes, subtree/shadow removal,
browsing-context detachment, adoption, state-preserving moves, and independent
script-blocking state.
Rendering-producer and document-destruction tests cover the connected consumers.

### Section 3.1.7 DOM tree accessors

[`DocumentImpl`](../dom/nodes/document.ts) implements the
[tree accessors](https://html.spec.whatwg.org/multipage/dom.html#dom-tree-accessors)
using the existing mutation and live-collection machinery:

| Requirement | Implementation and dependency boundary |
| --- | --- |
| HTML, head, and title elements | The document element is cached as root children are linked/unlinked, before mutation participants run. Head/body continue scanning only direct children of a concrete HTMLHtmlElement. The separate HTML title query finds the first HTML title anywhere in the ordinary document tree without maintaining another cache. Minimal html/body/frameset and SVG root interfaces supply identity; their remaining APIs stay with their element owners. |
| `title` | Retains one selected HTML/SVG title and its normalized child text. Concrete HTMLTitleElement/SVGTitleElement implementations notify Document through their insertion/removal/moving and child-change hooks; Node's general `childrenMoved()` notification updates both parents after state-preserving moves. Root changes also refresh selection. SVG selects only direct title children. Document setters and HTMLTitleElement.text preserve raw text and use DOM replacement. No head/root is invented; unrelated root namespaces ignore writes. |
| `body` | Reject null and non-body/frameset elements, preserve same-body identity, replace/adopt an existing body, otherwise append to the document element or throw without one. A foreign root can receive an HTML body without satisfying the getter's HTML-root rule. |
| Collections | Stable live images/embeds/links/forms/scripts; plugins is exactly embeds. Only eligible HTML descendants in the ordinary tree qualify. Link href presence includes empty values, but excludes namespaced href attributes. |
| `getElementsByName` | Live NodeList matching the exact name attribute on any HTML element, including the root; empty and case-sensitive values are preserved. No shadow-tree traversal. |
| `currentScript` | Initially null, retains HTMLScriptElementImpl or SVGScriptElementImpl, and projects the most recently assigned value. §4.12 execution must set/restore it for nested classic scripts and supply null for modules/shadow-tree execution. The provisional parser callback does not yet do this. |
| Document names | Ordered, duplicate-free supported names; name/ID eligibility and object/embed exposure; single element or iframe WindowProxy; stable live HTMLCollection for multiple matches; LegacyOverrideBuiltIns applied by existing Web IDL machinery. The implementation returns concrete implementations/handles; its IDL object binding performs projection. |
| Object/embed exposure | Minimal concrete element classes implement the §3.1.7 exposure predicate. Object resource selection must update `showsFallbackContent`; changing it invalidates live collections. Initial false represents no selected fallback, not a completed resource load. Other §4.8 object/embed APIs, loading, and rendering remain absent. |
| Iframe WindowProxy | Initially-null `contentNavigable` is the explicit child-navigation dependency. Named access consumes its active WindowProxy once supplied. Automatic child creation/destruction, container association, and iframe contentWindow/contentDocument remain unimplemented. |
| `dir` | The section refers to §3.2.6.4, which now supplies reflection, HTML-root forwarding, and the directionality queries. |

The title/body declarations retain `[CEReactions]`; custom-element reaction
delivery remains the shared missing binding dependency.

Approved 2026-10-16: follow HTML's written named-property rules despite the
following disagreements in Chromium 149.0.7827.55, Firefox 151.0, and Windows
WebKit 26.5. The local
`scratch/DOCUMENT-TREE-ACCESSORS-PROBE.mjs` preserves the focused probe; its
expectations remain the specification results, including the disagreeing cases.

- `SPEC_CLASH(document-named-scope)`: Chromium, Firefox, and WebKit omit these
  properties on an XMLDocument containing HTML elements. Chromium also omits
  them on `createHTMLDocument()` results. HTML defines them for Document without
  either exclusion; Browlet includes them.
- `SPEC_CLASH(document-named-order)`: HTML orders names by tree order, ID before
  name for each element. Chromium agrees for the simple form/image probe;
  Firefox uses identifier-map order and WebKit sorts alphabetically. Browlet
  uses the specified order and recomputes after mutations.
- `SPEC_CLASH(document-named-iframe)`: without a content navigable, HTML and
  WebKit return the iframe element. Firefox returns undefined; Chromium's
  detached-document omission also prevents the detached probe from resolving it.
- `SPEC_CLASH(document-named-object-exposure)`: in the synchronous probe with
  an object containing an embed, Chromium/WebKit suppress the object and expose
  the embed; Firefox exposes both. HTML makes object exposure depend on fallback
  state and forbids an exposed object ancestor for either descendant. Browlet
  follows that state-sensitive rule. The loading algorithm that selects the
  state remains unfinished, so this is not a claim of equivalent resource loading.

Inspected source owners: [Blink HTMLObjectElement::IsExposed](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/html_object_element.cc)
recursively checks typed object ancestors and ignores fallback state when checking
typed object/embed descendants. [Gecko's eligibility filters](https://searchfox.org/mozilla-central/source/dom/html/nsGenericHTMLElement.h)
explicitly omit the exposure condition when registering document names.
[WebKit's name collection](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLNameCollection.cpp)
also uses element types without ancestor/fallback checks in the inspected source;
that path does not explain the Windows WebKit probe's suppression above.
[WebKit HTMLDocument](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLDocument.cpp)
documents its alphabetical ordering divergence. Source inspection and the recorded
browser runs are separate evidence; neither replaces HTML as the chosen rule.

Browlet checks object ancestors in one upward walk. Every object ancestor of an
object/embed already has that object/embed descendant, so a fallback ancestor
cannot be exposed. If any non-fallback object ancestor exists, the outermost one
is exposed. This avoids recursively rediscovering the same ancestors.
[`exposure.test.ts`](../../../test/browlet/dom/nodes/html/embedded/exposure.test.ts)
covers nested fallback transitions, foreign-namespace descendants, and a linear
traversal budget; the former recursion made 81,919 parent reads at depth 16.

[`document-tree-accessors.test.ts`](../../../test/browlet/dom/nodes/document-tree-accessors.test.ts)
covers the accessors, whitespace, namespace/attribute eligibility, mutation and
adoption, shadow exclusion, collection identity/liveness, named overrides/order,
object fallback transitions, and both script identities. Its iframe test connects
a real existing navigable at the missing child-navigation seam.

### Section 3.2.1 semantics audit (2026-10-16)

Reviewed [§3.2.1](https://html.spec.whatwg.org/multipage/dom.html#semantics)
against the local WHATWG source. This subsection supplies requirements and
definitions, not a new callable algorithm or interface.

| Requirement | Implementation boundary |
| --- | --- |
| Elements, attributes, and their values carry their specified meaning | Element and attribute owners implement the concrete behavior in later sections. The examples do not require a separate metadata registry or interpretation layer. |
| Authors must use permitted markup for its intended purpose | Authoring conformance requirements are not additional DOM mutation checks. A conformance checker is not implemented; existing DOM operations retain their own specified validation and processing rules. |
| Nodes whose document has no browsing context are exempt from document conformance requirements except syntax | The exception depends on the node document's browsing context, not the node's connectedness. A future checker must preserve it, including for template contents; it does not disable DOM or element processing. Template-content ownership remains an explicit §4.12.3 dependency. |
| Meaning follows the current DOM state, and presentation must update when that state changes | Existing mutations update implemented consumers such as title state, live collections, inline declarations, and style-element sheets. Production style/layout/paint delivery and accessibility presentation are incomplete; the existing mutation hooks and rendering task skeleton do not complete this requirement. |

The presentation dependency remains with [style integration](../style/ROADMAP.md),
the [rendering update phases](../scripting/ROADMAP.md#deferred-processing-model-tails),
and §3.2.9's future accessibility owner. This audit accounts for the subsection
without claiming a working renderer or adding a placeholder presentation API.
The existing [`RenderingUpdateHooks`](../scripting/rendering-opportunity.ts) carry
a source-level TODO for connecting mutations to those owners and keeping
presentation current after the initial render. §3.2.1 adds no phase ordering;
the scaffold's ordering comes from HTML's later update-the-rendering algorithm.

### Section 3.2.2 elements in the DOM

[Elements in the DOM](https://html.spec.whatwg.org/multipage/dom.html#elements-in-the-dom)
requires the appropriate HTML interface even in XML documents. The catalog now
registers all 141 HTML local names covered by the current element definitions
and obsolete-name rules, adding 38 concrete implementation identities. Names
whose specified interface is `HTMLElement` register there; specialized names
register beside their implementations. The transitional known-name list is gone.

| Selection requirement | Implementation |
| --- | --- |
| Specified HTML interface, independent of document syntax | `element-interfaces.ts` combines the declared public interfaces with HTML's tag-specific constructors. HTML, XHTML, and explicit HTML-namespace creation in XML documents use the same identities. |
| Obsolete names selecting HTMLUnknownElement | `applet`, `bgsound`, `blink`, `isindex`, `keygen`, `multicol`, `nextid`, and `spacer` register on HTMLUnknownElement. |
| Obsolete names selecting HTMLElement | `acronym`, `basefont`, `big`, `center`, `nobr`, `noembed`, `noframes`, `plaintext`, `rb`, `rtc`, `strike`, and `tt` register on HTMLElement. |
| Obsolete aliases | `listing` and `xmp` register alongside `pre` on HTMLPreElement. |
| Other applicable specifications | Their interface declarations use the same namespace/local-name metadata and must be included in the composed declaration set. No separate registry is needed. |
| Valid custom name, then unknown fallback | Unregistered valid custom names select HTMLElement; all other unregistered HTML names select HTMLUnknownElement. `menuitem` no longer receives the old provisional generic identity. |
| HTML, SVG, and MathML shared features | All three include HTMLOrSVGOrMathMLElement; unrelated namespaces retain Element and do not receive that mixin. |
| Meaning and references | These paragraphs define terminology and examples, not additional ID resolution or conformance-validation algorithms. |

The [element roadmap](../dom/nodes/html/ROADMAP.md#section-322-interface-identities)
lists the minimal classes and their missing owners. Interfaces are exposed in
Window realms, but identity alone does not implement their §4/§16 APIs.
`[HTMLConstructor]` is supplied by the following slice; HTMLUnknownElement
deliberately has no HTML constructor.

The subsection's executable IDL now supplies ordinary reflection for `title`,
`lang`, `inert`, `accessKey`, `headingOffset` (read range 0–8), `headingReset`,
and the shared `autofocus`. The §3.2.6.3 slice adds the inherited `translate`
getter and canonical yes/no setter. §3.2.6.4 adds known-keyword `dir` reflection
and the directionality queries. Existing nonce handling remains intact.
`ShowPopoverOptions` and `TogglePopoverOptions` are declared here; dictionaries
do not expose globals or implement popover operations. Every remaining shared
member has an owning dependency:

| Members or contract | Missing owner |
| --- | --- |
| `[HTMLConstructor]` producers | The §3.2.3 consumer is implemented below; validated public definitions and upgrades remain §4.13 work |
| `hidden`, inert processing, `click`, `accessKeyLabel` and access-key assignment | [§6 user interaction](https://html.spec.whatwg.org/multipage/interaction.html): hidden states, inert subtrees, activation, and keyboard shortcut selection |
| `draggable` | [Drag and drop](https://html.spec.whatwg.org/multipage/dnd.html#the-draggable-attribute): default state and drag behavior |
| `spellcheck`, `writingSuggestions`, `autocapitalize`, `autocorrect` | [Editing](https://html.spec.whatwg.org/multipage/interaction.html#editing): inherited/default states and editing services; ReflectSetter alone cannot supply their getters |
| `innerText`, `outerText` | [§3.2.7](https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute): rendered-text collection, layout, and specified replacement algorithms |
| `attachInternals()` | [Custom elements](../dom/nodes/html/custom-elements/ROADMAP.md): definition lookup, construction/attachment checks, and internals ownership |
| `showPopover`, `hidePopover`, `togglePopover`, `popover` | [Popover](https://html.spec.whatwg.org/multipage/popover.html#the-popover-attribute): state, top layer, invokers, focus, and toggle events |
| `headingOffset`/`headingReset` effects | [Heading-level computation](https://html.spec.whatwg.org/multipage/sections.html#heading-level) and accessibility presentation; reflection is present |
| `GlobalEventHandlers`, `ElementContentEditable` includes | [Event handlers](https://html.spec.whatwg.org/multipage/webappapis.html#globaleventhandlers) and [editing](https://html.spec.whatwg.org/multipage/interaction.html#elementcontenteditable): shared implementations and their IDL members are still absent |
| `dataset` | [DOMStringMap](https://html.spec.whatwg.org/multipage/dom.html#domstringmap) and live `data-*` name conversion |
| `tabIndex`, `focus`, `blur`, `FocusOptions`, autofocus processing | [Focus](https://html.spec.whatwg.org/multipage/interaction.html#focus): focusability, focus state, scrolling, and autofocus candidates; autofocus reflection is present |
| `[CEReactions]` delivery | Custom-element reaction entry/exit and callback delivery remain missing; annotations are retained |

The identity regressions first failed for missing concrete interfaces in HTML,
XHTML, and XML documents and for the obsolete `menuitem` fallback. They now
cover the complete fixed catalog, cloning, custom/reserved names, case and
namespace handling, and receiver-realm allocation. Shared-attribute regressions
cover raw/IDL updates, boolean presence, heading range clamping without changing
the stored text, and autofocus on HTML/SVG/MathML.

This completes the catalog and accounts for §3.2.2's shared surface. It does not
claim those later algorithms are implemented.

### Section 3.2.3 HTML element constructors

[HTML element constructors](https://html.spec.whatwg.org/multipage/dom.html#html-element-constructors)
now use HTML-owned overridden constructor steps, prepared once per interface
through the Web IDL extended-attribute integration. All 70 applicable interfaces
declare `[HTMLConstructor] constructor()`; HTMLMediaElement and HTMLUnknownElement
retain illegal constructors. The declaration audit checks the Window exposure,
single annotation, sole overload, and empty argument list.

| Requirement | Implementation |
| --- | --- |
| Reject the active constructor itself and unregistered new targets | Constructor identity is checked before observing the author prototype; ordinary function calls have no new target and also throw TypeError. |
| Select the registry and definition | The current WindowAgent's active-constructor map takes precedence over the current Document registry. Definitions match constructor identity, without falling back after a selected registry has no match. |
| Validate autonomous and customized built-in bases | Autonomous definitions require HTMLElement; customized definitions use the same `localNames` metadata as element-interface selection, including multi-name interfaces and obsolete aliases. |
| Fresh construction | Web IDL selects the new-target prototype. Document selects the implementation, document, namespace, prefix, local name, registry and is value, allocating through `env.exec.constructNode()`; construction sets custom state and definition, then projects the platform object. |
| Upgrade construction | Reuse the last stack element, reject the already-constructed marker, set its platform prototype, and replace only that entry. The upgrade owner must later finish state changes and pop the stack. |
| Author-controlled prototype and realms | The empty/nonempty branch is chosen before prototype access, while the last entry is read afterward. Exceptions propagate; non-object prototypes fall back to the matching interface in newTarget's function realm. Allocation still belongs to the invoking constructor's realm/current Document. |
| Non-extensible upgrade | Follow HTML/Chromium's ignored false prototype-set result; retain the approved [SPEC_CLASH and browser evidence](../dom/nodes/html/custom-elements/ROADMAP.md#non-extensible-upgrade-clash). |
| Legacy factory functions mentioned here | `Image`, `Audio`, and `Option` are distinct constructors whose algorithms belong to [images](https://html.spec.whatwg.org/multipage/embedded-content.html#dom-image), [audio](https://html.spec.whatwg.org/multipage/media.html#dom-audio), and [options](https://html.spec.whatwg.org/multipage/form-elements.html#dom-option). They remain absent rather than being aliased to the HTML constructor. |

The binding callback receives the specification's implicit NewTarget and active
function object explicitly as `JSFunction` values, with an undefined NewTarget
for ordinary function calls. This reviewed adaptation preserves constructor
identity; environment injection is the existing binding contract.

Missing producers are explicit in the [custom-elements roadmap](../dom/nodes/html/custom-elements/ROADMAP.md):
public definition/registry APIs, complete validated definition records, upgrade
stack management, scoped-map entry lifetime, and custom-element reactions.
`Document.createElement*` and the parser still need the custom-element definition
lookup and construction/upgrade paths. Tests seed the necessary state and invoke
real realm-owned platform constructors. This closes the §3.2.3 consumer without
claiming that author-facing custom elements work end to end.

### Section 3.2.4 element definitions audit

[Element definitions](https://html.spec.whatwg.org/multipage/dom.html#element-definitions)
explains the information supplied by each element's specification entry. It does
not prescribe a runtime representation. The reviewed implementation direction is
to retain fixed facts on each tag's implementation prototype and conditional queries
on the instance. The [tag-specific implementations](../dom/nodes/html/ROADMAP.md#tag-specific-implementations)
and their construction path are present; category and attribute inventories have
begun below.
Resume this section before §3.2.5. Its requirements are accounted for as follows:

| Definition entry | Requirement and owner |
| --- | --- |
| Categories | `ElementImpl.hasCategory()` reads the concrete prototype's shared array; HTML overrides handle conditional membership. §3.2.5.2 now covers all 113 current HTML element identities and the SVG/MathML roots. Text has its own query. Main hierarchy, custom form association, obsolete elements, and remaining foreign vocabularies stay explicit dependencies. |
| Contexts in which this element can be used | An informative summary of the surrounding elements' content models, not a separate runtime check. |
| Content model | Shared rule descriptions on the implementation prototypes; `getContentModel()` reads the concrete element's model. The initial inventory covers p, blockquote, q, input, details, and a. Consumers and the remaining definitions are unfinished. DOM mutation is not a general HTML conformance validator. |
| Tag omission in text/html | Each optionally tagged element implements §13.1.2.4's conditions through `canOmitStartTag()` and `canOmitEndTag()` overrides, using numeric ElementTag identities. The permissions apply to conforming HTML content; start-tag checks require the preceding content sibling's actual end-tag output decision. No omission-capable markup writer is present. Parser recovery remains with the [parser](parser/ROADMAP.md). |
| Content attributes | The allowed-attribute list is normative; descriptions following each dash are informative. Prototype `contentAttributes` inventories and the instance query `allowsContentAttribute()` cover article, div, blockquote, q, and a. Anchor permissions depend on current href presence. The shared global inventory covers §3.2.6's preamble; unfinished attribute families and element inventories remain explicit dependencies. Value processing, reflection, and required-attribute rules belong to each attribute's defining section; DOM setters do not enforce these inventories. |
| Accessibility considerations | Author conformance comes from ARIA in HTML; user-agent accessibility mappings come from HTML-AAM. The future accessibility domain in the [Browlet roadmap](../ROADMAP.md) owns the missing tree and host exposure. Existing ARIA reflection does not implement those mappings. |
| Sanitization | Prototype `sanitization` records cover article, a, script, and form with numeric categories, default attribute allowances, and navigating URL attributes. Missing records remain explicit dependencies. The remaining inventory and [Sanitizer configuration and filtering algorithms](sanitization/ROADMAP.md) are unfinished. |
| DOM interface | The normative interface determines each element's platform surface. §3.2.2 supplies the registered identities and colocated IDL comments; unfinished members remain dependencies of their defining sections. |

The following description of an element's meaning and additional requirements
belongs to that element and its consuming algorithms. No parallel definition
registry is needed merely to reproduce the specification's presentation. Revisit
the class-owned information when content-model consumers and sanitization are
implemented; the consumer algorithms and configurable policy retain their owners.

The category slice uses arrays of numeric `ContentCategory` enum values for fixed
membership. Instances inherit the shared prototype array. Conditional queries
read current attributes and tree state without caching a category collection.
An absent prototype array means unfinished inventory and querying it throws;
an empty array, as on optgroup, means no fixed memberships. An override can still
supply conditional memberships, as on area and selectedcontent. Content-model
validation and sanitizer behavior retain their separate consumers.

Content models now retain inspectable child rules and separate descendant
restrictions in [`content-model.ts`](../dom/nodes/element-definitions/content-model.ts). Rules
describe one category member or element, ordered sequences, bounded repetition,
empty content, and transparent content at a position within a sequence. Descendant
restrictions identify a category, implementation, or namespace-less attribute.
Every entry in `childRules` applies to the same child sequence; ordered portions
use an explicit sequence rule. An empty requirements array imposes no constraints,
whereas an empty-content rule prohibits significant content.
Instances inherit their prototype's definition. A dedicated matcher now handles
the "nothing" rule; the general evaluator remains unfinished and no automatic
mutation check is installed. Future consumers must distinguish completed contents
from prospective insertions and unfinished sequences, ignore inter-element
whitespace/comments/processing instructions, and resolve transparent positions
against the surrounding model. Conditional models, exceptional prose requirements,
foreign-content membership, and unfinished category inventories remain explicit
dependencies to address as their consumers and element definitions are implemented.

[§3.2.4.1 Attributes](https://html.spec.whatwg.org/multipage/dom.html#attribute-text)
permits any string value unless an attribute specifies otherwise. Existing
`DOMString` conversion and `AttrImpl` storage preserve that text. The public-API
regression in `test/browlet/dom/nodes/attributes.test.ts` exercises `setAttribute`,
`setAttributeNS`, and attached `Attr.value` with empty strings, whitespace, markup
characters, NUL, lone surrogates, and supplementary Unicode. This is a DOM-value
contract; source markup still undergoes its parser's character processing.

### Section 3.2.5 preamble and nothing content model

`ElementImpl.matchesNothingContentModel()` checks its current DOM children
for the "nothing" requirement. `NodeImpl.isIgnoredHTMLContent()` in
[`node.ts`](../dom/nodes/node.ts) excludes comments,
processing instructions, and inter-element whitespace: empty Text or Text
containing only tab, LF, FF, CR, and space. Text's
instance query also covers CDATA sections and reads current data after mutations.
Other text, including non-ASCII whitespace, and all element children count as
content. The existing `emptyContent` rule describes this requirement for input.

Ignoring these nodes affects interpretation, not DOM storage or ordinary sibling
APIs. Optional-tag syntax keeps its separate whitespace/comment rules. "Nothing"
is independent of void-element syntax, and this matcher does not enforce models
during insertion. The preamble also permits orphan HTML elements and contexts
supplied by other specifications; future context validation must preserve both.
Other content-model rules and their consumers remain later subsection work.

### Section 3.2.5.2 kinds of content

The nine category subsections are recorded on the concrete element implementations.
All 113 current HTML tag identities have explicit fixed inventories, including
empty inventories for elements with no fixed categories. The existing additional
form-category values are populated from §4.10.2's tables, so a completed inventory
does not accidentally report false for a button's listed or labelable membership.
The 28 obsolete HTML identities remain unclassified until their defining rules
are reviewed; they retain the throwing unfinished-inventory path.

`ElementImpl` owns the shared category field/query because HTML's content models
also classify foreign elements. SVG's root and the concrete MathML `math` root
provide flow, phrasing, embedded, and palpable memberships. MathML's concrete
root still projects through MathMLElement; its generic fallback remains available.
`TextImpl.hasCategory()` supplies flow and phrasing membership and tests current
inter-element whitespace for palpable membership, including CDATA. Callers query
the element or Text implementation directly. Comments, processing instructions,
and other node kinds have no category API; content-model consumers independently
exclude ignored nodes through `NodeImpl.isIgnoredHTMLContent()`.

Conditional membership uses namespace-less attributes, parsed input type, or
ordinary DOM ancestors/descendants and children. It covers anchor, area, audio,
video, img, link, meta, hgroup, selectedcontent, input, and the list elements.
Link's allowed-in-body query uses the seven body-ok rel keywords. A dl has a
name-value group when its grouping algorithm encounters dt/dd directly or in a
direct div child; even a group with missing names or values counts. This existence
query avoids constructing groups solely to answer palpable membership.
Hidden and disabled do not independently remove category memberships.

The remaining dependencies are deliberately explicit:

- `HTMLMainElementImpl.isHierarchicallyCorrect()` throws. §4.4's ancestor rules
  include forms without an accessible name; accessible-name computation is not
  implemented. Its flow query delegates to this stub; palpable membership works.
- Autonomous custom elements with completed construction state supply flow,
  phrasing, and palpable membership. Their form-associated, listed, labelable,
  submittable, and resettable queries call the throwing
  `isFormAssociatedCustomElement()` dependency on §4.13's definition state.
  Customized built-ins retain their built-in memberships. Definition registration
  and upgrade remain unfinished; a potential custom name alone is not treated as
  a completed custom element.
- Other foreign elements need their vocabulary's classification. In particular,
  the foreign-metadata rule (RDF is HTML's example) cannot be implemented by
  classifying every non-HTML element as embedded. Missing inventories throw.
- The palpable-content subsection's recommendation to contain non-hidden palpable
  content is an authoring aid with explicit exceptions. A conformance consumer
  remains unfinished; this recommendation does not modify membership or insertion.
- Embedded fallback content is defined by each embedding element. Resource
  loading and fallback selection remain with those element-specific algorithms.

The phrasing subsection also defines text-only contents and authored character
validity. `textContent` describes the text rule, and
`ElementImpl.matchesTextContentModel()` checks current children while ignoring
the excluded node kinds. `isValidHTMLText()` checks scalar values, noncharacters,
and disallowed controls for text or attribute values. These are conformance
queries; DOM strings are retained unchanged. Consumers applying the character
check to a document and the general content-model evaluator remain unfinished.

#### Category-list and browser-source review

Reviewed the local Blink, Gecko, and WebKit sources on 2026-10-18, alongside the
current HTML category definitions. The sources do not supply a complete general
category classifier that can settle these authoring questions:

- [Blink's paragraph insertion helper](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/editing/commands/insert_paragraph_separator_command.cc)
  has an editing-specific `IsPhrasingContent` name set. It omits selectedcontent,
  and includes area/link/meta without the category conditions or Text handling.
- [WebKit's corresponding helper](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/editing/InsertParagraphSeparatorCommand.cpp)
  uses the same kind of editing-specific name switch, with the same limitations.
- [Gecko's editing table](https://searchfox.org/mozilla-central/source/editor/libeditor/HTMLEditUtils.cpp)
  uses containment groups rather than these HTML categories. Its selectedcontent
  entry has GROUP_NONE membership, while main/hgroup use its block grouping;
  these are editing decisions, not answers to `hasCategory()`.

No live DOM insertion/rendering probe is claimed as category-conformance evidence.
Browsers accepting a tree does not establish that it meets an authoring rule.

The [kinds-of-content relationship](https://html.spec.whatwg.org/multipage/dom.html#kinds-of-content)
explicitly makes phrasing a subset of flow. Selectedcontent appears in the
phrasing list but is missing from the flow enumeration. Browlet supplies both
memberships under its phrasing condition. This is an incomplete enumeration with
an answer supplied elsewhere in the same section, rather than unspecified behavior
or evidence of a competing browser rule. Revisit this note when the enumeration
is corrected; no SPEC_GAP or SPEC_CLASH is needed for that omission.

The individual main, hgroup, and selectedcontent category summaries omit
qualifiers that appear in the detailed category lists. Their permitted contexts
or content models make those qualifiers hold in conforming uses. Queries use
the explicit conditional definitions for arbitrary DOM states; this is not a
claim that browser layout or accessibility helpers enforce those definitions.

`category-inventory.test.ts` independently transposes the specification's lists
into expectations for all 15 current enum values. The category and content-model
tests cover live attribute/tree/text changes, namespace lookalikes, foreign-root
identities, and the explicit dependency stubs. No cache or DOM mutation validator
is installed by this slice.

### Sections 3.2.5.3 and 3.2.5.4 transparency and paragraphs

`resolveContentModelTransparency(element)` in
[`content-model.ts`](../dom/nodes/element-definitions/content-model.ts) resolves
transparent portions from the current parent context while
`ElementImpl.getContentModel()` retains the declaration. Internal position
matching selects the admitting portion, rather than copying the parent's whole
sequence. Nested transparent elements follow the context outward; an orphan
uses flow content. Own and inherited descendant restrictions
are retained. `ContentModel.childRules` contains the independent `ChildRule`
requirements; `forbiddenDescendants` retains its prohibition meaning. No
prototype metadata or DOM nodes are changed.

Position matching currently handles homogeneous unbounded repetitions and fixed
single-node prefixes followed by such a repetition, including details' summary
followed by flow content. General sequences, bounded/compound repetitions, and
ambiguous positions need the future matcher. Ruby's model remains unfinished;
its example must not receive the whole ruby model or a permissive flow fallback.
Non-element parent contexts and intersections nested inside a sequence/repetition
also remain explicit throwing dependencies. Foreign elements use the same
ElementImpl model contract; their missing models still throw. Independent
top-level child rules are retained when resolving transparency.

The small model inventory now includes ins/del, map, object, body, div, section, header,
li, h1–h6, em, and span alongside the earlier examples. Div's ordinary flow model
switches to transparent inside select/optgroup/option ancestry. Its direct-child
dl model remains a throwing dependency, taking precedence over that ancestry.
Media's mixed models, noscript's scripting-dependent model, and the remaining
element definitions stay with their owners.

The resolver supports a transparent tail inside a sequence. A regression supplies
audio/video's no-src model (source elements, then track elements, then transparent
content) and checks flow/phrasing inheritance while retaining its prefix and
descendant restriction. Actual media declarations and position matching within
their variable-length prefixes remain for the media slice.

`getParagraphs(document: DocumentImpl)` in
[`paragraphs.ts`](../dom/nodes/element-definitions/paragraphs.ts) returns snapshot
records for the whole document: an explicit p element or the original first/last
nodes of an implicit run. The signature excludes arbitrary element roots, which
could truncate a paragraph spanning a/ins/del/map boundaries. Element traversal
stays private and receives elements retained in the paragraph view, including
when the document element itself must be flattened. Body's flow model allows
paragraphs formed by its direct phrasing content. The query has no production
caller yet. It does not create live Ranges or retain a cache; callers recompute
after mutations. Results list an outer run before its nested paragraphs and
otherwise follow the view's tree order.

The view removes exactly a, ins, del, and map. It preserves embedded objects as
members of outer runs while also inspecting their fallback children, so the
specification's five overlapping paragraphs are represented. Comments and
processing instructions do not split runs. Text whitespace remains in a run's
boundaries but cannot qualify a paragraph by itself; embedded-only runs likewise
do not qualify. Empty p elements still form explicit paragraphs.

Child collection preserves `ElementImpl | TextImpl`, so category queries need
no repeated node-kind narrowing. Each child is classified as phrasing once;
significance checks stop when a run qualifies. Explicit p elements only recurse
to discover nested paragraphs, without classifying their children for implicit
runs. Leaves avoid allocating child arrays. The bounded child array remains:
it keeps flattened boundaries and outer-before-inner ordering straightforward.

Paragraph discovery derives the container decision from the effective model
through `modelAllowsImplicitParagraphs(model)`, rather than a second inventory.
Flow, phrasing, text, empty, fixed-element, repetition, and sequence rules supply
the bounded cases. Intersecting requirements
and other category mixtures remain explicit dependencies. Missing container
models or category inventories, including foreign content, throw when needed. The
query does not implement layout, editing, automatic insertion checks, or the
optional conformance-checker warning for overlapping paragraphs.

A focused local source review on 2026-10-18 found editing paragraph traversal,
not a directly reusable implementation of this definition:
[Blink](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/editing/position_units_paragraph.cc)
and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/editing/VisibleUnits.cpp)
walk nodes to find rendered paragraph boundaries, using layout objects,
visibility, line breaks, and editing boundaries.
[Gecko](https://searchfox.org/mozilla-central/source/editor/libeditor/HTMLEditUtils.cpp)
also uses editing block/inline classification and computed display styles.
Those are different questions from HTML's paragraph view; their criteria are
not substituted for content-category or content-model queries here.

The transparency and paragraph tests cover current-parent changes, orphan and
nested resolution, sequence-position selection, explicit dependencies, wrapper
spans, ignored nodes, whitespace, and the specification's fallback example.
Paragraph regressions also enforce the document-only parameter type, preserve a
complete run spanning an anchor, and cover empty documents and a flattened
document element.

### Section 3.2.6 global-attribute preamble

The [global-attribute preamble](https://html.spec.whatwg.org/multipage/dom.html#global-attributes)
is accounted for below. Title and language processing are covered in the
following slices; the remaining attribute subsections remain separate work.
[`attributes/global.ts`](../dom/nodes/html/attributes/global.ts)
owns the shared name inventory, consumed by `HTMLElementImpl.allowsContentAttribute()`.
The query tests permission to specify a namespace-less name. It neither checks
attribute values/required companion attributes nor adds mutation restrictions.
Globals are recognized even when an element-specific inventory is unfinished,
including custom and unknown HTML elements. Foreign elements retain their own
namespace's attribute rules; a same-spelled attribute does not acquire HTML behavior.

| Preamble requirement | Implementation or explicit dependency |
| --- | --- |
| Named globals | All 28 names in the initial list are shared once. Their processing remains with each attribute's owning section; name permission does not imply a working author API. |
| DOM's class, id, and slot | All three names are permitted. Existing Element attribute/token-list behavior and slot assignment remain the runtime owners. Class tokens have no extra HTML restrictions. An ID is opaque; nonempty/no-ASCII-whitespace/tree-uniqueness requirements belong to the future author-conformance checker and do not constrain DOM setters. |
| HTML-only attribute meaning | The eligibility query lives on HTMLElementImpl. §3.2.6.4 now exercises the preamble's foreign-dir example: foreign elements inherit direction without interpreting their dir attributes. |
| ARIA role and aria-* | Permission depends on ARIA in HTML's element/role rules. These queries throw explicitly until that inventory exists; the prefix alone does not grant permission. Accessibility mappings and custom-element defaults remain with §3.2.9 and HTML-AAM. |
| Listed event-handler content attributes | Every handler in the preamble is recognized, including the body/Window-target names, plus §8.1's global onabort, onwebkitanimationend, onwebkitanimationiteration, onwebkitanimationstart, and onwebkittransitionend. Compilation, CSP, listeners, and body/frameset Window targeting remain with §8.1 and the element owners. The inventory does not install handlers. |
| Further event-handler names | Window-only names and contributions from other standards remain explicit dependencies. The broader Trusted Types sink list answers a security-classification question and cannot supply element conformance permissions. A future handler inventory must distinguish valid additional names from unknown on* spellings. |
| Custom data attributes | Recognize a valid DOM attribute local name beginning data-, with a nonempty suffix and no ASCII uppercase letters. Non-ASCII uppercase letters are permitted. Values remain unrestricted attribute strings. The live DOMStringMap and dataset API belong to §3.2.6.6; custom data does not add user-agent behavior. |
| Namespace-less xmlns | Name permission follows the current node document's HTML/XML type, including after adoption. Its required value is exactly the HTML namespace string; checking that value remains author-conformance work. This HTML compatibility attribute has no namespace-changing effect. Actual XML namespace declarations are a separate namespace-aware contract. |
| XML's xml:space | Existing namespaced attribute storage preserves it, and DOM text remains unchanged. A namespace-less xml:space lookalike is not global. XML serialization remains with the parsing/serialization owner; the attribute cannot be serialized on HTML elements in text/html. |

The compatibility spelling xml:lang is permitted only in HTML documents; its
companion lang attribute and equal-value requirements are recorded in §3.2.6.2 below.
The existing name-only query intentionally cannot validate a namespaced attribute:
future namespace-aware author conformance must inspect its namespace and local
name rather than treating a qualified spelling as equivalent.

The inventory pulls no later interaction/editing implementation forward. Focus,
hidden/inert processing, access keys, drag-and-drop, editing, popovers, microdata,
heading computation, and custom-element is behavior keep the owners recorded in
the §3.2.2 dependency table. Translation and directionality are accounted for
below; inline-style CSP and dataset remain coming global-attribute slices.
Further dependencies must stay explicit when those algorithms require them.

`attributes/global.test.ts` covers every listed name, custom/unknown elements,
custom-data syntax and values, current-document xmlns permission, explicit
dependencies, and XML whitespace storage. Existing DOM attribute, token-list,
and slot regressions exercise the reused mutation behavior. Content-attribute
tests preserve anchor's conditional permissions and unrestricted DOM mutation.

### Section 3.2.6.1 title advisory information

[`HTMLElementImpl.getAdvisoryInformation()`](../dom/nodes/html/html-element.ts)
implements [advisory-information lookup](https://html.spec.whatwg.org/multipage/dom.html#advisory-information),
following browsers' flat-tree ancestry as recorded below. It reads the current
tree and attributes on demand. No cached title or mutation hook is needed. This
is an implementation query; `HTMLElement.title` remains the existing reflected
DOMString property.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| Arbitrary advisory text | A null-namespace title on the element wins, including whitespace-only text. Otherwise lookup follows flat-tree parents, including assigned slots and shadow hosts. Foreign-element attributes and namespaced lookalikes do not gain HTML title semantics. |
| Empty title | A present empty string stops inheritance and means no advisory information. With no applicable title, the result is also empty. |
| Newlines | Infra's normalize-newlines operation converts CRLF and CR to LF. Other text is preserved, and neither the content attribute nor its reflected IDL value is changed. Each LF represents a line break for a future presenter. |
| Reflection | Existing `[CEReactions, Reflect]` title exposes only the element's own unnormalized attribute, or an empty string when absent. Custom-element reaction delivery remains the previously recorded §4.13 dependency. |
| Link and style exceptions | These elements never inherit a title. A style element's own title is also ignored outside a document tree, including in a connected shadow tree. Their overrides apply both to direct queries and when traversing ancestors. Raw attributes and IDL reflection remain unchanged. |
| Discovery and presentation | §3.2.6.1 requires informing users when advisory information is available. Interaction and rendering must supply that indication and a way to request/read the text, including keyboard and touch access. This slice installs no tooltip UI. See the [rendering boundary](../rendering/ROADMAP.md#title-advisory-presentation). |
| Additional element-specific meanings | Link titles and link/style sheet-set names belong to §§4.2.4–4.2.6; abbreviation expansions and defining terms to §§4.5.8–4.5.9; input pattern guidance to §4.10.5. These consumers must not use inherited advisory text as their metadata. Existing LinkStyle integration reads the element's own title; full stylesheet-set processing, term/expansion algorithms, and validation-message presentation remain with those owners. |

`NodeImpl.getFlatTreeParent()` uses the current slot-assignment state. Unassigned
light children and replaced slot fallback cannot inherit through those hidden
branches. The advisory query asks each HTML ancestor for its own information;
the link/style overrides stop inheritance without a second traversal or tag
checks in the general algorithm.

Additional title meanings remain with their element owners. For example, dfn's
defining term uses its own title, its sole abbr child's title, or descendant text.
The advisory query does not implement those term/expansion algorithms or full
stylesheet-set processing.

SPEC_CLASH(title-shadow-ancestry): Browlet follows browsers' flat-tree ancestry
instead of HTML's ordinary parent-element algorithm. Shadow children can inherit
a host's title, and assigned content follows its slot. Browser tooltip providers
inspected on 2026-10-18 use the following traversals:

- [Blink HitTestResult::Title](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/layout/hit_test_result.cc)
  uses FlatTreeTraversal::Parent.
- [Gecko TooltipTextProvider](https://searchfox.org/mozilla-central/source/toolkit/components/tooltiptext/TooltipTextProvider.sys.mjs)
  uses flattenedTreeParentNode.
- [WebKit HitTestResult::title](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/HitTestResult.cpp)
  uses parentInComposedTree.

These are source observations of tooltip providers, which also handle other
tooltip sources and presentation policy; no native-tooltip oracle was run.
The exact discrepancy is tracked by
[WHATWG HTML #13035](https://github.com/whatwg/html/issues/13035), which remains
open with the compat and topic: shadow labels as of 2026-10-18. The report
proposes using flat-tree parentage. Its concrete example is GitHub's relative-time
component: a host title supplies the full timestamp for text rendered inside its
shadow tree. It also covers titles inherited through assigned slots. The captured
issue has no substantive replies, and a search for pull requests referencing it
found none; this is a compatibility report, not an adopted specification change.

The approved choice preserves advisory text in those existing components. It
does not establish historical intent behind the current wording or substitute
for a future native-tooltip integration test. Hit testing and advisory-information
presentation remain separate dependencies.

`attributes/title.test.ts` covers own/inherited/empty values, live ancestry and
adoption, foreign and namespaced attributes, line-ending preservation, open and
closed shadow roots, named/manual slot reassignment, replaced fallback, nested
slot reprojection, link/style non-inheritance, style titles outside document
trees, and raw IDL reflection.
`test/infra/strings.test.ts` covers the shared newline operation.

### Section 3.2.6.2 lang and xml:lang

[`NodeImpl.getLanguage()`](../dom/nodes/node.ts) implements HTML's
[language determination](https://html.spec.whatwg.org/multipage/dom.html#language).
This is a node query, not a reflected attribute: text and other nodes can inherit
language, and foreign elements participate through XML's namespaced attribute.
The existing `HTMLElement.lang` reflection still exposes only its own raw,
null-namespace attribute. Queries read current attributes, ancestry, and document
state; no cached language or additional mutation hooks are introduced.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| XML priority | A lang attribute in the XML namespace takes priority on every element, including HTML elements in an HTML document. Its prefix is irrelevant. Authoring restrictions do not change runtime processing. |
| Plain lang | A null-namespace lang is recognized on HTML and SVG elements. It does not acquire that meaning on MathML or arbitrary foreign elements. Attribute local names are case-sensitive; normal HTML attribute APIs/parser casing rules remain their existing owners. |
| Inheritance | Ordinary parent elements supply language. A child of a shadow root instead inherits from its host, in open and closed trees. Assigned slots do not replace light-tree parents; fallback content retains its DOM language even when not rendered. This deliberately differs from advisory-title lookup. |
| Unknown and unrecognized tags | Empty language stops inheritance. Other tags pass through unchanged, including unrecognized values; no trimming, canonicalization, registry validation, or locale guessing occurs in this query. Consumers receive BCP 47 language tags, not another language-name notation. |
| Document defaults | The pragma-set default wins over the protocol language. Response integration retains the first nonempty Content-Language list member across comma-separated or repeated fields, trimming field whitespace through Fetch's list parser. No supplied language means the empty string. Detached/adopted nodes consult their current node document. |
| Pragma producer | Document.pragmaLanguage is explicit state, but HTMLMetaElement's §4.2.5 processing does not populate it yet. Its eventual producer must reject missing/empty/comma-containing content and select the first ASCII-whitespace-delimited token on successful processing. Do not replace the pragma lifecycle with a scan of current meta elements during language lookup. |
| Compatibility spelling | A namespace-less literal xml:lang is permitted on HTML elements only in HTML documents and has no effect on language determination. allowsContentAttribute answers this name/document permission, not value or companion-attribute conformance. |
| Author conformance | BCP 47 validity or an empty value, equal lang/xml:lang values under ASCII-insensitive comparison, the required plain lang companion for the compatibility spelling, and the prohibition on namespaced XML lang on HTML elements in HTML documents remain checks for a future conformance checker. DOM mutation remains unrestricted. Namespace-aware checks must inspect the actual namespace/local name rather than the qualified spelling. |
| Selector consumers | Selectlet and Stylelet require DOMOperations.getLanguage. Browlet delegates to NodeImpl, keeping document defaults and node lookup in their owner. standardDOM owns attribute/ancestry lookup for platform DOM hosts, whose APIs do not expose retained HTTP/pragma defaults. Custom hosts supply their own query. Empty-string and wildcard matching stay separate. |
| Other consumers | Font selection, pronunciation, dictionaries/spellchecking, form-control language, and accessibility delivery remain with rendering, editing, form controls, and accessibility. Language is not a resolved page locale or text direction. No layout or locale-service facade is added here. |

The Selectlet integration also corrects XML priority and foreign-namespace
handling in its fallback and accepts quoted/escaped single language ranges.
Its comma-separated range-list support remains unfinished. Full CSS language
range validation, BCP 47 canonicalization, and extlang conversion remain selector
work; preserving a raw HTML language tag does not itself establish CSS range
validity. Style invalidation/layout consumers must account for document-default
changes when those producers and caches are implemented.

Maintained browser comparisons live in Selectlet's
`test/selectlet/scenarios/02_regression/pseudo-language.test.ts` and
`test/selectlet/scenarios/03_wpt/html/dom/elements/global-attributes/lang-attribute-shadow.window.test.ts`.
They compare Selectlet with native selectors in Chromium, Firefox, and WebKit,
covering identifier/string ranges, ASCII-only casing, escapes and string newlines,
unknown language, namespace priority, and shadow/slot ancestry. The groups run
normally as maintained regressions. The shadow tests record native Firefox's
observed empty result separately from Selectlet's HTML-conforming slot match;
the string-range cases retain their approved browser-specific expected failures.

Browser checks on 2026-10-18 used Playwright's Chromium 149.0.7827.55, Firefox 151.0,
and WebKit 26.5, with a fulfilled HTTPS document carrying Content-Language.
All three agree on XML priority (including an empty XML lang), ordinary light-tree
ancestry for assigned content, fallback-content language, and distinct xyzzy/abcde
tags. HTML fallback and inheritance need continuing compatibility records:

| Probe | Written HTML | Browlet | Chromium | Firefox | WebKit |
| --- | --- | --- | --- | --- | --- |
| Detached div, no language attributes, response Content-Language: fr; :lang(fr) | true | true | false | true | false |
| Connected body, response Content-Language: fr,en; :lang(fr), :lang(en) | false, false | true, false | true, false | true, true | true, false |
| Shadow child without lang, host lang=en; :lang(en) | true | true | true | false | true |

SPEC_CLASH(language-protocol-fallback): Use the first nonempty HTTP language,
matching Chromium/WebKit. Written HTML instead makes multiple languages unknown;
Firefox exposes multiple languages to CSS. For detached nodes, retain HTML's
explicit document fallback; Chromium/WebKit require connected ancestry to reach
the HTTP default. This compatibility choice changes language selection only,
not the retained Fetch response headers.

The [W3C internationalization tests](https://www.w3.org/International/tests/repo/results/the-lang-attribute)
already record the multi-language discrepancy, including Firefox matching several
languages. The [W3C explanation](https://www.w3.org/International/questions/qa-http-and-lang)
distinguishes HTTP audience metadata from the single language used for processing
text, explaining why HTML only uses an unambiguous HTTP default. This is historical
evidence, not a claim about current browser versions.

A follow-up on the same date tested real HTTP/1.1 responses from a loopback server,
without Playwright response interception. A Node HTTP server supplied repeated
fields through the raw header array accepted by `writeHead()`; a separate Node
HTTP client verified the received `rawHeaders` before browser navigation. Documents
had no lang attributes or language pragma. Both `Element.matches()` and stylesheet
matching produced the same results:

| Content-Language wire format | Browlet's current :lang(fr), :lang(en) | Chromium | Firefox | WebKit |
| --- | --- | --- | --- | --- |
| One field: fr, en | true, false | true, false | true, true | true, false |
| Two fields: fr followed by en | true, false | true, false | true, true | true, false |
| One field: en, fr | false, true | false, true | true, true | false, true |
| Two fields: en followed by fr | false, true | false, true | true, true | false, true |

Single-language and missing-header controls passed. The probe also repeated the
ko/ja pair used by WPT and checked repeated fr values in both formats. Every browser
treated each split-field case like its comma-list counterpart. In all three,
`fetch().headers.get('Content-Language')` returned the combined comma-separated
value, including both languages. This agrees with HTTP's field-combination rule
and Content-Language list syntax in [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.3).
The disagreement is how HTML uses that list as a language fallback, not whether
the second field survived transport.

[WPT commit 68ea9c7](https://github.com/web-platform-tests/wpt/commit/68ea9c7cfaa91f1cb82cd5e8e6b534476e2a150d)
(September 2026) sends separate ko and ja fields and checks that :lang(ko) applies.
It does not check that :lang(ja) fails: Chromium/WebKit's first-language behavior
and Firefox's multiple-language behavior both satisfy its assertion. The test
therefore contradicts HTML's unknown-language result without establishing a
first-language-only consensus. Browlet combines the fields through Fetch and
selects the first nonempty language, following Chromium/WebKit. The real-network
`loader/document-loader.test.ts` exercises both header formats through decoding
and HTML parsing, then checks inherited :lang() matches and an explicit lang
override. Its test-supplied navigation coordination does not complete the missing
Fetch-backed public navigation path.

For detached nodes, the [2020 proposal in HTML #4906](https://github.com/whatwg/html/issues/4906#issuecomment-603662494)
explicitly limited document fallback to a tree rooted at a Document. The current
algorithm does not retain that condition. This helps explain the implementation
shape, but no separate resolution for detached nodes was found; Browlet keeps the
current written fallback rather than inferring a requirement from that proposal.

SPEC_CLASH(language-shadow-inheritance): Follow HTML's explicit shadow-host step,
also observed in Chromium/WebKit. Firefox's :lang() did not inherit from the host
in the tested closed shadow tree. Assigned light children still use their DOM
parent in all three browsers. These checks observe selector behavior, since the
platform does not expose a general computed-language property.

[HTML #4906](https://github.com/whatwg/html/issues/4906) explains the choice: retain
the ancestry visible to each tree's author, with host language as a default for
the shadow tree, without allowing slot placement to redefine light-tree language.
The language algorithm was subsequently updated in [HTML #9796](https://github.com/whatwg/html/pull/9796)
in 2023. [Firefox bug 1740283](https://bugzilla.mozilla.org/show_bug.cgi?id=1740283)
tracks the shadow-tree :lang() failure and remains open in the inspected tracker.
The still-open HTML discussion is historical context, not evidence that the
current written algorithm lacks the host-inheritance rule.

SPEC_CLASH(language-selector-ranges): Follow CSS's quoted language ranges and
empty-range matching. In the same installed browsers, the focused follow-up
probe gave these results:

| Element language and selector | CSS result retained by Browlet | Chromium default | Chromium with CSSLangExtendedRanges | Firefox | WebKit |
| --- | --- | --- | --- | --- | --- |
| lang=en; :lang("en") | true | SyntaxError | true | true | true |
| lang=und; :lang("*") | true | SyntaxError | true | true | true |
| lang=""; :lang("") | true | SyntaxError | true | false | false |
| lang=""; :lang("*") | false | SyntaxError | false | false | false |

[CSSWG #6915](https://github.com/w3c/csswg-drafts/issues/6915) added empty-range
matching in November 2022. Its text was accidentally overwritten in a later merge
and [restored in May 2025](https://github.com/w3c/csswg-drafts/issues/6915#issuecomment-2856142185).
The distinction is deliberate: untagged language matches the empty range, while
the explicit tag und matches the wildcard. [HTML #8288](https://github.com/whatwg/html/issues/8288)
also confirms that missing language information yields the empty tag.

[Chromium's implementation discussion](https://groups.google.com/a/chromium.org/g/blink-dev/c/tO598HXuS94)
records the feature behind CSSLangExtendedRanges; enabling it in our installed
Chromium reproduces CSS's required results above. [WebKit bug 139678](https://bugs.webkit.org/show_bug.cgi?format=multiple&id=139678)
documents the older 2014 decision that an empty range never matches, preceding
the CSSWG change. These are implementation/version differences; the investigation
found no reason to replace the approved CSS behavior with the older results.

`attributes/lang.test.ts` covers HTML/XML documents, namespace precedence,
unknown/raw values, non-element nodes, live ancestry/adoption, shadow hosts
versus slots, document-default precedence, response-header selection, compatibility
name permission, and projected :lang() behavior. The selector host tests exercise
both Browlet's query and the fallback for other hosts.

### Section 3.2.6.3 translate

[`ElementImpl.isTranslationEnabled()`](../dom/nodes/element.ts) supplies the
translation-mode query for every element. HTMLElement interprets its own
translate attribute before inheriting; foreign elements inherit without giving
their translate attribute HTML meaning. `HTMLElement.translate` exposes this
result and writes the canonical yes/no keywords through normal attribute mutation.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| Keywords and defaults | The shared EnumeratedAttribute definition recognizes ASCII-case-insensitive yes/no without trimming. Missing and invalid values inherit; an empty value enables translation. |
| Inheritance | Ordinary parent elements supply the mode, including through foreign elements. No parent element means enabled. Shadow roots stop inheritance; slot assignment does not replace a light child's parent. Queries read current attributes and ancestry without a cache. |
| Public property | The boolean getter exposes the mode; the setter writes yes or no, rather than adding/removing a boolean attribute. Web IDL supplies boolean conversion and retains the CEReactions annotation; reaction entry/exit wrapping and delivery remain [§4.13 work](../dom/nodes/html/custom-elements/ROADMAP.md). |
| Attribute inventory | Element.isTranslatableAttribute takes an attribute belonging to the receiver. It checks the namespace once, then queries the shared prototype inventory through the name predicate. Element starts with an empty inventory; HTMLElement adds lang, style, and title. Individual implementations extend the inherited array with the fixed names below. Only input and meta override the predicate for their instance-dependent cases. Classification is independent of the current translation mode. |
| Conditional input value | The existing input type-state parser limits value to Button and Reset Button, including mixed-case keywords. Submit and other input states are excluded. |
| Conditional meta content | No nonempty name means content is not translatable under this rule. A nonempty name requires §4.2.5's metadata-name classification; that branch throws an explicit missing-dependency error until those definitions are implemented. |
| Other specifications | ARIA attribute queries explicitly throw pending its translation metadata. Other specifications can extend the element predicates when integrated. No arbitrary attribute is assumed translatable. |
| Localization consumer | No page-localization service is implemented. Its traversal must consult each element's mode before translating eligible attributes and direct Text children, while still visiting descendants that can re-enable translation. A no-translate ancestor cannot justify pruning the whole subtree. |
| Structured values | A future localizer must set lang to the target language, parse and recursively process iframe srcdoc as HTML, and parse and recursively process style as CSS, including content values. The predicates identify these attributes; they neither rewrite values nor claim that an ordinary string translator can process them correctly. |

The HTML inventory is complete apart from the explicit metadata-name dependency:
th adds abbr; area adds alt/download; img adds alt; input adds alt/placeholder and
conditional value; a adds download; optgroup/option/track add label; textarea adds
placeholder; iframe adds srcdoc. Title remains translatable on link and style
even though their advisory-information lookup has separate exceptions.

Each extending class creates its inventory once during class initialization,
preserving inherited names without mutating the parent's array. Instances read
the shared list from their prototype; no per-instance list or query-time merge
is needed. Conditional input value and meta content remain outside the fixed
inventory.

SPEC_CLASH(translate-empty-value): Follow HTML, Chromium, and WebKit: an empty
translate attribute is the Yes state and overrides a no-translate parent.
Firefox 151 instead inherits for that value. HTML explicitly specifies the
empty-value default, so this is an implementation disagreement, not a spec gap.

On 2026-10-18, a Playwright probe against Chromium 149.0.7827.55, Firefox 151.0,
and WebKit 26.5 confirmed that difference. All other checked cases agreed:
yes/no case folding, missing/invalid values, no whitespace trimming or Unicode
folding, foreign/XML ancestry, detachment, open/closed shadow roots, slot
assignment, and setter boolean conversion/canonical keywords.

Firefox already records the exact case as a failure in
[the-translate-attribute-012.html.ini](https://searchfox.org/mozilla-central/source/testing/web-platform/meta/html/dom/elements/global-attributes/the-translate-attribute-012.html.ini).
Its paired WPT requires an empty attribute beneath translate=no to enable
translation. Source inspection also suggests the cause: HTMLElement's attribute
parser stores translate as an atom, while Translate() tests IsEmptyString(),
which checks the empty-string representation instead of the empty atom.
This is a source-based explanation, not a debugger trace of the installed build.

`attributes/translate.test.ts` retains the mode, binding, inventory, conditional
input, namespace, and explicit-dependency regressions. The reproducible local
`scratch/TRANSLATE-PROBE.mjs` keeps the spec expectation and reports the Firefox
failure without preventing the other engines from running.

### Section 3.2.6.4 dir

[The dir attribute](https://html.spec.whatwg.org/multipage/dom.html#the-dir-attribute)
is implemented as current-state queries on Element, HTMLElement, and Text.
Foreign elements inherit; HTML elements interpret dir, with bdi and telephone
inputs specializing its Undefined state. No direction cache or layout state is
inferred. Ordinary mutations are visible on the next query.
Infra's shared contained-text scan uses each caller's existing DOMOperations
provider. Boundary and slot queries delegate to Browlet's element methods;
fixed exclusions remain prototype flags on bdi/script/style/textarea, with
recognized dir states supplying the instance-dependent boundary elsewhere.
Control values and slot assignments retain their element-specific overrides.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| Keywords and reflection | EnumeratedAttribute recognizes ASCII-case-insensitive ltr/rtl/auto without trimming. Missing/invalid values share Undefined. HTMLElement.dir returns a canonical known keyword or empty string; its setter preserves the supplied attribute value. |
| Document.dir | Forwards to the HTML html document element only. No root, a different HTML root, or a foreign html root yields an empty getter and an ignored setter. Both IDL declarations retain CEReactions; reaction wrapping/delivery remain §4.13 work. |
| Parent directionality | Follow the ordinary parent element; an immediate shadow root delegates to its host. No such parent means ltr. Slot assignment does not replace a light child's ancestry. |
| Automatic text | Scan eligible descendants in tree order, pruning bdi/script/style/textarea and HTML elements with a recognized dir state. Foreign dir attributes do not create boundaries. Text includes CDATA; the first Unicode L/R/AL character decides, and no strong text ultimately defaults to ltr. |
| Assigned slots | A slot in a shadow tree uses its nonempty assigned-node list. Assigned elements are scanned with root exclusion enabled; excluded/neutral assignments do not revive fallback text. A slot encountered inside another contained-text scan contributes its shadow host's direction. Open and closed roots use the same implementation path. |
| Form-associated auto direction | Hidden/Text/Search/Tel/URL/Email/Password/Submit/Reset/Button inputs and textarea use their current value: first strong direction, otherwise ltr for nonempty neutral values, null for an empty value. The input and textarea value getters explicitly throw until their §4.10 lifecycle exists. Tests supply this narrow value dependency separately; real controls never substitute the value attribute or default child text. Other input types follow the ordinary contained-text scan. |
| Attribute directionality | HTMLElement.getAttributeDirectionality receives one of its own attributes. Explicit auto plus a directionality-capable null-namespace attribute uses that value's first strong character, otherwise ltr. Other cases use the element's direction; implicit bdi auto does not trigger the attribute rule. |
| Fixed attribute inventory | Shared prototype lists: title on all HTML elements; abbr on th; alt on area/img/input; label on optgroup/option/track; placeholder on input/textarea. Derived lists copy inherited names rather than mutate the parent. |
| Conditional meta content | A nonempty name requires §4.2.5 to determine whether its value is primarily human-readable. That branch throws an explicit missing-dependency error. No name means this rule does not apply. |
| Selectors | Required DOMOperations.getDirectionality replaces the duplicate approximations in Selectlet and Stylelet. Browlet delegates to its implementation; standardDOM computes from the standard host API, including live control values. CSS direction does not change :dir(). |
| Rendering and editing | Base direction is not visual order. Bidi isolation/override, full UAX #9, pre/textarea per-paragraph rendering, attribute presentation, and direction-changing editing UI remain explicit [rendering dependencies](../rendering/ROADMAP.md#directionality-and-bidi-presentation). |

Infra's firstStrongDirection uses a generated, sorted range table from
[Unicode 17 DerivedBidiClass](https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedBidiClass.txt).
It includes supplementary code points and the UCD defaults for unassigned
characters, while excluding digits, combining marks, and formatting classes
that are not L/R/AL. `scripts/generate-bidi-data.mjs` regenerates it from the
pinned download or a supplied local copy; the generator contains the Unicode
license and embeds it in the generated table. This is a classifier, not a
Unicode bidi layout implementation.

The table stores lossless gap/length/direction pairs as seven-bit unsigned
integers in Base64 (1,712 characters for 564 ranges). The first nonempty lookup
expands it into one Uint32Array of inclusive start/end/direction triples using
Infra's existing Base64 decoder. Later lookups reuse the array and binary search;
there is no runtime compression-library dependency. A full-code-point digest
test preserves the pre-packing Unicode 17 classification, including the holes
for non-strong characters, and a separate test checks lazy initialization.

Browser checks on 2026-10-18 used Chromium 149.0.7827.55, Firefox 151.0, and
WebKit 26.5. Eric approved following the written HTML algorithm for these
continuing differences:

- SPEC_CLASH(dir-foreign-elements): Chromium/Firefox ignore foreign dir attributes
  for inheritance and contained-text boundaries. WebKit honors them; Browlet
  follows HTML/Chromium/Firefox.
- SPEC_CLASH(dir-assigned-root): Chromium/Firefox exclude an assigned element
  whose own dir is defined from a slot's auto scan. WebKit scans its text;
  Browlet follows HTML/Chromium/Firefox.
- SPEC_CLASH(dir-nontext-input): With Hebrew text appended through the DOM to a
  checkbox with dir=auto, Chromium/Firefox return ltr. HTML's ordinary text scan
  and WebKit return rtl; Browlet follows HTML/WebKit. The value attribute is not
  the source for this input type. Chromium's result depends on mutation order;
  it does not consistently ignore child text.

Follow-up investigation on 2026-10-18 supports keeping all three choices:

- Assigned-root exclusion is an intentional correction, not an inferred rule.
  [HTML PR #10561](https://github.com/whatwg/html/pull/10561), merged in August
  2024, explicitly fixes both the missing root exclusion and inappropriate
  recursion into form-value/nested-slot algorithms. Its
  [review explanation](https://github.com/whatwg/html/pull/10561#issuecomment-2296674538)
  and [WPT change #47670](https://github.com/web-platform-tests/wpt/pull/47670)
  cover the exact assigned-dir case. The inspected WebKit
  `ElementTextDirection.cpp` still calls the full auto-directionality algorithm
  for assigned elements without that exclusion; this explains the observed
  result and resembles the algorithm before the correction. The PR links the
  wider [WebKit shadow-directionality bug #267951](https://bugs.webkit.org/show_bug.cgi?id=267951).
- For foreign elements, HTML explicitly limits dir interpretation to the HTML
  namespace. The inspected WebKit `elementTextDirectionState` reads dir from
  any Element, which explains its competing result. Discussion in
  [HTML PR #9554](https://github.com/whatwg/html/pull/9554#issuecomment-1674938149)
  distinguishes non-HTML behavior from missing-parent behavior, but does not
  justify honoring foreign dir attributes. No discussion establishing a
  deliberate alternative rule was found. Keep HTML/Chromium/Firefox here.
- For nontext inputs, [HTML PR #9689](https://github.com/whatwg/html/pull/9689)
  explains the selected control types that use their current value; it does
  not address DOM-appended children on the remaining input types. One minimized
  duplicate comment was unavailable to the reader. A follow-up browser probe
  tested checkbox/radio/image controls with both operation orders. Chromium
  returns ltr when Hebrew is appended after dir=auto, but rtl when dir=auto is
  set after the Hebrew text. Toggling dir also corrects it, after which changing
  the text to Latin leaves a stale rtl result. Its `HTMLInputElement::ChildrenChanged`
  calls `ContainerNode::ChildrenChanged`, bypassing Element's direction update;
  this is consistent with the observed stale result. Firefox stays ltr in all
  these cases, and its `ParticipatesInAutoDirection` excludes every HTML input.
  WebKit updates after each mutation. These are observations and source-based
  explanations, not evidence of an agreed competing standard. Keep the written
  scan; do not reproduce Chromium's mutation-order dependence. The manual
  `scratch/DIR-MUTATIONS-PROBE.mjs` reproduces these differences; Browlet and
  standardDOM regressions retain the correct mutation behavior.

`attributes/dir.test.ts` covers reflection/bindings, root identity, inheritance,
mutations, foreign elements, shadow/slot rules, attribute inventories, and explicit
missing dependencies. `test/infra/bidi.test.ts` covers Unicode boundaries.
The enabled Selectlet `pseudo-directionality` browser regression suite exercises
our selector engine and preserves spec expectations with
separate browser failure markers; selector unit regressions first reproduced
the old Arabic-digit, CJK/astral, script-text, and foreign-dir errors before
the approximation was removed.

## Section 3.2.6.5 — style

The global inventory already permits `style`, and ElementCSSInlineStyle already
supplies SameObject/PutForwards reflection. This slice adds immediate attribute
parsing and inline CSP checks, including parser input before the first CSSOM
read. CSSOM writes bypass the attribute-input policy check. Declaration parsing
now recovers after unmatched braces and rejects nested-rule syntax as attribute
input. The [style roadmap](../style/ROADMAP.md#style-attributes--html-3265)
records the CSS Style Attributes/CSSOM ownership and browser evidence; the
[CSP roadmap](../browsing/policy/csp/ROADMAP.md#style-attribute-consumer) records
the approved retained-state, reporting, nonce, and hash differences.

URL-valued property integration must retain parse-time base URLs; eager parsing
does not implement that missing value/provenance pipeline. Full CSSStyleProperties
projection and rendering remain explicit style dependencies. HTML's requirement
that content remain usable without the style attribute is author conformance,
not a DOM rejection rule. The next global-attribute section is §3.2.6.6, `data-*`.

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
| §4.12 scripting elements and canvas | `dom/nodes/html/scripting/` owns script, noscript, template, slot, and canvas elements; script execution belongs to `scripting/` and loading to `loader/`; canvas rendering is a later graphics subsystem |
| §4.13 custom elements | `dom/nodes/html/custom-elements/`, integrated with DOM mutations and Web IDL `[CEReactions]` |

Element interfaces do not own the subsystems they expose. In particular,
`HTMLIFrameElement` does not own WindowProxy or navigation, `HTMLScriptElement`
does not own script records, and `HTMLLinkElement` does not own style-sheet
semantics.

## HTML section 5 ownership

Current HTML §5 defines Microdata attributes and extraction algorithms, but no
Microdata Web IDL interfaces. `html/microdata/` owns item/property discovery
and JSON extraction over the DOM; reflected properties belong with element
declarations and `html/reflection/`. See its narrower roadmap for the deliberately
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
| HTML element implementations and `dom/nodes/html/attributes/` | Remaining global-attribute rules, with stateful behavior on its owning element | HTML §3.2.6 |
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
