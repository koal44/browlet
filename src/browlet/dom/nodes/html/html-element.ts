import {
  asciiWhitespacePattern, firstStrongDirection, getContainedTextDirection, normalizeNewlines, type TextDirection,
} from '../../../../infra/index';
import { InternalError } from '../../../../infra/internal-error';
import type { CSSDeclarationBlock, CSSStylePropertiesImpl } from '../../../../stylelet/index';

import { ContentCategory, type ElementSanitization } from '../element-definitions/index';
import { ElementCSSInlineStyleMixin } from '../../../style/index';
import { dirAttribute, isGlobalContentAttribute, translateAttribute } from './attributes/index';

import { ElementImpl } from '../element';
import type { NodeImpl } from '../node';
import type { AttrImpl } from '../attribute';
import { HTMLOrSVGOrMathMLElementMixin } from '../html-or-svg-or-mathml-element';

/** Base implementation for elements in the HTML namespace. */
// https://html.spec.whatwg.org/multipage/dom.html#htmlelement
export class HTMLElementImpl extends ElementImpl {
  static {
    this.prototype.isAllNamedElement = false;
    // Localization must set lang to the target language and recursively process style as CSS.
    this.prototype.translatableAttributes = [...this.prototype.translatableAttributes, 'lang', 'style', 'title'];
    this.prototype.directionalityAttributes = ['title'];
    this.prototype.excludeFromAutoDirection = false;
  }

  /** Fixed eligibility for name-based document.all lookup; ID lookup does not use this flag. */
  // https://html.spec.whatwg.org/#all-named-elements
  declare isAllNamedElement: boolean;

  /** Attribute names shared through the prototype; undefined means unfinished, [] means globals only. */
  declare contentAttributes?: string[];

  /** Sanitizer facts shared through the prototype; undefined means the inventory is unfinished. */
  declare sanitization?: ElementSanitization;

  /** Shared names whose rendered values determine their own direction when dir is auto. */
  declare directionalityAttributes: string[];

  /** Whether an ancestor's auto-direction scan always skips this element and its descendants. */
  declare protected excludeFromAutoDirection: boolean;

  /** Common HTML, SVG, and MathML state and attribute behavior. */
  #htmlOrSVGOrMathMLElementMixin = new HTMLOrSVGOrMathMLElementMixin(this);
  /** Owns inline declarations independently of the lazily created CSSOM object. */
  #inlineStyleMixin = new ElementCSSInlineStyleMixin(this, this.env);

  static is(value: unknown): value is HTMLElementImpl {
    return value instanceof HTMLElementImpl;
  }

  /** Inherited translation mode; assigning it writes an explicit yes or no attribute. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-translate
  get translate(): boolean { return this.isTranslationEnabled(); }
  set translate(value: boolean) { this.setAttributeValue('translate', value ? 'yes' : 'no'); }

  /** Reflect dir using only its known keywords; assignment preserves the supplied attribute text. */
  // https://html.spec.whatwg.org/multipage/dom.html#dom-dir
  get dir(): string { return dirAttribute.getState(this.getAttributeNS(null, 'dir')) ?? ''; }
  set dir(value: string) { this.setAttributeValue('dir', value); }

  /** Cryptographic nonce exposed to script, independently of the content attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#dom-noncedelement-nonce
  get nonce(): string { return this.#htmlOrSVGOrMathMLElementMixin.nonce; }
  set nonce(value: string) { this.#htmlOrSVGOrMathMLElementMixin.nonce = value; }

  get style(): CSSStylePropertiesImpl {
    return this.#inlineStyleMixin.style;
  }

  override getInlineStyleBlock(): CSSDeclarationBlock | null {
    return this.#inlineStyleMixin.getInlineStyleBlock();
  }

  override isTranslationEnabled(): boolean {
    const state = translateAttribute.getState(this.getAttributeNS(null, 'translate'));
    return state === 'inherit' ? super.isTranslationEnabled() : state === 'yes';
  }

  /** Resolve explicit, automatic, or inherited HTML directionality from current DOM state. */
  // https://html.spec.whatwg.org/multipage/dom.html#the-directionality
  override getDirectionality(): TextDirection {
    const state = this.dir;
    if (state === 'ltr' || state === 'rtl') return state;
    if (state === 'auto') return this.getAutoDirection() ?? 'ltr';
    return this.getDefaultDirection();
  }

  override isAutoDirectionalityBoundary(): boolean {
    return this.excludeFromAutoDirection || this.dir !== '';
  }

  /** Determine the rendering direction of an attribute belonging to this element. */
  // https://html.spec.whatwg.org/multipage/dom.html#directionality-of-the-attribute
  getAttributeDirectionality(attribute: AttrImpl): TextDirection {
    if (this.dir === 'auto' && attribute.namespaceURI === null &&
      this.isDirectionalityCapableAttributeName(attribute.localName)) {
      return firstStrongDirection(attribute.value) ?? 'ltr';
    }
    return this.getDirectionality();
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
   * Recognizes globals even when the element-specific inventory is unfinished.
   * Throws when a required inventory or attribute-family rule is unfinished.
   */
  // https://html.spec.whatwg.org/multipage/dom.html#concept-element-attributes
  allowsContentAttribute(name: string): boolean {
    if (isGlobalContentAttribute(name)) return true;
    // HTML compatibility spellings; required values and companion attributes are separate checks.
    if (name === 'xmlns' || name === 'xml:lang') return this.nodeDocument.type === 'html';
    if (name === 'role' || name.startsWith('aria-')) {
      // TODO: ARIA in HTML owns the permitted roles, states, and properties for each element.
      // https://www.w3.org/TR/html-aria/
      throw new InternalError('ARIA content-attribute permissions are not implemented');
    }
    const attributes = this.contentAttributes;
    if (attributes === undefined) {
      throw new InternalError(`Content attributes for ${this.localName} are not implemented`);
    }
    if (attributes.includes(name)) return this.allowsListedContentAttribute(name);
    if (name.startsWith('on')) {
      // TODO: Element-specific Window handlers and other standards add names beyond HTML's globals.
      throw new InternalError(`Event-handler content-attribute permissions for ${name} are not implemented`);
    }
    return false;
  }

  /**
   * Advisory text from this element or its HTML ancestors in the flat tree.
   * An empty title stops inheritance. Normalizes newlines without changing the attribute.
   * Element-specific uses of title, such as stylesheet names, read their own attributes.
   */
  // https://html.spec.whatwg.org/multipage/dom.html#advisory-information
  getAdvisoryInformation(): string {
    // SPEC_CLASH(title-shadow-ancestry): Follow browsers' flat-tree ancestry instead of HTML's ordinary parents.
    // https://github.com/whatwg/html/issues/13035
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Mutable ancestor cursor starts at this element.
    for (let node: NodeImpl | null = this; node !== null; node = node.getFlatTreeParent()) {
      if (!(node instanceof HTMLElementImpl)) continue;
      const information = node.getOwnAdvisoryInformation();
      if (information !== null) return information;
    }
    return '';
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
    if (localName === 'style' && namespace === null) this.#inlineStyleMixin.attributeChanged(newValue);
    this.#htmlOrSVGOrMathMLElementMixin.attributeChanged(localName, newValue, namespace);
  }

  /** Default direction for an absent or invalid dir attribute; bdi and telephone inputs specialize it. */
  protected getDefaultDirection(): TextDirection {
    return super.getDirectionality();
  }

  /** First eligible text direction; controls and assigned slots specialize the source of text. */
  // https://html.spec.whatwg.org/multipage/dom.html#auto-directionality
  protected getAutoDirection(): TextDirection | null {
    return getContainedTextDirection(this, false, this.env.userAgent.dom);
  }

  /** Classify a namespace-less attribute independently of its value or the element's direction. */
  protected isDirectionalityCapableAttributeName(name: string): boolean {
    return this.directionalityAttributes.includes(name);
  }

  /** Own normalized advisory text; null permits inheritance, while an empty string stops it. */
  protected getOwnAdvisoryInformation(): string | null {
    const title = this.getAttributeNS(null, 'title');
    return title === null ? null : normalizeNewlines(title);
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
