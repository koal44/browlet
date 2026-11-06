import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { ClipboardFormat, ClipboardFormatSnapshot, ClipboardPlatform } from '../../../../src/browlet/interaction/clipboard/index';
import { clipboardTaskSource } from '../../../../src/browlet/scripting/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §7.3.2: plain-text format snapshots', () => {
  it.each<[ClipboardPlatform, ClipboardFormat]>([
    ['windows', 13], ['macos', 'public.utf8-plain-text'], ['linux', 'text/plain'],
    ['chromeos', 'text/plain'], ['android', 'text/plain'],
  ])('reads the standard text format on %s without requesting the custom map', async (platform, format) => {
    const f = await createFixture();
    f.snapshot.platform = platform; f.snapshot.items[0]!.formats = [format];
    expect(await outcome(f.browser)).toEqual({ value: 'hello', promise: true });
    expect(f.discovery).toHaveBeenCalledExactlyOnceWith(f.document, false);
    expect(f.bytes).toHaveBeenCalledExactlyOnceWith(7, 'text/plain', format, new Uint8Array([1]), f.document);
  });

  it('selects the first standard text item, preserving its original index and reading no other payload', async () => {
    const f = await createFixture();
    f.snapshot.items = [
      { index: 12, formats: ['PNG', 'Web Custom Format0'], presentationStyle: 'inline' },
      { index: 4, formats: ['HTML Format', 13], presentationStyle: 'attachment' },
      { index: 9, formats: [13], presentationStyle: 'unspecified' },
    ];
    // Even a malformed/unreadable custom map cannot affect a plain-text request.
    Object.defineProperty(f.snapshot, 'customMap', { get() { throw new Error('Custom map was accessed'); } });
    const items = vi.spyOn(f.system, 'readItems');
    const prepare = vi.spyOn(f.system, 'prepareReadData');
    expect(await outcome(f.browser)).toMatchObject({ value: 'hello' });
    expect(f.bytes).toHaveBeenCalledExactlyOnceWith(4, 'text/plain', 13, new Uint8Array([1]), f.document);
    expect(items).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });

  it('returns empty text for a custom-only text/plain mapping without reading its payload', async () => {
    const f = await createFixture();
    f.snapshot.items[0]!.formats = ['Web Custom Format0'];
    f.snapshot.customMap = encode('{"text/plain":"Web Custom Format0"}');
    expect(await outcome(f.browser)).toMatchObject({ value: '' });
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it.each([
    [new Uint8Array(), ''],
    [new Uint8Array([239, 187, 191, 65]), 'A'],
    [new Uint8Array([65, 255, 66, 195]), 'A\ufffdB\ufffd'],
    [encode('A\r\nB\0\u{1f600}'), 'A\r\nB\0\u{1f600}'],
  ] as const)('decodes the selected UTF-8 bytes using File rules (%j)', async (bytes, text) => {
    const f = await createFixture();
    f.bytes.mockReturnValue(f.env.userAgent.HostPromise.resolve(bytes, internalType<Uint8Array | null>()));
    expect(await outcome(f.browser)).toMatchObject({ value: text });
    expect(f.bytes).toHaveBeenCalledTimes(1);
  });

  it.each(['absent', 'throw', 'reject'] as const)('rejects %s advertised text without falling through to a later item', async (failure) => {
    const f = await createFixture();
    f.snapshot.items.push({ index: 8, formats: [13], presentationStyle: 'unspecified' });
    f.bytes.mockImplementation(() => {
      if (failure === 'throw') throw new Error('Unreadable text');
      return failure === 'absent' ? f.env.userAgent.HostPromise.resolve(null, internalType<Uint8Array | null>()) :
        f.env.userAgent.HostPromise.reject(new Error('Unreadable text'), internalType<Uint8Array | null>());
    });
    expect(await outcome(f.browser)).toMatchObject({ error: 'NotFoundError', realm: true, promise: true });
    expect(f.bytes).toHaveBeenCalledTimes(1);
  });

  it.each(['throw', 'reject'] as const)('reports a snapshot %s as unreadable text', async (failure) => {
    const f = await createFixture();
    f.discovery.mockImplementation(() => {
      if (failure === 'throw') throw new Error('Discovery failed');
      return f.env.userAgent.HostPromise.reject(new Error('Discovery failed'), internalType<ClipboardFormatSnapshot>());
    });
    expect(await outcome(f.browser)).toMatchObject({ error: 'NotFoundError', realm: true });
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it.each([
    ['snapshot', 'System clipboard format snapshot reading is not implemented'],
    ['bytes', 'System clipboard representation bytes are not implemented'],
    ['generation', 'Native clipboard change-state access is not implemented'],
  ] as const)('keeps the missing %s OS dependency visible', async (missing, message) => {
    const f = await createFixture();
    if (missing === 'snapshot') f.discovery.mockRestore();
    else if (missing === 'bytes') f.bytes.mockRestore();
    else f.sequence.mockRestore();
    expect(await outcome(f.browser)).toMatchObject({ message, promise: true });
  });

  it.each([true, false])('rejects a stale discovery snapshot even when text is %s', async (present) => {
    const f = await createFixture();
    if (!present) f.snapshot.items = [];
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<ClipboardFormatSnapshot>());
    const started = Promise.withResolvers<void>();
    f.discovery.mockImplementation(() => { started.resolve(); return pending.promise; });
    const result = outcome(f.browser); await started.promise;
    f.state.token = new Uint8Array([2]); pending.resolve(f.snapshot);
    expect(await result).toMatchObject({ error: 'InvalidStateError', realm: true });
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it('rechecks focus after discovery and before byte access', async () => {
    const f = await createFixture();
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<ClipboardFormatSnapshot>());
    const started = Promise.withResolvers<void>();
    f.discovery.mockImplementation(() => { started.resolve(); return pending.promise; });
    const result = outcome(f.browser); await started.promise;
    f.focus.mockReturnValue(false); pending.resolve(f.snapshot);
    expect(await result).toMatchObject({ error: 'NotAllowedError', realm: true });
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it.each(['generation', 'focus'] as const)('rechecks %s after the pending byte read', async (change) => {
    const f = await createFixture();
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<Uint8Array | null>());
    const started = Promise.withResolvers<void>();
    f.bytes.mockImplementation(() => { started.resolve(); return pending.promise; });
    const result = outcome(f.browser); await started.promise;
    if (change === 'generation') f.state.token = new Uint8Array([2]); else f.focus.mockReturnValue(false);
    pending.resolve(encode('stale'));
    expect(await result).toMatchObject({ error: change === 'generation' ? 'InvalidStateError' : 'NotAllowedError', realm: true });
  });

  it('owns the generation and selected item identity while the byte read is pending', async () => {
    const f = await createFixture();
    f.snapshot.entry = Buffer.from([1]);
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<Uint8Array | null>());
    const started = Promise.withResolvers<void>();
    f.bytes.mockImplementation(() => { started.resolve(); return pending.promise; });
    const result = outcome(f.browser); await started.promise;
    const args = f.bytes.mock.calls[0]!;
    expect(args).toEqual([7, 'text/plain', 13, new Uint8Array([1]), f.document]);
    expect(args[3]).not.toBe(f.snapshot.entry);
    f.snapshot.entry[0] = 99; f.snapshot.items[0]!.index = 88; f.snapshot.items[0]!.formats = ['PNG'];
    // A host-owned argument buffer must not be the generation retained for delivery.
    args[3][0] = 77; pending.resolve(encode('original'));
    expect(await result).toMatchObject({ value: 'original' });
  });

  it('copies Buffer views before asynchronous Blob decoding', async () => {
    const f = await createFixture();
    const bytes = Buffer.from('xhelloy'); const view = bytes.subarray(1, 6);
    f.bytes.mockReturnValue(f.env.userAgent.HostPromise.resolve(view, internalType<Uint8Array | null>()));
    const queued = Promise.withResolvers<void>(); const fileTasks: (() => void)[] = [];
    const queue = f.env.queueTask.bind(f.env);
    const tasks = vi.spyOn(f.env, 'queueTask').mockImplementation((source, steps) => {
      if (source !== 'file') return queue(source, steps);
      fileTasks.push(steps); queued.resolve(); return { remove() {} };
    });
    const result = outcome(f.browser); await queued.promise;
    bytes.fill(120); tasks.mockRestore();
    for (const step of fileTasks) queue('file', step);
    expect(await result).toMatchObject({ value: 'hello' });
  });

  it('rejects a generation change during File decoding', async () => {
    const f = await createFixture();
    const queued = Promise.withResolvers<void>(); const fileTasks: (() => void)[] = [];
    const queue = f.env.queueTask.bind(f.env);
    const tasks = vi.spyOn(f.env, 'queueTask').mockImplementation((source, steps) => {
      if (source !== 'file') return queue(source, steps);
      fileTasks.push(steps); queued.resolve(); return { remove() {} };
    });
    const result = outcome(f.browser); await queued.promise;
    f.state.token = new Uint8Array([2]); tasks.mockRestore();
    for (const step of fileTasks) queue('file', step);
    expect(await result).toMatchObject({ error: 'InvalidStateError', realm: true });
  });

  it.each(['generation', 'focus', 'activity', 'absent-generation'] as const)('rechecks %s in the final clipboard task', async (change) => {
    const f = await createFixture();
    if (change === 'absent-generation') f.snapshot.items = [];
    const queued = Promise.withResolvers<void>(); const delivery: (() => void)[] = [];
    const queue = f.env.queueTask.bind(f.env);
    vi.spyOn(f.env, 'queueTask').mockImplementation((source, steps) => {
      if (source !== 'clipboard') return queue(source, steps);
      delivery.push(steps); queued.resolve(); return { remove() {} };
    });
    let settled = false;
    const result = outcome(f.browser).then((value) => { settled = true; return value; });
    await queued.promise; expect(settled).toBe(false); expect(delivery).toHaveLength(1);
    const generation = change === 'generation' || change === 'absent-generation';
    if (generation) f.state.token = new Uint8Array([2]);
    if (change === 'focus') f.focus.mockReturnValue(false);
    // Enter the task normally before exercising the operation's own activity check.
    f.env.realm.queueGlobalTask(clipboardTaskSource, () => {
      const active = change === 'activity' ? vi.spyOn(f.document, 'isFullyActive').mockReturnValue(false) : null;
      try { delivery[0]!(); } finally { active?.mockRestore(); }
    });
    expect(await result).toMatchObject({ error: generation ? 'InvalidStateError' : 'NotAllowedError', realm: true });
  });

  it('rejects direct access for an inactive Document before snapshot discovery', async () => {
    const f = await createFixture();
    vi.spyOn(f.document, 'isFullyActive').mockReturnValue(false);
    expect(() => f.system.readTextData(f.document)).toThrow('Clipboard access requires an active, focused Document');
    expect(f.discovery).not.toHaveBeenCalled();
  });

  it('retains each read generation when newer text completes before an older read', async () => {
    const f = await createFixture();
    const first = f.env.userAgent.HostPromise.withResolvers(internalType<Uint8Array | null>());
    const second = f.env.userAgent.HostPromise.withResolvers(internalType<Uint8Array | null>());
    const firstStarted = Promise.withResolvers<void>(), secondStarted = Promise.withResolvers<void>();
    f.bytes.mockImplementationOnce(() => { firstStarted.resolve(); return first.promise; })
      .mockImplementationOnce(() => { secondStarted.resolve(); return second.promise; });
    const one = outcome(f.browser); await firstStarted.promise;
    f.snapshot.entry = new Uint8Array([2]); f.state.token = new Uint8Array([2]);
    const two = outcome(f.browser); await secondStarted.promise;
    second.resolve(encode('second'));
    expect(await two).toEqual({ value: 'second', promise: true });
    first.resolve(encode('first'));
    expect(await one).toMatchObject({ error: 'InvalidStateError', realm: true });
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '' }); await browser.navigate('https://clipboard.test/');
  const env = getRelevantRealm(browser.window).env; const document = unwrap<DocumentImpl>(browser.document);
  const system = env.userAgent.systemClipboard;
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(env.window, 'hasTransientActivation').mockReturnValue(true);
  vi.spyOn(system, 'isPasteInteraction').mockReturnValue(true);
  const snapshot: ClipboardFormatSnapshot = {
    platform: 'windows', entry: new Uint8Array([1]), customMap: null,
    items: [{ index: 7, formats: [13], presentationStyle: 'inline' }],
  };
  const state = { types: ['text/plain'], token: new Uint8Array([1]) };
  const discovery = vi.spyOn(system, 'readFormatSnapshot').mockImplementation(() =>
    env.userAgent.HostPromise.resolve(snapshot, internalType<ClipboardFormatSnapshot>()));
  const sequence = vi.spyOn(system, 'readChangeState').mockReturnValue(state);
  const bytes = vi.spyOn(system, 'readItemBytes').mockImplementation(() =>
    env.userAgent.HostPromise.resolve(encode('hello'), internalType<Uint8Array | null>()));
  return { browser, env, document, system, focus, snapshot, state, discovery, sequence, bytes };
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
function encode(text: string): Uint8Array { return new TextEncoder().encode(text); }
