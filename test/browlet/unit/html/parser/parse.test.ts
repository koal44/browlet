import { describe, expect, it } from 'vitest';

import {
  parseHTMLDocument,
} from '../../../../../src/browlet/html/parser/parse';
import {
  createDocument, DocumentImpl,
} from '../../../../../src/browlet/dom/nodes/document';
import {
  HTMLTreeAdapter,
} from '../../../../../src/browlet/html/parser/tree-adapter';

describe('DOM document construction', () => {
  it('parses directly into DOM implementation objects', () => {
    const document = parseHTMLDocument('<main id="target"></main>');

    expect(document).toBeInstanceOf(DocumentImpl);
    expect(document.getElementById('target')?.localName).toBe('main');
  });

  it('associates a parser with an existing host-created document', () => {
    const document = createDocument();
    const parsed = new HTMLTreeAdapter(document).parse(
      '<main id="target"></main>',
    );

    expect(parsed).toBe(document);
    expect(document.getElementById('target')?.localName).toBe('main');
  });

  it('lazily associates one CSS engine with its document', () => {
    const document = parseHTMLDocument('<main id="target"></main>');
    const cssEngine = DocumentImpl.getCSSEngine(document);

    expect(DocumentImpl.getCSSEngine(document)).toBe(cssEngine);
    expect(cssEngine.snapshot.document).toBe(document);
    expect(cssEngine.snapshot.root).toBe(document.documentElement);
    expect(cssEngine.snapshot.isQuirksMode).toBe(true);
    expect(cssEngine.version).toBe('stylelet-__VERSION__');
    expect(document.documentElement.localName).toBe('html');
    expect(document.getElementById('target')?.localName).toBe('main');
  });
});
