import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { BlobImpl } from '../../../../src/file/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../../../../src/web-idl/core/index';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import {
  getCustomFormatMapName, getCustomFormatName, prepareCustomFormats, readCustomFormats,
  type ClipboardFormatSnapshot,
} from '../../../../src/browlet/interaction/clipboard/index';
import type { ClipboardItem, Window } from '../../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard Appendix A.5: custom map decoding', () => {
  it.each(['', '{', '[]', 'null', 'true', '42', '"text"',
    '{"text/plain":"format",}', '// comment\n{"text/plain":"format"}'])('ignores unusable or nonstandard JSON: %s', async (text) => {
    const { env } = await createBrowser();
    expect([...readCustomFormats(encode(text), env)]).toEqual([]);
  });

  it('skips invalid entries, retains full MIME keys and keeps the first canonical match', async () => {
    const { env } = await createBrowser();
    const map = readCustomFormats(encode(JSON.stringify({
      bad: 'invalid', 'text/plain': 1, 'text/html': '',
      'TEXT/HTML': 'first', 'text/html ': 'second',
      'application/json; version=1': 'shared', 'application/json; version=2': 'shared',
      'image/png': null, 'image/svg+xml': {}, 'text/uri-list': [],
      'web text/plain': 'invalid', 'application/x-browlet': 'arbitrary OS format name',
    })), env);
    expect([...map]).toEqual([
      ['web text/html', 'first'], ['web application/json;version=1', 'shared'],
      ['web application/json;version=2', 'shared'], ['web application/x-browlet', 'arbitrary OS format name'],
    ]);
  });

  it('keeps JSON duplicate-property rules separate from canonical MIME collisions', async () => {
    const { env } = await createBrowser();
    expect([...readCustomFormats(encode('{"text/plain":"old","text/plain":"new","TEXT/PLAIN":"later"}'), env)])
      .toEqual([['web text/plain', 'new']]);
  });

  it('decodes UTF-8 with BOM removal and keeps MIME parameter order', async () => {
    const { env } = await createBrowser();
    const bytes = encode('\uFEFF{"application/x-a;a=1;b=2":"内容","application/x-a;b=2;a=1":"other"}');
    expect([...readCustomFormats(bytes, env)]).toEqual([
      ['web application/x-a;a=1;b=2', '内容'], ['web application/x-a;b=2;a=1', 'other'],
    ]);
  });

  it('does not mask failures other than malformed JSON', async () => {
    const { env } = await createBrowser(); const failure = new Error('decoder dependency failed');
    vi.spyOn(env, 'parseJSONBytesToInfra').mockImplementation(() => { throw failure; });
    expect(() => readCustomFormats(encode('{}'), env)).toThrow(failure);
  });

  it('uses captured JSON operations even when author code replaces JSON methods and adds toJSON', async () => {
    const { browser, env } = await createBrowser();
    await browser.evaluate(() => {
      JSON.parse = () => { throw new Error('author parse'); };
      JSON.stringify = () => { throw new Error('author stringify'); };
      Object.defineProperty(Object.prototype, 'toJSON', { value() { throw new Error('author toJSON'); }, configurable: true });
    });
    const blob = new BlobImpl(['data'], { type: 'application/x-browlet' }, env);
    const prepared = prepareCustomFormats([blob], 'windows', env);
    expect([...readCustomFormats(prepared.mapData, env)])
      .toEqual([['web application/x-browlet', 'Web Custom Format0']]);
  });
});

describe('Clipboard Appendix A.6: custom write preparation', () => {
  it.each(['windows', 'macos', 'linux', 'chromeos', 'android'] as const)('prepares a complete map and ordered payloads for %s', async (platform) => {
    const { env } = await createBrowser();
    const first = new BlobImpl([new Uint8Array([0, 255, 128])], { type: 'APPLICATION/X-BROWLET ; Version="one two"' }, env);
    const second = new BlobImpl(['text'], { type: 'text/plain' }, env);
    const result = prepareCustomFormats([first, second], platform, env);
    expect(result.mapFormat).toBe(getCustomFormatMapName(platform));
    expect(env.parseJSONBytesToInfra(result.mapData)).toEqual(new Map([
      ['application/x-browlet;version="one two"', getCustomFormatName(0, platform)],
      ['text/plain', getCustomFormatName(1, platform)],
    ]));
    expect(result.representations.map((item) => item.format)).toEqual([
      getCustomFormatName(0, platform), getCustomFormatName(1, platform),
    ]);
    expect(result.representations[0]!.data).toBe(first);
    expect(result.representations[1]!.data).toBe(second);
    expect(first.size).toBe(3);
    expect([...readCustomFormats(result.mapData, env).keys()]).toEqual([
      'web application/x-browlet;version="one two"', 'web text/plain',
    ]);
  });

  it('handles an empty A.6 batch without implying a clipboard mutation', async () => {
    const { env } = await createBrowser(); const result = prepareCustomFormats([], 'windows', env);
    expect(result.representations).toEqual([]);
    expect(new TextDecoder().decode(result.mapData)).toBe('{}');
  });

  it('allows 100 custom formats and rejects 101 before serializing any result', async () => {
    const { env } = await createBrowser();
    const items = Array.from({ length: 101 }, (_, index) => new BlobImpl([], { type: 'application/x-format' + index }, env));
    const result = prepareCustomFormats(items.slice(0, 100), 'windows', env);
    expect(result.representations).toHaveLength(100);
    expect(result.representations[99]!.format).toBe('Web Custom Format99');
    const serialize = vi.spyOn(env, 'serializeInfraValueToJSONBytes');
    expect(() => prepareCustomFormats(items, 'windows', env)).toThrow('at most 100');
    expect(serialize).not.toHaveBeenCalled();
  });

  it.each(['', 'not a MIME type', 'web text/plain'])('rejects an invalid Blob MIME type: %s', async (type) => {
    const { env } = await createBrowser();
    const item = new BlobImpl([], { type }, env);
    expect(() => prepareCustomFormats([item], 'windows', env)).toThrow('Invalid custom clipboard MIME type');
  });

  it('rejects canonical duplicate types before preparing a JSON result', async () => {
    const { env } = await createBrowser();
    const items = ['text/plain; charset=utf-8', 'TEXT/PLAIN;charset=utf-8'].map((type) => new BlobImpl([], { type }, env));
    const serialize = vi.spyOn(env, 'serializeInfraValueToJSONBytes');
    try { prepareCustomFormats(items, 'windows', env); expect.unreachable(); }
    catch (error) { expect(error).toBeInstanceOf(DOMExceptionImpl); expect((error as DOMExceptionImpl).name).toBe('NotAllowedError'); }
    expect(serialize).not.toHaveBeenCalled();
  });

  it('keeps parameter-distinct types and snapshots the input sequence', async () => {
    const { env } = await createBrowser();
    const first = new BlobImpl(['a'], { type: 'application/x-a;a=1;b=2' }, env);
    const second = new BlobImpl(['b'], { type: 'application/x-a;b=2;a=1' }, env);
    const items = [first, second]; const result = prepareCustomFormats(items, 'linux', env);
    items.reverse(); items.length = 0;
    expect(result.representations.map((item) => item.data)).toEqual([first, second]);
    expect([...readCustomFormats(result.mapData, env).keys()]).toEqual([
      'web application/x-a;a=1;b=2', 'web application/x-a;b=2;a=1',
    ]);
  });
});

describe('Clipboard A.5 metadata and lazy-read integration', () => {
  it('maps standard formats, omits unrecognized items and appends custom types to the first eligible item', async () => {
    const f = await createFixture();
    f.snapshot.items = [
      { index: 4, formats: ['unknown'], presentationStyle: 'unspecified' },
      { index: 7, formats: [13, 'PNG', 13], presentationStyle: 'inline' },
      { index: 9, formats: ['HTML Format'], presentationStyle: 'attachment' },
    ];
    expect(await f.browser.evaluate(async () => (await (window as unknown as Window).navigator.clipboard.read()).map((item) => ({
      types: [...item.types], style: item.presentationStyle, frozen: Object.isFrozen(item.types),
    })))).toEqual([
      { types: ['text/plain', 'image/png', 'web application/x-browlet'], style: 'inline', frozen: true },
      { types: ['text/html'], style: 'attachment', frozen: true },
    ]);
    expect(f.discovery).toHaveBeenCalledExactlyOnceWith(f.document, true);
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it.each(['windows', 'macos', 'linux', 'chromeos', 'android'] as const)('uses the supplied platform for %s metadata', async (platform) => {
    const f = await createFixture(); f.snapshot.platform = platform; f.snapshot.customMap = null;
    f.snapshot.items[0]!.formats = [platform === 'windows' ? 13 : platform === 'macos' ? 'public.utf8-plain-text' : 'text/plain'];
    const result = await f.system.readItemMetadata(f.document);
    expect([...result.items[0]!.formats.keys()]).toEqual(['text/plain']);
  });

  it('retains copied formats and generation bytes when the host snapshot is later changed', async () => {
    const f = await createFixture(); f.snapshot.entry = Buffer.from([1]);
    await retainItem(f.browser);
    f.snapshot.entry[0] = 2; f.snapshot.items[0]!.index = 99;
    f.snapshot.items[0]!.formats = ['HTML Format']; f.snapshot.customMap!.fill(0);
    const result = await f.browser.evaluate(async () => {
      const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      const blob = await item.getType('web APPLICATION/X-BROWLET');
      return [[...item.types], blob.type, [...new Uint8Array(await blob.arrayBuffer())]];
    });
    expect(result).toEqual([['text/plain', 'web application/x-browlet'], 'application/x-browlet', [0, 255, 128]]);
    expect(f.bytes).toHaveBeenCalledExactlyOnceWith(7, 'web application/x-browlet', 'Web Custom Format0', new Uint8Array([1]), f.document);
    expect(f.discovery).toHaveBeenCalledTimes(1);
  });

  it('preserves the MIME interpretation when distinct types share one OS format', async () => {
    const f = await createFixture();
    f.snapshot.customMap = encode('{"text/plain":"shared","application/x-browlet":"shared"}');
    await retainItem(f.browser);
    await f.browser.evaluate(async () => {
      const item = Reflect.get(window, 'clipboardItem') as ClipboardItem;
      await Promise.all([item.getType('web text/plain'), item.getType('web application/x-browlet')]);
    });
    expect(f.bytes).toHaveBeenCalledWith(7, 'web text/plain', 'shared', new Uint8Array([1]), f.document);
    expect(f.bytes).toHaveBeenCalledWith(7, 'web application/x-browlet', 'shared', new Uint8Array([1]), f.document);
    expect(f.bytes).toHaveBeenCalledTimes(2);
  });

  it('retains the specified custom-only item with no originating system item', async () => {
    const f = await createFixture(); f.snapshot.items[0]!.formats = ['Web Custom Format0'];
    expect(await f.browser.evaluate(async () => {
      const items = await (window as unknown as Window).navigator.clipboard.read();
      try { await items[0]!.getType('web application/x-browlet'); return null; }
      catch (error) { return [[...items[0]!.types], items[0]!.presentationStyle, (error as Error).name, error instanceof DOMException]; }
    })).toEqual([['web application/x-browlet'], 'unspecified', 'InvalidStateError', true]);
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it.each([null, '{', '[]', '{"invalid":"format"}'])('returns no items when neither standard nor custom formats are usable: %s', async (map) => {
    const f = await createFixture(); f.snapshot.items = []; f.snapshot.customMap = map === null ? null : encode(map);
    expect(await f.browser.evaluate(async () => (await (window as unknown as Window).navigator.clipboard.read()).length)).toBe(0);
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it('retains standard data when custom-map decoding fails', async () => {
    const f = await createFixture(); f.snapshot.customMap = encode('{');
    expect(await f.browser.evaluate(async () => {
      const item = (await (window as unknown as Window).navigator.clipboard.read())[0]!;
      return [[...item.types], [...new Uint8Array(await (await item.getType('text/plain')).arrayBuffer())]];
    })).toEqual([['text/plain'], [0, 255, 128]]);
    expect(f.bytes).toHaveBeenCalledExactlyOnceWith(7, 'text/plain', 13, new Uint8Array([1]), f.document);
  });

  it('delivers discovery failures through the existing read promise', async () => {
    const f = await createFixture();
    f.discovery.mockImplementation(() => f.env.userAgent.HostPromise.reject(
      new DOMExceptionImpl('Clipboard changed during discovery', DOMExceptionNames.invalidState), internalType<ClipboardFormatSnapshot>(),
    ));
    expect(await f.browser.evaluate(async () => {
      try { await (window as unknown as Window).navigator.clipboard.read(); return null; }
      catch (error) { return [(error as Error).name, error instanceof DOMException]; }
    })).toEqual(['InvalidStateError', true]);
    expect(f.bytes).not.toHaveBeenCalled();
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '' }); await browser.navigate('https://clipboard.test/');
  const env = getRelevantRealm(browser.window).env; const document = unwrap<DocumentImpl>(browser.document);
  return { browser, env, document };
}
async function createFixture() {
  const f = await createBrowser(); const { env, document } = f; const system = env.userAgent.systemClipboard;
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(env.window, 'hasTransientActivation').mockReturnValue(true);
  vi.spyOn(system, 'isPasteInteraction').mockReturnValue(true);
  const snapshot: ClipboardFormatSnapshot = {
    platform: 'windows', entry: new Uint8Array([1]),
    items: [{ index: 7, formats: [13], presentationStyle: 'inline' }],
    customMap: encode('{"application/x-browlet":"Web Custom Format0"}'),
  };
  const discovery = vi.spyOn(system, 'readFormatSnapshot').mockImplementation(() =>
    env.userAgent.HostPromise.resolve(snapshot, internalType<ClipboardFormatSnapshot>()));
  vi.spyOn(system, 'readChangeState').mockReturnValue({ types: ['text/plain'], token: new Uint8Array([1]) });
  const bytes = vi.spyOn(system, 'readItemBytes').mockImplementation(() =>
    env.userAgent.HostPromise.resolve(new Uint8Array([0, 255, 128]), internalType<Uint8Array | null>()));
  return { ...f, system, snapshot, discovery, bytes };
}
async function retainItem(browser: Browlet) {
  await browser.evaluate(async () => {
    const items = await (window as unknown as Window).navigator.clipboard.read(); Reflect.set(window, 'clipboardItem', items[0]);
  });
}
function encode(text: string): Uint8Array { return new TextEncoder().encode(text); }
