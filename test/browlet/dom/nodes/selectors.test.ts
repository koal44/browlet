import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('DOM selector APIs', () => {
  it('returns a fresh static NodeList in tree order with duplicate matches removed', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('main');
      const first = document.createElement('span');
      const nested = document.createElement('b');
      const last = document.createElement('span');
      first.setAttribute('id', 'first');
      nested.setAttribute('id', 'nested');
      last.setAttribute('id', 'last');
      root.append(first, last);
      first.append(nested);
      const list = root.querySelectorAll('b, span, #first');
      const initial = Array.from(list, (element) => element.getAttribute('id'));
      first.remove();
      root.append(document.createElement('span'));
      return [list instanceof NodeList, initial, list.length, list.item(0) === first,
        list[1] === nested, list !== root.querySelectorAll('b, span, #first'),
        root.querySelector('span') === last];
    })).toEqual([true, ['first', 'nested', 'last'], 3, true, true, true, true]);
  });

  it('excludes the query root, retains ancestor matching, and honors :scope', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const outer = document.createElement('section');
      const root = document.createElement('main');
      const child = document.createElement('span');
      const grandchild = document.createElement('b');
      outer.append(root);
      root.append(child);
      child.append(grandchild);
      return [root.querySelector('main'), root.querySelector('section span') === child,
        root.querySelector(':scope > span') === child,
        root.querySelector(':scope > b'), root.matches(':scope'),
        child.closest('section') === outer, child.closest(':scope') === child,
        child.closest(':scope > *'), child.webkitMatchesSelector('main > span')];
    })).toEqual([null, true, true, null, true, true, true, null, true]);
  });

  it('queries Document and DocumentFragment and resolves IDs in tree order', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const target = new Document();
      const fragment = target.createDocumentFragment();
      const root = target.createElement('root');
      const child = target.createElement('child');
      root.setAttribute('id', 'shared');
      child.setAttribute('id', 'shared');
      fragment.append(root);
      root.append(child);
      const detached = [fragment.getElementById('shared') === root,
        fragment.querySelector('root > child') === child, fragment.querySelectorAll('*').length];
      target.append(fragment);
      return [detached, fragment.querySelectorAll('*').length,
        target.querySelector('root') === root, target.getElementById('shared') === root,
        target.querySelectorAll('*').length, 'getElementById' in root];
    })).toEqual([[true, true, 2], 0, true, true, 2, false]);
  });

  it('reports selector syntax errors as realm DOMExceptions, even for an empty subtree', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const fragment = document.createDocumentFragment();
      const errors: unknown[] = [];
      for (const action of [
        () => element.querySelector('['), () => element.querySelectorAll(''),
        () => fragment.querySelector('['), () => element.matches('['),
        () => element.closest('['), () => element.webkitMatchesSelector('['),
      ]) {
        try { action(); errors.push('missing'); } catch (error) {
          errors.push([error instanceof DOMException, (error as DOMException).name]);
        }
      }
      return errors;
    })).toEqual(Array.from({ length: 6 }, () => [true, 'SyntaxError']));
  });

  it('observes mutations between queries without caching previous match results', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const child = document.createElement('span');
      root.append(child);
      const before = root.querySelector('.selected');
      child.setAttribute('class', 'selected');
      const added = root.querySelector('.selected') === child;
      child.removeAttribute('class');
      const removed = root.querySelectorAll('.selected').length;
      root.removeChild(child);
      return [before, added, removed, root.querySelector('span')];
    })).toEqual([null, true, 0, null]);
  });
});
