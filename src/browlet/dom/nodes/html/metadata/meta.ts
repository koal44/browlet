import { HTML_NAMESPACE, InternalError, asciiLower } from '../../../../../infra/index';
import { attr, ctor, defineInterface, idlType, impl, reflect, xattr } from '../../../../../web-idl/core/index';
import { currentCoarsenedWallTime } from '../../../../../timing/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Metadata identity and insertion-triggered declarative Refresh. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-meta-element
export class HTMLMetaElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLMeta;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Metadata,
    ];
  }

  /** Most recent insertion into a Document tree, in wall-clock milliseconds. */
  documentInsertionTime: number | null = null;

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Flow || category === ContentCategory.Phrasing) {
      return this.hasAttributeNS(null, 'itemprop');
    }
    return super.hasCategory(category);
  }

  protected override insertionSteps(): void {
    super.insertionSteps();
    // HTML's "inserted into a document" excludes connected shadow trees.
    if (!this.getRoot().isDocument()) return;
    this.documentInsertionTime = currentCoarsenedWallTime().milliseconds;
    // TODO(HTML §4.2.5): Other pragma states and metadata-name processing still need
    // their own algorithms; this hook connects only the Refresh state.
    // SPEC_CLASH(meta-refresh-attribute-changes): Follow HTML/Firefox's insertion-only
    // processing; Chromium/WebKit also activate Refresh on content/http-equiv changes.
    // https://html.spec.whatwg.org/multipage/semantics.html#attr-meta-http-equiv-refresh
    if (asciiLower(this.getAttributeNS(null, 'http-equiv') ?? '') !== 'refresh') return;
    const input = this.getAttributeNS(null, 'content');
    if (input === null || input === '') return;
    this.nodeDocument.processDeclarativeRefresh(input, this);
  }

  protected override isDirectionalityCapableAttributeName(name: string): boolean {
    if (name === 'content' && this.getAttributeNS(null, 'name')) {
      // TODO(HTML §4.2.5): Classify metadata names whose values are primarily human-readable.
      throw new InternalError('Metadata-name directionality rules are not implemented');
    }
    return super.isDirectionalityCapableAttributeName(name);
  }

  protected override isTranslatableAttributeName(name: string): boolean {
    if (name === 'content' && this.getAttributeNS(null, 'name')) {
      // TODO(HTML §4.2.5): Determine whether this metadata name has a translatable value.
      throw new InternalError('Metadata-name translation rules are not implemented');
    }
    return super.isTranslatableAttributeName(name);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLMetaElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect="http-equiv"] attribute DOMString httpEquiv;
 *   [CEReactions, Reflect] attribute DOMString content;
 *   [CEReactions, Reflect] attribute DOMString media;
 *
 *   // also has obsolete members
 * };
 */
export const htmlMetaElementIDL = defineInterface({
  name: 'HTMLMetaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMetaElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['meta'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    attr('name', idlType.DOMString, xattr('CEReactions', reflect())),
    attr('httpEquiv', idlType.DOMString, xattr('CEReactions', reflect({ name: 'http-equiv' }))),
    attr('content', idlType.DOMString, xattr('CEReactions', reflect())),
    attr('media', idlType.DOMString, xattr('CEReactions', reflect())),
  ],
});
