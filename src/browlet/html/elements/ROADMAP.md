# HTML elements roadmap

`HTMLElementImpl` and the currently needed metadata elements are present.
Create the remaining files only as their behavior is implemented; do not add
empty classes merely to complete this list.

`html/web-idl.ts` retains a declaration-only `HTMLFormElement` type for FormData's
constructor signature. It has no implementation or Window exposure; move that
declaration into the form module when its behavior is implemented.

## Early platform slice

Implement these in dependency order before filling out the element catalog.
This is the smallest §4 slice that exercises the browser lifecycle rather than
merely constructing a larger static tree.

| Priority | Elements | Why they are early |
| --- | --- | --- |
| Document shell | `html`, existing `head`, `title`, `base`, `meta`, `body` | Establish the document element/body identities, title and base-URL state, parser encoding and policy metadata, and body/window event-handler integration |
| Executable document | Existing `link` and `style`, then `script` | Exercise render blocking, external resources, parser blocking, script preparation/execution, task timing, and load completion across Stylelet, Fetch, the loader, parser, and scripting domains |
| Generic subresource proof | `img` | Exercise element-driven Fetch, document load-event delay, success/error events, URL reflection, and cancellation without first requiring the media playback or canvas subsystems |
| Nested lifecycle | `iframe` | Create and destroy child navigables, preserve `contentWindow` WindowProxy identity, expose `contentDocument`, process `src`/`srcdoc`, sandbox/referrer/permissions inputs, and propagate child load completion |
| Author-driven navigation | `a` | Connect URL reflection and activation behavior to target selection, navigation, downloads, referrer policy, and hyperlink auditing |
| Parser and shadow structure | `template`, then `slot` | Establish inert template contents, fragment parsing/declarative shadow roots, cloning/adoption, and slot assignment without pulling in canvas or custom-element completion |

Only the observable specialization should force a dedicated class. Elements
whose §4 contract is semantic or conformance-only can continue to use the
generic `HTMLElementImpl` while lifecycle work proceeds. Distinct public Web
IDL constructors and element-specific reflected members still have to be
added eventually; the generic implementation is sequencing, not a claim of
full conformance.

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

The 2026-09-21 Playwright probe found divergent frozen-URL behavior. After changing
the document URL, Chromium and WebKit refreshed the first base when a later base's
href changed; Firefox did not refresh on a same-value assignment to the first base.
Windows WebKit also accepted a `data:` base. Per review, the tests retain HTML's
written rules: refresh on becoming first or changing that element's href (including
same-value assignments), ignore later bases, and reject `data:`/`javascript:`.

`iframe` is intentionally the first nested-browsing consumer. Its element
module stores element state and invokes the specified processing hooks;
`browsing/`, `loader/`, and `browsing/policy/` retain ownership of navigables,
responses, WindowProxy identity, origins, sandboxing, and permissions.

## Element families

| Planned area/files | Principal interfaces | Specification |
| --- | --- | --- |
| `document/html.ts` | `HTMLHtmlElement` | HTML §4.1 |
| `metadata/base.ts`, `title.ts`, `meta.ts`, `noscript.ts` | `HTMLBaseElement`, document base URL, `HTMLTitleElement`, `HTMLMetaElement` | HTML §§2.4.3 and 4.2 |
| `sections/body.ts`, `heading.ts`, `address.ts` | `HTMLBodyElement`, `HTMLHeadingElement` | HTML §4.3 |
| `grouping/paragraph.ts`, `hr.ts`, `pre.ts`, `quote.ts`, `list.ts`, `div.ts` | Paragraph/grouping and list interfaces | HTML §4.4 |
| `text/anchor.ts`, `data.ts`, `time.ts`, `mod.ts`, `span.ts`, `br.ts` | Text-level semantics | HTML §§4.5–4.7 |
| `embedded/picture.ts`, `source.ts`, `image.ts`, `iframe.ts`, `embed.ts`, `object.ts`, `media.ts`, `track.ts`, `map.ts`, `area.ts` | Embedded content and media interfaces, including user-agent plugin/content-handler integration for `embed` and `object` | HTML §§2.1.6 and 4.8 |
| `tables/table.ts`, `caption.ts`, `section.ts`, `row.ts`, `cell.ts`, `col.ts` | Table model interfaces | HTML §4.9 |
| `forms/form.ts`, `label.ts`, `input.ts`, `button.ts`, `select.ts`, `data-list.ts`, `opt-group.ts`, `option.ts`, `text-area.ts`, `output.ts`, `progress.ts`, `meter.ts`, `field-set.ts`, `legend.ts` | Form controls, validation, submission, and form association | HTML §4.10 |
| `interactive/details.ts`, `dialog.ts` | Interactive elements | HTML §4.11 |
| `scripting/script.ts`, `template.ts`, `slot.ts`, `canvas.ts` | Script-supporting elements and canvas | HTML §4.12 |
| `legacy/` contributions coordinated by `html/legacy/` | `HTMLMarqueeElement`, `HTMLFrameSetElement`, `HTMLFrameElement`, `HTMLDirectoryElement`, `HTMLFontElement`, `HTMLParamElement`, and obsolete generic elements | HTML §16 |

## Supporting interfaces exposed by section 4

The element list hides several substantial non-element interface families.
They belong with their consuming subsystem rather than in one miscellaneous
§4 module.

| Owner | Supporting Web IDL surface | Timing |
| --- | --- | --- |
| `text/hyperlink.ts` | `HyperlinkElementUtils` and `HTMLHyperlinkElementUtils`, shared by `a` and `area` | Add with the first complete anchor implementation |
| `embedded/media.ts` with [`media/`](../../media/ROADMAP.md) support types | HTMLMediaElement stays with elements; MediaError, TimeRanges, tracks/lists, and media state belong to the shared media area | Deferred to the media roadmap; Blob URL integration proceeds independently with Blob support |
| `forms/` | `ValidityState`, `SelectionMode`, `SubmitEvent`, `FormDataEvent`, and their dictionaries; consume rather than redefine the external `FormData` API | Add with form association, validation, and submission |
| `scripting/slot.ts` | `AssignedNodesOptions` | Add as a declaration beside slot behavior; it does not require a runtime class |
| `canvas/` | Canvas and offscreen rendering contexts, state/path/style mixins, gradients, patterns, text metrics, `Path2D`, callbacks, dictionaries, and enums | Separate later graphics slice; do not bury it in `canvas.ts` |
| `html/custom-elements/` | `ElementInternals`, `CustomStateSet`, validity flags, definitions, registry, and constructor callback | Add through the custom-elements roadmap and `[CEReactions]` work |

`LinkStyle` comes from CSSOM, iframe permissions objects come from Permissions
Policy, and several canvas/media input types come from their own standards.
HTML element declarations consume those contracts; Browlet must not invent
duplicate HTML-owned versions.

Shared algorithms should live at the narrowest common owner—form association
under `forms/`, media state under `embedded/`, and reflection under
`html/reflection/`—rather than accumulating in `HTMLElementImpl`.

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
