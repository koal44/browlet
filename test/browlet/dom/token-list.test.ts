import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { DOMTokenListImpl } from '../../../src/browlet/dom/token-list';
import type { ElementImpl } from '../../../src/browlet/dom/nodes/element';
import { createTestDocument } from '../../support/dom';
import { unwrap } from '../../support/browlet-binding';

/* eslint-disable @typescript-eslint/unbound-method -- These tests deliberately borrow methods and supply receivers. */

describe('DOMTokenList projection and attribute synchronization', () => {
  it('keeps one nonconstructible classList without creating an absent attribute', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const list = element.classList;
      let constructible = true;
      try { Reflect.construct(DOMTokenList, []); } catch { constructible = false; }
      return [list === element.classList, list instanceof DOMTokenList, constructible,
        element.hasAttribute('class'), list.length, list.item(0), list[0], list.value,
        String(list), Object.prototype.toString.call(list), Object.keys(list),
        list[Symbol.iterator] === list.values, list.values === Array.prototype.values,
        Object.is(list.forEach, Array.prototype.forEach)];
    })).toEqual([true, true, false, false, 0, null, undefined, '', '', '[object DOMTokenList]', [], true, true, true]);
  });

  it('deduplicates only the token view and splits exactly ASCII whitespace', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.setAttribute('class', '  a\tb\na\fc\rd  A\u00a0B\vC ');
      const list = element.classList;
      return [Array.from(list), list.length, list.value, String(list), list.contains('a'),
        list.contains('A'), list.contains(''), list.contains('a b'),
        list.item(2), list.item(99), list.item(-1), list.item(2 ** 32 + 1), Object.keys(list),
        Reflect.set(list, '0', 'changed'), Reflect.deleteProperty(list, '0'), list[0]];
    })).toEqual([['a', 'b', 'c', 'd', 'A\u00a0B\vC'], 5, '  a\tb\na\fc\rd  A\u00a0B\vC ',
      '  a\tb\na\fc\rd  A\u00a0B\vC ', true, false, false, false,
      'c', null, null, 'b', ['0', '1', '2', '3', '4'], false, false, 'a']);
  });

  it('follows every ordinary attribute mutation entry point', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const list = element.classList;
      const seen: string[][] = [];
      element.className = 'one one'; seen.push(Array.from(list));
      element.setAttribute('CLASS', 'two'); seen.push(Array.from(list));
      element.setAttributeNS(null, 'class', 'three'); seen.push(Array.from(list));
      const attribute = element.getAttributeNode('class')!;
      attribute.value = 'four'; seen.push(Array.from(list));
      attribute.nodeValue = 'five'; seen.push(Array.from(list));
      attribute.textContent = 'six'; seen.push(Array.from(list));
      const replacement = document.createAttribute('class');
      replacement.value = 'seven seven';
      element.attributes.setNamedItem(replacement); seen.push(Array.from(list));
      attribute.value = 'detached'; seen.push(Array.from(list));
      element.attributes.removeNamedItem('class'); seen.push(Array.from(list));
      element.setAttributeNode(attribute); seen.push(Array.from(list));
      element.removeAttributeNode(attribute); seen.push(Array.from(list));
      element.setAttributeNS('urn:test', 'p:class', 'foreign'); seen.push(Array.from(list));
      element.setAttribute('title', 'other'); seen.push(Array.from(list));
      return [seen, list === element.classList];
    })).toEqual([[['one'], ['two'], ['three'], ['four'], ['five'], ['six'], ['seven'], ['seven'],
      [], ['detached'], [], [], []], true]);
  });

  it('uses a null-namespace lowercase class attribute on XML, SVG, and MathML elements', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = new Document();
      return [xml.createElement('item'), document.createElementNS('http://www.w3.org/2000/svg', 'g'),
        document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi')].map((element) => {
        element.setAttribute('CLASS', 'upper');
        element.setAttributeNS('urn:test', 'p:class', 'foreign');
        element.classList.add('lower');
        return [Array.from(element.classList), element.getAttributeNS(null, 'class'),
          element.getAttributeNS(null, 'CLASS'), element.getAttributeNS('urn:test', 'class')];
      });
    })).toEqual(Array(3).fill([['lower'], 'lower', 'upper', 'foreign']));
  });

  it('forwards assignment to value without replacing the list or normalizing the raw string', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const list = element.classList;
      Reflect.set(element, 'classList', ' a  a b ');
      const first = [list === element.classList, list.value, Array.from(list)];
      list.value = ' c  c ';
      const second = [element.className, Array.from(list)];
      Reflect.set(list, 'value', null);
      const third = list.value;
      Reflect.set(element, 'classList', undefined);
      return [first, second, third, list.value, Object.hasOwn(element, 'classList')];
    })).toEqual([[true, ' a  a b ', ['a', 'b']], [' c  c ', ['c']], 'null', 'undefined', false]);
  });
});

describe('DOMTokenList token operations', () => {
  it('adds and removes tokens in order and serializes even unchanged membership', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.className = ' a  b a ';
      const list = element.classList;
      list.add('b', 'c', 'a', 'd', 'c');
      const added = list.value;
      list.remove('absent', 'b', 'b', 'd');
      const removed = list.value;
      element.className = ' a  a c ';
      list.add();
      const emptyAdd = list.value;
      element.className = ' a  a c ';
      list.remove();
      const emptyRemove = list.value;
      list.remove('a', 'c');
      return [added, removed, emptyAdd, emptyRemove, list.value, element.hasAttribute('class')];
    })).toEqual(['a b c d', 'a c', 'a c', 'a c', '', true]);
  });

  it.each(['add', 'remove'] as const)('validates all %s arguments before changing any tokens', async (method) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((method) => {
      const element = document.createElement('div');
      element.className = ' a  b ';
      const list = element.classList;
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true });
      const errors: string[] = [];
      for (const tokens of [['c', ''], ['a', 'has space'], ['has space', ''], ['', 'has space']]) {
        try { list[method](...tokens); }
        catch (error) { errors.push(error instanceof DOMException ? error.name : 'foreign exception'); }
      }
      return [errors, list.value, Array.from(list), observer.takeRecords().length];
    }, method)).toEqual([['SyntaxError', 'InvalidCharacterError', 'InvalidCharacterError', 'SyntaxError'],
      ' a  b ', ['a', 'b'], 0]);
  });

  it('validates empty strings and ASCII whitespace, accepting other whitespace and code units', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const list = document.createElement('div').classList;
      const errors: string[] = [];
      for (const token of ['', 'a b', 'a\tb', 'a\nb', 'a\fb', 'a\rb']) {
        for (const method of ['add', 'remove', 'toggle'] as const) {
          try { list[method](token); }
          catch (error) { errors.push((error as DOMException).name); }
        }
      }
      list.add('a\vb', 'a\u00a0b', '\0', '\ud800');
      return [errors, Array.from(list), list.contains(''), list.contains('a b')];
    })).toEqual([[
      ...Array<string>(3).fill('SyntaxError'), ...Array<string>(15).fill('InvalidCharacterError'),
    ], ['a\vb', 'a\u00a0b', '\0', '\ud800'], false, false]);
  });

  it('toggles membership and preserves raw spelling when force requires no change', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.className = ' a  a b ';
      const list = element.classList;
      const results: unknown[] = [];
      for (const [token, force] of [['a', true], ['c', false], ['a', false], ['c', true]] as const) {
        results.push([list.toggle(token, force), list.value]);
      }
      results.push([list.toggle('c'), list.value]);
      results.push([list.toggle('a', undefined), list.value]);
      results.push([Reflect.apply(list.toggle, list, ['a', null]), list.value]);
      results.push([Reflect.apply(list.toggle, list, ['c', []]), list.value]);
      return results;
    })).toEqual([[true, ' a  a b '], [false, ' a  a b '], [false, 'b'], [true, 'b c'],
      [false, 'b'], [true, 'b a'], [false, 'b'], [true, 'b c']]);
  });

  it.each([
    ['a b c', 'a', 'c', 'c b'], ['c b a', 'a', 'c', 'c b'],
    ['a b c', 'b', 'd', 'a d c'], [' a a b ', 'a', 'a', 'a b'],
    [' a a b ', 'absent', 'a', ' a a b '],
  ])('replaces %s: %s with %s at the first matching position', async (raw, token, replacement, expected) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(({ raw, token, replacement }) => {
      const element = document.createElement('div');
      element.className = raw;
      return [element.classList.replace(token, replacement), element.className];
    }, { raw, token, replacement })).toEqual([token !== 'absent', expected]);
  });

  it('checks both replace arguments for emptiness before either whitespace check', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.className = ' a a ';
      const errors = [['a b', ''], ['', 'a b'], ['absent', 'a b'], ['a b', 'ok']].map(([a, b]) => {
        try { element.classList.replace(a!, b!); return 'no error'; }
        catch (error) { return (error as DOMException).name; }
      });
      return [errors, element.className];
    })).toEqual([['SyntaxError', 'SyntaxError', 'InvalidCharacterError', 'InvalidCharacterError'], ' a a ']);
  });
});

describe('DOMTokenList integration and binding contracts', () => {
  it('distinguishes no-op updates, absent attributes, and raw value assignment in mutation records', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const list = element.classList;
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      list.add(); list.remove(); list.remove('missing'); list.toggle('missing', false); list.replace('missing', 'new');
      const absent = [element.hasAttribute('class'), observer.takeRecords().length];
      list.value = ' a  a ';
      const initial = observer.takeRecords().map((record) => record.oldValue);
      list.toggle('a', true); list.toggle('missing', false); list.replace('missing', 'new');
      const unchanged = [list.value, observer.takeRecords().length];
      list.add('a'); list.add(); list.remove('missing'); list.replace('a', 'a'); list.value = 'a';
      const updates = observer.takeRecords().map((record) =>
        [record.type, record.attributeName, record.attributeNamespace, record.oldValue, record.target === element]);
      list.remove('a');
      const removed = [element.hasAttribute('class'), list.value, observer.takeRecords()[0]!.oldValue];
      return [absent, initial, unchanged, updates, removed];
    })).toEqual([[false, 0], [null], [' a  a ', 0], [
      ['attributes', 'class', null, ' a  a ', true],
      ...Array.from({ length: 4 }, () => ['attributes', 'class', null, 'a', true]),
    ], [true, '', 'a']]);
  });

  it('keeps Array iteration live while forEach retains its initial length', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.className = 'a b';
      const list = element.classList;
      const iterator = list.values();
      const first = iterator.next().value;
      list.add('c');
      const rest = Array.from(iterator);
      const receiver = {};
      const seen: unknown[] = [];
      list.forEach(function(this: object, token, index, current) {
        seen.push([token, index, current === list, this === receiver]);
        if (index === 0) { list.remove('b'); list.add('d', 'e'); }
      }, receiver);
      const retained = list.values();
      retained.next();
      element.className = 'x y';
      return [first, rest, seen, Array.from(list.keys()), Array.from(list.entries()), Array.from(retained)];
    })).toEqual(['a', ['b', 'c'], [['a', 0, true, true], ['c', 1, true, true], ['d', 2, true, true]],
      [0, 1], [[0, 'x'], [1, 'y']], ['y']]);
  });

  it('converts every argument before syntax validation and observes conversion-time mutations', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.className = 'initial';
      const list = element.classList;
      const seen: string[] = [];
      const token = { toString() { seen.push('convert'); element.className = 'changed'; return 'added'; } };
      let errorName = '';
      try { Reflect.apply(list.add, list, ['', token]); }
      catch (error) { errorName = (error as DOMException).name; }
      const afterError = list.value;
      Reflect.apply(list.add, list, [token, 3, null, undefined]);
      const marker = new Error('conversion');
      let sameError = false;
      try { Reflect.apply(list.remove, list, ['changed', { toString() { throw marker; } }]); }
      catch (error) { sameError = error === marker; }
      return [seen, errorName, afterError, list.value, sameError];
    })).toEqual([['convert', 'convert'], 'SyntaxError', 'changed', 'changed added 3 null undefined', true]);
  });

  it('rejects invalid receivers, required arguments, and Symbols at the binding boundary', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const list = document.createElement('div').classList;
      const failures: boolean[] = [];
      const actions = [
        () => { Reflect.apply(list.add, {}, ['a']); }, () => { Reflect.apply(list.contains, list, []); },
        () => { Reflect.apply(list.item, list, []); }, () => { Reflect.apply(list.replace, list, ['a']); },
        () => { Reflect.apply(list.add, list, [Symbol()]); }, () => { Reflect.set(list, 'value', Symbol()); },
        () => { Reflect.apply(Object.getOwnPropertyDescriptor(DOMTokenList.prototype, 'length')!.get!, {}, []); },
      ];
      for (const action of actions) {
        try { action(); failures.push(false); } catch (error) { failures.push(error instanceof TypeError); }
      }
      return [failures, Reflect.set(list, 'length', 100), list.length];
    })).toEqual([Array(7).fill(true), false, 0]);
  });

  it('keeps supports separate from membership and token syntax', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const list = document.createElement('div').classList;
      list.add('known');
      return ['known', 'missing', '', 'has space'].map((token) => {
        try { list.supports(token); return false; } catch (error) { return error instanceof TypeError; }
      });
    })).toEqual([true, true, true, true]);

    const element = createTestDocument().createElement('div');
    const list = new DOMTokenListImpl(element, 'test', new Set(['supported', 'cafÉ']));
    expect([list.supports('SUPPORTED'), list.supports('missing'), list.supports(''), list.supports('has space'),
      list.supports('CAFÉ'), list.supports('café'), list.contains('supported')])
      .toEqual([true, false, false, false, true, false, false]);
    expect(new DOMTokenListImpl(element, 'test', new Set()).supports('anything')).toBe(false);
  });

  it('updates retained class collections and selector matches through normal attribute mutation', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const element = root.appendChild(document.createElement('span'));
      const collection = root.getElementsByClassName('selected');
      const before = collection.length;
      element.classList.add('selected');
      const added = [collection.length, collection.item(0) === element, element.matches('.selected')];
      element.classList.remove('selected');
      return [before, added, collection.length, element.matches('.selected')];
    })).toEqual([0, [1, true, true], 0, false]);
  });

  it('uses the existing custom-element enqueue hook for actual attribute writes', () => {
    const browser = new Browlet({ route: () => '' });
    const element = browser.window.document.createElement('div');
    const implementation = unwrap<ElementImpl>(element);
    // HTML reaction delivery remains the next slice; verify this entry point reaches its owner.
    const enqueue = vi.spyOn(implementation, 'enqueueCustomElementCallbackReaction').mockImplementation(() => {});
    implementation.customElementState = 'custom';
    element.classList.add('a');
    element.classList.toggle('a', true);
    element.classList.remove('a');
    expect(enqueue.mock.calls).toEqual([
      ['attributeChangedCallback', ['class', null, 'a', null]],
      ['attributeChangedCallback', ['class', 'a', '', null]],
    ]);
  });

  it('preserves receiver-realm identity across borrowed accessors, adoption, and cloning', () => {
    const source = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const element = source.window.document.createElement('div');
    element.className = 'source';
    target.window.document.adoptNode(element);
    const getter = Object.getOwnPropertyDescriptor(target.window.Element.prototype, 'classList')!.get!;
    const list = getter.call(element) as typeof element.classList;
    expect(list).toBe(element.classList);
    expect(list).toBeInstanceOf(source.window.DOMTokenList);
    expect(list).not.toBeInstanceOf(target.window.DOMTokenList);
    target.window.DOMTokenList.prototype.add.call(list, 'adopted');
    expect(element.className).toBe('source adopted');
    const clone = element.cloneNode() as typeof element;
    clone.classList.remove('source');
    expect(clone.classList).not.toBe(list);
    expect(clone.className).toBe('adopted');
    expect(list.value).toBe('source adopted');
  });
});
