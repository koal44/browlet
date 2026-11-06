import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { ClipboardReadSnapshot, ClipboardWriteItem } from '../../../../src/browlet/interaction/clipboard/index';
import type { ClipboardItem, Window } from '../../../../src/browlet/platform';
import { clipboardTaskSource } from '../../../../src/browlet/scripting/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §§7.2.3/7.3.1: lazy system clipboard items', () => {
  it('creates metadata-only items, preserving order, styles, frozen types and system clipboard indices', async () => {
    const f = await createFixture();
    f.snapshot.items.push({ index: 8, formats: new Map(), presentationStyle: 'unspecified' },
      { index: 9, formats: new Map([['image/png', 'PNG']]), presentationStyle: 'attachment' });
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const items = await w.navigator.clipboard.read();
      return items.map((item) => ({
        types: [...item.types], style: item.presentationStyle,
        frozen: Object.isFrozen(item.types), stable: item.types === item.types, instance: item instanceof w.ClipboardItem,
      }));
    })).toEqual([
      { types: ['text/plain'], style: 'inline', frozen: true, stable: true, instance: true },
      { types: ['image/png'], style: 'attachment', frozen: true, stable: true, instance: true },
    ]);
    expect(f.metadata).toHaveBeenCalledExactlyOnceWith(f.document);
    expect(f.bytes).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  });

  it('shares pending and settled promises and Blob identity for one canonical type', async () => {
    const f = await createFixture(); await retainItem(f.browser);
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<Uint8Array | null>());
    const started = Promise.withResolvers<void>();
    f.bytes.mockImplementation(() => { started.resolve(); return pending.promise; });
    const run = f.browser.evaluate(async () => {
      const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      const first = item.getType('TEXT/PLAIN'); const second = item.getType('text/plain');
      const [a, b] = await Promise.all([first, second]);
      const third = item.getType('text/plain');
      return [first === second, first === third, a === b, a === await third, await a.text()];
    });
    await started.promise; expect(f.bytes).toHaveBeenCalledTimes(1);
    pending.resolve(new TextEncoder().encode('one read'));
    expect(await run).toEqual([true, true, true, true, 'one read']);
    expect(f.bytes).toHaveBeenCalledExactlyOnceWith(7, 'text/plain', 13, new Uint8Array([1]), f.document);
  });

  it('keeps custom, standard and parameter-distinct representations separate', async () => {
    const f = await createFixture();
    f.snapshot.items[0]!.formats = new Map(['text/plain', 'web text/plain', 'text/plain;charset=utf-8', 'text/plain;charset=iso-8859-1'].map((type) => [type, type]));
    await retainItem(f.browser);
    expect(await f.browser.evaluate(async () => {
      const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      return Promise.all(item.types.map(async (type) => {
        const blob = await item.getType(type); return [blob.type, await blob.text()];
      }));
    })).toEqual([
      ['text/plain', '7:text/plain'], ['text/plain', '7:web text/plain'],
      ['text/plain;charset=utf-8', '7:text/plain;charset=utf-8'],
      ['text/plain;charset=iso-8859-1', '7:text/plain;charset=iso-8859-1'],
    ]);
    expect(f.bytes).toHaveBeenCalledTimes(4); expect(f.prepare).not.toHaveBeenCalled();
  });

  it('keeps different system clipboard items and successive read results independent', async () => {
    const f = await createFixture();
    f.snapshot.items.push({ index: 9, formats: new Map([['text/plain', 13]]), presentationStyle: 'attachment' });
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const a = await w.navigator.clipboard.read(); const b = await w.navigator.clipboard.read();
      const x = a[0]!.getType('text/plain'); const y = a[1]!.getType('text/plain'); const z = b[0]!.getType('text/plain');
      return [x === y, x === z, await (await x).text(), await (await y).text(), await (await z).text()];
    })).toEqual([false, false, '7:text/plain', '9:text/plain', '7:text/plain']);
    expect(f.bytes).toHaveBeenCalledTimes(3);
  });

  it('snapshots the token, index, style and format mappings', async () => {
    const f = await createFixture(); await retainItem(f.browser);
    f.snapshot.entry[0] = 99; f.snapshot.items[0]!.index = 88;
    f.snapshot.items[0]!.formats.set('image/png', 'PNG'); f.snapshot.items[0]!.formats.set('text/plain', 'changed'); f.snapshot.items[0]!.presentationStyle = 'attachment';
    expect(await f.browser.evaluate(async () => {
      const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      return [[...item.types], item.presentationStyle, await (await item.getType('text/plain')).text()];
    })).toEqual([['text/plain'], 'inline', '7:text/plain']);
    expect(f.bytes).toHaveBeenCalledExactlyOnceWith(7, 'text/plain', 13, new Uint8Array([1]), f.document);
  });

  it.each(['before', 'cached'] as const)('rejects a changed generation %s any cached return', async (phase) => {
    const f = await createFixture(); await retainItem(f.browser);
    if (phase === 'cached') expect(await readOutcome(f.browser)).toMatchObject({ text: '7:text/plain' });
    f.state.token = new Uint8Array([2]);
    expect(await readOutcome(f.browser)).toMatchObject({ name: 'InvalidStateError', realm: true, promise: true });
    expect(f.bytes).toHaveBeenCalledTimes(phase === 'cached' ? 1 : 0);
  });

  it('rechecks generation before a queued native read begins', async () => {
    const f = await createFixture(); await retainItem(f.browser);
    const started = Promise.withResolvers<void>(); const steps: (() => void)[] = [];
    vi.spyOn(f.env, 'runInParallel').mockImplementation((step) => { steps.push(step); started.resolve(); });
    const result = readOutcome(f.browser); await started.promise;
    expect(f.bytes).not.toHaveBeenCalled(); f.state.token = new Uint8Array([2]); steps[0]!();
    expect(await result).toMatchObject({ name: 'InvalidStateError' }); expect(f.bytes).not.toHaveBeenCalled();
  });

  it('rejects a generation change while the native byte read is pending', async () => {
    const f = await createFixture(); await retainItem(f.browser);
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<Uint8Array | null>());
    const started = Promise.withResolvers<void>();
    f.bytes.mockImplementation(() => { started.resolve(); return pending.promise; });
    const result = readOutcome(f.browser); await started.promise;
    f.state.token = new Uint8Array([2]); pending.resolve(new TextEncoder().encode('old data'));
    expect(await result).toMatchObject({ name: 'InvalidStateError' }); expect(f.prepare).not.toHaveBeenCalled();
  });

  it.each(['focus', 'generation', 'activity'] as const)('rechecks %s in the result-delivery task', async (change) => {
    const f = await createFixture(); await retainItem(f.browser);
    const queued = Promise.withResolvers<void>(); const delivery: (() => void)[] = [];
    const queue = f.env.queueTask.bind(f.env);
    vi.spyOn(f.env, 'queueTask').mockImplementation((source, steps) => {
      if (source !== 'clipboard') return queue(source, steps);
      delivery.push(steps); queued.resolve(); return { remove() {} };
    });
    let settled = false;
    const result = readOutcome(f.browser).then((value) => { settled = true; return value; });
    await queued.promise; expect(settled).toBe(false); expect(delivery).toHaveLength(1);
    if (change === 'focus') f.focus.mockReturnValue(false);
    if (change === 'generation') f.state.token = new Uint8Array([2]);
    // Let the task enter normally, then exercise the operation's own activity check.
    f.env.realm.queueGlobalTask(clipboardTaskSource, () => {
      const active = change === 'activity' ? vi.spyOn(f.document, 'isFullyActive').mockReturnValue(false) : null;
      try { delivery[0]!(); } finally { active?.mockRestore(); }
    });
    expect(await result).toMatchObject({ name: change === 'generation' ? 'InvalidStateError' : 'NotAllowedError' });
  });

  it('refuses cached access without focus but retains the successful cache if focus returns', async () => {
    const f = await createFixture(); await retainItem(f.browser);
    await f.browser.evaluate(async () => {
      const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      const p = item.getType('text/plain'); Reflect.set(window, 'clipboardReadPromise', p); await p;
    });
    f.focus.mockReturnValue(false); expect(await readOutcome(f.browser)).toMatchObject({ name: 'NotAllowedError' });
    f.focus.mockReturnValue(true);
    expect(await f.browser.evaluate(() => (Reflect.get(window, 'clipboardItem') as ClipboardItem).getType('text/plain') ===
      Reflect.get(window, 'clipboardReadPromise'))).toBe(true);
    expect(f.bytes).toHaveBeenCalledTimes(1);
  });

  it('reports unknown and invalid types without reaching the native reader', async () => {
    const f = await createFixture(); await retainItem(f.browser);
    expect(await readOutcome(f.browser, 'image/png')).toMatchObject({ name: 'NotFoundError' });
    expect(await readOutcome(f.browser, 'invalid')).toMatchObject({ name: 'TypeError' });
    expect(f.bytes).not.toHaveBeenCalled(); expect(f.sequence).not.toHaveBeenCalled();
  });

  it('rejects the specified custom-only item with no originating native index', async () => {
    const f = await createFixture(); f.snapshot.items[0]!.index = null; f.snapshot.items[0]!.formats = new Map([['web text/plain', 'web text/plain']]);
    await retainItem(f.browser);
    expect(await readOutcome(f.browser, 'web text/plain')).toMatchObject({ name: 'InvalidStateError' });
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it.each(['absent', 'throw', 'reject'] as const)('caches the %s native result without retrying it', async (failure) => {
    const f = await createFixture(); await retainItem(f.browser);
    f.bytes.mockImplementation(() => {
      if (failure === 'throw') throw new Error('native failed');
      return failure === 'absent' ? f.env.userAgent.HostPromise.resolve(null, internalType<Uint8Array | null>()) :
        f.env.userAgent.HostPromise.reject(new Error('native failed'), internalType<Uint8Array | null>());
    });
    expect(await f.browser.evaluate(async () => {
      const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      const first = item.getType('text/plain'); const second = item.getType('TEXT/PLAIN');
      let reason: unknown;
      try { await first; } catch (error) { reason = error; }
      const third = item.getType('text/plain');
      try { await third; return []; } catch (error) {
        return [first === second, first === third, reason === error, (error as Error).name, (error as Error).message];
      }
    })).toEqual([true, true, true, failure === 'absent' ? 'NotFoundError' : 'Error',
      failure === 'absent' ? 'Clipboard representation is unavailable' : 'native failed']);
    expect(f.bytes).toHaveBeenCalledTimes(1);
  });

  it.each(['text/html', 'image/svg+xml'])('prepares standard %s before creating the returned Blob', async (type) => {
    const f = await createFixture(); f.snapshot.items[0]!.formats = new Map([[type, type]]); await retainItem(f.browser);
    f.prepare.mockImplementation(() => f.env.userAgent.HostPromise.resolve(new TextEncoder().encode('prepared'), internalType<Uint8Array>()));
    expect(await readOutcome(f.browser, type)).toMatchObject({ text: 'prepared', type });
    expect(f.prepare).toHaveBeenCalledExactlyOnceWith(new TextEncoder().encode('7:' + type), type, f.document);
  });

  it.each(['text/plain', 'text/uri-list', 'image/png', 'web text/html'])('preserves %s bytes without rich-format preparation', async (type) => {
    const f = await createFixture(); f.snapshot.items[0]!.formats = new Map([[type, type]]);
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    f.bytes.mockImplementation(() => f.env.userAgent.HostPromise.resolve(bytes, internalType<Uint8Array | null>()));
    await retainItem(f.browser);
    expect(await f.browser.evaluate(async (type) => {
      const blob = await (Reflect.get(window, 'clipboardItem') as ClipboardItem).getType(type);
      return [blob.type, Array.from(new Uint8Array(await blob.arrayBuffer()))];
    }, type)).toEqual([type.replace(/^web /, ''), [0, 255, 128, 13, 10]]);
    bytes.fill(0);
    expect(await f.browser.evaluate(async (type) => Array.from(new Uint8Array(await
    (await (Reflect.get(window, 'clipboardItem') as ClipboardItem).getType(type)).arrayBuffer())), type)).toEqual([0, 255, 128, 13, 10]);
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it('retains read admission’s unsanitized HTML policy for later lazy access', async () => {
    const f = await createFixture(); f.snapshot.items[0]!.formats = new Map([['text/html', 'HTML Format']]);
    await retainItem(f.browser, ['text/html']);
    expect(await readOutcome(f.browser, 'text/html')).toMatchObject({ text: '7:text/html' });
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it('keeps results, cached promises and errors in the item realm when getType is borrowed', async () => {
    const f = await createFixture(); await retainItem(f.browser);
    Reflect.set(f.browser.window, 'clipboardOtherWindow', createSiblingWindow(f.browser));
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window; const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow with the original item receiver.
      const getType = (other as Window).ClipboardItem.prototype.getType;
      const p = getType.call(item, 'text/plain'); const blob = await p;
      const missing = getType.call(item, 'image/png'); let ownError = false;
      try { await missing; } catch (error) { ownError = error instanceof DOMException && !(error instanceof other.DOMException); }
      return [p instanceof Promise, p instanceof other.Promise, blob instanceof w.Blob, blob instanceof other.Blob,
        item.getType('text/plain') === p, missing instanceof Promise, ownError];
    })).toEqual([true, false, true, false, true, true, true]);
  });

  it('reuses lazy data when a read-backed ClipboardItem is written', async () => {
    const f = await createFixture(); await retainItem(f.browser);
    f.env.userAgent.permissionStore.setEntry({ name: 'clipboard-write', allowWithoutGesture: true }, f.env.topLevelOrigin, 'granted');
    const writes: ClipboardWriteItem[][] = [];
    vi.spyOn(f.system, 'writeItems').mockImplementation((items) => {
      writes.push(items); return f.env.userAgent.HostPromise.resolve(false, internalType<boolean>());
    });
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window; const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      await item.getType('text/plain'); await w.navigator.clipboard.write([item]); return true;
    })).toBe(true);
    expect(f.bytes).toHaveBeenCalledTimes(1); expect(writes).toHaveLength(1);
    expect(writes[0]![0]!.presentationStyle).toBe('inline');
    expect(writes[0]![0]!.representations[0]!.type).toBe('text/plain');
    expect(await writes[0]![0]!.representations[0]!.data.data.read()).toEqual(new TextEncoder().encode('7:text/plain'));
  });

  it.each(['bytes', 'prepare', 'sequence'] as const)('keeps the missing %s dependency observable', async (dependency) => {
    const f = await createFixture(); const type = dependency === 'prepare' ? 'text/html' : 'text/plain';
    f.snapshot.items[0]!.formats = new Map([[type, type]]); await retainItem(f.browser); f[dependency].mockRestore();
    expect((await readOutcome(f.browser, type)).message).toContain('not implemented');
  });

  it('keeps native metadata discovery explicit at the actual read entry', async () => {
    const f = await createFixture(); f.metadata.mockRestore();
    expect(await f.browser.evaluate(async () => {
      try { await navigator.clipboard.read(); return ''; } catch (error) { return (error as Error).message; }
    })).toBe('System clipboard format snapshot reading is not implemented');
    expect(f.bytes).not.toHaveBeenCalled();
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '' }); await browser.navigate('https://clipboard.test/');
  const env = getRelevantRealm(browser.window).env; const document = unwrap<DocumentImpl>(browser.document);
  const system = env.userAgent.systemClipboard;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(env.window, 'hasTransientActivation').mockReturnValue(true);
  vi.spyOn(system, 'isPasteInteraction').mockReturnValue(true);
  const snapshot: ClipboardReadSnapshot = {
    entry: new Uint8Array([1]), items: [{ index: 7, formats: new Map([['text/plain', 13]]), presentationStyle: 'inline' }],
  };
  const state = { types: ['text/plain'], token: new Uint8Array([1]) };
  const metadata = vi.spyOn(system, 'readItemMetadata').mockImplementation(() =>
    env.userAgent.HostPromise.resolve(snapshot, internalType<ClipboardReadSnapshot>()));
  const sequence = vi.spyOn(system, 'readChangeState').mockImplementation(() => state);
  const bytes = vi.spyOn(system, 'readItemBytes').mockImplementation((index, type) =>
    env.userAgent.HostPromise.resolve(new TextEncoder().encode(index + ':' + type), internalType<Uint8Array | null>()));
  const prepare = vi.spyOn(system, 'prepareReadData').mockImplementation((data) =>
    env.userAgent.HostPromise.resolve(data, internalType<Uint8Array>()));
  return { browser, env, document, system, focus, snapshot, state, metadata, sequence, bytes, prepare };
}

async function retainItem(browser: Browlet, unsanitized: string[] = []) {
  await browser.evaluate(async (unsanitized) => {
    const items = await (window as unknown as Window).navigator.clipboard.read({ unsanitized });
    Reflect.set(window, 'clipboardItem', items[0]);
  }, unsanitized);
}

async function readOutcome(browser: Browlet, type = 'text/plain') {
  return browser.evaluate(async (type) => {
    const p = (Reflect.get(window, 'clipboardItem') as ClipboardItem).getType(type);
    try { const blob = await p; return { text: await blob.text(), type: blob.type, promise: p instanceof Promise }; }
    catch (error) { return {
      name: (error as Error).name, message: (error as Error).message,
      realm: error instanceof DOMException, promise: p instanceof Promise,
    }; }
  }, type);
}
