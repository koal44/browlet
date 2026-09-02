import {
  domExceptionName, throwDOMException,
} from '../../../shared/dom-exception';
import {
  arg, defineInterface, idlType, indexedGetter, namedGetter, nullable, op,
  roAttr, reference, xattr,
} from '../../../web-idl/declaration/index';
import { bind, impl } from '../../../web-idl/index';
import { asciiLower } from '../../../shared/css';
import { HTML_NAMESPACE } from '../../../infra/index';
import { AttrImpl } from './attribute';
import type { ElementImpl } from './element';

export class NamedNodeMapImpl
  extends Array<AttrImpl>
  implements NamedNodeMap
{
  #element: ElementImpl | null = null;

  getNamedItem(qualifiedName: string): AttrImpl | null {
    qualifiedName = this.#normalizeQualifiedName(qualifiedName);
    return this.find((attribute) => attribute.name === qualifiedName) ?? null;
  }

  getNamedItemNS(
    namespaceURI: string | null,
    localName: string,
  ): AttrImpl | null {
    if (namespaceURI === '') namespaceURI = null;
    return this.find((attribute) =>
      attribute.namespaceURI === namespaceURI &&
      attribute.localName === localName
    ) ?? null;
  }

  item(index: number): AttrImpl | null {
    return this[index] ?? null;
  }

  removeNamedItem(qualifiedName: string): AttrImpl {
    qualifiedName = this.#normalizeQualifiedName(qualifiedName);
    return this.#remove((attribute) => attribute.name === qualifiedName);
  }

  removeNamedItemNS(namespaceURI: string | null, localName: string): AttrImpl {
    if (namespaceURI === '') namespaceURI = null;
    return this.#remove((attribute) =>
      attribute.namespaceURI === namespaceURI &&
      attribute.localName === localName
    );
  }

  setNamedItem(attribute: AttrImpl): AttrImpl | null {
    return this.#set(attribute);
  }

  setNamedItemNS(attribute: AttrImpl): AttrImpl | null {
    return this.#set(attribute);
  }

  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set(this.map((attribute) => attribute.name));
    if (this.#isForElementInHTMLDocument()) {
      for (const name of names) {
        if (asciiLower(name) !== name) names.delete(name);
      }
    }
    return names;
  }

  getSupportedPropertyIndices(): ReadonlySet<number> {
    return new Set(this.keys());
  }

  // -- Friends ----------------------------------------------------------

  static associateElement(
    attributes: NamedNodeMapImpl,
    element: ElementImpl,
  ): void {
    attributes.#element = element;
    for (const attribute of attributes) {
      AttrImpl.setOwnerElement(attribute, element);
    }
  }

  // -- Private ----------------------------------------------------------

  #remove(matches: (attribute: AttrImpl) => boolean): AttrImpl {
    const index = this.findIndex(matches);
    if (index < 0) throwDOMException(domExceptionName.notFound);
    const attribute = this.splice(index, 1)[0]!;
    AttrImpl.setOwnerElement(attribute, null);
    return attribute;
  }

  #set(attribute: AttrImpl): AttrImpl | null {
    if (
      attribute.ownerElement !== null &&
      attribute.ownerElement !== this.#element
    ) {
      throwDOMException(domExceptionName.inUseAttribute);
    }

    const previous = attribute.namespaceURI === null
      ? this.getNamedItem(attribute.name)
      : this.getNamedItemNS(attribute.namespaceURI, attribute.localName);
    if (previous) {
      this.splice(this.indexOf(previous), 1, attribute);
      AttrImpl.setOwnerElement(previous, null);
    } else {
      this.push(attribute);
    }
    AttrImpl.setOwnerElement(attribute, this.#element);
    return previous;
  }

  #isForElementInHTMLDocument(): boolean {
    return this.#element?.namespaceURI === HTML_NAMESPACE &&
      this.#element.ownerDocument.type === 'html';
  }

  #normalizeQualifiedName(qualifiedName: string): string {
    return this.#isForElementInHTMLDocument()
      ? asciiLower(qualifiedName)
      : qualifiedName;
  }
}

// -- Web IDL ------------------------------------------------------------

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
    op('getNamedItem', nullable(reference('Attr')), [
      arg('qualifiedName', idlType.DOMString),
    ], namedGetter(
      (attributes: NamedNodeMapImpl) =>
        attributes.getSupportedPropertyNames(),
    )),
    op('setNamedItem', nullable(reference('Attr')), [
      arg('attr', reference('Attr')),
    ], xattr('CEReactions')),
    op('removeNamedItem', reference('Attr'), [
      arg('qualifiedName', idlType.DOMString),
    ], xattr('CEReactions')),
    op('item', nullable(reference('Attr')), [
      arg('index', idlType.unsignedLong),
    ], indexedGetter(
      (attributes: NamedNodeMapImpl) =>
        attributes.getSupportedPropertyIndices(),
    )),
    op('getNamedItemNS', nullable(reference('Attr')), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ]),
    op('setNamedItemNS', nullable(reference('Attr')), [
      arg('attr', reference('Attr')),
    ], xattr('CEReactions')),
    op('removeNamedItemNS', reference('Attr'), [
      arg('namespace', nullable(idlType.DOMString)),
      arg('localName', idlType.DOMString),
    ], xattr('CEReactions')),
    roAttr('length', idlType.unsignedLong, bind({
      get() {
        return (this as NamedNodeMapImpl).length;
      },
    })),
  ],
});
