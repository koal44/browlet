import { Comment } from './comment';
import { Element } from './element';
import {
  isDocumentType, isElement, Node, NodeType,
} from './node';
import { Text } from './text';
import type { DocumentType } from './document-type';
import {
  findElementById, findElementsByClassName, findElementsByTagName,
  findElementsByTagNameNS,
} from './lookups';

export class Document extends Node {
  readonly nodeType = NodeType.Document;
  readonly contentType = 'text/html';
  mode = DocumentMode.NoQuirks;

  get compatMode(): 'BackCompat' | 'CSS1Compat' {
    return this.mode === DocumentMode.Quirks ? 'BackCompat' : 'CSS1Compat';
  }

  get doctype(): DocumentType | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (isDocumentType(child)) return child;
    }

    return null;
  }

  get documentElement(): Element | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (isElement(child)) return child;
    }

    return null;
  }

  createElement(
    localName: string,
    namespaceURI = HTML_NAMESPACE,
  ): Element {
    const normalizedName = namespaceURI === HTML_NAMESPACE
      ? asciiLower(localName)
      : localName;

    return new Element(normalizedName, namespaceURI, [], this);
  }

  createTextNode(data: string): Text {
    return new Text(data, this);
  }

  createComment(data: string): Comment {
    return new Comment(data, this);
  }

  addEventListener(
    _type: string,
    _listener: unknown,
    _options?: unknown,
  ): void {}

  removeEventListener(
    _type: string,
    _listener: unknown,
    _options?: unknown,
  ): void {}

  dispatchEvent(_event: unknown): boolean {
    return true;
  }

  getElementById(id: string): Element | null {
    return findElementById(this, id);
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

export enum DocumentMode {
  NoQuirks = 'no-quirks',
  Quirks = 'quirks',
  LimitedQuirks = 'limited-quirks',
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
