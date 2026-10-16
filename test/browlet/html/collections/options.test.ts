import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('HTMLOptionsCollection', () => {
  it('uses select-owned membership and live inherited names and indices', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const select = document.createElement('select');
      const options = select.options;
      const first = document.createElement('option');
      first.id = 'first';
      first.setAttribute('name', 'alias');
      const group = document.createElement('optgroup');
      const second = document.createElement('option');
      group.append(second);
      select.append(first, group);
      const before = [options === select.options, select instanceof HTMLSelectElement,
        first instanceof HTMLOptionElement, group instanceof HTMLOptGroupElement,
        options instanceof HTMLOptionsCollection, options instanceof HTMLCollection,
        options.length, options.item(0) === first, options.namedItem('alias') === first,
        Object.keys(options)];
      const nested = document.createElement('optgroup');
      nested.append(document.createElement('option'));
      group.append(nested);
      for (const name of ['select', 'hr', 'datalist', 'option']) {
        const excluded = document.createElement(name);
        excluded.append(document.createElement('option'));
        group.append(excluded);
      }
      const wrapper = document.createElement('div');
      wrapper.append(document.createElement('option'));
      select.append(wrapper);
      const filteredLength = options.length;
      first.remove();
      return [before, filteredLength, options.item(0) === second, options.namedItem('first')];
    })).toEqual([[true, true, true, true, true, true, 2, true, true, ['0', '1']], 4, true, null]);
  });

  it('grows and shrinks length without removing groups or adding their children', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const select = document.createElement('select');
      const group = document.createElement('optgroup');
      group.append(document.createElement('option'), document.createElement('option'));
      select.append(group);
      const options = select.options;
      options.length = 4;
      const grown = [options.length, group.children.length, options[2]!.parentNode === select,
        options[3] instanceof HTMLOptionElement];
      options.length = 100001;
      const capped = options.length;
      options.length = 1;
      const shrunk = [options.length, group.parentNode === select, group.children.length];
      options.length = 0;
      return [grown, capped, shrunk, group.parentNode === select, group.children.length];
    })).toEqual([[4, 2, true, true], 4, [1, true, 1], true, 0]);
  });

  it('pads indexed assignments, replaces in the actual parent, and removes null assignments', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const select = document.createElement('select');
      const options = select.options;
      const last = document.createElement('option');
      options[2] = last;
      const grown = [options.length, options[0] instanceof HTMLOptionElement, options[2] === last];
      const group = document.createElement('optgroup');
      group.append(last);
      select.append(group);
      const replacement = document.createElement('option');
      options[2] = replacement;
      const replaced = [options[2] === replacement, replacement.parentNode === group, last.parentNode === null];
      const removed = Reflect.set(options, '2', null);
      const outside = Reflect.set(options, '99', null);
      let wrongType = false;
      try { Reflect.set(options, '0', group); } catch (error) { wrongType = error instanceof TypeError; }
      return [grown, replaced, removed, outside, options.length, group.children.length, wrongType];
    })).toEqual([[3, true, true], [true, true, true], true, true, 2, 0, true]);
  });

  it('adds before an index or descendant and checks hierarchy before identity shortcuts', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const select = document.createElement('select');
      const options = select.options;
      const group = document.createElement('optgroup');
      const first = document.createElement('option');
      group.append(first);
      options.add(group);
      const second = document.createElement('option');
      options.add(second, 0);
      const inserted = [options[0] === second, second.parentNode === group];
      options.add(first, first);
      options.add(first, -1);
      const moved = first.parentNode === select;
      const errorName = (action: () => void) => {
        try { action(); return ''; } catch (error) { return (error as DOMException).name; }
      };
      const foreign = document.createElement('option');
      const errors = [errorName(() => options.add(foreign, foreign)), errorName(() => options.add(foreign, select))];
      const ancestor = document.createElement('optgroup');
      ancestor.append(select);
      errors.push(errorName(() => options.add(ancestor)));
      options.remove(-1);
      options.remove(100);
      options.remove(0);
      return [inserted, moved, errors, options.length, options[0] === first];
    })).toEqual([[true, true], true, ['NotFoundError', 'NotFoundError', 'HierarchyRequestError'], 1, true]);
  });

  it('delegates selectedIndex to its select and preserves selection dirtiness', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const select = document.createElement('select');
      select.setAttribute('multiple', '');
      select.options.length = 3;
      select.options[0]!.selected = true;
      select.options[2]!.selected = true;
      const before = select.options.selectedIndex;
      select.options.selectedIndex = 1;
      select.options[1]!.defaultSelected = false;
      const chosen = [select.selectedIndex, Array.from(select.options, (option) => option.selected)];
      select.selectedIndex = -1;
      return [before, chosen, select.options.selectedIndex, Array.from(select.options, (option) => option.selected)];
    })).toEqual([0, [1, [false, true, false]], -1, [false, false, false]]);
  });

  // Approved expected failure until select/option mutation hooks reset selectedness.
  it.fails('updates default selection after collection mutations', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const select = document.createElement('select');
      select.options.length = 2;
      const initial = select.options.selectedIndex;
      select.options.remove(0);
      return [initial, select.options.selectedIndex, select.options[0]!.selected];
    })).toEqual([0, 0, true]);
  });
});
