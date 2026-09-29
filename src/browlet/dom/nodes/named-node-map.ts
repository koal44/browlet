import {
  arg, defineInterface, idlType, impl, indexedGetter, namedGetter, nullable, op, reference,
  roAttr, xattr, DOMExceptionNames, throwDOMException,
} from '../../../web-idl/index';
import { asciiLower } from '../../../infra/ascii';
import { HTML_NAMESPACE } from '../../../infra/index';
import type { AttrImpl } from './attribute';
import type { ElementImpl } from './element';

/** An element's ordered attributes, with lookup and mutation by name or namespace. */
// https://dom.spec.whatwg.org/#interface-namednodemap
export class NamedNodeMapImpl extends Array<AttrImpl> {
  /** Element whose attribute list this map exposes, set during element construction. */
  #element: ElementImpl | null = null;

  // https://dom.spec.whatwg.org/#dom-namednodemap-getnameditem
  getNamedItem(qualifiedName: string): AttrImpl | null {
    qualifiedName = this.#normalizeQualifiedName(qualifiedName);
    return this.find((attribute) => attribute.name === qualifiedName) ?? null;
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-getnameditemns
  getNamedItemNS(namespaceURI: string | null, localName: string): AttrImpl | null {
    if (namespaceURI === '') namespaceURI = null;
    return this.find((attribute) =>
      attribute.namespaceURI === namespaceURI &&
      attribute.localName === localName
    ) ?? null;
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-item
  item(index: number): AttrImpl | null {
    return this[index] ?? null;
  }

  /** Remove and return the named attribute, throwing NotFoundError when absent. */
  // https://dom.spec.whatwg.org/#dom-namednodemap-removenameditem
  removeNamedItem(qualifiedName: string): AttrImpl {
    qualifiedName = this.#normalizeQualifiedName(qualifiedName);
    return this.#remove((attribute) => attribute.name === qualifiedName);
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-removenameditemns
  removeNamedItemNS(namespaceURI: string | null, localName: string): AttrImpl {
    if (namespaceURI === '') namespaceURI = null;
    return this.#remove((attribute) =>
      attribute.namespaceURI === namespaceURI &&
      attribute.localName === localName
    );
  }

  /** Attach the attribute and return the attribute it replaces, if any. */
  // https://dom.spec.whatwg.org/#dom-namednodemap-setnameditem
  setNamedItem(attribute: AttrImpl): AttrImpl | null {
    return this.#set(attribute);
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-setnameditemns
  setNamedItemNS(attribute: AttrImpl): AttrImpl | null {
    return this.#set(attribute);
  }

  /** Attribute names eligible for named properties under this element's casing rules. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set(this.map((attribute) => attribute.name));
    if (this.#isForElementInHTMLDocument()) {
      for (const name of names) {
        if (asciiLower(name) !== name) names.delete(name);
      }
    }
    return names;
  }

  // -- Internal ---------------------------------------------------------

  /** Associate the map and any retained attributes with their owning element. */
  associateElement(element: ElementImpl): void {
    this.#element = element;
    for (const attribute of this) {
      attribute.ownerElement = element;
    }
  }

  // -- Private ----------------------------------------------------------

  #remove(matches: (attribute: AttrImpl) => boolean): AttrImpl {
    const index = this.findIndex(matches);
    if (index < 0) throwDOMException(DOMExceptionNames.notFound);
    const attribute = this.splice(index, 1)[0]!;
    attribute.ownerElement = null;
    this.#element?.attributeChanged(attribute.localName, attribute.value, null, attribute.namespaceURI);
    return attribute;
  }

  // https://dom.spec.whatwg.org/#concept-element-attributes-set
  #set(attribute: AttrImpl): AttrImpl | null {
    if (
      attribute.ownerElement !== null &&
      attribute.ownerElement !== this.#element
    ) {
      throwDOMException(DOMExceptionNames.inUseAttribute);
    }

    const previous = this.getNamedItemNS(attribute.namespaceURI, attribute.localName);
    if (previous === attribute) return attribute;
    if (previous) {
      this.splice(this.indexOf(previous), 1, attribute);
      previous.ownerElement = null;
    } else {
      this.push(attribute);
    }
    attribute.ownerElement = this.#element;
    this.#element?.attributeChanged(
      attribute.localName, previous?.value ?? null, attribute.value, attribute.namespaceURI,
    );
    return previous;
  }

  #isForElementInHTMLDocument(): boolean {
    return this.#element?.namespaceURI === HTML_NAMESPACE &&
      this.#element.ownerDocument!.type === 'html';
  }

  #normalizeQualifiedName(qualifiedName: string): string {
    return this.#isForElementInHTMLDocument()
      ? asciiLower(qualifiedName)
      : qualifiedName;
  }
}

/*
 * [Exposed=Window, LegacyUnenumerableNamedProperties]
 * interface NamedNodeMap {
 *   getter Attr? getNamedItem(DOMString qualifiedName);
 *   [CEReactions] Attr? setNamedItem(Attr attr);
 *   [CEReactions] Attr removeNamedItem(DOMString qualifiedName);
 *   getter Attr? item(unsigned long index);
 *   Attr? getNamedItemNS(DOMString? namespace, DOMString localName);
 *   [CEReactions] Attr? setNamedItemNS(Attr attr);
 *   [CEReactions] Attr removeNamedItemNS(DOMString? namespace, DOMString localName);
 *   readonly attribute unsigned long length;
 * };
 */
export const namedNodeMapIDL = defineInterface({
  name: 'NamedNodeMap',
  exposed: 'Window',
  ...xattr('LegacyUnenumerableNamedProperties'),
  implementation: impl(NamedNodeMapImpl),
  members: [
    op('getNamedItem', nullable(reference('Attr')),
      [arg('qualifiedName', idlType.DOMString)],
      namedGetter(
        (attributes: NamedNodeMapImpl) => attributes.getSupportedPropertyNames(),
      ),
    ),
    op('setNamedItem', nullable(reference('Attr')),
      [arg('attr', reference('Attr'))], xattr('CEReactions'),
    ),
    op('removeNamedItem', reference('Attr'),
      [arg('qualifiedName', idlType.DOMString)], xattr('CEReactions'),
    ),
    op('item', nullable(reference('Attr')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter(
        (attributes: NamedNodeMapImpl) => attributes.keys(),
        { unsupportedValue: null },
      ),
    ),
    op('getNamedItemNS', nullable(reference('Attr')), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('setNamedItemNS', nullable(reference('Attr')),
      [arg('attr', reference('Attr'))], xattr('CEReactions'),
    ),
    op('removeNamedItemNS', reference('Attr'),
      [
        arg('namespace', nullable(idlType.DOMString)),
        arg('localName', idlType.DOMString),
      ],
      xattr('CEReactions'),
    ),
    roAttr('length', idlType.unsignedLong),
  ],
});
