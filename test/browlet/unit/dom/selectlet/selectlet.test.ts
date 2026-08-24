import { describe, expect, it } from 'vitest';

import { createSelectlet } from '../../../../../src/selectlet/selectlet';
import {
  parseHTMLDocument,
} from '../../../../../src/browlet/html/parser/parse';

describe('Selectlet with a Browlet DOM host', () => {
  it('matches ordinary selectors against a parsed DOM document', () => {
    const document = parseHTMLDocument(`
      <!doctype html>
      <main id="content" class="page">
        <span id="first" class="item"></span>
        text
        <span id="second" class="item selected"></span>
      </main>
    `);
    const selectlet = createSelectlet(document);

    expect(selectlet.select('main.page > span.item'))
      .toEqual(document.getElementsByTagName('span'));
    expect(selectlet.first('#content > .selected'))
      .toBe(document.getElementById('second'));
    expect(selectlet.matches(
      '.item + .item',
      document.getElementById('second')!,
    )).toBe(true);
  });
});
