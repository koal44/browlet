import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { SystemClipboard } from '../../../../src/browlet/interaction/clipboard/index';
import type { ClipboardItem, Window } from '../../../../src/browlet/platform';
import { getRelevantRealm } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §7.2: author-created ClipboardItem', () => {
  it('exposes the constructor only on secure Windows', async () => {
    const browser = new Browlet({ route: () => '' });
    const results: unknown[] = [];
    for (const url of ['http://clipboard.test/', 'https://clipboard.test/']) {
      await browser.navigate(url);
      results.push(await browser.evaluate(() => [isSecureContext, typeof (window as unknown as Window).ClipboardItem]));
    }
    expect(results).toEqual([[false, 'undefined'], [true, 'function']]);
  });

  it('constructs with default presentation style and a stable frozen types array', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({ 'text/plain': 'hello' });
      return {
        types: [...item.types], style: item.presentationStyle, stable: item.types === item.types,
        frozen: Object.isFrozen(item.types), realm: Object.getPrototypeOf(item.types) === Array.prototype,
        instance: item instanceof ClipboardItem, tag: Object.prototype.toString.call(item),
        lengths: [ClipboardItem.length, ClipboardItem.supports.length, item.getType.length],
      };
    })).toEqual({
      types: ['text/plain'], style: 'unspecified', stable: true, frozen: true,
      realm: true, instance: true, tag: '[object ClipboardItem]', lengths: [1, 1, 1],
    });
  });

  it('converts presentation options and rejects values outside the enum', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const { ClipboardItem } = window as unknown as Window;
      const styles = ['unspecified', 'inline', 'attachment', 'invalid', null].map((presentationStyle) => {
        try { return (Reflect.construct(ClipboardItem, [{ 'text/plain': 'x' }, { presentationStyle }]) as ClipboardItem).presentationStyle; }
        catch (error) { return error instanceof TypeError; }
      });
      const defaults = [undefined, null, {}, { presentationStyle: undefined }].map((options) =>
        (Reflect.construct(ClipboardItem, [{ 'text/plain': 'x' }, options]) as ClipboardItem).presentationStyle);
      return { styles, defaults };
    })).toEqual({ styles: ['unspecified', 'inline', 'attachment', true, true], defaults: Array(4).fill('unspecified') });
  });

  it('requires new, a nonempty record, and valid record inputs', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const { ClipboardItem } = window as unknown as Window;
      const attempts = [
        () => { Reflect.apply(ClipboardItem, undefined, [{ 'text/plain': 'x' }]); },
        () => { Reflect.construct(ClipboardItem, []); },
        ...[undefined, null, false, 1, 'text/plain', {}, []].map((items) => () => { Reflect.construct(ClipboardItem, [items]); }),
      ];
      return attempts.map((attempt) => { try { attempt(); return false; } catch (error) { return error instanceof TypeError; } });
    })).toEqual(Array(9).fill(true));
  });

  it('reads only own enumerable record entries before the options dictionary and snapshots them', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const order: string[] = [];
      const items = Object.create({ 'text/html': 'inherited' }) as Record<string, string>;
      Object.defineProperties(items, {
        'text/plain': { enumerable: true, configurable: true, get() { order.push('data'); return 'first'; } },
        'image/png': { enumerable: false, value: 'hidden' },
      });
      const item = new ClipboardItem(items, { get presentationStyle(): 'inline' { order.push('options'); return 'inline'; } });
      Object.defineProperty(items, 'text/plain', { value: 'changed' });
      items['image/svg+xml'] = 'late';
      return { order, types: [...item.types], text: await (await item.getType('text/plain')).text() };
    })).toEqual({ order: ['data', 'options'], types: ['text/plain'], text: 'first' });
  });

  it('propagates record getter failures before reading options and rejects enumerable symbol keys', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const { ClipboardItem } = window as unknown as Window;
      const marker = new Error('entry'); let readOptions = false; let exact = false; let symbol = false;
      try {
        new ClipboardItem({ get 'text/plain'(): string { throw marker; } }, {
          get presentationStyle(): 'inline' { readOptions = true; return 'inline'; },
        });
      } catch (error) { exact = error === marker; }
      try { Reflect.construct(ClipboardItem, [{ [Symbol('type')]: 'x' }]); }
      catch (error) { symbol = error instanceof TypeError; }
      return { exact, readOptions, symbol };
    })).toEqual({ exact: true, readOptions: false, symbol: true });
  });

  it('normalizes MIME names and parameter syntax while retaining custom formats and parameter values', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({
        ' TEXT/PLAIN ': 'ordinary', 'web TEXT/PLAIN': 'custom',
        'application/X-Example; Charset=UTF-8;label="Two Words"': 'parameters',
      });
      return {
        types: [...item.types], ordinary: await (await item.getType('TEXT/PLAIN')).text(),
        custom: await (await item.getType('web text/plain')).text(),
      };
    })).toEqual({
      types: ['text/plain', 'web text/plain', 'application/x-example;charset=UTF-8;label="Two Words"'],
      ordinary: 'ordinary', custom: 'custom',
    });
  });

  it('rejects invalid ordinary and custom MIME types without accepting an uppercase web prefix', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const { ClipboardItem } = window as unknown as Window;
      return ['', 'bad', 'text/', '/plain', 'text/has space', 'web ', 'web bad', 'WEB text/plain'].map((type) => {
        try { new ClipboardItem({ [type]: 'x' }); return false; }
        catch (error) { return error instanceof TypeError; }
      });
    })).toEqual(Array(8).fill(true));
  });

  it('rejects normalized duplicates while retaining separate custom and parameter-ordered keys', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const { ClipboardItem } = window as unknown as Window;
      const duplicate = [
        ['text/plain', 'TEXT/PLAIN'], ['web text/plain', 'web TEXT/PLAIN'],
        ['text/plain;a=1', 'text/plain;A="1"'],
      ].map(([first, second]) => {
        try { new ClipboardItem({ [first!]: 'a', [second!]: 'b' }); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      const item = new ClipboardItem({
        'text/plain': 'ordinary', 'web text/plain': 'custom',
        'text/plain;A=1;B=2': 'first', 'text/plain;b=2;a=1': 'second',
      });
      return { duplicate, types: [...item.types] };
    })).toEqual({
      duplicate: [true, true, true],
      types: ['text/plain', 'web text/plain', 'text/plain;a=1;b=2', 'text/plain;b=2;a=1'],
    });
  });

  it('matches serialized parameters exactly rather than only the MIME essence', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({ 'TEXT/PLAIN;A=1;B=2': 'first', 'text/plain;a=2': 'second' });
      const text = await (await item.getType(' text/PLAIN;A="1";B=2 ')).text();
      const missing: string[] = [];
      for (const type of ['text/plain;b=2;a=1', 'text/plain']) {
        try { await item.getType(type); missing.push('fulfilled'); }
        catch (error) { missing.push((error as DOMException).name); }
      }
      return { text, missing };
    })).toEqual({ text: 'first', missing: ['NotFoundError', 'NotFoundError'] });
  });

  it('preserves serialized MIME parameter case when creating a Blob from text', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({ 'TEXT/PLAIN;Charset=UTF-8;label="Two Words"': 'text' });
      const blob = await item.getType('text/plain;charset=UTF-8;label="Two Words"');
      return [blob.type, await blob.text()];
    })).toEqual(['text/plain;charset=UTF-8;label="Two Words"', 'text']);
  });

  it('UTF-8 encodes strings with replacement, preserving NUL, line endings, and BOM bytes', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({ 'text/plain': '\ufeffA\u0000\r\n\ud800\udc00\ud800' });
      const blob = await item.getType('text/plain');
      return { bytes: Array.from(await blob.bytes()), type: blob.type };
    })).toEqual({ bytes: [239, 187, 191, 65, 0, 13, 10, 240, 144, 128, 128, 239, 191, 189], type: 'text/plain' });
  });

  it('keeps custom representations separate and removes the web prefix from string Blob types', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({ 'text/plain': 'ordinary', 'web text/plain': 'custom' });
      const ordinary = await item.getType('text/plain'); const custom = await item.getType('web TEXT/PLAIN');
      return [[ordinary.type, custom.type], [await ordinary.text(), await custom.text()]];
    })).toEqual([['text/plain', 'text/plain'], ['ordinary', 'custom']]);
  });

  it('retains a supplied Blob or File identity even if its own type differs from the representation', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem, Blob, File } = window as unknown as Window;
      const blob = new Blob(['blob'], { type: 'application/x-other' });
      const file = new File(['file'], 'sample.txt', { type: 'text/x-file' });
      const item = new ClipboardItem({ 'text/plain': blob, 'text/html': file });
      return [await item.getType('text/plain') === blob, await item.getType('text/html') === file];
    })).toEqual([true, true]);
  });

  it('returns distinct promises and string Blobs without copying an existing Blob', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem, Blob } = window as unknown as Window;
      const blob = new Blob(['retained']);
      const item = new ClipboardItem({ 'text/plain': 'text', 'text/html': blob });
      const first = item.getType('text/plain'); const second = item.getType('text/plain');
      return [first !== second, await first !== await second,
        await item.getType('text/html') === blob, await item.getType('text/html') === blob];
    })).toEqual([true, true, true, true]);
  });

  it('waits for supplied promises and resolves thenables through Binding', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const source = Promise.withResolvers<string>();
      const item = new ClipboardItem({ 'text/plain': source.promise });
      let settled = false;
      const result = item.getType('text/plain').then((blob) => { settled = true; return blob; });
      await Promise.resolve(); const before = settled; source.resolve('later');
      const thenable = { then(resolve: (value: string) => void) { resolve('thenable'); } };
      const adopted = Reflect.construct(ClipboardItem, [{ 'text/plain': thenable }]) as ClipboardItem;
      return { before, text: await (await result).text(), adopted: await (await adopted.getType('text/plain')).text() };
    })).toEqual({ before: false, text: 'later', adopted: 'thenable' });
  });

  it('lets Binding convert non-Blob fulfillment values through the DOMString union arm', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const texts: string[] = [];
      for (const value of [null, undefined, false, 23, { toString() { return 'converted'; } }]) {
        const item = Reflect.construct(ClipboardItem, [{ 'text/plain': Promise.resolve(value) }]) as ClipboardItem;
        texts.push(await (await item.getType('text/plain')).text());
      }
      return texts;
    })).toEqual(['null', 'undefined', 'false', '23', 'converted']);
  });

  it('maps data rejection to NotFoundError and propagates fulfillment-conversion failures', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const sentinel = new Error('sentinel');
      const results: unknown[] = [];
      for (const source of [() => Promise.reject(sentinel), () => Promise.resolve(Symbol('no string')),
        () => Promise.resolve({ toString() { throw sentinel; } })]) {
        const item = Reflect.construct(ClipboardItem, [{ 'text/plain': source() }]) as ClipboardItem;
        try { await item.getType('text/plain'); results.push(false); }
        catch (error) { results.push([(error as Error).name, error === sentinel]); }
      }
      return results;
    })).toEqual([['NotFoundError', false], ['TypeError', false], ['Error', true]]);
  });

  it('applies Web IDL fulfillment conversion separately for each getType reaction', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      let count = 0;
      const value = { toString() { return 'read' + ++count; } };
      const item = Reflect.construct(ClipboardItem, [{ 'text/plain': value }]) as ClipboardItem;
      const first = await (await item.getType('text/plain')).text();
      const second = await (await item.getType('text/plain')).text();
      return { first, second, count };
    })).toEqual({ first: 'read1', second: 'read2', count: 2 });
  });

  it('rejects missing representations and invalid names through a Promise rather than throwing synchronously', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({ 'text/plain': 'x' });
      const results: unknown[] = [];
      for (const type of ['image/png', 'bad', Symbol('type')]) {
        let result: Promise<unknown> | undefined;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Supply an explicit receiver while testing invalid arguments.
        try { result = Reflect.apply(item.getType, item, [type]) as Promise<unknown>; }
        catch { results.push('threw'); continue; }
        try { await result; results.push('fulfilled'); }
        catch (error) { results.push([result instanceof Promise, (error as Error).name,
          error instanceof TypeError || error instanceof DOMException]); }
      }
      return results;
    })).toEqual([[true, 'NotFoundError', true], [true, 'TypeError', true], [true, 'TypeError', true]]);
  });

  it('checks receivers and required arguments for getType', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({ 'text/plain': 'x' });
      const results: boolean[] = [];
      for (const [receiver, args] of [[{}, ['text/plain']], [null, ['text/plain']], [item, []]] as const) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately vary the operation receiver.
        try { await Reflect.apply(ClipboardItem.prototype.getType, receiver, args); results.push(false); }
        catch (error) { results.push(error instanceof TypeError); }
      }
      return results;
    })).toEqual([true, true, true]);
  });

  it('recognizes the specified mandatory/optional vocabulary without normalizing ordinary names', async () => {
    const browser = await secureBrowser();
    const supported = ['text/plain', 'text/html', 'image/png', 'text/uri-list', 'image/svg+xml',
      'web text/plain', 'web application/x-test', 'web TEXT/PLAIN;A=1'];
    const unsupported = ['', 'application/x-test', 'TEXT/PLAIN', ' text/plain ', 'text/plain;charset=utf-8',
      'web bad', 'web ', 'WEB text/plain'];
    expect(supported.map((type) => browser.window.ClipboardItem.supports(type))).toEqual(supported.map(() => true));
    expect(unsupported.map((type) => browser.window.ClipboardItem.supports(type))).toEqual(unsupported.map(() => false));
  });

  it('converts supports arguments without requiring a ClipboardItem receiver', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const { ClipboardItem } = window as unknown as Window;
      let converted = 0; const failures: boolean[] = [];
      // eslint-disable-next-line @typescript-eslint/unbound-method -- The static operation has no receiver requirement.
      const supported = Reflect.apply(ClipboardItem.supports, null, [{ toString() { converted++; return 'text/plain'; } }]) as boolean;
      for (const args of [[], [Symbol('type')]]) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise missing/invalid arguments with an explicit receiver.
        try { Reflect.apply(ClipboardItem.supports, null, args); failures.push(false); }
        catch (error) { failures.push(error instanceof TypeError); }
      }
      return { converted, supported, failures };
    })).toEqual({ converted: 1, supported: true, failures: [true, true] });
  });

  it('uses the item realm for borrowed method promises, new Blobs and frozen arrays', async () => {
    const browser = await secureBrowser();
    Reflect.set(browser.window, 'clipboardOtherWindow', createSiblingWindow(browser));
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      const item = new ClipboardItem({ 'text/plain': 'text' });
      const result = other.ClipboardItem.prototype.getType.call(item, 'text/plain');
      const blob = await result;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately borrow another realm's accessor.
      const getter = Object.getOwnPropertyDescriptor(other.ClipboardItem.prototype, 'types')!.get!;
      const types = Reflect.apply(getter, item, []) as readonly string[];
      return [result instanceof Promise, result instanceof other.Promise,
        blob instanceof Blob, blob instanceof other.Blob, types === item.types,
        Object.getPrototypeOf(types) === Array.prototype];
    })).toEqual([true, false, true, false, true, true]);
  });

  it('retains foreign supplied Blobs and their relevant realm', async () => {
    const browser = await secureBrowser();
    Reflect.set(browser.window, 'clipboardOtherWindow', createSiblingWindow(browser));
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      const foreign = new other.Blob(['foreign']);
      const item = new ClipboardItem({ 'text/plain': foreign });
      const blob = await item.getType('text/plain');
      return [blob === foreign, blob instanceof other.Blob, blob instanceof Blob];
    })).toEqual([true, true, false]);
  });

  it('distinguishes constructor/method errors from rejections created in the item realm', async () => {
    const browser = await secureBrowser();
    Reflect.set(browser.window, 'clipboardOtherWindow', createSiblingWindow(browser));
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      let constructorError = false;
      try { new ClipboardItem({ bad: 'x' }); } catch (error) { constructorError = error instanceof TypeError; }
      const item = new ClipboardItem({ 'text/plain': 'x' });
      const invalid = other.ClipboardItem.prototype.getType.call(item, 'bad');
      let invalidError = false;
      try { await invalid; } catch (error) { invalidError = error instanceof other.TypeError; }
      const missing = other.ClipboardItem.prototype.getType.call(item, 'image/png');
      let missingError = false; let foreignError = false;
      try { await missing; } catch (error) {
        missingError = error instanceof DOMException; foreignError = error instanceof other.DOMException;
      }
      return [constructorError, invalid instanceof other.Promise, invalidError,
        missing instanceof Promise, missingError, foreignError];
    })).toEqual([true, true, true, true, true, false]);
  });

  it('does not use native clipboard hooks and leaves native lazy reading explicitly unavailable', async () => {
    const browser = await secureBrowser();
    const read = vi.spyOn(SystemClipboard.prototype, 'readChangeState');
    const write = vi.spyOn(SystemClipboard.prototype, 'replaceNativeContents');
    expect(await browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const item = new ClipboardItem({ 'text/plain': 'author' });
      return (await item.getType('text/plain')).text();
    })).toBe('author');
    expect(browser.window.ClipboardItem.supports('text/plain')).toBe(true);
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    const doc = getRelevantRealm(browser.window).env.window.getAssociatedDocument();
    expect(() => new SystemClipboard().readItems(doc, [])).toThrow('Native lazy ClipboardItem reading is not implemented');
  });
});

async function secureBrowser(): Promise<Browlet> {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://clipboard.test/');
  return browser;
}
