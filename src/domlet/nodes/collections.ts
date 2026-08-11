import { AttrImpl } from './attribute';

export class HTMLCollectionImpl<T extends Element = Element>
  extends Array<T>
  implements HTMLCollectionOf<T>
{
  item(index: number): T | null {
    return this[index] ?? null;
  }

  namedItem(name: string): T | null {
    return this.find((element) =>
      element.getAttribute('id') === name ||
      element.getAttribute('name') === name
    ) ?? null;
  }
}

export class NamedNodeMapImpl
  extends Array<AttrImpl>
  implements NamedNodeMap
{
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

  #remove(matches: (attribute: AttrImpl) => boolean): AttrImpl {
    const index = this.findIndex(matches);
    if (index < 0) throw new DOMException('', 'NotFoundError');
    return this.splice(index, 1)[0]!;
  }

  #set(attribute: Attr): AttrImpl | null {
    if (!(attribute instanceof AttrImpl)) {
      throw new DOMException('', 'WrongDocumentError');
    }

    const previous = attribute.namespaceURI === null
      ? this.getNamedItem(attribute.name)
      : this.getNamedItemNS(attribute.namespaceURI, attribute.localName);
    if (previous) this.splice(this.indexOf(previous), 1, attribute);
    else this.push(attribute);
    return previous;
  }
}
