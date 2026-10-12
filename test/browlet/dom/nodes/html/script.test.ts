import { describe, expect, it } from 'vitest';

import { HTML_NAMESPACE } from '../../../../../src/infra/index';
import { Browlet } from '../../../../../src/browlet/browlet';
import { HTMLScriptElementImpl } from '../../../../../src/browlet/dom/nodes/html/script';
import { createTestDocument } from '../../../../support/dom';
import { unwrap } from '../../../../support/browlet-binding';

describe('HTMLScriptElement basics', () => {
  it('projects parsed and created scripts with their own HTML interface', async () => {
    const browser = new Browlet({ route: () => '<script>/* kept */</script>' });
    await browser.navigate('https://example.test/');

    expect(await browser.evaluate(() => {
      const parsed = document.getElementsByTagName('script')[0]!;
      const created = document.createElement('script');
      return [
        parsed instanceof HTMLScriptElement, parsed instanceof HTMLElement,
        parsed.textContent, created instanceof HTMLScriptElement,
        document.createElementNS('urn:other', 'script') instanceof HTMLScriptElement,
      ];
    })).toEqual([true, true, '/* kept */', true, false]);

    const script = unwrap<HTMLScriptElementImpl>(browser.window.document.getElementsByTagName('script').item(0)!);
    expect(HTMLScriptElementImpl.is(script)).toBe(true);
    expect(script.result).toBe('uninitialized');
    expect(HTMLScriptElementImpl.is(browser.window.document.getElementsByTagName('script')[0])).toBe(false);
  });

  // PROVISIONAL: Browlet's parser callback evaluates every script; HTML §4.12.1 preparation is missing.
  it.fails('does not execute a script data block as JavaScript', async () => {
    const browser = new Browlet({ route: () => '<script type="application/json">{"kept":true}</script>' });
    await browser.navigate('https://example.test/');
    expect(browser.window.document.getElementsByTagName('script').item(0)!.textContent).toBe('{"kept":true}');
  });

  it('keeps the original relevant Window after adoption and cloning selects the new document realm', () => {
    const original = createTestDocument();
    const destination = createTestDocument();
    const script = original.createElementNS(HTML_NAMESPACE, 'script');
    if (!HTMLScriptElementImpl.is(script)) throw new Error('Expected an HTML script implementation');

    const originalWindow = script.getRelevantGlobalObject();
    destination.adoptNode(script);
    expect(script.nodeDocument).toBe(destination);
    expect(script.getRelevantGlobalObject()).toBe(originalWindow);
    expect(script.getRelevantGlobalObject()).not.toBe(destination.getRelevantGlobalObject());

    const clone = destination.importNode(script, false);
    if (!HTMLScriptElementImpl.is(clone)) throw new Error('Expected an HTML script clone');
    expect(clone.getRelevantGlobalObject()).toBe(destination.getRelevantGlobalObject());
    expect(clone.result).toBe('uninitialized');
  });
});
