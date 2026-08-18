import { html, parse, type Token, type TreeAdapter } from 'parse5';
import { AttrImpl } from '../nodes/attribute';
import { CommentImpl } from '../nodes/comment';
import {
  DocumentImpl, DocumentMode, type DomletDocument,
} from '../nodes/document';
import { DocumentTypeImpl } from '../nodes/document-type';
import { createElementNode, type ElementImpl } from '../nodes/element';
import { TextImpl } from '../nodes/text';
import { asDocument } from '../stubs/interfaces';
import {
  isComment, isDocumentType, isElement, isText,
  type NodeImpl,
} from '../nodes/node';

export class DomletParser implements TreeAdapter<DomletParserTreeAdapterMap> {
  #document!: DomletDocument;
  #pendingUnpushedElement: ElementImpl | null = null;

  parse(source: string): DomletDocument {
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

  createDocument(): DomletDocument {
    const document = asDocument(new DocumentImpl());
    this.#document = document;
    return document;
  }

  createDocumentFragment(): NodeImpl {
    return notImplemented('createDocumentFragment');
  }

  createElement(
    tagName: string,
    namespaceURI: html.NS,
    attrs: Token.Attribute[],
  ): ElementImpl {
    const element = createElementNode(
      tagName,
      namespaceURI,
      this.#document,
      attrs.map(fromParserAttribute),
    );
    element.__markAsParserCreated();
    element.beginParsingChildren();
    return element;
  }

  createCommentNode(data: string): CommentImpl {
    return new CommentImpl(data, this.#document);
  }

  createTextNode(value: string): TextImpl {
    return new TextImpl(value, this.#document);
  }

  onItemPush(item: ElementImpl): void {
    if (this.#pendingUnpushedElement === item) {
      this.#pendingUnpushedElement = null;
    } else {
      this.#finishPendingUnpushedElement();
    }

    item.beginParsingChildren();
  }

  onItemPop(item: ElementImpl, _newTop: NodeImpl): void {
    this.#finishPendingUnpushedElement();
    item.finishParsingChildren();
  }

  appendChild(parentNode: NodeImpl, newNode: NodeImpl): void {
    this.#finishPendingUnpushedElement();
    parentNode.appendTreeChild(newNode);
    if (isElement(newNode)) this.#pendingUnpushedElement = newNode;
  }

  insertBefore(
    parentNode: NodeImpl,
    newNode: NodeImpl,
    referenceNode: NodeImpl,
  ): void {
    this.#finishPendingUnpushedElement();
    referenceNode.insertTreeSiblingBefore(newNode);
    if (isElement(newNode)) this.#pendingUnpushedElement = newNode;
  }

  detachNode(node: NodeImpl): void {
    node.remove();
  }

  insertText(parentNode: NodeImpl, text: string): void {
    this.#finishPendingUnpushedElement();
    const lastChild = parentNode.lastChild;

    if (isText(lastChild)) {
      lastChild.data += text;
    } else {
      parentNode.appendTreeChild(new TextImpl(text));
    }
  }

  insertTextBefore(
    _parentNode: NodeImpl,
    _text: string,
    _referenceNode: NodeImpl,
  ): void {
    notImplemented('insertTextBefore');
  }

  adoptAttributes(recipient: ElementImpl, attrs: Token.Attribute[]): void {
    for (const attr of attrs) {
      if (recipient.hasAttributeNS(attr.namespace ?? null, attr.name)) continue;
      recipient.attributes.push(fromParserAttribute(attr));
    }
  }

  getFirstChild(node: NodeImpl): NodeImpl | null {
    return node.firstChild;
  }

  getChildNodes(node: NodeImpl): NodeImpl[] {
    const children: NodeImpl[] = [];

    for (let child = node.firstChild; child; child = child.nextSibling) {
      children.push(child);
    }

    return children;
  }

  getParentNode(node: NodeImpl): NodeImpl | null {
    return node.parent;
  }

  getAttrList(element: ElementImpl): Token.Attribute[] {
    return element.attributes.map(toParserAttribute);
  }

  getTagName(element: ElementImpl): string {
    return element.localName;
  }

  getNamespaceURI(element: ElementImpl): html.NS {
    return element.namespaceURI as html.NS;
  }

  getTextNodeContent(textNode: TextImpl): string {
    return textNode.data;
  }

  getCommentNodeContent(commentNode: CommentImpl): string {
    return commentNode.data;
  }

  getDocumentTypeNodeName(doctypeNode: DocumentTypeImpl): string {
    return doctypeNode.name;
  }

  getDocumentTypeNodePublicId(doctypeNode: DocumentTypeImpl): string {
    return doctypeNode.publicId;
  }

  getDocumentTypeNodeSystemId(doctypeNode: DocumentTypeImpl): string {
    return doctypeNode.systemId;
  }

  setTemplateContent(
    _templateElement: ElementImpl,
    _contentElement: NodeImpl,
  ): void {
    notImplemented('setTemplateContent');
  }

  getTemplateContent(_templateElement: ElementImpl): NodeImpl {
    return notImplemented('getTemplateContent');
  }

  setDocumentType(
    document: DocumentImpl,
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

    const newDoctype = new DocumentTypeImpl(
      name,
      publicId,
      systemId,
      document,
    );
    const documentElement = document.documentElement;

    if (documentElement) {
      documentElement.insertTreeSiblingBefore(newDoctype);
    } else {
      document.appendTreeChild(newDoctype);
    }
  }

  setDocumentMode(document: DocumentImpl, mode: html.DOCUMENT_MODE): void {
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

  getDocumentMode(document: DocumentImpl): html.DOCUMENT_MODE {
    switch (document.mode) {
      case DocumentMode.NoQuirks:
        return html.DOCUMENT_MODE.NO_QUIRKS;
      case DocumentMode.Quirks:
        return html.DOCUMENT_MODE.QUIRKS;
      case DocumentMode.LimitedQuirks:
        return html.DOCUMENT_MODE.LIMITED_QUIRKS;
    }
  }

  isElementNode(node: NodeImpl): node is ElementImpl {
    return isElement(node);
  }

  isTextNode(node: NodeImpl): node is TextImpl {
    return isText(node);
  }

  isCommentNode(node: NodeImpl): node is CommentImpl {
    return isComment(node);
  }

  isDocumentTypeNode(node: NodeImpl): node is DocumentTypeImpl {
    return isDocumentType(node);
  }

  setNodeSourceCodeLocation(
    node: NodeImpl,
    location: Token.ElementLocation | null,
  ): void {
    sourceCodeLocations.set(node, location);
  }

  getNodeSourceCodeLocation(
    node: NodeImpl,
  ): Token.ElementLocation | undefined | null {
    return getSourceCodeLocation(node);
  }

  updateNodeSourceCodeLocation(
    node: NodeImpl,
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
  node: NodeImpl,
): Token.ElementLocation | undefined | null {
  return sourceCodeLocations.get(node);
}

export type DomletParserTreeAdapterMap = {
  node: NodeImpl;
  parentNode: NodeImpl;
  childNode: NodeImpl;
  document: DomletDocument;
  documentFragment: NodeImpl;
  element: ElementImpl;
  commentNode: CommentImpl;
  textNode: TextImpl;
  template: ElementImpl;
  documentType: DocumentTypeImpl;
};

const sourceCodeLocations = new WeakMap<
  NodeImpl,
  Token.ElementLocation | null
>();

function notImplemented(operation: string): never {
  throw new Error(`Parser tree adapter ${operation} is not implemented`);
}

function fromParserAttribute(attribute: Token.Attribute): AttrImpl {
  return new AttrImpl(
    attribute.name,
    attribute.value,
    attribute.namespace ?? null,
    attribute.prefix || null,
  );
}

function toParserAttribute(attribute: AttrImpl): Token.Attribute {
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
