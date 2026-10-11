import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('Element adjacent insertion', () => {
  it('uses the ordinary mutation path for all four positions and ASCII casing', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const element = parent.appendChild(document.createElement('span'));
      const before = document.createElement('b');
      const after = document.createElement('i');
      const observer = new MutationObserver(() => {});
      observer.observe(parent, { childList: true, subtree: true });
      const result = element.insertAdjacentElement('BEFOREBEGIN' as InsertPosition, before);
      element.insertAdjacentElement('AfterEnd' as InsertPosition, after);
      element.insertAdjacentText('afterbegin', 'first');
      element.insertAdjacentText('beforeend', 'last');
      return [result === before, [...parent.children].map((child) => child.localName),
        element.textContent, observer.takeRecords().map((record) => record.addedNodes.length)];
    })).toEqual([true, ['b', 'span', 'i'], 'firstlast', [1, 1, 1, 1]]);
  });

  it('handles detached outside positions and rejects invalid positions or hierarchy atomically', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const child = element.appendChild(document.createElement('span'));
      const detached = element.insertAdjacentElement('beforebegin', child);
      const errors: string[] = [];
      for (const action of [() => element.insertAdjacentText('before' as InsertPosition, 'text'),
        () => child.insertAdjacentElement('beforeend', element)]) {
        try { action(); } catch (error) { errors.push((error as DOMException).name); }
      }
      return [detached, errors, child.parentNode === element, element.childNodes.length];
    })).toEqual([null, ['SyntaxError', 'HierarchyRequestError'], true, 1]);
  });
});
