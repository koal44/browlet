import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { createDocument, getRelevantRealm, unwrap } from '../../../../src/browlet/bindings';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { BrowsingContext } from '../../../../src/browlet/browsing/browsing-context';
import { InsecureRequestsPolicy } from '../../../../src/browlet/browsing/policy/upgrade-insecure-requests';
import type { Destination } from '../../../../src/fetch/destination';
import { FetchRequest } from '../../../../src/fetch/request';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { parseURL, serializeURL } from '../../../../src/url/url';
import { createPolicyEnvironment } from './environment-fixture';

describe('Upgrade Insecure Requests: policy state', () => {
  it('defaults to no upgrades or opted-in navigation targets', () => {
    const policy = new InsecureRequestsPolicy();
    expect(policy.upgrade).toBe(false);
    expect(policy.shouldUpgradeNavigation(parseURL('http://example.test/').url!)).toBe(false);
  });

  it('enables upgrades and records the protected resource as a navigation target', () => {
    const policy = new InsecureRequestsPolicy();
    policy.enableFor(parseURL('https://example.test/document').url!);
    expect(policy.upgrade).toBe(true);
    expect(policy.shouldUpgradeNavigation(parseURL('http://example.test/next').url!)).toBe(true);
    expect(policy.shouldUpgradeNavigation(parseURL('http://other.test/').url!)).toBe(false);
  });

  it('matches navigation hosts and ports, keeping different applications on different ports distinct', () => {
    const policy = new InsecureRequestsPolicy();
    policy.enableFor(parseURL('https://example.test:8443/').url!);
    expect(policy.shouldUpgradeNavigation(parseURL('http://EXAMPLE.test:8443/next').url!)).toBe(true);
    expect(policy.shouldUpgradeNavigation(parseURL('http://example.test:8080/').url!)).toBe(false);
    expect(policy.shouldUpgradeNavigation(parseURL('http://example.test/').url!)).toBe(false);
    expect(policy.shouldUpgradeNavigation(parseURL('http://sub.example.test:8443/').url!)).toBe(false);
  });

  it('copies navigation targets independently when inheriting', () => {
    const policy = new InsecureRequestsPolicy();
    const original = parseURL('https://example.test/').url!;
    const extra = parseURL('https://extra.test/').url!;
    policy.enableFor(original);
    const inherited = policy.clone();
    inherited.enableFor(extra);
    expect(inherited.upgrade).toBe(true);
    expect(inherited.shouldUpgradeNavigation(original)).toBe(true);
    expect(inherited.shouldUpgradeNavigation(extra)).toBe(true);
    expect(policy.shouldUpgradeNavigation(extra)).toBe(false);
  });
});

describe('Upgrade Insecure Requests: request upgrading', () => {
  const env = createPolicyEnvironment('https://page.test/');
  env.insecureRequestsPolicy.enableFor(env.creationURL);

  it.each([
    ['http://resource.test/script.js', 'https://resource.test/script.js'],
    ['http://resource.test:80/', 'https://resource.test/'],
    ['http://resource.test:443/', 'https://resource.test/'],
    ['http://resource.test:8080/', 'https://resource.test:8080/'],
    ['http://192.0.2.1/', 'https://192.0.2.1/'],
    ['http://[2001:db8::1]/', 'https://[2001:db8::1]/'],
  ])('upgrades an opted-in subresource from %s to %s', (input, expected) => {
    const request = new FetchRequest(parseURL(input).url!, env, env.userAgent);
    request.destination = 'script';
    request.upgradeInsecureRequest();
    expect(serializeURL(request.currentURL)).toBe(expected);
    expect(request.headerList.get('Upgrade-Insecure-Requests')).toBeNull();
  });

  it('requires an enabled policy and an initiating client', () => {
    const client = createPolicyEnvironment('https://page.test/');
    const request = new FetchRequest(parseURL('http://page.test/').url!, client, client.userAgent);
    request.destination = 'document';
    request.upgradeInsecureRequest();
    expect(request.currentURL.scheme).toBe('http');
    expect(request.headerList.get('Upgrade-Insecure-Requests')).toBe('1');
    client.insecureRequestsPolicy.enableFor(client.creationURL);
    request.client = null;
    request.upgradeInsecureRequest();
    expect(request.currentURL.scheme).toBe('http');
    expect(request.headerList.get('Upgrade-Insecure-Requests')).toBe('1');
  });

  it('also applies an explicit policy set by an HTTP document', () => {
    const client = createPolicyEnvironment('http://page.test/');
    client.insecureRequestsPolicy.enableFor(client.creationURL);
    const request = new FetchRequest(parseURL('http://resource.test/').url!, client, client.userAgent);
    request.upgradeInsecureRequest();
    expect(request.currentURL.scheme).toBe('https');
  });

  it.each([
    'http://localhost/', 'http://service.localhost:8000/', 'http://127.3.2.1/', 'http://[::1]/',
    'https://resource.test/', 'data:,hello', 'ftp://resource.test/',
  ])('preserves trustworthy HTTP and non-HTTP URLs: %s', (input) => {
    const request = new FetchRequest(parseURL(input).url!, env, env.userAgent);
    request.upgradeInsecureRequest();
    expect(serializeURL(request.currentURL)).toBe(input);
  });

  it.each([
    ['http://page.test/next', 'https://page.test/next'],
    ['http://page.test:8080/next', 'http://page.test:8080/next'],
    ['http://other.test/next', 'http://other.test/next'],
  ])('only upgrades an opted-in top-level navigation target: %s', (input, expected) => {
    const request = new FetchRequest(parseURL(input).url!, env, env.userAgent);
    request.destination = 'document';
    request.upgradeInsecureRequest();
    expect(serializeURL(request.currentURL)).toBe(expected);
    expect(request.headerList.get('Upgrade-Insecure-Requests')).toBe('1');
  });

  it.each<Destination>(['iframe', 'frame', 'object', 'embed'])(
    'upgrades cross-origin nested navigation with destination %s', (destination) => {
      const request = new FetchRequest(parseURL('http://other.test/').url!, env, env.userAgent);
      request.destination = destination;
      request.upgradeInsecureRequest();
      expect(request.currentURL.scheme).toBe('https');
      expect(request.headerList.get('Upgrade-Insecure-Requests')).toBe('1');
    },
  );

  it.each(['GET', 'POST'])('upgrades cross-origin top-level %s forms', (method) => {
    const request = new FetchRequest(parseURL('http://other.test/submit').url!, env, env.userAgent);
    request.destination = 'document';
    request.method = method;
    request.isFormSubmission = true;
    request.upgradeInsecureRequest();
    expect(request.currentURL.scheme).toBe('https');
    expect(request.clone().isFormSubmission).toBe(true);
  });

  it('advertises support on HTTPS navigations without duplicating the header on redirects', () => {
    const request = new FetchRequest(parseURL('https://page.test/').url!, env, env.userAgent);
    request.destination = 'document';
    request.upgradeInsecureRequest();
    request.urlList.push(parseURL('http://page.test/redirected').url!);
    request.upgradeInsecureRequest();
    expect(request.headerList.get('Upgrade-Insecure-Requests')).toBe('1');
    expect(request.urlList.map((url) => serializeURL(url))).toEqual([
      'https://page.test/', 'https://page.test/redirected',
    ]);
  });

  it('rechecks redirect targets without rewriting earlier hops', () => {
    const request = new FetchRequest(parseURL('http://page.test/first').url!, env, env.userAgent);
    request.urlList.push(parseURL('http://other.test/redirected').url!);
    request.destination = 'document';
    request.upgradeInsecureRequest();
    expect(request.currentURL.scheme).toBe('http');
    request.destination = 'script';
    request.upgradeInsecureRequest();
    expect(request.urlList.map((url) => serializeURL(url))).toEqual([
      'http://page.test/first', 'https://other.test/redirected',
    ]);
  });
});

describe('Upgrade Insecure Requests: browsing-context inheritance', () => {
  it('copies the embedding document\'s enabled policy independently', () => {
    const env = createPolicyEnvironment('https://parent.test/');
    env.insecureRequestsPolicy.enableFor(env.creationURL);
    const embedder = env.window.getAssociatedDocument().createElementNode('iframe', HTML_NAMESPACE);
    const context = new BrowsingContext();

    context.inheritInsecureRequestsPolicy(embedder);

    expect(context.insecureRequestsPolicy.upgrade).toBe(true);
    expect(context.insecureRequestsPolicy).not.toBe(env.insecureRequestsPolicy);
    expect(context.insecureRequestsPolicy.shouldUpgradeNavigation(env.creationURL)).toBe(true);
    const laterTarget = parseURL('https://later.test/').url!;
    env.insecureRequestsPolicy.enableFor(laterTarget);
    expect(context.insecureRequestsPolicy.shouldUpgradeNavigation(laterTarget)).toBe(false);
  });

  it.each([[false, true], [true, false], [true, true]])(
    'inherits the current document after adoption (creation=%s, embedding=%s)',
    (creationUpgrade, embeddingUpgrade) => {
      const creationEnv = createPolicyEnvironment('https://creation.test/');
      const embeddingEnv = createPolicyEnvironment('https://embedding.test/', creationEnv);
      if (creationUpgrade) creationEnv.insecureRequestsPolicy.enableFor(creationEnv.creationURL);
      if (embeddingUpgrade) embeddingEnv.insecureRequestsPolicy.enableFor(embeddingEnv.creationURL);
      const embedder = creationEnv.window.getAssociatedDocument().createElementNode('iframe', HTML_NAMESPACE);
      const embeddingDocument = embeddingEnv.window.getAssociatedDocument();

      // Supply adoption's node-document change while the DOM adoption algorithm
      // is unfinished. Real bindings retain the element's original realm.
      embedder.nodeDocument = embeddingDocument;
      expect(embedder.nodeDocument).toBe(embeddingDocument);
      expect(getRelevantRealm(embedder)).toBe(creationEnv.realm);
      const context = new BrowsingContext();

      context.inheritInsecureRequestsPolicy(embedder);

      expect(context.insecureRequestsPolicy.upgrade).toBe(embeddingUpgrade);
      expect(context.insecureRequestsPolicy).not.toBe(embeddingEnv.insecureRequestsPolicy);
      expect(context.insecureRequestsPolicy.shouldUpgradeNavigation(embeddingEnv.creationURL)).toBe(embeddingUpgrade);
      expect(context.insecureRequestsPolicy.shouldUpgradeNavigation(creationEnv.creationURL)).toBe(false);
    },
  );
});

describe('Upgrade Insecure Requests: document initialization', () => {
  it('copies browsing-context policy into the new Window environment before scripts run', async () => {
    const browlet = new Browlet({ route: () => '' });
    const context = unwrap<DocumentImpl>(browlet.document).browsingContext!;
    // This is the state a future iframe creator will inherit from its embedding document.
    context.insecureRequestsPolicy.enableFor(parseURL('https://parent.test/').url!);
    await browlet.navigate('https://child.test/');
    const env = getRelevantRealm(browlet.window).env;
    expect(env.insecureRequestsPolicy.upgrade).toBe(true);
    expect(env.insecureRequestsPolicy).not.toBe(context.insecureRequestsPolicy);
    expect(env.insecureRequestsPolicy.shouldUpgradeNavigation(parseURL('http://parent.test/').url!)).toBe(true);
    env.insecureRequestsPolicy.enableFor(parseURL('https://child.test/').url!);
    expect(context.insecureRequestsPolicy.shouldUpgradeNavigation(parseURL('http://child.test/').url!)).toBe(false);
  });

  it('does not carry the previous document\'s own directive into an unrelated navigation', async () => {
    const browlet = new Browlet({ route: () => '' });
    await browlet.navigate('https://first.test/');
    const first = getRelevantRealm(browlet.window).env;
    first.insecureRequestsPolicy.enableFor(first.creationURL);
    await browlet.navigate('https://second.test/');
    expect(getRelevantRealm(browlet.window).env.insecureRequestsPolicy.upgrade).toBe(false);
  });

  it('clears the previous document\'s directive when HTML reuses its Window', () => {
    const env = createPolicyEnvironment('https://example.test/');
    const previous = env.window.getAssociatedDocument();
    env.insecureRequestsPolicy.enableFor(previous.url);
    const next = createDocument(env.realm);
    next.browsingContext = previous.browsingContext;
    env.window.setAssociatedDocument(next);
    next.initializeInsecureRequestsPolicy();
    expect(env.insecureRequestsPolicy.upgrade).toBe(false);
    expect(env.insecureRequestsPolicy.shouldUpgradeNavigation(previous.url)).toBe(false);
  });
});
