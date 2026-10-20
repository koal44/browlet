import { SVG_NAMESPACE } from '../../../../infra/index';
import { defineInterface, impl } from '../../../../web-idl/core/index';

import { ElementTag } from '../element-definitions/index';

import { SVGElementImpl } from './element';

/** Concrete SVG script identity used by HTML's HTMLOrSVGScriptElement typedef. */
// https://svgwg.org/svg2-draft/interact.html#InterfaceSVGScriptElement
// PROVISIONAL: attributes, URI references, script preparation, loading, and execution remain unimplemented.
export class SVGScriptElementImpl extends SVGElementImpl {
  static {
    this.prototype.tag = ElementTag.SVGScript;
  }
}

/*
 * [Exposed=Window]
 * interface SVGScriptElement : SVGElement {
 *   attribute DOMString type;
 *   attribute DOMString? crossOrigin;
 * };
 * SVGScriptElement includes SVGURIReference;
 */
export const svgScriptElementIDL = defineInterface({
  name: 'SVGScriptElement', inherits: 'SVGElement', exposed: 'Window',
  implementation: impl(SVGScriptElementImpl),
  namespaceURI: SVG_NAMESPACE,
  localNames: ['script'],
  // TODO(SVG 2 §15.10.1): attributes and SVGURIReference await their owning algorithms and value types.
  members: [],
});
