import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { OpenerPolicy } from '../../../../src/browlet/browsing/policy/coop';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/sandbox';
import { PermissionsPolicy } from '../../../../src/browlet/browsing/policy/permissions';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import { InternalError } from '../../../../src/infra/index';
import { obtainURLOrigin, parseURL, serializeOrigin, serializeURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

describe('initial browsing-context inheritance', () => {
  it('inherits the creator origin, base, cookie URL, settings, and virtual group without registering a top-level context', async () => {
    const { document: creator, context: parent, group } = await fixture();
    parent.virtualBrowsingContextGroupID = 19;
    const base = creator.createElement('base');
    base.setAttributeValue('href', '/base/');
    creator.head!.appendChild(base);
    const baseURL = creator.getBaseURL();
    const [context, document] = BrowsingContext.create(creator, null, group);

    expect(context.activeDocument).toBe(document);
    expect(context.activeWindow.document).toBe(document);
    expect(context.virtualBrowsingContextGroupID).toBe(19);
    expect(context.group).toBeNull();
    expect(group.browsingContextSet).toEqual(new Set([parent]));
    expect(context.isAuxiliary).toBe(false);
    expect(context.openerBrowsingContext).toBeNull();
    expect(document.origin).toBe(creator.origin);
    expect(document.aboutBaseURL).toBe(baseURL);
    expect(document.getBaseURL()).toBe(baseURL);
    expect(document.cookieURL).toEqual(creator.cookieURL);
    expect(document.cookieURL).not.toBe(creator.cookieURL);
    expect(document.URL).toBe('about:blank');
    expect(serializeURL(document.env.creationURL)).toBe('about:blank');
    expect(document.env.topLevelCreationURL).toBe(creator.env.topLevelCreationURL);
    expect(document.env.topLevelOrigin).toBe(document.origin);
    expect(document.env.realm.agent).toBe(creator.env.realm.agent);
    expect(document.env.realm).not.toBe(creator.env.realm);
    expect(document.env.executionReady).toBe(true);
    expect(document.readyForPostLoadTasks).toBe(true);
    expect(document.completelyLoadedTime).not.toBeNull();
    expect(document.documentElement?.localName).toBe('html');
    expect(document.head?.localName).toBe('head');
    expect(document.body?.localName).toBe('body');
    expect(document.customElementRegistry).not.toBe(creator.customElementRegistry);
  });

  it('copies the full creator referrer and independently clones the policy container', async () => {
    const { document: creator, group } = await fixture();
    creator.policyContainer.referrerPolicy = 'no-referrer';
    creator.policyContainer.embedderPolicy.reportOnlyValue = 'credentialless';
    creator.policyContainer.integrityPolicy.endpoints.push('integrity');
    const [, document] = BrowsingContext.create(creator, null, group);

    // SPEC_CLASH(initial-blank-referrer): HTML/Chromium retain the fragment despite no-referrer.
    expect(document.referrer).toBe('https://creation.test/creator?query#fragment');
    expect(document.policyContainer).not.toBe(creator.policyContainer);
    expect(document.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(document.policyContainer.cspList).not.toBe(creator.policyContainer.cspList);
    expect(document.policyContainer.cspList!.selfOrigin).toBe(creator.policyContainer.cspList!.selfOrigin);
    expect(document.policyContainer.embedderPolicy).not.toBe(creator.policyContainer.embedderPolicy);
    expect(document.policyContainer.embedderPolicy.reportOnlyValue).toBe('credentialless');
    document.policyContainer.referrerPolicy = 'origin';
    document.policyContainer.integrityPolicy.endpoints.push('child');
    expect(creator.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(creator.policyContainer.integrityPolicy.endpoints).toEqual(['integrity']);
  });

  it('uses the top-level creator policy rather than a nested creator policy', async () => {
    const { document: topDocument, context: topContext, group } = await fixture();
    topContext.virtualBrowsingContextGroupID = 31;
    topDocument.openerPolicy.value = 'same-origin-allow-popups';
    const iframe = topDocument.createElement('iframe') as HTMLIFrameElementImpl;
    const [creatorContext, creator] = BrowsingContext.create(topDocument, iframe, group);
    const child = new Navigable(createDocumentState(creator), topDocument.getNodeNavigable());
    iframe.contentNavigable = child;
    creatorContext.virtualBrowsingContextGroupID = 77;
    creator.openerPolicy = new OpenerPolicy();

    const [context, document] = BrowsingContext.create(creator, null, group);

    expect(document.openerPolicy).toBe(topDocument.openerPolicy);
    expect(document.openerPolicy).not.toBe(creator.openerPolicy);
    expect(context.virtualBrowsingContextGroupID).toBe(31);
    creator.origin = obtainURLOrigin(parseURL('https://foreign.test/').url!);
    const [, foreignCreated] = BrowsingContext.create(creator, null, group);
    expect(foreignCreated.openerPolicy.value).toBe('unsafe-none');
    expect(foreignCreated.openerPolicy).not.toBe(topDocument.openerPolicy);
    expect(foreignCreated.env.topLevelOrigin).toBe(creator.origin);
  });

  it('inherits sandbox restrictions and Permissions Policy from the embedding Document', async () => {
    const { document: creator, group } = await fixture();
    const iframe = creator.createElement('iframe') as HTMLIFrameElementImpl;
    iframe.setAttributeValue('sandbox', 'allow-scripts');
    creator.activeSandboxingFlagSet.add('sandboxed-scripts');
    const [, document] = BrowsingContext.create(creator, iframe, group);
    const feature = PermissionsPolicy.getSupportedFeature('cross-origin-isolated')!;

    expect(document.origin.kind).toBe('opaque');
    expect(document.origin).not.toBe(creator.origin);
    expect(document.activeSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(document.activeSandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
    expect(document.permissionsPolicyState.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(document.env.topLevelOrigin).toBe(creator.env.topLevelOrigin);
    expect(document.internalAncestorOriginObjectsList).toEqual([creator.origin]);
    iframe.removeAttribute('sandbox');
    creator.activeSandboxingFlagSet.clear();
    expect(document.activeSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(document.activeSandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
  });

  it('uses an adopted iframe\'s relevant settings but its current node Document for ancestry and upgrade inheritance', async () => {
    const first = await fixture();
    const second = await fixture('http://other.test/current');
    const iframe = first.document.createElement('iframe') as HTMLIFrameElementImpl;
    second.document.adoptNode(iframe);
    second.document.env.insecureRequestsPolicy.enableFor(second.document.url);
    const [, document] = BrowsingContext.create(second.document, iframe, second.group);

    expect(iframe.env).toBe(first.document.env);
    expect(document.env.topLevelCreationURL).toBe(first.document.env.topLevelCreationURL);
    expect(document.env.topLevelOrigin).toBe(first.document.env.topLevelOrigin);
    expect(document.origin).toBe(second.document.origin);
    expect(document.internalAncestorOriginObjectsList).toEqual([second.document.origin]);
    expect(document.env.insecureRequestsPolicy.upgrade).toBe(true);
    expect(document.env.insecureRequestsPolicy).not.toBe(second.document.env.insecureRequestsPolicy);
    expect(document.env.isSecureContext).toBe(false);
  });

  it('allows an embedder without a creator while retaining a fresh opaque origin', async () => {
    const { document: parent, group } = await fixture();
    const iframe = parent.createElement('iframe') as HTMLIFrameElementImpl;
    const [, document] = BrowsingContext.create(null, iframe, group);

    expect(document.origin.kind).toBe('opaque');
    expect(document.origin).not.toBe(parent.origin);
    expect(document.aboutBaseURL).toBeNull();
    expect(document.referrer).toBe('');
    expect(document.env.topLevelOrigin).toBe(parent.env.topLevelOrigin);
    expect(document.env.topLevelCreationURL).toBe(parent.env.topLevelCreationURL);
  });

  it('rejects a creator without an active context before allocating another Window', async () => {
    const { document: parent, group } = await fixture();
    const detached = parent.env.createDocument();
    const agent = parent.env.realm.agent;
    if (!(agent instanceof WindowAgent)) throw new Error('Expected a Window agent');
    const windows = agent.windowObjects.size;

    expect(() => BrowsingContext.create(detached, null, group)).toThrow(InternalError);
    expect(agent.windowObjects.size).toBe(windows);
  });
});

describe('auxiliary browsing-context creation', () => {
  it('registers in a nested opener\'s top-level group and preserves opener state', async () => {
    const { document: parent, context: topContext, group } = await fixture();
    const iframe = parent.createElement('iframe') as HTMLIFrameElementImpl;
    const [opener, creator] = BrowsingContext.create(parent, iframe, group);
    iframe.contentNavigable = new Navigable(createDocumentState(creator), parent.getNodeNavigable());
    topContext.virtualBrowsingContextGroupID = 41;
    opener.virtualBrowsingContextGroupID = 99;
    const [context, document] = BrowsingContext.createAuxiliary(opener);

    expect(opener.group).toBeNull();
    expect(context.group).toBe(group);
    expect(group.browsingContextSet).toEqual(new Set([topContext, context]));
    expect(context.isAuxiliary).toBe(true);
    expect(context.openerBrowsingContext).toBe(opener);
    expect(context.openerOriginAtCreation).toBe(creator.origin);
    expect(context.virtualBrowsingContextGroupID).toBe(41);
    expect(context.activeDocument).toBe(document);
    expect(document.origin).toBe(creator.origin);
    expect(document.internalAncestorOriginObjectsList).toEqual([]);
    expect(document.env.topLevelOrigin).toBe(creator.origin);
    expect(context.navigable).toBeNull();
    expect(parent.env.userAgent.topLevelTraversableSet.size).toBe(1);
  });

  it('requires the opener top-level browsing context to retain its group', async () => {
    const { context, group } = await fixture();
    group.remove(context);
    expect(() => BrowsingContext.createAuxiliary(context)).toThrow(InternalError);
    expect(() => BrowsingContext.createAuxiliary(new BrowsingContext())).toThrow(InternalError);
  });
});

describe('document origin determination', () => {
  it.each(['about:blank', 'about:blank?query#fragment', 'about:srcdoc', 'about:srcdoc#fragment'])(
    'retains source identity for %s, including document.domain changes', (text) => {
      const origin = obtainURLOrigin(parseURL('https://source.test/').url!);
      if (origin.kind !== 'tuple') throw new Error('Expected a tuple origin');
      const inherited = BrowsingContext.determineOrigin(parseURL(text).url, new SandboxingFlagSet(), origin);
      expect(inherited).toBe(origin);
      origin.domain = { kind: 'domain', value: 'test' };
      expect(inherited).toHaveProperty('domain', origin.domain);
    },
  );

  it.each([null, 'about:blank', 'about:srcdoc', 'https://target.test/'])(
    'creates fresh opaque origins before URL inheritance when sandboxed: %s', (text) => {
      const url = text === null ? null : parseURL(text).url!;
      const flags = new SandboxingFlagSet(['sandboxed-origin']);
      const first = BrowsingContext.determineOrigin(url, flags, null);
      const second = BrowsingContext.determineOrigin(url, flags, null);
      expect(first.kind).toBe('opaque');
      expect(second.kind).toBe('opaque');
      expect(first).not.toBe(second);
    },
  );

  it.each([null, 'about:blank', 'about:blanker', 'about:srcdoc?query', 'about://host/blank', 'data:text/html,'])(
    'uses a fresh opaque origin when %s has none to inherit', (text) => {
      const url = text === null ? null : parseURL(text).url!;
      const first = BrowsingContext.determineOrigin(url, new SandboxingFlagSet(), null);
      const second = BrowsingContext.determineOrigin(url, new SandboxingFlagSet(), null);
      expect(first.kind).toBe('opaque');
      expect(first).not.toBe(second);
    },
  );

  it('uses the URL origin for ordinary and Blob URLs instead of the source', () => {
    const source = obtainURLOrigin(parseURL('https://source.test/').url!);
    for (const text of ['https://target.test:8443/path', 'blob:https://target.test:8443/id']) {
      const result = BrowsingContext.determineOrigin(parseURL(text).url, new SandboxingFlagSet(), source);
      expect(serializeOrigin(result)).toBe('https://target.test:8443');
      expect(result).not.toBe(source);
    }
    expect(() => BrowsingContext.determineOrigin(parseURL('about:srcdoc').url, new SandboxingFlagSet(), null))
      .toThrow('Srcdoc origin determination requires a source origin');
  });
});

async function fixture(url = 'https://creation.test/creator?query#fragment') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  const document = unwrap<DocumentImpl>(browser.document);
  const context = document.browsingContext!;
  return { browser, document, context, group: context.group! };
}
