import { describe, expect, it } from 'vitest';

import {
  BrowletParser,
} from '../../../../../src/browlet/html/parser/document-parser';
import {
  isHTMLLinkElement,
} from '../../../../../src/browlet/html/elements/metadata/link';
import {
  isHTMLStyleElement,
} from '../../../../../src/browlet/html/elements/metadata/style';
import {
  createDocument, DocumentImpl,
} from '../../../../../src/browlet/dom/nodes/document';

describe('BrowletParser', () => {
  it('waits for script-blocking style sheets before executing a script', async () => {
    const scripts: Element[] = [];
    const document = createDocument();
    const parser = new BrowletParser(
      document,
      (script) => {
        scripts.push(script);
      },
    );
    expect(parser.document).toBe(document);
    const first = parser.document.createElement('style');
    const second = parser.document.createElement('link');
    if (!isHTMLStyleElement(first) || !isHTMLLinkElement(second)) {
      throw new Error('Expected stylesheet owner elements');
    }

    DocumentImpl.addScriptBlockingStyleSheet(parser.document, first);
    DocumentImpl.addScriptBlockingStyleSheet(parser.document, second);
    DocumentImpl.addScriptBlockingStyleSheet(parser.document, first);

    const parsing = parser.parse('<script></script>');
    try {
      await nextTurn();

      expect(scripts).toHaveLength(0);

      DocumentImpl.removeScriptBlockingStyleSheet(parser.document, first);
      await nextTurn();

      expect(scripts).toHaveLength(0);
    } finally {
      DocumentImpl.removeScriptBlockingStyleSheet(parser.document, first);
      DocumentImpl.removeScriptBlockingStyleSheet(parser.document, second);
    }

    await parsing;

    expect(scripts).toHaveLength(1);
  });
});

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
