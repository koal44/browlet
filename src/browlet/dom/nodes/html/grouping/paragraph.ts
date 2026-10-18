import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag, ContentCategory, phrasingContent } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Paragraph element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmlparagraphelement
export class HTMLParagraphElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLP;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
    // https://html.spec.whatwg.org/multipage/grouping-content.html#the-p-element
    this.prototype.contentModel = { childRules: [phrasingContent] };
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next !== null) {
      if (!next.isElement()) return false;
      return next.tag === ElementTag.HTMLAddress || next.tag === ElementTag.HTMLArticle ||
        next.tag === ElementTag.HTMLAside || next.tag === ElementTag.HTMLBlockquote ||
        next.tag === ElementTag.HTMLDetails || next.tag === ElementTag.HTMLDialog ||
        next.tag === ElementTag.HTMLDiv || next.tag === ElementTag.HTMLDl ||
        next.tag === ElementTag.HTMLFieldset || next.tag === ElementTag.HTMLFigcaption ||
        next.tag === ElementTag.HTMLFigure || next.tag === ElementTag.HTMLFooter ||
        next.tag === ElementTag.HTMLForm || next.tag === ElementTag.HTMLH1 ||
        next.tag === ElementTag.HTMLH2 || next.tag === ElementTag.HTMLH3 ||
        next.tag === ElementTag.HTMLH4 || next.tag === ElementTag.HTMLH5 ||
        next.tag === ElementTag.HTMLH6 || next.tag === ElementTag.HTMLHeader ||
        next.tag === ElementTag.HTMLHgroup || next.tag === ElementTag.HTMLHr ||
        next.tag === ElementTag.HTMLMain || next.tag === ElementTag.HTMLMenu ||
        next.tag === ElementTag.HTMLNav || next.tag === ElementTag.HTMLOl ||
        next.tag === ElementTag.HTMLP || next.tag === ElementTag.HTMLPre ||
        next.tag === ElementTag.HTMLSearch || next.tag === ElementTag.HTMLSection ||
        next.tag === ElementTag.HTMLTable || next.tag === ElementTag.HTMLUl;
    }

    const parent = this.parentElement;
    if (!(parent instanceof HTMLElementImpl)) return false;
    const definition = parent.customElementDefinition;
    const autonomous = definition !== null && definition.name === definition.localName;
    return !autonomous && !(parent.tag === ElementTag.HTMLA || parent.tag === ElementTag.HTMLAudio ||
      parent.tag === ElementTag.HTMLDel || parent.tag === ElementTag.HTMLIns ||
      parent.tag === ElementTag.HTMLMap || parent.tag === ElementTag.HTMLNoscript ||
      parent.tag === ElementTag.HTMLVideo);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLParagraphElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlParagraphElementIDL = defineInterface({
  name: 'HTMLParagraphElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLParagraphElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['p'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
