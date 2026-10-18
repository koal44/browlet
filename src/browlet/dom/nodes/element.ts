import { HTML_NAMESPACE } from '../../../infra/index';
import { asciiLower, asciiUpper } from '../../../infra/ascii';
import { InternalError } from '../../../infra/internal-error';
import {
  arg, attr, defineDictionary, defineIncludes, defineInterface, dictMember, idlType, impl,
  nullable, op, reference, roAttr, sequence, union, xattr,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/index';
import type { CSSStyleSheetImpl, CSSStyleDeclarationImpl } from '../../../stylelet/index';

import { isValidAttributeLocalName, validateAndExtract } from '../infra/index';
import { ElementTag, type ContentCategory, type ContentModel } from './element-definitions/index';
import { ElementCSSInlineStyleMixin, type LinkStyleMixin, type TreeScopeResolver } from '../../style/index';
import type { EventImpl } from '../events/index';
import { getTrustedTypeDataForAttribute, type TrustedTypeValue } from '../../browsing/policy/trusted-types/index';
import { DOMTokenListImpl, type TokenListAttribute } from '../token-list';
import type { IntersectionObserverRegistration } from '../intersection-observer/index';
import { ElementAssociations, type ElementConstructor } from '../../html/reflection/index';
import type { BrowletEnvironment } from '../../environment';

import { NodeImpl, NodeType } from './node';
import type { AttrImpl } from './attribute';
import { NamedNodeMapImpl } from './named-node-map';
import type { DocumentImpl } from './document';
import type { TextImpl } from './text';
import type { ShadowRootImpl, ShadowRootMode, SlotAssignmentMode } from './shadow-root';
import {
  isValidCustomElementName, type CustomElementRegistryImpl,
  type CustomElementCallbackArguments, type CustomElementDefinition,
} from './html/custom-elements/index';
import type { HTMLCollectionImpl, NodeListImpl } from './collections';
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
import { SlottableMixin, slottableIDL } from './slottable';
import type { HTMLSlotElementImpl } from './html/index';

const classAttribute: TokenListAttribute = { name: 'class', supportedTokens: null };

/** Element names, attributes, child navigation, and composed style behavior. */
// https://dom.spec.whatwg.org/#interface-element
export class ElementImpl extends NodeImpl {
  /** Fixed name for tag-specific registration; absent on shared and fallback classes. */
  static localName?: string;

  static {
    this.prototype.tag = ElementTag.Other;
  }

  /** Execution and allocation owner supplied at construction. */
  declare env: BrowletEnvironment;
  /** Document supplied at construction, including while this element is detached. */
  declare nodeDocument: DocumentImpl;
  /** Namespaced tag identity shared through the implementation prototype. */
  declare tag: ElementTag;
  /** Fixed HTML content-category memberships; undefined means the inventory is unfinished. */
  // https://html.spec.whatwg.org/multipage/dom.html#kinds-of-content
  declare categories?: ContentCategory[];
  /** Content requirements shared through the prototype; undefined means the model is unfinished. */
  declare contentModel?: ContentModel;
  /** Stable live view of this element's attribute list. */
  attributes: NamedNodeMapImpl;
  /** Element name without a namespace prefix. */
  localName: string;
  /** Namespace URI selected when the element is created. */
  namespaceURI: string;
  /** Namespace prefix selected by createElementNS(), or null for an unprefixed name. */
  prefix: string | null;
  /** Customized built-in name retained separately from the mutable is attribute. */
  // https://dom.spec.whatwg.org/#concept-element-is-value
  isValue: string | null = null;
  /** Associated shadow tree, including a closed root; platform exposure is separate. */
  // https://dom.spec.whatwg.org/#concept-element-shadow-root
  shadowRoot: ShadowRootImpl | null = null;
  /** Registry association retained across insertion and adoption. */
  // https://dom.spec.whatwg.org/#concept-element-custom-element-registry
  customElementRegistry: CustomElementRegistryImpl | null = null;
  /** Construction/upgrade state; ordinary elements start uncustomized. */
  // https://dom.spec.whatwg.org/#concept-element-custom-element-state
  customElementState: CustomElementState = 'uncustomized';
  /** Definition retained when construction or upgrade associates this element. */
  // https://dom.spec.whatwg.org/#concept-element-custom-element-definition
  customElementDefinition: CustomElementDefinition | null = null;
  /** Intersection observers tracking this element, with independent history for each observer. */
  // https://w3c.github.io/IntersectionObserver/#element
  registeredIntersectionObservers: IntersectionObserverRegistration[] = [];
  /** Separate content-attribute storage for ElementInternals, allocated only when used. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#internal-content-attribute-map
  internalContentAttributeMap: Map<string, string> | undefined;
  /** Sheet loading and ownership for elements that provide a style sheet. */
  protected linkStyleMixin: LinkStyleMixin | undefined;

  /** Ordered attribute storage; only this element's mutation algorithms modify it. */
  // https://dom.spec.whatwg.org/#concept-element-attribute
  #attributeList: AttrImpl[] = [];
  /** Child-node mutation behavior shared with text and doctype nodes. */
  #childNodeMixin = new ChildNodeMixin(this);
  /** Stable token views, allocated only for attributes whose lists have been requested. */
  #attributeTokenLists: Map<string, DOMTokenListImpl> | undefined;
  /** Explicit weak element associations shared by this element's reflected reference attributes. */
  #elementAssociations: ElementAssociations | undefined;
  /** Lazily created inline style declaration. */
  #inlineStyleMixin: ElementCSSInlineStyleMixin | undefined;
  /** Navigation among element siblings. */
  #nonDocumentTypeChildNodeMixin =
    new NonDocumentTypeChildNodeMixin(this);
  /** Live child collection and element-child navigation. */
  #parentNodeMixin = new ParentNodeMixin(this);
  /** Slot assignment shared with text nodes. */
  #slottableMixin = new SlottableMixin();

  constructor(context: ElementCreationContext, env: BrowletEnvironment) {
    super(NodeType.Element, context.document, env);
    this.attributes = new NamedNodeMapImpl(this);
    this.localName = context.localName;
    this.namespaceURI = context.namespaceURI;
    this.prefix = context.prefix ?? null;
  }

  static is(value: unknown): value is ElementImpl {
    return value instanceof ElementImpl;
  }

  /** Namespace-qualified name, preserving the element's original case. */
  get qualifiedName(): string {
    return this.prefix === null ? this.localName : `${this.prefix}:${this.localName}`;
  }

  /** HTML-uppercased qualified name, recomputed because adoption can change the document type. */
  // https://dom.spec.whatwg.org/#dom-element-tagname
  get tagName(): string {
    return this.namespaceURI === HTML_NAMESPACE && this.nodeDocument.type === 'html'
      ? asciiUpper(this.qualifiedName) : this.qualifiedName;
  }

  /** Reflect the null-namespace ID attribute. */
  get id(): string { return this.getAttributeNS(null, 'id') ?? ''; }
  set id(value: string) { this.setAttributeValue('id', value); }

  /** Reflect the null-namespace class attribute. */
  get className(): string { return this.getAttributeNS(null, 'class') ?? ''; }
  set className(value: string) { this.setAttributeValue('class', value); }

  /** Stable live token set for the null-namespace class attribute. */
  // https://dom.spec.whatwg.org/#dom-element-classlist
  get classList(): DOMTokenListImpl {
    return this.getAttributeTokenList(classAttribute);
  }

  /** Read the live list without bypassing attribute mutation steps. */
  get attributeList(): readonly AttrImpl[] {
    return this.#attributeList;
  }

  /** Reflect the null-namespace slot attribute through the shared mutation path. */
  get slot(): string {
    return this.getAttributeNS(null, 'slot') ?? '';
  }

  set slot(value: string) {
    this.setAttributeValue('slot', value);
  }

  get children(): HTMLCollectionImpl {
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

  /** Author-facing slot lookup excludes closed shadow roots. */
  // https://dom.spec.whatwg.org/#dom-slotable-assignedslot
  get assignedSlot(): HTMLSlotElementImpl | null {
    return this.#slottableMixin.findSlot(this, true);
  }

  /** Explicit assignment owner, retained weakly even while this node is detached. */
  get manualSlotAssignment(): WeakRef<HTMLSlotElementImpl> | null {
    return this.#slottableMixin.manualSlotAssignment;
  }

  set manualSlotAssignment(slot: WeakRef<HTMLSlotElementImpl> | null) {
    this.#slottableMixin.manualSlotAssignment = slot;
  }

  /** Obtain the stable token list associated with a null-namespace attribute. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
  getAttributeTokenList(attribute: TokenListAttribute): DOMTokenListImpl {
    const { name, supportedTokens } = attribute;
    const lists = this.#attributeTokenLists ??= new Map<string, DOMTokenListImpl>();
    let list = lists.get(name);
    if (!list) {
      list = new DOMTokenListImpl(this, name, supportedTokens);
      lists.set(name, list);
    }
    return list;
  }

  /** Current HTML content-category membership, including for elements from other namespaces. */
  hasCategory(category: ContentCategory): boolean {
    const categories = this.categories;
    if (categories === undefined) {
      throw new InternalError(`Content categories for ${this.localName} are not implemented`);
    }
    return categories.includes(category);
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

  /** Read this element's associated target or target list, narrowed to the supplied implementation constructors. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#attr-associated-element
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#attr-associated-elements
  getAssociatedElements<T extends ElementImpl>(name: string, targetConstructors: ElementConstructor<T>[], isArray: false): T | null;
  getAssociatedElements<T extends ElementImpl>(name: string, targetConstructors: ElementConstructor<T>[], isArray: true): T[] | null;
  getAssociatedElements<T extends ElementImpl>(
    name: string, targetConstructors: ElementConstructor<T>[], isArray: boolean,
  ): T | T[] | null {
    const associations = this.#elementAssociations ??= new ElementAssociations();
    return associations.get(this, name, this.getAttributeNS(null, name), targetConstructors, isArray);
  }

  /** Store a converted element or list and synchronize the content attribute; null clears either assignment. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
  setAssociatedElements(name: string, value: ElementImpl | ElementImpl[] | null): void {
    if (value === null) {
      this.#elementAssociations?.clear(name);
      this.removeAttributeNS(null, name);
      return;
    }
    this.setAttributeValue(name, '');
    (this.#elementAssociations ??= new ElementAssociations()).set(name, value);
  }

  // https://dom.spec.whatwg.org/#dom-element-hasattributes
  hasAttributes(): boolean {
    return this.#attributeList.length !== 0;
  }

  /** Return qualified names in list order, including duplicates across namespaces. */
  // https://dom.spec.whatwg.org/#dom-element-getattributenames
  getAttributeNames(): string[] {
    return this.#attributeList.map((attribute) => attribute.name);
  }

  /** Return the attribute value, or null when the name is absent. */
  // https://dom.spec.whatwg.org/#dom-element-getattribute
  getAttribute(qualifiedName: string): string | null {
    return this.getAttributeNode(qualifiedName)?.value ?? null;
  }

  // https://dom.spec.whatwg.org/#dom-element-getattributens
  getAttributeNS(namespaceURI: string | null, localName: string): string | null {
    return this.getAttributeNodeNS(namespaceURI, localName)?.value ?? null;
  }

  // https://dom.spec.whatwg.org/#dom-element-setattribute
  setAttribute(qualifiedName: string, value: TrustedTypeValue | string): void {
    if (!isValidAttributeLocalName(qualifiedName)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    }
    qualifiedName = this.#normalizeAttributeName(qualifiedName);
    const verifiedValue = this.getTrustedTypeCompliantAttributeValue(qualifiedName, null, value);
    const attribute = this.#attributeList.find(
      (candidate) => candidate.name === qualifiedName,
    );
    if (attribute) {
      attribute.change(verifiedValue);
    } else {
      this.appendAttribute(this.nodeDocument.createAttributeNode(qualifiedName, verifiedValue, null, null));
    }
  }

  // https://dom.spec.whatwg.org/#dom-element-setattributens
  setAttributeNS(namespace: string | null, qualifiedName: string, value: TrustedTypeValue | string): void {
    const [namespaceURI, prefix, localName] = validateAndExtract(namespace, qualifiedName, 'attribute');
    const verifiedValue = this.getTrustedTypeCompliantAttributeValue(localName, namespaceURI, value);
    this.setAttributeValue(localName, verifiedValue, prefix, namespaceURI);
  }

  // https://dom.spec.whatwg.org/#dom-element-removeattribute
  removeAttribute(qualifiedName: string): void {
    const attribute = this.getAttributeNode(qualifiedName);
    if (attribute !== null) this.removeAttributeNode(attribute);
  }

  // https://dom.spec.whatwg.org/#dom-element-removeattributens
  removeAttributeNS(namespace: string | null, localName: string): void {
    const attribute = this.getAttributeNodeNS(namespace, localName);
    if (attribute !== null) this.removeAttributeNode(attribute);
  }

  // https://dom.spec.whatwg.org/#dom-element-toggleattribute
  toggleAttribute(qualifiedName: string, force?: boolean): boolean {
    if (!isValidAttributeLocalName(qualifiedName)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    }
    qualifiedName = this.#normalizeAttributeName(qualifiedName);
    const attribute = this.#attributeList.find((candidate) => candidate.name === qualifiedName);
    if (attribute === undefined) {
      if (force === false) return false;
      this.appendAttribute(this.nodeDocument.createAttributeNode(qualifiedName, '', null, null));
      return true;
    }
    if (force === true) return true;
    this.removeAttributeNode(attribute);
    return false;
  }

  // https://dom.spec.whatwg.org/#dom-element-hasattribute
  hasAttribute(qualifiedName: string): boolean {
    return this.getAttributeNode(qualifiedName) !== null;
  }

  // https://dom.spec.whatwg.org/#dom-element-hasattributens
  hasAttributeNS(namespaceURI: string | null, localName: string): boolean {
    return this.getAttributeNodeNS(namespaceURI, localName) !== null;
  }

  // https://dom.spec.whatwg.org/#dom-element-getattributenode
  getAttributeNode(qualifiedName: string): AttrImpl | null {
    qualifiedName = this.#normalizeAttributeName(qualifiedName);
    return this.#attributeList.find((attribute) => attribute.name === qualifiedName) ?? null;
  }

  // https://dom.spec.whatwg.org/#dom-element-getattributenodens
  getAttributeNodeNS(namespace: string | null, localName: string): AttrImpl | null {
    if (namespace === '') namespace = null;
    return this.#attributeList.find((attribute) =>
      attribute.namespaceURI === namespace && attribute.localName === localName,
    ) ?? null;
  }

  /** Attach or replace by namespace and local name, retaining list position and identity. */
  // https://dom.spec.whatwg.org/#concept-element-attributes-set
  // https://dom.spec.whatwg.org/#dom-element-setattributenode
  setAttributeNode(attribute: AttrImpl): AttrImpl | null {
    const verifiedValue = this.getTrustedTypeCompliantAttributeValue(attribute.localName, attribute.namespaceURI, attribute.value);
    if (attribute.ownerElement !== null && attribute.ownerElement !== this) {
      throw new DOMExceptionImpl('', DOMExceptionNames.inUseAttribute);
    }
    const previous = this.getAttributeNodeNS(attribute.namespaceURI, attribute.localName);
    if (previous === attribute) return attribute;
    attribute.change(verifiedValue);
    if (previous !== null) this.replaceAttribute(previous, attribute);
    else this.appendAttribute(attribute);
    return previous;
  }

  // https://dom.spec.whatwg.org/#dom-element-setattributenodens
  setAttributeNodeNS(attribute: AttrImpl): AttrImpl | null {
    return this.setAttributeNode(attribute);
  }

  /** Detach this exact attribute, retaining its value and node document. */
  // https://dom.spec.whatwg.org/#dom-element-removeattributenode
  // https://dom.spec.whatwg.org/#concept-element-attributes-remove
  removeAttributeNode(attribute: AttrImpl): AttrImpl {
    if (attribute.ownerElement !== this) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notFound);
    }
    this.#attributeList.splice(this.#attributeList.indexOf(attribute), 1);
    attribute.ownerElement = null;
    this.handleAttributeChanges(attribute, attribute.value, null);
    return attribute;
  }

  /** Check an author assignment using this element's node document's relevant global. */
  // https://w3c.github.io/trusted-types/dist/spec/#validate-attribute-mutation
  getTrustedTypeCompliantAttributeValue(attributeName: string, attributeNs: string | null, value: TrustedTypeValue | string): string {
    const data = getTrustedTypeDataForAttribute(this.localName, this.namespaceURI, attributeName, attributeNs || null);
    if (data === null) return typeof value === 'string' ? value : value.data;
    const global = this.nodeDocument.getRelevantGlobalObject();
    if (global === null) throw new InternalError('A Trusted Types attribute sink needs a document with a relevant Window');
    return global.trustedTypes.getCompliantString(data.type, value, data.sink, 'script');
  }

  /** Set an attribute by namespace and local name, creating it when absent. */
  // https://dom.spec.whatwg.org/#concept-element-attributes-set-value
  setAttributeValue(
    localName: string, value: string,
    prefix: string | null = null, namespace: string | null = null,
  ): void {
    const attribute = this.getAttributeNodeNS(namespace, localName);
    if (attribute) {
      attribute.change(value);
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

    this.#attributeList.push(attribute);
    attribute.ownerElement = this;
    attribute.nodeDocument = this.nodeDocument;
    this.handleAttributeChanges(attribute, null, attribute.value);
  }

  /** Replace in place after the caller has checked that the incoming Attr can be attached. */
  // https://dom.spec.whatwg.org/#concept-element-attributes-replace
  replaceAttribute(previous: AttrImpl, attribute: AttrImpl): void {
    this.#attributeList[this.#attributeList.indexOf(previous)] = attribute;
    attribute.ownerElement = this;
    attribute.nodeDocument = this.nodeDocument;
    previous.ownerElement = null;
    this.handleAttributeChanges(previous, previous.value, attribute.value);
  }

  /** Notify observers, custom-element reactions, and element-specific steps in that order. */
  // https://dom.spec.whatwg.org/#handle-attribute-changes
  handleAttributeChanges(attribute: AttrImpl, oldValue: string | null, value: string | null): void {
    this.nodeDocument.collectionVersion++;
    const { localName, namespaceURI } = attribute;
    this.queueMutationRecord('attributes', localName, namespaceURI, oldValue, [], [], null, null);
    if (this.customElementState === 'custom') {
      this.enqueueCustomElementCallbackReaction('attributeChangedCallback', [localName, oldValue, value, namespaceURI]);
    }
    this.attributeChanged(localName, oldValue, value, namespaceURI);
  }

  /** Apply element-specific reactions to an attribute change. */
  // https://dom.spec.whatwg.org/#concept-element-attributes-change-ext
  attributeChanged(
    localName: string, oldValue: string | null, newValue: string | null,
    namespace: string | null,
  ): void {
    if (namespace !== null) return;
    this.#attributeTokenLists?.get(localName)?.updateTokens(newValue);
    this.#elementAssociations?.clear(localName);
    if (localName === 'slot') this.#slottableMixin.attributeChanged(this, oldValue, newValue);
    if (localName === 'style') this.#inlineStyleMixin?.attributeChanged(newValue);
    // https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism
    if (localName === 'blocking' && this.isRenderBlocking() && !this.isPotentiallyRenderBlocking()) {
      this.unblockRendering();
    }
    this.linkStyleMixin?.attributeChanged(localName);
  }

  /** Attach a shadow tree using the converted options and this node's document registry. */
  // https://dom.spec.whatwg.org/#dom-element-attachshadow
  attachShadow(init: ShadowRootInit): ShadowRootImpl {
    const documentRegistry = this.nodeDocument.customElementRegistry;
    const registry = init.customElementRegistry === undefined ? documentRegistry : init.customElementRegistry;
    if (registry !== null && !registry.isScoped && registry !== documentRegistry) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    }
    this.attachShadowRoot(
      init.mode, init.delegatesFocus, init.serializable, init.slotAssignment, init.clonable, registry,
    );
    return this.shadowRoot!;
  }

  /** Establish the host/root association, or reuse a compatible declarative root. */
  // https://dom.spec.whatwg.org/#concept-attach-a-shadow-root
  attachShadowRoot(
    mode: ShadowRootMode, delegatesFocus: boolean, serializable: boolean,
    slotAssignment: SlotAssignmentMode, clonable: boolean, registry: CustomElementRegistryImpl | null,
  ): void {
    if (this.namespaceURI !== HTML_NAMESPACE ||
      (!shadowHostNames.has(this.localName) && !isValidCustomElementName(this.localName))) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    }

    // PROVISIONAL(custom elements): definition lookup cannot yield a definition yet.
    // The definition's disable-shadow check belongs here when definitions and `is` values exist.
    const current = this.shadowRoot;
    if (current !== null) {
      if (!current.declarative || current.mode !== mode) {
        throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
      }
      while (current.firstChild !== null) current.firstChild.removeNode();
      current.declarative = false;
      return;
    }

    const shadow = this.nodeDocument.createShadowRoot(this, mode);
    shadow.delegatesFocus = delegatesFocus;
    shadow.availableToElementInternals = this.customElementState === 'precustomized' ||
      this.customElementState === 'custom';
    shadow.serializable = serializable;
    shadow.slotAssignment = slotAssignment;
    shadow.clonable = clonable;
    shadow.customElementRegistry = registry;
    this.shadowRoot = shadow;
  }

  /** Match this element with itself as the selector scoping root. */
  // https://dom.spec.whatwg.org/#dom-element-matches
  matches(selectors: string): boolean {
    return this.nodeDocument.getSelectorEngine().matches(selectors, this);
  }

  /** First matching inclusive ancestor; matching remains scoped to this element. */
  // https://dom.spec.whatwg.org/#dom-element-closest
  closest(selectors: string): ElementImpl | null {
    return this.nodeDocument.getSelectorEngine().closest(selectors, this);
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

  /** Live collection of descendants containing every requested class. */
  // https://dom.spec.whatwg.org/#dom-element-getelementsbyclassname
  getElementsByClassName(classNames: string): HTMLCollectionImpl {
    return findElementsByClassName(this, classNames);
  }

  /** Insert an element at one of the four adjacent positions. */
  // https://dom.spec.whatwg.org/#dom-element-insertadjacentelement
  insertAdjacentElement(where: string, element: ElementImpl): ElementImpl | null {
    return this.insertAdjacent(where, element);
  }

  /** Create text in this document and insert it at an adjacent position. */
  // https://dom.spec.whatwg.org/#dom-element-insertadjacenttext
  insertAdjacentText(where: string, data: string): void {
    this.insertAdjacent(where, this.nodeDocument.createTextNode(data));
  }

  /** Shared adjacent insertion algorithm; outside positions return null for detached elements. */
  // https://dom.spec.whatwg.org/#insert-adjacent
  insertAdjacent<T extends NodeImpl>(where: string, node: T): T | null {
    switch (asciiLower(where)) {
      case 'beforebegin': return this.parentNode?.insertBefore(node, this) ?? null;
      case 'afterbegin': return this.insertBefore(node, this.firstChild);
      case 'beforeend': return this.appendChild(node);
      case 'afterend': return this.parentNode?.insertBefore(node, this.nextSibling) ?? null;
      default: throw new DOMExceptionImpl('', DOMExceptionNames.syntax);
    }
  }

  prepend(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.prepend(...nodes);
  }

  append(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.append(...nodes);
  }

  replaceChildren(...nodes: (NodeImpl | string)[]): void {
    this.#parentNodeMixin.replaceChildren(...nodes);
  }

  moveBefore(node: NodeImpl, child: NodeImpl | null): void {
    this.#parentNodeMixin.moveBefore(node, child);
  }

  querySelector(selectors: string): ElementImpl | null {
    return this.#parentNodeMixin.querySelector(selectors);
  }

  querySelectorAll(selectors: string): NodeListImpl {
    return this.#parentNodeMixin.querySelectorAll(selectors);
  }

  before(...nodes: (NodeImpl | string)[]): void {
    this.#childNodeMixin.before(...nodes);
  }

  after(...nodes: (NodeImpl | string)[]): void {
    this.#childNodeMixin.after(...nodes);
  }

  replaceWith(...nodes: (NodeImpl | string)[]): void {
    this.#childNodeMixin.replaceWith(...nodes);
  }

  remove(): void {
    this.#childNodeMixin.remove();
  }

  /** Stable weak identity used by slots' manual assignment sets. */
  getManualReference(): WeakRef<ElementImpl | TextImpl> {
    return this.#slottableMixin.getManualReference(this);
  }

  /** Find an applicable slot, optionally excluding a closed shadow root. */
  findSlot(open = false): HTMLSlotElementImpl | null {
    return this.#slottableMixin.findSlot(this, open);
  }

  override getAssignedSlot(): HTMLSlotElementImpl | null {
    return this.#slottableMixin.assignedSlot;
  }

  setAssignedSlot(slot: HTMLSlotElementImpl | null): void {
    this.#slottableMixin.assignedSlot = slot;
  }

  /** Update slot assignment through the shared slottable behavior. */
  assignSlot(): void {
    this.#slottableMixin.assignSlot(this);
  }

  override getEventParent(_event: EventImpl): NodeImpl | null {
    return this.#slottableMixin.assignedSlot ?? this.parentNode;
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

  /** Record parser creation before attributes and insertion; ordinary elements need no state. */
  initializeFromParser(): void {}

  /** Ordinary elements have neither a blocking attribute nor implicit render-blocking behavior. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#potentially-render-blocking
  isPotentiallyRenderBlocking(): boolean {
    return false;
  }

  /** Whether this element currently contributes to its document's rendering delay. */
  // https://html.spec.whatwg.org/multipage/dom.html#render-blocking
  isRenderBlocking(): boolean {
    return this.nodeDocument.renderBlockingElements.has(this) && this.nodeDocument.isRenderBlocked();
  }

  /** Register pending work when the document still accepts rendering blockers. */
  // https://html.spec.whatwg.org/multipage/dom.html#block-rendering
  blockRendering(): void {
    const document = this.nodeDocument;
    if (document.allowsAddingRenderBlockingElements()) document.renderBlockingElements.add(this);
  }

  /** Release this element's pending rendering dependency. */
  // https://html.spec.whatwg.org/multipage/dom.html#unblock-rendering
  unblockRendering(): void {
    this.nodeDocument.renderBlockingElements.delete(this);
  }

  /** Defer child-dependent style processing while the parser populates this element. */
  beginParsingChildren(): void {
    this.linkStyleMixin?.beginParsingChildren();
  }

  /** Resume style processing once the parser has supplied the element's children. */
  finishParsingChildren(): void {
    this.linkStyleMixin?.finishParsingChildren();
  }

  /** Attempt an upgrade using this element's registry and name. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#concept-try-upgrade
  tryToUpgrade(): void {
    // PROVISIONAL(custom elements): registries cannot define elements yet, so lookup is empty.
    // Definition registration must supply upgrade reactions before it becomes available.
  }

  /** Enqueue a lifecycle callback on this custom element's reaction queue. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#enqueue-a-custom-element-callback-reaction
  enqueueCustomElementCallbackReaction<Name extends keyof CustomElementCallbackArguments>(
    _callbackName: Name, _args: CustomElementCallbackArguments[Name],
  ): void {
    // TODO(HTML): definitions need lifecycle callbacks and their reaction queues/delivery.
    throw new InternalError('Custom element callback reactions are not implemented');
  }

  protected override insertionSteps(): void {
    this.linkStyleMixin?.update();
  }

  protected override removingSteps(): void {
    // Removing steps run after disconnection, including for shadow-tree descendants.
    // https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism
    if (this.isRenderBlocking()) this.unblockRendering();
    this.linkStyleMixin?.update();
  }

  protected override childrenChanged(): void {
    this.linkStyleMixin?.childrenChanged();
  }

  #normalizeAttributeName(qualifiedName: string): string {
    return this.namespaceURI === HTML_NAMESPACE && this.nodeDocument.type === 'html'
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
    roAttr('namespaceURI', nullable(idlType.DOMString), {
      get() { return (this as ElementImpl).namespaceURI || null; },
    }),
    roAttr('prefix', nullable(idlType.DOMString)),
    roAttr('localName', idlType.DOMString),
    roAttr('tagName', idlType.DOMString),
    attr('id', idlType.DOMString, xattr('CEReactions')),
    attr('className', idlType.DOMString, xattr('CEReactions')),
    roAttr('classList', reference('DOMTokenList'), xattr('SameObject', ['PutForwards', 'value'])),
    attr('slot', idlType.DOMString, xattr('CEReactions', 'Unscopable')),
    op('hasAttributes', idlType.boolean, []),
    roAttr('attributes', reference('NamedNodeMap'), xattr('SameObject')),
    op('getAttributeNames', sequence(idlType.DOMString), []),
    op('getAttribute', nullable(idlType.DOMString), [arg('qualifiedName', idlType.DOMString)]),
    op('getAttributeNS', nullable(idlType.DOMString), [
      arg('namespace', nullable(idlType.DOMString)), arg('localName', idlType.DOMString),
    ]),
    op('setAttribute', idlType.undefined,
      [arg('qualifiedName', idlType.DOMString), arg('value', union(reference('TrustedType'), idlType.DOMString))],
      xattr('CEReactions'),
    ),
    op('setAttributeNS', idlType.undefined,
      [
        arg('namespace', nullable(idlType.DOMString)), arg('qualifiedName', idlType.DOMString),
        arg('value', union(reference('TrustedType'), idlType.DOMString)),
      ],
      xattr('CEReactions'),
    ),
    op('removeAttribute', idlType.undefined,
      [arg('qualifiedName', idlType.DOMString)], xattr('CEReactions'),
    ),
    op('removeAttributeNS', idlType.undefined,
      [arg('namespace', nullable(idlType.DOMString)), arg('localName', idlType.DOMString)],
      xattr('CEReactions'),
    ),
    op('toggleAttribute', idlType.boolean,
      [arg('qualifiedName', idlType.DOMString), arg('force', idlType.boolean, { optional: true })],
      xattr('CEReactions'),
    ),
    op('hasAttribute', idlType.boolean, [arg('qualifiedName', idlType.DOMString)]),
    op('hasAttributeNS', idlType.boolean, [
      arg('namespace', nullable(idlType.DOMString)), arg('localName', idlType.DOMString),
    ]),
    op('getAttributeNode', nullable(reference('Attr')), [arg('qualifiedName', idlType.DOMString)]),
    op('getAttributeNodeNS', nullable(reference('Attr')), [
      arg('namespace', nullable(idlType.DOMString)), arg('localName', idlType.DOMString),
    ]),
    op('setAttributeNode', nullable(reference('Attr')),
      [arg('attr', reference('Attr'))], xattr('CEReactions'),
    ),
    op('setAttributeNodeNS', nullable(reference('Attr')),
      [arg('attr', reference('Attr'))], xattr('CEReactions'),
    ),
    op('removeAttributeNode', reference('Attr'),
      [arg('attr', reference('Attr'))], xattr('CEReactions'),
    ),
    op('attachShadow', reference('ShadowRoot'), [arg('init', reference('ShadowRootInit'))]),
    roAttr('shadowRoot', nullable(reference('ShadowRoot')), {
      get() {
        const shadow = (this as ElementImpl).shadowRoot;
        return shadow?.mode === 'open' ? shadow : null;
      },
    }),
    op('closest', nullable(reference('Element')), [arg('selectors', idlType.DOMString)]),
    op('matches', idlType.boolean, [arg('selectors', idlType.DOMString)]),
    op('webkitMatchesSelector', idlType.boolean,
      [arg('selectors', idlType.DOMString)],
      { invoke(_context, selectors) { return (this as ElementImpl).matches(selectors); } },
    ),
    op('getElementsByTagName', reference('HTMLCollection'), [arg('qualifiedName', idlType.DOMString)]),
    op('getElementsByTagNameNS', reference('HTMLCollection'), [
      arg('namespace', nullable(idlType.DOMString)), arg('localName', idlType.DOMString),
    ]),
    op('getElementsByClassName', reference('HTMLCollection'), [arg('classNames', idlType.DOMString)]),
    op('insertAdjacentElement', nullable(reference('Element')),
      [arg('where', idlType.DOMString), arg('element', reference('Element'))], xattr('CEReactions'),
    ),
    op('insertAdjacentText', idlType.undefined,
      [arg('where', idlType.DOMString), arg('data', idlType.DOMString)],
    ),
  ],
});

/** Converted shadow attachment options; Web IDL supplies every default. */
export type ShadowRootInit = {
  mode: ShadowRootMode;
  delegatesFocus: boolean;
  slotAssignment: SlotAssignmentMode;
  clonable: boolean;
  serializable: boolean;
  customElementRegistry?: CustomElementRegistryImpl | null;
};

/*
 * dictionary ShadowRootInit {
 *   required ShadowRootMode mode;
 *   boolean delegatesFocus = false;
 *   SlotAssignmentMode slotAssignment = "named";
 *   boolean clonable = false;
 *   boolean serializable = false;
 *   CustomElementRegistry? customElementRegistry;
 * };
 */
export const shadowRootInitIDL = defineDictionary({
  name: 'ShadowRootInit',
  members: [
    dictMember('mode', reference('ShadowRootMode'), { required: true }),
    dictMember('delegatesFocus', idlType.boolean, { default: false }),
    dictMember('slotAssignment', reference('SlotAssignmentMode'), { default: 'named' }),
    dictMember('clonable', idlType.boolean, { default: false }),
    dictMember('serializable', idlType.boolean, { default: false }),
    dictMember('customElementRegistry', nullable(reference('CustomElementRegistry'))),
  ],
});

/** Built-in shadow hosts, accepted alongside valid custom-element names. */
// https://dom.spec.whatwg.org/#valid-shadow-host-name
const shadowHostNames = new Set([
  'article', 'aside', 'blockquote', 'body', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'main', 'nav', 'p', 'section', 'span',
]);

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
 * Element includes Slottable;
 */
export const elementIncludesSlottableIDL = defineIncludes({
  interface: 'Element', mixin: slottableIDL.name,
});

/** Inputs shared by document element factories and element constructors. */
export type ElementCreationContext = {
  /** Node document assigned to the new element. */
  document: DocumentImpl;
  /** Name without a namespace prefix. */
  localName: string;
  /** Namespace used to select the element interface. */
  namespaceURI: string;
  /** Prefix retained by namespace-aware document factories. */
  prefix?: string | null;
  /** Resolve style ownership after insertion or removal. */
  treeScopeResolver: TreeScopeResolver;
};

/** DOM's construction and upgrade states for an element. */
export type CustomElementState = 'undefined' | 'failed' | 'uncustomized' | 'precustomized' | 'custom';
