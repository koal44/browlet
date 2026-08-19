import { html } from 'parse5';
import { describe, expect, it } from 'vitest';

import {
  DocumentImpl, DocumentMode,
} from '../../../../src/domlet/nodes/document';
import { DocumentFragmentImpl } from '../../../../src/domlet/nodes/document-fragment';
import {
  HTMLElementImpl, HTMLHeadElementImpl, HTMLLinkElementImpl,
  HTMLStyleElementImpl, MathMLElementImpl, SVGElementImpl, SVGStyleElementImpl,
} from '../../../../src/domlet/nodes/element';
import { isComment } from '../../../../src/domlet/nodes/node';
import { DomletParser } from '../../../../src/domlet/parser/parser';

describe('Parser tree adapter', () => {
  it('creates document fragments in its current document', () => {
    const parser = new DomletParser();
    const document = parser.createDocument();
    const fragment = parser.createDocumentFragment();

    expect(fragment).toBeInstanceOf(DocumentFragmentImpl);
    expect(fragment.ownerDocument).toBe(document);
  });

  it('parses a basic HTML document and derives its compatibility mode', () => {
    const parser = new DomletParser();
    const standards = parser.parse('<!doctype html><main>content</main>');
    const quirks = parser.parse('<main>content</main>');

    expect(DocumentImpl.getMode(standards)).toBe(DocumentMode.NoQuirks);
    expect(standards.doctype?.name).toBe('html');
    expect(standards.documentElement.localName).toBe('html');
    expect(DocumentImpl.getMode(quirks)).toBe(DocumentMode.Quirks);
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

  it('creates element interfaces from parser namespaces', () => {
    const document = new DomletParser().parse([
      '<style id="style"></style>',
      '<link id="link">',
      '<svg id="svg"><style id="svg-style"></style>',
      '<circle id="circle"></circle>',
      '<foreignObject><main id="html"></main></foreignObject></svg>',
      '<math id="math"><mi id="mi"></mi></math>',
    ].join(''));

    expect(document.head).toBeInstanceOf(HTMLHeadElementImpl);
    expect(document.getElementById('style')).toBeInstanceOf(HTMLStyleElementImpl);
    expect(document.getElementById('link')).toBeInstanceOf(HTMLLinkElementImpl);
    expect(document.getElementById('svg')).toBeInstanceOf(SVGElementImpl);
    expect(document.getElementById('svg-style')).toBeInstanceOf(SVGStyleElementImpl);
    expect(document.getElementById('circle')).toBeInstanceOf(SVGElementImpl);
    expect(document.getElementById('html')).toBeInstanceOf(HTMLElementImpl);
    expect(document.getElementById('math')).toBeInstanceOf(MathMLElementImpl);
    expect(document.getElementById('mi')).toBeInstanceOf(MathMLElementImpl);
  });

  it('stores and retrieves the Parse5 document mode', () => {
    const parser = new DomletParser();
    const document = new DocumentImpl();

    parser.setDocumentMode(document, html.DOCUMENT_MODE.QUIRKS);

    expect(DocumentImpl.getMode(document)).toBe(DocumentMode.Quirks);
    expect(parser.getDocumentMode(document)).toBe(html.DOCUMENT_MODE.QUIRKS);
  });

  it('creates and updates a document type before the document element', () => {
    const parser = new DomletParser();
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
