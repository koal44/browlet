import { Node, NodeType } from './node';
import type { Attribute } from './attribute';
import type { Document } from './document';
import {
  findElementsByClassName, findElementsByTagName, findElementsByTagNameNS,
} from './lookups';

export class Element extends Node {
  readonly nodeType = NodeType.Element;

  constructor(
    readonly localName: string,
    readonly namespaceURI: string,
    readonly attributes: Attribute[] = [],
    ownerDocument: Document | null = null,
  ) {
    super(ownerDocument);
  }

  getAttribute(qualifiedName: string): string | null {
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

  getElementsByClassName(classNames: string): Element[] {
    return findElementsByClassName(this, classNames);
  }

  getElementsByTagName(qualifiedName: string): Element[] {
    return findElementsByTagName(this, qualifiedName);
  }

  getElementsByTagNameNS(
    namespaceURI: string | null,
    localName: string,
  ): Element[] {
    return findElementsByTagNameNS(this, namespaceURI, localName);
  }
}

function normalizeNamespace(namespaceURI: string | null): string | null {
  return namespaceURI === '' ? null : namespaceURI;
}
