import { describe, expect, it } from 'vitest';

import {
  Document, DocumentMode, withDocumentWriter,
} from '../../../../src/domlet/nodes/document';
import { DocumentType } from '../../../../src/domlet/nodes/document-type';
import {
  isComment, isDocument, isDocumentType, isElement, isText, NodeType,
} from '../../../../src/domlet/nodes/node';

describe('Document', () => {
  it('always has a base URI', () => {
    expect(new Document().baseURI).toBe('about:blank');
    expect(new Document('https://example.com/').baseURI)
      .toBe('https://example.com/');
  });

  it('is the tree root and exposes its first element child', () => {
    const document = new Document();
    const text = document.createTextNode('before');
    const element = document.createElement('html');

    document.appendChild(text);
    document.appendChild(element);

    expect(document.nodeType).toBe(NodeType.Document);
    expect(document.documentElement).toBe(element);
    expect(element.nodeType).toBe(NodeType.Element);
    expect(element.parent).toBe(document);
  });

  it('exposes its doctype separately from its document element', () => {
    const document = new Document();
    const doctype = new DocumentType('html', '', '');
    const element = document.createElement('html');

    document.appendChild(doctype);
    document.appendChild(element);

    expect(document.doctype).toBe(doctype);
    expect(document.documentElement).toBe(element);
    expect(document.mode).toBe(DocumentMode.NoQuirks);
  });

  it('creates HTML elements and text nodes', () => {
    const document = new Document();
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
    const document = new Document();

    expect(document.contentType).toBe('text/html');
    expect(document.compatMode).toBe('CSS1Compat');

    document.mode = DocumentMode.Quirks;

    expect(document.compatMode).toBe('BackCompat');
  });

  it('discriminates its node types without constructor identity', () => {
    const document = new Document();
    const doctype = new DocumentType('html', '', '');
    const element = document.createElement('main');
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
    const document = new Document();

    expect(() => document.write('<main></main>')).toThrow(
      'Document has no active parser',
    );
  });

  it('limits document.write to the active writer scope', () => {
    const document = new Document();
    const writes: string[] = [];

    withDocumentWriter(document, (markup) => writes.push(markup), () => {
      document.write('<main>', '</main>');
    });

    expect(writes).toEqual(['<main></main>']);
    expect(() => document.write('<aside></aside>')).toThrow(
      'Document has no active parser',
    );
  });
});
