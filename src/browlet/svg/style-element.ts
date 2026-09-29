import {
  defineElementInterface, type ElementCreationContext,
} from '../dom/nodes/element';
import { SVG_NAMESPACE } from '../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../web-idl/index';
import { SVGElementImpl } from './element';
import type { CSSStyleSheetImpl } from '../../stylelet/index';
import type { Environment } from '../scripting/environment';
import { LinkStyleMixin } from '../style/integration';

/** Associates inline SVG stylesheet text with its tree scope. */
// https://svgwg.org/svg2-draft/styling.html#InterfaceSVGStyleElement
export class SVGStyleElementImpl extends SVGElementImpl {
  /** Changes that require updating this element's associated stylesheet. */
  static #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  constructor(context: ElementCreationContext, env: Environment) {
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
 * SVGStyleElement includes LinkStyle;
 */
export const svgStyleElementIDL = defineInterface({
  name: 'SVGStyleElement',
  inherits: 'SVGElement',
  exposed: 'Window',
  implementation: impl(SVGStyleElementImpl),
  members: [],
});

export const svgStyleElementInterface = defineElementInterface({
  definition: svgStyleElementIDL,
  localNames: ['style'],
  namespaceURI: SVG_NAMESPACE,
});

export const svgStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'SVGStyleElement', mixin: 'LinkStyle',
});
