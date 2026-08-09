import { html } from 'parse5';
import { describe, expect, it } from 'vitest';

import {
  Document, DocumentMode,
} from '../../../../src/domlet/nodes/document';
import { isComment } from '../../../../src/domlet/nodes/node';
import { DomletParser } from '../../../../src/domlet/parser/parser';

describe('Parser tree adapter', () => {
  it('parses a basic HTML document and derives its compatibility mode', () => {
    const parser = new DomletParser();
    const standards = parser.parse('<!doctype html><main>content</main>');
    const quirks = parser.parse('<main>content</main>');

    expect(standards.mode).toBe(DocumentMode.NoQuirks);
    expect(standards.doctype?.name).toBe('html');
    expect(standards.documentElement?.localName).toBe('html');
    expect(quirks.mode).toBe(DocumentMode.Quirks);
  });

  it('parses comments as comment nodes', () => {
    const document = new DomletParser().parse('<!--note--><main></main>');
    const comment = document.firstChild;

    expect(isComment(comment)).toBe(true);
    if (!isComment(comment)) throw new Error('Expected a comment node');
    expect(comment.data).toBe('note');
  });

  it('parses attributes into the Domlet attribute representation', () => {
    const document = new DomletParser().parse(
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
    const parser = new DomletParser();
    const document = new Document();

    parser.setDocumentMode(document, html.DOCUMENT_MODE.QUIRKS);

    expect(document.mode).toBe(DocumentMode.Quirks);
    expect(parser.getDocumentMode(document)).toBe(html.DOCUMENT_MODE.QUIRKS);
  });

  it('creates and updates a document type before the document element', () => {
    const parser = new DomletParser();
    const document = new Document();
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
