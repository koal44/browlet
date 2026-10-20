import { defineInterface, impl } from '../../../../web-idl/core/index';

import { SVGElementImpl } from './element';

/** Graphics-element base identity required by the SVG root. */
// https://svgwg.org/svg2-draft/types.html#InterfaceSVGGraphicsElement
// PROVISIONAL: transforms, geometry methods, and SVGTests remain unimplemented.
export class SVGGraphicsElementImpl extends SVGElementImpl {}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface SVGGraphicsElement : SVGElement {};
 */
export const svgGraphicsElementIDL = defineInterface({
  name: 'SVGGraphicsElement',
  inherits: 'SVGElement',
  exposed: 'Window',
  implementation: impl(SVGGraphicsElementImpl),
  members: [],
});
