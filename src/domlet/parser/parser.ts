import {
  html,
  parse as parseHTML,
  type Token,
  type TreeAdapter,
} from 'parse5';

import { Attribute } from '../nodes/attribute';
import { Comment } from '../nodes/comment';
import {
  Document, DocumentMode,
} from '../nodes/document';
import { DocumentType } from '../nodes/document-type';
import { Element } from '../nodes/element';
import { Text } from '../nodes/text';
import {
  isComment, isDocumentType, isElement, isText,
  type Node,
} from '../nodes/node';

export class Parser implements TreeAdapter<ParserTreeAdapterMap> {
  #document: Document | null = null;

  parse(source: string): Document {
    this.#document = null;
    return parseHTML<ParserTreeAdapterMap>(source, { treeAdapter: this });
  }

  createDocument(): Document {
    const document = new Document();
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
    return new Element(
      tagName,
      namespaceURI,
      attrs.map(fromParserAttribute),
      this.#document,
    );
  }

  createCommentNode(data: string): Comment {
    return new Comment(data, this.#document);
  }

  createTextNode(value: string): Text {
    return new Text(value, this.#document);
  }

  appendChild(parentNode: Node, newNode: Node): void {
    parentNode.appendChild(newNode);
  }

  insertBefore(
    _parentNode: Node,
    newNode: Node,
    referenceNode: Node,
  ): void {
    referenceNode.insertBefore(newNode);
  }

  detachNode(node: Node): void {
    node.remove();
  }

  insertText(parentNode: Node, text: string): void {
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
    _node: Node,
    _location: Token.ElementLocation | null,
  ): void {
    notImplemented('setNodeSourceCodeLocation');
  }

  getNodeSourceCodeLocation(
    _node: Node,
  ): Token.ElementLocation | undefined | null {
    return notImplemented('getNodeSourceCodeLocation');
  }

  updateNodeSourceCodeLocation(
    _node: Node,
    _location: Partial<Token.ElementLocation>,
  ): void {
    notImplemented('updateNodeSourceCodeLocation');
  }
}

type ParserTreeAdapterMap = {
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
