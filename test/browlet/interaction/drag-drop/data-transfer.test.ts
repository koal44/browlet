import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { DataTransferImpl } from '../../../../src/browlet/interaction/drag-drop/index';
import type { DataTransferItem, Window } from '../../../../src/browlet/platform';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('HTML §§6.11.2–6.11.3: DataTransfer data API', () => {
  it('constructs an empty read/write transfer with stable list objects and frozen types', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const transfer = new DataTransfer();
      return {
        effects: [transfer.dropEffect, transfer.effectAllowed],
        lengths: [transfer.items.length, transfer.files.length, transfer.types.length],
        stable: [transfer.items === transfer.items, transfer.files === transfer.files, transfer.types === transfer.types],
        frozen: Object.isFrozen(transfer.types), realm: Object.getPrototypeOf(transfer.types) === Array.prototype,
        tags: [transfer, transfer.items].map((value) => Object.prototype.toString.call(value)),
        constructors: [DataTransfer.length, DataTransferItemList.length, DataTransferItem.length],
        members: [transfer.items.add.length, transfer.items.remove.length, transfer.clearData.length, transfer.setDragImage.length],
        extraMethods: ['getItem', 'addString', 'addFile'].some((name) => name in transfer.items),
      };
    })).toEqual({
      effects: ['none', 'none'], lengths: [0, 0, 0], stable: [true, true, true], frozen: true, realm: true,
      tags: ['[object DataTransfer]', '[object DataTransferItemList]'], constructors: [0, 0, 0],
      members: [1, 1, 0, 3], extraMethods: false,
    });
  });

  it('keeps item/list constructors illegal and rejects invalid author inputs and receivers', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const transfer = new DataTransfer();
      const item = transfer.items.add('value', 'type')!;
      /* eslint-disable @typescript-eslint/unbound-method -- Deliberately invalid receivers/arguments go through the original platform functions. */
      const checks: (() => void)[] = [
        () => Reflect.construct(DataTransferItemList, []), () => Reflect.construct(DataTransferItem, []),
        () => { Reflect.apply(DataTransfer, undefined, []); },
        () => { Reflect.apply(transfer.getData, {}, ['text']); },
        () => { Reflect.apply(transfer.items.add, transfer.items, []); },
        () => { Reflect.apply(transfer.items.add, transfer.items, ['text']); },
        () => { Reflect.apply(transfer.items.add, transfer.items, [new Blob()]); },
        () => { Reflect.apply(transfer.items.remove, transfer.items, []); },
        () => { Reflect.apply(transfer.setData, transfer, ['text']); },
        () => { Reflect.apply(transfer.setData, transfer, ['text', Symbol()]); },
        () => { Reflect.apply(item.getAsString, item, []); },
        () => { Reflect.apply(item.getAsString, item, [{}]); },
        () => { Reflect.apply(transfer.setDragImage, transfer, [{}, 0, 0]); },
      ];
      /* eslint-enable @typescript-eslint/unbound-method */
      return checks.map((check) => { try { check(); return false; } catch (error) { return error instanceof TypeError; } });
    })).toEqual(Array(13).fill(true));
  });

  it('accepts exactly the specified case-sensitive effect values', () => {
    const { transfer } = createFixture();
    for (const value of ['none', 'copy', 'link', 'move']) { transfer.dropEffect = value; expect(transfer.dropEffect).toBe(value); }
    transfer.dropEffect = 'Copy'; expect(transfer.dropEffect).toBe('move');
    for (const value of ['none', 'copy', 'copyLink', 'copyMove', 'link', 'linkMove', 'move', 'all', 'uninitialized']) {
      transfer.effectAllowed = value; expect(transfer.effectAllowed).toBe(value);
    }
    transfer.effectAllowed = 'COPY'; expect(transfer.effectAllowed).toBe('uninitialized');
  });

  it('converts strings once, applies only ASCII lowercasing, and preserves arbitrary formats and UTF-16', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const transfer = new DataTransfer(); const order: string[] = [];
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the platform function with an explicit receiver.
      Reflect.apply(transfer.setData, transfer, [
        { toString() { order.push('format'); return 'TEXT/ÄBC'; } },
        { toString() { order.push('data'); return '\ud800'; } },
      ]);
      transfer.setData('', 'empty type');
      transfer.setData(' X ', 'spaces');
      return { order, types: transfer.types, data: [transfer.getData('text/Äbc'), transfer.getData(''), transfer.getData(' X ')] };
    })).toEqual({ order: ['format', 'data'], types: ['text/Äbc', '', ' x '], data: ['\ud800', 'empty type', 'spaces'] });
  });

  it('uses legacy aliases for string methods and appends replacements with a new item identity', () => {
    const { transfer } = createFixture();
    transfer.setData('TEXT', 'first');
    const old = transfer.items[0]!; const original = transfer.types;
    transfer.setData('text/html', '<b>second</b>');
    const before = transfer.types;
    transfer.setData('Text/Plain', 'replacement');
    expect(transfer.types).toEqual(['text/html', 'text/plain']);
    expect(before).toEqual(['text/plain', 'text/html']); expect(original).toEqual(['text/plain']);
    expect(transfer.getData('text')).toBe('replacement');
    expect(transfer.items[1]).not.toBe(old);
    expect([old.kind, old.type, old.getAsFile()]).toEqual(['', '', null]);
    expect(transfer.types).not.toBe(before);
    transfer.clearData('TEXT'); expect(transfer.types).toEqual(['text/html']);
    transfer.setData('URL', 'https://one.test/'); expect(transfer.types).toEqual(['text/html', 'text/uri-list']);
    transfer.clearData('url'); expect(transfer.types).toEqual(['text/html']);
  });

  it.each([
    ['#comment\r\nhttps://one.test/\r\nhttps://two.test/', 'https://one.test/'],
    ['  https://one.test/  \nhttps://two.test/', 'https://one.test/'],
    ['not a URL\nhttps://two.test/', 'not a URL'],
    ['#comment\n\n', ''],
    ['https://one.test/#fragment\rhttps://two.test/', 'https://one.test/#fragment'],
  ])('selects the first URI-list entry from %j', (input, expected) => {
    const { transfer } = createFixture(); transfer.setData('URL', input);
    expect(transfer.getData('url')).toBe(expected);
    expect(transfer.getData('text/uri-list')).toBe(input);
  });

  it('keeps literal item types separate from legacy aliases and rejects duplicate text types', () => {
    const { transfer } = createFixture();
    const plain = transfer.items.add('plain', 'TEXT/PLAIN')!;
    const text = transfer.items.add('literal', 'TEXT')!;
    const url = transfer.items.add('literal url', 'URL')!;
    expect([plain.type, text.type, url.type]).toEqual(['text/plain', 'text', 'url']);
    expect(transfer.getData('text')).toBe('plain'); expect(transfer.getData('url')).toBe('');
    expect(() => transfer.items.add('duplicate', 'Text/Plain')).toThrow(expect.objectContaining({ name: 'NotSupportedError' }));
    expect(transfer.items.length).toBe(3);
  });

  it('keeps indexed identities through removal and disables removed items permanently', () => {
    const { transfer } = createFixture();
    const first = transfer.items.add('first', 'a')!; const second = transfer.items.add('second', 'b')!;
    expect(transfer.items[0]).toBe(first); expect(transfer.items[1]).toBe(second);
    expect(Object.keys(transfer.items)).toEqual(['0', '1']);
    expect(Object.getOwnPropertyDescriptor(transfer.items, '0')).toEqual({
      value: first, enumerable: true, configurable: true, writable: false,
    });
    transfer.items.remove(0);
    expect(transfer.items[0]).toBe(second); expect(transfer.items[1]).toBeUndefined();
    expect(1 in transfer.items).toBe(false); expect(Object.keys(transfer.items)).toEqual(['0']);
    expect([first.kind, first.type]).toEqual(['', '']);
    transfer.items.add('first', 'a'); expect(transfer.items[1]).not.toBe(first);
    expect(Reflect.set(transfer.items, '0', first)).toBe(false);
  });

  it('retains types for no-op operations and replaces them for actual content changes', () => {
    const { transfer } = createFixture();
    const empty = transfer.types; transfer.items.clear(); transfer.clearData(); expect(transfer.types).toBe(empty);
    transfer.setData('text', 'value'); const types = transfer.types;
    transfer.clearData('missing'); transfer.items.remove(99); transfer.items.remove(-1); expect(transfer.types).toBe(types);
    transfer.setData('text', 'value'); expect(transfer.types).not.toBe(types);
    expect(types).toEqual(['text/plain']);
    transfer.items.remove(2 ** 32); expect(transfer.items.length).toBe(0);
  });

  it('retains original Files, permits duplicates, and keeps a live SameObject FileList', () => {
    const { transfer, window } = createFixture(); const files = transfer.files;
    const file = new window.File(['contents'], 'a.txt', { type: 'TEXT/PLAIN', lastModified: 123 });
    const first = transfer.items.add(file)!; const second = transfer.items.add(file)!;
    expect(first).not.toBe(second); expect(first.kind).toBe('file'); expect(first.type).toBe('text/plain');
    expect(first.getAsFile()).toBe(file); expect(first.getAsFile()).toBe(first.getAsFile());
    expect(files).toBe(transfer.files); expect([files[0], files[1]]).toEqual([file, file]);
    expect(transfer.types).toEqual(['Files']);
    transfer.setData('TEXT', 'text'); expect(transfer.types).toEqual(['text/plain', 'Files']);
    transfer.clearData(); expect(transfer.items.length).toBe(2); expect(files.length).toBe(2);
    transfer.items.remove(0); expect(files.length).toBe(1); expect(second.getAsFile()).toBe(file);
    expect([first.kind, first.type, first.getAsFile()]).toEqual(['', '', null]);
    transfer.items.clear(); expect(files.length).toBe(0); expect(second.getAsFile()).toBeNull();
  });

  it('treats a File supplied with two arguments as the string overload', () => {
    const { transfer, window } = createFixture(); const file = new window.File([], 'a.txt');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the platform function with an explicit receiver.
    const item = Reflect.apply(transfer.items.add, transfer.items, [file, 'custom']) as DataTransferItem;
    expect(item.kind).toBe('string'); expect(transfer.getData('custom')).toBe('[object File]');
  });

  it('clears all text for omitted/undefined format while retaining files', () => {
    const { transfer, window } = createFixture(); transfer.items.add(new window.File([], 'x'));
    transfer.setData('undefined', 'x'); transfer.setData('text', 'x');
    transfer.clearData(undefined); expect(transfer.types).toEqual(['Files']);
    transfer.setData('undefined', 'x'); transfer.setData('text', 'x');
    transfer.clearData('undefined'); expect(transfer.types).toEqual(['text/plain', 'Files']);
  });

  it('makes protected data unreadable but keeps kinds/types visible, then restores read-only access', () => {
    const { transfer, implementation, window } = createFixture();
    const text = transfer.items.add('secret', 'text/plain')!;
    const file = new window.File(['secret'], 'a.txt'); const fileItem = transfer.items.add(file)!;
    const files = transfer.files; const types = transfer.types;
    implementation.setMode('protected');
    expect(transfer.items.length).toBe(2); expect(transfer.types).toBe(types);
    expect([text.kind, text.type, fileItem.kind]).toEqual(['string', 'text/plain', 'file']);
    expect(transfer.getData('text')).toBe(''); expect(fileItem.getAsFile()).toBeNull(); expect(files.length).toBe(0);
    const callback = vi.fn(); text.getAsString(callback);
    expect(transfer.items.add('new', 'x')).toBeNull(); expect(transfer.items.add(file)).toBeNull();
    transfer.setData('text', 'changed'); transfer.clearData(); transfer.items.clear();
    expect(() => transfer.items.remove(999)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    transfer.effectAllowed = 'all'; expect(transfer.effectAllowed).toBe('none');
    transfer.dropEffect = 'copy'; expect(transfer.dropEffect).toBe('copy');
    implementation.setMode('read-only');
    expect(transfer.getData('text')).toBe('secret'); expect(fileItem.getAsFile()).toBe(file);
    expect(files[0]).toBe(file); expect(files.length).toBe(1); expect(callback).not.toHaveBeenCalled();
    transfer.setData('text', 'changed'); expect(transfer.getData('text')).toBe('secret');
    implementation.setMode('read/write'); transfer.setData('text', 'changed'); expect(transfer.getData('text')).toBe('changed');
  });

  it('permits queued reads but rejects every mutation in read-only mode', () => {
    const { transfer, implementation, loop, window } = createFixture();
    const item = transfer.items.add('value', 'text/plain')!;
    const file = new window.File([], 'x');
    implementation.setMode('read-only');
    const callback = vi.fn(); item.getAsString(callback);
    expect(callback).not.toHaveBeenCalled(); loop.runTaskTurn(); expect(callback).toHaveBeenCalledWith('value');
    expect(transfer.items.add('new', 'type')).toBeNull(); expect(transfer.items.add(file)).toBeNull();
    transfer.clearData(); transfer.items.clear(); transfer.effectAllowed = 'all';
    expect(transfer.effectAllowed).toBe('none'); expect(transfer.items[0]).toBe(item);
    expect(() => transfer.items.remove(999)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('ends access explicitly while retained views and items become disabled', () => {
    const { transfer, implementation, window } = createFixture();
    const items = transfer.items; const files = transfer.files;
    const text = items.add('value', 'text/plain')!; const file = items.add(new window.File([], 'x'))!;
    const types = transfer.types;
    implementation.detach();
    expect(transfer.items).toBe(items); expect(transfer.files).toBe(files);
    expect([items.length, files.length, transfer.types.length]).toEqual([0, 0, 0]);
    expect(types).toEqual(['text/plain', 'Files']); expect(transfer.types).not.toBe(types);
    expect([text.kind, text.type, file.kind, file.getAsFile()]).toEqual(['', '', '', null]);
    expect(transfer.getData('text')).toBe(''); expect(items.add('x', 'y')).toBeNull();
    expect(() => items.remove(0)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    transfer.setData('text', 'value'); transfer.clearData(); items.clear();
    implementation.setMode('read/write'); expect(items.length).toBe(0);
    const detachedTypes = transfer.types; implementation.detach(); expect(transfer.types).toBe(detachedTypes);
  });

  it('still performs author conversion before access checks, including reentrant detachment', () => {
    const { transfer, implementation } = createFixture(); const trace: string[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the platform function with an explicit receiver.
    Reflect.apply(transfer.setData, transfer, [
      { toString() { trace.push('format'); implementation.detach(); return 'text'; } },
      { toString() { trace.push('data'); return 'value'; } },
    ]);
    expect(trace).toEqual(['format', 'data']); expect(transfer.items.length).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the platform function with an explicit receiver.
    expect(() => { Reflect.apply(transfer.items.add, transfer.items, ['data', Symbol()]); }).toThrow();
  });

  it('queues captured strings on user interaction and survives removal and detachment before delivery', () => {
    const { transfer, implementation, loop } = createFixture(); const trace: string[] = [];
    const first = transfer.items.add('first', 'a')!; const second = transfer.items.add('second', 'b')!;
    first.getAsString((data) => trace.push(data)); second.getAsString((data) => trace.push(data));
    expect(trace).toEqual([]); expect([...loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(2);
    transfer.items.remove(0); implementation.detach();
    loop.runTaskTurn(); loop.runTaskTurn();
    expect(trace).toEqual(['first', 'second']);
    first.getAsString((data) => trace.push(data)); expect(loop.runTaskTurn()).toBe(false);
  });

  it('does not queue null callbacks, file callbacks, protected reads, or disabled reads', () => {
    const { transfer, implementation, loop, window } = createFixture();
    const item = transfer.items.add('text', 'text/plain')!; const callback = vi.fn();
    item.getAsString(null);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the platform function with an explicit receiver.
    Reflect.apply(item.getAsString, item, [undefined]);
    transfer.items.add(new window.File([], 'x'))!.getAsString(callback);
    implementation.setMode('protected'); item.getAsString(callback);
    implementation.detach(); item.getAsString(callback);
    expect([...loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it('delivers string callbacks asynchronously in author code and reports exceptions', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => new Promise((resolve) => {
      const transfer = new DataTransfer(); let sync = true;
      transfer.items.add('text', 'type')!.getAsString(function(this: void, data) {
        'use strict';
        resolve([data, sync, this === undefined]);
      });
      sync = false;
    }))).toEqual(['text', false, true]);
    const { transfer, env, loop } = createFixture(); const report = vi.spyOn(env.realm, 'reportException').mockImplementation(() => {});
    const error = new Error('callback'); transfer.items.add('text', 'type')!.getAsString(() => { throw error; });
    expect(() => loop.runTaskTurn()).not.toThrow(); expect(report).toHaveBeenCalledWith(error);
  });

  it('keeps types, items, FileList, and File ownership when methods/getters are borrowed across realms', () => {
    const a = createFixture(); const b = createFixture();
    const file = new b.window.File(['x'], 'x.txt'); const item = a.transfer.items.add(file)!;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the platform function with an explicit receiver.
    const typesGetter = Object.getOwnPropertyDescriptor(b.window.DataTransfer.prototype, 'types')!.get as () => readonly string[];
    const types = Reflect.apply(typesGetter, a.transfer, []);
    expect(types).toBe(a.transfer.types); expect(Object.getPrototypeOf(types)).toBe((Reflect.get(a.window, 'Array') as ArrayConstructor).prototype);
    expect(getRelevantRealm(item)).toBe(a.env.realm); expect(getRelevantRealm(a.transfer.items)).toBe(a.env.realm);
    expect(getRelevantRealm(a.transfer.files)).toBe(a.env.realm);
    expect(item.getAsFile()).toBe(file); expect(a.transfer.files[0]).toBe(file);
    expect(getRelevantRealm(item.getAsFile()!)).toBe(b.env.realm);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the platform function with an explicit receiver.
    const add = b.window.DataTransferItemList.prototype.add;
    const text = Reflect.apply(add, a.transfer.items, ['value', 'type']) as DataTransferItem;
    expect(getRelevantRealm(text)).toBe(a.env.realm);
  });

  it('reaches the explicit drag-image dependency only after IDL conversion and write-access checks', () => {
    const { transfer, implementation, window } = createFixture();
    const image = window.document.createElement('img'); const element = window.document.createElement('div');
    for (const target of [image, element]) {
      expect(() => transfer.setDragImage(target, 1, 2)).toThrow('DataTransfer drag-image rendering is not implemented');
    }
    implementation.setMode('read-only'); expect(() => transfer.setDragImage(image, 1, 2)).not.toThrow();
    implementation.detach(); expect(() => transfer.setDragImage(element, 1, 2)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the platform function with an explicit receiver.
    expect(() => { Reflect.apply(transfer.setDragImage, transfer, [{}, 1, 2]); }).toThrow();
  });
});

function createFixture() {
  const userAgent = createManualUserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const window = project(traversable.activeWindow!) as Window;
  const transfer = new window.DataTransfer();
  const implementation = unwrap<DataTransferImpl>(transfer);
  const env = traversable.activeDocument!.env;
  return { userAgent, traversable, window, transfer, implementation, env, loop: env.responsibleEventLoop };
}
