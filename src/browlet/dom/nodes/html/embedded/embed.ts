import { HTML_NAMESPACE, InternalError } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';
import type { Navigable } from '../../../../browsing/navigation/index';

import { HTMLElementImpl, type DocumentNamedItemType } from '../html-element';
import { hasExposedObjectAncestor } from './object';

/** Embed exposure and retained child-navigation state. */
// https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-embed-element
export class HTMLEmbedElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLEmbed;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Interactive,
      ContentCategory.Palpable,
    ];
  }

  /** Document destination selected by setup, with its reverse container link maintained by the accessor. */
  #contentNavigable: Navigable | null = null;

  /** Child destination, or null when the embed is not displaying a Document. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#content-navigable
  get contentNavigable(): Navigable | null {
    return this.#contentNavigable;
  }

  set contentNavigable(value: Navigable | null) {
    if (this.#contentNavigable === value) return;
    const previous = this.#contentNavigable;
    this.#contentNavigable = value;
    previous?.setContainer(null);
    value?.setContainer(this);
  }

  /** Select embedded content and create or navigate its child. */
  // https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-embed-element-setup-steps
  setup(): void {
    // TODO(HTML §4.8.6): Fetch/classify content, suppress stale setup work, and delay the load event.
    // Potential activity and src/type changes must queue these steps on the embed task source.
    // Create missing children through this.nodeDocument.env.userAgent.createChildNavigable(this), then navigate.
    // Removal and display-no-plugin steps must use nodeDocument.env.userAgent.destroyChildNavigable(this).
    // Recursive Document teardown and history application remain unfinished.
    throw new InternalError('Embed resource selection and child navigation are not implemented');
  }

  override getDocumentNamedItemType(): DocumentNamedItemType {
    return this.isExposed() ? 'name' : 'none';
  }

  /** Eligible for Document named access when no exposed object ancestor hides it. */
  // https://html.spec.whatwg.org/multipage/dom.html#exposed
  isExposed(): boolean {
    return !hasExposedObjectAncestor(this);
  }

  protected override insertionSteps(): void {
    this.nodeDocument.recordNavigableContainerInsertion(this);
    super.insertionSteps();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLEmbedElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [CEReactions, Reflect] attribute DOMString width;
 *   [CEReactions, Reflect] attribute DOMString height;
 *   Document? getSVGDocument();
 *
 *   // also has obsolete members
 * };
 */
export const htmlEmbedElementIDL = defineInterface({
  name: 'HTMLEmbedElement', inherits: 'HTMLElement', exposed: 'Window',
  implementation: impl(HTMLEmbedElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['embed'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
