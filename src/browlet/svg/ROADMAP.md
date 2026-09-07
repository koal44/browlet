# SVG host roadmap

## Present

- `element.ts`: `SVGElement` base identity and inline-style integration.
- `style-element.ts`: `SVGStyleElement` and document tree-scope style-sheet
  association.
- `web-idl.ts`: SVG contributions to Browlet's final Web IDL assembly.

## Missing

- [ ] Add concrete SVG element classes only when they have behavior beyond the
  generic SVG element; begin with the SVG root, graphics, links, and resource
  elements required by Selectlet/Stylelet scenarios.
- [ ] Add SVG animated value types, geometry, presentation-attribute
  reflection, and SVG-specific event/CSSOM integration from SVG 2.
- [ ] Complete HTML foreign-content parser adjustments for SVG names and
  attributes (HTML §13.2.6, foreign-content rules).

HTML §3.2.5 owns HTML/SVG/MathML integration; SVG 2 owns the interfaces and
element behavior. Blink's sibling `core/svg` directory confirms that SVG is a
browser-host contribution rather than generic DOM infrastructure.

## Removal condition

Burn this file once the supported SVG profile is explicit and its remaining
gaps are tracked beside implemented SVG subsystems.
