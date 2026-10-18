import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The hgroup element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-hgroup-element
export class HTMLHGroupElementImpl extends HTMLElementImpl {
  static override localName = 'hgroup';
  static {
    this.prototype.tag = ElementTag.HTMLHgroup;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Heading) {
      for (let node = this.firstChild; node !== null; node = node.nextDescendant(this)) {
        if (node.isElement()) {
          switch (node.tag) {
            case ElementTag.HTMLH1:
            case ElementTag.HTMLH2:
            case ElementTag.HTMLH3:
            case ElementTag.HTMLH4:
            case ElementTag.HTMLH5:
            case ElementTag.HTMLH6:
              return true;
          }
        }
      }
      return false;
    }
    return super.hasCategory(category);
  }
}
