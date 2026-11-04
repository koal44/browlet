import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { UserAgent } from '../../../src/browlet/user-agent';
import { createWindowEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import { StorageBottle } from '../../../src/storage/index';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';
import { createManualEventLoop } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Storage §4.6: browser bottle acquisition', () => {
  it('shares local data across agents and session data only within the selected traversable', () => {
    const userAgent = new UserAgent();
    const first = createEnvironment('https://example.test/', userAgent);
    const second = createEnvironment('https://example.test/', userAgent);
    const crossOrigin = createEnvironment('https://other.test/', userAgent, first.navigable);
    const descendant = createEnvironment('https://example.test/child', userAgent, crossOrigin.navigable);
    expect(second.env.realm.agent).not.toBe(first.env.realm.agent);
    expect(descendant.env.realm.agent).not.toBe(first.env.realm.agent);

    const local = StorageBottle.obtainLocalMap(first.env, 'localStorage')!;
    const session = StorageBottle.obtainSessionMap(first.env, 'sessionStorage')!;
    local.set('saved', 'browser');
    session.set('saved', 'first tab');

    expect(StorageBottle.obtainLocalMap(second.env, 'localStorage')!.get('saved')).toBe('browser');
    expect(StorageBottle.obtainLocalMap(descendant.env, 'localStorage')!.get('saved')).toBe('browser');
    expect(StorageBottle.obtainSessionMap(descendant.env, 'sessionStorage')!.get('saved')).toBe('first tab');
    expect(StorageBottle.obtainSessionMap(second.env, 'sessionStorage')!.size).toBe(0);
    expect(StorageBottle.obtainSessionMap(crossOrigin.env, 'sessionStorage')!.size).toBe(0);
    expect(StorageBottle.obtainLocalMap(crossOrigin.env, 'localStorage')!.size).toBe(0);
  });

  it('retains both backing maps across Document replacement without reusing proxy identity', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const initialEnv = getRelevantRealm(browser.window).env;
    const local = StorageBottle.obtainLocalMap(initialEnv, 'localStorage')!;
    const session = StorageBottle.obtainSessionMap(initialEnv, 'sessionStorage')!;
    local.set('saved', 'browser');
    session.set('saved', 'tab');

    await browser.navigate('https://example.test/second');
    const nextEnv = getRelevantRealm(browser.window).env;
    expect(nextEnv).not.toBe(initialEnv);
    const nextLocal = StorageBottle.obtainLocalMap(nextEnv, 'localStorage')!;
    const nextSession = StorageBottle.obtainSessionMap(nextEnv, 'sessionStorage')!;
    expect(nextLocal).not.toBe(local);
    expect(nextSession).not.toBe(session);
    expect(nextLocal.get('saved')).toBe('browser');
    expect(nextSession.get('saved')).toBe('tab');
    nextSession.set('saved', 'updated tab');
    expect(session.get('saved')).toBe('updated tab');

    await browser.navigate('https://other.test/');
    const otherEnv = getRelevantRealm(browser.window).env;
    expect(StorageBottle.obtainLocalMap(otherEnv, 'localStorage')!.size).toBe(0);
    expect(StorageBottle.obtainSessionMap(otherEnv, 'sessionStorage')!.size).toBe(0);
  });
});

// Compose real Window settings and navigables while automatic iframe creation is unfinished.
function createEnvironment(url: string, userAgent: UserAgent, parent: Navigable | null = null) {
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  const parentEnv = parent?.activeWindow?.env;
  const env = createWindowEnvironment({
    agent: new WindowAgent(createManualEventLoop()), userAgent, creationURL, origin,
    parent: parent?.activeWindow ?? null,
    topLevelCreationURL: parentEnv?.topLevelCreationURL ?? creationURL,
    topLevelOrigin: parentEnv?.topLevelOrigin ?? origin,
  });
  const document = env.createDocument();
  document.type = 'html';
  document.contentType = 'text/html';
  document.url = creationURL;
  document.origin = origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  document.makeActive();
  const state = createDocumentState(document);
  const navigable = parent === null ? new TopLevelTraversable(state) : new Navigable(state, parent);
  return { env, navigable };
}
