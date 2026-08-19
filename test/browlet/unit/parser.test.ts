import { describe, expect, it } from 'vitest';

import { BrowletParser } from '../../../src/browlet/parser';
import { Domlet } from '../../../src/domlet/domlet';
import { DocumentImpl } from '../../../src/domlet/nodes/document';
import {
  isHTMLLinkElement, isHTMLStyleElement,
} from '../../../src/domlet/nodes/element';

describe('BrowletParser', () => {
  it('waits for script-blocking style sheets before executing a script', async () => {
    const scripts: Element[] = [];
    const parser = new BrowletParser(
      new Domlet(),
      (script) => {
        scripts.push(script);
      },
    );
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
