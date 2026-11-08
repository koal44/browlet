import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../src/infra/index';
import { parseURL, serializeURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

describe('HTML protocol-handler invocation URL construction', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(async () => {
    const browser = new Browlet({ route: () => '<!doctype html>' });
    await browser.navigate('https://protocol.test/page');
    const env = getRelevantRealm(browser.window).env;
    const document = env.window.document;
    const userAgent = env.userAgent;
    const registry = userAgent.protocolHandlers;
    const consent = vi.spyOn(userAgent, 'requestProtocolHandlerConsent')
      .mockImplementation(() => userAgent.HostPromise.resolve(true, internalType<boolean>()));
    const handlerURL = parseURL('https://protocol.test/handler?url=%s').url!;
    return { document, userAgent, registry, consent, handlerURL };
  });

  it.each([
    ['opaque URL', 'web+browlet:hello', 'web%2Bbrowlet%3Ahello'],
    ['query and fragment', 'mailto:a+b@example.test?subject=x y&body=one%20two#end',
      'mailto%3Aa%2Bb%40example.test%3Fsubject%3Dx%2520y%26body%3Done%2520two%23end'],
    ['Unicode soup example', 'web+soup:chicken-kïwi', 'web%2Bsoup%3Achicken-k%25C3%25AFwi'],
    ['component punctuation and opaque spaces', "web+browlet:a b!$&'()*+,;=:@/[]~_-.",
      'web%2Bbrowlet%3Aa%20b!%24%26%27()*%2B%2C%3B%3D%3A%40%2F%5B%5D~_-.'],
    ['existing percent escapes', 'web+browlet:%s/%20/%25/%2f', 'web%2Bbrowlet%3A%25s%2F%2520%2F%2525%2F%252f'],
  ])('component-encodes the serialized %s before parsing the destination', async (_name, input, encoded) => {
    const { registry, document, handlerURL } = prepared();
    const inputURL = parseURL(input).url!;
    await registry.register(inputURL.scheme, handlerURL, document).backing;
    expect(serializeURL(registry.getInvocationURL(inputURL.scheme, handlerURL, inputURL)))
      .toBe(`https://protocol.test/handler?url=${encoded}`);
  });

  it.each(['user:password', 'user', ':password'])('strips input credentials %s without changing the input record', async (credentials) => {
    const { registry, document, handlerURL } = prepared();
    const inputURL = parseURL(`web+browlet://${credentials}@example.test:8021/path?x=%2F&y=2#end`).url!;
    const original = serializeURL(inputURL);
    await registry.register('web+browlet', handlerURL, document).backing;
    expect(serializeURL(registry.getInvocationURL('web+browlet', handlerURL, inputURL))).toBe(
      'https://protocol.test/handler?url=web%2Bbrowlet%3A%2F%2Fexample.test%3A8021%2Fpath%3Fx%3D%252F%26y%3D2%23end',
    );
    expect(serializeURL(inputURL)).toBe(original);
    expect(serializeURL(handlerURL)).toBe('https://protocol.test/handler?url=%s');
  });

  it('replaces only the first lowercase placeholder and does not rescan inserted data', async () => {
    const { registry, document } = prepared();
    const handlerURL = parseURL('https://protocol.test/path/%s?second=%s&literal=%25s#upper=%S').url!;
    const inputURL = parseURL('web+browlet:next%s').url!;
    await registry.register('web+browlet', handlerURL, document).backing;
    expect(serializeURL(registry.getInvocationURL('web+browlet', handlerURL, inputURL))).toBe(
      'https://protocol.test/path/web%2Bbrowlet%3Anext%25s?second=%s&literal=%25s#upper=%S',
    );
  });

  it('substitutes a username placeholder without clearing the handler template credentials', async () => {
    const { registry, document } = prepared();
    const handlerURL = parseURL('https://pre%s:handler-secret@protocol.test/path#%s').url!;
    const inputURL = parseURL('web+browlet:value').url!;
    await registry.register('web+browlet', handlerURL, document).backing;
    expect(serializeURL(registry.getInvocationURL('web+browlet', handlerURL, inputURL)))
      .toBe('https://preweb%2Bbrowlet%3Avalue:handler-secret@protocol.test/path#%s');
    expect(handlerURL.username).toBe('pre%s');
  });

  it('supports a fragment-only placeholder without changing the template query', async () => {
    const { registry, document } = prepared();
    const handlerURL = parseURL('https://protocol.test/path?keep=1#%s').url!;
    const inputURL = parseURL('web+browlet:part#fragment').url!;
    await registry.register('web+browlet', handlerURL, document).backing;
    expect(serializeURL(registry.getInvocationURL('web+browlet', handlerURL, inputURL)))
      .toBe('https://protocol.test/path?keep=1#web%2Bbrowlet%3Apart%23fragment');
  });

  it('requires an accepted exact pair, excluding unknown, pending, declined and removed requests', async () => {
    const { registry, userAgent, document, handlerURL, consent } = prepared();
    const inputURL = parseURL('web+browlet:hello').url!;
    const invoke = () => registry.getInvocationURL('web+browlet', handlerURL, inputURL);
    expect(invoke).toThrow('Protocol handler invocation requires an accepted registration');
    const decision = userAgent.HostPromise.withResolvers(internalType<boolean>());
    consent.mockReturnValueOnce(decision.promise);
    const pending = registry.register('web+browlet', handlerURL, document);
    expect(invoke).toThrow('Protocol handler invocation requires an accepted registration');
    decision.resolve(false);
    await pending.backing;
    expect(invoke).toThrow('Protocol handler invocation requires an accepted registration');
    registry.unregister('web+browlet', handlerURL);
    await registry.register('web+browlet', handlerURL, document).backing;
    expect(invoke().scheme).toBe('https');
    const otherTemplate = parseURL('https://protocol.test/other?url=%s').url!;
    expect(() => registry.getInvocationURL('web+browlet', otherTemplate, inputURL))
      .toThrow('Protocol handler invocation requires an accepted registration');
    registry.unregister('web+browlet', handlerURL);
    expect(invoke).toThrow('Protocol handler invocation requires an accepted registration');
  });

  it('asserts the input scheme matches the chosen registration', async () => {
    const { registry, document, handlerURL } = prepared();
    await registry.register('web+browlet', handlerURL, document).backing;
    const inputURL = parseURL('mailto:person@example.test').url!;
    expect(() => registry.getInvocationURL('web+browlet', handlerURL, inputURL))
      .toThrow('Protocol handler input scheme does not match');
  });

  it('returns a fresh URL each time without choosing a handler or navigating', async () => {
    const { registry, userAgent, document, handlerURL } = prepared();
    await registry.register('web+browlet', handlerURL, document).backing;
    const choose = vi.spyOn(userAgent, 'shouldHandleURLExternally');
    const inputURL = parseURL('web+browlet:hello').url!;
    const equivalentTemplate = parseURL('https://protocol.test:443/handler?url=%s').url!;
    const first = registry.getInvocationURL('web+browlet', equivalentTemplate, inputURL);
    first.query = 'changed';
    const second = registry.getInvocationURL('web+browlet', handlerURL, inputURL);
    expect(second).not.toBe(first);
    expect(second.path).not.toBe(first.path);
    expect(serializeURL(second)).toBe('https://protocol.test/handler?url=web%2Bbrowlet%3Ahello');
    expect(registry.getState('web+browlet', handlerURL)).toBe('accepted');
    expect(choose).not.toHaveBeenCalled();
    expect(() => userAgent.shouldHandleURLExternally(inputURL)).toThrow('External URL handler selection is not implemented');
  });
});
