# Layout roadmap

Planned layout engine owning box construction, formatting, fragments, and
retained layout results. No layout implementation exists yet. Stylelet owns
style computation; [Browlet rendering integration](../browlet/rendering/ROADMAP.md)
owns document lifecycle, scheduled updates, API consumers, and presentation.

## Inputs, state, and results

- Consume internal computed style, tree/content changes, formatting constraints,
  and HTML/SVG-specific facts through explicit integration. Do not use the
  author-facing getComputedStyle object as the engine's data model.
- Own the box tree and resulting fragments. DOM nodes, boxes, and fragments
  have different identities: omitted/anonymous boxes and fragmentation prevent
  a one-node/one-box model. Keep source associations for queries and hit testing.
- Reuse [geometry](../geometry/ROADMAP.md), [fonts](../fonts/ROADMAP.md), and
  [graphics](../graphics/ROADMAP.md) for coordinates, metrics/shaped runs, and
  image facts. Direct dependencies are appropriate for shared algorithms;
  owning environments and Host Ports supply only their actual facilities.
- Tree construction may reuse DOMOperations, but formatting algorithms should
  operate on layout's own inputs. Do not copy the entire DOM or establish a
  universal layout data bag before a concrete algorithm needs it.
- Retain results and invalidate according to style, content, constraints,
  resources, and font availability. Define freshness before exposing queries;
  a cached rectangle must not silently outlive the inputs that produced it.

## Formatting work

Use local CSSWG sources with base levels and additions reviewed together.
The earlier survey identified these requirements; it did not audit layout
algorithms or choose a backend.

| Area | Sources and required results |
| --- | --- |
| Box generation and sizing | CSS2, Display, Box, Sizing, Position, Logical Properties, and Anchor Positioning: boxes, containing/reference boxes, intrinsic contributions, and used dimensions |
| Inline/text | Inline, Text, Writing Modes, Ruby, and Unicode bidi requirements: whitespace/text transformation, shaped runs, lines, baselines, and physical/logical coordinates |
| Formatting contexts | Flexbox, Grid, Tables, Multicol, Alignment/Gaps: placement, tracks, available space, and baseline relationships |
| Fragmentation and overflow | Break, Overflow, Shapes/Exclusions/Floats, Paged Media: fragments, clipping/scroll extents, pagination, and float placement |
| Replaced content | Images/Sizing plus host element rules: natural and concrete dimensions, aspect ratios, embedded content, and nested viewport constraints |
| Generated content | Content, Lists, Counter Styles, and page rules: marker/generated boxes and counters; settle traversal/state ownership with the first consumer |

HTML §15 supplies defaults and element-specific requirements through Browlet.
SVG bounds/viewports and MathML layout need deliberate integration; an HTML
box width cannot stand in for every [transform reference box](https://drafts.csswg.org/css-transforms-1/#transform-box).

## Update and query boundaries

- Coordinate style/layout feedback through Browlet's existing update phases.
  Container queries, font loading, intrinsic sizing, and scroll-state snapshots
  require ordered work; do not solve this with recursive live queries from
  arbitrary value resolvers or a second rendering scheduler.
- Supply box existence, rectangles, text fragments, reference sizes, baselines,
  and scroll extents to concrete consumers. CSSOM View, Resize/Intersection
  Observer, focus visibility, and rendered-text algorithms retain their own
  semantics and delivery rules in Browlet.
- For [innerText](https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute),
  provide rendered membership, processed text with line-ending context, and
  used display/table relationships. HTML owns the collection algorithm.
- [Layout Worklet](https://drafts.css-houdini.org/css-layout-api-1/) is a later
  consumer of children, constraints, intrinsic sizes, and fragments. Its child
  handles belong to a layout pass; Browlet owns worklet execution/lifetime.
- Keep layout independent of GUI presentation. Painting/compositing consume
  its results but require their own output contract; that contract is not
  established by placing coordinates on boxes.

## First implementation and checks

Begin with a small formatting context and real tree/style inputs. Test box
association, constraints, used sizes, and invalidation before broader formatting
modes. Then prove one measured API through Browlet, including changes after a
retained result. Headless tests still require real layout, not fixture geometry
presented as evidence of browser measurement. Portable hosting API details and
paint integration remain open until those consumers make the needs concrete.
