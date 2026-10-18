import { HTMLElementImpl } from '../html-element';

/** The article element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-article-element
export class HTMLArticleElementImpl extends HTMLElementImpl {
  static override localName = 'article';
}
