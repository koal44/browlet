# Property-family roadmap

The [README](README.md) records installed definitions. This roadmap maps the
remaining families to existing homes and external owners; it does not schedule
hundreds of property implementations. The wider module/level checklist remains
in the [Stylelet roadmap](../ROADMAP.md#specification-families).

## Contract for adding a property

- [ ] Record the defining property table and its normative prose together:
  grammar, initial value, inheritance, applicability, percentages, computed
  representation, shorthand/logical relationships, and combination behavior.
  A shared grammar is not a complete property definition.
- [ ] Connect interpretation, defaulting/computation, CSSOM mutation/query, and
  serialization at the correct stage. The [lifecycle roadmap](../value-processing/ROADMAP.md)
  owns common metadata and failure distinctions; do not duplicate that machinery
  in every family or resolve missing values during serialization.
- [ ] Identify the exact external facts and update triggers before connecting a
  context-dependent resolver. Add direct value tests and a connected consumer
  regression; parser coverage alone cannot demonstrate the feature.

## Shorthand and logical-property dependencies

- [x] Implement ordinary `marginShorthand.expand()` and `.serialize()` in `built-in/margin.ts`:
  validate the 1–4-value grammar, expand in top/right/bottom/left order, preserve
  importance and CSS-wide values, and shorten compatible longhands without
  resolving them. The record returns values; CSSOM constructs their occurrences.
- [ ] Add a retained pending-substitution representation shared by a shorthand's
  expanded longhands, including partial overwrites and computed-time failure.
  See [Values 5](https://drafts.csswg.org/css-values-5/#substitution-in-shorthands).
  The existing `SubstitutionValue` does not by itself identify a
  shorthand's pending longhand values.
- [x] Cover ordinary shorthand queries, cssText shortening, mixed importance, removal,
  source-order replacement, and invalid values through projected CSSOM.
- [ ] When adding legacy shorthands, exclude unprefixed legacy names from
  CSSOM's [preferred shorthand order](https://drafts.csswg.org/cssom/#concept-shorthands-preferred-order).
  The current registry contains only the non-legacy `margin` shorthand.
- [ ] Add logical margin records with their actual grammars and mapping metadata;
  test opposing mapping order and shorthand barriers. Existing physical margin
  metadata and CSSOM branches do not establish logical-property support.

### Shorthand substitution handoff

Deferred margin expansion is intentionally left for the substitution slice.
`marginShorthand.expand()` throws for recognized arbitrary-substitution syntax
and `first-valid()` rather than discarding it as an invalid ordinary value.
The general function detector does not validate each function's arguments.

1. Finish the [value substitution prerequisites](../values/ROADMAP.md#substitution-and-custom-values):
   per-element custom-property computation/lookup, cycles, fallback and invalidity,
   and component-preserving substitution. `SubstitutionValue.substitute()` is
   currently the explicit throwing endpoint; recognition is not substitution.
2. Retain the original shorthand grammar/source once, with a pending value for
   each longhand. Cascade these occurrences normally; after substitution, parse
   the original shorthand and select each surviving longhand. Failed computation
   uses the winning declaration's invalid-at-computed-value-time behavior, not an
   earlier declaration. Review `first-valid()` whole-value selection alongside
   this, without treating it as an arbitrary-substitution function.
3. Preserve CSSOM's distinction: pending longhands query as empty text; a complete
   compatible set from the same shorthand returns its original value; mixed or
   independently deferred longhands cannot serialize as a shorthand. Ordinary
   serialization already refuses the latter case.
4. Test replacement of one pending side, removal, importance, and repeated
   `margin: var(--a)` / `margin: var(--b)` assignments. Both pending longhands
   serialize as empty text, so `CSSDeclarationBlock.set()`'s current serialized
   equality alone will not distinguish those edits. Include source/base provenance
   and computed-time failure without adding context caches to values.

## Family homes and stopping points

`props/built-in/` holds concrete property definitions, with family subfolders only
as they become useful. Shared contracts and registries remain in `props/`;
interpreted declaration occurrences live in `cssom/declarations/`.
Reusable values stay in `values/`; at-rules/descriptors
need their own interpretation and CSSOM path. The
[organization plan](../ROADMAP.md#source-organization) records prospective homes.

| Family / representative source | Existing foundation | Missing work and external boundary |
| --- | --- | --- |
| [Color](https://drafts.csswg.org/css-color-4/#resolving-color-values) and [adjustment](https://drafts.csswg.org/css-color-adjust-1/#color-scheme-resolution) | Two installed color properties; color conversion, mixing, and contextual value helpers | Property-specific color computation, color-scheme/forced-color policy, palette/profile inputs. Stylelet computes values; display realization remains external. |
| [Images](https://drafts.csswg.org/css-images-4/#image-values), backgrounds, borders | URLs, gradients, positions, and lengths; background-color is the only installed background property | Layered properties/shorthands and additional image forms. Fetch/decode state, natural dimensions and concrete object size are separate inputs; painting and image-frame delivery remain external. |
| [Fonts](https://drafts.csswg.org/css-fonts-4/#font-matching-algorithm), text, decoration, ruby | Font-relative unit inputs and shared strings/numbers; no registered font/text properties | Font/text properties and font-face descriptor parsing here; [fonts](../../fonts/ROADMAP.md) owns face/loading/matching state and metrics/shaping. [Layout](../../layout/ROADMAP.md) owns lines; readiness needs host coordination. |
| [Writing modes](https://drafts.csswg.org/css-writing-modes-4/#abstract-box) and [logical properties](https://drafts.csswg.org/css-logical-1/#margin-properties) | Position resolver accepts writing mode/direction; four physical margins are installed | Compute CSS axes and logical/physical cascade relationships. HTML directionality is a separate input/UA-rule concern, not a replacement for computed CSS direction. |
| [Display](https://drafts.csswg.org/css-display-3/#transformations), box sizing, positioning, anchors | Length/percentage math and margin definitions | Property values, computed display transformations, applicability and anchor dependencies. Layout owns box generation, containing blocks, intrinsic sizes and positioning results. Computed-style transformations must not all be deferred to layout. |
| [Flex](https://drafts.csswg.org/css-flexbox-1/#flex-basis-property), [grid](https://drafts.csswg.org/css-grid-2/#track-sizing), tables, columns, alignment, [gaps](https://drafts.csswg.org/css-gaps-1/#column-row-gap), fragmentation and overflow | Generic numeric values; no registered family properties | Track/list/shape values and property definitions. Formatting contexts, available sizes, tracks, baselines, fragments and scroll extents belong to layout. Percentage rules differ between properties and contexts. |
| [Generated content](https://drafts.csswg.org/css-content-3/#content-property), lists, counters, pages | Generic strings/URLs; no registered family properties | Counter styles, generated-content values, page rules/descriptors and scoped state. Decide counter traversal ownership with its consumer; DOM/pseudo identity, marker boxes, pagination and print media are distinct dependencies. |
| [Transforms](https://drafts.csswg.org/css-transforms-1/#transform-box), paths, filters, masks, compositing, SVG paint | Opacity plus color/image/position math; registered transform syntax still reaches a value-consumer stub | Value lists, interpolation and property definitions. HTML/SVG reference boxes, SVG resource targets, rasterization and compositing remain outside a generic property value. |
| Pseudo-elements and highlights | Selector representations, not a complete pseudo-style pipeline | Element/pseudo-specific applicability and style subjects; coordinate identity/ranges with [Browlet style integration](../../browlet/style/ROADMAP.md#pseudo-elements-and-highlights), and fragments/paint with layout/rendering. |
| Animation and transitions | Unregistered animation-name parser and type-specific interpolation helpers | Timing/property definitions, keyframes and effect participation. [Animation](../../animation/ROADMAP.md) owns playback/effects and host delivery dependencies; a time value does not establish an animation engine. |
| [UI](https://drafts.csswg.org/css-ui-4/#appearance-switching), viewport, scroll interaction | URL/image/numeric foundations; no registered family properties | Appearance, cursor, outlines, scroll and navigation inputs. Native widgets, input devices, hit testing, viewport/scroll state and output selection remain host/rendering responsibilities. |
| [Speech](https://drafts.csswg.org/css-speech-1/#speaking-props-speak) | Generic frequency/time/string values | Property definitions only if included in the supported profile; speech output/voices are an external dependency, not an inline-style prerequisite. |

[Conditions](../conditional/ROADMAP.md) control participation across these
families. The [value-input contracts](../values/ROADMAP.md#context-inputs-and-freshness) record actual
existing context fields separately from future inputs and their freshness.

## Details not to lose during implementation

- [ ] Keep resource URLs, resource requests, loaded/failed state, decoded data,
  and dimensions distinct. A computed image can still require loading and
  sizing. Background-position percentages refer to the positioning area minus
  the image size, not a universal containing-block width.
- [ ] Preserve descriptors' owning rule and scope. Font-face, counter-style,
  property-registration and page descriptors must not enter the ordinary
  element property registry merely because they use declaration syntax.
- [ ] Account for font changes after fallback selection. Font-size computation,
  relative lengths, glyph metrics and layout can become stale at different
  points; a declaration object is not the font or shaping cache.
- [ ] Keep specified/computed keywords and percentages when required. Used
  sizing, background placement, transform reference boxes and CSSOM resolved
  values need their own consumers rather than serializer-side calculation.

## Reading depth

The reference review sampled property tables and dependency clauses
in Color/Color Adjust, Images/Backgrounds, Fonts, Writing Modes/Logical, Text/
Text Decoration, Display/Sizing, Flex/Grid/Gaps/Overflow, Content/Lists/Page,
Transforms/Filters/Masking, UI and Speech. It did not audit every property's
algorithm, every later level, or browser behavior. Remaining family entries
are scope/ownership accounting, with the broader module list retained above.

The local Box Alignment source now delegates gap definitions to CSS Gaps 1;
the map follows that reference rather than relying on the former owner. Local
checkout inspection is not a claim that every source matches its live draft.

The next implementation review remains the CSSOM/inline-style boundary. These
families supply its future value/dependency requirements; the resulting
[execution order](../../PRIORITY.md#stylelet-delivery-order) remains in project priority.
