import { withElementStub } from '../../stubs';
import {
  isElement, NodeImpl, type NodeOptions, NodeType,
} from './node';
import { AttrImpl } from './attribute';
import { NamedNodeMapImpl } from './named-node-map';
import type { DocumentImpl } from './document';
import {
  ElementCSSInlineStyleMixin, LinkStyleMixin, type LinkStyleOptions,
  type TreeScopeResolver,
} from '../../style/integration';
import {
  arg, defineIncludes, defineInterface, idlType, nullable, op,
  readonlyAttr,
} from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import {
  HTML_NAMESPACE, type MATHML_NAMESPACE, type SVG_NAMESPACE,
} from '../../../shared/namespaces';
import { asciiLower } from '../../../shared/css';
import {
  findElementsByClassName, findElementsByTagName, findElementsByTagNameNS,
} from './lookups';
import {
  childNodeIDL, nonDocumentTypeChildNodeIDL, parentNodeIDL,
} from './node';
import { SlottableMixin } from './slottable';

/*
 * [Exposed=Window]
 * interface Element : Node {
 *   readonly attribute DOMString? namespaceURI;
 *   readonly attribute DOMString? prefix;
 *   readonly attribute DOMString localName;
 *   readonly attribute DOMString tagName;
 *
 *   [CEReactions] attribute DOMString id;
 *   [CEReactions] attribute DOMString className;
 *   [SameObject, PutForwards=value] readonly attribute DOMTokenList classList;
 *   [CEReactions, Unscopable] attribute DOMString slot;
 *
 *   boolean hasAttributes();
 *   [SameObject] readonly attribute NamedNodeMap attributes;
 *   sequence<DOMString> getAttributeNames();
 *   DOMString? getAttribute(DOMString qualifiedName);
 *   DOMString? getAttributeNS(DOMString? namespace, DOMString localName);
 *   [CEReactions] undefined setAttribute(DOMString qualifiedName, (TrustedType or DOMString) value);
 *   [CEReactions] undefined setAttributeNS(DOMString? namespace, DOMString qualifiedName, (TrustedType or DOMString) value);
 *   [CEReactions] undefined removeAttribute(DOMString qualifiedName);
 *   [CEReactions] undefined removeAttributeNS(DOMString? namespace, DOMString localName);
 *   [CEReactions] boolean toggleAttribute(DOMString qualifiedName, optional boolean force);
 *   boolean hasAttribute(DOMString qualifiedName);
 *   boolean hasAttributeNS(DOMString? namespace, DOMString localName);
 *
 *   Attr? getAttributeNode(DOMString qualifiedName);
 *   Attr? getAttributeNodeNS(DOMString? namespace, DOMString localName);
 *   [CEReactions] Attr? setAttributeNode(Attr attr);
 *   [CEReactions] Attr? setAttributeNodeNS(Attr attr);
 *   [CEReactions] Attr removeAttributeNode(Attr attr);
 *
 *   ShadowRoot attachShadow(ShadowRootInit init);
 *   readonly attribute ShadowRoot? shadowRoot;
 *
 *   readonly attribute CustomElementRegistry? customElementRegistry;
 *
 *   Element? closest(DOMString selectors);
 *   boolean matches(DOMString selectors);
 *   boolean webkitMatchesSelector(DOMString selectors); // legacy alias of .matches
 *
 *   HTMLCollection getElementsByTagName(DOMString qualifiedName);
 *   HTMLCollection getElementsByTagNameNS(DOMString? namespace, DOMString localName);
 *   HTMLCollection getElementsByClassName(DOMString classNames);
 *
 *   [CEReactions] Element? insertAdjacentElement(DOMString where, Element element); // legacy
 *   undefined insertAdjacentText(DOMString where, DOMString data); // legacy
 * };
 */
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
    NamedNodeMapImpl.associateElement(this.#attributes, this);
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
      const ownerDocument = NodeImpl.getNodeDocument(this);
      if (!ownerDocument) {
        throw new Error('Element has no node document');
      }
      const created = ownerDocument.createAttribute(qualifiedName);
      created.value = value;
      AttrImpl.setOwnerElement(created, this);
      this.attributes.push(created);
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
    const [removed] = this.attributes.splice(index, 1);
    if (removed) AttrImpl.setOwnerElement(removed, null);
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
    return element.#slottable.assignedSlot ?? NodeImpl.getParentNode(element);
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

// -- Web IDL ------------------------------------------------------------

export const elementIDL = defineInterface({
  binding: bind(ElementImpl),
  exposed: 'Window',
  inherits: 'Node',
  members: [
    readonlyAttr('namespaceURI', nullable(idlType.DOMString)),
    readonlyAttr('localName', idlType.DOMString),
    readonlyAttr('attributes', idlType.object),
    op('getAttribute', nullable(idlType.DOMString), [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('getAttributeNS', nullable(idlType.DOMString), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('getElementsByClassName', idlType.object, [
      arg('classNames', idlType.DOMString),
    ]),
    op('getElementsByTagName', idlType.object, [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('getElementsByTagNameNS', idlType.object, [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('hasAttribute', idlType.boolean, [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('hasAttributeNS', idlType.boolean, [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('setAttribute', idlType.undefined, [
      arg('qualifiedName', idlType.DOMString),
      arg('value', idlType.DOMString),
    ]),
    op('removeAttribute', idlType.undefined, [
      arg('qualifiedName', idlType.DOMString),
    ]),
  ],
  name: 'Element',
});

/*
 * Element includes ParentNode;
 */
export const elementIncludesParentNodeIDL = defineIncludes({
  interface: 'Element', mixin: parentNodeIDL.name,
});

/*
 * Element includes ChildNode;
 */
export const elementIncludesChildNodeIDL = defineIncludes({
  interface: 'Element', mixin: childNodeIDL.name,
});

/*
 * Element includes NonDocumentTypeChildNode;
 */
export const elementIncludesNonDocumentTypeChildNodeIDL = defineIncludes({
  interface: 'Element', mixin: nonDocumentTypeChildNodeIDL.name,
});

export function isHTMLElement(
  element: Element,
): element is HTMLElement {
  return element.namespaceURI === HTML_NAMESPACE;
}

export function isHTMLHeadElement(
  element: Element,
): element is HTMLHeadElement {
  return isHTMLElement(element) && element.localName === 'head';
}

function normalizeNamespace(namespaceURI: string | null): string | null {
  return namespaceURI === '' ? null : namespaceURI;
}

export type LinkStyleInit = {
  readonly options: LinkStyleOptions;
  readonly treeScopeResolver: TreeScopeResolver;
};
