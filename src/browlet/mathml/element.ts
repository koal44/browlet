import { defineElementInterface, ElementImpl } from '../dom/nodes/element';
import { MATHML_NAMESPACE } from '../../infra/index';
import { defineIncludes, defineInterface, impl } from '../../web-idl/index';
import type { CSSStyleDeclarationImpl } from '../../stylelet/index';

/** Base implementation for elements in the MathML namespace. */
// https://w3c.github.io/mathml-core/#dom-mathmlelement
export class MathMLElementImpl extends ElementImpl {
  static is(value: unknown): value is MathMLElementImpl {
    return value instanceof MathMLElementImpl;
  }

  get style(): CSSStyleDeclarationImpl {
    return this.getInlineStyle();
  }
}

/*
 * [Exposed=Window]
 * interface MathMLElement : Element { };
 * MathMLElement includes GlobalEventHandlers;
 */
export const mathMLElementIDL = defineInterface({
  name: 'MathMLElement',
  inherits: 'Element',
  exposed: 'Window',
  implementation: impl(MathMLElementImpl),
  members: [],
});

export const mathMLElementInterface = defineElementInterface({
  definition: mathMLElementIDL,
  namespaceURI: MATHML_NAMESPACE,
});

/*
 * MathMLElement includes ElementCSSInlineStyle;
 */
export const mathMLElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'MathMLElement', mixin: 'ElementCSSInlineStyle',
});
