import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../../../src/browlet/browlet';
import { HTMLDialogElementImpl } from '../../../../../../src/browlet/dom/nodes/html/interactive/dialog';
import { unwrap } from '../../../../../support/browlet-binding';

describe('HTMLDialogElement identity', () => {
  it('selects the HTML interface for parsed, created, and cloned dialogs', async () => {
    const browser = new Browlet({ route: () => '<dialog>Content</dialog>' });
    await browser.navigate('https://example.test/');

    expect(await browser.evaluate(() => {
      const parsed = document.getElementsByTagName('dialog')[0]!;
      return [parsed instanceof HTMLDialogElement, parsed instanceof HTMLElement,
        document.createElement('dialog') instanceof HTMLDialogElement,
        parsed.cloneNode(true) instanceof HTMLDialogElement,
        document.createElementNS('urn:other', 'dialog') instanceof HTMLDialogElement];
    })).toEqual([true, true, true, true, false]);
    expect(unwrap(browser.window.document.getElementsByTagName('dialog')[0]!)).toBeInstanceOf(HTMLDialogElementImpl);
  });
});
