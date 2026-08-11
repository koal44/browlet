import { Node, NodeType } from './node';
import { Attribute } from './attribute';
import type { Document } from './document';
import { LinkStyleState } from '../css-engine';
import {
  findElementsByClassName, findElementsByTagName, findElementsByTagNameNS,
} from './lookups';

export class Element extends Node {
  readonly nodeType = NodeType.Element;

  constructor(
    readonly localName: string,
    readonly namespaceURI: string,
    readonly attributes: Attribute[] = [],
    ownerDocument: Document | null = null,
  ) {
    super(ownerDocument);
  }

  beginParsingChildren(): void {}

  finishParsingChildren(): void {}

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
      this.attributes.push(new Attribute(qualifiedName, value));
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
    this.attributeChanged(qualifiedName, oldValue, null);
  }

  getElementsByClassName(classNames: string): Element[] {
    return findElementsByClassName(this, classNames);
  }

  getElementsByTagName(qualifiedName: string): Element[] {
    return findElementsByTagName(this, qualifiedName);
  }

  getElementsByTagNameNS(
    namespaceURI: string | null,
    localName: string,
  ): Element[] {
    return findElementsByTagNameNS(this, namespaceURI, localName);
  }

  protected attributeChanged(
    _qualifiedName: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {}

  #normalizeAttributeName(qualifiedName: string): string {
    return this.namespaceURI === HTML_NAMESPACE
      ? asciiLower(qualifiedName)
      : qualifiedName;
  }
}

export class HTMLElement extends Element {
  constructor(
    localName: string,
    attributes: Attribute[] = [],
    ownerDocument: Document | null = null,
  ) {
    super(localName, HTML_NAMESPACE, attributes, ownerDocument);
  }
}

export class HTMLStyleElement extends HTMLElement {
  readonly #linkStyle = new LinkStyleState(this);

  constructor(
    attributes: Attribute[] = [],
    ownerDocument: Document | null = null,
  ) {
    super('style', attributes, ownerDocument);
  }

  get sheet(): CSSStyleSheet | null {
    return this.#linkStyle.sheet;
  }

  beginParsingChildren(): void {
    this.#linkStyle.defer();
  }

  finishParsingChildren(): void {
    this.#linkStyle.finish();
  }

  protected insertedInto(): void {
    this.#linkStyle.update();
  }

  protected removedFrom(): void {
    this.#linkStyle.update();
  }

  protected childrenChanged(): void {
    this.#linkStyle.update();
  }

  protected attributeChanged(qualifiedName: string): void {
    if (styleElementAttributes.has(qualifiedName)) {
      this.#linkStyle.update();
    }
  }
}

export class HTMLLinkElement extends HTMLElement {
  readonly #linkStyle = new LinkStyleState(this);

  constructor(
    attributes: Attribute[] = [],
    ownerDocument: Document | null = null,
  ) {
    super('link', attributes, ownerDocument);
  }

  get sheet(): CSSStyleSheet | null {
    return this.#linkStyle.sheet;
  }

  protected insertedInto(): void {
    this.#linkStyle.update();
  }

  protected removedFrom(): void {
    this.#linkStyle.update();
  }

  protected attributeChanged(qualifiedName: string): void {
    if (linkElementAttributes.has(qualifiedName)) {
      this.#linkStyle.update();
    }
  }
}

export class SVGElement extends Element {
  constructor(
    localName: string,
    attributes: Attribute[] = [],
    ownerDocument: Document | null = null,
  ) {
    super(localName, SVG_NAMESPACE, attributes, ownerDocument);
  }
}

export class SVGStyleElement extends SVGElement {
  readonly #linkStyle = new LinkStyleState(this);

  constructor(
    attributes: Attribute[] = [],
    ownerDocument: Document | null = null,
  ) {
    super('style', attributes, ownerDocument);
  }

  get sheet(): CSSStyleSheet | null {
    return this.#linkStyle.sheet;
  }

  beginParsingChildren(): void {
    this.#linkStyle.defer();
  }

  finishParsingChildren(): void {
    this.#linkStyle.finish();
  }

  protected insertedInto(): void {
    this.#linkStyle.update();
  }

  protected removedFrom(): void {
    this.#linkStyle.update();
  }

  protected childrenChanged(): void {
    this.#linkStyle.update();
  }

  protected attributeChanged(qualifiedName: string): void {
    if (styleElementAttributes.has(qualifiedName)) {
      this.#linkStyle.update();
    }
  }
}

export class MathMLElement extends Element {
  constructor(
    localName: string,
    attributes: Attribute[] = [],
    ownerDocument: Document | null = null,
  ) {
    super(localName, MATHML_NAMESPACE, attributes, ownerDocument);
  }
}

export function createElementNode(
  localName: string,
  namespaceURI: string,
  attributes: Attribute[] = [],
  ownerDocument: Document | null = null,
): Element {
  if (namespaceURI === HTML_NAMESPACE) {
    localName = asciiLower(localName);

    if (localName === 'style') {
      return new HTMLStyleElement(attributes, ownerDocument);
    }

    if (localName === 'link') {
      return new HTMLLinkElement(attributes, ownerDocument);
    }

    return new HTMLElement(localName, attributes, ownerDocument);
  }

  if (namespaceURI === SVG_NAMESPACE) {
    if (localName === 'style') {
      return new SVGStyleElement(attributes, ownerDocument);
    }

    return new SVGElement(localName, attributes, ownerDocument);
  }

  if (namespaceURI === MATHML_NAMESPACE) {
    return new MathMLElement(localName, attributes, ownerDocument);
  }

  return new Element(localName, namespaceURI, attributes, ownerDocument);
}

export function isHTMLElement(element: Element): element is HTMLElement {
  return element.namespaceURI === HTML_NAMESPACE;
}

export function isHTMLStyleElement(
  element: Element,
): element is HTMLStyleElement {
  return isHTMLElement(element) && element.localName === 'style';
}

export function isHTMLLinkElement(
  element: Element,
): element is HTMLLinkElement {
  return isHTMLElement(element) && element.localName === 'link';
}

export function isSVGElement(element: Element): element is SVGElement {
  return element.namespaceURI === SVG_NAMESPACE;
}

export function isSVGStyleElement(
  element: Element,
): element is SVGStyleElement {
  return isSVGElement(element) && element.localName === 'style';
}

export function isMathMLElement(element: Element): element is MathMLElement {
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

const styleElementAttributes = new Set(['media', 'title', 'type']);
const linkElementAttributes = new Set([
  'crossorigin', 'href', 'integrity', 'media', 'referrerpolicy',
  'rel', 'title', 'type',
]);
