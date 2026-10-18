import { SVG_NAMESPACE } from '../../../../infra/index';
import { defineInterface, impl } from '../../../../web-idl/index';

import { ElementTag } from '../element-tag';
import { ContentCategory } from '../html/content-model';
import { SVGGraphicsElementImpl } from './graphics-element';

/** SVG-root identity used by Document title selection. */
// https://svgwg.org/svg2-draft/struct.html#InterfaceSVGSVGElement
// PROVISIONAL: viewport/animated values, geometry factories, SVGFitToViewBox, and WindowEventHandlers remain unimplemented.
export class SVGSVGElementImpl extends SVGGraphicsElementImpl {
  static {
    this.prototype.tag = ElementTag.SVGSvg;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Palpable,
    ];
  }
}

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
