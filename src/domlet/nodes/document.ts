import { Comment } from './comment';
import {
  createElementNode, HTML_NAMESPACE, type Element,
} from './element';
import {
  isDocumentType, isElement, Node, NodeType,
} from './node';
import { Text } from './text';
import type { DocumentType } from './document-type';
import {
  findElementById, findElementsByClassName, findElementsByTagName,
  findElementsByTagNameNS,
} from './lookups';
import { getStyleSheets } from '../css-engine';

export class Document extends Node {
  readonly nodeType = NodeType.Document;
  readonly contentType = 'text/html';
  readonly baseURI: string;
  mode = DocumentMode.NoQuirks;

  constructor(baseURI = 'about:blank') {
    super();
    this.baseURI = baseURI;
  }

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

  get styleSheets(): StyleSheetList {
    return getStyleSheets(this);
  }

  createElement(
    localName: string,
    namespaceURI = HTML_NAMESPACE,
  ): Element {
    return createElementNode(localName, namespaceURI, [], this);
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

  write(...text: string[]): void {
    const writer = documentWriters.get(this);

    if (!writer) {
      throw new Error('Document has no active parser');
    }

    writer(text.join(''));
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

export function withDocumentWriter<T>(
  document: Document,
  writer: DocumentWriter,
  callback: () => T,
): T {
  const previousWriter = documentWriters.get(document);
  documentWriters.set(document, writer);

  try {
    return callback();
  } finally {
    if (previousWriter) {
      documentWriters.set(document, previousWriter);
    } else {
      documentWriters.delete(document);
    }
  }
}

export type DocumentWriter = (markup: string) => void;

export enum DocumentMode {
  NoQuirks = 'no-quirks',
  Quirks = 'quirks',
  LimitedQuirks = 'limited-quirks',
}

const documentWriters = new WeakMap<Document, DocumentWriter>();
