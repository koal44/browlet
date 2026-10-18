import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** Fieldset-legend element identity. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmllegendelement
export class HTMLLegendElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLLegend;
    this.prototype.categories = [];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLLegendElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   readonly attribute HTMLFormElement? form;
 *
 *   // also has obsolete members
 * };
 */
export const htmlLegendElementIDL = defineInterface({
  name: 'HTMLLegendElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLLegendElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['legend'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
