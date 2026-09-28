import { HTML_NAMESPACE } from '../../../../infra/index';
import { defineElementInterface } from '../../../dom/nodes/element';
import { defineInterface, impl } from '../../../../web-idl/index';
import { withHTMLHeadElementStub } from '../../../stubs';
import { HTMLElementImpl } from '../html-element';

/*
 * [Exposed=Window]
 * interface HTMLHeadElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export class HTMLHeadElementImpl
  extends withHTMLHeadElementStub(HTMLElementImpl)
{
  static is(value: unknown): value is HTMLHeadElementImpl {
    return value instanceof HTMLHeadElementImpl;
  }
}

// -- Web IDL ------------------------------------------------------------

export const htmlHeadElementIDL = defineInterface({
  name: 'HTMLHeadElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLHeadElementImpl),
  members: [],
});

export const htmlHeadElementInterface = defineElementInterface({
  definition: htmlHeadElementIDL,
  localNames: ['head'],
  namespaceURI: HTML_NAMESPACE,
});
