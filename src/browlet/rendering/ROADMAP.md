# Rendering roadmap

HTML §15 describes the suggested default presentation of HTML documents. Its
rules are expressed in CSS, but it is not another CSS engine: Stylelet supplies
cascaded and computed values, while this domain eventually turns them into
layout boxes, viewports, replaced content, widgets, paint, and print output.

| Planned area or owner | Contract | Specification |
| --- | --- | --- |
| `box-tree/` | CSS/SVG box association, `display: contents`, “being rendered”, rendering delegation, and viewport intersection inputs | HTML §15 introduction; CSS Display and layout specifications |
| `layout/` | Block, inline, table, list, form-control, bidi, intrinsic sizing, margin quirks, and viewport layout | HTML §15 non-replaced elements plus the corresponding CSS modules |
| `replaced/` | Replaced-content selection, intrinsic dimensions, aspect ratios, images, embedded content, and nested-navigable viewports | HTML §15 replaced elements; CSS Images and Sizing |
| `widgets/` | Native appearance and UA shadow structures for buttons, details, form controls, select, progress, meter, and marquee compatibility | HTML §15 widgets plus interaction/form state |
| `print.ts` | Printing steps and physical-form output through an embedder capability | HTML §§8.9 and 15 print media; CSS Paged Media |
| `native-ui.ts` | Direction-aware tooltips, labels, menus, and other text surfaced outside the document canvas | HTML §15 interactive media |
| `unstyled-xml.ts` | Fallback DOM-tree view for XML documents without an applicable style sheet | HTML §15 unstyled XML documents |

The first useful slice is not a general layout engine. Add the HTML UA sheet
and presentational-hint source under `style/`, then define one box-tree query
that can truthfully answer “being rendered” for implemented content. Geometry,
Intersection Observer, focus visibility, `innerText`, paint timing, and
screenshots must wait for that real box boundary rather than infer layout from
DOM shape or computed `display` alone.

For the upcoming [HTML §3.2.7 `innerText`/`outerText` consumer](https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute),
keep the required facts explicit before choosing a layout object or query API:

- Whether a node is being rendered, including box association and `display: contents`.
- Text-box contents after whitespace processing and text transformation, including
  line-ending context needed by HTML's modified whitespace rules.
- Used display and table-row/cell box relationships that determine separators.

Stylelet supplies computed style; rendering owns box construction and layout
results. HTML owns the rendered-text collection algorithm. A narrow input view
or explicit parameter can connect that consumer when implemented; its shape,
freshness, and invalidation contract remain undecided. These requirements do not
justify a generic layout data bag or deriving rendered text from the DOM alone.

HTML §2.5.7's Document consumer now uses the provisional
[Intersection Observer implementation](../dom/intersection-observer/ROADMAP.md).
That observer retains registrations and entry queues; scheduled notification
remains unfinished, and this domain must supply truthful geometry and clipping
inputs. The HTML tests feed explicit intersection
entries and do not establish that rendering or lazy resource loading is present.

The Window rendering-opportunity producer and the spec-ordered update pipeline
live under `scripting/`. This domain supplies concrete style, layout, display,
and output phase hooks when those systems exist; it must not replace the
producer with a second frame scheduler.

Replaced content consumes `loader/` and `graphics/`; nested frames consume
`browsing/`; widgets consume HTML form/interaction state. Rendering must not
take ownership of those subsystems merely because it visualizes them. A
headless embedder may omit an OS-native widget toolkit, but it still needs a
deterministic platform-independent rendering model for browser automation.

## Title advisory presentation

HTML's [title advisory information](https://html.spec.whatwg.org/multipage/dom.html#advisory-information)
is available through `HTMLElementImpl.getAdvisoryInformation()`. It returns the
advisory text inherited through the flat tree, with normalized newlines and the
link/style inheritance exceptions. The consumer remains missing:
interaction must select the element and support pointer, keyboard, and touch
access; presentation must signal availability and expose the text on request.
Do not treat a mouse tooltip alone as satisfying that accessibility requirement.

[HTML's interactive-media rules](https://html.spec.whatwg.org/multipage/rendering.html#the-title-attribute-2)
also require line breaks for LF and tab stops at multiples of eight space widths.
Directionality, text measurement, hit testing, and native/embedder UI remain
dependencies of this future consumer, not fields inferred from the DOM query.
Element-specific title meanings, including stylesheet-set names, still require
their own consumers; the advisory query does not implement that metadata
processing or decide whether a tooltip is appropriate for each element.

The [HTML roadmap](../html/ROADMAP.md#section-3261-title-advisory-information)
records SPEC_CLASH(title-shadow-ancestry): Browlet follows the flat-tree ancestry
used by browser tooltip providers despite HTML's ordinary-parent wording. Keep
the link to [WHATWG HTML #13035](https://github.com/whatwg/html/issues/13035) until
the specification and implementations converge. This lookup does not yet supply
the tooltip selection or display pipeline.

## Language-dependent presentation

`NodeImpl.getLanguage()` supplies HTML's inherited BCP 47 language tag, including
document defaults. Font selection, pronunciation, dictionaries/spellchecking,
accessibility delivery, and form-control UI may consume it when those owners
exist. An empty tag means explicitly unknown; unrecognized tags retain their
original spelling. This value does not itself determine a page locale, text
direction, available font, or dictionary. Those facilities remain explicit
dependencies rather than guessed layout fields. See the
[language accounting](../html/ROADMAP.md#section-3262-lang-and-xmllang).

## Directionality and bidi presentation

HTML §3.2.6.4 now supplies `ElementImpl.getDirectionality()` and
`HTMLElementImpl.getAttributeDirectionality()`. These determine base direction
from current DOM state and Unicode L/R/AL classes; they do not reorder text.
The renderer still owes HTML's [bidirectional-text requirements](https://html.spec.whatwg.org/multipage/rendering.html#bidireq):
isolation/override behavior, the Unicode Bidirectional Algorithm and CSS bidi
integration, and per-paragraph auto direction for pre/textarea. Attribute text
rendered as tooltips, labels, or placeholders must use the attribute query,
not assume the element's direction. Editable control values and direction-changing
UI belong to the form/editing owners. No provisional layout record is introduced.

## Removal condition

Burn this file when UA style inputs, box construction, layout, replaced
content, widgets, print, and unstyled XML either have implemented source or a
narrower subsystem roadmap.
