import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { defineElementInterface } from '../../element';
import { HTMLElementImpl } from '../html-element';

/** Optgroup identity used by the options collection's add operation. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmloptgroupelement
// PROVISIONAL: disabled/label reflection and selection lifecycle hooks await §4.10.
export class HTMLOptGroupElementImpl extends HTMLElementImpl {
  static is(value: unknown): value is HTMLOptGroupElementImpl {
    return value instanceof HTMLOptGroupElementImpl;
  }
}

export const htmlOptGroupElementIDL = defineInterface({
  name: 'HTMLOptGroupElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLOptGroupElementImpl),
  members: [],
});

export const htmlOptGroupElementInterface = defineElementInterface({
  definition: htmlOptGroupElementIDL,
  localNames: ['optgroup'],
  namespaceURI: HTML_NAMESPACE,
});
