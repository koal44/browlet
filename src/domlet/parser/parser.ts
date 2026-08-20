import { html, parse, type Token, type TreeAdapter } from 'parse5';
import type { AttrImpl } from '../nodes/attribute';
import type { CommentImpl } from '../nodes/comment';
import {
  DocumentImpl, DocumentMode, type DomletDocument,
} from '../nodes/document';
import { DocumentTypeImpl } from '../nodes/document-type';
import { DocumentFragmentImpl } from '../nodes/document-fragment';
import { ElementImpl } from '../nodes/element';
import {
  directDOMNodeFactory, type DOMNodeFactory,
} from '../nodes/factory';
import type { TextImpl } from '../nodes/text';
import { asDocument } from '../stubs/interfaces';
import { TreeNode } from '../tree/tree-node';
import {
  isComment, isDocumentType, isElement, isText, NodeImpl,
} from '../nodes/node';

export class DomletParser implements TreeAdapter<DomletParserTreeAdapterMap> {
  #document!: DomletDocument;
  readonly #documentFactory: DOMNodeFactory;
  #pendingUnpushedElement: ElementImpl | null = null;

  constructor(documentFactory: DOMNodeFactory = directDOMNodeFactory) {
    this.#documentFactory = documentFactory;
  }

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
    const document = asDocument(this.#documentFactory.construct(
      DocumentImpl,
      [undefined, this.#documentFactory],
    ));
    this.#document = document;
    return document;
  }

  createDocumentFragment(): DocumentFragmentImpl {
    return this.#documentFactory.construct(
      DocumentFragmentImpl,
      [this.#document],
    );
  }

  createElement(
    tagName: string,
    namespaceURI: html.NS,
    attrs: Token.Attribute[],
  ): ElementImpl {
    const element = DocumentImpl.createElementNode(
      this.#document,
      tagName,
      namespaceURI,
      attrs.map((attribute) => fromParserAttribute(
        attribute,
        this.#document,
      )),
    );
    ElementImpl.beginParsingChildren(element);
    return element;
  }

  createCommentNode(data: string): CommentImpl {
    return this.#document.createComment(data);
  }

  createTextNode(value: string): TextImpl {
    return this.#document.createTextNode(value);
  }

  onItemPush(item: ElementImpl): void {
    if (this.#pendingUnpushedElement === item) {
      this.#pendingUnpushedElement = null;
    } else {
      this.#finishPendingUnpushedElement();
    }

    ElementImpl.beginParsingChildren(item);
  }

  onItemPop(item: ElementImpl, _newTop: NodeImpl): void {
    this.#finishPendingUnpushedElement();
    ElementImpl.finishParsingChildren(item);
  }

  appendChild(parentNode: NodeImpl, newNode: NodeImpl): void {
    this.#finishPendingUnpushedElement();
    TreeNode.appendChild(parentNode, newNode);
    if (isElement(newNode)) this.#pendingUnpushedElement = newNode;
  }

  insertBefore(
    parentNode: NodeImpl,
    newNode: NodeImpl,
    referenceNode: NodeImpl,
  ): void {
    this.#finishPendingUnpushedElement();
    TreeNode.insertSiblingBefore(referenceNode, newNode);
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
      TreeNode.appendChild(
        parentNode,
        this.#document.createTextNode(text),
      );
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
      recipient.attributes.push(fromParserAttribute(attr, this.#document));
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
    return NodeImpl.getParentNode(node);
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
    _contentElement: DocumentFragmentImpl,
  ): void {
    notImplemented('setTemplateContent');
  }

  getTemplateContent(_templateElement: ElementImpl): DocumentFragmentImpl {
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
      DocumentTypeImpl.setIdentifiers(
        doctype,
        name,
        publicId,
        systemId,
      );
      return;
    }

    const newDoctype = DocumentImpl.createDocumentType(
      document,
      name,
      publicId,
      systemId,
    );
    const documentElement = document.documentElement;

    if (documentElement) {
      TreeNode.insertSiblingBefore(documentElement, newDoctype);
    } else {
      TreeNode.appendChild(document, newDoctype);
    }
  }

  setDocumentMode(document: DocumentImpl, mode: html.DOCUMENT_MODE): void {
    switch (mode) {
      case html.DOCUMENT_MODE.NO_QUIRKS:
        DocumentImpl.setMode(document, DocumentMode.NoQuirks);
        break;
      case html.DOCUMENT_MODE.QUIRKS:
        DocumentImpl.setMode(document, DocumentMode.Quirks);
        break;
      case html.DOCUMENT_MODE.LIMITED_QUIRKS:
        DocumentImpl.setMode(document, DocumentMode.LimitedQuirks);
        break;
    }
  }

  getDocumentMode(document: DocumentImpl): html.DOCUMENT_MODE {
    switch (DocumentImpl.getMode(document)) {
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
    ElementImpl.finishParsingChildren(element);
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
  documentFragment: DocumentFragmentImpl;
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

function fromParserAttribute(
  attribute: Token.Attribute,
  document: DocumentImpl,
): AttrImpl {
  return DocumentImpl.createAttribute(
    document,
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
