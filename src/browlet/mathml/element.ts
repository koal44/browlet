import {
  defineElementInterface, type ElementCreationContext, ElementImpl,
} from '../dom/nodes/element';
import { MATHML_NAMESPACE } from '../../infra/index';
import {
  defineIncludes, defineInterface,
} from '../../web-idl/declaration/index';
import { impl } from '../../web-idl/index';
import { withMathMLElementStub } from '../stubs';
import type { CSSStyleDeclarationImpl } from '../../stylelet/cssom/declaration';

/*
 * [Exposed=Window]
 * interface MathMLElement : Element { };
 * MathMLElement includes GlobalEventHandlers;
 */
export class MathMLElementImpl
  extends withMathMLElementStub(ElementImpl)
  implements MathMLElement
{
  constructor(context: ElementCreationContext) {
    super(context);
  }

  get style(): CSSStyleDeclarationImpl {
    return ElementImpl.getInlineStyle(this);
  }
}

// -- Web IDL ------------------------------------------------------------

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

export function isMathMLElement(
  element: Element,
): element is MathMLElementImpl {
  return element.namespaceURI === MATHML_NAMESPACE;
}
