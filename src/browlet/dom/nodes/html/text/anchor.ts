import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';
import { SanitizationCategory } from '../sanitization';

/** Anchor identity used by link and named collections. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element
export class HTMLAnchorElementImpl extends HTMLElementImpl {
  override readonly isAllNamedElement = true;

  static {
    this.prototype.tag = ElementTag.HTMLA;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
    this.prototype.contentModel = {
      children: [{ kind: 'transparent' }],
      forbiddenDescendants: [
        { kind: 'category', category: ContentCategory.Interactive },
        { kind: 'element', implementation: HTMLAnchorElementImpl },
        { kind: 'attribute', name: 'tabindex' },
      ],
    };
    this.prototype.contentAttributes = [
      'href', 'target', 'download', 'ping', 'rel', 'hreflang', 'type', 'referrerpolicy',
    ];
    this.prototype.sanitization = {
      category: SanitizationCategory.Default,
      defaultAttributes: ['href', 'hreflang', 'type'],
      navigatingURLAttributes: ['href'],
    };
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Interactive) return this.hasAttributeNS(null, 'href');
    return super.hasCategory(category);
  }

  protected override allowsListedContentAttribute(name: string): boolean {
    return name === 'href' || this.hasAttributeNS(null, 'href');
  }
}

/*
 * [Exposed=Window]
 * interface HTMLAnchorElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString download;
 *   [CEReactions, Reflect] attribute USVString ping;
 *   [CEReactions, Reflect] attribute DOMString rel;
 *   [SameObject, PutForwards=value, Reflect="rel"] readonly attribute DOMTokenList relList;
 *
 *   [CEReactions] attribute DOMString text;
 *
 *   [CEReactions] attribute DOMString referrerPolicy;
 *
 *   // also has obsolete members
 * };
 *
 * HTMLAnchorElement includes HyperlinkElementUtils;
 * HTMLAnchorElement includes HTMLHyperlinkElementUtils;
 */
export const htmlAnchorElementIDL = defineInterface({
  name: 'HTMLAnchorElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLAnchorElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['a'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
