import { HTML_NAMESPACE } from '../../../../shared/namespaces';
import {
  defineElementInterface, type ElementCreationContext,
} from '../../../dom/nodes/element';
import { defineInterface } from '../../../../web-idl/declaration/index';
import { impl } from '../../../../web-idl/index';
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
  implements HTMLHeadElement
{
  constructor(context: ElementCreationContext) {
    super(context);
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
