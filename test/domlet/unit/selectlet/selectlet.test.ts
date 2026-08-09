import { describe, expect, it } from 'vitest';

import { createSelectlet } from '../../../../src/selectlet/selectlet';
import { DomletParser } from '../../../../src/domlet/parser/parser';

describe('Selectlet with a Domlet host', () => {
  it('matches ordinary selectors against a parsed Domlet document', () => {
    const document = new DomletParser().parse(`
      <!doctype html>
      <main id="content" class="page">
        <span id="first" class="item"></span>
        text
        <span id="second" class="item selected"></span>
      </main>
    `);
    const selectlet = createSelectlet(document as unknown as Document);

    expect(selectlet.select('main.page > span.item'))
      .toEqual(document.getElementsByTagName('span'));
    expect(selectlet.first('#content > .selected'))
      .toBe(document.getElementById('second'));
    expect(selectlet.matches(
      '.item + .item',
      document.getElementById('second') as unknown as Element,
    )).toBe(true);
  });
});
