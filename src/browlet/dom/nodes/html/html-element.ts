import { asciiWhitespacePattern } from '../../../../infra/index';
import { InternalError } from '../../../../infra/internal-error';
import type { CSSStyleDeclarationImpl } from '../../../../stylelet/index';

import { ElementImpl } from '../element';
import type { NodeImpl } from '../node';
import { HTMLOrSVGOrMathMLElementMixin } from '../html-or-svg-or-mathml-element';
import { ContentCategory, type ContentModel } from './content-model';
import type { ElementSanitization } from './sanitization';

/** Base implementation for elements in the HTML namespace. */
// https://html.spec.whatwg.org/multipage/dom.html#htmlelement
export class HTMLElementImpl extends ElementImpl {
  /** Fixed eligibility for name-based document.all lookup; ID lookup does not use this flag. */
  // https://html.spec.whatwg.org/#all-named-elements
  readonly isAllNamedElement: boolean = false;

  /** Content requirements shared through the prototype; undefined means the model is unfinished. */
  declare contentModel?: ContentModel;

  /** Attribute names shared through the prototype; undefined means unfinished, [] means globals only. */
  declare contentAttributes?: string[];

  /** Sanitizer facts shared through the prototype; undefined means the inventory is unfinished. */
  declare sanitization?: ElementSanitization;

  /** Common HTML, SVG, and MathML state and attribute behavior. */
  #htmlOrSVGOrMathMLElementMixin = new HTMLOrSVGOrMathMLElementMixin(this);

  static is(value: unknown): value is HTMLElementImpl {
    return value instanceof HTMLElementImpl;
  }

  /** Cryptographic nonce exposed to script, independently of the content attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#dom-noncedelement-nonce
  get nonce(): string { return this.#htmlOrSVGOrMathMLElementMixin.nonce; }
  set nonce(value: string) { this.#htmlOrSVGOrMathMLElementMixin.nonce = value; }

  get style(): CSSStyleDeclarationImpl {
    return this.getInlineStyle();
  }

  override hasCategory(category: ContentCategory): boolean {
    if (this.isAutonomousCustomElement()) {
      switch (category) {
        case ContentCategory.Flow:
        case ContentCategory.Phrasing:
        case ContentCategory.Palpable:
          return true;
        case ContentCategory.FormAssociated:
        case ContentCategory.Listed:
        case ContentCategory.Labelable:
        case ContentCategory.Submittable:
        case ContentCategory.Resettable:
          return this.isFormAssociatedCustomElement();
        default:
          return false;
      }
    }
    return super.hasCategory(category);
  }

  /** Whether this element has become a custom element whose definition does not extend a built-in. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#autonomous-custom-element
  isAutonomousCustomElement(): boolean {
    const definition = this.customElementDefinition;
    return this.customElementState === 'custom' && definition !== null && definition.name === definition.localName;
  }

  /** Whether this autonomous custom element's definition enables form association. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#form-associated-custom-element
  isFormAssociatedCustomElement(): boolean {
    if (!this.isAutonomousCustomElement()) return false;
    // TODO: §4.13 must populate the form-associated definition state.
    throw new InternalError('Custom-element form association is not implemented');
  }

  /** Content requirements for this element; conditional models can override this query. */
  getContentModel(): ContentModel {
    const model = this.contentModel;
    if (model === undefined) {
      throw new InternalError(`Content model for ${this.localName} is not implemented`);
    }
    return model;
  }

  /** Whether the current children satisfy "nothing", independently of the element's declared model or voidness. */
  // https://html.spec.whatwg.org/multipage/dom.html#concept-content-nothing
  matchesNothingContentModel(): boolean {
    for (let child = this.firstChild; child !== null; child = child.nextSibling) {
      if (!child.isIgnoredHTMLContent()) return false;
    }
    return true;
  }

  /** Whether the current children satisfy the text-only content model. */
  // https://html.spec.whatwg.org/multipage/dom.html#text-content
  matchesTextContentModel(): boolean {
    for (let child = this.firstChild; child !== null; child = child.nextSibling) {
      if (!child.isText() && !child.isIgnoredHTMLContent()) return false;
    }
    return true;
  }

  /**
   * Whether this start tag may be omitted from a conforming HTML document.
   * The caller preserves tree content and supplies the preceding content sibling's output decision.
   */
  // https://html.spec.whatwg.org/multipage/syntax.html#optional-tags
  canOmitStartTag(_previousEndTagOmitted: boolean): boolean {
    return false;
  }

  /**
   * Whether a normally present end tag may be omitted from a conforming HTML document.
   * This does not describe void elements, whose end tags are forbidden, or XML syntax.
   */
  // https://html.spec.whatwg.org/multipage/syntax.html#optional-tags
  canOmitEndTag(): boolean {
    return false;
  }

  /**
   * Whether a namespace-less HTML attribute name is permitted in this element's current state.
   * Uses the specification's lowercase name; does not check values or missing required attributes.
   * Throws when the element inventory or required global-attribute rules are unfinished.
   */
  // https://html.spec.whatwg.org/multipage/dom.html#concept-element-attributes
  allowsContentAttribute(name: string): boolean {
    const attributes = this.contentAttributes;
    if (attributes === undefined) {
      throw new InternalError(`Content attributes for ${this.localName} are not implemented`);
    }
    if (attributes.includes(name)) return this.allowsListedContentAttribute(name);
    // TODO: Global-attribute eligibility, including data-*, event handlers, and ARIA, belongs to §3.2.6.
    // https://html.spec.whatwg.org/multipage/dom.html#global-attributes
    throw new InternalError(`Global content-attribute rules for ${name} are not implemented`);
  }

  /** Current participation in Document named-property lookup, including exposure rules. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem-filter
  getDocumentNamedItemType(): DocumentNamedItemType {
    return 'none';
  }

  /** Whether this element matches a supported Document named property. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem-filter
  matchesDocumentName(name: string): boolean {
    const type = this.getDocumentNamedItemType();
    if (type === 'none') return false;
    const elementName = this.getAttributeNS(null, 'name');
    return elementName === name ||
      ((type === 'name-or-id' || (type === 'name-or-id-with-name' && !!elementName)) &&
        this.getAttributeNS(null, 'id') === name);
  }

  override attributeChanged(
    localName: string, oldValue: string | null, newValue: string | null,
    namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, newValue, namespace);
    this.#htmlOrSVGOrMathMLElementMixin.attributeChanged(localName, newValue, namespace);
  }

  /** Additional conditions for a name already found in this element's attribute inventory. */
  protected allowsListedContentAttribute(_name: string): boolean {
    return true;
  }

  /** Attributes that require a start tag, including a customized built-in's internal is value. */
  protected hasStartTagAttributes(): boolean {
    return this.hasAttributes() || this.isValue !== null;
  }

  /** Scan forward from the next sibling or a supplied node, skipping only empty text nodes. */
  protected nextContent(node: NodeImpl | null = this.nextSibling): NodeImpl | null {
    while (node?.isText() && node.length === 0) node = node.nextSibling;
    return node;
  }

  /** Find preceding sibling content without discarding whitespace or comments. */
  protected previousContent(): NodeImpl | null {
    let node = this.previousSibling;
    while (node?.isText() && node.length === 0) node = node.previousSibling;
    return node;
  }

  /** Whether the supplied content begins with ASCII whitespace or a comment. */
  protected startsWithWhitespaceOrComment(node: NodeImpl | null): boolean {
    return node !== null && (node.isComment() ||
      (node.isText() && asciiWhitespacePattern.test(node.data.charAt(0))));
  }

  protected override insertionSteps(): void {
    super.insertionSteps();
    this.#htmlOrSVGOrMathMLElementMixin.insertionSteps();
  }

  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#nonce-attributes
  protected override cloningSteps(copy: HTMLElementImpl, subtree: boolean): void {
    super.cloningSteps(copy, subtree);
    copy.nonce = this.nonce;
  }
}

/** Name/ID eligibility; name-or-id-with-name requires a nonempty name before an ID can match. */
export type DocumentNamedItemType = 'none' | 'name' | 'name-or-id' | 'name-or-id-with-name';
