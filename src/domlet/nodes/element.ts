import {
  withElementStub, withHTMLElementStub, withHTMLHeadElementStub,
  withHTMLLinkElementStub, withHTMLStyleElementStub, withMathMLElementStub,
  withSVGElementStub, withSVGStyleElementStub,
} from '../stubs/interfaces';
import {
  isElement, NodeImpl, type NodeOptions, NodeType,
} from './node';
import { AttrImpl } from './attribute';
import { NamedNodeMapImpl } from './named-node-map';
import type { DocumentImpl } from './document';
import {
  ElementCSSInlineStyleMixin, LinkStyleMixin, type LinkStyleOptions,
  type TreeScopeResolver,
} from '../css-engine';
import {
  arg, defineIncludes, defineInterface, idlType, nullable, op,
  readonlyAttr,
} from '../../web-idl/adapter/definition';
import { bind } from '../../web-idl/adapter/projection';
import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../../shared/namespaces';
import { asciiLower } from '../../shared/css';
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

/*
 * [Exposed=Window]
 * interface HTMLElement : Element {
 *   [HTMLConstructor] constructor();
 *
 *   // metadata attributes
 *   [CEReactions, Reflect] attribute DOMString title;
 *   [CEReactions, Reflect] attribute DOMString lang;
 *   [CEReactions] attribute boolean translate;
 *   [CEReactions] attribute DOMString dir;
 *
 *   // user interaction
 *   [CEReactions] attribute (boolean or unrestricted double or DOMString)? hidden;
 *   [CEReactions, Reflect] attribute boolean inert;
 *   undefined click();
 *   [CEReactions, Reflect] attribute DOMString accessKey;
 *   readonly attribute DOMString accessKeyLabel;
 *   [CEReactions] attribute boolean draggable;
 *   [CEReactions] attribute boolean spellcheck;
 *   [CEReactions, ReflectSetter] attribute DOMString writingSuggestions;
 *   [CEReactions, ReflectSetter] attribute DOMString autocapitalize;
 *   [CEReactions] attribute boolean autocorrect;
 *
 *   [CEReactions] attribute [LegacyNullToEmptyString] DOMString innerText;
 *   [CEReactions] attribute [LegacyNullToEmptyString] DOMString outerText;
 *
 *   ElementInternals attachInternals();
 *
 *   // The popover API
 *   undefined showPopover(optional ShowPopoverOptions options = {});
 *   undefined hidePopover();
 *   boolean togglePopover(optional (TogglePopoverOptions or boolean) options = {});
 *   [CEReactions] attribute DOMString? popover;
 *
 *   [CEReactions, Reflect, ReflectRange=(0, 8)] attribute unsigned long headingOffset;
 *   [CEReactions, Reflect] attribute boolean headingReset;
 * };
 * HTMLElement includes GlobalEventHandlers;
 * HTMLElement includes ElementContentEditable;
 * HTMLElement includes HTMLOrSVGOrMathMLElement;
 */
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

// -- Web IDL ------------------------------------------------------------

export const htmlElementIDL = defineInterface({
  binding: bind(HTMLElementImpl),
  exposed: 'Window',
  inherits: 'Element',
  members: [],
  name: 'HTMLElement',
});

/*
 * HTMLElement includes ElementCSSInlineStyle;
 */
export const htmlElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'HTMLElement', mixin: 'ElementCSSInlineStyle',
});

/*
 * [Exposed=Window]
 * interface HTMLHeadElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
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

// -- Web IDL ------------------------------------------------------------

export const htmlHeadElementIDL = defineInterface({
  binding: bind(HTMLHeadElementImpl),
  exposed: 'Window',
  inherits: 'HTMLElement',
  members: [],
  name: 'HTMLHeadElement',
});

/*
 * [Exposed=Window]
 * interface HTMLStyleElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   attribute boolean disabled;
 *   [CEReactions, Reflect] attribute DOMString media;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList blocking;
 *
 *   // also has obsolete members
 * };
 * HTMLStyleElement includes LinkStyle;
 */
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

// -- Web IDL ------------------------------------------------------------

export const htmlStyleElementIDL = defineInterface({
  binding: bind(HTMLStyleElementImpl),
  exposed: 'Window',
  inherits: 'HTMLElement',
  members: [],
  name: 'HTMLStyleElement',
});

export const htmlStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLStyleElement', mixin: 'LinkStyle',
});

/*
 * [Exposed=Window]
 * interface HTMLLinkElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString href;
 *   [CEReactions] attribute DOMString? crossOrigin;
 *   [CEReactions, Reflect] attribute DOMString rel;
 *   [CEReactions] attribute DOMString as;
 *   [SameObject, PutForwards=value, Reflect="rel"] readonly attribute DOMTokenList relList;
 *   [CEReactions, Reflect] attribute DOMString media;
 *   [CEReactions, Reflect] attribute DOMString integrity;
 *   [CEReactions, Reflect] attribute DOMString hreflang;
 *   [CEReactions, Reflect] attribute DOMString type;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList sizes;
 *   [CEReactions, Reflect] attribute USVString imageSrcset;
 *   [CEReactions, Reflect] attribute DOMString imageSizes;
 *   [CEReactions] attribute DOMString referrerPolicy;
 *   [SameObject, PutForwards=value, Reflect] readonly attribute DOMTokenList blocking;
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   [CEReactions] attribute DOMString fetchPriority;
 *
 *   // also has obsolete members
 * };
 * HTMLLinkElement includes LinkStyle;
 */
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

// -- Web IDL ------------------------------------------------------------

export const htmlLinkElementIDL = defineInterface({
  binding: bind(HTMLLinkElementImpl),
  exposed: 'Window',
  inherits: 'HTMLElement',
  members: [],
  name: 'HTMLLinkElement',
});

export const htmlLinkElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'HTMLLinkElement', mixin: 'LinkStyle',
});

/*
 * [Exposed=Window]
 * interface SVGElement : Element {
 *   [SameObject] readonly attribute SVGAnimatedString className;
 *
 *   readonly attribute SVGSVGElement? ownerSVGElement;
 *   readonly attribute SVGElement? viewportElement;
 * };
 * SVGElement includes GlobalEventHandlers;
 * SVGElement includes SVGElementInstance;
 * SVGElement includes HTMLOrSVGElement;
 */
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

// -- Web IDL ------------------------------------------------------------

export const svgElementIDL = defineInterface({
  binding: bind(SVGElementImpl),
  exposed: 'Window',
  inherits: 'Element',
  members: [],
  name: 'SVGElement',
});

/*
 * SVGElement includes ElementCSSInlineStyle;
 */
export const svgElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'SVGElement', mixin: 'ElementCSSInlineStyle',
});

/*
 * [Exposed=Window]
 * interface SVGStyleElement : SVGElement {
 *   attribute DOMString type;
 *   attribute DOMString media;
 *   attribute DOMString title;
 *   attribute boolean disabled;
 * };
 * SVGStyleElement includes LinkStyle;
 */
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

// -- Web IDL ------------------------------------------------------------

export const svgStyleElementIDL = defineInterface({
  binding: bind(SVGStyleElementImpl),
  exposed: 'Window',
  inherits: 'SVGElement',
  members: [],
  name: 'SVGStyleElement',
});

export const svgStyleElementIncludesLinkStyleIDL = defineIncludes({
  interface: 'SVGStyleElement', mixin: 'LinkStyle',
});

/*
 * [Exposed=Window]
 * interface MathMLElement : Element { };
 * MathMLElement includes GlobalEventHandlers;
 */
export class MathMLElementImpl
  extends withMathMLElementStub(ElementImpl)
  implements MathMLElement
{
  constructor(
    localName: string,
    ownerDocument: DocumentImpl,
    attributes: AttrImpl[] = [],
  ) {
    super(
      localName,
      MATHML_NAMESPACE,
      ownerDocument,
      attributes,
      undefined,
    );
  }

  get style(): CSSStyleDeclaration {
    return ElementImpl.getInlineStyle(this);
  }
}

// -- Web IDL ------------------------------------------------------------

export const mathMLElementIDL = defineInterface({
  binding: bind(MathMLElementImpl),
  exposed: 'Window',
  inherits: 'Element',
  members: [],
  name: 'MathMLElement',
});

/*
 * MathMLElement includes ElementCSSInlineStyle;
 */
export const mathMLElementIncludesElementCSSInlineStyleIDL = defineIncludes({
  interface: 'MathMLElement', mixin: 'ElementCSSInlineStyle',
});

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

function normalizeNamespace(namespaceURI: string | null): string | null {
  return namespaceURI === '' ? null : namespaceURI;
}

type LinkStyleInit = {
  readonly options: LinkStyleOptions;
  readonly treeScopeResolver: TreeScopeResolver;
};
