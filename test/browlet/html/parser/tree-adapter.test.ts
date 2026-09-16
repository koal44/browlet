import { html, parse, type Token } from 'parse5';
import { describe, expect, it } from 'vitest';

import {
  createDocument, DocumentImpl, DocumentMode,
} from '../../../../src/browlet/dom/nodes/document';
import {
  DocumentFragmentImpl,
} from '../../../../src/browlet/dom/nodes/document-fragment';
import { isComment } from '../../../../src/browlet/dom/nodes/node';
import {
  getSourceCodeLocation, HTMLTreeAdapter, type HTMLTreeAdapterMap,
} from '../../../../src/browlet/html/parser/tree-adapter';

describe('Parser tree adapter', () => {
  it('creates document fragments in its current document', () => {
    const parser = createParser();
    const document = parser.createDocument();
    const fragment = parser.createDocumentFragment();

    expect(fragment).toBeInstanceOf(DocumentFragmentImpl);
    expect(fragment.ownerDocument).toBe(document);
  });

  it('parses a basic HTML document and derives its compatibility mode', () => {
    const standards = createParser()
      .parse('<!doctype html><main>content</main>');
    const quirks = createParser().parse('<main>content</main>');

    expect(standards.getMode()).toBe(DocumentMode.NoQuirks);
    expect(standards.type).toBe('html');
    expect(standards.contentType).toBe('text/html');
    expect(standards.URL).toBe('about:blank');
    expect(standards.characterSet).toBe('UTF-8');
    expect(standards.doctype?.name).toBe('html');
    expect(standards.documentElement?.localName).toBe('html');
    expect(quirks.getMode()).toBe(DocumentMode.Quirks);
  });

  it('parses comments as comment nodes', () => {
    const document = createParser().parse('<!--note--><main></main>');
    const comment = document.firstChild;

    expect(isComment(comment)).toBe(true);
    if (!isComment(comment)) throw new Error('Expected a comment node');
    expect(comment.data).toBe('note');
  });

  it('retains source locations for parsed elements and merged text', () => {
    const adapter = createParser();
    const document = parse<HTMLTreeAdapterMap>([
      '<!doctype html>',
      '<main id="target">',
      '  one &amp; two',
      '</main>',
    ].join('\n'), { treeAdapter: adapter, sourceCodeLocationInfo: true });
    adapter.finishParsing();
    const root = document.documentElement;
    const main = document.getElementById('target');
    if (!root || !main?.firstChild) throw new Error('Expected the parsed document and its text');

    expect(getSourceCodeLocation(document)).toBeUndefined();
    expect(getSourceCodeLocation(root)).toBeNull();
    expect(getSourceCodeLocation(main)).toMatchObject({
      startLine: 2, startCol: 1, endLine: 4, endCol: 8,
      startTag: { startLine: 2, endLine: 2, endCol: 19 },
      endTag: { startLine: 4, startCol: 1, endCol: 8 },
    });
    expect(getSourceCodeLocation(main.firstChild)).toMatchObject({
      startLine: 2, startCol: 19, endLine: 4, endCol: 1,
    });
  });

  it('replaces source locations on frozen nodes without exposing parser state', () => {
    const adapter = createParser();
    const node = adapter.createCommentNode('note');
    Object.freeze(node);
    const keys = Reflect.ownKeys(node);
    const prototype: unknown = Object.getPrototypeOf(node);
    const location: Token.ElementLocation = {
      startLine: 1, startCol: 1, startOffset: 0,
      endLine: 1, endCol: 12, endOffset: 11,
    };

    adapter.updateNodeSourceCodeLocation(node, { endLine: 2 });
    expect(getSourceCodeLocation(node)).toBeUndefined();
    adapter.setNodeSourceCodeLocation(node, null);
    adapter.updateNodeSourceCodeLocation(node, { endLine: 2 });
    expect(getSourceCodeLocation(node)).toBeNull();

    adapter.setNodeSourceCodeLocation(node, location);
    adapter.updateNodeSourceCodeLocation(node, { endCol: 13, endOffset: 12 });
    expect(getSourceCodeLocation(node)).toBe(location);
    expect(location.endCol).toBe(13);
    const replacement = { ...location, startLine: 2, endLine: 2 };
    adapter.setNodeSourceCodeLocation(node, replacement);
    expect(createParser().getNodeSourceCodeLocation(node)).toBe(replacement);

    adapter.setNodeSourceCodeLocation(node, null);
    expect(getSourceCodeLocation(node)).toBeNull();
    expect(Reflect.ownKeys(node)).toEqual(keys);
    expect(Object.getPrototypeOf(node)).toBe(prototype);
  });

  it('parses attributes into the DOM attribute representation', () => {
    const document = createParser().parse(
      '<main id="content" class="one two"></main>',
    );
    const main = document.getElementById('content');

    expect(main?.getAttribute('class')).toBe('one two');
    expect(main?.attributes[0]).toMatchObject({
      localName: 'id',
      namespaceURI: null,
      prefix: null,
      value: 'content',
    });
  });

  it('stores and retrieves the Parse5 document mode', () => {
    const parser = createParser();
    const document = new DocumentImpl();

    parser.setDocumentMode(document, html.DOCUMENT_MODE.QUIRKS);

    expect(document.getMode()).toBe(DocumentMode.Quirks);
    expect(parser.getDocumentMode(document)).toBe(html.DOCUMENT_MODE.QUIRKS);
  });

  it('creates and updates a document type before the document element', () => {
    const parser = createParser();
    const document = new DocumentImpl();
    const element = document.createElement('html');

    document.appendChild(element);
    parser.setDocumentType(document, 'html', 'public', 'system');

    expect(document.firstChild).toBe(document.doctype);
    expect(document.doctype).toMatchObject({
      name: 'html',
      publicId: 'public',
      systemId: 'system',
    });

    parser.setDocumentType(document, 'svg', '', 'new-system');

    expect(document.doctype).toMatchObject({
      name: 'svg',
      publicId: '',
      systemId: 'new-system',
    });
  });
});

function createParser(): HTMLTreeAdapter {
  const document = createDocument();
  document.setType('html');
  document.setContentType('text/html');
  return new HTMLTreeAdapter(document);
}
