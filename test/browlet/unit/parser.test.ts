import { describe, expect, it } from 'vitest';

import { BrowletParser } from '../../../src/browlet/parser';
import {
  isHTMLLinkElement, isHTMLStyleElement,
} from '../../../src/domlet/nodes/element';

describe('BrowletParser', () => {
  it('waits for script-blocking style sheets before executing a script', async () => {
    const scripts: Element[] = [];
    const parser = new BrowletParser((script) => {
      scripts.push(script);
    });
    const first = parser.document.createElement('style');
    const second = parser.document.createElement('link');
    if (!isHTMLStyleElement(first) || !isHTMLLinkElement(second)) {
      throw new Error('Expected stylesheet owner elements');
    }

    parser.document.__addScriptBlockingStyleSheet(first);
    parser.document.__addScriptBlockingStyleSheet(second);
    parser.document.__addScriptBlockingStyleSheet(first);

    const parsing = parser.parse('<script></script>');
    try {
      await nextTurn();

      expect(scripts).toHaveLength(0);

      parser.document.__removeScriptBlockingStyleSheet(first);
      await nextTurn();

      expect(scripts).toHaveLength(0);
    } finally {
      parser.document.__removeScriptBlockingStyleSheet(first);
      parser.document.__removeScriptBlockingStyleSheet(second);
    }

    await parsing;

    expect(scripts).toHaveLength(1);
  });
});

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
