import type { EventImpl } from '../events/event';
import { NodeImpl, NodeType } from './node';
import type { AttrImpl } from './attribute';
import { NamedNodeMapImpl } from './named-node-map';
import type { DocumentImpl } from './document';
import type { Environment } from '../../scripting/environment';
import type { CSSStyleSheetImpl, CSSStyleDeclarationImpl } from '../../../stylelet/index';
import type { HTMLCollectionImpl } from './collections';
import {
  ElementCSSInlineStyleMixin, type LinkStyleMixin, type TreeScopeResolver,
} from '../../style/integration';
import {
  arg, defineIncludes, defineInterface, idlType, impl, nullable, op, reference, roAttr, xattr,
  type InterfaceDefinition,
} from '../../../web-idl/index';
import { HTML_NAMESPACE } from '../../../infra/index';
import { asciiLower } from '../../../infra/ascii';
import {
  findElementsByClassName, findElementsByTagName, findElementsByTagNameNS,
} from './lookups';
import {
  ChildNodeMixin, childNodeIDL,
} from './child-node';
import {
  NonDocumentTypeChildNodeMixin, nonDocumentTypeChildNodeIDL,
} from './non-document-type-child-node';
import { ParentNodeMixin, parentNodeIDL } from './parent-node';
import { SlottableMixin } from './slottable';
import { InternalError } from '../../../infra/internal-error';

/** Element names, attributes, child navigation, and composed style behavior. */
// https://dom.spec.whatwg.org/#interface-element
export class ElementImpl extends NodeImpl {
  /** Execution and allocation owner supplied at construction. */
  declare env: Environment;
  /** Document supplied at construction, including while this element is detached. */
  declare nodeDocument: DocumentImpl;
  /** Ordered attributes owned by this element. */
  // https://dom.spec.whatwg.org/#concept-element-attribute
  attributes: NamedNodeMapImpl;
  /** Element name without a namespace prefix. */
  localName: string;
  /** Namespace URI selected when the element is created. */
  namespaceURI: string;

  /** Child-node mutation behavior shared with text and doctype nodes. */
  #childNodeMixin = new ChildNodeMixin(this);
  /** Lazily created inline style declaration. */
  #inlineStyleMixin: ElementCSSInlineStyleMixin | undefined;
  /** Sheet loading and ownership for elements that provide a style sheet. */
  protected linkStyleMixin: LinkStyleMixin | undefined;
  /** Navigation among element siblings. */
  #nonDocumentTypeChildNodeMixin =
    new NonDocumentTypeChildNodeMixin(this);
  /** Live child collection and element-child navigation. */
  #parentNodeMixin = new ParentNodeMixin(this);
  /** Slot assignment shared with text nodes. */
  #slottableMixin = new SlottableMixin();

  constructor(context: ElementCreationContext, env: Environment) {
    super(NodeType.Element, context.document, env);
    this.attributes = new NamedNodeMapImpl();
    this.attributes.associateElement(this);
    this.localName = context.localName;
    this.namespaceURI = context.namespaceURI;
  }

  static is(value: unknown): value is ElementImpl {
    return value instanceof ElementImpl;
  }

  get children(): HTMLCollectionImpl<ElementImpl> {
    return this.#parentNodeMixin.children;
  }

  get firstElementChild(): ElementImpl | null {
    return this.#parentNodeMixin.firstElementChild;
  }

  get lastElementChild(): ElementImpl | null {
    return this.#parentNodeMixin.lastElementChild;
  }

  get childElementCount(): number {
    return this.#parentNodeMixin.childElementCount;
  }

  get previousElementSibling(): ElementImpl | null {
    return this.#nonDocumentTypeChildNodeMixin.previousElementSibling;
  }

  get nextElementSibling(): ElementImpl | null {
    return this.#nonDocumentTypeChildNodeMixin.nextElementSibling;
  }

  remove(): void {
    this.#childNodeMixin.remove();
  }

  /** Return the attribute value, or null when the name is absent. */
  // https://dom.spec.whatwg.org/#dom-element-getattribute
  getAttribute(qualifiedName: string): string | null {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);

    return this.attributes.find(
      (attribute) => attribute.name === qualifiedName,
    )?.value ?? null;
  }

  // https://dom.spec.whatwg.org/#dom-element-getattributens
  getAttributeNS(namespaceURI: string | null, localName: string): string | null {
    namespaceURI = normalizeNamespace(namespaceURI);

    return this.attributes.find(
      (attribute) =>
        attribute.namespaceURI === namespaceURI &&
        attribute.localName === localName,
    )?.value ?? null;
  }

  // https://dom.spec.whatwg.org/#dom-element-hasattribute
  hasAttribute(qualifiedName: string): boolean {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);

    return this.attributes.some(
      (attribute) => attribute.name === qualifiedName,
    );
  }

  // https://dom.spec.whatwg.org/#dom-element-hasattributens
  hasAttributeNS(namespaceURI: string | null, localName: string): boolean {
    namespaceURI = normalizeNamespace(namespaceURI);

    return this.attributes.some(
      (attribute) =>
        attribute.namespaceURI === namespaceURI &&
        attribute.localName === localName,
    );
  }

  // https://dom.spec.whatwg.org/#dom-element-setattribute
  setAttribute(qualifiedName: string, value: string): void {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);

    const attribute = this.attributes.find(
      (candidate) => candidate.name === qualifiedName,
    );
    if (attribute) {
      attribute.value = value;
    } else {
      const created = this.nodeDocument.createAttribute(qualifiedName);
      created.value = value;
      this.appendAttribute(created);
    }
  }

  // https://dom.spec.whatwg.org/#dom-element-removeattribute
  removeAttribute(qualifiedName: string): void {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);

    if (this.attributes.getNamedItem(qualifiedName)) {
      this.attributes.removeNamedItem(qualifiedName);
    }
  }

  /** Live collection of descendants containing every requested class. */
  // https://dom.spec.whatwg.org/#dom-element-getelementsbyclassname
  getElementsByClassName(classNames: string): HTMLCollectionImpl {
    return findElementsByClassName(this, classNames);
  }

  // https://dom.spec.whatwg.org/#dom-element-getelementsbytagname
  getElementsByTagName(qualifiedName: string): HTMLCollectionImpl {
    return findElementsByTagName(this, qualifiedName);
  }

  // https://dom.spec.whatwg.org/#dom-element-getelementsbytagnamens
  getElementsByTagNameNS(
    namespaceURI: string | null,
    localName: string,
  ): HTMLCollectionImpl {
    return findElementsByTagNameNS(this, namespaceURI, localName);
  }

  // -- Internal ---------------------------------------------------------

  setAssignedSlot(slot: ElementImpl | null): void {
    this.#slottableMixin.assignedSlot = slot;
  }

  override getAssignedSlot(): ElementImpl | null {
    return this.#slottableMixin.assignedSlot;
  }

  override getEventParent(_event: EventImpl): NodeImpl | null {
    return this.#slottableMixin.assignedSlot ?? this.parentNode;
  }

  /** Defer child-dependent style processing while the parser populates this element. */
  beginParsingChildren(): void {
    this.linkStyleMixin?.beginParsingChildren();
  }

  /** Resume style processing once the parser has supplied the element's children. */
  finishParsingChildren(): void {
    this.linkStyleMixin?.finishParsingChildren();
  }

  /** Set an attribute by namespace and local name, creating it when absent. */
  // https://dom.spec.whatwg.org/#concept-element-attributes-set-value
  setAttributeValue(
    localName: string, value: string,
    prefix: string | null = null, namespace: string | null = null,
  ): void {
    const attribute = this.attributes.getNamedItemNS(namespace, localName);
    if (attribute) {
      attribute.value = value;
    } else {
      this.appendAttribute(this.nodeDocument.createAttributeNode(
        localName, value, namespace, prefix,
      ));
    }
  }

  /** Attach an unowned attribute and notify the element of its value. */
  // https://dom.spec.whatwg.org/#concept-element-attributes-append
  appendAttribute(attribute: AttrImpl): void {
    if (attribute.ownerElement !== null) {
      throw new InternalError('Cannot append an attribute owned by another element');
    }

    this.attributes.push(attribute);
    attribute.ownerElement = this;
    this.attributeChanged(attribute.localName, null, attribute.value, attribute.namespaceURI);
  }

  /** Apply element-specific reactions to an attribute change. */
  // https://dom.spec.whatwg.org/#concept-element-attributes-change-ext
  attributeChanged(
    localName: string, _oldValue: string | null, newValue: string | null,
    namespace: string | null,
  ): void {
    if (namespace !== null) return;
    if (localName === 'style') this.#inlineStyleMixin?.attributeChanged(newValue);
    this.linkStyleMixin?.attributeChanged(localName);
  }

  /** Return the lazily created declaration reflected by the style attribute. */
  getInlineStyle(): CSSStyleDeclarationImpl {
    return (this.#inlineStyleMixin ??=
      new ElementCSSInlineStyleMixin(this, this.env)).style;
  }

  /** Style sheet supplied by this element, if its style behavior has one. */
  getStyleSheet(): CSSStyleSheetImpl | null {
    return this.linkStyleMixin?.sheet ?? null;
  }

  protected override insertedInto(): void {
    this.linkStyleMixin?.update();
  }

  protected override removedFrom(): void {
    this.linkStyleMixin?.update();
  }

  protected override childrenChanged(): void {
    this.linkStyleMixin?.childrenChanged();
  }

  // -- Private ----------------------------------------------------------

  #normalizeAttributeName(qualifiedName: string): string {
    return this.namespaceURI === HTML_NAMESPACE
      ? asciiLower(qualifiedName)
      : qualifiedName;
  }
}

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
export const elementIDL = defineInterface({
  name: 'Element',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(ElementImpl),
  members: [
    roAttr('namespaceURI', nullable(idlType.DOMString)),
    roAttr('localName', idlType.DOMString),
    roAttr('attributes', reference('NamedNodeMap'), xattr('SameObject')),
    op('getAttribute', nullable(idlType.DOMString), [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('getAttributeNS', nullable(idlType.DOMString), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('getElementsByClassName', reference('HTMLCollection'), [
      arg('classNames', idlType.DOMString),
    ]),
    op('getElementsByTagName', reference('HTMLCollection'), [
      arg('qualifiedName', idlType.DOMString),
    ]),
    op('getElementsByTagNameNS', reference('HTMLCollection'), [
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
});

/** Associate an element declaration with its constructor and matching names. */
export function defineElementInterface(
  options: ElementInterfaceOptions,
): ElementInterface {
  const implClass = options.definition.implementation?.implClass;
  if (!implClass) {
    throw new InternalError(
      `Element interface ${options.definition.name} has no implementation`,
    );
  }

  return {
    definition: options.definition,
    implementation: implClass as ElementImplementation,
    localNames: options.localNames ?? [],
    namespaceURI: options.namespaceURI,
  };
}

export const elementInterface = defineElementInterface({
  definition: elementIDL,
  namespaceURI: '',
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

function normalizeNamespace(namespaceURI: string | null): string | null {
  return namespaceURI === '' ? null : namespaceURI;
}

/** Inputs shared by document element factories and element constructors. */
export type ElementCreationContext = {
  /** Node document assigned to the new element. */
  document: DocumentImpl;
  /** Name without a namespace prefix. */
  localName: string;
  /** Namespace used to select the element interface. */
  namespaceURI: string;
  /** Resolve style ownership after insertion or removal. */
  treeScopeResolver: TreeScopeResolver;
};

/** Declaration and constructor selected for an element's namespace and name. */
export type ElementInterface = {
  /** Platform interface projected for this element implementation. */
  definition: InterfaceDefinition;
  /** Constructor used by the document's node factory. */
  implementation: ElementImplementation;
  /** Local names handled by this interface within its namespace. */
  localNames: string[];
  /** Namespace in which these names select the interface. */
  namespaceURI: string;
};

type ElementInterfaceOptions = {
  definition: InterfaceDefinition;
  localNames?: string[];
  namespaceURI: string;
};

type ElementImplementation = abstract new (
  context: ElementCreationContext,
  env: Environment,
) => ElementImpl;
