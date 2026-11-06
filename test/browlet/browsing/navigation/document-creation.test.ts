import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import { ContentSecurityPolicy, CSPList } from '../../../../src/browlet/browsing/policy/csp/index';
import { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { BrowletEnvironmentBase } from '../../../../src/browlet/environment/index';
import type { Document, DOMStringList } from '../../../../src/browlet/platform';
import { FetchController, FetchRequest, FetchResponse, type ServiceWorkerTimingInfo } from '../../../../src/fetch/index';
import { FetchTimingInfo } from '../../../../src/fetch/timing';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document creation Window selection', () => {
  it('retains deliberately null reservation and supplied policies for a new Window', () => {
    const top = fixture();
    const params = suppliedParams();
    const policy = params.policyContainer;
    policy.referrerPolicy = 'no-referrer';
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(params.reservedEnv).toBeNull();
    expect(document.env.targetBrowsingContext).toBeNull();
    expect(document.policyContainer).toBe(policy);
    expect(document.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(document.env.creationURL).toBe(params.url);
    expect(document.env.topLevelCreationURL).toBe(params.url);
    expect(document.browsingContext).toBe(top.activeBrowsingContext);
    expect(document.env).not.toBe(top.activeDocument!.env);
  });

  it('uses the request URL for new top-level settings when a request is supplied', () => {
    const top = fixture();
    const params = suppliedParams();
    const url = parseURL('https://incoming.test/request#fragment').url!;
    const request = new FetchRequest(url, top.activeDocument!.env);
    request.referrer = null;
    params.request = request;
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(document.url).toBe(request.currentURL);
    expect(document.url).toEqual(url);
    expect(document.env.creationURL).toBe(request.currentURL);
    expect(document.env.topLevelCreationURL).toBe(request.currentURL);
    expect(document.env.topLevelOrigin).toBe(params.origin);
  });

  it('transfers an existing reservation without replacing its identity or security decision', () => {
    const top = fixture();
    const params = suppliedParams();
    params.reservedEnv = reserve(top, params, true);
    const reserved = params.reservedEnv;
    const id = reserved.id;
    const serviceWorker = {};
    reserved.activeServiceWorker = serviceWorker;
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(params.reservedEnv).toBe(reserved);
    expect(reserved.id).toBe('');
    expect(document.env.id).toBe(id);
    expect(document.env.targetBrowsingContext).toBe(top.activeBrowsingContext);
    expect(document.env.activeServiceWorker).toBe(serviceWorker);
    expect(document.env.isSecureContext).toBe(true);
    expect(reserved.executionReady).toBe(false);
  });

  it.each([false, true])('reuses an initial Window without creating or consuming a reservation (%s)', (hasReservation) => {
    const top = fixture();
    const initial = top.activeDocument!;
    const window = top.activeWindow!;
    const performance = window.env.getWindowOrWorkerGlobalScopeMixin().performance;
    expect(initial.navigationTimingEntry).toBeUndefined();
    expect(performance.getEntriesByType('navigation')).toEqual([]);
    const params = suppliedParams('about:blank?replacement');
    params.origin = initial.origin;
    if (hasReservation) params.reservedEnv = reserve(top, params, false);
    const reserved = params.reservedEnv;
    const id = reserved?.id;
    const createWindow = vi.spyOn(initial.env.userAgent, 'createWindowEnvironment');
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(document).not.toBe(initial);
    expect(document.env).toBe(initial.env);
    expect(window.document).toBe(document);
    expect(top.activeDocument).toBe(initial);
    expect(params.reservedEnv).toBe(reserved);
    expect(reserved?.id).toBe(id);
    expect(createWindow).not.toHaveBeenCalled();
    expect(window.env.getWindowOrWorkerGlobalScopeMixin().performance).toBe(performance);
    expect(document.navigationTimingEntry).toBeDefined();
    expect(document.navigationTimingEntry!.name).toBe('about:blank?replacement');
    expect(performance.getEntriesByType('navigation')).toEqual([document.navigationTimingEntry]);
    expect(initial.navigationTimingEntry).toBeUndefined();
  });

  it('creates a fresh Window for a later same-origin Document, preserving its proxy handle', () => {
    const top = fixture();
    const previous = top.activeDocument!;
    previous.isInitialAboutBlank = false;
    const params = suppliedParams();
    params.origin = previous.origin;
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(document.env).not.toBe(previous.env);
    expect(document.getRelevantGlobalObject()!.env.realm.windowProxy).toBe(previous.getRelevantGlobalObject()!.env.realm.windowProxy);
    expect(previous.getRelevantGlobalObject()!.document).toBe(previous);
    expect(top.activeDocument).toBe(previous);
  });

  it.each([1, 2])('inherits the container environment top-level metadata at depth %s', (depth) => {
    const top = fixture();
    let child: Navigable = top;
    for (let i = 0; i < depth; i++) child = createChild(child);
    const containerEnv = child.container!.env;
    const params = suppliedParams();
    const document = child.createAndInitializeDocument('html', 'text/html', params);

    expect(document.env.creationURL).toBe(params.url);
    expect(document.env.topLevelCreationURL).toBe(containerEnv.topLevelCreationURL);
    expect(document.env.topLevelOrigin).toBe(containerEnv.topLevelOrigin);
    expect(document.env.determineNetworkPartitionKey()).toEqual(containerEnv.determineNetworkPartitionKey());
    expect(params.reservedEnv).toBeNull();
  });

  it.each([true, false])('gates an Origin-Agent-Cluster request on the reserved security decision (%s)', (secure) => {
    const top = fixture();
    // Make the captured decision disagree with a fresh origin trust check in both directions.
    const params = suppliedParams(secure ? 'http://incoming.test/' : 'https://incoming.test/');
    params.response.headerList.append('Origin-Agent-Cluster', '?1');
    params.reservedEnv = reserve(top, params, secure);
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(document.getRelevantGlobalObject()!.originAgentCluster).toBe(secure);
    expect(document.env.isSecureContext).toBe(secure);
  });

  it.each([
    ['https://incoming.test/', true],
    ['http://incoming.test/', false],
    ['http://localhost/', true],
  ] as const)('creates a supplied-response Window without a reservation and gates OAC for %s', (url, secure) => {
    const top = fixture();
    const previous = top.activeDocument!;
    const response = new FetchResponse();
    response.urlList.push(parseURL(url).url!);
    response.headerList.append('Origin-Agent-Cluster', '?1');
    const params = NavigationParams.fromSuppliedResponse(
      response, top, previous, top.snapshotTargetParams(), new DocumentState(),
      'supplied-oac', 'none', previous.env,
    );
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(params.reservedEnv).toBeNull();
    expect(document.env.targetBrowsingContext).toBeNull();
    expect(document.env.id).not.toBe(previous.env.id);
    expect(document.getRelevantGlobalObject()!.originAgentCluster).toBe(secure);
    expect(document.env.isSecureContext).toBe(secure);
    expect(document.env.realm.secureContext).toBe(secure);
  });

  it('uses incoming security rather than the departing secure Window when no reservation exists', () => {
    const top = fixture();
    const previous = createActiveDocument(top, suppliedParams('https://departing.test/'));
    expect(previous.env.isSecureContext).toBe(true);
    const params = suppliedParams('http://incoming.test/');
    params.response.headerList.append('Origin-Agent-Cluster', '?1');
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(params.reservedEnv).toBeNull();
    expect(document.getRelevantGlobalObject()!.originAgentCluster).toBe(false);
    expect(document.env.isSecureContext).toBe(false);
    expect(previous.env.isSecureContext).toBe(true);
  });

  it.each([
    { name: 'secure parent', ancestors: ['https://parent.test/'], secure: true },
    { name: 'insecure parent', ancestors: ['http://parent.test/'], secure: false },
    { name: 'insecure intermediate ancestor', ancestors: ['https://top.test/', 'http://parent.test/'], secure: false },
  ])('uses the full parent security chain without a reservation: $name', ({ ancestors, secure }) => {
    let parent: Navigable = fixture();
    for (const [index, url] of ancestors.entries()) {
      if (index !== 0) parent = createChild(parent);
      createActiveDocument(parent, suppliedParams(url));
    }
    const child = createChild(parent);
    const params = suppliedParams();
    params.response.headerList.append('Origin-Agent-Cluster', '?1');
    const document = child.createAndInitializeDocument('html', 'text/html', params);

    expect(params.reservedEnv).toBeNull();
    expect(document.getRelevantGlobalObject()!.originAgentCluster).toBe(secure);
    expect(document.env.isSecureContext).toBe(secure);
    expect(document.env.realm.secureContext).toBe(secure);
    expect(parent.activeDocument!.env.isSecureContext).toBe(secure);
  });

  it('uses the selected inherited origin for an OAC request without a reservation', () => {
    const top = fixture();
    const params = suppliedParams('about:blank');
    params.origin = obtainURLOrigin(parseURL('https://inherited.test/').url!);
    params.response.headerList.append('Origin-Agent-Cluster', '?1');
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(document.env.creationURL.scheme).toBe('about');
    expect(document.getRelevantGlobalObject()!.originAgentCluster).toBe(true);
    expect(document.env.isSecureContext).toBe(true);
    expect(params.reservedEnv).toBeNull();
  });

  it('honors UserAgent trust configuration without a reserved environment', () => {
    const top = fixture();
    const params = suppliedParams('http://configured.test/');
    if (params.origin.kind !== 'tuple') throw new Error('Expected a tuple origin in the fixture');
    top.activeDocument!.env.userAgent.trustworthyOrigins.push(params.origin);
    params.response.headerList.append('Origin-Agent-Cluster', '?1');
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(document.getRelevantGlobalObject()!.originAgentCluster).toBe(true);
    expect(document.env.isSecureContext).toBe(true);
    expect(params.reservedEnv).toBeNull();
  });

  it.each([false, true])('retains the original cluster decision across a null-reservation replacement (%s)', (originKeyed) => {
    const top = fixture();
    const original = suppliedParams();
    original.response.headerList.append('Origin-Agent-Cluster', originKeyed ? '?1' : '?0');
    const previous = createActiveDocument(top, original);
    const params = suppliedParams('https://incoming.test/replacement');
    params.response.headerList.append('Origin-Agent-Cluster', originKeyed ? '?0' : '?1');
    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(document.env).not.toBe(previous.env);
    expect(document.env.realm.agent).toBe(previous.env.realm.agent);
    expect(document.getRelevantGlobalObject()!.originAgentCluster).toBe(originKeyed);
    expect(params.reservedEnv).toBeNull();
  });

  it('creates a later srcdoc Document from its actual null-reservation producer', () => {
    const top = fixture();
    const child = createChild(top);
    const previous = child.activeDocument!;
    previous.isInitialAboutBlank = false;
    const state = new DocumentState();
    state.origin = previous.origin;
    state.aboutBaseURL = top.activeDocument!.url;
    state.resource = '<p>srcdoc</p>';
    const entry = previous.env.createSessionHistoryEntry(parseURL('about:srcdoc').url!, state);
    const params = NavigationParams.fromSrcdoc(entry, child, child.snapshotTargetParams(), 'none', null, 'navigate', previous.env);
    const document = child.createAndInitializeDocument('html', 'text/html', params);

    expect(params.reservedEnv).toBeNull();
    expect(document.env).not.toBe(previous.env);
    expect(document.env.targetBrowsingContext).toBeNull();
    expect(document.policyContainer).toBe(params.policyContainer);
    expect(document.aboutBaseURL).toBe(state.aboutBaseURL);
    expect(document.env.topLevelOrigin).toBe(top.activeDocument!.env.topLevelOrigin);
    expect(document.navigationTimingEntry).toMatchObject({
      name: 'about:srcdoc', entryType: 'navigation', redirectCount: 0,
      responseEnd: 0, transferSize: 0,
    });
    expect(document.navigationTimingEntry!.timingInfo.startTime).toBe(params.startTime);
    expect(document.navigationTimingEntry!.env).toBe(document.env);
  });
});

describe('Document creation state before activation', () => {
  it.each([
    ['html', 'text/html', true], ['html', 'text/html', false],
    ['xml', 'application/xml', true], ['xml', 'application/xml', false],
  ] as const)('initializes %s (%s) before commit hooks; initial Window reuse: %s', (type, contentType, reuseWindow) => {
    const top = fixture();
    const previous = top.activeDocument!;
    const previousWindow = top.activeWindow!;
    const previousRegistry = previous.customElementRegistry;
    const previousTiming = previous.loadTimingInfo;
    previous.title = 'Retained Document';
    previousTiming.loadEventEndTime = 75;
    const params = suppliedParams(reuseWindow ? 'about:blank?replacement' : 'https://incoming.test/response', 123);
    if (reuseWindow) params.origin = previous.origin;
    let committedHints = false;
    params.commitEarlyHints = (document) => {
      committedHints = true;
      const platform = project(document) as Document;
      // A loader callback receives a fully initialized, unparsed Document, before history activation.
      expect(platform.readyState).toBe('loading');
      expect(platform.contentType).toBe(contentType);
      expect(platform.URL).toBe(reuseWindow ? 'about:blank?replacement' : 'https://incoming.test/response');
      expect(platform.compatMode).toBe('CSS1Compat');
      expect(platform.documentElement).toBeNull();
      expect(platform.title).toBe('');
      expect(document.getRelevantGlobalObject()!.document).toBe(document);
      expect(document.isFullyActive()).toBe(false);
      expect(top.activeDocument).toBe(previous);
    };

    const document = top.createAndInitializeDocument(type, contentType, params);

    expect(committedHints).toBe(true);
    expect(document.env === previous.env).toBe(reuseWindow);
    expect(previousWindow.document).toBe(reuseWindow ? document : previous);
    expect(document.createElement('MiXeD').localName).toBe(type === 'html' ? 'mixed' : 'MiXeD');
    expect(document.customElementRegistry).not.toBeNull();
    expect(document.customElementRegistry).not.toBe(previousRegistry);
    expect(document.loadTimingInfo).not.toBe(previousTiming);
    expect(document.loadTimingInfo.navigationStartTime).toBe(123);
    expect(document.loadTimingInfo.loadEventEndTime).toBe(0);
    expect(document.activeParser).toBeNull();
    expect(document.isInitialAboutBlank).toBe(false);
    expect(document.allowDeclarativeShadowRoots).toBe(true);
    // Reusing the global does not overwrite state on a retained old Document.
    expect(previous.title).toBe('Retained Document');
    expect(previous.readyState).toBe('complete');
    expect(previous.customElementRegistry).toBe(previousRegistry);
    expect(previous.loadTimingInfo).toBe(previousTiming);
    expect(previous.loadTimingInfo.loadEventEndTime).toBe(75);
  });
});

describe('Document creation ancestry and policy initialization', () => {
  it.each([
    ['no-referrer', 'null'], ['same-origin', 'null'], ['unsafe-url', 'https://parent.test'],
  ] as const)('uses captured %s for incoming ancestry before activation', (policy, parentOrigin) => {
    const top = fixture();
    createActiveDocument(top, suppliedParams('https://top.test/'));
    const parent = createChild(top);
    const parentDocument = createActiveDocument(parent, suppliedParams('https://parent.test/'));
    const child = createChild(parent);
    const previous = child.activeDocument!;
    const previousOrigins = previous.ancestorOriginsList;
    const iframe = child.container as HTMLIFrameElementImpl;
    iframe.setAttribute('referrerpolicy', policy);
    const snapshot = child.snapshotTargetParams();
    iframe.setAttribute('referrerpolicy', policy === 'unsafe-url' ? 'no-referrer' : 'unsafe-url');
    const params = NavigationParams.fromSuppliedResponse(
      suppliedParams().response, child, parentDocument, snapshot, new DocumentState(),
      'ancestry', 'none', parentDocument.env,
    );
    let committedHints = false;
    params.commitEarlyHints = (document) => {
      committedHints = true;
      expect(document.getNodeNavigable()).toBeNull();
      expect(child.activeDocument).toBe(previous);
      const origins = project(document.ancestorOriginsList!) as DOMStringList;
      expect(Array.from(origins)).toEqual([parentOrigin, 'https://top.test']);
      expect(document.ancestorOriginsList).not.toBe(previousOrigins);
    };

    child.createAndInitializeDocument('html', 'text/html', params);

    expect(committedHints).toBe(true);
    expect(previous.ancestorOriginsList).toBe(previousOrigins);
    expect(Array.from(project(previousOrigins!) as DOMStringList)).toEqual(['https://parent.test', 'https://top.test']);
  });

  it.each([
    ['enforce', true], ['report', true], ['absent', true],
    ['enforce', false], ['report', false], ['absent', false],
  ] as const)('applies incoming %s upgrade policy; initial Window reuse: %s', (disposition, reuseWindow) => {
    const top = fixture();
    const previous = top.activeDocument!;
    const previousContainer = previous.policyContainer;
    const previousUpgrade = previous.env.insecureRequestsPolicy;
    const previousTarget = parseURL('https://previous.test/').url!;
    previousUpgrade.enableFor(previousTarget);
    const params = suppliedParams(reuseWindow ? 'about:blank?replacement' : 'https://incoming.test/');
    if (reuseWindow) params.origin = previous.origin;
    params.policyContainer.cspList = new CSPList(params.origin);
    if (disposition !== 'absent') {
      params.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse('upgrade-insecure-requests', 'header', disposition));
    }
    let committedHints = false;
    params.commitEarlyHints = (document) => {
      committedHints = true;
      expect(document.env.policyContainer).toBe(params.policyContainer);
      expect(document.env.insecureRequestsPolicy.upgrade).toBe(disposition === 'enforce');
      expect(document.env.insecureRequestsPolicy.shouldUpgradeNavigation(document.url)).toBe(disposition === 'enforce');
      expect(document.env.insecureRequestsPolicy.shouldUpgradeNavigation(previousTarget)).toBe(false);
      expect(document.env.insecureRequestsPolicy).not.toBe(previousUpgrade);
    };

    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(committedHints).toBe(true);
    expect(document.env === previous.env).toBe(reuseWindow);
    expect(previous.policyContainer).toBe(previousContainer);
    expect(previousUpgrade.shouldUpgradeNavigation(previousTarget)).toBe(true);
    expect(top.activeBrowsingContext!.insecureRequestsPolicy.upgrade).toBe(false);
  });

  it('adds response upgrade policy without mutating inherited browsing-context policy', () => {
    const top = fixture();
    const context = top.activeBrowsingContext!;
    const inheritedTarget = parseURL('https://parent.test/').url!;
    context.insecureRequestsPolicy.enableFor(inheritedTarget);
    const params = suppliedParams();
    params.response.headerList.append('Content-Security-Policy', 'upgrade-insecure-requests');
    params.policyContainer.cspList = CSPList.parse(params.response);

    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(document.env.insecureRequestsPolicy.shouldUpgradeNavigation(inheritedTarget)).toBe(true);
    expect(document.env.insecureRequestsPolicy.shouldUpgradeNavigation(document.url)).toBe(true);
    expect(context.insecureRequestsPolicy.shouldUpgradeNavigation(document.url)).toBe(false);
  });

  it('retains inherited CSP self origin when srcdoc sandboxing gives the Document an opaque origin', () => {
    const top = fixture();
    const parent = createActiveDocument(top, suppliedParams('https://parent.test/'));
    const policies = parent.policyContainer.cspList!;
    policies.policies.push(ContentSecurityPolicy.parse("default-src 'self'", 'header', 'enforce'));
    const child = createChild(top);
    child.container!.setAttribute('sandbox', 'allow-scripts');
    const state = new DocumentState();
    state.origin = parent.origin;
    state.resource = '<p>srcdoc</p>';
    const entry = parent.env.createSessionHistoryEntry(parseURL('about:srcdoc').url!, state);
    const params = NavigationParams.fromSrcdoc(entry, child, child.snapshotTargetParams(), 'none', null, 'navigate', parent.env);

    const document = child.createAndInitializeDocument('html', 'text/html', params);

    expect(document.origin.kind).toBe('opaque');
    expect(document.policyContainer.cspList).toBe(params.policyContainer.cspList);
    expect(document.policyContainer.cspList).not.toBe(policies);
    expect(document.policyContainer.cspList!.selfOrigin).toBe(policies.selfOrigin);
    expect(document.policyContainer.cspList!.selfOrigin).not.toBe(document.origin);
  });
});

describe('Document creation referrer initialization', () => {
  it.each(['synthetic', 'no-referrer', 'url'] as const)('uses the selected %s referrer before loader callbacks', (kind) => {
    const top = fixture();
    const previous = top.activeDocument!;
    previous.referrer = 'https://creator.test/page';
    const params = suppliedParams(kind === 'synthetic' ? 'about:blank?replacement' : 'https://incoming.test/');
    if (kind === 'synthetic') {
      params.origin = previous.origin;
    } else {
      const request = new FetchRequest(params.url, previous.env);
      request.referrerPolicy = 'unsafe-url';
      request.referrer = kind === 'no-referrer' ? null : parseURL('https://source.test/path?q=1').url!;
      params.request = request;
    }
    // This response policy governs outgoing requests; it must not re-filter the incoming request's referrer.
    params.policyContainer.referrerPolicy = 'no-referrer';
    const expected = kind === 'url' ? 'https://source.test/path?q=1' : '';
    let committedHints = false;
    params.commitEarlyHints = (document) => {
      committedHints = true;
      expect((project(document) as Document).referrer).toBe(expected);
      expect(top.activeDocument).toBe(previous);
    };

    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(committedHints).toBe(true);
    if (params.request !== null) params.request.referrer = null;
    expect((project(document) as Document).referrer).toBe(expected);
    expect(previous.referrer).toBe('https://creator.test/page');
  });

  it('keeps unresolved client referrer as an explicit Fetch-input failure', () => {
    const top = fixture();
    const params = suppliedParams();
    params.request = new FetchRequest(params.url, top.activeDocument!.env);

    expect(() => top.createAndInitializeDocument('html', 'text/html', params))
      .toThrow('Navigation request referrer has not been resolved');
  });
});

describe('Document creation Navigation Timing inputs', () => {
  // SPEC_CLASH(navigation-redirect-count): Follow HTML's same-origin bypass, complete TAO chain, and client/referrer gate.
  it.each([
    { name: 'same-origin without TAO', taint: 'same-origin', values: [], noReferrer: false, clientless: false, expected: 2 },
    { name: 'same-origin without a referrer', taint: 'same-origin', values: [], noReferrer: true, clientless: false, expected: 2 },
    { name: 'same-site without TAO', taint: 'same-site', values: [[]], noReferrer: false, clientless: false, expected: 0 },
    { name: 'same-site with TAO', taint: 'same-site', values: [['*']], noReferrer: false, clientless: false, expected: 2 },
    { name: 'foreign without TAO', taint: 'cross-site', values: [[]], noReferrer: false, clientless: false, expected: 0 },
    { name: 'foreign with wildcard TAO', taint: 'cross-site', values: [['*'], ['*']], noReferrer: false, clientless: false, expected: 2 },
    { name: 'foreign with destination TAO', taint: 'cross-site', values: [['https://incoming.test']], noReferrer: false, clientless: false, expected: 2 },
    { name: 'foreign with unrelated TAO', taint: 'cross-site', values: [['https://other.test']], noReferrer: false, clientless: false, expected: 0 },
    { name: 'foreign with a missing intermediate TAO', taint: 'cross-site', values: [['*'], []], noReferrer: false, clientless: false, expected: 0 },
    { name: 'foreign TAO without a referrer', taint: 'cross-site', values: [['*']], noReferrer: true, clientless: false, expected: 0 },
    { name: 'clientless foreign TAO without a referrer', taint: 'cross-site', values: [['*']], noReferrer: true, clientless: true, expected: 2 },
    { name: 'clientless foreign without TAO', taint: 'cross-site', values: [[]], noReferrer: true, clientless: true, expected: 0 },
  ] as const)('selects redirect count for $name', ({ taint, values, noReferrer, clientless, expected }) => {
    const top = fixture();
    const params = fetchedParams(top);
    const request = params.request!;
    const response = params.response;
    request.redirectCount = 2;
    request.client = clientless ? null : top.activeDocument!.env;
    request.referrer = noReferrer ? null : parseURL('https://source.test/start').url!;
    response.redirectTaint = taint;
    response.navigationTimingAllowValuesList = values.map((values) => [...values]);
    // Resource Timing's initiator-facing TAO flag is independent of navigation's destination-facing check.
    response.timingAllowPassed = false;
    let committedHints = false;
    params.commitEarlyHints = (document) => {
      committedHints = true;
      expect(document.navigationTimingEntry).toMatchObject({ redirectCount: expected });
    };

    const document = top.createAndInitializeDocument('html', 'text/html', params);

    expect(committedHints).toBe(true);
    request.redirectCount = 7;
    response.navigationTimingAllowValuesList.length = 0;
    expect(document.navigationTimingEntry).toMatchObject({ redirectCount: expected });
  });

  it.each(['navigate', 'reload', 'back_forward'] as const)('retains live %s timing inputs without mutating the Fetch record', (type) => {
    const top = fixture();
    const params = fetchedParams(top);
    const response = params.response;
    const fetchTimingInfo = params.fetchController!.extractFullTimingInfo();
    const workerTiming: ServiceWorkerTimingInfo = {
      startTime: 30, fetchEventDispatchTime: 31, workerRouterEvaluationStart: 0,
      workerCacheLookupStart: 0, workerMatchedRouterSource: '', workerFinalRouterSource: '',
    };
    params.navigationTimingType = type;
    params.request!.redirectCount = 2;
    response.redirectTaint = 'cross-site';
    response.navigationTimingAllowValuesList = [[]];
    response.serviceWorkerTimingInfo = workerTiming;
    response.cacheUsage = 'validated';
    response.status = 203;
    fetchTimingInfo.redirectStartTime = 11;
    fetchTimingInfo.redirectEndTime = 21;
    const createEntry = vi.spyOn(DocumentImpl.prototype, 'createNavigationTimingEntry');

    const document = top.createAndInitializeDocument('html', 'text/html', params);
    const inputs = document.navigationTimingEntry;

    expect(createEntry).toHaveBeenCalledOnce();
    expect(inputs).toMatchObject({
      type, redirectCount: 0, responseStatus: 203, cacheMode: 'validated', serviceWorkerTimingInfo: workerTiming,
    });
    expect(inputs?.timingInfo).toBe(fetchTimingInfo);
    expect(inputs?.documentTimingInfo).toBe(document.loadTimingInfo);
    expect(inputs?.previousDocumentUnloadTiming).toBe(document.previousDocumentUnloadTiming);
    expect(inputs?.serviceWorkerTimingInfo).toBe(workerTiming);
    expect(inputs?.resourceInfo).toBe(response.bodyInfo);
    // The public Resource Timing getters must apply their own exposure rules; do not erase the shared Fetch data here.
    expect(fetchTimingInfo.redirectStartTime).toBe(11);
    expect(fetchTimingInfo.redirectEndTime).toBe(21);
    fetchTimingInfo.endTime = 50;
    response.bodyInfo.decodedSize = 75;
    document.loadTimingInfo.domInteractiveTime = 60;
    expect(inputs?.timingInfo.endTime).toBe(50);
    expect(inputs?.resourceInfo.decodedSize).toBe(75);
    expect(inputs?.documentTimingInfo.domInteractiveTime).toBe(60);
  });

  it('requires the navigation request when a Fetch controller is supplied', () => {
    const top = fixture();
    const params = fetchedParams(top);
    params.request = null;

    expect(() => top.createAndInitializeDocument('html', 'text/html', params))
      .toThrow('Navigation timing requires the Fetch request');
  });
});

function fixture(): TopLevelTraversable {
  return TopLevelTraversable.create(createManualUserAgent(), null, '');
}

/** Supply final params as the synthetic navigation producers do, independently of the local-route adapter. */
function suppliedParams(url = 'https://incoming.test/response', startTime = 0): NavigationParams {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  const params = new NavigationParams(response, new SandboxingFlagSet(), startTime);
  params.coopEnforcementResult = {
    url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
    needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
    currentContextIsNavigationSource: false,
  };
  return params;
}

/** Supply Fetch's completed response-header inputs; its real transport path is covered by the loader tests. */
function fetchedParams(top: TopLevelTraversable): NavigationParams {
  const params = suppliedParams();
  params.request = new FetchRequest(params.url, top.activeDocument!.env);
  params.request.referrer = null;
  const controller = new FetchController();
  controller.fullTimingInfo = new FetchTimingInfo();
  controller.fullTimingInfo.startTime = 10;
  params.fetchController = controller;
  return params;
}

function reserve(top: TopLevelTraversable, params: NavigationParams, isSecureContext: boolean): BrowletEnvironmentBase {
  return new BrowletEnvironmentBase({
    userAgent: top.activeDocument!.env.userAgent, creationURL: params.url,
    topLevelCreationURL: params.url, topLevelOrigin: obtainURLOrigin(params.url),
    targetBrowsingContext: top.activeBrowsingContext, isSecureContext,
  });
}

/** Supply the active-history links without running the unrelated loading pipeline. */
function createActiveDocument(navigable: Navigable, params: NavigationParams) {
  const document = navigable.createAndInitializeDocument('html', 'text/html', params);
  const entry = document.env.createSessionHistoryEntry(document.url, DocumentState.create(document));
  navigable.activeSessionHistoryEntry = navigable.currentSessionHistoryEntry = entry;
  document.makeActive();
  return document;
}

/** Supply only the child connection whose automatic element lifecycle is unfinished. */
function createChild(parent: Navigable): Navigable {
  const owner = parent.activeDocument!;
  const container = owner.createElement('iframe') as HTMLIFrameElementImpl;
  const [, document] = BrowsingContext.create(owner, container, parent.topLevelTraversable.activeBrowsingContext!.group!);
  const child = new Navigable(DocumentState.create(document), parent);
  container.contentNavigable = child;
  return child;
}
