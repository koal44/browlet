import { asciiLower } from '../../../infra/ascii';
import { HTML_NAMESPACE } from '../../../infra/index';
import {
  arg, defineInterface, idlType, impl, indexedGetter, nullable, op, reference,
  roAttr, xattr, DOMExceptionNames, DOMExceptionImpl,
} from '../../../web-idl/core/index';

import type { AttrImpl } from './attribute';
import type { ElementImpl } from './element';

/** Live named/indexed view of an element's attribute list; mutations belong to the element. */
// https://dom.spec.whatwg.org/#interface-namednodemap
export class NamedNodeMapImpl {
  #element: ElementImpl;

  constructor(element: ElementImpl) {
    this.#element = element;
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-length
  get length(): number {
    return this.#element.attributeList.length;
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-item
  item(index: number): AttrImpl | null {
    return this.#element.attributeList[index] ?? null;
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-getnameditem
  getNamedItem(qualifiedName: string): AttrImpl | null {
    return this.#element.getAttributeNode(qualifiedName);
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-getnameditemns
  getNamedItemNS(namespace: string | null, localName: string): AttrImpl | null {
    return this.#element.getAttributeNodeNS(namespace, localName);
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-setnameditem
  setNamedItem(attribute: AttrImpl): AttrImpl | null {
    return this.#element.setAttributeNode(attribute);
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-setnameditemns
  setNamedItemNS(attribute: AttrImpl): AttrImpl | null {
    return this.#element.setAttributeNode(attribute);
  }

  /** Remove and return the named attribute, throwing NotFoundError when absent. */
  // https://dom.spec.whatwg.org/#dom-namednodemap-removenameditem
  removeNamedItem(qualifiedName: string): AttrImpl {
    const attribute = this.#element.getAttributeNode(qualifiedName);
    if (attribute === null) throw new DOMExceptionImpl('', DOMExceptionNames.notFound);
    return this.#element.removeAttributeNode(attribute);
  }

  // https://dom.spec.whatwg.org/#dom-namednodemap-removenameditemns
  removeNamedItemNS(namespace: string | null, localName: string): AttrImpl {
    const attribute = this.#element.getAttributeNodeNS(namespace, localName);
    if (attribute === null) throw new DOMExceptionImpl('', DOMExceptionNames.notFound);
    return this.#element.removeAttributeNode(attribute);
  }

  /** Live indices supplied to the Web IDL indexed-property binding. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#element.attributeList.keys();
  }

  /** Ordered unique names eligible for named properties under the element's casing rules. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set<string>();
    const lowercaseOnly = this.#element.namespaceURI === HTML_NAMESPACE && this.#element.nodeDocument.type === 'html';
    for (const attribute of this.#element.attributeList) {
      const name = attribute.name;
      if (!lowercaseOnly || asciiLower(name) === name) names.add(name);
    }
    return names;
  }
}

/*
 * [Exposed=Window, LegacyUnenumerableNamedProperties]
 * interface NamedNodeMap {
 *   readonly attribute unsigned long length;
 *   getter Attr? item(unsigned long index);
 *   getter Attr? getNamedItem(DOMString qualifiedName);
 *   Attr? getNamedItemNS(DOMString? namespace, DOMString localName);
 *   [CEReactions] Attr? setNamedItem(Attr attr);
 *   [CEReactions] Attr? setNamedItemNS(Attr attr);
 *   [CEReactions] Attr removeNamedItem(DOMString qualifiedName);
 *   [CEReactions] Attr removeNamedItemNS(DOMString? namespace, DOMString localName);
 * };
 */
export const namedNodeMapIDL = defineInterface({
  name: 'NamedNodeMap',
  exposed: 'Window',
  ...xattr('LegacyUnenumerableNamedProperties'),
  implementation: impl(NamedNodeMapImpl),
  members: [
    roAttr('length', idlType.unsignedLong),
    op('item', nullable(reference('Attr')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter(
        (attributes: NamedNodeMapImpl) => attributes.getSupportedPropertyIndices(),
        { unsupportedValue: null },
      ),
    ),
    {
      kind: 'named-getter', name: 'getNamedItem', method: 'getNamedItem',
      argumentName: 'qualifiedName', returns: nullable(reference('Attr')),
    },
    op('getNamedItemNS', nullable(reference('Attr')), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('setNamedItem', nullable(reference('Attr')),
      [arg('attr', reference('Attr'))], xattr('CEReactions'),
    ),
    op('setNamedItemNS', nullable(reference('Attr')),
      [arg('attr', reference('Attr'))], xattr('CEReactions'),
    ),
    op('removeNamedItem', reference('Attr'),
      [arg('qualifiedName', idlType.DOMString)], xattr('CEReactions'),
    ),
    op('removeNamedItemNS', reference('Attr'),
      [
        arg('namespace', nullable(idlType.DOMString)),
        arg('localName', idlType.DOMString),
      ],
      xattr('CEReactions'),
    ),
  ],
});
