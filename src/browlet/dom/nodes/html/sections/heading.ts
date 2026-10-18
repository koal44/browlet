import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The h1 element, exposed through HTMLHeadingElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-h1,-h2,-h3,-h4,-h5,-and-h6-elements
export class HTMLH1ElementImpl extends HTMLElementImpl {
  static override localName = 'h1';
  static {
    this.prototype.tag = ElementTag.HTMLH1;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Heading, ContentCategory.Palpable,
    ];
  }
}

/** The h2 element, exposed through HTMLHeadingElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-h1,-h2,-h3,-h4,-h5,-and-h6-elements
export class HTMLH2ElementImpl extends HTMLElementImpl {
  static override localName = 'h2';
  static {
    this.prototype.tag = ElementTag.HTMLH2;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Heading, ContentCategory.Palpable,
    ];
  }
}

/** The h3 element, exposed through HTMLHeadingElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-h1,-h2,-h3,-h4,-h5,-and-h6-elements
export class HTMLH3ElementImpl extends HTMLElementImpl {
  static override localName = 'h3';
  static {
    this.prototype.tag = ElementTag.HTMLH3;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Heading, ContentCategory.Palpable,
    ];
  }
}

/** The h4 element, exposed through HTMLHeadingElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-h1,-h2,-h3,-h4,-h5,-and-h6-elements
export class HTMLH4ElementImpl extends HTMLElementImpl {
  static override localName = 'h4';
  static {
    this.prototype.tag = ElementTag.HTMLH4;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Heading, ContentCategory.Palpable,
    ];
  }
}

/** The h5 element, exposed through HTMLHeadingElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-h1,-h2,-h3,-h4,-h5,-and-h6-elements
export class HTMLH5ElementImpl extends HTMLElementImpl {
  static override localName = 'h5';
  static {
    this.prototype.tag = ElementTag.HTMLH5;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Heading, ContentCategory.Palpable,
    ];
  }
}

/** The h6 element, exposed through HTMLHeadingElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-h1,-h2,-h3,-h4,-h5,-and-h6-elements
export class HTMLH6ElementImpl extends HTMLElementImpl {
  static override localName = 'h6';
  static {
    this.prototype.tag = ElementTag.HTMLH6;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Heading, ContentCategory.Palpable,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLHeadingElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlHeadingElementIDL = defineInterface({
  name: 'HTMLHeadingElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: [
    impl(HTMLH1ElementImpl),
    impl(HTMLH2ElementImpl),
    impl(HTMLH3ElementImpl),
    impl(HTMLH4ElementImpl),
    impl(HTMLH5ElementImpl),
    impl(HTMLH6ElementImpl),
  ],
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
