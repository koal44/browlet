import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { BlobData, BlobImpl } from '../../../../src/file/index';
import { Browlet } from '../../../../src/browlet/browlet';
import { ClipboardItemImpl } from '../../../../src/browlet/interaction/clipboard/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { Window } from '../../../../src/browlet/platform';
import { clipboardTaskSource } from '../../../../src/browlet/scripting/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §7.3.3: write', () => {
  it('encodes strings as UTF-8 and settles undefined only after the native commit', async () => {
    const f = await createFixture();
    expect(await writeString(f.browser, 'text/plain', 'A\r\nB\0\ud800')).toEqual({ undefined: true, promise: true });
    const [items, document] = f.write.mock.calls[0]!;
    expect(document).toBe(f.document); expect(items).toHaveLength(1);
    const representation = items[0]!.representations[0]!;
    expect(representation).toMatchObject({ type: 'text/plain', isCustom: false });
    expect([...await representation.data.data.read()]).toEqual([65, 13, 10, 66, 0, 239, 191, 189]);
    expect(items[0]!.presentationStyle).toBe('unspecified');
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.multiple).not.toHaveBeenCalled();
    expect(f.change).toHaveBeenCalledExactlyOnceWith(f.document);
  });

  it('keeps binary custom data and its identity without routing it through rich-format preparation', async () => {
    const f = await createFixture();
    await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const blob = new w.Blob([new Uint8Array([0, 255, 128])], { type: 'application/x-browlet' });
      Reflect.set(window, 'writtenBlob', blob);
      await w.navigator.clipboard.write([new w.ClipboardItem({ 'web application/x-browlet': blob })]);
    });
    const representation = f.write.mock.calls[0]![0][0]!.representations[0]!;
    expect(representation).toMatchObject({ type: 'application/x-browlet', isCustom: true });
    expect(representation.data).toBe(unwrap(Reflect.get(f.browser.window, 'writtenBlob') as object));
    expect([...await representation.data.data.read()]).toEqual([0, 255, 128]);
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it('uses a supplied Blob type even when its ClipboardItem entry has another type', async () => {
    const f = await createFixture();
    await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      await w.navigator.clipboard.write([new w.ClipboardItem({ 'application/x-entry': new w.Blob(['x'], { type: 'text/plain' }) })]);
    });
    expect(f.write.mock.calls[0]![0][0]!.representations[0]!.type).toBe('text/plain');
  });

  it.each(['application/x-unsupported', 'text/plain;charset=utf-8'])('rejects unsupported standard format %s before preparation or commit', async (type) => {
    const f = await createFixture();
    expect(await writeString(f.browser, type)).toMatchObject({ error: 'NotAllowedError', realm: true });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });

  it('does not mistake a standard Blob carrying a web-prefixed type for custom data', async () => {
    const f = await createFixture();
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      try { await w.navigator.clipboard.write([new w.ClipboardItem({ 'text/plain': new w.Blob(['x'], { type: 'web text/plain' }) })]); }
      catch (error) { return (error as Error).name; }
    })).toBe('NotAllowedError');
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each(['text/html', 'image/svg+xml', 'image/png'])('requires explicit preparation for %s and commits the prepared copy', async (type) => {
    const f = await createFixture();
    const bytes = BlobData.fromBytes(new Uint8Array([42]));
    const prepared = BlobImpl.create(bytes, type, null, f.env);
    f.prepare.mockImplementation(() => f.env.userAgent.HostPromise.resolve(prepared, internalType<BlobImpl>()));
    expect(await writeString(f.browser, type)).toMatchObject({ undefined: true });
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.prepare.mock.calls[0]![1]).toBe(f.document);
    expect(f.write.mock.calls[0]![0][0]!.representations[0]!.data).toBe(prepared);
  });

  it('writes URI-list strings without changing lines or parsing their URLs', async () => {
    const f = await createFixture();
    expect(await writeString(f.browser, 'text/uri-list', '# note\r\nrelative\n')).toMatchObject({ undefined: true });
    const blob = f.write.mock.calls[0]![0][0]!.representations[0]!.data;
    expect(new TextDecoder().decode(await blob.data.read())).toBe('# note\r\nrelative\n');
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it.each([true, false])('preserves item grouping and styles with multiple-item support=%s', async (multiple) => {
    const f = await createFixture(); f.multiple.mockReturnValue(multiple);
    await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      await w.navigator.clipboard.write([
        new w.ClipboardItem({ 'text/plain': 'one', 'text/uri-list': 'https://one.test/' }, { presentationStyle: 'inline' }),
        new w.ClipboardItem({ 'text/plain': 'two' }, { presentationStyle: 'attachment' }),
      ]);
    });
    expect(f.write).toHaveBeenCalledTimes(1);
    const items = f.write.mock.calls[0]![0];
    expect(items.map((item) => [item.presentationStyle, item.representations.map((r) => r.type)])).toEqual(multiple
      ? [['inline', ['text/plain', 'text/uri-list']], ['attachment', ['text/plain']]]
      : [['inline', ['text/plain', 'text/uri-list']]]);
  });

  it('does not observe discarded items on a single-item host', async () => {
    const f = await createFixture();
    const started = vi.spyOn(ClipboardItemImpl.prototype, 'getWriteData');
    await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const never = new Promise<string>(() => {});
      await w.navigator.clipboard.write([new w.ClipboardItem({ 'text/plain': 'first' }), new w.ClipboardItem({ 'text/plain': never })]);
    });
    expect(started).toHaveBeenCalledTimes(1); expect(f.write).toHaveBeenCalledTimes(1);
  });

  it('waits for every promised representation, preserving declaration order', async () => {
    const f = await createFixture();
    const started = Promise.withResolvers<void>();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Call with the same implementation receiver.
    const original = ClipboardItemImpl.prototype.getWriteData;
    vi.spyOn(ClipboardItemImpl.prototype, 'getWriteData').mockImplementation(function(this: ClipboardItemImpl) {
      const result = original.call(this); started.resolve(); return result;
    });
    await f.browser.evaluate(() => {
      const w = window as unknown as Window;
      const slow = new Promise<string>((resolve) => { Reflect.set(window, 'resolveClipboardData', resolve); });
      Reflect.set(window, 'pendingClipboardWrite', w.navigator.clipboard.write([new w.ClipboardItem({
        'text/plain': slow, 'text/uri-list': Promise.resolve('https://later.test/'),
      })]));
    });
    await started.promise; expect(f.write).not.toHaveBeenCalled();
    await f.browser.evaluate(async () => {
      (Reflect.get(window, 'resolveClipboardData') as (s: string) => void)('slow');
      await Reflect.get(window, 'pendingClipboardWrite');
    });
    expect(f.write.mock.calls[0]![0][0]!.representations.map((r) => r.type)).toEqual(['text/plain', 'text/uri-list']);
  });

  it('maps rejected representation data to NotAllowedError without partial native writes', async () => {
    const f = await createFixture();
    const started = Promise.withResolvers<void>();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Call with the same implementation receiver.
    const original = ClipboardItemImpl.prototype.getWriteData;
    vi.spyOn(ClipboardItemImpl.prototype, 'getWriteData').mockImplementation(function(this: ClipboardItemImpl) {
      const result = original.call(this); started.resolve(); return result;
    });
    await f.browser.evaluate(() => {
      const w = window as unknown as Window;
      const bad = new Promise<string>((_resolve, reject) => { Reflect.set(window, 'rejectClipboardData', reject); });
      const pending = w.navigator.clipboard.write([new w.ClipboardItem({ 'text/plain': 'good', 'text/html': bad })]);
      Reflect.set(window, 'rejectedClipboardWrite', pending.then(() => [], (error: unknown) => [(error as Error).name, error instanceof DOMException]));
    });
    await started.promise;
    expect(await f.browser.evaluate(async () => {
      (Reflect.get(window, 'rejectClipboardData') as (error: Error) => void)(new Error('bad'));
      return await Reflect.get(window, 'rejectedClipboardWrite') as unknown[];
    })).toEqual(['NotAllowedError', true]);
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });

  it('preserves a failed fulfillment conversion as a rejected write promise', async () => {
    const f = await createFixture();
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const data = { toString() { throw new TypeError('conversion failed'); } } as unknown as string;
      try { await w.navigator.clipboard.write([new w.ClipboardItem({ 'text/plain': data })]); }
      catch (error) { return [error instanceof TypeError, (error as Error).message]; }
    })).toEqual([true, 'conversion failed']);
    expect(f.write).not.toHaveBeenCalled();
  });

  it('maps rejected format preparation to NotAllowedError before committing anything', async () => {
    const f = await createFixture();
    f.prepare.mockImplementation(() => f.env.userAgent.HostPromise.reject(new Error('invalid format'), internalType<BlobImpl>()));
    expect(await writeString(f.browser, 'text/html')).toMatchObject({ error: 'NotAllowedError', realm: true });
    expect(f.write).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });

  it('observes prior preparation failures even if a later format throws synchronously', async () => {
    const f = await createFixture();
    f.prepare.mockImplementationOnce(() => f.env.userAgent.HostPromise.reject(new Error('first preparation failed'), internalType<BlobImpl>()))
      .mockImplementationOnce(() => { throw new Error('second preparation failed'); });
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      try { await w.navigator.clipboard.write([new w.ClipboardItem({ 'text/html': 'one', 'image/svg+xml': 'two' })]); }
      catch (error) { return (error as Error).message; }
    })).toMatch(/Clipboard format preparation failed|second preparation failed/);
    expect(f.write).not.toHaveBeenCalled();
  });

  it('rechecks focus after author data conversion, before format preparation', async () => {
    const f = await createFixture();
    Reflect.set(f.browser.window, 'loseClipboardFocus', () => { f.focus.mockReturnValue(false); });
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const data = { toString() { (Reflect.get(window, 'loseClipboardFocus') as () => void)(); return 'html'; } } as unknown as string;
      try { await w.navigator.clipboard.write([new w.ClipboardItem({ 'text/html': data })]); }
      catch (error) { return (error as Error).name; }
    })).toBe('NotAllowedError');
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });

  it('rechecks focus after asynchronous preparation, before the native commit', async () => {
    const f = await createFixture();
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<BlobImpl>());
    const started = Promise.withResolvers<BlobImpl>();
    f.prepare.mockImplementation((data) => { started.resolve(data); return pending.promise; });
    const result = writeString(f.browser, 'text/html'); const data = await started.promise;
    f.focus.mockReturnValue(false); pending.resolve(data);
    expect(await result).toMatchObject({ error: 'NotAllowedError' });
    expect(f.write).not.toHaveBeenCalled();
  });

  it('waits for native completion and queues settlement on the clipboard task source', async () => {
    const f = await createFixture();
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<boolean>());
    const started = Promise.withResolvers<void>();
    f.write.mockImplementation(() => { started.resolve(); return pending.promise; });
    let settled = false;
    const result = writeString(f.browser).then((value) => { settled = true; return value; });
    await started.promise; expect(settled).toBe(false); expect(f.change).not.toHaveBeenCalled();
    const delivered = Promise.withResolvers<() => void>();
    const queue = f.env.queueTask.bind(f.env);
    vi.spyOn(f.env, 'queueTask').mockImplementation((source, steps) => {
      if (source !== 'clipboard') return queue(source, steps);
      delivered.resolve(steps); return { remove() {} };
    });
    pending.resolve(true); const delivery = await delivered.promise;
    expect(settled).toBe(false); expect(f.change).not.toHaveBeenCalled();
    f.env.realm.queueGlobalTask(clipboardTaskSource, delivery);
    expect(await result).toEqual({ undefined: true, promise: true });
    expect(f.change).toHaveBeenCalledTimes(1);
  });

  it('does not notify when a completed native write reports no change', async () => {
    const f = await createFixture(); f.write.mockImplementation(() => f.env.userAgent.HostPromise.resolve(false, internalType<boolean>()));
    expect(await writeString(f.browser)).toMatchObject({ undefined: true }); expect(f.change).not.toHaveBeenCalled();
  });

  it('keeps empty writes as admitted no-ops', async () => {
    const f = await createFixture();
    await f.browser.evaluate(async () => { await (window as unknown as Window).navigator.clipboard.write([]); });
    expect(f.write).not.toHaveBeenCalled(); expect(f.multiple).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });

  it('keeps native commit failures observable and does not send change notification', async () => {
    const f = await createFixture();
    f.write.mockImplementation(() => f.env.userAgent.HostPromise.reject(new Error('native commit failed'), internalType<boolean>()));
    expect(await writeString(f.browser)).toMatchObject({ message: 'native commit failed' }); expect(f.change).not.toHaveBeenCalled();
  });

  it('keeps borrowed write promises and errors in the Clipboard receiver realm', async () => {
    const f = await createFixture(); Reflect.set(f.browser.window, 'clipboardOtherWindow', createSiblingWindow(f.browser));
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow with the original Clipboard receiver.
      const write = (other as Window).Clipboard.prototype.write;
      const p = write.call(w.navigator.clipboard, [new w.ClipboardItem({ 'application/x-test': 'x' })]);
      try { await p; return []; }
      catch (error) { return [p instanceof Promise, p instanceof other.Promise,
        error instanceof DOMException, error instanceof other.DOMException, (error as Error).name]; }
    })).toEqual([true, false, true, false, 'NotAllowedError']);
  });

  it.each(['prepare', 'write'] as const)('keeps the missing %s dependency explicit', async (dependency) => {
    const f = await createFixture(); f[dependency].mockRestore();
    expect(await writeString(f.browser, dependency === 'prepare' ? 'text/html' : 'text/plain')).toMatchObject({
      message: dependency === 'prepare' ? 'Rich clipboard write preparation is not implemented' : 'Native asynchronous clipboard item writing is not implemented',
    });
  });

  it('keeps missing native item-model support explicit', async () => {
    const f = await createFixture(); f.multiple.mockRestore();
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const item = new w.ClipboardItem({ 'text/plain': 'x' });
      try { await w.navigator.clipboard.write([item, item]); } catch (error) { return (error as Error).message; }
    })).toBe('Native multi-item clipboard support is not implemented');
    expect(f.write).not.toHaveBeenCalled();
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '' }); await browser.navigate('https://clipboard.test/');
  const env = getRelevantRealm(browser.window).env;
  const document = unwrap<DocumentImpl>(browser.document);
  const system = env.userAgent.systemClipboard;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  env.userAgent.permissionStore.setEntry({ name: 'clipboard-write', allowWithoutGesture: true }, env.topLevelOrigin, 'granted');
  const multiple = vi.spyOn(system, 'supportsMultipleItems').mockReturnValue(false);
  const prepare = vi.spyOn(system, 'prepareWriteData').mockImplementation((blob) => env.userAgent.HostPromise.resolve(blob, internalType<BlobImpl>()));
  const write = vi.spyOn(system, 'writeItems').mockImplementation(() => env.userAgent.HostPromise.resolve(true, internalType<boolean>()));
  const change = vi.spyOn(system, 'queueChange').mockImplementation(() => {});
  return { browser, env, document, system, focus, multiple, prepare, write, change };
}
async function writeString(browser: Browlet, type = 'text/plain', value = 'data') {
  return browser.evaluate(async ({ type, value }) => {
    const w = window as unknown as Window;
    const p = w.navigator.clipboard.write([new w.ClipboardItem({ [type]: value })]);
    try { return { undefined: await p === undefined, promise: p instanceof Promise }; }
    catch (error) { return {
      error: (error as Error).name, message: (error as Error).message,
      realm: error instanceof DOMException, promise: p instanceof Promise,
    }; }
  }, { type, value });
}
