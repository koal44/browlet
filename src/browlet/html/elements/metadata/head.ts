import { HTML_NAMESPACE } from '../../../../infra/index';
import { defineElementInterface } from '../../../dom/nodes/element';
import { defineInterface, impl } from '../../../../web-idl/index';
import { HTMLElementImpl } from '../html-element';

/** Contains document metadata before the body. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-head-element
export class HTMLHeadElementImpl extends HTMLElementImpl {
  static is(value: unknown): value is HTMLHeadElementImpl {
    return value instanceof HTMLHeadElementImpl;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLHeadElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
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
