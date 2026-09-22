import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import {
  createDocument, createWindowEnvironment, getRelevantRealm,
} from '../../../../src/browlet/bindings';
import { WindowImpl } from '../../../../src/browlet/browsing/window/window';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import { createEnvironmentRecord } from '../../../../src/browlet/scripting/environment';
import { WindowRealm } from '../../../../src/browlet/scripting/realm';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { createOpaqueOrigin, type Origin, type TupleOrigin } from '../../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../../src/url/url';
import { BindingWorld, defineInterface, idlType, roAttr, xattr } from '../../../../src/web-idl/index';

describe('Secure Contexts: origin trustworthiness', () => {
  const userAgent = new UserAgent();

  it.each([
    ['https://example.test/', true], ['https://example.test:8080/', true],
    ['wss://example.test/', true], ['http://example.test/', false],
    ['http://example.test:443/', false], ['ws://example.test/', false],
    ['ftp://example.test/', false], ['file:///C:/example.txt', true],
    ['http://127.0.0.0/', true], ['http://127.255.255.255/', true],
    ['http://127.1/', true], ['http://0x7f000001/', true],
    ['http://126.255.255.255/', false], ['http://128.0.0.1/', false],
    ['http://0.0.0.0/', false], ['http://192.168.0.1/', false],
    ['http://[::1]/', true], ['http://[0:0:0:0:0:0:0:1]/', true],
    ['http://[::]/', false], ['http://[::2]/', false],
    ['http://[::ffff:127.0.0.1]/', false], ['http://[1::1]/', false],
    ['http://localhost/', true], ['http://localhost./', true],
    ['http://sub.localhost/', true], ['http://sub.localhost./', true],
    ['http://deep.sub.LOCALHOST:8080/', true], ['ws://localhost/', true],
    ['http://localhost.example.test/', false], ['http://notlocalhost/', false],
    ['http://localhost../', false], ['http://localhost.localdomain/', false],
    ['about:blank', false], ['about:srcdoc', false],
    ['data:text/plain,hello', false], ['javascript:42', false],
    ['mailto:user@example.test', false], ['custom://example.test/', false],
  ] as const)('classifies the origin of %s as %s', (input, expected) => {
    const origin = obtainURLOrigin(parseURL(input).url!);

    expect(userAgent.isOriginPotentiallyTrustworthy(origin)).toBe(expected);
  });

  it('honors the trust decision carried by an opaque origin', () => {
    expect(userAgent.isOriginPotentiallyTrustworthy(createOpaqueOrigin())).toBe(false);
    expect(userAgent.isOriginPotentiallyTrustworthy(createOpaqueOrigin(true))).toBe(true);
  });

  it('does not let document.domain change the trust decision', () => {
    const origin = tupleOriginFor('http://example.test/');
    origin.domain = { kind: 'domain', value: 'localhost' };

    expect(userAgent.isOriginPotentiallyTrustworthy(origin)).toBe(false);
  });

  it('supports authenticated schemes for tuple origins supplied by their protocol', () => {
    const configured = new UserAgent();
    const origin: TupleOrigin = {
      kind: 'tuple', scheme: 'app', host: { kind: 'domain', value: 'example' },
      port: null, domain: null,
    };

    expect(configured.isOriginPotentiallyTrustworthy(origin)).toBe(false);
    configured.authenticatedSchemes.add('app');
    expect(configured.isOriginPotentiallyTrustworthy(origin)).toBe(true);
    expect(userAgent.isOriginPotentiallyTrustworthy(origin)).toBe(false);
    expect(configured.isOriginPotentiallyTrustworthy(createOpaqueOrigin())).toBe(false);
  });

  it('matches configured origins by scheme, host, and port within one user agent', () => {
    const configured = new UserAgent();
    const origin = tupleOriginFor('http://example.test:8080/');
    const sameOrigin = tupleOriginFor('http://EXAMPLE.test:8080/other');
    sameOrigin.domain = { kind: 'domain', value: 'test' };
    configured.trustworthyOrigins.push(origin);

    expect(configured.isOriginPotentiallyTrustworthy(sameOrigin)).toBe(true);
    expect(userAgent.isOriginPotentiallyTrustworthy(sameOrigin)).toBe(false);
    for (const input of ['http://example.test/', 'http://sub.example.test:8080/', 'ws://example.test:8080/']) {
      expect(configured.isOriginPotentiallyTrustworthy(tupleOriginFor(input)), input).toBe(false);
    }
  });
});

describe('Secure Contexts: URL trustworthiness', () => {
  const userAgent = new UserAgent();

  it.each([
    ['about:blank', true], ['about:blank?query#fragment', true],
    ['about:srcdoc', true], ['about:srcdoc?query#fragment', true],
    ['about:BLANK', false], ['about:config', false], ['about:blank/extra', false],
    ['about://example.test/blank', false], ['data:text/plain,hello', true],
    ['https://example.test/', true], ['http://example.test/', false],
    ['http://localhost/', true], ['file:///C:/example.txt', true],
    ['javascript:42', false], ['custom://example.test/', false],
    ['blob:https://example.test/id', true], ['blob:http://example.test/id', false],
    ['blob:file:///C:/example.txt', true], ['blob:null/id', false],
    ['blob:blob:https://example.test/id', false],
  ] as const)('classifies %s as %s', (input, expected) => {
    expect(userAgent.isURLPotentiallyTrustworthy(parseURL(input).url!)).toBe(expected);
  });

  it.each([
    ['https://example.test/', true], ['http://example.test/', false],
    ['file:///C:/example.txt', true], ['data:text/plain,hello', false],
  ] as const)('uses the stored blob creator origin from %s', (creatorURL, expected) => {
    const origin = obtainURLOrigin(parseURL(creatorURL).url!);
    const url = parseURL(expected ? 'blob:http://misleading.test/id' : 'blob:https://misleading.test/id').url!;
    url.blobURLEntry = { environment: { origin } };

    expect(obtainURLOrigin(url)).toBe(origin);
    expect(userAgent.isURLPotentiallyTrustworthy(url)).toBe(expected);
  });

  it('uses the user agent\'s configured origins for URLs, including blobs', () => {
    const configured = new UserAgent();
    configured.trustworthyOrigins.push(tupleOriginFor('http://example.test/'));
    for (const input of ['http://example.test:80/path', 'blob:http://example.test/id']) {
      const url = parseURL(input).url!;
      expect(configured.isURLPotentiallyTrustworthy(url)).toBe(true);
      expect(userAgent.isURLPotentiallyTrustworthy(url)).toBe(false);
    }
  });
});

describe('Secure Contexts: Window classification', () => {
  it('starts a creatorless about:blank Window with an untrusted opaque origin', async () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);

    expect(realm.environment.origin.kind).toBe('opaque');
    expect(realm.environmentRecord).toBe(realm.environment);
    expect(realm.secureContext).toBe(false);
    expect(realm.environment.isSecureContext).toBe(false);
    expect(await browlet.evaluate(() => isSecureContext)).toBe(false);
  });

  it.each([
    ['https://example.test/', true], ['http://example.test/', false],
    ['http://127.0.0.1/', true], ['http://sub.localhost/', true],
    ['file:///C:/example.html', true], ['data:text/html,hello', false],
  ] as const)('classifies navigation to %s as %s before running scripts', async (url, expected) => {
    const browlet = new Browlet({
      route: () => '<script>document.title = String(isSecureContext)</script>',
    });
    await browlet.navigate(url);
    const realm = getRelevantRealm(browlet.window);

    expect(realm.secureContext).toBe(expected);
    expect(realm.environmentRecord).toBe(realm.environment);
    expect(realm.environment.isSecureContext).toBe(expected);
    expect(browlet.window.isSecureContext).toBe(expected);
    expect(browlet.document.title).toBe(String(expected));
    expect(await browlet.evaluate(() => isSecureContext)).toBe(expected);
  });

  it('keeps the old Window decision when navigation replaces its realm', async () => {
    const browlet = new Browlet({ route: () => '' });
    await browlet.navigate('https://example.test/');
    const secureRealm = getRelevantRealm(browlet.window);
    const oldWindow = secureRealm.globalObject;
    await browlet.navigate('http://example.test/');

    expect(getRelevantRealm(browlet.window)).not.toBe(secureRealm);
    expect(browlet.window.isSecureContext).toBe(false);
    expect(Reflect.get(oldWindow, 'isSecureContext')).toBe(true);
    expect(secureRealm.environment.isSecureContext).toBe(true);
  });

  it('uses configured trust at creation without changing an existing Window', async () => {
    const browlet = new Browlet({ route: () => '' });
    const userAgent = getRelevantRealm(browlet.window).environment.userAgent;
    userAgent.trustworthyOrigins.push(tupleOriginFor('http://example.test/'));
    await browlet.navigate('http://example.test/');

    expect(browlet.window.isSecureContext).toBe(true);
    userAgent.trustworthyOrigins.length = 0;
    expect(browlet.window.isSecureContext).toBe(true);
    await browlet.navigate('http://example.test/next');
    expect(browlet.window.isSecureContext).toBe(false);
  });

  it('carries a reserved environment decision through Window creation', () => {
    const userAgent = new UserAgent();
    const creationURL = parseURL('http://example.test/').url!;
    const origin = obtainURLOrigin(creationURL);
    userAgent.trustworthyOrigins.push(tupleOriginFor('http://example.test/'));
    const reservedEnvironment = createEnvironmentRecord({
      userAgent, creationURL, topLevelCreationURL: creationURL, topLevelOrigin: origin,
      targetBrowsingContext: null,
      isSecureContext: userAgent.isOriginPotentiallyTrustworthy(origin),
    });
    expect(reservedEnvironment.isSecureContext).toBe(true);
    userAgent.trustworthyOrigins.length = 0;

    const environment = createWindowEnvironment({
      agent: new WindowAgent(), userAgent, creationURL, origin, parent: null, reservedEnvironment,
      topLevelCreationURL: creationURL, topLevelOrigin: origin,
    });
    const { window } = environment;

    expect(window.isSecureContext).toBe(true);
    expect(environment.isSecureContext).toBe(true);
    expect(environment.realm.secureContext).toBe(true);
  });

  it('uses the selected inherited origin for about:blank', () => {
    const userAgent = new UserAgent();
    const secure = createWindow(userAgent, tupleOriginFor('https://example.test/'));
    const insecure = createWindow(userAgent, tupleOriginFor('http://example.test/'));
    const opaque = createWindow(userAgent, createOpaqueOrigin());

    expect(secure.isSecureContext).toBe(true);
    expect(insecure.isSecureContext).toBe(false);
    expect(opaque.isSecureContext).toBe(false);
  });

  it('rejects an insecure intermediate ancestor beneath a secure top-level Window', () => {
    const userAgent = new UserAgent();
    const secureOrigin = tupleOriginFor('https://example.test/');
    const top = createWindow(userAgent, secureOrigin);
    const secureChild = createWindow(userAgent, secureOrigin, top);
    const insecureChild = createWindow(userAgent, tupleOriginFor('http://example.test/'), top);
    const grandchild = createWindow(userAgent, secureOrigin, insecureChild);

    expect(top.isSecureContext).toBe(true);
    expect(secureChild.isSecureContext).toBe(true);
    expect(insecureChild.isSecureContext).toBe(false);
    expect(grandchild.isSecureContext).toBe(false);
    expect(createWindow(userAgent, secureOrigin, grandchild).isSecureContext).toBe(false);
  });
});

describe('Secure Contexts: Web IDL exposure', () => {
  it.each([
    ['https://example.test/', true], ['http://example.test/', false],
  ] as const)('decides exposure for %s before settings are published', (url, expected) => {
    const userAgent = new UserAgent();
    const creationURL = parseURL(url).url!;
    const origin = obtainURLOrigin(creationURL);
    const record = createEnvironmentRecord({
      userAgent, creationURL, topLevelCreationURL: creationURL, topLevelOrigin: origin,
      targetBrowsingContext: null,
      isSecureContext: userAgent.isOriginPotentiallyTrustworthy(origin),
    });
    const realm = new WindowRealm(new WindowImpl(new URL(url)), {
      agent: new WindowAgent(), environmentRecord: record,
    });
    const world = new BindingWorld([
      defineInterface({
        name: 'SecureProbe', exposed: ['Window'], members: [], ...xattr('SecureContext'),
      }),
      defineInterface({
        name: 'OrdinaryProbe', exposed: ['Window'],
        members: [roAttr('secureMember', idlType.boolean, xattr('SecureContext'))],
      }),
    ]);
    const target = realm.createOrdinaryObject(null);
    world.register(realm).install(target);

    expect(realm.hostDefined).toBeUndefined();
    expect(() => realm.environment).toThrow('Realm has no environment');
    expect(realm.environmentRecord).toBe(record);
    expect(realm.secureContext).toBe(expected);
    expect(Reflect.has(target, 'SecureProbe')).toBe(expected);
    const constructor = Reflect.get(target, 'OrdinaryProbe') as { prototype: object; };
    expect(Reflect.has(constructor.prototype, 'secureMember')).toBe(expected);

    const environment = createWindowEnvironment({
      agent: new WindowAgent(), userAgent, creationURL, origin, parent: null, reservedEnvironment: record,
      topLevelCreationURL: creationURL, topLevelOrigin: origin,
    });
    const installedTarget = environment.realm.createOrdinaryObject(null);
    world.register(environment.realm).install(installedTarget);
    expect(environment.realm.environmentRecord).toBe(environment);
    expect(environment.realm.hostDefined).toBe(environment);
    expect(environment.realm.environment).toBe(environment);
    expect(environment.realm.secureContext).toBe(expected);
    expect(environment.isSecureContext).toBe(expected);
    expect(Reflect.has(installedTarget, 'SecureProbe')).toBe(expected);
    const installedConstructor = Reflect.get(installedTarget, 'OrdinaryProbe') as { prototype: object; };
    expect(Reflect.has(installedConstructor.prototype, 'secureMember')).toBe(expected);
  });
});

function tupleOriginFor(input: string): TupleOrigin {
  const origin = obtainURLOrigin(parseURL(input).url!);
  if (origin.kind !== 'tuple') throw new Error('Expected a tuple origin in the fixture');
  return origin;
}

// Compose real Window bindings while iframe/creator navigation remains unimplemented.
function createWindow(userAgent: UserAgent, origin: Origin, parent: WindowImpl | null = null): WindowImpl {
  const creationURL = parseURL('about:blank').url!;
  const environment = createWindowEnvironment({
    agent: new WindowAgent(), userAgent, creationURL, origin, parent,
    topLevelCreationURL: creationURL, topLevelOrigin: origin,
  });
  const { window } = environment;
  const document = createDocument(environment.realm);
  document.setOrigin(origin);
  document.setURL(creationURL);
  window.setAssociatedDocument(document);
  return window;
}
