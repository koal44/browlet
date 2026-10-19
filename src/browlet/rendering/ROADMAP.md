# Rendering integration roadmap

HTML §15 describes the suggested default presentation of HTML documents.
Stylelet owns CSS computation; the planned [layout engine](../../layout/ROADMAP.md)
owns boxes and fragments, with [graphics](../../graphics/ROADMAP.md) and
[fonts](../../fonts/ROADMAP.md) supplying shared resource facilities. This domain
coordinates those owners with HTML document state, measured APIs, and output.
It has no rendering implementation yet.

| Planned area or owner | Contract | Specification |
| --- | --- | --- |
| Layout association | Feed tree/style changes and HTML-specific facts to layout; retain correct document/source associations and freshness for queries | HTML §15 introduction; CSS Display and layout specifications |
| Replaced-content integration | Connect element/resource selection, image facts, embedded content, and nested-navigable viewports to layout sizing | HTML §15 replaced elements; CSS Images and Sizing |
| `widgets/` | Native appearance and UA shadow structures for buttons, details, form controls, select, progress, meter, and marquee compatibility | HTML §15 widgets plus interaction/form state |
| `print.ts` | Printing steps and physical-form output through an embedder capability | HTML §§8.9 and 15 print media; CSS Paged Media |
| `native-ui.ts` | Direction-aware tooltips, labels, menus, and other text surfaced outside the document canvas | HTML §15 interactive media |
| `unstyled-xml.ts` | Fallback DOM-tree view for XML documents without an applicable style sheet | HTML §15 unstyled XML documents |

Add the HTML UA sheet and presentational-hint source under `style/`, then connect
the first bounded layout implementation to a truthful box query. Geometric
objects can be implemented independently, but measured APIs, Intersection
Observer, focus visibility, `innerText`, paint timing, and screenshots require
actual results. DOM shape or computed `display` alone does not establish them.

For the upcoming [HTML §3.2.7 `innerText`/`outerText` consumer](https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute),
keep the required facts explicit before choosing a layout object or query API:

- Whether a node is being rendered, including box association and `display: contents`.
- Text-box contents after whitespace processing and text transformation, including
  line-ending context needed by HTML's modified whitespace rules.
- Used display and table-row/cell box relationships that determine separators.

Stylelet supplies computed style; layout owns box construction and measured
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

Replaced-content integration consumes `loader/` and shared graphics; nested
frames consume `browsing/`; widgets consume HTML form/interaction state. Keep
that state with its owners. A headless embedder may omit an OS-native widget
toolkit, but still needs a deterministic layout/output model for browser
automation. A complete paint/compositing boundary remains future design work.

## Measured DOM APIs

[CSSOM View](https://drafts.csswg.org/cssom-view/#extension-to-the-element-interface)
adds client rectangles, scroll/offset metrics, hit testing, Screen, and
VisualViewport. Implement the host APIs against actual box/viewport/device
state. Range geometry consumes text fragments; use shared
[geometric objects](../../geometry/ROADMAP.md) for the prescribed results.
Non-live rectangle results have a different lifetime from live style queries.
None of these measurement APIs is supplied by current computed-style snapshots.

Coordinate explicit update/flush behavior with the document lifecycle. CSSOM
resolved values and container queries need particular facts at particular
phases; neither should trigger uncontrolled nested layout from a generic query.
The [style integration roadmap](../style/ROADMAP.md#media-matching) owns
MediaQueryList, which needs device/matching state but not every layout facility.

## Observations and presentation

- [ResizeObserver](https://drafts.csswg.org/resize-observer-1/#gather-active-observations-h)
  needs its DOM-owned observations/last reported sizes and the specified
  depth-ordered gather/broadcast/layout loop, including skipped-observation
  errors. Connect it to HTML's existing update phase; ordinary DOM mutation
  callbacks or window resize events are not substitutes.
- Intersection Observer retains its [existing owner](../dom/intersection-observer/ROADMAP.md);
  this integration supplies measured/clipped geometry and scheduling.
- [View transitions](https://drafts.csswg.org/css-view-transitions-1/#lifecycle)
  need captures, rendering suppression, author callbacks, pseudo subjects,
  distinct promise phases, animation, and cleanup. Use the shared
  [animation owner](../../animation/ROADMAP.md); two retained style objects
  cannot implement the transition lifecycle.
- Highlights and pseudo-elements require source identity and styled text/box
  fragments before painting/hit testing. Their [DOM/style association](../style/ROADMAP.md#pseudo-elements-and-highlights)
  stays separate from presentation.

These contracts were sampled, not audited operation by operation. Their APIs
and providers remain missing. Keep tests of explicit fixture geometry distinct
from regressions that exercise the actual layout and delivery path.

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

Remove this roadmap when HTML rendering integration, measured APIs, observation
delivery, and output have implemented source or narrower owners. Preserve the
title conflict and other unfinished presentation requirements with their consumers.
