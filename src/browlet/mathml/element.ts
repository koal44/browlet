import {
  defineElementInterface, type ElementCreationContext, ElementImpl,
} from '../dom/nodes/element';
import { MATHML_NAMESPACE } from '../../shared/namespaces';
import {
  defineIncludes, defineInterface,
} from '../../web-idl/declaration/index';
import { bind } from '../../web-idl/index';
import { withMathMLElementStub } from '../stubs';

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

  get style(): CSSStyleDeclaration {
    return ElementImpl.getInlineStyle(this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const mathMLElementIDL = defineInterface({
  binding: bind(MathMLElementImpl),
  exposed: 'Window',
  inherits: 'Element',
  members: [],
  name: 'MathMLElement',
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
