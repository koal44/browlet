import { SVG_NAMESPACE } from '../../../../infra/index';
import { defineInterface, impl } from '../../../../web-idl/index';

import { SVGGraphicsElementImpl } from './graphics-element';

/** SVG-root identity used by Document title selection. */
// https://svgwg.org/svg2-draft/struct.html#InterfaceSVGSVGElement
// PROVISIONAL: viewport/animated values, geometry factories, SVGFitToViewBox, and WindowEventHandlers remain unimplemented.
export class SVGSVGElementImpl extends SVGGraphicsElementImpl {}

/*
 * Implemented identity fragment:
 * [Exposed=Window] interface SVGSVGElement : SVGGraphicsElement {};
 */
export const svgSVGElementIDL = defineInterface({
  name: 'SVGSVGElement',
  inherits: 'SVGGraphicsElement',
  exposed: 'Window',
  implementation: impl(SVGSVGElementImpl),
  namespaceURI: SVG_NAMESPACE,
  localNames: ['svg'],
  members: [],
});
