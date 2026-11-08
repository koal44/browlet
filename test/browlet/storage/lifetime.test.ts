import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/tasks';
import { StorageBucket, StorageKey, StorageProxyMap, StorageShelf, type StorageShed } from '../../../src/storage/index';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('Storage §7.1: session lifetime', () => {
  it('clears every origin and bucket when the retired traversable is removed, preserving other tabs and local storage', () => {
    const userAgent = createManualUserAgent();
    const retired = TopLevelTraversable.create(userAgent, null, '');
    const other = TopLevelTraversable.create(userAgent, null, '');
    const first = putSession(retired.storageShed, 'https://first.test/');
    const second = putSession(retired.storageShed, 'https://second.test/');
    const extra = StorageBucket.create('session');
    const extraMap = extra.bottleMap.get('sessionStorage')!.map;
    extraMap.set('saved', 'extra bucket');
    first.shelf.bucketMap.set('extra', extra);
    const otherSession = putSession(other.storageShed, 'https://first.test/');
    const local = StorageShelf.create('local');
    const localMap = local.bucketMap.get('default')!.bottleMap.get('localStorage')!.map;
    localMap.set('saved', 'local');
    userAgent.storageShed.set(keyFor('https://first.test/'), local);

    // Starting to close is not confirmation: unloading can still cancel it.
    retired.isClosing = true;
    expect(first.view.get('saved')).toBe('session');
    expect(second.view.get('saved')).toBe('session');

    const document = retired.activeDocument!;
    const env = retired.activeWindow!.env;
    env.realm.queueGlobalTask(navigationAndTraversalTaskSource, { run: () => { document.destroy(); } });
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(retired.activeDocument).toBeNull();
    expect(first.view.get('saved')).toBe('session');
    expect(userAgent.topLevelTraversableSet.has(retired)).toBe(true);

    // Exercise the final removal step directly; Window.close() orchestration is still unfinished.
    userAgent.removeTopLevelTraversable(retired);

    expect(first.view.size).toBe(0);
    expect(second.view.size).toBe(0);
    expect(extraMap.size).toBe(0);
    expect(first.shelf.bucketMap.size).toBe(0);
    expect(second.shelf.bucketMap.size).toBe(0);
    expect(retired.storageShed.size).toBe(0);
    expect(userAgent.topLevelTraversableSet.has(retired)).toBe(false);
    expect(userAgent.topLevelTraversableSet.has(other)).toBe(true);
    expect(otherSession.view.get('saved')).toBe('session');
    expect(other.storageShed.size).toBe(1);
    expect(localMap.get('saved')).toBe('local');
    expect(userAgent.storageShed.size).toBe(1);
    userAgent.removeTopLevelTraversable(retired);
    expect(otherSession.view.get('saved')).toBe('session');
  });

  it('does not clear a traversable owned by another user agent', () => {
    const owner = createManualUserAgent();
    const otherUserAgent = createManualUserAgent();
    const traversable = TopLevelTraversable.create(owner, null, '');
    const session = putSession(traversable.storageShed, 'https://first.test/');

    otherUserAgent.removeTopLevelTraversable(traversable);

    expect(owner.topLevelTraversableSet.has(traversable)).toBe(true);
    expect(session.view.get('saved')).toBe('session');
    expect(traversable.storageShed.size).toBe(1);
  });
});

function putSession(shed: StorageShed, url: string) {
  const shelf = StorageShelf.create('session');
  const bottle = shelf.bucketMap.get('default')!.bottleMap.get('sessionStorage')!;
  bottle.map.set('saved', 'session');
  const view = new StorageProxyMap(bottle, shelf);
  bottle.proxyMapReferenceSet.add(view);
  shed.set(keyFor(url), shelf);
  return { shelf, view };
}

function keyFor(url: string): StorageKey {
  return new StorageKey(obtainURLOrigin(parseURL(url).url!));
}
