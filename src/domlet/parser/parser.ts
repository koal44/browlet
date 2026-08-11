import { html, parse, type Token, type TreeAdapter } from 'parse5';
import { Attribute } from '../nodes/attribute';
import { Comment } from '../nodes/comment';
import { Document, DocumentMode } from '../nodes/document';
import { DocumentType } from '../nodes/document-type';
import { createElementNode, type Element } from '../nodes/element';
import { Text } from '../nodes/text';
import { withCssEngine } from '../css-engine';
import {
  isComment, isDocumentType, isElement, isText,
  type Node,
} from '../nodes/node';

export class DomletParser implements TreeAdapter<DomletParserTreeAdapterMap> {
  #document: Document | null = null;
  #pendingUnpushedElement: Element | null = null;

  parse(source: string): Document {
    this.#document = null;
    this.#pendingUnpushedElement = null;

    const document = parse<DomletParserTreeAdapterMap>(source, {
      treeAdapter: this,
    });
    this.finishParsing();
    return document;
  }

  finishParsing(): void {
    this.#finishPendingUnpushedElement();
  }

  createDocument(): Document {
    const document = withCssEngine(new Document());
    this.#document = document;
    return document;
  }

  createDocumentFragment(): Node {
    return notImplemented('createDocumentFragment');
  }

  createElement(
    tagName: string,
    namespaceURI: html.NS,
    attrs: Token.Attribute[],
  ): Element {
    const element = createElementNode(
      tagName,
      namespaceURI,
      attrs.map(fromParserAttribute),
      this.#document,
    );
    element.beginParsingChildren();
    return element;
  }

  createCommentNode(data: string): Comment {
    return new Comment(data, this.#document);
  }

  createTextNode(value: string): Text {
    return new Text(value, this.#document);
  }

  onItemPush(item: Element): void {
    if (this.#pendingUnpushedElement === item) {
      this.#pendingUnpushedElement = null;
    } else {
      this.#finishPendingUnpushedElement();
    }

    item.beginParsingChildren();
  }

  onItemPop(item: Element, _newTop: Node): void {
    this.#finishPendingUnpushedElement();
    item.finishParsingChildren();
  }

  appendChild(parentNode: Node, newNode: Node): void {
    this.#finishPendingUnpushedElement();
    parentNode.appendChild(newNode);
    if (isElement(newNode)) this.#pendingUnpushedElement = newNode;
  }

  insertBefore(
    _parentNode: Node,
    newNode: Node,
    referenceNode: Node,
  ): void {
    this.#finishPendingUnpushedElement();
    referenceNode.insertBefore(newNode);
    if (isElement(newNode)) this.#pendingUnpushedElement = newNode;
  }

  detachNode(node: Node): void {
    node.remove();
  }

  insertText(parentNode: Node, text: string): void {
    this.#finishPendingUnpushedElement();
    const lastChild = parentNode.lastChild;

    if (isText(lastChild)) {
      lastChild.data += text;
    } else {
      parentNode.appendChild(new Text(text));
    }
  }

  insertTextBefore(
    _parentNode: Node,
    _text: string,
    _referenceNode: Node,
  ): void {
    notImplemented('insertTextBefore');
  }

  adoptAttributes(recipient: Element, attrs: Token.Attribute[]): void {
    for (const attr of attrs) {
      if (recipient.hasAttributeNS(attr.namespace ?? null, attr.name)) continue;
      recipient.attributes.push(fromParserAttribute(attr));
    }
  }

  getFirstChild(node: Node): Node | null {
    return node.firstChild as Node | null;
  }

  getChildNodes(node: Node): Node[] {
    const children: Node[] = [];

    for (let child = node.firstChild; child; child = child.nextSibling) {
      children.push(child as Node);
    }

    return children;
  }

  getParentNode(node: Node): Node | null {
    return node.parent as Node | null;
  }

  getAttrList(element: Element): Token.Attribute[] {
    return element.attributes.map(toParserAttribute);
  }

  getTagName(element: Element): string {
    return element.localName;
  }

  getNamespaceURI(element: Element): html.NS {
    return element.namespaceURI as html.NS;
  }

  getTextNodeContent(textNode: Text): string {
    return textNode.data;
  }

  getCommentNodeContent(commentNode: Comment): string {
    return commentNode.data;
  }

  getDocumentTypeNodeName(doctypeNode: DocumentType): string {
    return doctypeNode.name;
  }

  getDocumentTypeNodePublicId(doctypeNode: DocumentType): string {
    return doctypeNode.publicId;
  }

  getDocumentTypeNodeSystemId(doctypeNode: DocumentType): string {
    return doctypeNode.systemId;
  }

  setTemplateContent(
    _templateElement: Element,
    _contentElement: Node,
  ): void {
    notImplemented('setTemplateContent');
  }

  getTemplateContent(_templateElement: Element): Node {
    return notImplemented('getTemplateContent');
  }

  setDocumentType(
    document: Document,
    name: string,
    publicId: string,
    systemId: string,
  ): void {
    const doctype = document.doctype;

    if (doctype) {
      doctype.name = name;
      doctype.publicId = publicId;
      doctype.systemId = systemId;
      return;
    }

    const newDoctype = new DocumentType(name, publicId, systemId, document);
    const documentElement = document.documentElement;

    if (documentElement) {
      documentElement.insertBefore(newDoctype);
    } else {
      document.appendChild(newDoctype);
    }
  }

  setDocumentMode(document: Document, mode: html.DOCUMENT_MODE): void {
    switch (mode) {
      case html.DOCUMENT_MODE.NO_QUIRKS:
        document.mode = DocumentMode.NoQuirks;
        break;
      case html.DOCUMENT_MODE.QUIRKS:
        document.mode = DocumentMode.Quirks;
        break;
      case html.DOCUMENT_MODE.LIMITED_QUIRKS:
        document.mode = DocumentMode.LimitedQuirks;
        break;
    }
  }

  getDocumentMode(document: Document): html.DOCUMENT_MODE {
    switch (document.mode) {
      case DocumentMode.NoQuirks:
        return html.DOCUMENT_MODE.NO_QUIRKS;
      case DocumentMode.Quirks:
        return html.DOCUMENT_MODE.QUIRKS;
      case DocumentMode.LimitedQuirks:
        return html.DOCUMENT_MODE.LIMITED_QUIRKS;
    }
  }

  isElementNode(node: Node): node is Element {
    return isElement(node);
  }

  isTextNode(node: Node): node is Text {
    return isText(node);
  }

  isCommentNode(node: Node): node is Comment {
    return isComment(node);
  }

  isDocumentTypeNode(node: Node): node is DocumentType {
    return isDocumentType(node);
  }

  setNodeSourceCodeLocation(
    node: Node,
    location: Token.ElementLocation | null,
  ): void {
    sourceCodeLocations.set(node, location);
  }

  getNodeSourceCodeLocation(
    node: Node,
  ): Token.ElementLocation | undefined | null {
    return getSourceCodeLocation(node);
  }

  updateNodeSourceCodeLocation(
    node: Node,
    location: Partial<Token.ElementLocation>,
  ): void {
    const current = getSourceCodeLocation(node);
    if (current) Object.assign(current, location);
  }

  #finishPendingUnpushedElement(): void {
    const element = this.#pendingUnpushedElement;
    if (!element) return;

    this.#pendingUnpushedElement = null;
    element.finishParsingChildren();
  }
}

export function getSourceCodeLocation(
  node: Node,
): Token.ElementLocation | undefined | null {
  return sourceCodeLocations.get(node);
}

export type DomletParserTreeAdapterMap = {
  node: Node;
  parentNode: Node;
  childNode: Node;
  document: Document;
  documentFragment: Node;
  element: Element;
  commentNode: Comment;
  textNode: Text;
  template: Element;
  documentType: DocumentType;
};

const sourceCodeLocations = new WeakMap<
  Node,
  Token.ElementLocation | null
>();

function notImplemented(operation: string): never {
  throw new Error(`Parser tree adapter ${operation} is not implemented`);
}

function fromParserAttribute(attribute: Token.Attribute): Attribute {
  return new Attribute(
    attribute.name,
    attribute.value,
    attribute.namespace ?? null,
    attribute.prefix || null,
  );
}

function toParserAttribute(attribute: Attribute): Token.Attribute {
  const result: Token.Attribute = {
    name: attribute.localName,
    value: attribute.value,
  };

  if (attribute.namespaceURI !== null) {
    result.namespace = attribute.namespaceURI;
  }

  if (attribute.prefix !== null) {
    result.prefix = attribute.prefix;
  }

  return result;
}
