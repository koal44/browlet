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
| Will lazy load | Each loading element asks its original `env.isScriptingEnabled()`, checks its current node document's browsing context, then tests the interpreted loading state. A detached element in an active document may qualify; a node belonging to a document without a browsing context may not. |
| Scripting disabled | `BrowletEnvironment.isScriptingEnabled()` accounts for Browlet's JavaScript support, a UserAgent scripting preference, and the original realm's currently associated document's sandbox flag. `UserAgent.webDriverBiDiScriptingIsEnabled(env)` now has an approved provisional true result for the absence of BiDi sessions, alongside the other automation hooks. Scoped override storage/selection remains unfinished. Script execution itself still needs the same gate when script preparation is implemented. |
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
| §3.2.3 HTML element constructors | `ctor.ts`, `dom/nodes/html/`, custom-element construction stacks, and Web IDL |
| §3.2.6 global attributes | `html/global-attributes.ts`, reflection, custom-element reactions, and Stylelet integration |
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
| §3.1.7 tree accessors | `head` and `body` getters, DOM tree/mutation algorithms, reusable live collections and Web IDL named-property machinery | `title`, the `body` setter, document collections and aliases, `getElementsByName`, `currentScript`, and Document named properties are missing. Named-property handling also needs embed/object exposure and child-navigable behavior. `dir` is defined with the later global attribute. |

The audit first reproduced two omissions in
[`document.test.ts`](../../../test/browlet/dom/nodes/document.test.ts): both factory
flags remained false, and cloning lost the inherited base URI. The §3.1.1 slice
fixes both and retains the regressions, including shallow and deep cloning.

Continue with §3.1.7. For the later slices, preserve the existing boundaries: Document owns its state,
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
| Anonymous named getter and `LegacyOverrideBuiltIns` | Missing §3.1.7 selection/exposure rules and their Web IDL declaration. |
| `title`, `body`, `head` | Head/body getters exist. Title and body setter remain §3.1.7; body is still readonly in executable IDL. |
| `dir` | Missing §3.2.6 global-attribute forwarding. |
| `images`, `embeds`, `plugins`, `links`, `forms`, `scripts`, `getElementsByName` | Missing §3.1.7 consumers of the existing live collection machinery; preserve SameObject requirements and the embeds/plugins alias. |
| `currentScript` | Missing §3.1.7 state/getter and §4.12 script-execution maintenance; both concrete script types now exist. |
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
