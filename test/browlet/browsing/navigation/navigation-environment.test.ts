import { describe, expect, it } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { BrowletEnvironmentBase } from '../../../../src/browlet/environment/index';
import { createWindowEnvironment } from '../../../../src/browlet/integration/web-idl/index';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { networkPartitionKeysEqual } from '../../../../src/fetch/transport';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualEventLoop } from '../../../support/browlet-agent';

describe('reserved navigation environments', () => {
  it('allocates a fresh top-level identity without a Window or realm', () => {
    const navigable = createNavigable('http://departing.test/');
    const previousEnv = navigable.activeDocument!.env;
    const currentURL = parseURL('https://incoming.test/page').url!;

    const first = BrowletEnvironmentBase.createForNavigation(navigable, currentURL);
    const second = BrowletEnvironmentBase.createForNavigation(navigable, currentURL);

    expect(first.id).not.toBe('');
    expect(first.id).not.toBe(previousEnv.id);
    expect(first.id).not.toBe(second.id);
    expect(first.userAgent).toBe(previousEnv.userAgent);
    expect(first.creationURL).toBe(currentURL);
    expect(first.topLevelCreationURL).toBe(currentURL);
    expect(first.topLevelOrigin).toBeNull();
    expect(first.targetBrowsingContext).toBe(navigable.activeBrowsingContext);
    expect(first.activeServiceWorker).toBeNull();
    expect(first.executionReady).toBe(false);
    expect(first.discarded).toBe(false);
    expect('realm' in first).toBe(false);
    expect('globalImplementation' in first).toBe(false);
    expect(navigable.activeDocument!.env).toBe(previousEnv);
    expect(networkPartitionKeysEqual(
      first.determineNetworkPartitionKey(), second.determineNetworkPartitionKey(),
    )).toBe(true);
    expect(networkPartitionKeysEqual(
      first.determineNetworkPartitionKey(), previousEnv.determineNetworkPartitionKey(),
    )).toBe(false);
  });

  it('inherits the parent environment\'s top-level metadata, not its current Document URL', () => {
    const top = createNavigable('https://top.test/original');
    const middle = createNavigable('https://middle.test/', top);
    const child = createNavigable('https://departing.test/', middle);
    middle.activeDocument!.setURL(parseURL('https://middle.test/later').url!);
    const currentURL = parseURL('https://incoming.test/').url!;

    const reserved = BrowletEnvironmentBase.createForNavigation(child, currentURL);
    const parentEnv = middle.activeDocument!.env;
    const topEnv = top.activeDocument!.env;

    expect(reserved.creationURL).toBe(currentURL);
    expect(reserved.topLevelCreationURL).toBe(parentEnv.topLevelCreationURL);
    expect(reserved.topLevelCreationURL).toBe(topEnv.topLevelCreationURL);
    expect(reserved.topLevelCreationURL).not.toBe(middle.activeDocument!.url);
    expect(reserved.topLevelOrigin).toBe(topEnv.topLevelOrigin);
    expect(reserved.targetBrowsingContext).toBe(child.activeBrowsingContext);
    expect(reserved.targetBrowsingContext).not.toBe(middle.activeBrowsingContext);
    expect(networkPartitionKeysEqual(
      reserved.determineNetworkPartitionKey(), topEnv.determineNetworkPartitionKey(),
    )).toBe(true);
  });

  it.each([
    { ancestors: [], url: 'https://incoming.test/', secure: true },
    { ancestors: [], url: 'http://incoming.test/', secure: false },
    { ancestors: [], url: 'http://localhost/', secure: true },
    { ancestors: [], url: 'data:text/html,hello', secure: false },
    { ancestors: ['https://top.test/'], url: 'https://incoming.test/', secure: true },
    { ancestors: ['https://top.test/'], url: 'http://incoming.test/', secure: false },
    { ancestors: ['http://top.test/'], url: 'https://incoming.test/', secure: false },
    { ancestors: ['https://top.test/', 'http://middle.test/'], url: 'https://incoming.test/', secure: false },
  ])('selects security for $url below $ancestors', ({ ancestors, url, secure }) => {
    let parent: Navigable | null = null;
    for (const ancestor of ancestors) parent = createNavigable(ancestor, parent);
    const navigable = createNavigable('http://departing.test/', parent);
    const reserved = BrowletEnvironmentBase.createForNavigation(navigable, parseURL(url).url!);
    expect(reserved.isSecureContext).toBe(secure);
  });

  it('retains the creation-time security decision when the parent changes later', () => {
    const parent = createNavigable('https://parent.test/');
    const child = createNavigable('https://child.test/', parent);
    const reserved = BrowletEnvironmentBase.createForNavigation(child, parseURL('https://incoming.test/').url!);
    const insecureParent = createNavigable('http://replacement.test/');

    child.parent = insecureParent;

    expect(reserved.isSecureContext).toBe(true);
    expect(BrowletEnvironmentBase.createForNavigation(child, reserved.creationURL).isSecureContext).toBe(false);
  });

  it('transfers the reserved identity and security decision when Window settings are created', () => {
    const navigable = createNavigable('http://departing.test/');
    const creationURL = parseURL('https://incoming.test/').url!;
    const reservedEnv = BrowletEnvironmentBase.createForNavigation(navigable, creationURL);
    const id = reservedEnv.id;
    const origin = obtainURLOrigin(creationURL);

    const env = createWindowEnvironment({
      agent: new WindowAgent(createManualEventLoop()), userAgent: reservedEnv.userAgent,
      creationURL, origin, parent: null, topLevelCreationURL: creationURL, topLevelOrigin: origin, reservedEnv,
    });

    expect(env.id).toBe(id);
    expect(reservedEnv.id).toBe('');
    expect(env.targetBrowsingContext).toBe(navigable.activeBrowsingContext);
    expect(env.isSecureContext).toBe(true);
    expect(env.executionReady).toBe(false);
    expect(env.realm.baseEnv).toBe(env);
    expect(networkPartitionKeysEqual(
      reservedEnv.determineNetworkPartitionKey(), env.determineNetworkPartitionKey(),
    )).toBe(true);
  });

  it('requires the active target Document instead of borrowing the source or a sandbox', () => {
    const navigable = createNavigable('https://departing.test/');
    navigable.activeSessionHistoryEntry.documentState.document = null;
    expect(() => BrowletEnvironmentBase.createForNavigation(navigable, parseURL('https://incoming.test/').url!))
      .toThrow('Navigation reservation requires an active Document');
  });
});

// Compose real settings and ancestry while Document/iframe loading remains unfinished.
function createNavigable(url: string, parent: Navigable | null = null): Navigable {
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  const parentEnv = parent?.activeDocument?.env;
  const env = createWindowEnvironment({
    agent: new WindowAgent(createManualEventLoop()), userAgent: parentEnv?.userAgent ?? new UserAgent(),
    creationURL, origin, parent: parent?.activeWindow ?? null,
    topLevelCreationURL: parentEnv?.topLevelCreationURL ?? creationURL,
    topLevelOrigin: parentEnv?.topLevelOrigin ?? origin,
  });
  const document = env.createDocument();
  document.setURL(creationURL);
  document.origin = origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  document.initializeAncestry('', parent?.activeDocument ?? null);
  env.window.setAssociatedDocument(document);
  document.makeActive();
  const state = DocumentState.create(document);
  return parent === null ? new TopLevelTraversable(state) : new Navigable(state, parent);
}
