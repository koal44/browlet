import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../../../../src/web-idl/core/index';
import { BlobData, BlobImpl } from '../../../../src/file/index';
import { Browlet } from '../../../../src/browlet/browlet';
import type { ClipboardTextData, ClipboardTextSnapshot } from '../../../../src/browlet/interaction/clipboard/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { Window } from '../../../../src/browlet/platform';
import { clipboardTaskSource } from '../../../../src/browlet/scripting/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §7.3.2: readText', () => {
  it.each([DOMExceptionNames.invalidState, DOMExceptionNames.notAllowed])('retains generation and lifetime errors: %s', async (name) => {
    const f = await createFixture();
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.reject(
      new DOMExceptionImpl('Read is no longer valid', name), internalType<ClipboardTextSnapshot>(),
    ));
    expect(await outcome(f.browser)).toMatchObject({ error: name, realm: true, promise: true });
  });

  it.each([null, '', 'A\r\nB\0\ud800\ud83d\ude00'])('preserves native DOMString data or resolves absent text as empty (%j)', async (data) => {
    const f = await createFixture();
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.resolve(textSnapshot(data), internalType<ClipboardTextSnapshot>()));
    const items = vi.spyOn(f.system, 'readItems');
    expect(await outcome(f.browser)).toEqual({ value: data ?? '', promise: true });
    expect(f.read).toHaveBeenCalledExactlyOnceWith(f.document);
    expect(items).not.toHaveBeenCalled();
  });

  it('decodes Blob bytes as UTF-8, removes one BOM, preserves text, and replaces malformed sequences', async () => {
    const f = await createFixture();
    // BOM, second literal BOM, A, malformed lead byte then (, CRLF, NUL, and a supplementary character.
    const data = BlobData.fromBytes(new Uint8Array([239, 187, 191, 239, 187, 191, 65, 195, 40, 13, 10, 0, 240, 159, 152, 128]));
    const blob = BlobImpl.create(data, 'text/plain;charset=windows-1252', data.captureSnapshotState(), f.env);
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.resolve(textSnapshot(blob), internalType<ClipboardTextSnapshot>()));
    const tasks = vi.spyOn(f.env, 'queueTask');
    expect(await outcome(f.browser)).toEqual({ value: '\ufeffA\ufffd(\r\n\0\ud83d\ude00', promise: true });
    const sources = tasks.mock.calls.map(([source]) => source);
    expect(sources).toContain('file'); expect(sources.at(-1)).toBe('clipboard');
  });

  it('returns empty text for an empty Blob', async () => {
    const f = await createFixture();
    const blob = new BlobImpl([], {}, f.env);
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.resolve(textSnapshot(blob), internalType<ClipboardTextSnapshot>()));
    expect(await outcome(f.browser)).toEqual({ value: '', promise: true });
  });

  it('waits for native data, then settles in a clipboard task', async () => {
    const f = await createFixture();
    const data = f.env.userAgent.HostPromise.withResolvers(internalType<ClipboardTextSnapshot>());
    const started = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    f.read.mockImplementation(() => { started.resolve(); return data.promise; });
    const delivery: (() => void)[] = [];
    const queue = f.env.queueTask.bind(f.env);
    vi.spyOn(f.env, 'queueTask').mockImplementation((source, steps) => {
      if (source !== 'clipboard') return queue(source, steps);
      delivery.push(steps); queued.resolve(); return { remove() {} };
    });
    let settled = false;
    const result = outcome(f.browser).then((value) => { settled = true; return value; });
    await started.promise;
    expect(delivery).toEqual([]); expect(settled).toBe(false);
    data.resolve(textSnapshot('later')); await queued.promise;
    expect(delivery).toHaveLength(1); expect(settled).toBe(false);
    f.env.realm.queueGlobalTask(clipboardTaskSource, delivery[0]!);
    expect(await result).toEqual({ value: 'later', promise: true });
  });

  it('waits for asynchronous Blob bytes rather than racing the pending representation', async () => {
    const f = await createFixture();
    const bytes = Promise.withResolvers<Uint8Array>();
    const started = Promise.withResolvers<void>();
    const source = { size: 1, snapshotState: null, read: () => { started.resolve(); return bytes.promise; } };
    const blob = BlobImpl.create(BlobData.fromSource(source), '', null, f.env);
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.resolve(textSnapshot(blob), internalType<ClipboardTextSnapshot>()));
    const tasks = vi.spyOn(f.env, 'queueTask');
    const result = outcome(f.browser);
    await started.promise;
    expect(tasks.mock.calls.some(([task]) => task === 'clipboard')).toBe(false);
    bytes.resolve(new Uint8Array([65]));
    expect(await result).toEqual({ value: 'A', promise: true });
  });

  it('turns rejected native representation data into receiver-realm NotFoundError', async () => {
    const f = await createFixture();
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.reject(new Error('native payload unavailable'), internalType<ClipboardTextSnapshot>()));
    const tasks = vi.spyOn(f.env, 'queueTask');
    expect(await outcome(f.browser)).toMatchObject({ error: 'NotFoundError', realm: true, promise: true });
    expect(tasks.mock.calls.map(([source]) => source)).toEqual(['automation', 'clipboard']);
  });

  it('turns a failed Blob backing read into NotFoundError', async () => {
    const f = await createFixture();
    const data = BlobData.fromSource({ size: 1, snapshotState: null, read: () => Promise.reject(new Error('unreadable')) });
    const blob = BlobImpl.create(data, '', null, f.env);
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.resolve(textSnapshot(blob), internalType<ClipboardTextSnapshot>()));
    expect(await outcome(f.browser)).toMatchObject({ error: 'NotFoundError', realm: true, promise: true });
  });

  it.each(['activation', 'paste'] as const)('denies missing %s without reading native data', async (missing) => {
    const f = await createFixture();
    if (missing === 'activation') f.activation.mockReturnValue(false); else f.paste.mockReturnValue(false);
    const tasks = vi.spyOn(f.env, 'queueTask');
    expect(await outcome(f.browser)).toMatchObject({ error: 'NotAllowedError', realm: true, promise: true });
    expect(tasks.mock.calls.map(([source]) => source)).toEqual(['automation', 'permissions']);
    expect(f.read).not.toHaveBeenCalled();
    if (missing === 'activation') expect(f.paste).not.toHaveBeenCalled();
  });

  it('rejects an unfocused Document before checking permission', async () => {
    const f = await createFixture();
    f.focus.mockReturnValue(false);
    expect(await outcome(f.browser)).toMatchObject({ error: 'NotAllowedError', realm: true, promise: true });
    expect(f.activation).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });

  it('rechecks focus before delivering a decoded Blob', async () => {
    const f = await createFixture();
    const bytes = Promise.withResolvers<Uint8Array>();
    const started = Promise.withResolvers<void>();
    const data = BlobData.fromSource({ size: 1, snapshotState: null, read: () => { started.resolve(); return bytes.promise; } });
    const blob = BlobImpl.create(data, '', null, f.env);
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.resolve(textSnapshot(blob), internalType<ClipboardTextSnapshot>()));
    const result = outcome(f.browser);
    await started.promise; f.focus.mockReturnValue(false); bytes.resolve(new Uint8Array([65]));
    expect(await result).toMatchObject({ error: 'NotAllowedError', realm: true, promise: true });
  });

  it('keeps each read independent when native completions arrive out of order', async () => {
    const f = await createFixture();
    const first = f.env.userAgent.HostPromise.withResolvers(internalType<ClipboardTextSnapshot>());
    const second = f.env.userAgent.HostPromise.withResolvers(internalType<ClipboardTextSnapshot>());
    const started = Promise.withResolvers<void>();
    f.read.mockReturnValueOnce(first.promise).mockImplementationOnce(() => { started.resolve(); return second.promise; });
    const result = f.browser.evaluate(async () => {
      const first = navigator.clipboard.readText(), second = navigator.clipboard.readText();
      return [first !== second, await Promise.all([first, second])];
    });
    await started.promise; second.resolve(textSnapshot('second')); first.resolve(textSnapshot('first'));
    expect(await result).toEqual([true, ['first', 'second']]);
  });

  it('retains receiver-realm promises and NotFoundErrors for a borrowed readText method', async () => {
    const f = await createFixture();
    Reflect.set(f.browser.window, 'clipboardOtherWindow', createSiblingWindow(f.browser));
    f.read.mockReturnValueOnce(f.env.userAgent.HostPromise.resolve(textSnapshot('first'), internalType<ClipboardTextSnapshot>()))
      .mockImplementationOnce(() => f.env.userAgent.HostPromise.reject(new Error('missing'), internalType<ClipboardTextSnapshot>()));
    expect(await f.browser.evaluate(async () => {
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      const { navigator } = window as unknown as Window;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow explicitly with the original Clipboard receiver.
      const read = (other as Window).Clipboard.prototype.readText;
      const first = read.call(navigator.clipboard);
      const value = await first;
      const second = read.call(navigator.clipboard);
      try { await second; return []; }
      catch (error) {
        return [value, first instanceof Promise, first instanceof other.Promise,
          second instanceof Promise, error instanceof DOMException, error instanceof other.DOMException, (error as Error).name];
      }
    })).toEqual(['first', true, false, true, true, false, 'NotFoundError']);
  });

  it('keeps the unimplemented native text snapshot dependency visible', async () => {
    const f = await createFixture();
    f.read.mockRestore();
    expect(await outcome(f.browser)).toMatchObject({
      message: 'System clipboard format snapshot reading is not implemented', promise: true,
    });
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://clipboard.test/');
  const env = getRelevantRealm(browser.window).env;
  const document = unwrap<DocumentImpl>(browser.document);
  const system = env.userAgent.systemClipboard;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const activation = vi.spyOn(env.window, 'hasTransientActivation').mockReturnValue(true);
  const paste = vi.spyOn(system, 'isPasteInteraction').mockReturnValue(true);
  vi.spyOn(system, 'readChangeState').mockReturnValue({ types: ['text/plain'], token: new Uint8Array([1]) });
  const read = vi.spyOn(system, 'readTextData').mockImplementation(() =>
    env.userAgent.HostPromise.resolve(textSnapshot(null), internalType<ClipboardTextSnapshot>()));
  return { browser, env, document, system, focus, activation, paste, read };
}

async function outcome(browser: Browlet) {
  return browser.evaluate(async () => {
    const result = navigator.clipboard.readText();
    try { return { value: await result, promise: result instanceof Promise }; }
    catch (error) {
      return {
        error: (error as Error).name, message: (error as Error).message,
        realm: error instanceof DOMException, promise: result instanceof Promise,
      };
    }
  });
}

function textSnapshot(data: ClipboardTextData): ClipboardTextSnapshot { return { data, entry: new Uint8Array([1]) }; }
