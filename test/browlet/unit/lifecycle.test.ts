import { describe, expect, it } from 'vitest';

import { BrowsingContext } from '../../../src/browlet/browsing-context';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import {
  obtainSimilarOriginWindowAgent, WindowAgent,
} from '../../../src/browlet/agents';
import {
  EnvironmentSettingsObject, setupWindowEnvironmentSettingsObject,
} from '../../../src/browlet/environment';
import {
  createNewTopLevelTraversable, initializeNavigable, TopLevelTraversable,
} from '../../../src/browlet/navigable';
import { createRealm, Realm } from '../../../src/browlet/realm';
import { createDocumentState } from '../../../src/browlet/session-history';
import { UserAgent } from '../../../src/browlet/user-agent';
import {
  getWindowProxyWindow, setWindowProxyWindow,
} from '../../../src/browlet/window-proxy';
import { WindowImpl } from '../../../src/browlet/window';
import {
  DocumentImpl, type DomletDocument, type ModuleMap, type PolicyContainer,
} from '../../../src/domlet/nodes/document';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { parseURL, serializeURL, type URLRecord } from '../../../src/url/url';

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
    const context = new BrowsingContext();

    expect(getWindowProxyWindow(context.windowProxy)).toBeNull();
    expect(context.openerBrowsingContext).toBeNull();
    expect(context.openerOriginAtCreation).toBeNull();
    expect(context.isPopup).toBe(false);
    expect(context.isAuxiliary).toBe(false);
    expect(context.initialURL).toBeNull();
    expect(context.virtualBrowsingContextGroupID).toBe(0);
    expect(context.activeWindow).toBeNull();
    expect(context.activeDocument).toBeNull();

    const document = new DocumentImpl() as DomletDocument;
    const window = new WindowImpl(new URL('about:blank'));
    WindowImpl.setAssociatedDocument(window, document);
    setWindowProxyWindow(context.windowProxy, window, window);

    expect(context.activeWindow).toBe(window);
    expect(context.activeDocument).toBe(document);
    expect(Reflect.get(context.windowProxy, 'addEventListener'))
      .toBe(Reflect.get(context.windowProxy, 'addEventListener'));
  });

  it('gives a Window realm its Window and WindowProxy identities', () => {
    const context = new BrowsingContext();
    const agent = new WindowAgent();
    const window = new WindowImpl(new URL('about:blank'));
    const executionContext = createRealm(agent, {
      createGlobalObject: () => window,
      createGlobalThisValue: () => context.windowProxy,
    });

    expect(executionContext.realm.agent).toBe(agent);
    expect(executionContext.realm.globalObject).toBe(window);
    expect(executionContext.realm.globalThis).toBe(context.windowProxy);
    expect(Reflect.get(window, 'Object'))
      .toBe(executionContext.realm.intrinsics.object);
    expect(Reflect.get(window, 'globalThis')).toBe(context.windowProxy);
    expect(agent.windowObjects).toEqual(new Set([window]));
  });

  it('hides SharedArrayBuffer in a non-isolated Window realm', () => {
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    const origin = createOpaqueOrigin();
    const agent = obtainSimilarOriginWindowAgent(origin, group, false);
    const context = new BrowsingContext();
    const window = new WindowImpl(new URL('about:blank'));
    const executionContext = createRealm(agent, {
      createGlobalObject: () => window,
      createGlobalThisValue: () => context.windowProxy,
    });

    expect(Reflect.has(window, 'SharedArrayBuffer')).toBe(false);
    expect(executionContext.realm.intrinsics.bufferSource.sharedArrayBuffer)
      .toBeTypeOf('function');
  });

  it.fails('uses the WindowProxy as the VM realm\'s actual global this', () => {
    const context = new BrowsingContext();
    const executionContext = createRealm(new WindowAgent(), {
      createGlobalObject: () => new WindowImpl(new URL('about:blank')),
      createGlobalThisValue: () => context.windowProxy,
    });

    expect(executionContext.realm.evaluate('this', 'global-this.js'))
      .toBe(context.windowProxy);
  });
});

describe('navigables', () => {
  it('initializes one pending current and active history entry', () => {
    const document = new DocumentImpl() as DomletDocument;
    DocumentImpl.setURL(document, requireURL('https://example.test/page'));
    const documentState = createDocumentState(document);
    const traversable = new TopLevelTraversable();

    initializeNavigable(traversable, documentState);

    expect(traversable.parent).toBeNull();
    expect(traversable.currentSessionHistoryEntry)
      .toBe(traversable.activeSessionHistoryEntry);
    expect(traversable.activeSessionHistoryEntry.step).toBe('pending');
    expect(traversable.activeSessionHistoryEntry.documentState)
      .toBe(documentState);
    expect(serializeURL(traversable.activeSessionHistoryEntry.url))
      .toBe(document.URL);
    expect(traversable.activeDocument).toBe(document);
  });

  it('creates the complete initial top-level about:blank graph', () => {
    const userAgent = new UserAgent();

    const traversable = createNewTopLevelTraversable(
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
    const settings = realm.hostDefined;
    if (settings === null) throw new Error('Expected Window environment settings');

    expect(userAgent.topLevelTraversableSet).toEqual(new Set([traversable]));
    expect(userAgent.browsingContextGroupSet)
      .toEqual(new Set([browsingContext.group]));
    expect(browsingContext.group?.browsingContextSet)
      .toEqual(new Set([browsingContext]));
    expect(browsingContext.popupSandboxingFlagSet).toEqual(new Set());
    expect(browsingContext.activeDocument).toBe(document);
    expect(browsingContext.activeWindow).toBe(window);
    expect(getWindowProxyWindow(browsingContext.windowProxy)).toBe(window);

    expect(realm.globalObject).toBe(window);
    expect(realm.globalThis).toBe(browsingContext.windowProxy);
    expect(realm.agent.agentCluster).not.toBeNull();
    expect(WindowImpl.getAssociatedDocument(window)).toBe(document);

    expect(DocumentImpl.getType(document)).toBe('html');
    expect(DocumentImpl.getMode(document)).toBe('quirks');
    expect(document.contentType).toBe('text/html');
    expect(document.URL).toBe('about:blank');
    expect(DocumentImpl.getOrigin(document).kind).toBe('opaque');
    expect(DocumentImpl.getBrowsingContext(document)).toBe(browsingContext);
    expect(DocumentImpl.getActiveSandboxingFlagSet(document)).toEqual(new Set());
    expect(DocumentImpl.getAboutBaseURL(document)).toBeNull();
    expect(DocumentImpl.isInitialAboutBlank(document)).toBe(true);
    expect(DocumentImpl.allowsDeclarativeShadowRoots(document)).toBe(true);
    expect(DocumentImpl.getCustomElementRegistry(document)).not.toBeNull();
    expect(DocumentImpl.getInternalAncestorOriginObjectsList(document))
      .toEqual([]);
    expect(DocumentImpl.getAncestorOriginsList(document)).toEqual([]);
    expect(DocumentImpl.isReadyForPostLoadTasks(document)).toBe(true);
    expect(DocumentImpl.getCurrentDocumentReadiness(document)).toBe('complete');
    expect(DocumentImpl.getCompletelyLoadedTime(document)).not.toBeNull();
    expect(document.documentElement.localName).toBe('html');
    expect(document.head.localName).toBe('head');
    expect(document.body.localName).toBe('body');

    expect(settings.executionReady).toBe(true);
    expect(serializeURL(settings.creationURL)).toBe('about:blank');
    expect(serializeURL(settings.topLevelCreationURL!)).toBe('about:blank');
    expect(settings.topLevelOrigin).toBe(DocumentImpl.getOrigin(document));
    expect(settings.timeOrigin)
      .toBe(DocumentImpl.getLoadTimingInfo(document).navigationStartTime);

    const initialEntry = traversable.activeSessionHistoryEntry;
    expect(traversable.currentSessionHistoryEntry).toBe(initialEntry);
    expect(initialEntry.step).toBe(0);
    expect(traversable.sessionHistoryEntries).toEqual([initialEntry]);
    expect(initialEntry.documentState.document).toBe(document);
    expect(initialEntry.documentState.initiatorOrigin).toBeNull();
    expect(initialEntry.documentState.origin)
      .toBe(DocumentImpl.getOrigin(document));
    expect(initialEntry.documentState.navigableTargetName).toBe('');
    expect(initialEntry.documentState.aboutBaseURL).toBeNull();
  });
});

describe('environment settings objects', () => {
  it('uses its realm agent\'s event loop and becomes execution ready', () => {
    const creationURL = requireURL('https://example.test/');
    const realm = new Realm();
    const settings = new TestEnvironmentSettingsObject(realm, creationURL);

    expect(settings.responsibleEventLoop).toBe(realm.agent.eventLoop);
    expect(settings.executionReady).toBe(false);

    settings.markExecutionReady();

    expect(settings.executionReady).toBe(true);
  });

  it('associates Window settings with their realm execution context', () => {
    const creationURL = requireURL('https://example.test/');
    const origin = createOpaqueOrigin();
    const window = new WindowImpl(new URL('about:blank'));
    const executionContext = createRealm(new WindowAgent(), {
      createGlobalObject: () => window,
      createGlobalThisValue: () => new BrowsingContext().windowProxy,
    });

    const settings = setupWindowEnvironmentSettingsObject(
      creationURL,
      executionContext,
      null,
      creationURL,
      origin,
    );
    const document = new DocumentImpl() as DomletDocument;
    DocumentImpl.setOrigin(document, origin);
    DocumentImpl.setURL(document, creationURL);
    WindowImpl.setAssociatedDocument(window, document);

    expect(settings.realmExecutionContext).toBe(executionContext);
    expect(executionContext.realm.hostDefined).toBe(settings);
    expect(settings.moduleMap).toBe(DocumentImpl.getModuleMap(document));
    expect(settings.policyContainer)
      .toBe(DocumentImpl.getPolicyContainer(document));
    expect(settings.timeOrigin).toBe(0);
    expect(serializeURL(settings.apiBaseURL)).toBe('https://example.test/');
    expect(settings.crossOriginIsolatedCapability).toBe(false);
    expect(() => settings.hasCrossSiteAncestor)
      .toThrow('Window navigable ancestry is not implemented');
  });
});

describe('navigation lifecycle', () => {
  it('exposes the browsing context WindowProxy as Document.defaultView', async () => {
    const browlet = new Browlet({ route: () => '' });
    const windowProxy = browlet.window;
    const Document_ = Reflect.get(windowProxy, 'Document') as {
      new(): Document;
    };

    expect(new Document_().defaultView).toBeNull();
    expect(browlet.document.defaultView).toBe(windowProxy);

    await browlet.navigate('https://example.test/');

    expect(browlet.document.defaultView).toBe(windowProxy);
  });

  it('keeps the WindowProxy while replacing the Window and realm', async () => {
    const browlet = new Browlet({ route: () => '' });
    const windowProxy = browlet.window;
    const initialDocument = browlet.document;
    const initialWindow = getWindowProxyWindow(windowProxy);
    const initialRealm = getRelevantRealm(initialDocument);
    const InitialEvent = Reflect.get(windowProxy, 'Event') as unknown;

    await browlet.navigate('https://example.test/');

    const document = browlet.document;
    const window = getWindowProxyWindow(windowProxy);
    const realm = getRelevantRealm(document);
    expect(browlet.window).toBe(windowProxy);
    expect(document).not.toBe(initialDocument);
    expect(window === initialWindow).toBe(false);
    expect(realm).not.toBe(initialRealm);
    expect(realm.globalObject).toBe(window);
    expect(realm.globalThis).toBe(windowProxy);
    expect(Reflect.get(windowProxy, 'Event')).not.toBe(InitialEvent);
    expect(window && WindowImpl.getAssociatedDocument(window)).toBe(document);
    expect(DocumentImpl.getBrowsingContext(document)?.windowProxy)
      .toBe(windowProxy);
  });

  it('replaces initial history and pushes later navigation entries', async () => {
    const browlet = new Browlet({ route: () => '' });
    const traversable = Browlet.getTopLevelTraversable(browlet);
    const initialEntry = traversable.activeSessionHistoryEntry;

    await browlet.navigate('https://example.test/first');

    const firstEntry = traversable.activeSessionHistoryEntry;
    const firstRealm = getRelevantRealm(browlet.document);
    expect(firstEntry).not.toBe(initialEntry);
    expect(firstEntry.step).toBe(0);
    expect(traversable.currentSessionHistoryEntry).toBe(firstEntry);
    expect(traversable.currentSessionHistoryStep).toBe(0);
    expect(traversable.sessionHistoryEntries).toEqual([firstEntry]);

    await browlet.navigate('https://example.test/second');

    const secondEntry = traversable.activeSessionHistoryEntry;
    expect(secondEntry).not.toBe(firstEntry);
    expect(getRelevantRealm(browlet.document)).not.toBe(firstRealm);
    expect(secondEntry.step).toBe(1);
    expect(traversable.currentSessionHistoryEntry).toBe(secondEntry);
    expect(traversable.currentSessionHistoryStep).toBe(1);
    expect(traversable.sessionHistoryEntries).toEqual([
      firstEntry,
      secondEntry,
    ]);
  });
});

class TestEnvironmentSettingsObject extends EnvironmentSettingsObject {
  readonly #apiBaseURL: URLRecord;
  readonly #moduleMap: ModuleMap = { entries: [] };
  readonly #origin = createOpaqueOrigin();
  readonly #policyContainer: PolicyContainer = {
    cspList: [],
    embedderPolicy: {},
    referrerPolicy: 'strict-origin-when-cross-origin',
    integrityPolicy: {},
    reportOnlyIntegrityPolicy: {},
  };

  constructor(realm: Realm, creationURL: URLRecord) {
    super({
      creationURL,
      realmExecutionContext: { realm },
      targetBrowsingContext: null,
      topLevelCreationURL: creationURL,
      topLevelOrigin: null,
    });
    this.#apiBaseURL = creationURL;
  }

  get apiBaseURL(): URLRecord {
    return this.#apiBaseURL;
  }

  get crossOriginIsolatedCapability(): boolean {
    return false;
  }

  get moduleMap(): ModuleMap {
    return this.#moduleMap;
  }

  get hasCrossSiteAncestor(): boolean {
    return false;
  }

  get origin() {
    return this.#origin;
  }

  get policyContainer(): PolicyContainer {
    return this.#policyContainer;
  }

  get timeOrigin(): DOMHighResTimeStamp {
    return 0;
  }
}

function requireURL(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new Error(`Could not parse ${input}`);
  return url;
}
