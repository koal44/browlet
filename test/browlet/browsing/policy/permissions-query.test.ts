import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import {
  DeclaredPermissionsPolicy, PermissionsPolicy, PermissionsPolicyAllowlist, type PolicyControlledFeature,
} from '../../../../src/browlet/browsing/policy/permissions-policy/policy';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLIFrameElement, Window } from '../../../../src/browlet/platform';
import { FetchResponse } from '../../../../src/fetch/response';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

declare const window: Window;

const feature = PermissionsPolicy.getSupportedFeature('cross-origin-isolated')!;
const supportedFeatures = ['cross-origin-isolated', 'deferred-fetch', 'deferred-fetch-minimal'];

describe('Permissions Policy §7.2: allowsFeature()', () => {
  it('checks the Document default origin and rejects unknown or differently cased feature names', async () => {
    const { browser } = await createBrowser();
    expect(await browser.evaluate(() => {
      const policy = window.document.permissionsPolicy;
      return {
        own: policy.allowsFeature('cross-origin-isolated'),
        undefined: policy.allowsFeature('cross-origin-isolated', undefined),
        same: policy.allowsFeature('cross-origin-isolated', 'https://parent.test/a'),
        other: policy.allowsFeature('cross-origin-isolated', 'https://other.test'),
        unknown: policy.allowsFeature('not-a-feature'),
        caseSensitive: policy.allowsFeature('Cross-Origin-Isolated'),
        unsupported: policy.allowsFeature('fullscreen'),
      };
    })).toEqual({ own: true, undefined: true, same: true, other: false, unknown: false, caseSensitive: false, unsupported: false });
  });

  // SPEC_GAP(permissions-policy-origin-argument): Chromium parses absolute URLs,
  // and rejects invalid/opaque results even when the policy contains a wildcard.
  it.each([
    ['https://parent.test', true],
    ['https://PARENT.test:443/a?b#c', true],
    ['https://user:pass@parent.test/', true],
    ['https://other.test:8443/path', true],
    ['blob:https://parent.test/id', true],
    ['', false],
    ['/relative', false],
    ['https://[invalid', false],
    ['about:blank', false],
    ['data:text/html,hello', false],
    ['null', false],
  ])('parses explicit origin %j with wildcard policy: %s', async (origin, expected) => {
    const { browser, document } = await createBrowser();
    declareFeature(document, '*');
    expect(await browser.evaluate((value: string) =>
      window.document.permissionsPolicy.allowsFeature('cross-origin-isolated', value), origin,
    )).toBe(expected);
  });

  it('rechecks declarations and inherited state through a retained inspection object', async () => {
    const { browser, document } = await createBrowser();
    const policy = browser.document.permissionsPolicy;
    expect(policy.allowsFeature(feature.name)).toBe(true);
    declareFeature(document, "'none'");
    expect(policy.allowsFeature(feature.name)).toBe(false);
    declareFeature(document, '*');
    expect(policy.allowsFeature(feature.name, 'https://other.test/')).toBe(true);
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(policy.allowsFeature(feature.name)).toBe(false);
    document.permissionsPolicyState = new PermissionsPolicy();
    expect(policy.allowsFeature(feature.name)).toBe(true);
    expect(browser.document.permissionsPolicy).toBe(policy);
  });

  it('does not confuse a query for another origin with permission at the default origin', async () => {
    const { browser, document } = await createBrowser();
    declareFeature(document, 'https://child.test');
    expect(browser.document.permissionsPolicy.allowsFeature(feature.name)).toBe(false);
    expect(browser.document.permissionsPolicy.allowsFeature(feature.name, 'https://child.test')).toBe(true);
  });

  it('uses current iframe attributes and limits the explicit-origin query to the observable policy', async () => {
    const { browser } = await createBrowser();
    expect(await browser.evaluate(() => {
      const iframe = window.document.createElement('iframe') as HTMLIFrameElement;
      const policy = iframe.permissionsPolicy;
      const initial = policy.allowsFeature('cross-origin-isolated');
      iframe.setAttribute('src', 'https://child.test/page');
      const undelegated = policy.allowsFeature('cross-origin-isolated');
      iframe.allow = 'cross-origin-isolated';
      const delegated = policy.allowsFeature('cross-origin-isolated');
      const explicitChild = policy.allowsFeature('cross-origin-isolated', 'https://child.test/');
      const unrelated = policy.allowsFeature('cross-origin-isolated', 'https://other.test/');
      iframe.allow = "cross-origin-isolated 'none'";
      const denied = policy.allowsFeature('cross-origin-isolated');
      iframe.allow = "cross-origin-isolated 'self'";
      iframe.setAttribute('srcdoc', '');
      const srcdoc = policy.allowsFeature('cross-origin-isolated');
      return { initial, undelegated, delegated, explicitChild, unrelated, denied, srcdoc };
    })).toEqual({ initial: true, undelegated: false, delegated: true, explicitChild: true, unrelated: false, denied: false, srcdoc: true });
  });

  it('requires the embedding policy to permit both the parent and intended child origins', async () => {
    const { browser, document } = await createBrowser();
    const iframe = browser.document.createElement('iframe') as HTMLIFrameElement;
    iframe.setAttribute('src', 'https://child.test/');
    iframe.allow = 'cross-origin-isolated *';
    const policy = iframe.permissionsPolicy;
    declareFeature(document, "'self'");
    expect(policy.allowsFeature(feature.name)).toBe(false);
    declareFeature(document, 'https://child.test');
    expect(policy.allowsFeature(feature.name)).toBe(false);
    declareFeature(document, "'self' https://child.test");
    expect(policy.allowsFeature(feature.name)).toBe(true);
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(policy.allowsFeature(feature.name)).toBe(false);
  });

  it('keeps inspection independent of the iframe loaded-child state', async () => {
    const { browser } = await createBrowser();
    const iframe = browser.document.createElement('iframe') as HTMLIFrameElement;
    iframe.setAttribute('src', 'https://child.test/');
    iframe.allow = 'cross-origin-isolated *';
    const implementation = unwrap<HTMLIFrameElementImpl>(iframe);
    // Child navigation is unfinished; fail if this query tries to inspect its private destination.
    Object.defineProperty(implementation, 'contentNavigable', {
      get() { throw new Error('Inspection must not read the loaded child'); },
    });
    expect(iframe.permissionsPolicy.allowsFeature(feature.name)).toBe(true);
    expect(iframe.permissionsPolicy.allowsFeature(feature.name, 'https://other.test')).toBe(false);
  });

  it('follows the new embedding Document after iframe adoption', async () => {
    const first = await createBrowser();
    const second = await createBrowser('https://other.test/');
    const iframe = first.browser.document.createElement('iframe') as HTMLIFrameElement;
    iframe.setAttribute('src', 'https://child.test/');
    iframe.allow = 'cross-origin-isolated *';
    const policy = iframe.permissionsPolicy;
    expect(policy.allowsFeature(feature.name)).toBe(true);
    declareFeature(second.document, "'none'");
    second.browser.document.adoptNode(iframe);
    expect(policy.allowsFeature(feature.name)).toBe(false);
    expect(iframe.permissionsPolicy).toBe(policy);
    declareFeature(second.document, '*');
    expect(policy.allowsFeature(feature.name)).toBe(true);
  });

  it('finishes Web IDL argument conversion before reading iframe policy state', async () => {
    const { browser } = await createBrowser();
    expect(await browser.evaluate(() => {
      const iframe = window.document.createElement('iframe') as HTMLIFrameElement;
      iframe.allow = "cross-origin-isolated 'none'";
      const order: string[] = [];
      const feature = { toString() { order.push('feature'); iframe.allow = 'cross-origin-isolated *'; return 'cross-origin-isolated'; } };
      const origin = { toString() { order.push('origin'); iframe.setAttribute('src', 'https://child.test/'); return 'https://child.test'; } };
      // @ts-expect-error Exercise Web IDL string conversion of author objects.
      const allowed = iframe.permissionsPolicy.allowsFeature(feature, origin);
      return { order, allowed };
    })).toEqual({ order: ['feature', 'origin'], allowed: true });
  });

  it('rejects missing arguments and invalid receivers through the binding', async () => {
    const { browser } = await createBrowser();
    expect(await browser.evaluate(() => {
      const policy = window.document.permissionsPolicy;
      let missing = false;
      let receiver = false;
      try {
        // @ts-expect-error The required feature name is intentionally omitted.
        policy.allowsFeature();
      } catch (error) { missing = error instanceof TypeError; }
      try { policy.allowsFeature.call({}, 'cross-origin-isolated'); } catch (error) { receiver = error instanceof TypeError; }
      return { missing, receiver };
    })).toEqual({ missing: true, receiver: true });
  });
});

describe('Permissions Policy §7.2: allowedFeatures()', () => {
  it('returns fresh realm-owned arrays and rejects an invalid receiver', async () => {
    const { browser } = await createBrowser();
    expect(await browser.evaluate(() => {
      const policy = window.document.permissionsPolicy;
      const first = policy.allowedFeatures();
      first.push('invented-feature');
      const second = policy.allowedFeatures();
      let illegalReceiver = false;
      try { policy.allowedFeatures.call({}); } catch (error) { illegalReceiver = error instanceof TypeError; }
      return {
        distinct: first !== second,
        realmArray: Object.getPrototypeOf(second) === Array.prototype,
        current: second,
        supported: policy.features(),
        illegalReceiver,
      };
    })).toEqual({
      distinct: true, realmArray: true, current: supportedFeatures, supported: supportedFeatures, illegalReceiver: true,
    });
  });

  it('filters by the current default origin and enforced policy, independently of supported features', async () => {
    const { browser, document } = await createBrowser();
    const policy = browser.document.permissionsPolicy;
    declareFeature(document, "'none'", true);
    expect(policy.allowedFeatures()).toEqual(supportedFeatures);
    declareFeature(document, 'https://other.test');
    expect(policy.allowedFeatures()).toEqual(['deferred-fetch', 'deferred-fetch-minimal']);
    expect(policy.features()).toEqual(supportedFeatures);
    declareFeature(document, '*');
    expect(policy.allowedFeatures()).toEqual(supportedFeatures);
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(policy.allowedFeatures()).toEqual(['deferred-fetch', 'deferred-fetch-minimal']);
    document.permissionsPolicyState = new PermissionsPolicy();
    document.origin = createOpaqueOrigin();
    expect(policy.allowedFeatures()).toEqual(supportedFeatures);
  });

  it('recomputes iframe permissions after source, allow, and sandbox changes', async () => {
    const { browser } = await createBrowser();
    expect(await browser.evaluate(() => {
      const iframe = window.document.createElement('iframe') as HTMLIFrameElement;
      const policy = iframe.permissionsPolicy;
      const initial = policy.allowedFeatures();
      iframe.setAttribute('src', 'https://child.test/');
      const undelegated = policy.allowedFeatures();
      iframe.allow = 'cross-origin-isolated';
      const delegated = policy.allowedFeatures();
      iframe.setAttribute('sandbox', '');
      iframe.allow = 'cross-origin-isolated *';
      const opaque = policy.allowedFeatures();
      iframe.allow = "cross-origin-isolated 'self'";
      const denied = policy.allowedFeatures();
      return { initial, undelegated, delegated, opaque, denied };
    })).toEqual({
      initial: supportedFeatures, undelegated: ['deferred-fetch-minimal'],
      delegated: [feature.name, 'deferred-fetch-minimal'], opaque: [feature.name, 'deferred-fetch-minimal'],
      denied: ['deferred-fetch-minimal'],
    });
  });

  it('uses the new parent policy after adoption while preserving earlier result arrays', async () => {
    const first = await createBrowser();
    const second = await createBrowser('https://other.test/');
    const iframe = first.browser.document.createElement('iframe') as HTMLIFrameElement;
    iframe.setAttribute('src', 'https://child.test/');
    iframe.allow = 'cross-origin-isolated *';
    const policy = iframe.permissionsPolicy;
    const before = policy.allowedFeatures();
    declareFeature(second.document, "'none'");
    second.browser.document.adoptNode(iframe);
    expect(policy.allowedFeatures()).toEqual(['deferred-fetch-minimal']);
    expect(before).toEqual([feature.name, 'deferred-fetch-minimal']);
    expect(iframe.permissionsPolicy).toBe(policy);
    declareFeature(second.document, '*');
    expect(policy.allowedFeatures()).toEqual([feature.name, 'deferred-fetch-minimal']);
  });
});

describe('Permissions Policy §7.2: getAllowlistForFeature()', () => {
  it.each([
    ['*', ['*']],
    ['(self "https://other.test")', ['https://parent.test', 'https://other.test']],
    ['(self "https://parent.test")', ['https://parent.test', 'https://parent.test']],
    ['(self "https://*.example.test:*")', ['https://parent.test', 'https://*.example.test:*']],
    ['()', []],
    // SPEC_CLASH(permissions-policy-allowlist-denied-origin): §7.2 hides this list;
    // Chromium exposes https://other.test even though the current origin is denied.
    ['"https://other.test"', []],
  ])('inspects parsed response declaration %s', async (value, expected) => {
    const { browser, document } = await createBrowser();
    const response = new FetchResponse();
    response.headerList.append('Permissions-Policy', `${feature.name}=${value}`);
    // Response association is a later slice; supply the existing parser's result directly.
    document.permissionsPolicyState.declaredPolicy = DeclaredPermissionsPolicy.fromResponse(response, document.origin, false);
    expect(browser.document.permissionsPolicy.getAllowlistForFeature(feature.name)).toEqual(expected);
  });

  it('uses default self, observes replacement and inherited denial, and ignores report-only declarations', async () => {
    const { browser, document } = await createBrowser();
    const policy = browser.document.permissionsPolicy;
    const original = policy.getAllowlistForFeature(feature.name);
    expect(original).toEqual(['https://parent.test']);
    declareFeature(document, "'none'", true);
    expect(policy.getAllowlistForFeature(feature.name)).toEqual(original);
    declareFeature(document, '*');
    expect(policy.getAllowlistForFeature(feature.name)).toEqual(['*']);
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(policy.getAllowlistForFeature(feature.name)).toEqual([]);
    document.permissionsPolicyState = new PermissionsPolicy();
    expect(policy.getAllowlistForFeature(feature.name)).toEqual(['https://parent.test']);
    expect(original).toEqual(['https://parent.test']);
  });

  it('keeps Binding conversion, receiver checks, and result-array allocation at the author boundary', async () => {
    const { browser } = await createBrowser();
    expect(await browser.evaluate(() => {
      const iframe = window.document.createElement('iframe') as HTMLIFrameElement;
      const policy = iframe.permissionsPolicy;
      const first = policy.getAllowlistForFeature('cross-origin-isolated');
      first.push('invented-origin');
      const second = policy.getAllowlistForFeature('cross-origin-isolated');
      let missing = false;
      let receiver = false;
      try {
        // @ts-expect-error The required feature name is intentionally omitted.
        policy.getAllowlistForFeature();
      } catch (error) { missing = error instanceof TypeError; }
      try { policy.getAllowlistForFeature.call({}, 'cross-origin-isolated'); } catch (error) { receiver = error instanceof TypeError; }
      const unknown = policy.getAllowlistForFeature('unknown');
      const caseSensitive = policy.getAllowlistForFeature('Cross-Origin-Isolated');
      const name = { toString() { iframe.allow = "cross-origin-isolated 'none'"; return 'cross-origin-isolated'; } };
      // @ts-expect-error Exercise Web IDL string conversion before the policy read.
      const afterConversion = policy.getAllowlistForFeature(name);
      return {
        distinct: first !== second, realmArray: Object.getPrototypeOf(second) === Array.prototype,
        second, missing, receiver, unknown, caseSensitive, afterConversion,
      };
    })).toEqual({
      distinct: true, realmArray: true, second: ['https://parent.test'], missing: true, receiver: true,
      unknown: [], caseSensitive: [], afterConversion: [],
    });
  });

  it('reports the iframe observable policy at its current origin, independently of the container wildcard', async () => {
    const first = await createBrowser();
    const second = await createBrowser('https://other.test/');
    const iframe = first.browser.document.createElement('iframe') as HTMLIFrameElement;
    const policy = iframe.permissionsPolicy;
    expect(policy.getAllowlistForFeature(feature.name)).toEqual(['https://parent.test']);
    iframe.setAttribute('src', 'https://child.test/');
    expect(policy.getAllowlistForFeature(feature.name)).toEqual([]);
    iframe.allow = 'cross-origin-isolated *';
    // The observable policy has inherited values and empty declarations; default self applies.
    expect(policy.getAllowlistForFeature(feature.name)).toEqual(['https://child.test']);
    iframe.setAttribute('srcdoc', '');
    expect(policy.getAllowlistForFeature(feature.name)).toEqual(['https://parent.test']);
    second.browser.document.adoptNode(iframe);
    expect(policy.getAllowlistForFeature(feature.name)).toEqual(['https://other.test']);
    declareFeature(second.document, "'none'");
    expect(policy.getAllowlistForFeature(feature.name)).toEqual([]);
  });

  it('serializes an opaque default or captured self origin as null without exposing its identity', () => {
    const document = createDocument();
    document.origin = createOpaqueOrigin();
    expect(document.permissionsPolicy.getAllowlistForFeature(feature.name)).toEqual(['null']);
    declareFeature(document, "'self'");
    expect(document.permissionsPolicy.getAllowlistForFeature(feature.name)).toEqual(['null']);
    declareFeature(document, '*');
    const iframe = createIframe(document);
    iframe.setAttributeValue('sandbox', '');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    expect(iframe.permissionsPolicy.getAllowlistForFeature(feature.name)).toEqual(['null']);
  });

  it('serializes captured origins before expressions, keeping the specified src-or-expressions branch', () => {
    const document = createDocument();
    const allowlist = new PermissionsPolicyAllowlist();
    allowlist.selfOrigin = document.origin;
    allowlist.srcOrigin = origin('https://child.test/');
    allowlist.expressions.add('https://other.test');
    // §7.2 includes src-origin serialization, though response headers do not currently populate it.
    document.permissionsPolicyState.declaredPolicy.declarations.set(feature, allowlist);
    expect(document.permissionsPolicy.getAllowlistForFeature(feature.name)).toEqual(['https://parent.test', 'https://child.test']);
    allowlist.srcOrigin = null;
    expect(document.permissionsPolicy.getAllowlistForFeature(feature.name)).toEqual(['https://parent.test', 'https://other.test']);
  });
});

describe('Permissions Policy §§9.7–9.9: query dependencies', () => {
  it('distinguishes delegation checks from the default allowlist applied to final checks', () => {
    const document = createDocument();
    const foreign = origin('https://other.test/');
    expect(document.getPolicyFeatureValue(feature, foreign, false)).toBe('Enabled');
    expect(document.permissionsPolicyState.check(feature, foreign, document.origin)).toBe('Disabled');
  });

  it('keeps report-only state separate and selects it only when requested', () => {
    const document = createDocument();
    const iframe = createIframe(document);
    iframe.setAttributeValue('src', 'https://child.test/');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    declareFeature(document, "'none'");
    declareFeature(document, '*', true);
    expect(document.reportOnlyPermissionsPolicyState).not.toBe(document.permissionsPolicyState);
    expect(PermissionsPolicy.getInheritedValue(feature, iframe, iframe.declaredOrigin)).toBe('Disabled');
    expect(PermissionsPolicy.getInheritedValue(feature, iframe, iframe.declaredOrigin, true)).toBe('Enabled');
    expect(iframe.permissionsPolicy.allowsFeature(feature.name)).toBe(false);
  });

  it('returns fresh observable iframe policies without copying parent declarations', () => {
    const document = createDocument();
    const iframe = createIframe(document);
    const first = iframe.permissionsPolicy.observablePolicy;
    const second = iframe.permissionsPolicy.observablePolicy;
    expect(first).not.toBe(second);
    expect(first.inheritedPolicy.get(feature)).toBe('Enabled');
    expect(first.declaredPolicy.declarations.size).toBe(0);
    expect(first.declaredPolicy.reportingConfiguration.size).toBe(0);
    expect(document.permissionsPolicy.observablePolicy).toBe(document.permissionsPolicyState);
    iframe.setAttributeValue('allow', "cross-origin-isolated 'none'");
    expect(iframe.permissionsPolicy.observablePolicy.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(first.inheritedPolicy.get(feature)).toBe('Enabled');
  });

  it('uses strict same-origin defaults even when document.domain values agree', () => {
    const document = createDocument('https://a.example.test/');
    const foreign = origin('https://b.example.test/');
    if (document.origin.kind !== 'tuple' || foreign.kind !== 'tuple') throw new Error('Expected tuple origins');
    document.origin.domain = { kind: 'domain', value: 'example.test' };
    foreign.domain = { kind: 'domain', value: 'example.test' };
    const iframe = createIframe(document);
    expect(PermissionsPolicy.getInheritedValue(feature, iframe, foreign)).toBe('Disabled');
    expect(document.permissionsPolicyState.check(feature, foreign, document.origin)).toBe('Disabled');
  });

  it('supports wildcard defaults and top-level inheritance without registering unsupported APIs', () => {
    const document = createDocument();
    const iframe = createIframe(document);
    const wildcard: PolicyControlledFeature = { name: 'test-feature', defaultAllowlist: '*' };
    const opaque = createOpaqueOrigin();
    expect(PermissionsPolicy.getInheritedValue(feature, null, opaque)).toBe('Enabled');
    expect(PermissionsPolicy.getInheritedValue(wildcard, iframe, opaque)).toBe('Enabled');
    expect(document.permissionsPolicyState.check(wildcard, opaque, document.origin)).toBe('Enabled');
    expect(document.permissionsPolicy.features()).toEqual(supportedFeatures);
  });

  it('permits an actual opaque default origin while rejecting an explicit opaque string', () => {
    const document = createDocument();
    document.origin = createOpaqueOrigin();
    expect(document.permissionsPolicy.allowsFeature(feature.name)).toBe(true);
    expect(document.permissionsPolicy.allowsFeature(feature.name, 'null')).toBe(false);
    declareFeature(document, '*');
    expect(document.permissionsPolicy.allowsFeature(feature.name, 'about:blank')).toBe(false);
    const iframe = createIframe(document);
    iframe.setAttributeValue('sandbox', '');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    expect(iframe.permissionsPolicy.allowsFeature(feature.name)).toBe(true);
  });
});

function origin(url: string): Origin {
  return obtainURLOrigin(parseURL(url).url!);
}

function createDocument(url = 'https://parent.test/'): DocumentImpl {
  const document = createTestDocument();
  document.url = parseURL(url).url!;
  document.origin = obtainURLOrigin(document.url);
  return document;
}

function createIframe(document: DocumentImpl): HTMLIFrameElementImpl {
  const iframe = document.createElementNode('iframe', HTML_NAMESPACE);
  if (!HTMLIFrameElementImpl.is(iframe)) throw new Error('Expected an iframe implementation');
  return iframe;
}

function declareFeature(document: DocumentImpl, value: string, reportOnly = false): void {
  const policy = reportOnly ? document.reportOnlyPermissionsPolicyState : document.permissionsPolicyState;
  policy.declaredPolicy.declarations = PermissionsPolicy.parseDirective(`${feature.name} ${value}`, document.origin);
}

async function createBrowser(url = 'https://parent.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  return { browser, document: unwrap<DocumentImpl>(browser.document) };
}
