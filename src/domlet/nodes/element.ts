import {
  withElementStub, withHTMLElementStub, withHTMLHeadElementStub,
  withHTMLLinkElementStub, withHTMLStyleElementStub, withMathMLElementStub,
  withSVGElementStub, withSVGStyleElementStub,
} from '../stubs/interfaces';
import { NodeImpl, NodeType } from './node';
import { AttrImpl } from './attribute';
import { NamedNodeMapImpl } from './collections';
import type { DocumentImpl } from './document';
import {
  ElementCSSInlineStyleMixin, LinkStyleMixin,
} from '../css-engine';
import {
  findElementsByClassName, findElementsByTagName, findElementsByTagNameNS,
} from './lookups';

export class ElementImpl
  extends withElementStub(NodeImpl)
  implements Element
{
  #wasCreatedByParser = false;
  #inlineStyle: ElementCSSInlineStyleMixin | undefined;
  protected readonly linkStyle: LinkStyleMixin | undefined = undefined;

  readonly nodeType = NodeType.Element;
  readonly attributes: NamedNodeMapImpl;

  constructor(
    readonly localName: string,
    readonly namespaceURI: string,
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super(ownerDocument);
    this.attributes = new NamedNodeMapImpl(...attributes);
  }

  get __wasCreatedByParser(): boolean {
    return this.#wasCreatedByParser;
  }

  __markAsParserCreated(): void {
    this.#wasCreatedByParser = true;
  }

  beginParsingChildren(): void {
    this.linkStyle?.beginParsingChildren();
  }

  finishParsingChildren(): void {
    this.linkStyle?.finishParsingChildren();
  }

  getAttribute(qualifiedName: string): string | null {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);

    return this.attributes.find(
      (attribute) => attribute.name === qualifiedName,
    )?.value ?? null;
  }

  getAttributeNS(namespaceURI: string | null, localName: string): string | null {
    namespaceURI = normalizeNamespace(namespaceURI);

    return this.attributes.find(
      (attribute) =>
        attribute.namespaceURI === namespaceURI &&
        attribute.localName === localName,
    )?.value ?? null;
  }

  hasAttribute(qualifiedName: string): boolean {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);

    return this.attributes.some(
      (attribute) => attribute.name === qualifiedName,
    );
  }

  hasAttributeNS(namespaceURI: string | null, localName: string): boolean {
    namespaceURI = normalizeNamespace(namespaceURI);

    return this.attributes.some(
      (attribute) =>
        attribute.namespaceURI === namespaceURI &&
        attribute.localName === localName,
    );
  }

  setAttribute(qualifiedName: string, value: string): void {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);

    const attribute = this.attributes.find(
      (candidate) => candidate.name === qualifiedName,
    );
    const oldValue = attribute?.value ?? null;

    if (attribute) {
      attribute.value = value;
    } else {
      this.attributes.push(new AttrImpl(qualifiedName, value));
    }

    if (qualifiedName === 'style') {
      this.#inlineStyle?.attributeChanged(value);
    }
    this.attributeChanged(qualifiedName, oldValue, value);
  }

  removeAttribute(qualifiedName: string): void {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);

    const index = this.attributes.findIndex(
      (attribute) => attribute.name === qualifiedName,
    );
    if (index < 0) return;

    const oldValue = this.attributes[index]!.value;
    this.attributes.splice(index, 1);
    if (qualifiedName === 'style') {
      this.#inlineStyle?.attributeChanged(null);
    }
    this.attributeChanged(qualifiedName, oldValue, null);
  }

  getElementsByClassName(
    classNames: string,
  ): HTMLCollectionOf<Element> {
    return findElementsByClassName(this, classNames);
  }

  getElementsByTagName<K extends keyof HTMLElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<HTMLElementTagNameMap[K]>;
  getElementsByTagName<K extends keyof SVGElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<SVGElementTagNameMap[K]>;
  getElementsByTagName<K extends keyof MathMLElementTagNameMap>(qualifiedName: K): HTMLCollectionOf<MathMLElementTagNameMap[K]>;
  /** @deprecated */
  getElementsByTagName<K extends keyof HTMLElementDeprecatedTagNameMap>(qualifiedName: K): HTMLCollectionOf<HTMLElementDeprecatedTagNameMap[K]>;
  getElementsByTagName(qualifiedName: string): HTMLCollectionOf<Element>;
  getElementsByTagName(
    qualifiedName: string,
  ): HTMLCollectionOf<Element> {
    return findElementsByTagName(this, qualifiedName);
  }

  getElementsByTagNameNS(namespaceURI: typeof HTML_NAMESPACE, localName: string): HTMLCollectionOf<HTMLElement>;
  getElementsByTagNameNS(namespaceURI: typeof SVG_NAMESPACE, localName: string): HTMLCollectionOf<SVGElement>;
  getElementsByTagNameNS(namespaceURI: typeof MATHML_NAMESPACE, localName: string): HTMLCollectionOf<MathMLElement>;
  getElementsByTagNameNS(namespaceURI: string | null, localName: string): HTMLCollectionOf<Element>;
  getElementsByTagNameNS(
    namespaceURI: string | null,
    localName: string,
  ): HTMLCollectionOf<Element> {
    return findElementsByTagNameNS(this, namespaceURI, localName);
  }

  protected attributeChanged(
    qualifiedName: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    this.linkStyle?.attributeChanged(qualifiedName);
  }

  protected insertedInto(): void {
    this.linkStyle?.update();
  }

  protected removedFrom(): void {
    this.linkStyle?.update();
  }

  protected childrenChanged(): void {
    this.linkStyle?.childrenChanged();
  }

  protected get inlineStyle(): CSSStyleDeclaration {
    return (this.#inlineStyle ??=
      new ElementCSSInlineStyleMixin(this)).style;
  }

  #normalizeAttributeName(qualifiedName: string): string {
    return this.namespaceURI === HTML_NAMESPACE
      ? asciiLower(qualifiedName)
      : qualifiedName;
  }
}

export class HTMLElementImpl
  extends withHTMLElementStub(ElementImpl)
  implements HTMLElement
{
  constructor(
    localName: string,
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super(localName, HTML_NAMESPACE, ownerDocument, attributes);
  }

  get style(): CSSStyleDeclaration {
    return this.inlineStyle;
  }
}

export class HTMLHeadElementImpl
  extends withHTMLHeadElementStub(HTMLElementImpl)
  implements HTMLHeadElement
{
  constructor(
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super('head', ownerDocument, attributes);
  }
}

export class HTMLStyleElementImpl
  extends withHTMLStyleElementStub(HTMLElementImpl)
  implements HTMLStyleElement
{
  static readonly #linkStyleBehavior = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  protected readonly linkStyle = new LinkStyleMixin(
    this,
    HTMLStyleElementImpl.#linkStyleBehavior,
  );

  constructor(
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super('style', ownerDocument, attributes);
  }

  get sheet(): CSSStyleSheet | null {
    return this.linkStyle.sheet;
  }
}

export class HTMLLinkElementImpl
  extends withHTMLLinkElementStub(HTMLElementImpl)
  implements HTMLLinkElement
{
  static readonly #linkStyleBehavior = {
    attributes: new Set([
      'crossorigin', 'href', 'integrity', 'media', 'referrerpolicy',
      'rel', 'title', 'type',
    ]),
  };

  protected readonly linkStyle = new LinkStyleMixin(
    this,
    HTMLLinkElementImpl.#linkStyleBehavior,
  );

  constructor(
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super('link', ownerDocument, attributes);
  }

  get sheet(): CSSStyleSheet | null {
    return this.linkStyle.sheet;
  }
}

export class SVGElementImpl
  extends withSVGElementStub(ElementImpl)
  implements SVGElement
{
  constructor(
    localName: string,
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super(localName, SVG_NAMESPACE, ownerDocument, attributes);
  }

  get style(): CSSStyleDeclaration {
    return this.inlineStyle;
  }
}

export class SVGStyleElementImpl
  extends withSVGStyleElementStub(SVGElementImpl)
  implements SVGStyleElement
{
  static readonly #linkStyleBehavior = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  protected readonly linkStyle = new LinkStyleMixin(
    this,
    SVGStyleElementImpl.#linkStyleBehavior,
  );

  constructor(
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super('style', ownerDocument, attributes);
  }

  get sheet(): CSSStyleSheet | null {
    return this.linkStyle.sheet;
  }
}

export class MathMLElementImpl
  extends withMathMLElementStub(ElementImpl)
  implements MathMLElement
{
  constructor(
    localName: string,
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super(localName, MATHML_NAMESPACE, ownerDocument, attributes);
  }

  get style(): CSSStyleDeclaration {
    return this.inlineStyle;
  }
}

export function createElementNode(localName: string, namespaceURI: typeof HTML_NAMESPACE, ownerDocument: DocumentImpl, attributes?: AttrImpl[]): HTMLElementImpl;
export function createElementNode(localName: string, namespaceURI: string, ownerDocument: DocumentImpl, attributes?: AttrImpl[]): ElementImpl;
export function createElementNode(
  localName: string,
  namespaceURI: string,
  ownerDocument: DocumentImpl,
  attributes: AttrImpl[] = [],
): ElementImpl {
  if (namespaceURI === HTML_NAMESPACE) {
    localName = asciiLower(localName);

    if (localName === 'head') {
      return new HTMLHeadElementImpl(ownerDocument, attributes);
    }

    if (localName === 'style') {
      return new HTMLStyleElementImpl(ownerDocument, attributes);
    }

    if (localName === 'link') {
      return new HTMLLinkElementImpl(ownerDocument, attributes);
    }

    return new HTMLElementImpl(localName, ownerDocument, attributes);
  }

  if (namespaceURI === SVG_NAMESPACE) {
    if (localName === 'style') {
      return new SVGStyleElementImpl(ownerDocument, attributes);
    }

    return new SVGElementImpl(localName, ownerDocument, attributes);
  }

  if (namespaceURI === MATHML_NAMESPACE) {
    return new MathMLElementImpl(localName, ownerDocument, attributes);
  }

  return new ElementImpl(localName, namespaceURI, ownerDocument, attributes);
}

export function isHTMLElement(
  element: Element,
): element is HTMLElementImpl {
  return element.namespaceURI === HTML_NAMESPACE;
}

export function isHTMLHeadElement(
  element: Element,
): element is HTMLHeadElementImpl {
  return isHTMLElement(element) && element.localName === 'head';
}

export function isHTMLStyleElement(
  element: Element,
): element is HTMLStyleElementImpl {
  return isHTMLElement(element) && element.localName === 'style';
}

export function isHTMLLinkElement(
  element: Element,
): element is HTMLLinkElementImpl {
  return isHTMLElement(element) && element.localName === 'link';
}

export function isSVGElement(
  element: Element,
): element is SVGElementImpl {
  return element.namespaceURI === SVG_NAMESPACE;
}

export function isSVGStyleElement(
  element: Element,
): element is SVGStyleElementImpl {
  return isSVGElement(element) && element.localName === 'style';
}

export function isMathMLElement(
  element: Element,
): element is MathMLElementImpl {
  return element.namespaceURI === MATHML_NAMESPACE;
}

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

function normalizeNamespace(namespaceURI: string | null): string | null {
  return namespaceURI === '' ? null : namespaceURI;
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
