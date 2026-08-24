import { HTML_NAMESPACE } from '../../../../shared/namespaces';
import {
  defineElementInterface, type ElementCreationContext,
} from '../../../dom/nodes/element';
import { defineInterface } from '../../../../web-idl/declaration/index';
import { bind } from '../../../../web-idl/index';
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
  binding: bind(HTMLHeadElementImpl),
  exposed: 'Window',
  inherits: 'HTMLElement',
  members: [],
  name: 'HTMLHeadElement',
});

export const htmlHeadElementInterface = defineElementInterface({
  definition: htmlHeadElementIDL,
  localNames: ['head'],
  namespaceURI: HTML_NAMESPACE,
});
