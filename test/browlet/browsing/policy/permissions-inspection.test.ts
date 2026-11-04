import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { PermissionsPolicy } from '../../../../src/browlet/browsing/policy/permissions';
import type { PermissionsPolicyImpl } from '../../../../src/browlet/browsing/policy/permissions-policy';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLIFrameElement, Window } from '../../../../src/browlet/platform';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, serializeOrigin } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

declare const window: Window;

const supportedFeatures = ['cross-origin-isolated', 'deferred-fetch', 'deferred-fetch-minimal'];

describe('Permissions Policy §7.2: inspection object and supported features', () => {
  it.each(['https://example.test/', 'http://example.test/'])(
    'exposes stable, branded, getter-only inspection objects at %s', async (url) => {
      const browser = await createBrowser(url);
      expect(await browser.evaluate(() => {
        const document = window.document;
        const iframe = document.createElement('iframe') as HTMLIFrameElement;
        const policy = document.permissionsPolicy;
        const framePolicy = iframe.permissionsPolicy;
        const getter = Object.getOwnPropertyDescriptor(window.Document.prototype, 'permissionsPolicy')!;
        const frameGetter = Object.getOwnPropertyDescriptor(window.HTMLIFrameElement.prototype, 'permissionsPolicy')!;
        let illegalConstructor = false;
        let illegalDocument = false;
        let illegalFrame = false;
        let illegalOperation = false;
        try {
          // @ts-expect-error PermissionsPolicy has no author constructor; verify the runtime rejection.
          Reflect.construct(window.PermissionsPolicy, []);
        } catch (error) { illegalConstructor = error instanceof TypeError; }
        try { getter.get!.call({}); } catch (error) { illegalDocument = error instanceof TypeError; }
        try { frameGetter.get!.call(document.createElement('div')); } catch (error) { illegalFrame = error instanceof TypeError; }
        try { policy.features.call({}); } catch (error) { illegalOperation = error instanceof TypeError; }
        return {
          sameDocument: policy === document.permissionsPolicy,
          sameFrame: framePolicy === iframe.permissionsPolicy,
          distinct: policy !== framePolicy,
          documentBrand: policy instanceof window.PermissionsPolicy,
          frameBrand: framePolicy instanceof window.PermissionsPolicy,
          tag: Object.prototype.toString.call(policy),
          getterOnly: getter.set === undefined && frameGetter.set === undefined,
          rejectedWrite: !Reflect.set(document, 'permissionsPolicy', {}) && !Reflect.set(iframe, 'permissionsPolicy', {}),
          retained: document.permissionsPolicy === policy && iframe.permissionsPolicy === framePolicy,
          documentFeatures: policy.features(),
          frameFeatures: framePolicy.features(),
          illegalConstructor, illegalDocument, illegalFrame, illegalOperation,
        };
      })).toEqual({
        sameDocument: true, sameFrame: true, distinct: true,
        documentBrand: true, frameBrand: true, tag: '[object PermissionsPolicy]',
        getterOnly: true, rejectedWrite: true, retained: true,
        documentFeatures: supportedFeatures, frameFeatures: supportedFeatures,
        illegalConstructor: true, illegalDocument: true, illegalFrame: true, illegalOperation: true,
      });
    },
  );

  it('returns fresh realm-owned lists without filtering supported features by policy restrictions', async () => {
    const browser = await createBrowser();
    const document = unwrap<DocumentImpl>(browser.document);
    const feature = PermissionsPolicy.getSupportedFeature('cross-origin-isolated')!;
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(await browser.evaluate(() => {
      const policy = window.document.permissionsPolicy;
      const first = policy.features();
      const second = policy.features();
      first.push('invented-feature');
      second.length = 0;
      return {
        distinct: first !== second,
        realmArray: Object.getPrototypeOf(first) === Array.prototype,
        current: policy.features(),
      };
    })).toEqual({ distinct: true, realmArray: true, current: supportedFeatures });
  });

  it('gives detached Documents and cloned iframes their own inspection identities', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const document = window.document;
      const detached = document.implementation.createHTMLDocument('Detached');
      const iframe = document.createElement('iframe') as HTMLIFrameElement;
      const policy = iframe.permissionsPolicy;
      const clone = iframe.cloneNode() as HTMLIFrameElement;
      return {
        documentDistinct: detached.permissionsPolicy !== document.permissionsPolicy,
        documentStable: detached.permissionsPolicy === detached.permissionsPolicy,
        frameDistinct: clone.permissionsPolicy !== policy,
        frameStable: clone.permissionsPolicy === clone.permissionsPolicy,
        features: detached.permissionsPolicy.features(),
      };
    })).toEqual({
      documentDistinct: true, documentStable: true, frameDistinct: true, frameStable: true,
      features: supportedFeatures,
    });
  });

  it('uses the receiver realm when the first read borrows another Document getter', async () => {
    const source = await createBrowser();
    const other = await createBrowser('https://other.test/');
    const descriptor = Object.getOwnPropertyDescriptor(other.window.Document.prototype, 'permissionsPolicy')!;
    const policy = descriptor.get!.call(source.document) as object;

    expect(policy).toBe(source.document.permissionsPolicy);
    expect(Object.getPrototypeOf(policy)).toBe(source.window.PermissionsPolicy.prototype);
    expect(getRelevantRealm(policy)).toBe(getRelevantRealm(source.window));
    expect(unwrap<PermissionsPolicyImpl>(policy).associatedNode).toBe(unwrap(source.document));
  });

  it.each([false, true])('keeps the iframe owner across adoption (read before adoption: %s)', async (readBefore) => {
    const source = await createBrowser();
    const destination = await createBrowser('https://destination.test/');
    const iframe = source.document.createElement('iframe') as HTMLIFrameElement;
    const before = readBefore ? iframe.permissionsPolicy : undefined;
    destination.document.adoptNode(iframe);

    const descriptor = Object.getOwnPropertyDescriptor(destination.window.HTMLIFrameElement.prototype, 'permissionsPolicy')!;
    const policy = descriptor.get!.call(iframe) as object;
    const implementation = unwrap<PermissionsPolicyImpl>(policy);
    if (readBefore) expect(policy).toBe(before);
    expect(policy).toBe(iframe.permissionsPolicy);
    expect(Object.getPrototypeOf(policy)).toBe(source.window.PermissionsPolicy.prototype);
    expect(getRelevantRealm(policy)).toBe(getRelevantRealm(source.window));
    expect(implementation.associatedNode).toBe(unwrap(iframe));
    expect(implementation.defaultOrigin).toBe(unwrap<DocumentImpl>(destination.document).origin);
  });

  it('retains inspection identity when the internal Document policy is replaced', async () => {
    const browser = await createBrowser();
    const policy = browser.document.permissionsPolicy;
    const document = unwrap<DocumentImpl>(browser.document);
    document.permissionsPolicyState = new PermissionsPolicy();
    expect(browser.document.permissionsPolicy).toBe(policy);
    expect(unwrap<PermissionsPolicyImpl>(policy)).toBe(document.permissionsPolicy);
  });

  it('gives a new Document a new inspection object after navigation', async () => {
    const browser = await createBrowser();
    const oldDocument = browser.document;
    const oldPolicy = oldDocument.permissionsPolicy;
    await browser.navigate('https://example.test/next');

    expect(browser.document).not.toBe(oldDocument);
    expect(browser.document.permissionsPolicy).not.toBe(oldPolicy);
    expect(oldDocument.permissionsPolicy).toBe(oldPolicy);
    expect(getRelevantRealm(browser.document.permissionsPolicy)).toBe(getRelevantRealm(browser.window));
  });

  it('reads the associated Document origin each time', () => {
    const document = createTestDocument();
    const policy = document.permissionsPolicy;
    expect(policy.defaultOrigin).toBe(document.origin);
    document.origin = createOpaqueOrigin();
    expect(policy.defaultOrigin).toBe(document.origin);
    document.origin = obtainURLOrigin(parseURL('https://changed.test/').url!);
    expect(policy.defaultOrigin).toBe(document.origin);
  });

  it('reads current iframe attributes for the default origin without a loaded child', () => {
    const document = createTestDocument();
    document.url = parseURL('https://parent.test/page').url!;
    document.origin = obtainURLOrigin(document.url);
    const iframe = document.createElementNode('iframe', HTML_NAMESPACE);
    if (!HTMLIFrameElementImpl.is(iframe)) throw new Error('Expected an iframe implementation');
    const policy = iframe.permissionsPolicy;
    expect(policy.defaultOrigin).toBe(document.origin);
    iframe.setAttributeValue('src', 'https://child.test/');
    expect(serializeOrigin(policy.defaultOrigin)).toBe('https://child.test');
    iframe.setAttributeValue('srcdoc', '');
    expect(policy.defaultOrigin).toBe(document.origin);
    iframe.setAttributeValue('sandbox', '');
    expect(policy.defaultOrigin.kind).toBe('opaque');
    expect(policy.defaultOrigin).not.toBe(policy.defaultOrigin);
    expect(iframe.contentNavigable).toBeNull();
    expect(iframe.permissionsPolicy).toBe(policy);
  });
});

async function createBrowser(url = 'https://example.test/') {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(url);
  return browser;
}
