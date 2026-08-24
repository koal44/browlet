# HTML roadmap

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
| §2.1.1 parallelism | `scripting/` for parallel queues and host scheduling; each calling algorithm retains its own state |
| §2.1.2 resources | `loader/` for resource lifecycles and critical subresources; the user-agent/transport boundary reports supported formats |
| §2.1.3 XML compatibility | `dom/` for namespace-aware trees; an eventual XML parser boundary, not the HTML parser, owns XML syntax |
| §2.1.4 DOM trees | `dom/` mutation primitives plus HTML insertion, post-connection, removing, and moving hooks |
| §2.1.5 scripting | `scripting/` and Web IDL; this subsection otherwise defines terminology rather than a new object |
| §2.1.6 plugins | `html/elements/embedded/` plus a user-agent content-handler capability |
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

## HTML section 3 ownership

Section 3 defines the common Document and element substrate used by the
element-specific chapters. Its algorithms cross several Browlet domains, so it
must not become one oversized HTML Document module.

| Section | Owner |
| --- | --- |
| §3.1.1 `Document` object | `dom/nodes/document.ts` for the object and slots; `html/web-idl.ts` for HTML's partial interface; policy, scripting, and navigation retain their contributed state |
| §3.1.2 `DocumentOrShadowRoot` | DOM's mixin implementation; focus management supplies `activeElement` |
| §3.1.3 ancestor origins | Document lifecycle and `browsing/window/location.ts`, using referrer policy, origin records, and `html/collections/` |
| §3.1.4 resource metadata | Document accessors over URL, Fetch response metadata, cookies, and loader state |
| §3.1.5 document loading status | `html/parser/`, `loader/`, `scripting/`, and `performance/` coordination |
| §3.1.6 render blocking | `loader/` and `style/`, with the blocking set stored by Document |
| §3.1.7 DOM tree accessors | `dom/nodes/document.ts`, HTML element implementations, and live collection machinery |
| §§3.2.1 and 3.2.4–3.2.5 semantics, definitions, and content models | Element metadata, conformance tests, and accessibility; most authoring requirements create no runtime algorithm |
| §3.2.2 elements in the DOM | `html/elements/` over DOM Element, including unknown-element and namespace behavior |
| §3.2.3 HTML element constructors | `ctor.ts`, `html/elements/`, custom-element construction stacks, and Web IDL |
| §3.2.6 global attributes | `html/global-attributes.ts`, reflection, custom-element reactions, and Stylelet integration |
| §3.2.7 `innerText` | DOM mutation plus style/layout-derived text collection; it must not be approximated by `textContent` |
| §3.2.8 bidirectional requirements | Style/layout integration over Unicode bidirectional processing |
| §3.2.9 ARIA and accessibility APIs | A future `accessibility/` domain consuming semantic element state and the rendered tree |

## HTML section 4 ownership

Section 4 defines every HTML element, but only a small subset is prerequisite
to exercising Document loading and navigation. `html/elements/roadmap.md`
records that early slice and the complete element-family inventory.

| Section | Owner |
| --- | --- |
| §§4.1–4.2 document and metadata elements | `html/elements/document/` and `html/elements/metadata/`, with URL state in Document and loading in `loader/` |
| §§4.3–4.7 semantic, grouping, text, links, and edits | `html/elements/sections/`, `grouping/`, and `text/`; hyperlink activation crosses into `browsing/navigation/` |
| §4.8 embedded content | `html/elements/embedded/`; `iframe` delegates nested navigables to `browsing/`, while image and media resource work delegates to `loader/` |
| §§4.9–4.11 tables, forms, and interactive elements | Corresponding `html/elements/` areas, with form infrastructure retained under `forms/` and focus/input under the future `interaction/` domain |
| §4.12 scripting elements and canvas | `html/elements/scripting/` for script/template/slot; script execution belongs to `scripting/` and loading to `loader/`; canvas is a later graphics subsystem |
| §4.13 custom elements | `html/custom-elements/`, integrated with DOM mutations and Web IDL `[CEReactions]` |

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
| §§8.2–8.3 global-scope and base64 utilities | `scripting/global-scope.ts` |
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
- `web-idl.ts` assembles HTML element contributions without absorbing SVG or
  MathML definitions.

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
