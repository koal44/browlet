import { describe, expect, it } from 'vitest';
import { createTestDocument } from '../../support/dom';

import {
  BrowsingContext,
} from '../../../src/browlet/browsing/browsing-context';
import {
  createWindowEnvironment, unwrap, project,
  getBindingContext, getRelevantRealm,
} from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import type { Window } from '../../../src/browlet/platform';
import { createAndInitializeDocument } from '../../../src/browlet/browsing/document-lifecycle';
import { NavigationParams } from '../../../src/browlet/browsing/navigation/params';
import { Realm, WindowRealm } from '../../../src/browlet/scripting/realm';
import {
  obtainSimilarOriginWindowAgent, WindowAgent,
} from '../../../src/browlet/scripting/agents';
import { EnvironmentRecord } from '../../../src/browlet/scripting/environment';
import { Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import {
  createDocumentState, createSessionHistoryEntry,
} from '../../../src/browlet/browsing/navigation/session-history';
import { UserAgent } from '../../../src/browlet/user-agent';
import { monotonicClock } from '../../../src/browlet/performance/clock';
import { WindowProxyHandle } from '../../../src/browlet/browsing/window/window-proxy';
import { WindowImpl } from '../../../src/browlet/browsing/window/window';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { InternalError } from '../../../src/infra/internal-error';
import { FetchBody } from '../../../src/fetch/body';
import { FetchController } from '../../../src/fetch/controller';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { FetchTimingInfo } from '../../../src/fetch/timing';
import { ReadableStreamImpl } from '../../../src/streams/readable-stream';
import { createOpaqueOrigin } from '../../../src/url/origin';
import {
  obtainURLOrigin, parseURL, serializeURL, type URLRecord,
} from '../../../src/url/url';
import type { StampedPlatformObject } from '../../../src/web-idl/index';
import { itPassesWith } from '../../test-runtime';

describe('browsing context groups', () => {
  it('keeps the user-agent and browsing-context associations reciprocal', () => {
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    const context = new BrowsingContext();

    group.append(context);

    expect(userAgent.browsingContextGroupSet).toEqual(new Set([group]));
    expect(group.browsingContextSet).toEqual(new Set([context]));
    expect(context.group).toBe(group);

    group.remove(context);

    expect(context.group).toBeNull();
    expect(group.browsingContextSet).toEqual(new Set());
    expect(userAgent.browsingContextGroupSet).toEqual(new Set());
  });

  it('starts a browsing context with HTML\'s scalar defaults', () => {
    const context = new BrowsingContext(WindowProxyHandle.getOrCreate());

    expect(() => context.windowProxy.associatedWindow).toThrow(InternalError);
    expect(context.openerBrowsingContext).toBeNull();
    expect(context.openerOriginAtCreation).toBeNull();
    expect(context.isPopup).toBe(false);
    expect(context.isAuxiliary).toBe(false);
    expect(context.initialURL).toBeNull();
    expect(context.virtualBrowsingContextGroupID).toBe(0);
    expect(context.navigable).toBeNull();

    const document = createTestDocument();
    const env = document.env;
    const window = unwrap<WindowImpl>(env.global);
    const platform = project(window) as StampedPlatformObject<Window>;
    window.setAssociatedDocument(document);
    context.windowProxy.setAssociatedWindow({ implementation: window, platform });

    expect(context.activeWindow).toBe(window);
    expect(context.activeDocument).toBe(document);
    expect(Reflect.get(context.windowProxy.platform, 'addEventListener'))
      .toBe(Reflect.get(platform, 'addEventListener'));
  });

  it.each(['activeWindow', 'activeDocument'] as const)(
    'rejects %s access before the WindowProxy has a Window', (property) => {
      const context = new BrowsingContext(WindowProxyHandle.getOrCreate());

      expect(() => context[property]).toThrow(InternalError);
    },
  );

  it('gives a Window realm its Window and WindowProxy identities', () => {
    const agent = new WindowAgent();
    const creationURL = requireURL('about:blank');
    const origin = createOpaqueOrigin();
    const env = createWindowEnvironment({
      agent, userAgent: new UserAgent(), creationURL, origin, parent: null,
      topLevelCreationURL: creationURL, topLevelOrigin: origin,
    });
    const { window, realm } = env;
    const context = new BrowsingContext(realm.windowProxy);

    expect(realm).toBeInstanceOf(WindowRealm);
    expect(realm.agent).toBe(agent);
    expect(realm.windowImplementation).toBe(window);
    expect(realm.globalObject).toBe(project(window));
    expect(realm.globalThis).toBe(context.windowProxy.platform);
    expect(Reflect.get(realm.globalObject, 'Object')).toBe(realm.intrinsics.object);
    expect(Reflect.get(realm.globalObject, 'globalThis')).toBe(context.windowProxy.platform);
    expect(agent.windowObjects).toEqual(new Set([window]));
  });

  it('rejects reassignment of a Window realm\'s Window implementation', () => {
    const realm = getRelevantRealm(new Browlet({ route: () => '' }).window);
    const window = realm.windowImplementation;
    const replacement = new WindowImpl(new URL('about:blank'), realm.env);

    expect(() => { realm.windowImplementation = replacement; })
      .toThrow('Realm Window implementation is already initialized');
    expect(() => { realm.windowImplementation = window; })
      .toThrow('Realm Window implementation is already initialized');
    expect(realm.windowImplementation).toBe(window);
    expect(realm.globalObject).toBe(project(window));
  });

  it('rejects reassignment of a Window realm\'s WindowProxy handle', () => {
    const realm = getRelevantRealm(new Browlet({ route: () => '' }).window);
    const proxy = realm.windowProxy;

    expect(() => { realm.windowProxy = WindowProxyHandle.getOrCreate(); })
      .toThrow('Realm WindowProxy is already initialized');
    expect(() => { realm.windowProxy = proxy; })
      .toThrow('Realm WindowProxy is already initialized');
    expect(realm.windowProxy).toBe(proxy);
    expect(realm.globalThis).toBe(proxy.platform);
  });

  it('creates a Window realm from its early record before attaching settings or Window', () => {
    const creationURL = requireURL('about:blank');
    const origin = createOpaqueOrigin();
    const realm = new WindowRealm({
      agent: new WindowAgent(),
      envRecord: new EnvironmentRecord({
        userAgent: new UserAgent(), creationURL,
        topLevelCreationURL: creationURL, topLevelOrigin: origin,
        targetBrowsingContext: null, isSecureContext: false,
      }),
    });

    expect(realm.envRecord?.creationURL).toBe(creationURL);
    expect(realm.windowImplementation).toBeUndefined();
    expect(realm.hostDefined).toBeUndefined();
    expect(() => realm.env).toThrow('Realm has no environment');
  });

  it('rejects required environment access before attachment', () => {
    const realm = new Realm();

    expect(realm.hostDefined).toBeUndefined();
    expect(() => realm.env).toThrow('Realm has no environment');
  });

  it('finds the relevant realm before its environment is attached', () => {
    const realm = new Realm();
    const object = realm.evaluate('({})', 'unattached-object.js') as object;

    expect(Realm.getAssociatedRealm(object)).toBe(realm);
    expect(getRelevantRealm(object)).toBe(realm);
    expect(() => getRelevantRealm(object).env).toThrow('Realm has no environment');
  });

  it('hides SharedArrayBuffer in a non-isolated Window realm', () => {
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    const origin = createOpaqueOrigin();
    const agent = obtainSimilarOriginWindowAgent(origin, group, false);
    const creationURL = requireURL('about:blank');
    const env = createWindowEnvironment({
      agent, userAgent, creationURL, origin, parent: null,
      topLevelCreationURL: creationURL, topLevelOrigin: origin,
    });
    const { window, realm } = env;
    window.setAssociatedDocument(createTestDocument(env));

    expect(Reflect.has(realm.globalObject, 'SharedArrayBuffer')).toBe(false);
    expect(realm.intrinsics.bufferSource.sharedArrayBuffer)
      .toBeTypeOf('function');
  });

  itPassesWith('explicitQueues')('uses the WindowProxy as the VM realm\'s actual global this', () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.document);

    expect(realm.evaluate('this', 'global-this.js')).toBe(browlet.window);
  });

  itPassesWith('explicitQueues')('makes the Window realm global prototype immutable', () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.document);

    expect(realm.evaluate(
      'Reflect.setPrototypeOf(this, Object.getPrototypeOf(this))',
      'same-global-prototype.js',
    )).toBe(true);
    expect(realm.evaluate(
      'Reflect.setPrototypeOf(this, {})',
      'different-global-prototype.js',
    )).toBe(false);
  });
});

describe('navigables', () => {
  it('constructs one pending current and active history entry', () => {
    const document = createTestDocument();
    document.browsingContext = new BrowsingContext();
    document.url = requireURL('https://example.test/page');
    const documentState = createDocumentState(document);
    const activity: boolean[] = [];
    document.observeFullyActiveState((active) => { activity.push(active); });
    const traversable = new TopLevelTraversable(documentState);

    expect(traversable.parent).toBeNull();
    expect(traversable.currentSessionHistoryEntry)
      .toBe(traversable.activeSessionHistoryEntry);
    expect(traversable.activeSessionHistoryEntry.step).toBe('pending');
    expect(traversable.activeSessionHistoryEntry.documentState)
      .toBe(documentState);
    expect(serializeURL(traversable.activeSessionHistoryEntry.url))
      .toBe(document.URL);
    expect(traversable.activeSessionHistoryEntry.url).toBe(document.url);
    expect(traversable.activeDocument).toBe(document);
    expect(activity).toEqual([true]);
  });

  it('derives node-navigable and fully-active status from the active entry', () => {
    const traversable = TopLevelTraversable.create(
      new UserAgent(),
      null,
      '',
    );
    const firstDocument = traversable.activeDocument;
    const browsingContext = traversable.activeBrowsingContext;
    if (firstDocument === null || browsingContext === null) {
      throw new Error('Expected a complete initial navigable');
    }
    const secondDocument = createTestDocument(firstDocument.env);
    secondDocument.browsingContext = browsingContext;

    expect(firstDocument.getNodeNavigable()).toBe(traversable);
    expect(firstDocument.isFullyActive()).toBe(true);
    expect(secondDocument.getNodeNavigable()).toBeNull();
    expect(secondDocument.isFullyActive()).toBe(false);

    traversable.activeSessionHistoryEntry = createSessionHistoryEntry(
      createDocumentState(secondDocument),
    );

    expect(firstDocument.getNodeNavigable()).toBeNull();
    expect(firstDocument.isFullyActive()).toBe(false);
    expect(secondDocument.getNodeNavigable()).toBe(traversable);
    expect(secondDocument.isFullyActive()).toBe(true);
  });

  it('allows an active history entry whose Document is absent', () => {
    const document = createTestDocument();
    document.browsingContext = new BrowsingContext();
    const traversable = new TopLevelTraversable(createDocumentState(document));
    const initialEntry = traversable.activeSessionHistoryEntry;
    const activity: boolean[] = [];
    document.observeFullyActiveState((active) => { activity.push(active); });

    traversable.activeSessionHistoryEntry = {
      ...initialEntry, documentState: createDocumentState(null),
    };

    expect(traversable.activeDocument).toBeNull();
    expect(traversable.activeBrowsingContext).toBeNull();
    expect(traversable.activeWindow).toBeNull();
    expect(document.isFullyActive()).toBe(false);

    traversable.activeSessionHistoryEntry = initialEntry;

    expect(traversable.activeDocument).toBe(document);
    expect(document.isFullyActive()).toBe(true);
    expect(activity).toEqual([false, true]);
  });

  it('does not mistake a parent association for a container Document', () => {
    const parent = TopLevelTraversable.create(
      new UserAgent(),
      null,
      '',
    );
    const parentDocument = parent.activeDocument;
    if (parentDocument === null) {
      throw new Error('Expected a complete parent navigable');
    }
    const childDocument = createTestDocument();
    const childContext = new BrowsingContext();
    childDocument.browsingContext = childContext;
    const child = new Navigable(createDocumentState(childDocument), parent);

    expect(childDocument.getNodeNavigable()).toBe(child);
    expect(parentDocument.isFullyActive()).toBe(true);
    expect(childDocument.isFullyActive()).toBe(false);
  });

  it('creates the complete initial top-level about:blank graph', () => {
    const userAgent = new UserAgent();

    const traversable = TopLevelTraversable.create(
      userAgent,
      null,
      '',
    );
    const document = traversable.activeDocument;
    const browsingContext = traversable.activeBrowsingContext;
    const window = traversable.activeWindow;
    if (document === null || browsingContext === null || window === null) {
      throw new Error('Expected a complete initial browsing context graph');
    }
    const realm = getRelevantRealm(document);
    const env = realm.env;

    expect(env.userAgent).toBe(userAgent);
    expect(userAgent.topLevelTraversableSet).toEqual(new Set([traversable]));
    expect(userAgent.browsingContextGroupSet)
      .toEqual(new Set([browsingContext.group]));
    expect(browsingContext.group?.browsingContextSet)
      .toEqual(new Set([browsingContext]));
    expect(browsingContext.navigable).toBe(traversable);
    expect(browsingContext.popupSandboxingFlagSet.size).toBe(0);
    expect(browsingContext.activeDocument).toBe(document);
    expect(browsingContext.activeWindow).toBe(window);
    expect(browsingContext.windowProxy.associatedWindow.implementation).toBe(window);

    expect(realm.windowImplementation).toBe(window);
    expect(unwrap(realm.globalObject)).toBe(window);
    expect(realm.globalThis).toBe(browsingContext.windowProxy.platform);
    expect(realm.agent.agentCluster).not.toBeNull();
    expect(window.getAssociatedDocument()).toBe(document);

    expect(document.type).toBe('html');
    expect(document.mode).toBe('quirks');
    expect(document.contentType).toBe('text/html');
    expect(document.URL).toBe('about:blank');
    expect(document.origin.kind).toBe('opaque');
    expect(document.browsingContext).toBe(browsingContext);
    expect(document.activeSandboxingFlagSet.size).toBe(0);
    expect(document.aboutBaseURL).toBeNull();
    expect(document.isInitialAboutBlank).toBe(true);
    expect(document.allowDeclarativeShadowRoots).toBe(true);
    expect(document.customElementRegistry).not.toBeNull();
    expect(document.internalAncestorOriginObjectsList)
      .toEqual([]);
    expect(document.ancestorOriginsList).toEqual([]);
    expect(document.readyForPostLoadTasks).toBe(true);
    expect(document.readyState).toBe('complete');
    expect(document.completelyLoadedTime).not.toBeNull();
    expect(document.documentElement?.localName).toBe('html');
    expect(document.head?.localName).toBe('head');
    expect(document.body?.localName).toBe('body');

    expect(env.executionReady).toBe(true);
    expect(serializeURL(env.creationURL)).toBe('about:blank');
    expect(serializeURL(env.topLevelCreationURL!)).toBe('about:blank');
    expect(env.topLevelOrigin).toBe(document.origin);
    expect(env.timeOrigin.clock).toBe(monotonicClock);
    expect(env.timeOrigin.milliseconds)
      .toBe(document.loadTimingInfo.navigationStartTime);

    const initialEntry = traversable.activeSessionHistoryEntry;
    expect(traversable.currentSessionHistoryEntry).toBe(initialEntry);
    expect(initialEntry.step).toBe(0);
    expect(traversable.sessionHistoryEntries).toEqual([initialEntry]);
    expect(initialEntry.documentState.document).toBe(document);
    expect(initialEntry.documentState.initiatorOrigin).toBeNull();
    expect(initialEntry.documentState.origin)
      .toBe(document.origin);
    expect(initialEntry.documentState.navigableTargetName).toBe('');
    expect(initialEntry.documentState.aboutBaseURL).toBeNull();
  });
});

describe('environment settings objects', () => {
  it('uses its realm agent\'s event loop and becomes execution ready', () => {
    const creationURL = requireURL('https://example.test/');
    const origin = obtainURLOrigin(creationURL);
    const agent = new WindowAgent();
    const env = createWindowEnvironment({
      agent, userAgent: new UserAgent(), creationURL, origin, parent: null,
      topLevelCreationURL: creationURL, topLevelOrigin: origin,
    });

    expect(env.responsibleEventLoop).toBe(agent.eventLoop);
    expect(env.executionReady).toBe(false);

    env.markExecutionReady();

    expect(env.executionReady).toBe(true);
  });

  it('transfers a reserved environment into Window settings with the same user agent', () => {
    const creationURL = requireURL('https://example.test/');
    const origin = obtainURLOrigin(creationURL);
    const userAgent = new UserAgent();
    const reservedURL = requireURL('https://reserved.test/');
    const reservedEnv = new EnvironmentRecord({
      userAgent, creationURL: reservedURL, topLevelCreationURL: reservedURL, topLevelOrigin: obtainURLOrigin(reservedURL),
      targetBrowsingContext: new BrowsingContext(), activeServiceWorker: {}, isSecureContext: true,
    });
    const reservedId = reservedEnv.id;
    expect(reservedEnv.userAgent).toBe(userAgent);
    const env = createWindowEnvironment({
      agent: new WindowAgent(), userAgent, creationURL, origin, parent: null, reservedEnv,
      topLevelCreationURL: creationURL, topLevelOrigin: origin,
    });
    const { realm, window } = env;
    const bindingEnv = getBindingContext(realm).getEnvironment();
    const document = createTestDocument(env);
    document.origin = origin;
    document.url = creationURL;
    window.setAssociatedDocument(document);

    expect(env.userAgent).toBe(userAgent);
    expect(env.id).toBe(reservedId);
    expect(reservedEnv.id).toBe('');
    expect(env.targetBrowsingContext).toBe(reservedEnv.targetBrowsingContext);
    expect(env.activeServiceWorker).toBe(reservedEnv.activeServiceWorker);
    expect(env.creationURL).toBe(creationURL);
    expect(env.topLevelCreationURL).toBe(creationURL);
    expect(env.topLevelOrigin).toBe(origin);
    expect(reservedEnv.creationURL).toBe(reservedURL);
    expect(env.executionReady).toBe(false);
    expect(reservedEnv.executionReady).toBe(false);
    expect(bindingEnv).toBe(env);
    expect(env.exec.global).toBe(env.global);
    expect(realm.hostDefined).toBe(env);
    expect(realm.envRecord).toBe(env);
    expect(realm.secureContext).toBe(true);
    expect(env.isSecureContext).toBe(true);
    expect(env.moduleMap).toBe(document.moduleMap);
    expect(env.policyContainer)
      .toBe(document.policyContainer);
    expect(env.timeOrigin.clock).toBe(monotonicClock);
    expect(env.timeOrigin.milliseconds).toBe(0);
    expect(serializeURL(env.apiBaseURL)).toBe('https://example.test/');
    expect(env.crossOriginIsolatedCapability).toBe(false);
    // The Document is not active in a navigable yet, so it cannot establish a cookie site.
    expect(env.hasCrossSiteAncestor).toBe(true);
  });
});

describe('navigation response inputs', () => {
  it.each(['same-origin', 'same-site', 'cross-site'] as const)(
    'uses a Fetch request and a response with %s redirect taint', (redirectTaint) => {
      const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
      const env = getRelevantRealm(traversable.activeWindow!).env;
      const url = requireURL('https://example.test/page');
      const request = new FetchRequest(url, env, env.userAgent);
      request.referrer = requireURL('https://referrer.test/');
      const response = new FetchResponse();
      response.urlList.push(url);
      response.redirectTaint = redirectTaint;
      const params = NavigationParams.fromResponse(traversable, response);
      params.request = request;

      const document = createAndInitializeDocument('html', 'text/html', params);

      expect(document.url).toBe(request.currentURL);
      expect(document.url).toEqual(url);
      expect(document.referrer).toBe('https://referrer.test/');
      expect(document.wasCreatedViaCrossOriginRedirects).toBe(redirectTaint !== 'same-origin');
      expect(document.loadTimingInfo.navigationStartTime).toBe(params.startTime);
    },
  );

  it('takes navigation start from the Fetch controller, where Fetch retains full timing', () => {
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    const response = new FetchResponse();
    response.urlList.push(requireURL('https://example.test/page'));
    const params = NavigationParams.fromResponse(traversable, response);
    const controller = new FetchController();
    const timing = new FetchTimingInfo();
    timing.startTime = 42;
    controller.fullTimingInfo = timing;
    params.fetchController = controller;

    expect(params.startTime).toBe(42);
  });

  it('keeps a network body out of the session history source-text slot', () => {
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    const env = getRelevantRealm(traversable.activeWindow!).env;
    const response = new FetchResponse();
    response.urlList.push(requireURL('https://example.test/page'));
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
    response.body = new FetchBody(stream, env);
    const params = NavigationParams.fromResponse(traversable, response);
    const document = createAndInitializeDocument('html', 'text/html', params);

    expect(params.createHistoryEntry(document).documentState.resource).toBeNull();
    expect(response.body.stream).toBe(stream);
    expect(stream.disturbed).toBe(false);
    expect(stream.locked).toBe(false);
  });
});

describe('navigation lifecycle', () => {
  itPassesWith('explicitQueues')('preserves native Window identity and immutability across navigation', async () => {
    const browlet = new Browlet({ route: () => '' });
    const proxy = browlet.window;
    const firstRealm = getRelevantRealm(browlet.document);
    const firstDocument = browlet.document;
    const oldState = firstRealm.evaluate(`
      var pageState = 1;
      () => [++pageState, document, globalThis];
    `, 'old-window.js') as () => [number, Document, object];

    expect(firstRealm.evaluate('this === window && window === globalThis', 'identity.js'))
      .toBe(true);
    await browlet.navigate('https://example.test/');
    const nextRealm = getRelevantRealm(browlet.document);
    expect(browlet.window).toBe(proxy);
    expect(nextRealm).not.toBe(firstRealm);
    expect(nextRealm.globalObject).not.toBe(firstRealm.globalObject);
    expect(Object.getPrototypeOf(nextRealm.windowImplementation))
      .toBe(WindowImpl.prototype);
    expect(oldState()).toEqual([2, firstDocument, proxy]);
    expect(nextRealm.evaluate(`
      this === window && window === globalThis &&
      typeof pageState === 'undefined' &&
      !Reflect.setPrototypeOf(this, {}) &&
      !Reflect.setPrototypeOf(Window.prototype, {})
    `, 'new-window.js')).toBe(true);
  });

  it('exposes the browsing context WindowProxy as Document.defaultView', async () => {
    const browlet = new Browlet({ route: () => '' });
    const windowProxy = browlet.window;
    const Document_ = windowProxy.Document;

    expect(new Document_().defaultView).toBeNull();
    expect(browlet.document.defaultView).toBe(windowProxy);

    await browlet.navigate('https://example.test/');

    expect(browlet.document.defaultView).toBe(windowProxy);
  });

  it('keeps the WindowProxy while replacing the Window and realm', async () => {
    const browlet = new Browlet({ route: () => '' });
    const windowProxy = browlet.window;
    const initialDocument = browlet.document;
    const initialDocumentImpl = unwrap<DocumentImpl>(
      initialDocument,
    );
    const navigable = initialDocumentImpl.getNodeNavigable();
    if (navigable === null) {
      throw new Error('Initial Document has no node navigable');
    }
    const initialRealm = getRelevantRealm(initialDocument);
    const handle = initialRealm.windowProxy;
    const initialWindow = handle.associatedWindow.implementation;
    const InitialEvent = Reflect.get(windowProxy, 'Event') as unknown;

    await browlet.navigate('https://example.test/');

    const document = browlet.document;
    const documentImpl = unwrap<DocumentImpl>(
      document,
    );
    const window = handle.associatedWindow.implementation;
    const realm = getRelevantRealm(document);
    expect(browlet.window).toBe(windowProxy);
    expect(document).not.toBe(initialDocument);
    expect(window === initialWindow).toBe(false);
    expect(realm).not.toBe(initialRealm);
    expect(initialRealm.windowImplementation).toBe(initialWindow);
    expect(initialRealm.windowProxy).toBe(handle);
    expect(initialRealm.getAssociatedDocument()).toBe(initialDocumentImpl);
    expect(realm.windowProxy).toBe(handle);
    expect(realm.env.userAgent).toBe(initialRealm.env.userAgent);
    expect(realm.windowImplementation).toBe(window);
    expect(unwrap(realm.globalObject)).toBe(window);
    expect(realm.globalThis).toBe(windowProxy);
    expect(Reflect.get(windowProxy, 'Event')).not.toBe(InitialEvent);
    expect(window.getAssociatedDocument()).toBe(documentImpl);
    expect(documentImpl.browsingContext?.windowProxy)
      .toBe(handle);
    expect(initialDocumentImpl.getNodeNavigable()).toBeNull();
    expect(initialDocumentImpl.isFullyActive()).toBe(false);
    expect(documentImpl.getNodeNavigable()).toBe(navigable);
    expect(documentImpl.isFullyActive()).toBe(true);
  });

  it('retains local source text for history while parsing it directly', async () => {
    const source = '<p>Local page</p>';
    const browlet = new Browlet({ route: () => source });

    await browlet.navigate('https://example.test/');

    const document = unwrap<DocumentImpl>(browlet.document);
    const entry = document.getNodeNavigable()!.activeSessionHistoryEntry;
    expect(entry.documentState.resource).toBe(source);
    const text = document.body!.firstChild!.firstChild;
    expect(text?.isText()).toBe(true);
    if (!text?.isText()) throw new Error('Expected the paragraph text');
    expect(text.data).toBe('Local page');
  });
});

function requireURL(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new Error(`Could not parse ${input}`);
  return url;
}
