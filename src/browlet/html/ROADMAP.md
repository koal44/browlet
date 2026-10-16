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
| §§2.6.4–2.6.5 collections | `dom/nodes/` and `dom/nodes/html/forms/` own implementations over shared live collections; `html/collections/` records scope and remaining work |
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
are covered below. The [collection roadmap](collections/ROADMAP.md) records the
implemented HTMLAllCollection and the form/options slice's explicit owner stubs.

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

The attribute and potential-blocking decisions are implemented. This does not
implement rendering waits: §3.1.6's Document mechanism and the element loading
algorithms are separate dependencies, listed explicitly below.

| Requirement | Implementation and boundary |
| --- | --- |
| Supported tokens | `dom/nodes/html/attributes/blocking.ts` defines the supported `render` token and the blocking-tokens-set algorithm. It ASCII-lowercases and splits on ASCII whitespace, filters unknown tokens, and deduplicates without modifying the attribute. |
| Author API | Link, style, and script expose stable `DOMTokenList` objects through `[SameObject, PutForwards=value]`. The existing token-list implementation preserves raw spelling, retains unknown tokens, synchronizes through DOM attribute mutation, and supplies case-insensitive `supports()`. Token mutations and forwarded assignment retain the existing provisional custom-element reaction dependency. |
| Explicit potential blocking | The three element implementations interpret the shared blocking tokens. Arbitrary HTML elements and foreign-namespace lookalikes do not acquire a blocking attribute or qualify just because their attribute list contains `blocking="render"`. |
| Implicit stylesheet blocking | Style and stylesheet-link elements retain the document whose parser created them. They qualify while that document remains their node document; link additionally requires the ASCII-insensitive `stylesheet` relationship. Parser completion and detachment do not by themselves end potential eligibility. Clones/imports do not copy parser origin. |
| Implicit script blocking | A script must have prepared type `classic`, a non-null parser document, and no null-namespace `async` or `defer` attribute. `scriptType` stores the prepared type separately from the raw attribute. The parser supplies its document, but script preparation must populate the type and perform its specified parser-document clearing/restoration. The current ad hoc script handler still does neither preparation nor render blocking. |
| Parser integration | `HTMLTreeAdapter` calls each element's `initializeFromParser()` before adding attributes or inserting the element. The default hook needs no state; link/style/script retain their own association. XML and fragment parsing must enter the appropriate creation path when those consumers exist. This does not complete intended-parent, custom-element, force-async, or other script parser flags. |
| Actual rendering dependency | Document's §3.1.6 render-blocking element set, HTML-content/body eligibility, and timeout predicate remain unimplemented. Element loading/preparation must add eligible blockers and remove them on completion, failure, disconnection, or loss of eligibility; Fetch request flags and rendering opportunities must consume that state. The existing script-blocking stylesheet set is a different mechanism. No successful rendering wait or load is synthesized here. |

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
The subsequent [collections slice](collections/ROADMAP.md) has its own scope and
remaining dependencies; §2.6.5 still waits for a real consumer.

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
