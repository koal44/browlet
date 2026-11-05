import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType, type TaskSourceKey } from '../../../../src/infra/index';
import { idlType } from '../../../../src/web-idl/core/index';
import { Browlet } from '../../../../src/browlet/browlet';
import { ClipboardItemImpl } from '../../../../src/browlet/interaction/clipboard/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { Clipboard, Navigator, Window } from '../../../../src/browlet/platform';
import { clipboardTaskSource, permissionsTaskSource, taskSources } from '../../../../src/browlet/scripting/index';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createSiblingWindow } from '../../../support/windows';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §§7.1/7.3: Navigator and Clipboard interface', () => {
  it('exposes Clipboard and navigator.clipboard only in secure contexts', async () => {
    const browser = new Browlet({ route: () => '' });
    const results: unknown[] = [];
    for (const url of ['http://clipboard.test/', 'https://clipboard.test/']) {
      await browser.navigate(url);
      results.push(await browser.evaluate(() => {
        const global = window as unknown as Window;
        return [isSecureContext, typeof global.Clipboard, 'clipboard' in navigator];
      }));
    }
    expect(results).toEqual([[false, 'undefined', false], [true, 'function', true]]);
  });

  it('retains one EventTarget per Navigator without a public constructor', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const { Clipboard, navigator } = window as unknown as Window;
      const clipboard = (window as unknown as Window).navigator.clipboard;
      let illegal = false;
      try { Reflect.construct(Clipboard as unknown as new () => unknown, []); } catch (error) { illegal = error instanceof TypeError; }
      return [clipboard === navigator.clipboard, clipboard instanceof Clipboard, clipboard instanceof EventTarget,
        Object.prototype.toString.call(clipboard), illegal, clipboard.read.length, clipboard.readText.length,
        clipboard.write.length, clipboard.writeText.length, 'ClipboardUnsanitizedFormats' in window];
    })).toEqual([true, true, true, '[object Clipboard]', true, 0, 0, 1, 1, false]);
  });

  it('supports ordinary EventTarget dispatch without entering native notification or action algorithms', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(() => {
      const clipboard = (window as unknown as Window).navigator.clipboard;
      const events: unknown[] = [];
      clipboard.addEventListener('test', (event) => {
        events.push([event.target === clipboard, event.currentTarget === clipboard, event.isTrusted]);
        event.preventDefault();
      });
      return [clipboard.dispatchEvent(new Event('test', { cancelable: true })), events];
    })).toEqual([false, [[true, true, false]]]);
  });

  it('preserves receiver identity and realm when the Navigator getter is borrowed', async () => {
    const browser = await secureBrowser();
    Reflect.set(browser.window, 'clipboardOtherWindow', createSiblingWindow(browser));
    expect(await browser.evaluate(() => {
      const { Clipboard, navigator } = window as unknown as Window;
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow intentionally with an explicit Navigator receiver.
      const getter = Object.getOwnPropertyDescriptor(other.Navigator.prototype, 'clipboard')!.get as (this: Navigator) => Clipboard;
      const clipboard = getter.call(navigator);
      return [clipboard === navigator.clipboard, clipboard instanceof Clipboard, clipboard instanceof other.Clipboard,
        other.navigator.clipboard === other.navigator.clipboard, other.navigator.clipboard !== clipboard];
    })).toEqual([true, true, false, true, true]);
  });

  it('rejects bad receivers and missing required arguments through promises', async () => {
    const browser = await secureBrowser();
    expect(await browser.evaluate(async () => {
      const { Clipboard, navigator } = window as unknown as Window;
      const invoke = (method: string, receiver: object): Promise<unknown> =>
        Reflect.apply(Reflect.get(Clipboard.prototype, method) as (...args: unknown[]) => Promise<unknown>, receiver, []);
      const attempts = [
        ...['read', 'readText', 'write', 'writeText'].map((method) => () => invoke(method, {})),
        () => invoke('write', navigator.clipboard), () => invoke('writeText', navigator.clipboard),
      ];
      const results = [];
      for (const attempt of attempts) {
        const result = attempt();
        try { await result; results.push(false); }
        catch (error) { results.push(result instanceof Promise && error instanceof TypeError); }
      }
      return results;
    })).toEqual(Array(6).fill(true));
  });

  it('keeps bad-receiver promises and errors in the borrowed method realm', async () => {
    const browser = await secureBrowser();
    Reflect.set(browser.window, 'clipboardOtherWindow', createSiblingWindow(browser));
    expect(await browser.evaluate(async () => {
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      const result = Reflect.apply(other.Clipboard.prototype.read, {}, []);
      try { await result; return []; }
      catch (error) {
        return [result instanceof Promise, result instanceof other.Promise,
          error instanceof TypeError, error instanceof other.TypeError];
      }
    })).toEqual([false, true, false, true]);
  });
});

describe('Clipboard §7.3.1: asynchronous read admission and delivery', () => {
  it('validates dictionary and sequence inputs before owner access and preserves thrown conversion errors', async () => {
    const f = await createFixture();
    expect(await f.browser.evaluate(async () => {
      const clipboard = (window as unknown as Window).navigator.clipboard;
      const results = [];
      for (const value of [1, 'bad', { unsanitized: null }, { unsanitized: 3 }, { unsanitized: [Symbol()] }]) {
        try { await Reflect.apply(clipboard.read.bind(clipboard), clipboard, [value]); results.push(false); }
        catch (error) { results.push(error instanceof TypeError); }
      }
      const sentinel = new Error('getter');
      try { await clipboard.read({ get unsanitized(): string[] { throw sentinel; } }); }
      catch (error) { results.push(error === sentinel); }
      return results;
    })).toEqual(Array(6).fill(true));
    expect(f.focus).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });

  it('rejects unsupported exact format strings before permission, tasks, or native access', async () => {
    const f = await createFixture();
    const background = vi.spyOn(f.env, 'runInParallel');
    expect(await f.browser.evaluate(async () => {
      const results = [];
      const { navigator } = window as unknown as Window;
      for (const type of ['text/plain', 'image/png', 'TEXT/HTML', ' text/html ', 'web text/html', '']) {
        const result = navigator.clipboard.read({ unsanitized: [type] });
        try { await result; results.push(false); }
        catch (error) { results.push(result instanceof Promise && error instanceof DOMException && error.name === 'NotAllowedError'); }
      }
      return results;
    })).toEqual(Array(6).fill(true));
    expect(background).not.toHaveBeenCalled(); expect(f.focus).not.toHaveBeenCalled();
    expect(f.activation).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });

  it('accepts omitted/empty dictionaries and snapshots converted unsanitized sequences without deduplicating', async () => {
    const f = await createFixture();
    expect(await f.browser.evaluate(async () => {
      const clipboard = (window as unknown as Window).navigator.clipboard;
      for (const options of [undefined, null, {}, { unsanitized: undefined }, { unsanitized: [] }]) {
        await Reflect.apply(clipboard.read.bind(clipboard), clipboard, [options]);
      }
      let reads = 0, conversions = 0;
      const values: unknown[] = [{ toString() { conversions++; return 'text/html'; } }, 'text/html'];
      const result: unknown = Reflect.apply(clipboard.read.bind(clipboard), clipboard, [{ get unsanitized() { reads++; return values; } }]);
      values[0] = 'bad'; values.push('text/plain');
      await result;
      return [reads, conversions];
    })).toEqual([1, 1]);
    expect(f.read.mock.calls.map(([, types]) => types)).toEqual([[], [], [], [], [], ['text/html', 'text/html']]);
    for (const [document] of f.read.mock.calls) expect(document).toBe(f.document);
  });

  it.each(['activation', 'paste'] as const)('denies missing %s permission through the permissions task source', async (missing) => {
    const f = await createFixture();
    if (missing === 'activation') f.activation.mockReturnValue(false);
    else f.paste.mockReturnValue(false);
    const delivery = vi.spyOn(f.env, 'queueTask');
    const persistent = vi.spyOn(f.system, 'hasPersistentReadPermission').mockReturnValue(true);
    expect(await readOutcome(f.browser)).toEqual({ name: 'NotAllowedError', realm: true });
    expect(delivery.mock.calls.map(([source]) => source)).toEqual(['automation', 'permissions']);
    expect(f.read).not.toHaveBeenCalled(); expect(persistent).not.toHaveBeenCalled();
    if (missing === 'activation') expect(f.paste).not.toHaveBeenCalled();
  });

  it('captures the calling task permission facts before parallel work', async () => {
    const f = await createFixture();
    const background: (() => void)[] = [];
    vi.spyOn(f.env, 'runInParallel').mockImplementation((steps) => { background.push(steps); });
    const request = f.browser.window.navigator.clipboard.read();
    const observed = observeBrowletPromise(f.browser.window, request);
    expect(background).toHaveLength(1); expect(f.read).not.toHaveBeenCalled();
    expect(f.paste).toHaveBeenCalledExactlyOnceWith(f.document);
    f.activation.mockReturnValue(false); f.paste.mockReturnValue(false);
    background[0]!();
    expect(await observed).toEqual([]);
    expect(f.activation).toHaveBeenCalledOnce(); expect(f.paste).toHaveBeenCalledOnce();
  });

  it.each(['inactive', 'unfocused'] as const)('rejects an initially %s Document before checking permission', async (state) => {
    const f = await createFixture();
    const activity = vi.spyOn(f.document, 'isFullyActive');
    if (state === 'inactive') activity.mockReturnValue(false); else f.focus.mockReturnValue(false);
    // Invoke the retained API directly: HTML correctly refuses to start evaluate() in an inactive Document.
    const request = f.browser.window.navigator.clipboard.read();
    const observed = observeBrowletPromise(f.browser.window, request);
    activity.mockRestore();
    performTestMicrotaskCheckpoint(f.browser.window);
    await expect(observed).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(f.activation).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'unfocused'] as const)('checks the original Document again before native access when it becomes %s', async (state) => {
    const f = await createFixture();
    const background: (() => void)[] = [];
    vi.spyOn(f.env, 'runInParallel').mockImplementation((steps) => { background.push(steps); });
    const request = f.browser.window.navigator.clipboard.read();
    const observed = observeBrowletPromise(f.browser.window, request);
    const activity = vi.spyOn(f.document, 'isFullyActive');
    if (state === 'inactive') activity.mockReturnValue(false); else f.focus.mockReturnValue(false);
    background[0]!();
    // HTML only runs the queued rejection once its Document is runnable again.
    activity.mockRestore(); f.focus.mockReturnValue(true);
    // Mock restoration must send the same wake-up as a real HTML activity transition.
    f.env.responsibleEventLoop.notifyTaskRunnabilityChanged();
    await expect(observed).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(f.read).not.toHaveBeenCalled();
  });

  it('waits for native metadata and settles only through a clipboard task', async () => {
    const f = await createFixture();
    const native = f.env.userAgent.HostPromise.withResolvers(internalType<ClipboardItemImpl[]>());
    const started = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    f.read.mockImplementation(() => { started.resolve(); return native.promise; });
    const delivery: { source: TaskSourceKey; steps: () => void; }[] = [];
    const queue = f.env.queueTask.bind(f.env);
    vi.spyOn(f.env, 'queueTask').mockImplementation((source, steps) => {
      if (source !== 'clipboard') return queue(source, steps);
      delivery.push({ source, steps }); queued.resolve(); return { remove() {} };
    });
    let completed = false;
    const result = readOutcome(f.browser).then((value) => { completed = true; return value; });
    await started.promise;
    expect(delivery).toEqual([]); expect(completed).toBe(false);
    native.resolve([]); await queued.promise;
    expect(delivery.map(({ source }) => source)).toEqual(['clipboard']); expect(completed).toBe(false);
    const task = delivery[0]!;
    f.env.realm.queueGlobalTask(taskSources[task.source], task.steps);
    expect(await result).toEqual({ count: 0 });
  });

  it('rechecks focus after native completion before exposing any items', async () => {
    const f = await createFixture();
    const native = f.env.userAgent.HostPromise.withResolvers(internalType<ClipboardItemImpl[]>());
    const started = Promise.withResolvers<void>();
    f.read.mockImplementation(() => { started.resolve(); return native.promise; });
    const result = readOutcome(f.browser);
    await started.promise; f.focus.mockReturnValue(false); native.resolve([f.item]);
    expect(await result).toEqual({ name: 'NotAllowedError', realm: true });
  });

  it('returns fresh receiver-realm promises and arrays while retaining supplied item identity', async () => {
    const f = await createFixture();
    f.read.mockImplementation(() => f.env.userAgent.HostPromise.resolve([f.item], internalType<ClipboardItemImpl[]>()));
    expect(await f.browser.evaluate(async () => {
      const { ClipboardItem } = window as unknown as Window;
      const firstPromise = navigator.clipboard.read(), secondPromise = navigator.clipboard.read();
      const first = await firstPromise, second = await secondPromise;
      return [firstPromise instanceof Promise, firstPromise !== secondPromise, first instanceof Array,
        first !== second, first[0] === second[0], first[0] instanceof ClipboardItem,
        [...first[0]!.types], await (await first[0]!.getType('text/plain')).text()];
    })).toEqual([true, true, true, true, true, true, ['text/plain'], 'test item']);
  });

  it('uses the receiver realm for a borrowed successful read and explicit NotAllowedError', async () => {
    const f = await createFixture();
    Reflect.set(f.browser.window, 'clipboardOtherWindow', createSiblingWindow(f.browser));
    expect(await f.browser.evaluate(async () => {
      const other = Reflect.get(window, 'clipboardOtherWindow') as Window & typeof globalThis;
      const { navigator } = window as unknown as Window;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise borrowing with the original Clipboard receiver.
      const borrowed = (other as Window).Clipboard.prototype.read;
      const result = borrowed.call(navigator.clipboard);
      const items = await result;
      const rejected = borrowed.call(navigator.clipboard, { unsanitized: ['text/plain'] });
      try { await rejected; return []; }
      catch (error) {
        return [result instanceof Promise, result instanceof other.Promise, items instanceof Array,
          items instanceof other.Array, rejected instanceof Promise, error instanceof DOMException,
          error instanceof other.DOMException];
      }
    })).toEqual([true, false, true, false, true, true, false]);
  });

  it.each(['throw', 'reject'] as const)('settles native %s failures on the clipboard task source', async (kind) => {
    const f = await createFixture();
    const error = new Error('native unavailable');
    f.read.mockImplementation(() => {
      if (kind === 'throw') throw error;
      return f.env.userAgent.HostPromise.reject(error, internalType<ClipboardItemImpl[]>());
    });
    const delivery = vi.spyOn(f.env, 'queueTask');
    expect(await f.browser.evaluate(async () => {
      try { await navigator.clipboard.read(); return ''; }
      catch (error) { return (error as Error).message; }
    })).toBe('native unavailable');
    expect(delivery.mock.calls.map(([source]) => source)).toEqual(['automation', 'clipboard']);
  });

  it.each(['focus', 'activation', 'provenance', 'reader'] as const)('keeps the missing %s dependency observable as a rejected promise', async (dependency) => {
    const f = await createFixture();
    if (dependency === 'focus') f.focus.mockRestore();
    if (dependency === 'activation') f.activation.mockRestore();
    if (dependency === 'provenance') f.paste.mockRestore();
    if (dependency === 'reader') f.read.mockRestore();
    const message = await f.browser.evaluate(async () => {
      const result = navigator.clipboard.read();
      try { await result; return ''; }
      catch (error) { return result instanceof Promise ? (error as Error).message : ''; }
    });
    expect(message).toMatch(/not implemented/);
  });
});

describe('Clipboard §7.3: task source ownership', () => {
  it('queues clipboard work for its own Document separately from permission work and removes it at destruction', () => {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    const env = traversable.activeWindow!.env;
    const document = traversable.activeDocument!;
    const loop = env.responsibleEventLoop;
    const steps = vi.fn();
    env.queueTask('clipboard', () => { document.destroy(); });
    env.queueTask('clipboard', steps);
    expect([...loop.getTaskQueue(clipboardTaskSource)].map((task) => task.document)).toEqual([document, document]);
    expect(loop.getTaskQueue(permissionsTaskSource).size).toBe(0);
    loop.runTaskTurn();
    expect(loop.getTaskQueue(clipboardTaskSource).size).toBe(0);
    expect(loop.runTaskTurn()).toBe(false); expect(steps).not.toHaveBeenCalled();
  });
});

async function secureBrowser() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://clipboard.test/');
  return browser;
}

async function createFixture() {
  const browser = await secureBrowser();
  const env = getRelevantRealm(browser.window).env;
  const document = unwrap<DocumentImpl>(browser.document);
  const system = env.userAgent.systemClipboard;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const activation = vi.spyOn(env.window, 'hasTransientActivation').mockReturnValue(true);
  const paste = vi.spyOn(system, 'isPasteInteraction').mockReturnValue(true);
  const read = vi.spyOn(system, 'readItems').mockImplementation(() =>
    env.userAgent.HostPromise.resolve([], internalType<ClipboardItemImpl[]>()));
  // The native port is controlled here; an author item is test data, never a production native fallback.
  const item = new ClipboardItemImpl({ 'text/plain': env.InternalPromise.resolve('test item', idlType.DOMString) },
    { presentationStyle: 'unspecified' }, env);
  return { browser, env, document, system, focus, activation, paste, read, item };
}

async function readOutcome(browser: Browlet) {
  return browser.evaluate(async () => {
    try { return { count: (await navigator.clipboard.read()).length }; }
    catch (error) { return { name: (error as Error).name, realm: error instanceof DOMException }; }
  });
}
