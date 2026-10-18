import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The address element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-address-element
export class HTMLAddressElementImpl extends HTMLElementImpl {
  static override localName = 'address';
  static {
    this.prototype.tag = ElementTag.HTMLAddress;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
  }
}
