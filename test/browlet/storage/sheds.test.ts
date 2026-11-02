import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { UserAgent } from '../../../src/browlet/user-agent';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { StorageKey, StorageShelf } from '../../../src/storage/index';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Storage §4.3: browser ownership', () => {
  it('owns one local shed per user agent and separate session sheds for its tabs', () => {
    const userAgent = new UserAgent();
    const first = TopLevelTraversable.create(userAgent, null, '');
    const second = TopLevelTraversable.create(userAgent, null, '');
    const otherUserAgent = new UserAgent();
    expect(userAgent.storageShed.size).toBe(0);
    expect(first.storageShed.size).toBe(0);
    expect(second.storageShed.size).toBe(0);

    const key = keyFor('https://example.test/');
    const local = StorageShelf.create('local');
    const session = StorageShelf.create('session');
    userAgent.storageShed.set(key, local);
    first.storageShed.set(key, session);

    expect(first.activeWindow!.env.userAgent.storageShed.get(key)).toBe(local);
    expect(second.activeWindow!.env.userAgent.storageShed.get(key)).toBe(local);
    expect(first.storageShed.get(key)).toBe(session);
    expect(second.storageShed.has(key)).toBe(false);
    expect(otherUserAgent.storageShed.has(key)).toBe(false);
  });

  it('retains local and session data when navigation replaces the Document', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const firstWindow = getRelevantRealm(browser.window).windowImplementation;
    const firstDocument = firstWindow.getAssociatedDocument();
    const traversable = firstWindow.navigable!.traversable;
    const userAgent = firstWindow.env.userAgent;
    const key = keyFor('https://example.test/');
    const local = StorageShelf.create('local');
    const session = StorageShelf.create('session');
    local.bucketMap.get('default')!.bottleMap.get('localStorage')!.map.set('theme', 'dark');
    session.bucketMap.get('default')!.bottleMap.get('sessionStorage')!.map.set('draft', 'saved');
    userAgent.storageShed.set(key, local);
    traversable.storageShed.set(key, session);

    await browser.navigate('https://example.test/second');

    const nextWindow = getRelevantRealm(browser.window).windowImplementation;
    expect(nextWindow.getAssociatedDocument()).not.toBe(firstDocument);
    expect(nextWindow.env.userAgent.storageShed.get(key)).toBe(local);
    expect(nextWindow.navigable!.traversable.storageShed.get(key)).toBe(session);
    expect(local.bucketMap.get('default')!.bottleMap.get('localStorage')!.map.get('theme')).toBe('dark');
    expect(session.bucketMap.get('default')!.bottleMap.get('sessionStorage')!.map.get('draft')).toBe('saved');
  });

  it('clones a nested opener from its top-level traversable once auxiliary creation completes', () => {
    const userAgent = new UserAgent();
    const top = TopLevelTraversable.create(userAgent, null, '');
    const [opener, childDocument] = BrowsingContext.createTopLevel(userAgent);
    // Compose the child until navigation supplies child browsing-context creation.
    new Navigable(createDocumentState(childDocument), top);
    const key = keyFor('https://example.test/');
    const shelf = StorageShelf.create('session');
    const original = shelf.bucketMap.get('default')!.bottleMap.get('sessionStorage')!.map;
    original.set('draft', 'opener');
    top.storageShed.set(key, shelf);

    // Only the still-unimplemented auxiliary creation step is supplied here.
    const createAuxiliary = vi.spyOn(BrowsingContext, 'createAuxiliary')
      .mockImplementationOnce(() => BrowsingContext.createTopLevel(userAgent));
    let opened: TopLevelTraversable;
    try {
      opened = TopLevelTraversable.create(userAgent, opener, 'new tab');
      expect(createAuxiliary).toHaveBeenCalledExactlyOnceWith(opener);
    } finally {
      createAuxiliary.mockRestore();
    }

    const copy = opened.storageShed.get(key)!.bucketMap.get('default')!.bottleMap.get('sessionStorage')!.map;
    expect(copy).not.toBe(original);
    expect(copy.get('draft')).toBe('opener');
    copy.set('draft', 'child');
    expect(original.get('draft')).toBe('opener');
  });
});

function keyFor(url: string): StorageKey {
  return new StorageKey(obtainURLOrigin(parseURL(url).url!));
}
