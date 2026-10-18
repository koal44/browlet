import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { getPlatformRecord } from '../../../../src/web-idl/binding/platform';
import { createTestDocument } from '../../../support/dom';
import { itPassesWith } from '../../../test-runtime';

describe('HTMLAllCollection implementation', () => {
  it('accepts names only on all-named HTML elements, while accepting IDs in every namespace', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const tags = [
      'a', 'button', 'embed', 'form', 'frame', 'frameset', 'iframe', 'img',
      'input', 'map', 'meta', 'object', 'select', 'textarea',
    ];
    const elements = tags.map((tag) => {
      const element = document.createElement(tag);
      element.setAttribute('name', `${tag}Name`);
      document.body!.appendChild(element);
      return element;
    });
    const all = document.all;
    for (let index = 0; index < tags.length; index++) {
      expect(all.namedItem(`${tags[index]}Name`)).toBe(elements[index]);
    }
    expect([...all.getSupportedPropertyNames()]).toEqual(tags.map((tag) => `${tag}Name`));

    for (const element of [
      document.createElement('area'), document.createElement('div'),
      document.createElementNS('urn:example', 'form'),
    ]) {
      element.setAttribute('name', 'excludedName');
      element.setAttribute('id', 'includedID');
      document.body!.appendChild(element);
      expect(all.namedItem('excludedName')).toBeNull();
      expect(all.namedItem('includedID')).toBe(element);
      expect(all.getSupportedPropertyNames().has('excludedName')).toBe(false);
      expect(all.getSupportedPropertyNames().has('includedID')).toBe(true);
      element.remove();
    }
  });

  it('retains a live document view and live multiple-name results', () => {
    const document = createTestDocument();
    const root = document.createElement('main');
    document.appendChild(root);
    const first = document.createElementNS(HTML_NAMESPACE, 'img');
    const second = document.createElement('div');
    first.setAttribute('name', 'shared');
    second.setAttribute('id', 'shared');
    root.appendChild(first);
    root.appendChild(second);
    const all = document.all;
    expect(all).toBe(document.all);
    expect(all.length).toBe(3);
    expect(all.item('0')).toBe(root);
    expect(all.item()).toBeNull();
    const matches = all.namedItem('shared');
    expect(matches).not.toBe(first);
    expect(matches).toHaveProperty('length', 2);
    first.remove();
    expect(matches).toHaveProperty('length', 1);
    expect(all.namedItem('shared')).toBe(second);
    second.setAttribute('id', 'renamed');
    expect(matches).toHaveProperty('length', 0);
    expect(all.namedItem('shared')).toBeNull();
  });
});

describe('document.all exposure', () => {
  it('exposes the attribute in compat mode and omits it in stock mode', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => 'all' in Document.prototype))
      .toBe(process.env.NODE_RUNTIME === 'compat');
  });
});

describe('native document.all', () => {
  itPassesWith('htmlDDA')('retains a falsy document.all identity and rejects attaching another platform object', () => {
    const browser = new Browlet({ route: () => '' });
    // Identity checks need the live platform object; evaluate() copies data.
    const all: unknown = browser.document.all;
    expect(Boolean(all)).toBe(false);
    expect(all === undefined).toBe(false);
    const record = getPlatformRecord(all)!;

    expect(record.project()).toBe(all);
    expect(() => record.attachPlatformObject({})).toThrow('already associated');
    expect(record.project()).toBe(all);
    expect(browser.document.all).toBe(all);
  });

  itPassesWith('htmlDDA')('rejects document.all returned by an author primitive-conversion hook', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const argument = { [Symbol.toPrimitive]() { return document.all; } };
      const outcome = (convert: () => string): string => {
        try { return convert(); }
        catch (error) { return error instanceof TypeError ? 'TypeError' : 'other error'; }
      };
      return [
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Exercise the native rejection of an object returned by Symbol.toPrimitive.
        outcome(() => String(argument)),
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply supplies the document receiver explicitly.
        outcome(() => (Reflect.apply(document.createTextNode, document, [argument]) as Text).data),
      ];
    })).toEqual(['TypeError', 'TypeError']);
  });

  itPassesWith('htmlDDA')('accepts document.all as an explicit receiver of a collection write', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const collection = document.getElementsByTagName('div');
      Object.defineProperty(collection, 'probe', { value: 0, writable: true });
      const nativeResult = Reflect.set({ probe: 0 }, 'probe', 41, document.all);
      const collectionResult = Reflect.set(collection, 'probe', 42, document.all);
      const results: unknown[] = [nativeResult, collectionResult, Reflect.get(document.all, 'probe'), Reflect.get(collection, 'probe')];
      return results;
    })).toEqual([true, true, 42, 0]);
  });

  itPassesWith('htmlDDA')('preserves identity, realm, callability and the special JavaScript checks', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const all = document.all;
      const special: unknown = Reflect.get(document, 'all');
      const call = (...args: unknown[]) => Reflect.apply(all as unknown as (...args: unknown[]) => unknown, {}, args);
      const element = document.createElement('div');
      element.id = 'target';
      document.body.append(element);
      let symbolRejected = false;
      let constructRejected = false;
      try { call(Symbol()); } catch (error) { symbolRejected = error instanceof TypeError; }
      try { Reflect.construct(all as unknown as new() => object, []); } catch (error) { constructRejected = error instanceof TypeError; }
      return [all === document.all, all instanceof HTMLAllCollection,
        Object.getPrototypeOf(all) === HTMLAllCollection.prototype,
        // eslint-disable-next-line eqeqeq -- Loose equality is the [[IsHTMLDDA]] behavior under test.
        Object.prototype.toString.call(all), Boolean(all), typeof all, special == null,
        special === undefined, call(), call(undefined), call('target') === element,
        call('target', 'ignored') === element, all.item('target') === element,
        call(0) === document.documentElement, all.item() === null, all.item(undefined) === null,
        symbolRejected, constructRejected, Object.isExtensible(all), Reflect.preventExtensions(all),
        new CustomEvent('x', { detail: all }).detail === all];
    })).toEqual([true, true, true, '[object HTMLAllCollection]', false, 'undefined', true,
      false, null, null, true, true, true, true, true, true, true, true, true, false, true]);
  });

  itPassesWith('htmlDDA')('uses restricted names, exact index spellings, and live multiple matches', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const ignored = document.createElement('div');
      ignored.setAttribute('name', 'ignored');
      const first = document.createElement('img');
      first.setAttribute('name', 'shared');
      first.id = '01';
      const second = document.createElement('span');
      second.id = 'shared';
      const numeric = document.createElement('div');
      numeric.id = '0';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.setAttribute('name', 'foreign');
      svg.id = 'svg-id';
      document.body.append(ignored, first, second, numeric, svg);
      const all = document.all;
      const matches = all.namedItem('shared') as HTMLCollection;
      const before = [matches instanceof HTMLCollection, matches.length,
        all.namedItem('ignored'), all.namedItem('foreign'), all.namedItem('svg-id') === svg,
        all.item('01') === first, all.item('0') === document.documentElement,
        all.namedItem('0') === numeric, all.item('4294967295'), all.item(''),
        Object.getOwnPropertyDescriptor(all, 'shared')!.enumerable,
        Object.getOwnPropertyDescriptor(all, '0')!.writable,
        Reflect.set(all, '0', second), Reflect.deleteProperty(all, '0')];
      first.remove();
      return [before, matches.length, matches[0] === second,
        all.namedItem('shared') === second, all.length === document.getElementsByTagName('*').length];
    })).toEqual([[true, 2, null, null, true, true, true, true, null, null, false, false, false, false],
      1, true, true, true]);
  });

  itPassesWith('htmlDDA')('leaves ordinary accessors, symbols, prototype properties and receivers to V8', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const named = document.createElement('div');
      named.id = 'entry';
      const length = document.createElement('div');
      length.id = 'length';
      document.body.append(named, length);
      const all = document.all;
      const setterReceivers: unknown[] = [];
      Object.defineProperty(all, 'accessor', {
        get(this: unknown) { return this; },
        set(this: unknown, _value: unknown) { setterReceivers.push(this); },
        configurable: true,
      });
      const other = {};
      const child = Object.create(all) as { accessor: unknown; };
      Reflect.set(all, 'accessor', 42, other);
      const symbol = Symbol();
      Reflect.set(all, symbol, 3);
      const results: unknown[] = [Reflect.get(all, 'accessor', other) === other,
        child.accessor === child, setterReceivers[0] === other, Reflect.get(all, symbol),
        Reflect.deleteProperty(all, symbol), Object.hasOwn(all, symbol),
        typeof all.length, Object.hasOwn(all, 'length'), Reflect.get(all, 'entry') === named,
        Reflect.set(all, 'entry', 1), Reflect.deleteProperty(all, 'entry'),
        Reflect.defineProperty(all, 'entry', { value: 1 }),
        Reflect.set(all, 'entry', 9, other), Reflect.get(other, 'entry'),
        Reflect.get(all, 'entry') === named,
        Reflect.set(all, '0', named, other), Object.hasOwn(other, '0'),
        // SPEC_CLASH(htmlallcollection-property-order): accepted V8/Chromium order.
        Object.getOwnPropertyNames(all).filter((key) => Number.isNaN(Number(key)))];
      Object.defineProperty(all, 'later', { value: 7, configurable: true, writable: true });
      named.id = 'later';
      results.push(Reflect.get(all, 'later'), Reflect.set(all, 'later', 8),
        Reflect.get(all, 'later'), Reflect.deleteProperty(all, 'later'),
        Reflect.get(all, 'later') === named);
      return results;
    })).toEqual([true, true, true, 3, true, false, 'number', false, true, false, false, false,
      true, 9, true, false, false,
      ['accessor', 'entry'], 7, true, 8, true, true]);
  });
});
