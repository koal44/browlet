import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, ctor, defineInterface, idlType, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import type { NodeImpl } from '../../node';
import { HTMLElementImpl } from '../html-element';

/** Supplies the document title from this element's direct text children. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-title-element
export class HTMLTitleElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLTitle;
    this.prototype.categories = [
      ContentCategory.Metadata,
    ];
  }

  static is(value: unknown): value is HTMLTitleElementImpl {
    return value instanceof HTMLTitleElementImpl;
  }

  /** Raw child text; setting it replaces all children without normalizing whitespace. */
  // https://html.spec.whatwg.org/multipage/semantics.html#dom-title-text
  get text(): string { return this.getChildTextContent(); }
  set text(value: string) { this.stringReplaceAll(value); }

  protected override insertionSteps(): void {
    super.insertionSteps();
    this.nodeDocument.updateTitleElement(this);
  }

  protected override removingSteps(): void {
    super.removingSteps();
    this.nodeDocument.updateTitleElement(this);
  }

  protected override movingSteps(isSubtreeRoot: boolean, oldAncestor: NodeImpl): void {
    super.movingSteps(isSubtreeRoot, oldAncestor);
    this.nodeDocument.updateTitleElement(this);
  }

  protected override childrenChanged(): void {
    super.childrenChanged();
    this.nodeDocument.updateTitleText(this);
  }

  protected override childrenMoved(): void {
    super.childrenMoved();
    this.nodeDocument.updateTitleText(this);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTitleElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions] attribute DOMString text;
 * };
 */
export const htmlTitleElementIDL = defineInterface({
  name: 'HTMLTitleElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTitleElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['title'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    attr('text', idlType.DOMString, xattr('CEReactions')),
  ],
});
