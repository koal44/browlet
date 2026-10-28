import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { monotonicClock } from '../../../../src/browlet/timing/clock';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('Window script settings', () => {
  it('follows the replacement Document while retaining the initial Window settings', () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const window = env.window;
    const initialDocument = window.document;
    const creationURL = env.creationURL;
    const topLevelCreationURL = env.topLevelCreationURL;
    const topLevelOrigin = env.topLevelOrigin;
    const context = env.realmExecutionContext;
    const id = env.id;
    const url = parseURL('https://example.test/replacement').url!;
    // An inherited origin allows initial-about:blank to reuse its Window.
    initialDocument.origin = obtainURLOrigin(url);
    const navigable = window.navigable!;
    const params = navigable.createNavigationParamsFromSource(url);
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    navigable.finalizeCrossDocumentNavigation('replace', 'none', navigable.createHistoryEntry(document, params));

    expect(document.getRelevantGlobalObject()).toBe(window);
    expect(env).toBe(document.env);
    expect(env.moduleMap).toBe(document.moduleMap);
    expect(env.moduleMap).not.toBe(initialDocument.moduleMap);
    expect(env.origin).toBe(document.origin);
    expect(env.origin).not.toBe(initialDocument.origin);
    expect(env.policyContainer).toBe(document.policyContainer);
    expect(env.policyContainer).not.toBe(initialDocument.policyContainer);
    expect(env.apiBaseURL).toBe(document.url);
    expect(env.timeOrigin.clock).toBe(monotonicClock);
    expect(env.timeOrigin.milliseconds).toBe(params.startTime);
    expect(env.hasCrossSiteAncestor).toBe(false);

    const root = document.createElement('html');
    const base = document.createElement('base');
    root.appendChild(base);
    document.appendChild(root);
    base.setAttribute('href', 'https://assets.test/base/');
    expect(env.apiBaseURL).toBe(document.getBaseURL());
    expect(env.apiBaseURL).not.toBe(document.url);
    expect(env.creationURL).toBe(creationURL);
    expect(env.topLevelCreationURL).toBe(topLevelCreationURL);
    expect(env.topLevelOrigin).toBe(topLevelOrigin);
    expect(env.id).toBe(id);
    expect(env.realmExecutionContext).toBe(context);
    expect(context.realm.env).toBe(env);
  });

  it.each(['none', 'logical'] as const)('does not grant isolation capability for %s isolation', (mode) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    env.realm.agent.agentCluster!.crossOriginIsolationMode = mode;
    expect(env.crossOriginIsolatedCapability).toBe(false);
  });

  it('keeps concrete isolation dependent on Permissions Policy for an active Document', () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    env.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    expect(() => env.crossOriginIsolatedCapability).toThrow(/permissions.policy/i);
  });

  it('denies concrete isolation when the Document has lost its browsing context', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const env = document.env;
    env.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    document.browsingContext = null;
    expect(env.crossOriginIsolatedCapability).toBe(false);
  });

  it('denies concrete isolation when the associated Document is no longer active', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const env = getRelevantRealm(browser.window).env;
    await browser.navigate('https://example.test/second');
    env.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    expect(env.window.browsingContext).not.toBeNull();
    expect(env.window.navigable).toBeNull();
    expect(env.crossOriginIsolatedCapability).toBe(false);
  });

  it('denies concrete isolation for an active child without a fully active container ancestry', () => {
    const browser = new Browlet({ route: () => '' });
    const parent = getRelevantRealm(browser.window).windowImplementation.navigable!;
    const [, document] = BrowsingContext.createTopLevel(parent.activeDocument!.env.userAgent);
    const child = new Navigable(createDocumentState(document), parent);
    document.env.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    expect(document.getNodeNavigable()).toBe(child);
    expect(document.isFullyActive()).toBe(false);
    expect(document.env.crossOriginIsolatedCapability).toBe(false);
  });
});
