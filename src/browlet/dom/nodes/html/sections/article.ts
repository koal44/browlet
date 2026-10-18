import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';
import { SanitizationCategory } from '../sanitization';

/** The article element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-article-element
export class HTMLArticleElementImpl extends HTMLElementImpl {
  static override localName = 'article';
  static {
    this.prototype.tag = ElementTag.HTMLArticle;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Sectioning, ContentCategory.Palpable,
    ];
    this.prototype.contentAttributes = [];
    this.prototype.sanitization = { category: SanitizationCategory.Default };
  }
}
