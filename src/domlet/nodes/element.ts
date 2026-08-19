import {
  withElementStub, withHTMLElementStub, withHTMLHeadElementStub,
  withHTMLLinkElementStub, withHTMLStyleElementStub, withMathMLElementStub,
  withSVGElementStub, withSVGStyleElementStub,
} from '../stubs/interfaces';
import {
  isElement, NodeImpl, type NodeOptions, NodeType,
} from './node';
import { AttrImpl } from './attribute';
import { NamedNodeMapImpl } from './collections';
import type { DocumentImpl } from './document';
import type { DOMNodeFactory } from './factory';
import {
  elementCSSInlineStyleIDL, ElementCSSInlineStyleMixin,
  linkStyleIDL, LinkStyleMixin, type LinkStyleOptions,
  type TreeScopeResolver,
} from '../css-engine';
import {
  defineInterface, operation, readonlyAttribute,
} from '../../web-idl/binding';
import {
  findElementsByClassName, findElementsByTagName, findElementsByTagNameNS,
} from './lookups';
import {
  childNodeIDL, nodeIDL, nonDocumentTypeChildNodeIDL, parentNodeIDL,
} from './node';
import { SlottableMixin } from './slottable';

export const elementIDL = defineInterface({
  name: 'Element',
  parent: nodeIDL,
  exposed: ['Window'],
  includes: [parentNodeIDL, childNodeIDL, nonDocumentTypeChildNodeIDL],
  members: {
    namespaceURI: readonlyAttribute(),
    localName: readonlyAttribute(),
    attributes: readonlyAttribute(),
    getAttribute: operation(),
    getAttributeNS: operation(),
    getElementsByClassName: operation(),
    getElementsByTagName: operation(),
    getElementsByTagNameNS: operation(),
    hasAttribute: operation(),
    hasAttributeNS: operation(),
    setAttribute: operation(),
    removeAttribute: operation(),
  },
});

export const htmlElementIDL = defineInterface({
  name: 'HTMLElement',
  parent: elementIDL,
  exposed: ['Window'],
  includes: [elementCSSInlineStyleIDL],
});

export const htmlHeadElementIDL = defineInterface({
  name: 'HTMLHeadElement',
  parent: htmlElementIDL,
  exposed: ['Window'],
});

export const htmlStyleElementIDL = defineInterface({
  name: 'HTMLStyleElement',
  parent: htmlElementIDL,
  exposed: ['Window'],
  includes: [linkStyleIDL],
});

export const htmlLinkElementIDL = defineInterface({
  name: 'HTMLLinkElement',
  parent: htmlElementIDL,
  exposed: ['Window'],
  includes: [linkStyleIDL],
});

export const svgElementIDL = defineInterface({
  name: 'SVGElement',
  parent: elementIDL,
  exposed: ['Window'],
  includes: [elementCSSInlineStyleIDL],
});

export const svgStyleElementIDL = defineInterface({
  name: 'SVGStyleElement',
  parent: svgElementIDL,
  exposed: ['Window'],
  includes: [linkStyleIDL],
});

export const mathMLElementIDL = defineInterface({
  name: 'MathMLElement',
  parent: elementIDL,
  exposed: ['Window'],
  includes: [elementCSSInlineStyleIDL],
});

export class ElementImpl
  extends withElementStub(NodeImpl)
  implements Element
{
  #inlineStyle: ElementCSSInlineStyleMixin | undefined;
  readonly #linkStyle: LinkStyleMixin | undefined;
  readonly #attributes: NamedNodeMapImpl;
  readonly #localName: string;
  readonly #namespaceURI: string;
  readonly #slottable = new SlottableMixin();

  constructor(
    localName: string,
    namespaceURI: string,
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
    linkStyle?: LinkStyleInit,
  ) {
    super(NodeType.Element, ownerDocument, ElementImpl.#nodeOptions);
    this.#attributes = new NamedNodeMapImpl(...attributes);
    this.#localName = localName;
    this.#namespaceURI = namespaceURI;
    this.#linkStyle = linkStyle
      ? new LinkStyleMixin(
        this,
        linkStyle.options,
        linkStyle.treeScopeResolver,
      )
      : undefined;
  }

  get attributes(): NamedNodeMapImpl {
    return this.#attributes;
  }

  get localName(): string {
    return this.#localName;
  }

  get namespaceURI(): string {
    return this.#namespaceURI;
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
    this.#attributeChanged(qualifiedName, oldValue, value);
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
    this.#attributeChanged(qualifiedName, oldValue, null);
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

  // -- Virtual ----------------------------------------------------------

  static readonly #nodeOptions: NodeOptions = {
    eventTargetVirtuals: NodeImpl.createEventTargetVirtuals({
      getParent: (target, event) => NodeImpl.is(target) && isElement(target)
        ? ElementImpl.getEventParent(target, event)
        : null,
      getAssignedSlot: (target) => NodeImpl.is(target) && isElement(target)
        ? ElementImpl.getAssignedSlot(target)
        : null,
    }),
    treeVirtuals: {
      insertedInto: (node) => {
        (node as ElementImpl).#linkStyle?.update();
      },
      removedFrom: (node) => {
        (node as ElementImpl).#linkStyle?.update();
      },
      childrenChanged: (node) => {
        (node as ElementImpl).#linkStyle?.childrenChanged();
      },
    },
  };

  // -- Friends ----------------------------------------------------------

  static setAssignedSlot(
    element: ElementImpl,
    slot: ElementImpl | null,
  ): void {
    element.#slottable.setAssignedSlot(slot);
  }

  static getAssignedSlot(element: ElementImpl): ElementImpl | null {
    return element.#slottable.assignedSlot;
  }

  static getEventParent(
    element: ElementImpl,
    _event: Event,
  ): NodeImpl | null {
    return element.#slottable.assignedSlot ?? element.parentNode;
  }

  static beginParsingChildren(element: ElementImpl): void {
    element.#linkStyle?.beginParsingChildren();
  }

  static finishParsingChildren(element: ElementImpl): void {
    element.#linkStyle?.finishParsingChildren();
  }

  static getInlineStyle(element: ElementImpl): CSSStyleDeclaration {
    return (element.#inlineStyle ??=
      new ElementCSSInlineStyleMixin(element)).style;
  }

  static getStyleSheet(element: ElementImpl): CSSStyleSheet | null {
    return element.#linkStyle?.sheet ?? null;
  }

  // -- Private ----------------------------------------------------------

  #attributeChanged(
    qualifiedName: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    this.#linkStyle?.attributeChanged(qualifiedName);
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
    linkStyle?: LinkStyleInit,
  ) {
    super(
      localName,
      HTML_NAMESPACE,
      ownerDocument,
      attributes,
      linkStyle,
    );
  }

  get style(): CSSStyleDeclaration {
    return ElementImpl.getInlineStyle(this);
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
  static readonly #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  constructor(
    ownerDocument: DocumentImpl,
    treeScopeResolver: TreeScopeResolver,
    attributes: AttrImpl[] = [],
  ) {
    super(
      'style',
      ownerDocument,
      attributes,
      {
        options: HTMLStyleElementImpl.#linkStyleOptions,
        treeScopeResolver,
      },
    );
  }

  get sheet(): CSSStyleSheet | null {
    return ElementImpl.getStyleSheet(this);
  }
}

export class HTMLLinkElementImpl
  extends withHTMLLinkElementStub(HTMLElementImpl)
  implements HTMLLinkElement
{
  static readonly #linkStyleOptions = {
    attributes: new Set([
      'crossorigin', 'href', 'integrity', 'media', 'referrerpolicy',
      'rel', 'title', 'type',
    ]),
  };

  constructor(
    ownerDocument: DocumentImpl,
    treeScopeResolver: TreeScopeResolver,
    attributes: AttrImpl[] = [],
  ) {
    super(
      'link',
      ownerDocument,
      attributes,
      {
        options: HTMLLinkElementImpl.#linkStyleOptions,
        treeScopeResolver,
      },
    );
  }

  get sheet(): CSSStyleSheet | null {
    return ElementImpl.getStyleSheet(this);
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
    linkStyle?: LinkStyleInit,
  ) {
    super(
      localName,
      SVG_NAMESPACE,
      ownerDocument,
      attributes,
      linkStyle,
    );
  }

  get style(): CSSStyleDeclaration {
    return ElementImpl.getInlineStyle(this);
  }
}

export class SVGStyleElementImpl
  extends withSVGStyleElementStub(SVGElementImpl)
  implements SVGStyleElement
{
  static readonly #linkStyleOptions = {
    attributes: new Set(['media', 'title', 'type']),
    children: true,
  };

  constructor(
    ownerDocument: DocumentImpl,
    treeScopeResolver: TreeScopeResolver,
    attributes: AttrImpl[] = [],
  ) {
    super(
      'style',
      ownerDocument,
      attributes,
      {
        options: SVGStyleElementImpl.#linkStyleOptions,
        treeScopeResolver,
      },
    );
  }

  get sheet(): CSSStyleSheet | null {
    return ElementImpl.getStyleSheet(this);
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
    return ElementImpl.getInlineStyle(this);
  }
}

export function createElementNode(localName: string, namespaceURI: typeof HTML_NAMESPACE, ownerDocument: DocumentImpl, treeScopeResolver: TreeScopeResolver, attributes: AttrImpl[], nodeFactory: DOMNodeFactory): HTMLElementImpl;
export function createElementNode(localName: string, namespaceURI: string, ownerDocument: DocumentImpl, treeScopeResolver: TreeScopeResolver, attributes: AttrImpl[], nodeFactory: DOMNodeFactory): ElementImpl;
export function createElementNode(
  localName: string,
  namespaceURI: string,
  ownerDocument: DocumentImpl,
  treeScopeResolver: TreeScopeResolver,
  attributes: AttrImpl[],
  nodeFactory: DOMNodeFactory,
): ElementImpl {
  if (namespaceURI === HTML_NAMESPACE) {
    localName = asciiLower(localName);

    if (localName === 'head') {
      return nodeFactory.construct(
        HTMLHeadElementImpl,
        [ownerDocument, attributes],
      );
    }

    if (localName === 'style') {
      return nodeFactory.construct(
        HTMLStyleElementImpl,
        [ownerDocument, treeScopeResolver, attributes],
      );
    }

    if (localName === 'link') {
      return nodeFactory.construct(
        HTMLLinkElementImpl,
        [ownerDocument, treeScopeResolver, attributes],
      );
    }

    return nodeFactory.construct(
      HTMLElementImpl,
      [localName, ownerDocument, attributes],
    );
  }

  if (namespaceURI === SVG_NAMESPACE) {
    if (localName === 'style') {
      return nodeFactory.construct(
        SVGStyleElementImpl,
        [ownerDocument, treeScopeResolver, attributes],
      );
    }

    return nodeFactory.construct(
      SVGElementImpl,
      [localName, ownerDocument, attributes],
    );
  }

  if (namespaceURI === MATHML_NAMESPACE) {
    return nodeFactory.construct(
      MathMLElementImpl,
      [localName, ownerDocument, attributes],
    );
  }

  return nodeFactory.construct(
    ElementImpl,
    [localName, namespaceURI, ownerDocument, attributes],
  );
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

type LinkStyleInit = {
  readonly options: LinkStyleOptions;
  readonly treeScopeResolver: TreeScopeResolver;
};
