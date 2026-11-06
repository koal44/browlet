import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { BlobImpl } from '../../../../src/file/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../../../../src/web-idl/core/index';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import {
  getCustomFormatMapName, getCustomFormatName,
  type ClipboardPlatform, type ClipboardWriteItem,
} from '../../../../src/browlet/interaction/clipboard/index';
import type { Window } from '../../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard Appendix A.2: grouped format writing', () => {
  it.each(['windows', 'macos', 'linux', 'chromeos', 'android'] as const)('maps standard formats for %s without reading or decoding their Blobs', async (platform) => {
    const f = await createFixture(platform);
    const text = vi.spyOn(BlobImpl.prototype, 'text');
    await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      await w.navigator.clipboard.write([new w.ClipboardItem({
        'text/plain': 'plain', 'text/html': '<p>html</p>',
        'image/png': new w.Blob([new Uint8Array([0, 255, 128, 0, 13, 10])], { type: 'image/png' }),
        'image/svg+xml': '<svg/>',
      }, { presentationStyle: 'inline' })]);
    });
    expect(text).not.toHaveBeenCalled();
    const [items, selected, document] = f.commit.mock.calls[0]!;
    expect(selected).toBe(platform); expect(document).toBe(f.document);
    expect(items).toHaveLength(1); expect(items[0]!.custom).toBeNull();
    expect(items[0]!.presentationStyle).toBe('inline');
    expect(items[0]!.standard.map((entry) => entry.format)).toEqual(platform === 'windows'
      ? [13, 'HTML Format', 'PNG', 'image/svg+xml']
      : platform === 'macos'
        ? ['public.utf8-plain-text', 'public.html', 'public.png', 'public.svg-image']
        : ['text/plain', 'text/html', 'image/png', 'image/svg+xml']);
    expect([...await items[0]!.standard[2]!.data.data.read()]).toEqual([0, 255, 128, 0, 13, 10]);
    expect(f.platform).toHaveBeenCalledTimes(1); expect(f.additional).not.toHaveBeenCalled();
    expect(f.commit).toHaveBeenCalledTimes(1); expect(f.change).toHaveBeenCalledExactlyOnceWith(f.document);
  });

  it('keeps custom text and images distinct from standard formats, retaining identity and binary bytes', async () => {
    const f = await createFixture();
    await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const customText = new w.Blob([new Uint8Array([255, 0, 128])], { type: 'text/plain' });
      const standard = new w.Blob(['plain'], { type: 'text/plain' });
      const customImage = new w.Blob([new Uint8Array([0, 255, 0])], { type: 'image/png' });
      Reflect.set(window, 'customText', customText); Reflect.set(window, 'standard', standard);
      Reflect.set(window, 'customImage', customImage);
      await w.navigator.clipboard.write([new w.ClipboardItem({
        'web text/plain': customText, 'text/plain': standard, 'web image/png': customImage,
      })]);
    });
    const item = f.commit.mock.calls[0]![0][0]!; const custom = item.custom!;
    expect(item.standard.map((entry) => entry.format)).toEqual([13]);
    expect(item.standard[0]!.data).toBe(unwrap<BlobImpl>(Reflect.get(f.browser.window, 'standard') as object));
    expect(custom.mapFormat).toBe('Web Custom Format Map');
    expect(f.env.parseJSONBytesToInfra(custom.mapData)).toEqual(new Map([
      ['text/plain', 'Web Custom Format0'], ['image/png', 'Web Custom Format1'],
    ]));
    expect(custom.representations.map((entry) => entry.format)).toEqual(['Web Custom Format0', 'Web Custom Format1']);
    expect(custom.representations[0]!.data).toBe(unwrap<BlobImpl>(Reflect.get(f.browser.window, 'customText') as object));
    expect(custom.representations[1]!.data).toBe(unwrap<BlobImpl>(Reflect.get(f.browser.window, 'customImage') as object));
    expect([...await custom.representations[0]!.data.data.read()]).toEqual([255, 0, 128]);
    expect([...await custom.representations[1]!.data.data.read()]).toEqual([0, 255, 0]);
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.additional).not.toHaveBeenCalled();
  });

  it.each(['windows', 'macos', 'linux', 'chromeos', 'android'] as const)('uses complete custom names for %s without an empty standard-format write', async (platform) => {
    const f = await createFixture(platform);
    expect(await writeString(f.browser, 'web application/x-browlet')).toMatchObject({ done: true });
    const item = f.commit.mock.calls[0]![0][0]!;
    expect(item.standard).toEqual([]);
    expect(item.custom!.mapFormat).toBe(getCustomFormatMapName(platform));
    expect(item.custom!.representations[0]!.format).toBe(getCustomFormatName(0, platform));
    expect(f.additional).not.toHaveBeenCalled();
  });

  it('retains separate items with identical standard/custom formats and distinct presentation styles', async () => {
    const f = await createFixture(); f.multiple.mockReturnValue(true);
    await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      await w.navigator.clipboard.write([
        new w.ClipboardItem({ 'text/plain': 'one', 'web application/x-a': 'custom one' }, { presentationStyle: 'inline' }),
        new w.ClipboardItem({ 'text/plain': 'two', 'web application/x-a': 'custom two' }, { presentationStyle: 'attachment' }),
      ]);
    });
    const items = f.commit.mock.calls[0]![0];
    expect(items.map((item) => [item.presentationStyle, item.standard.map((entry) => entry.format)]))
      .toEqual([['inline', [13]], ['attachment', [13]]]);
    expect(items.map((item) => item.custom!.representations[0]!.format)).toEqual(['Web Custom Format0', 'Web Custom Format0']);
    expect(items[0]!.custom).not.toBe(items[1]!.custom);
    expect(await Promise.all(items.map((item) => item.standard[0]!.data.text()))).toEqual(['one', 'two']);
    expect(await Promise.all(items.map((item) => item.custom!.representations[0]!.data.text()))).toEqual(['custom one', 'custom two']);
    expect(f.platform).toHaveBeenCalledTimes(1); expect(f.commit).toHaveBeenCalledTimes(1);
  });

  it('leaves single-item host selection with the existing public write algorithm', async () => {
    const f = await createFixture();
    await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      await w.navigator.clipboard.write([
        new w.ClipboardItem({ 'text/plain': 'first' }),
        new w.ClipboardItem({ 'text/html': new Promise<string>(() => {}) }),
      ]);
    });
    expect(f.commit.mock.calls[0]![0]).toHaveLength(1);
    expect(await f.commit.mock.calls[0]![0][0]!.standard[0]!.data.text()).toBe('first');
  });

  it('uses the prepared Blob type rather than a stale representation type', async () => {
    const f = await createFixture();
    const prepared = new BlobImpl([new Uint8Array([255, 0])], { type: 'image/png' }, f.env);
    f.prepare.mockImplementation(() => f.env.userAgent.HostPromise.resolve(prepared, internalType<BlobImpl>()));
    expect(await writeString(f.browser, 'image/svg+xml')).toMatchObject({ done: true });
    expect(f.commit.mock.calls[0]![0][0]!.standard).toEqual([{ format: 'PNG', data: prepared }]);
  });

  it('routes parameterized writeText output through the standard plain-text format', async () => {
    const f = await createFixture();
    await f.browser.evaluate(async () => { await (window as unknown as Window).navigator.clipboard.writeText(''); });
    const entry = f.commit.mock.calls[0]![0][0]!.standard[0]!;
    expect(entry.format).toBe(13); expect(entry.data.type).toBe('text/plain;charset=utf-8');
    expect(entry.data.size).toBe(0); expect(f.commit.mock.calls[0]![0][0]!.custom).toBeNull();
  });

  it('keeps optional URI-list mapping explicit instead of inventing a custom format', async () => {
    const f = await createFixture();
    expect(await writeString(f.browser, 'text/uri-list')).toMatchObject({ message: 'Additional clipboard format mapping is not implemented' });
    expect(f.additional).toHaveBeenCalledExactlyOnceWith('text/uri-list', 'windows');
    expect(f.commit).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });

  it('uses the additional-format owner when it supplies an optional standard mapping', async () => {
    const f = await createFixture(); f.additional.mockReturnValue('host URI-list format');
    expect(await writeString(f.browser, 'text/uri-list', '# note\r\nhttps://example.test/')).toMatchObject({ done: true });
    const item = f.commit.mock.calls[0]![0][0]!;
    expect(item.custom).toBeNull(); expect(item.standard[0]!.format).toBe('host URI-list format');
    expect(await item.standard[0]!.data.text()).toBe('# note\r\nhttps://example.test/');
  });

  it('rejects an unsupported optional format before any OS write', async () => {
    const f = await createFixture(); f.additional.mockReturnValue('');
    expect(await writeString(f.browser, 'text/uri-list')).toMatchObject({ error: 'NotAllowedError', realm: true });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });

  it('rejects standard format collisions within an item, including collisions supplied by the optional mapper', async () => {
    const f = await createFixture(); f.additional.mockReturnValue(13);
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      try { await w.navigator.clipboard.write([new w.ClipboardItem({ 'text/plain': 'plain', 'text/uri-list': 'uri' })]); }
      catch (error) { return [(error as Error).name, error instanceof DOMException]; }
    })).toEqual(['NotAllowedError', true]);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects duplicate actual Blob formats in a later item before committing anything; custom=%s', async (custom) => {
    const f = await createFixture(); f.multiple.mockReturnValue(true);
    expect(await f.browser.evaluate(async (custom) => {
      const w = window as unknown as Window; const prefix = custom ? 'web ' : '';
      const data = new w.Blob(['same type'], { type: 'text/plain' });
      try {
        await w.navigator.clipboard.write([
          new w.ClipboardItem({ 'text/plain': 'first item' }),
          new w.ClipboardItem({ [prefix + 'text/plain']: data, [prefix + 'text/html']: data }),
        ]);
      } catch (error) { return [(error as Error).name, error instanceof DOMException]; }
    }, custom)).toEqual(['NotAllowedError', true]);
    expect(f.commit).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });

  it('rejects 101 custom formats before committing earlier standard representations', async () => {
    const f = await createFixture();
    expect(await f.browser.evaluate(async () => {
      const w = window as unknown as Window;
      const entries = Object.fromEntries(Array.from({ length: 101 }, (_, index) => ['web application/x-' + index, 'data']));
      try { await w.navigator.clipboard.write([new w.ClipboardItem({ 'text/plain': 'plain', ...entries })]); }
      catch (error) { return [(error as Error).name, error instanceof DOMException]; }
    })).toEqual(['NotAllowedError', true]);
    expect(f.commit).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });

  it('keeps an empty internal write as a no-op without selecting or accessing an OS clipboard', async () => {
    const f = await createFixture();
    expect(await f.system.writeItems([], f.document)).toBe(false);
    expect(f.platform).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
  });

  it('snapshots item structure before handing it to an asynchronous OS writer', async () => {
    const f = await createFixture();
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<boolean>());
    f.commit.mockReturnValue(pending.promise);
    const plain = new BlobImpl(['one'], { type: 'text/plain' }, f.env);
    const custom = new BlobImpl(['two'], { type: 'application/x-a' }, f.env);
    const items: ClipboardWriteItem[] = [{
      representations: [{ type: plain.type, isCustom: false, data: plain }, { type: custom.type, isCustom: true, data: custom }],
      presentationStyle: 'inline',
    }];
    const result = f.system.writeItems(items, f.document);
    expect(result).toBe(pending.promise);
    items[0]!.presentationStyle = 'attachment'; items[0]!.representations.length = 0; items.length = 0;
    const retained = f.commit.mock.calls[0]![0][0]!;
    expect(retained.presentationStyle).toBe('inline');
    expect(retained.standard).toEqual([{ format: 13, data: plain }]);
    expect(retained.custom!.representations).toEqual([{ format: 'Web Custom Format0', data: custom }]);
    pending.resolve(false); expect(await result).toBe(false);
  });

  it('settles only after the OS writer and preserves its changed result', async () => {
    const f = await createFixture();
    const pending = f.env.userAgent.HostPromise.withResolvers(internalType<boolean>());
    const started = Promise.withResolvers<void>();
    f.commit.mockImplementation(() => { started.resolve(); return pending.promise; });
    let settled = false;
    const writing = writeString(f.browser).then((result) => { settled = true; return result; });
    await started.promise; expect(settled).toBe(false); expect(f.change).not.toHaveBeenCalled();
    pending.resolve(false); expect(await writing).toMatchObject({ done: true, promise: true });
    expect(f.change).not.toHaveBeenCalled();
  });

  it('delivers OS failures through the author promise without notifying a change', async () => {
    const f = await createFixture();
    f.commit.mockImplementation(() => f.env.userAgent.HostPromise.reject(
      new DOMExceptionImpl('OS clipboard unavailable', DOMExceptionNames.notAllowed), internalType<boolean>(),
    ));
    expect(await writeString(f.browser)).toMatchObject({ error: 'NotAllowedError', realm: true, promise: true });
    expect(f.change).not.toHaveBeenCalled();
  });

  it.each(['platform', 'commit'] as const)('keeps the missing %s dependency observable', async (dependency) => {
    const f = await createFixture(); f[dependency].mockRestore();
    expect(await writeString(f.browser)).toMatchObject({
      message: dependency === 'platform'
      ? 'Clipboard platform selection is not implemented' : 'OS clipboard format writing is not implemented',
    });
    expect(f.change).not.toHaveBeenCalled();
  });
});

async function createFixture(platform: ClipboardPlatform = 'windows') {
  const browser = new Browlet({ route: () => '' }); await browser.navigate('https://clipboard.test/');
  const env = getRelevantRealm(browser.window).env; const document = unwrap<DocumentImpl>(browser.document);
  const system = env.userAgent.systemClipboard;
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  env.userAgent.permissionStore.setEntry({ name: 'clipboard-write', allowWithoutGesture: true }, env.topLevelOrigin, 'granted');
  const multiple = vi.spyOn(system, 'supportsMultipleItems').mockReturnValue(false);
  const prepare = vi.spyOn(system, 'prepareWriteData').mockImplementation((blob) => env.userAgent.HostPromise.resolve(blob, internalType<BlobImpl>()));
  const selectPlatform = vi.spyOn(system, 'getPlatform').mockReturnValue(platform);
  const additional = vi.spyOn(system, 'getAdditionalFormat');
  const commit = vi.spyOn(system, 'writeFormats').mockImplementation(() => env.userAgent.HostPromise.resolve(true, internalType<boolean>()));
  const change = vi.spyOn(system, 'queueChange').mockImplementation(() => {});
  return { browser, env, document, system, multiple, prepare, platform: selectPlatform, additional, commit, change };
}
async function writeString(browser: Browlet, type = 'text/plain', data = 'data') {
  return browser.evaluate(async ({ type, data }) => {
    const w = window as unknown as Window; const result = w.navigator.clipboard.write([new w.ClipboardItem({ [type]: data })]);
    try { await result; return { done: true, promise: result instanceof Promise }; }
    catch (error) { return {
      error: (error as Error).name, message: (error as Error).message,
      realm: error instanceof DOMException, promise: result instanceof Promise,
    }; }
  }, { type, data });
}
