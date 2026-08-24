import {
  domExceptionName, throwDOMException,
} from '../../shared/dom-exception';
import { AttrImpl } from './attribute';
import type { ElementImpl } from './element';

export class NamedNodeMapImpl
  extends Array<AttrImpl>
  implements NamedNodeMap
{
  #element: ElementImpl | null = null;

  getNamedItem(qualifiedName: string): AttrImpl | null {
    return this.find((attribute) => attribute.name === qualifiedName) ?? null;
  }

  getNamedItemNS(
    namespaceURI: string | null,
    localName: string,
  ): AttrImpl | null {
    return this.find((attribute) =>
      attribute.namespaceURI === namespaceURI &&
      attribute.localName === localName
    ) ?? null;
  }

  item(index: number): AttrImpl | null {
    return this[index] ?? null;
  }

  removeNamedItem(qualifiedName: string): AttrImpl {
    return this.#remove((attribute) => attribute.name === qualifiedName);
  }

  removeNamedItemNS(namespaceURI: string | null, localName: string): AttrImpl {
    return this.#remove((attribute) =>
      attribute.namespaceURI === namespaceURI &&
      attribute.localName === localName
    );
  }

  setNamedItem(attribute: Attr): AttrImpl | null {
    return this.#set(attribute);
  }

  setNamedItemNS(attribute: Attr): AttrImpl | null {
    return this.#set(attribute);
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

  #set(attribute: Attr): AttrImpl | null {
    if (!AttrImpl.is(attribute)) {
      throwDOMException(domExceptionName.wrongDocument);
    }
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
}
