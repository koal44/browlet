import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Concrete dialog identity retained by Document's open-dialogs list. */
// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
export class HTMLDialogElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLDialog;
    this.prototype.categories = [
      ContentCategory.Flow,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLDialogElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute boolean open;
 *   attribute DOMString returnValue;
 *   [CEReactions, ReflectSetter] attribute DOMString closedBy;
 *   [CEReactions] undefined show();
 *   [CEReactions] undefined showModal();
 *   [CEReactions] undefined close(optional DOMString returnValue);
 *   [CEReactions] undefined requestClose(optional DOMString returnValue);
 * };
 */
export const htmlDialogElementIDL = defineInterface({
  name: 'HTMLDialogElement', inherits: 'HTMLElement', exposed: 'Window',
  implementation: impl(HTMLDialogElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['dialog'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
