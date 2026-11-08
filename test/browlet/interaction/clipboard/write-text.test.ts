import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { Window } from '../../../../src/browlet/platform';
import { clipboardTaskSource } from '../../../../src/browlet/scripting/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §7.3.4: writeText', () => {
  it('writes one UTF-8 plain-text Blob with unspecified presentation and resolves undefined', async () => {
    const f = await createFixture();
    expect(await outcome(f.browser, 'A\0\ud800\ud83d\ude00')).toEqual({ undefined: true, promise: true });
    expect(f.write).toHaveBeenCalledTimes(1);
    const [items, document] = f.write.mock.calls[0]!;
    expect(document).toBe(f.document); expect(items).toHaveLength(1);
    expect(items[0]!.presentationStyle).toBe('unspecified');
    expect(items[0]!.representations).toHaveLength(1);
    const representation = items[0]!.representations[0]!;
    expect(representation.type).toBe('text/plain;charset=utf-8');
    expect(representation.isCustom).toBe(false);
    expect(representation.data.type).toBe('text/plain;charset=utf-8');
    expect([...await representation.data.data.read()]).toEqual([65, 0, 239, 191, 189, 240, 159, 152, 128]);
    expect(f.change).toHaveBeenCalledExactlyOnceWith(f.document);
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.multiple).not.toHaveBeenCalled();
  });

  it.each([
    ['\r\n', 'A\r\nB\r\nC\r\nD\r\n\r\nE\u2028F\r\n'],
    ['\n', 'A\rB\nC\r\nD\r\r\nE\u2028F\r'],
  ] as const)('uses host line ending %j without doubling CRLF or rewriting Unicode separators', async (nativeLineEnding, expected) => {
    const f = await createFixture(); f.env.nativeLineEnding = nativeLineEnding;
    expect(await outcome(f.browser, 'A\rB\nC\r\nD\r\r\nE\u2028F\r')).toMatchObject({ undefined: true });
    expect(await writtenText(f)).toBe(expected);
  });

  it('writes empty text as a real item rather than treating it as an empty item list', async () => {
    const f = await createFixture();
    expect(await outcome(f.browser, '')).toMatchObject({ undefined: true });
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.write.mock.calls[0]![0][0]!.representations[0]!.data.size).toBe(0);
  });

  it('converts the DOMString once during the calling task', async () => {
    const f = await createFixture();
    expect(await f.browser.evaluate(async () => {
      let conversions = 0;
      const data = { toString() { conversions++; return 'converted'; } } as unknown as string;
      const p = navigator.clipboard.writeText(data);
      const immediate = conversions; await p;
      return [immediate, conversions, p instanceof Promise];
    })).toEqual([1, 1, true]);
    expect(await writtenText(f)).toBe('converted');
  });

  it.each([null, undefined, true, 42])('uses ordinary DOMString conversion for %j', async (value) => {
    const f = await createFixture();
    await f.browser.evaluate(async (value) => { await navigator.clipboard.writeText(value as unknown as string); }, value);
    expect(await writtenText(f)).toBe(String(value));
  });

  it('rejects failed conversion before permission or native work', async () => {
    const f = await createFixture(); const permission = vi.spyOn(f.system, 'checkWritePermission');
    expect(await f.browser.evaluate(async () => {
      const p = navigator.clipboard.writeText(Symbol('invalid') as unknown as string);
      try { await p; return []; }
      catch (error) { return [p instanceof Promise, error instanceof TypeError]; }
    })).toEqual([true, true]);
    expect(permission).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });

  it('does not enter author-replaced ClipboardItem, Blob or Clipboard.write APIs', async () => {
    const f = await createFixture();
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const forbidden = () => { throw new Error('author API must not be called'); };
      const replaced = [Reflect.set(window, 'Blob', forbidden), Reflect.set(window, 'ClipboardItem', forbidden),
        Reflect.set(w.navigator.clipboard, 'write', forbidden)];
      await w.navigator.clipboard.writeText('direct text');
      return replaced;
    })).toEqual([true, true, true]);
    expect(await writtenText(f)).toBe('direct text');
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.multiple).not.toHaveBeenCalled();
  });

  it('settles permission denial on the permissions task source without writing', async () => {
    const f = await createFixture();
    f.env.userAgent.permissionStore.setEntry({ name: 'clipboard-write', allowWithoutGesture: false }, f.env.topLevelOrigin, 'denied');
    const tasks = vi.spyOn(f.env, 'queueTask');
    expect(await outcome(f.browser)).toMatchObject({ error: 'NotAllowedError', realm: true, promise: true });
    expect(tasks.mock.calls.map(([source]) => source)).toEqual(['automation', 'permissions']);
    expect(f.write).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });

  it('waits for the existing permission prompt before entering the clipboard writer', async () => {
    const f = await createFixture();
    f.env.userAgent.permissionStore.removeEntry({ name: 'clipboard-write', allowWithoutGesture: true }, f.env.topLevelOrigin);
    const answer = Promise.withResolvers<boolean>(); const asked = Promise.withResolvers<void>();
    const prompt = vi.spyOn(f.env.userAgent, 'onPermissionPrompt').mockImplementation(() => { asked.resolve(); return answer.promise; });
    const result = outcome(f.browser); await asked.promise;
    expect(f.write).not.toHaveBeenCalled(); answer.resolve(true);
    expect(await result).toMatchObject({ undefined: true });
    expect(prompt.mock.calls[0]![0].descriptor).toEqual({ name: 'clipboard-write', allowWithoutGesture: true });
  });

  it('rejects an unfocused Document before asking permission', async () => {
    const f = await createFixture(); f.focus.mockReturnValue(false);
    const permission = vi.spyOn(f.system, 'checkWritePermission');
    expect(await outcome(f.browser)).toMatchObject({ error: 'NotAllowedError', realm: true });
    expect(permission).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });

  it('rechecks the original Document after consent and before constructing native write data', async () => {
    const f = await createFixture();
    f.env.userAgent.permissionStore.removeEntry({ name: 'clipboard-write', allowWithoutGesture: true }, f.env.topLevelOrigin);
    const answer = Promise.withResolvers<boolean>(); const asked = Promise.withResolvers<void>();
    vi.spyOn(f.env.userAgent, 'onPermissionPrompt').mockImplementation(() => { asked.resolve(); return answer.promise; });
    const result = outcome(f.browser); await asked.promise;
    f.focus.mockReturnValue(false); answer.resolve(true);
    expect(await result).toMatchObject({ error: 'NotAllowedError' }); expect(f.write).not.toHaveBeenCalled();
  });

  it('waits for native completion and delivers fulfillment through a clipboard task', async () => {
    const f = await createFixture();
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<boolean>());
    const started = Promise.withResolvers<void>();
    f.write.mockImplementation(() => { started.resolve(); return pending.promise; });
    let settled = false;
    const result = outcome(f.browser).then((value) => { settled = true; return value; });
    await started.promise; expect(settled).toBe(false); expect(f.change).not.toHaveBeenCalled();
    const delivered = Promise.withResolvers<() => void>();
    const queue = f.env.queueTask.bind(f.env);
    vi.spyOn(f.env, 'queueTask').mockImplementation((source, task) => {
      if (source !== 'clipboard') return queue(source, task);
      delivered.resolve(task.run); return { remove() {} };
    });
    pending.resolve(true); const delivery = await delivered.promise;
    expect(settled).toBe(false); expect(f.change).not.toHaveBeenCalled();
    f.env.realm.queueGlobalTask(clipboardTaskSource, { run: delivery });
    expect(await result).toEqual({ undefined: true, promise: true });
    expect(f.change).toHaveBeenCalledTimes(1);
  });

  it('rejects native failure without reporting a clipboard change', async () => {
    const f = await createFixture();
    f.write.mockImplementation(() => f.env.userAgent.HostPromise.reject(new Error('native text write failed'), internalType<boolean>()));
    expect(await outcome(f.browser)).toMatchObject({ message: 'native text write failed', promise: true });
    expect(f.change).not.toHaveBeenCalled();
  });

  it('does not notify for an unchanged native clipboard', async () => {
    const f = await createFixture(); f.write.mockImplementation(() => f.env.userAgent.HostPromise.resolve(false, internalType<boolean>()));
    expect(await outcome(f.browser)).toMatchObject({ undefined: true }); expect(f.change).not.toHaveBeenCalled();
  });

  it('retains notification of a completed change even if focus was lost before completion delivery', async () => {
    const f = await createFixture();
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<boolean>());
    const started = Promise.withResolvers<void>();
    f.write.mockImplementation(() => { started.resolve(); return pending.promise; });
    const result = outcome(f.browser); await started.promise;
    f.focus.mockReturnValue(false); pending.resolve(true);
    expect(await result).toMatchObject({ error: 'NotAllowedError' });
    expect(f.change).toHaveBeenCalledExactlyOnceWith(f.document);
  });

  it('keeps borrowed-method results and errors in the Clipboard receiver realm', async () => {
    const f = await createFixture(); Reflect.set(f.browser.window, 'clipboardOtherWindow', createSiblingWindow(f.browser));
    const first = await f.browser.evaluate(async () => {
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      const w = window as unknown as Window;
      const p = (other as Window).Clipboard.prototype.writeText.call(w.navigator.clipboard, 'borrowed');
      await p; return [p instanceof Promise, p instanceof other.Promise];
    });
    f.focus.mockReturnValue(false);
    const second = await f.browser.evaluate(async () => {
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      const w = window as unknown as Window;
      const p = (other as Window).Clipboard.prototype.writeText.call(w.navigator.clipboard, 'denied');
      try { await p; return []; }
      catch (error) { return [p instanceof Promise, p instanceof other.Promise,
        error instanceof DOMException, error instanceof other.DOMException, (error as Error).name]; }
    });
    expect(first).toEqual([true, false]); expect(second).toEqual([true, false, true, false, 'NotAllowedError']);
  });

  it('keeps the native writer dependency explicit', async () => {
    const f = await createFixture(); f.write.mockRestore();
    expect(await outcome(f.browser)).toMatchObject({ message: 'Clipboard platform selection is not implemented' });
    expect(f.change).not.toHaveBeenCalled();
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '' }); await browser.navigate('https://clipboard.test/');
  const env = getRelevantRealm(browser.window).env;
  const document = unwrap<DocumentImpl>(browser.document);
  const system = env.userAgent.systemClipboard;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(env.window, 'hasTransientActivation').mockReturnValue(false);
  env.userAgent.permissionStore.setEntry({ name: 'clipboard-write', allowWithoutGesture: true }, env.topLevelOrigin, 'granted');
  const write = vi.spyOn(system, 'writeItems').mockImplementation(() => env.userAgent.HostPromise.resolve(true, internalType<boolean>()));
  const change = vi.spyOn(system, 'queueChange').mockImplementation(() => {});
  const prepare = vi.spyOn(system, 'prepareWriteData');
  const multiple = vi.spyOn(system, 'supportsMultipleItems');
  return { browser, env, document, system, focus, write, change, prepare, multiple };
}
async function writtenText(f: Awaited<ReturnType<typeof createFixture>>) {
  const blob = f.write.mock.calls[0]![0][0]!.representations[0]!.data;
  return new TextDecoder().decode(await blob.data.read());
}
async function outcome(browser: Browlet, data = 'text') {
  return browser.evaluate(async (data) => {
    const p = navigator.clipboard.writeText(data);
    try { return { undefined: await p === undefined, promise: p instanceof Promise }; }
    catch (error) { return {
      error: (error as Error).name, message: (error as Error).message,
      realm: error instanceof DOMException, promise: p instanceof Promise,
    }; }
  }, data);
}
