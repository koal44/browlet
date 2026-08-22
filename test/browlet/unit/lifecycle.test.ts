import { describe, expect, it } from 'vitest';

import { BrowsingContext } from '../../../src/browlet/browsing-context';
import { Browlet } from '../../../src/browlet/browlet';
import {
  EnvironmentSettingsObject,
} from '../../../src/browlet/environment';
import {
  initializeNavigable, TopLevelTraversable,
} from '../../../src/browlet/navigable';
import { Realm } from '../../../src/browlet/realm';
import { createDocumentState } from '../../../src/browlet/session-history';
import { UserAgent } from '../../../src/browlet/user-agent';
import { WindowProxyController } from '../../../src/browlet/window-proxy';
import { WindowImpl } from '../../../src/browlet/window';
import {
  DocumentImpl, type DomletDocument,
} from '../../../src/domlet/nodes/document';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { parseURL, serializeURL, type URLRecord } from '../../../src/url/url';

describe('browsing context groups', () => {
  it('keeps the user-agent and browsing-context associations reciprocal', () => {
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    const context = new BrowsingContext(
      new WindowProxyController(new Realm()),
    );

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
    const windowProxy = new WindowProxyController(new Realm());
    const context = new BrowsingContext(windowProxy);

    expect(context.windowProxy).toBe(windowProxy.value);
    expect(context.openerBrowsingContext).toBeNull();
    expect(context.openerOriginAtCreation).toBeNull();
    expect(context.isPopup).toBe(false);
    expect(context.isAuxiliary).toBe(false);
    expect(context.initialURL).toBeNull();
    expect(context.virtualBrowsingContextGroupID).toBe(0);
    expect(context.activeWindow).toBeNull();
    expect(context.activeDocument).toBeNull();

    const document = new DocumentImpl() as DomletDocument;
    const window = new WindowImpl(document, new URL('about:blank'));
    windowProxy.setWindow(window);

    expect(context.activeWindow).toBe(window);
    expect(context.activeDocument).toBe(document);
  });
});

describe('navigables', () => {
  it('initializes one pending current and active history entry', () => {
    const document = new DocumentImpl({
      url: requireURL('https://example.test/page'),
    }) as DomletDocument;
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
});

describe('navigation lifecycle', () => {
  it.fails(
    'keeps the WindowProxy while replacing a cross-origin realm',
    async () => {
      const browlet = new Browlet({ route: () => '' });
      const windowProxy = browlet.window;
      const InitialEvent = Reflect.get(windowProxy, 'Event') as unknown;

      await browlet.navigate('https://example.test/');

      expect(browlet.window).toBe(windowProxy);
      expect(Reflect.get(browlet.window, 'Event')).not.toBe(InitialEvent);
    },
  );
});

class TestEnvironmentSettingsObject extends EnvironmentSettingsObject {
  readonly #apiBaseURL: URLRecord;
  readonly #origin = createOpaqueOrigin();

  constructor(realm: Realm, creationURL: URLRecord) {
    super({
      creationURL,
      realmExecutionContext: realm,
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

  get hasCrossSiteAncestor(): boolean {
    return false;
  }

  get origin() {
    return this.#origin;
  }

  get policyContainer(): object | null {
    return null;
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
