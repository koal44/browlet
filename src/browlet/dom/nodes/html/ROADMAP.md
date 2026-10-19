# HTML elements roadmap

The HTML element-interface catalog is registered. Many dedicated classes still
provide only identity and inherited behavior; the §3.2.2 inventory below records
their unfinished APIs and lifecycle dependencies.
[`scripting/script.ts`](scripting/script.ts) is an approved provisional addition for the §2.4.3
base-change response: element/interface selection, initially uninitialized result
state, and the script's relevant Window are present. Link and script now expose
`crossOrigin` and `referrerPolicy` reflection using the shared HTML §§2.5.4–2.5.5
attribute definitions in [`attributes/`](attributes/index.ts). These shared
definitions depend on the generic microsyntax machinery and sit below element
implementations in the dependency hierarchy. Reusable reflection remains with
`html/reflection/`. The reviewed [script null-assignment clash](../../../html/ROADMAP.md#section-25-audit)
follows HTML, Firefox, and WebKit.
Remaining reflected members, preparation, and the full
script-result union remain §4.12.1 work. `[CEReactions]` entry/exit and callback
delivery remain with custom elements; link fetching remains §4.2.4 work.
Section 3.2.2's interface-selection requirement now supplies a concrete consumer
for the remaining distinct element identities.

The [forms collection slice](forms/ROADMAP.md) adds minimal concrete form,
input, select, option, and optgroup implementations for HTML §§2.6.4.2–2.6.4.3.
Their co-located IDL fragments are exposed; `HTMLFormElement` replaces the old
declaration-only FormData identity. Form-owner association, radio-group updates,
automatic selection, and selectedcontent remain explicit owner stubs.

The [Document §3.1.1 slice](../../../html/ROADMAP.md#section-311-document-state-and-declarations)
adds [`HTMLDialogElementImpl`](interactive/dialog.ts) so Document's `openDialogs`
list retains concrete dialogs. Only element selection and platform identity are
present, with the shared HTML constructor supplied by §3.2.3. `open`, `returnValue`, `closedBy`, `show()`,
`showModal()`, `close()`, and `requestClose()` remain §4.11.4 dependencies, along
with list membership, focus, top-layer/inertness, close watchers, and dialog
events. Do not equate the list with every element that happens to have an `open`
attribute or claim that creating a dialog implements its opening lifecycle.

The [Document §3.1.7 slice](../../../html/ROADMAP.md#section-317-dom-tree-accessors)
adds concrete [`HTMLEmbedElementImpl`](embedded/embed.ts) and
[`HTMLObjectElementImpl`](embedded/object.ts) for named-property exposure.
Object loading must update `showsFallbackContent`; its setter invalidates live
collections, but no resource selection/fallback activation happens automatically.
Their remaining attributes, loading, and rendering belong to
§§4.8.6–4.8.7. Iframe now retains an initially-null `contentNavigable`; child
navigation must create, associate, and clear it. Document also retains nullable
`currentScript`; §4.12 execution must set/restore it, including null for module
and shadow-tree execution. These state holders do not implement their producers.

Document accessors, named collections, image-map lookup, and select traversal now
use concrete element identities instead of namespace/local-name tests. HTML
elements declare their fixed `isAllNamedElement` eligibility. Document named
lookup shares `getDocumentNamedItemType()` with HTMLElement's
`matchesDocumentName()`, reevaluating object/embed exposure; image IDs additionally
require a nonempty name. Attribute values remain live.
The remaining identity dependencies are registered as minimal implementations:

| Elements | Owner | Missing behavior |
| --- | --- | --- |
| `html`, `body` | `document/html.ts`, `sections/body.ts` | Body WindowEventHandlers and obsolete reflected members |
| `a`, `area` | `text/anchor.ts`, `embedded/area.ts` | Hyperlink mixins, reflected attributes, navigation/activation, and area geometry |
| `map` | `embedded/map.ts` | Name reflection and the areas collection; lookup already returns HTMLMapElementImpl |
| `hr` | `grouping/hr.ts` | Obsolete reflected members |
| `datalist`, `button`, `textarea` | `forms/` | Datalist options/suggestions; button and textarea form association, reflection, validation, editing/commands, and activation |
| `meta` | `metadata/meta.ts` | Reflected attributes and metadata/pragma processing |
| `frame`, `frameset` | `legacy/` | Reflected attributes, frame navigation/layout, and frameset WindowEventHandlers |

These fragments expose their interfaces and shared HTML constructors, without
standing in for the missing element-specific APIs. Their consuming algorithms can use
the actual implementation types now. Namespace/name handling remains appropriate
in element creation, tag-name APIs, and generic namespace algorithms.

[`HTMLTitleElementImpl`](metadata/title.ts) owns title mutation notifications and
its raw child-text `text` attribute. Document retains the selected HTML/SVG title
and normalized text; the separate `htmlTitleElement` lookup is uncached. State-preserving
child moves use Node's general parent notification without rerunning ordinary
children-changed steps. `[CEReactions]` still depends on the
shared custom-element machinery; presenting the title and its directionality in
browser UI remains outside this document-accessor slice.

## Tag-specific implementations

Every one of the 141 registered HTML local names now selects a distinct concrete
implementation. Concrete classes live in the existing topic folders; small
families sharing a public interface live together beside its declaration.
Their inherited interfaces remain unchanged: article still exposes HTMLElement,
q and blockquote expose HTMLQuoteElement, and the eight legacy unknown names
expose HTMLUnknownElement. Arbitrary custom names and unrecognized names retain
the generic HTMLElement and HTMLUnknownElement fallbacks.

The dependency-free [`ElementTag`](../element-definitions/element-tag.ts) enum identifies namespaced
tags numerically. Each concrete HTML and SVG class assigns `tag` to its prototype
in a static initialization block. ElementImpl declares the instance type without
emitting a field, so instances inherit the shared value. Existing registration
still selects the class, without an additional tag lookup. Generic fallbacks and
autonomous custom names use `Other`; customized built-ins retain their built-in
tag. Identity-only checks can use these IDs without importing peer element
classes. Use implementation types when the caller also needs derived behavior.

The `q` and `blockquote` classes live beside their shared HTMLQuoteElement
interface in [`grouping/quote.ts`](grouping/quote.ts). The interface lists
`implementation: [impl(HTMLBlockQuoteElementImpl), impl(HTMLQElementImpl)]`
and supplies their namespace; each concrete class supplies its static `localName`.
Both extend HTMLElement directly. Assembly links them once, and element selection
and HTML constructor preparation read the same tag names. Automatic instance
bindings use ordinary property access on the concrete receiver.
The same arrangement covers headings, edits, table columns/cells/sections,
pre/listing/xmp, and the obsolete unknown-name elements. Empty shared bases and
the separately maintained constructor table have been removed.
The 51 tags exposing HTMLElement remain in their topic folders.
The local [`web-idl.ts`](web-idl.ts) declares their shared interface and collects
implementations above the low-level [`HTMLElementImpl`](html-element.ts), avoiding
a cycle between that base and its subclasses. The HTMLElement and
HTMLUnknownElement fallbacks remain real implementations for arbitrary names.

Typed references such as `reference(HTMLElementImpl)` continue to work because
that declared class covers every implementation of its interface. Unrelated
classes can pass their shared implementation array to `reference()`, retaining
the union of converted types. Element-reference reflection prepares those classes
once and filters matching IDs in tree order; it uses a covering class when one is
declared. Tests exercise unrelated q/blockquote targets and duplicate IDs.
Ordinary constructor/static bindings must
select their behavior explicitly when no receiver identifies a class.
Binding's internal construction reuses the registered or nearest declared base's interface and
injected arguments; projection does not expose the internal subclass. Creation,
cloning, namespace handling, realm ownership, and custom construction exercise
this path.

These classes currently provide identity and inherited behavior. As §3.2.4,
§3.2.5, and the individual element definitions are implemented, attach fixed
categories, content-model rules, sanitization categories, and navigating URL
attributes to their implementation prototypes. Queries depending on attributes or
tree context belong to instances. Missing information remains explicit rather
than receiving permissive defaults.

The concrete prototypes hold `categories`, `contentModel`, `contentAttributes`,
and `sanitization`, initialized once alongside `tag`. ElementImpl declares
categories and content models for HTML and foreign elements; HTMLElementImpl
declares attribute and sanitizer metadata. These declarations emit no fields,
so instances inherit the shared arrays and model objects.
Queries read them directly from the receiver.

The category inventory covers all 113 current HTML tag identities, with instance
overrides for conditional membership. An undefined array marks an unfinished
inventory; an empty array means no fixed memberships, although an override may
still supply conditional ones. Main's hierarchy check and autonomous custom
elements' form association remain throwing dependencies. The obsolete identities
remain unclassified. The [HTML category roadmap](../../../html/ROADMAP.md#section-3252-kinds-of-content)
records the complete scope, foreign/Text integration, and source discrepancies.

[`content-model.ts`](../element-definitions/content-model.ts) owns `ContentCategory` and shared descriptions
of empty, text, category, element, sequence, repetition, and transparent content, plus descendant
restrictions. Prototype `contentModel` definitions and `getContentModel()` cover p,
blockquote, q, input, details, and a. The transparency/paragraph slice adds ins/del,
map, object, body, div, section, header, li, h1–h6, em, and span. Undefined models are explicit dependencies;
an empty model is a known requirement. `ElementImpl.matchesNothingContentModel()`
checks that requirement against the current children, excluding comments, processing
instructions, and empty or ASCII-whitespace Text through `NodeImpl.isIgnoredHTMLContent()`.
Text's `isInterElementWhitespace()` reads current data, including CDATA sections;
non-ASCII whitespace remains content. The ignored nodes stay in the DOM.
`content-model.ts` resolves supported transparent positions through
`resolveContentModelTransparency(element)`. [`paragraphs.ts`](../element-definitions/paragraphs.ts)
owns `getParagraphs(document: DocumentImpl)`, which discovers explicit and implicit
paragraphs across the whole document; element traversal stays private. Both use
the common ElementImpl model contract; namespace-specific missing models remain explicit. The
[transparency/paragraph roadmap](../../../html/ROADMAP.md#sections-3253-and-3254-transparency-and-paragraphs)
records the supported model shapes and explicit dependencies. The general
evaluator, remaining conditional models/rule forms, and element inventory belong
to later slices. DOM insertion and parsing do not consult these descriptions.

Each optionally tagged element overrides `canOmitStartTag()` or `canOmitEndTag()`
for HTML §13.1.2.4; the base class permits neither omission. The methods read
current attributes and tree content, comparing ElementTag IDs for adjacent tag
identities. Protected methods on [`HTMLElementImpl`](html-element.ts) provide
the shared attribute checks and content scans. The forward scan defaults to the
next sibling and accepts the first child when examining a start tag. Start tags
with attributes, including
an internal customized-built-in `is` value, must be retained. Empty text nodes
emit nothing; whitespace and comments otherwise remain significant.
`canOmitStartTag(previousEndTagOmitted)` requires the preceding content sibling's
actual output decision. Adjacent colgroups and table sections cannot infer that
decision from the tree or from whether the preceding end tag was eligible for
omission. The paragraph rule uses the existing custom-element definition to
recognize an autonomous custom parent; definition/upgrade production remains
with custom elements.

These permissions assume a conforming HTML document whose content is preserved.
They do not validate content models, describe forbidden void-element end tags,
or apply to XML. There is no omission-capable markup writer yet. The standard
HTML fragment serializer, also still pending, must emit normal start/end tags
as specified; these permissions do not add a minification option to that API.
Parser recovery continues to belong to parse5. Tests cover every optional-tag
family and demonstrate that omitting both tags between tbody groups merges them.

Prototype `contentAttributes` arrays record element-specific names for article, div,
blockquote, q, and a. `allowsContentAttribute(name)` checks permission to specify a
namespace-less attribute, using its lowercase HTML name. The base searches the
shared global inventory first, then searches the element inventory once and calls
`allowsListedContentAttribute()` for a matching name.
Anchor overrides that hook so target, download, ping, rel, hreflang, type, and
referrerpolicy require a current namespace-less href; an empty href still counts.
This does not check values or whether required attributes are missing; DOM
mutation does not call it.
An undefined element inventory throws for names not already resolved by the
global rules; an empty inventory means globals only. The shared
[`attributes/global.ts`](attributes/global.ts) inventory covers §3.2.6's fixed
names, listed content handlers, custom data names, and §8.1's additional global
onabort and four onwebkit* handlers. Handler execution remains separate unfinished
work. The namespace-less xmlns and xml:lang names are permitted only in HTML
documents; their values and required companion attributes remain conformance
checks. ARIA applicability and remaining handler names stay explicit throwing dependencies. Other
unlisted names return false for completed element inventories. The
[global-attribute preamble accounting](../../../html/ROADMAP.md#section-326-global-attribute-preamble)
records namespace, value-validation, execution, and later-section boundaries.
Anchor's itemprop/href requirement remains a required-attribute validation dependency.
Other element inventories, obsolete attributes, and value/required-attribute
conformance rules remain for their defining sections.

Prototype `sanitization` records cover article, a, script, and form. They contain a
numeric `SanitizationCategory` and optional lists of default attributes and
navigating URL attributes, defined in [`sanitization.ts`](../element-definitions/sanitization.ts).
Names in both lists identify namespace-less HTML
attributes; omitted lists mean no element-specific entries. An absent record is
unfinished inventory, distinct from the specified `Uncategorized` category.
Default attributes are independent of content-attribute permissions. These fixed
facts do not inspect values or mutate the DOM. The remaining element inventory and
the shared configurations, namespace rules, and filtering algorithms remain in the
[sanitization roadmap](../../../html/sanitization/ROADMAP.md).

Revisit this ownership when content-model consumers and §8.6 sanitization are
implemented: shared processing and configurable sanitizer policy belong to those
consumers, and they can derive centralized lookups if needed. WebKit's internal
[HTMLArticleElement with HTMLElement exposure](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLTagNames.in)
is precedent for separating implementation classes from public interfaces.
Construction and registration are complete; the metadata inventory and
element-specific algorithms remain incremental.

## Section 3.2.2 interface identities

All specified HTML names, including obsolete aliases, now select their declared
interface. `HTMLElement` declares names whose specified interface is generic;
`HTMLUnknownElement` registers the eight names explicitly assigned to it.
Unregistered names use the valid-custom-name/unknown rules. No provisional list
substitutes HTMLElement for a missing dedicated interface.

The slice adds these 38 minimal implementations. Each file keeps its interface
declaration and a TODO for its missing behavior. The shared
[`[HTMLConstructor]` algorithm](../../../html/ROADMAP.md#section-323-html-element-constructors)
is implemented by §3.2.3; it is not an ordinary JavaScript constructor. Public
definition, upgrade, and reaction delivery remain missing custom-element owners.

| Owner | Added identities / names | Missing element-specific behavior |
| --- | --- | --- |
| `sections/heading.ts` | HTMLHeadingElement: `h1`–`h6` | Obsolete alignment reflection; heading presentation/accessibility |
| `grouping/` | HTMLParagraphElement (`p`), HTMLPreElement (`pre`, `listing`, `xmp`), HTMLQuoteElement (`blockquote`, `q`), HTMLOListElement (`ol`), HTMLUListElement (`ul`), HTMLLIElement (`li`), HTMLDListElement (`dl`), HTMLDivElement (`div`), HTMLMenuElement (`menu`) | Reflected attributes, list numbering, quote citation URL, and obsolete presentation members |
| `text/` | HTMLBRElement (`br`), HTMLDataElement (`data`), HTMLModElement (`del`, `ins`), HTMLSpanElement (`span`), HTMLTimeElement (`time`) | Reflected attributes, datetime-value processing, and obsolete members |
| `embedded/` | HTMLPictureElement (`picture`), HTMLSourceElement (`source`), HTMLTrackElement (`track`) | Resource/source selection, reflected attributes, text-track state/loading/cues |
| `tables/` | HTMLTableElement (`table`), HTMLTableCaptionElement (`caption`), HTMLTableColElement (`col`, `colgroup`), HTMLTableSectionElement (`tbody`, `tfoot`, `thead`), HTMLTableRowElement (`tr`), HTMLTableCellElement (`td`, `th`) | Table collections, indices, mutation methods, reflected/obsolete members, and table-model processing |
| `forms/` | HTMLFieldSetElement (`fieldset`), HTMLLabelElement (`label`), HTMLLegendElement (`legend`), HTMLMeterElement (`meter`), HTMLOutputElement (`output`), HTMLProgressElement (`progress`), HTMLSelectedContentElement (`selectedcontent`) | Form ownership, disabledness, label/control association, values/reset, numeric processing, validation, and selected-option copying |
| `interactive/details.ts` | HTMLDetailsElement (`details`) | Name/open reflection, group exclusivity, activation, and toggle events |
| `scripting/` | HTMLCanvasElement (`canvas`), HTMLTemplateElement (`template`) | Canvas attributes/context/bitmap/drawing/serialization/offscreen transfer; template attributes, contents/owner document, parsing, cloning/adoption, and declarative shadow roots |
| `legacy/` | HTMLDirectoryElement (`dir`), HTMLFontElement (`font`), HTMLMarqueeElement (`marquee`), HTMLParamElement (`param`) | Reflected/obsolete members, marquee methods and animation |

Existing specialized implementations retain their prior scope. In particular,
adding fieldset/output identities does not implement form collection membership,
and adding selectedcontent does not make the select's copying stub work.
Template elements still lack their separate contents fragment and owner
document; their generic DOM tree must not be mistaken for a completed template.

The [shared-member inventory](../../../html/ROADMAP.md#section-322-elements-in-the-dom)
accounts for HTMLElement and HTMLOrSVGOrMathMLElement, their simple reflections,
and later global-attribute, editing, focus, popover, and custom-element owners.

## Early lifecycle slice

Implement these behaviors in dependency order after the interface catalog.
This is the smallest §4 slice that exercises the browser lifecycle rather than
merely constructing a larger static tree.

| Priority | Elements | Why they are early |
| --- | --- | --- |
| Document shell | `html`, existing `head`, `title`, `base`, `meta`, `body` | Establish the document element/body identities, title and base-URL state, parser encoding and policy metadata, and body/window event-handler integration |
| Executable document | Existing `link` and `style`, then `script` | Exercise render blocking, external resources, parser blocking, script preparation/execution, task timing, and load completion across Stylelet, Fetch, the loader, parser, and scripting domains |
| Generic subresource proof | `img` | Exercise element-driven Fetch, document load-event delay, success/error events, URL reflection, and cancellation without first requiring the media playback or canvas subsystems |
| Nested lifecycle | `iframe` | Create and destroy child navigables, preserve `contentWindow` WindowProxy identity, expose `contentDocument`, process `src`/`srcdoc`, sandbox/referrer/permissions inputs, and propagate child load completion |
| Author-driven navigation | `a` | Connect URL reflection and activation behavior to target selection, navigation, downloads, referrer policy, and hyperlink auditing |
| Parser and shadow structure | `template`; `slot` assignment is implemented in DOM 4H | Establish inert template contents, fragment parsing/declarative shadow roots, and cloning/adoption without pulling in canvas or custom-element completion |

Elements whose specified interface is HTMLElement retain that public identity.
Distinct interfaces now have dedicated classes even when their behavior is still
missing. Fill those owners in as their algorithms are reached; identity alone
does not complete an element's lifecycle.

When implementing `meta`'s `http-equiv` processing, retain the HSTS negative
case: `Strict-Transport-Security` must neither learn nor remove a host policy
([RFC 6797 §8.5](https://www.rfc-editor.org/rfc/rfc6797.html#section-8.5)).
HSTS learning belongs to verified network responses, not document metadata.

**Completed Fetch prerequisite:** the document base URL and `HTMLBaseElement`
(HTML §§2.4.3 and 4.2.3) now supply `Document.baseURI` and the settings object's
API base URL. First-base selection and frozen URLs follow attribute changes,
insertion, removal, and reordering, including whole subtrees. `Attr.value` and
`NamedNodeMap` changes use the same element notification as `setAttribute`.
The original Request regression and Response.redirect integration tests pass.

CSP's `base-uri` check is connected to frozen-base selection. Pending
integrations stay with their owners: srcdoc state during iframe creation, DOM adoption, HTML constructors/
custom-element reactions, and base-change consumers such as hyperlink state and
speculation rules. The fallback algorithm distinguishes explicit srcdoc document
state from a URL that merely spells `about:srcdoc`.

The 2026-09-21 Playwright probe found that Chromium and WebKit refreshed the first
base when a later base's href changed; Windows WebKit also accepted a `data:` base.
The reviewed choices remain to ignore later bases and reject `data:`/`javascript:`.

**SPEC_CLASH(base-href-same-value): frozen URL refresh after an equal-value write.**
[HTML §2.1.4](https://html.spec.whatwg.org/multipage/infrastructure.html#dom-trees)
defines a content attribute as changing only when its value differs.
[HTML §4.2.3](https://html.spec.whatwg.org/multipage/semantics.html#the-base-element)
refreshes the first base's frozen URL when its href changes. Read together, these
passages support preserving the frozen URL on an equal-value assignment. This is
our interpretation, not an interoperable result or a settled upstream resolution.

On 2026-10-10, a Playwright probe loaded `https://example.test/dir/page`, inserted
`<base href="relative/">`, used `history.pushState` to change the document URL to
`https://example.test/new/page`, and assigned `relative/` to href again:

| Engine | Resulting `document.baseURI` |
| --- | --- |
| Chromium 149.0.7827.55 | `https://example.test/new/relative/` |
| Firefox 151.0 | `https://example.test/dir/relative/` |
| WebKit 26.5 | `https://example.test/new/relative/` |

All three queued an attributes MutationRecord containing the old value
`relative/`. DOM's [attribute-change algorithm](https://dom.spec.whatwg.org/#concept-element-attributes-change)
does not skip identical assignments; the HTML definition must not suppress DOM
notification, custom-element reactions, or the generic attribute-change steps.

**Reviewed choice:** follow the combined HTML reading and Firefox, with a guard
only around the base-specific refresh. Equal-value writes preserve the frozen
URL, including an invalid base's frozen fallback. Changed values and becoming
the first base still refresh it. Regressions cover `setAttribute`, reflected
`href`, `Attr.value`, and `NamedNodeMap`, including MutationObserver delivery.
The earlier roadmap incorrectly called equal-value refresh spec-aligned; keep
this clash until the specification and browser implementations converge.

`iframe` is intentionally the first nested-browsing consumer. Its element
module stores element state and invokes the specified processing hooks;
`browsing/`, `loader/`, and `browsing/policy/` retain ownership of navigables,
responses, WindowProxy identity, origins, sandboxing, and permissions.

## Element families

| Planned area/files | Principal interfaces | Specification |
| --- | --- | --- |
| `document/html.ts` | `HTMLHtmlElement` | HTML §4.1 |
| `metadata/base.ts`, `title.ts`, `meta.ts`, `link.ts`, `style.ts` | Metadata interfaces and document base URL; noscript uses HTMLElement | HTML §§2.4.3 and 4.2 |
| `sections/body.ts`, `heading.ts` | `HTMLBodyElement`, `HTMLHeadingElement`; address and other generic names use HTMLElement | HTML §4.3 |
| `grouping/paragraph.ts`, `hr.ts`, `pre.ts`, `quote.ts`, `ol.ts`, `ul.ts`, `li.ts`, `dl.ts`, `menu.ts`, `div.ts` | Paragraph/grouping and list interfaces | HTML §4.4 |
| `text/anchor.ts`, `data.ts`, `time.ts`, `mod.ts`, `span.ts`, `br.ts` | Text-level semantics | HTML §§4.5–4.7 |
| `embedded/picture.ts`, `source.ts`, `image.ts`, `iframe.ts`, `embed.ts`, `object.ts`, `media.ts`, `track.ts`, `map.ts`, `area.ts` | Embedded content and media interfaces, including user-agent plugin/content-handler integration for `embed` and `object` | HTML §§2.1.6 and 4.8 |
| `tables/table.ts`, `caption.ts`, `section.ts`, `row.ts`, `cell.ts`, `col.ts` | Table model interfaces | HTML §4.9 |
| `forms/form.ts`, `label.ts`, `input.ts`, `button.ts`, `select.ts`, `data-list.ts`, `optgroup.ts`, `option.ts`, `text-area.ts`, `output.ts`, `progress.ts`, `meter.ts`, `fieldset.ts`, `legend.ts`, `selected-content.ts` | Form controls, validation, submission, and form association | HTML §4.10 |
| `interactive/details.ts`, `dialog.ts` | Interactive elements | HTML §4.11 |
| `scripting/` | Script, noscript, template, slot, and canvas elements | HTML §4.12 |
| `legacy/` contributions coordinated by `html/legacy/` | `HTMLMarqueeElement`, `HTMLFrameSetElement`, `HTMLFrameElement`, `HTMLDirectoryElement`, `HTMLFontElement`, `HTMLParamElement`, and obsolete generic elements | HTML §16 |

## Supporting interfaces exposed by section 4

The element list hides several substantial non-element interface families.
They belong with their consuming subsystem rather than in one miscellaneous
§4 module.

| Owner | Supporting Web IDL surface | Timing |
| --- | --- | --- |
| `text/hyperlink.ts` | `HyperlinkElementUtils` and `HTMLHyperlinkElementUtils`, shared by `a` and `area` | Add with the first complete anchor implementation |
| `embedded/media.ts` with [`media/`](../../../media/ROADMAP.md) support types | HTMLMediaElement stays with elements; MediaError, TimeRanges, tracks/lists, and media state belong to the shared media area | Deferred to the media roadmap; Blob URL integration proceeds independently with Blob support |
| `forms/` | `ValidityState`, `SelectionMode`, `SubmitEvent`, `FormDataEvent`, and their dictionaries; consume rather than redefine the external `FormData` API | Add with form association, validation, and submission |
| `scripting/slot.ts` | `AssignedNodesOptions` | Present beside slot behavior; it does not require a runtime class |
| `canvas/` | Canvas and offscreen rendering contexts, state/path/style mixins, gradients, patterns, text metrics, `Path2D`, callbacks, dictionaries, and enums | Separate later graphics slice; do not bury it in `canvas.ts` |
| `dom/nodes/html/custom-elements/` | `ElementInternals`, `CustomStateSet`, validity flags, definitions, registry, and constructor callback | Add through the custom-elements roadmap and `[CEReactions]` work |

`LinkStyle` comes from CSSOM, iframe permissions objects come from Permissions
Policy, and several canvas/media input types come from their own standards.
HTML element declarations consume those contracts; Browlet must not invent
duplicate HTML-owned versions.

Shared algorithms should live at the narrowest common owner—form association
under `forms/`, media state under `embedded/`, and reflection under
`html/reflection/`—rather than accumulating in `HTMLElementImpl`.

[`embedded/image-map.ts`](embedded/image-map.ts) supplies `findImageMap()` for
the future `img` implementation. It accepts the complete `usemap` value,
uses the string-only hash-name parser in `html/microsyntaxes/`, and matches HTML
maps by `id` or `name` in the source's ordinary tree. Its pointer scan is
provisional for performance: replace it with tree-owned indexes that preserve
first-match ordering and track insertion, removal, moves, and attribute changes.
The stricter authoring-conformance definition adds no runtime validity gate.
Image association and hit testing remain with the element implementation.

Element classes consume `html/microsyntaxes/` for shared value state and
`loader/element-fetch-options.ts` for HTML §2.5 fetch-related attributes. They
must not duplicate either algorithm family.

Blink's `core/html` is intentionally flatter because native build metadata and
class-scale compilation drive its layout. Browlet should use the HTML §4
categories to keep the future TypeScript tree navigable.

Parse5 must continue recognizing §16's obsolete tag names and recovery rules.
Do not turn authoring non-conformance into a runtime parse rejection. Dedicated
legacy classes are required only where the standard exposes distinct IDL or
behavior; the remaining obsolete names can retain generic element
implementations while preserving their parser and rendering semantics.

## Removal condition

Burn this file once each category has its own implemented source and any
remaining omissions are tracked beside that category.
