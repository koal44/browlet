# SVG host roadmap

## Present

- `element.ts`: `SVGElement` base identity and inline-style integration.
- `graphics-element.ts` and `svg-element.ts`: the SVGSVGElement → SVGGraphicsElement
  → SVGElement identity chain. Document title selection recognizes the concrete
  SVG root; this does not supply viewport, geometry, or animated-value behavior.
- `style-element.ts`: `SVGStyleElement` and document tree-scope style-sheet
  association.
- `script-element.ts`: concrete `SVGScriptElement` identity required by HTML
  §3.1.1's `HTMLOrSVGScriptElement` typedef. This does not prepare or execute scripts.
- `title-element.ts`: `SVGTitleElement` identity and mutation notifications for
  HTML's `document.title`, including child text moves. Document owns title
  selection; SVG accessibility descriptions and browser UI remain separate work.
- `web-idl.ts`: SVG contributions to Browlet's final Web IDL assembly.

## Missing

- [ ] Add concrete SVG element classes when a consumer needs their identity or
  behavior; links and resource elements required by Selectlet/Stylelet remain.
- [ ] Complete SVGGraphicsElement transforms, bounds/matrix queries, and SVGTests;
  complete SVGSVGElement animated lengths, viewport state, geometry/utility methods,
  SVGFitToViewBox, and WindowEventHandlers.
- [ ] Add SVG animated value types, geometry, presentation-attribute
  reflection, and SVG-specific event/CSSOM integration from SVG 2.
- [ ] Complete SVGScriptElement's `type` and `crossOrigin` attributes,
  `SVGURIReference`/animated `href` dependency, and SVG script preparation,
  loading, and execution. HTML's `currentScript` consumer is still pending.
- [ ] Complete HTML foreign-content parser adjustments for SVG names and
  attributes (HTML §13.2.6, foreign-content rules).

HTML §3.2.5 owns HTML/SVG/MathML integration; SVG 2 owns the interfaces and
element behavior. The SVG element implementations now live with the DOM node
family; the SVG barrel and declaration collector remain explicit entries.

## Removal condition

Burn this file once the supported SVG profile is explicit and its remaining
gaps are tracked beside implemented SVG subsystems.
