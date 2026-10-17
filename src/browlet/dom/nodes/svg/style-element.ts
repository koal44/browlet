import { SVG_NAMESPACE } from '../../../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../../../web-idl/index';
import type { CSSStyleSheetImpl } from '../../../../stylelet/index';

import { LinkStyleMixin } from '../../../style/index';
import type { BrowletEnvironment } from '../../../environment';

import type { ElementCreationContext } from '../element';
import { SVGElementImpl } from './element';

/** Associates inline SVG stylesheet text with its tree scope. */
// https://svgwg.org/svg2-draft/styling.html#InterfaceSVGStyleElement
export class SVGStyleElementImpl extends SVGElementImpl {
  /** Changes that require updating this element's associated stylesheet. */
  static #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  constructor(context: ElementCreationContext, env: BrowletEnvironment) {
    super(context, env);
    this.linkStyleMixin = new LinkStyleMixin(
      this, SVGStyleElementImpl.#linkStyleOptions, context.treeScopeResolver,
    );
  }

  static is(value: unknown): value is SVGStyleElementImpl {
    return value instanceof SVGStyleElementImpl;
  }

  get sheet(): CSSStyleSheetImpl | null {
    return this.getStyleSheet();
  }
}

/*
 * [Exposed=Window]
 * interface SVGStyleElement : SVGElement {
 *   attribute DOMString type;
 *   attribute DOMString media;
 *   attribute DOMString title;
 *   attribute boolean disabled;
 * };
 */
export const svgStyleElementIDL = defineInterface({
  name: 'SVGStyleElement',
  inherits: 'SVGElement',
  exposed: 'Window',
  implementation: impl(SVGStyleElementImpl),
  namespaceURI: SVG_NAMESPACE,
  localNames: ['style'],
  members: [],
});

/*
 * SVGStyleElement includes LinkStyle;
 */
export const svgStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'SVGStyleElement', mixin: 'LinkStyle',
});
