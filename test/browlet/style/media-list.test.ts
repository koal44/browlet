import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { MediaList } from '../../../src/browlet/platform';
import { MediaListImpl } from '../../../src/stylelet/cssom/media-list';
import { reference } from '../../../src/web-idl/index';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';

/* eslint-disable @typescript-eslint/unbound-method -- Borrowed methods receive an explicit receiver through Reflect.apply. */

describe('MediaList binding', () => {
  it('exposes a Window interface and projects stable identity without an author constructor', async () => {
    const { browser, platform, implementation } = projectList('screen');
    const context = getBindingContext(getRelevantRealm(browser.window));
    expect(platform).toBeInstanceOf(browser.window.MediaList);
    expect(context.implToJS(implementation, reference(MediaListImpl))).toBe(platform);
    expect(await browser.evaluate(() => {
      try { Reflect.construct(MediaList, []); return false; }
      catch (error) { return error instanceof TypeError; }
    })).toBe(true);
  });

  it('projects live indices, stringification, and indexed iteration', () => {
    const { browser, platform } = projectList('screen, print');
    expect(Object.keys(platform)).toEqual(['0', '1']);
    expect(Object.getOwnPropertyDescriptor(platform, '0'))
      .toEqual({ value: 'screen', writable: false, enumerable: true, configurable: true });
    expect([platform[0], platform[2], platform.item(2)]).toEqual(['screen', undefined, null]);
    expect(String(platform)).toBe('screen, print');
    expect(Reflect.get(platform, Symbol.iterator)).toBe(getRelevantRealm(browser.window).intrinsics.array.prototype.values);
    const iterator = platform[Symbol.iterator]();
    expect(iterator.next().value).toBe('screen');
    platform.appendMedium('speech');
    expect([...iterator]).toEqual(['print', 'speech']);
    expect(Reflect.set(platform, '0', 'changed')).toBe(false);
    expect(Reflect.deleteProperty(platform, '0')).toBe(false);
    platform.mediaText = 'speech';
    expect(Object.keys(platform)).toEqual(['0']);
    expect(platform[1]).toBeUndefined();
  });

  it('converts arguments and checks receivers at the binding boundary', () => {
    const { browser, platform } = projectList('screen, print');
    const { item, appendMedium } = browser.window.MediaList.prototype;
    const TypeError_ = getRelevantRealm(browser.window).intrinsics.typeError;
    expect(Reflect.apply(item, platform, [1.9])).toBe('print');
    expect(Reflect.apply(item, platform, [-1])).toBeNull();
    expect(Reflect.apply(item, platform, [2 ** 32])).toBe('screen');
    expect(Reflect.apply(item, platform, [NaN])).toBe('screen');
    expect(Reflect.set(platform, 'mediaText', null)).toBe(true);
    expect(platform.length).toBe(0);
    Reflect.apply(appendMedium, platform, [null]);
    expect(platform.mediaText).toBe('null');
    expect(() => { Reflect.apply(item, {}, [0]); }).toThrow(TypeError_);
    expect(() => { Reflect.apply(item, platform, []); }).toThrow(TypeError_);
    expect(() => { Reflect.apply(appendMedium, platform, [Symbol()]); }).toThrow(TypeError_);
  });

  it('keeps DOMString conversion separate from CSS input preprocessing', () => {
    const { platform, implementation } = projectList('');
    const setter = vi.spyOn(implementation, 'mediaText', 'set');
    platform.mediaText = '\ud800';
    expect(setter).toHaveBeenCalledWith('\ud800');
    expect(platform.mediaText).toBe('\ufffd');
  });

  it('does not invoke author overrides during indexed access or stringification', () => {
    const { platform } = projectList('screen');
    Reflect.set(platform, 'item', () => 'overridden');
    Object.defineProperty(platform, 'mediaText', { value: 'overridden' });
    expect(platform[0]).toBe('screen');
    expect(String(platform)).toBe('screen');
  });

  it('realizes exceptions in the borrowed method realm', () => {
    const { browser, platform } = projectList('screen');
    const other = new Browlet({ route: () => '' });
    const deleteMedium = other.window.MediaList.prototype.deleteMedium;
    let error: unknown;
    try { Reflect.apply(deleteMedium, platform, ['print']); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(other.window.DOMException);
    expect(error).not.toBeInstanceOf(browser.window.DOMException);
    expect(error).toMatchObject({ name: 'NotFoundError', code: 8 });
    expect(platform.mediaText).toBe('screen');
  });
});

function projectList(text: string): { browser: Browlet; platform: MediaList; implementation: MediaListImpl; } {
  const browser = new Browlet({ route: () => '' });
  const context = getBindingContext(getRelevantRealm(browser.window));
  const implementation = new MediaListImpl(text);
  const platform = context.implToJS(implementation, reference(MediaListImpl)) as MediaList;
  return { browser, platform, implementation };
}
