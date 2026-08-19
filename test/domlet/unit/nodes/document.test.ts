import { describe, expect, it } from 'vitest';

import {
  DocumentImpl, DocumentMode,
} from '../../../../src/domlet/nodes/document';
import { DocumentTypeImpl } from '../../../../src/domlet/nodes/document-type';
import {
  HTMLElementImpl, HTMLHeadElementImpl,
} from '../../../../src/domlet/nodes/element';
import {
  isComment, isDocument, isDocumentType, isElement, isText, NodeType,
} from '../../../../src/domlet/nodes/node';

describe('Document', () => {
  it('always has a base URI', () => {
    expect(new DocumentImpl().baseURI).toBe('about:blank');
    expect(new DocumentImpl('https://example.com/').baseURI)
      .toBe('https://example.com/');
  });

  it('is the tree root and exposes its first element child', () => {
    const document = new DocumentImpl();
    const text = document.createTextNode('before');
    const element = document.createElement('html');

    expect(document.documentElement).toBeNull();

    document.appendChild(text);
    document.appendChild(element);

    expect(document.nodeType).toBe(NodeType.Document);
    expect(document.documentElement).toBe(element);
    expect(element.nodeType).toBe(NodeType.Element);
    expect(element.parentNode).toBe(document);
  });

  it('exposes its doctype separately from its document element', () => {
    const document = new DocumentImpl();
    const doctype = new DocumentTypeImpl('html', '', '');
    const element = document.createElement('html');

    document.appendChild(doctype);
    document.appendChild(element);

    expect(document.doctype).toBe(doctype);
    expect(document.documentElement).toBe(element);
    expect(DocumentImpl.getMode(document)).toBe(DocumentMode.NoQuirks);
  });

  it('derives its head from the HTML document tree', () => {
    const document = new DocumentImpl();
    const html = document.createElement('html');
    const head = document.createElement('head');

    expect(head).toBeInstanceOf(HTMLHeadElementImpl);
    expect(document.head).toBeNull();

    document.appendChild(html);
    expect(document.head).toBeNull();

    html.appendChild(head);
    expect(document.head).toBe(head);
  });

  it('creates HTML elements and text nodes', () => {
    const document = new DocumentImpl();
    const element = document.createElement('MaIn');
    const text = document.createTextNode('content');
    const comment = document.createComment('note');

    expect(element.localName).toBe('main');
    expect(element.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(element.ownerDocument).toBe(document);
    expect(text.ownerDocument).toBe(document);
    expect(comment.ownerDocument).toBe(document);
    expect(text.nodeType).toBe(NodeType.Text);
    expect(text.data).toBe('content');
    expect(comment.nodeType).toBe(NodeType.Comment);
    expect(comment.data).toBe('note');
  });

  it('identifies HTML and compatibility mode', () => {
    const document = new DocumentImpl();

    expect(document.contentType).toBe('text/html');
    expect(document.compatMode).toBe('CSS1Compat');

    DocumentImpl.setMode(document, DocumentMode.Quirks);

    expect(document.compatMode).toBe('BackCompat');
  });

  it('discriminates its node types without constructor identity', () => {
    const document = new DocumentImpl();
    const doctype = new DocumentTypeImpl('html', '', '');
    const element = new HTMLElementImpl('main', document);
    const text = document.createTextNode('content');
    const comment = document.createComment('note');

    expect(isDocument(document)).toBe(true);
    expect(isDocumentType(doctype)).toBe(true);
    expect(isElement(element)).toBe(true);
    expect(isText(text)).toBe(true);
    expect(isComment(comment)).toBe(true);
    expect(isElement(text)).toBe(false);
  });

  it('rejects document.write without an active parser', () => {
    const document = new DocumentImpl();

    expect(() => document.write('<main></main>')).toThrow(
      'Document has no active parser',
    );
  });

  it('limits document.write to the active writer scope', () => {
    const document = new DocumentImpl();
    const writes: string[] = [];

    DocumentImpl.withWriter(document, (markup) => writes.push(markup), () => {
      document.write('<main>', '</main>');
    });

    expect(writes).toEqual(['<main></main>']);
    expect(() => document.write('<aside></aside>')).toThrow(
      'Document has no active parser',
    );
  });
});
