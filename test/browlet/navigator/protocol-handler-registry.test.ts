import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../src/infra/index';
import { parseURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';
import { createSiblingWindow } from '../../support/windows';

describe('HTML protocol-handler registration decisions', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(createFixture);

  it.each([true, false])('remembers acceptance=%s and shares a pending decision for the same normalized pair', async (accepted) => {
    const { registry, userAgent, document, consent, verify, url } = prepared();
    const decision = userAgent.HostPromise.withResolvers(internalType<boolean>());
    consent.mockReturnValue(decision.promise);
    const first = registry.register('web+browlet', url, document);
    const second = registry.register('web+browlet', url, document);
    expect(second).toBe(first);
    expect(registry.getState('web+browlet', url)).toBe('pending');
    expect(consent).toHaveBeenCalledExactlyOnceWith('web+browlet', url, document);
    expect(verify).not.toHaveBeenCalled();

    decision.resolve(accepted);
    await first.backing;
    expect(registry.getState('web+browlet', url)).toBe(accepted ? 'accepted' : 'declined');
    await registry.register('web+browlet', parseURL('https://protocol.test:443/handler?url=%s').url!, document).backing;
    expect(consent).toHaveBeenCalledTimes(1);
  });

  it.each(['autoAccept', 'autoReject'] as const)('verifies %s and bypasses the consent host', async (mode) => {
    const { registry, document, consent, verify, url } = prepared();
    expect(document.protocolHandlerAutomationMode).toBe('none');
    document.protocolHandlerAutomationMode = mode;
    await registry.register('web+browlet', url, document).backing;
    expect(verify).toHaveBeenCalledExactlyOnceWith(document);
    expect(consent).not.toHaveBeenCalled();
    expect(registry.getState('web+browlet', url)).toBe(mode === 'autoAccept' ? 'accepted' : 'declined');
  });

  it('shares browser decisions across Documents without sharing their automation modes', async () => {
    const { browser, registry, document, consent, url } = prepared();
    const sibling = createSiblingWindow(browser);
    const siblingEnv = getRelevantRealm(sibling).env;
    const siblingDocument = siblingEnv.window.document;
    document.protocolHandlerAutomationMode = 'autoAccept';
    expect(siblingDocument.protocolHandlerAutomationMode).toBe('none');
    expect(siblingEnv.userAgent.protocolHandlers).toBe(registry);
    await registry.register('web+browlet', url, document).backing;
    await registry.register('web+browlet', url, siblingDocument).backing;
    expect(consent).not.toHaveBeenCalled();
    expect(registry.getState('web+browlet', url)).toBe('accepted');
  });

  it('runs the real Navigator and UserAgent entries in parallel and samples automation then', async () => {
    const { browser, registry, document, consent, verify, parallel, url } = prepared();
    expect(browser.window.navigator.registerProtocolHandler('WEB+BROWLET', '/handler?url=%s')).toBeUndefined();
    expect(registry.getState('web+browlet', url)).toBeNull();
    document.protocolHandlerAutomationMode = 'autoReject';
    parallel.shift()!();
    await registry.register('web+browlet', url, document).backing;
    expect(registry.getState('web+browlet', url)).toBe('declined');
    expect(verify).toHaveBeenCalledWith(document);
    expect(consent).not.toHaveBeenCalled();

    expect(browser.window.navigator.unregisterProtocolHandler('web+browlet', '/handler?url=%s')).toBeUndefined();
    expect(registry.getState('web+browlet', url)).toBe('declined');
    parallel.shift()!();
    expect(registry.getState('web+browlet', url)).toBeNull();
  });

  it('removes only the exact scheme/template pair and allows a new request after a remembered rejection', async () => {
    const { registry, userAgent, document, consent, url } = prepared();
    const otherURL = parseURL('https://protocol.test/other?url=%s').url!;
    consent.mockReturnValue(userAgent.HostPromise.resolve(false, internalType<boolean>()));
    await registry.register('web+browlet', url, document).backing;
    await registry.register('web+other', url, document).backing;
    await registry.register('web+browlet', otherURL, document).backing;
    registry.unregister('web+browlet', url);
    expect(registry.getState('web+browlet', url)).toBeNull();
    expect(registry.getState('web+other', url)).toBe('declined');
    expect(registry.getState('web+browlet', otherURL)).toBe('declined');
    consent.mockReturnValue(userAgent.HostPromise.resolve(true, internalType<boolean>()));
    await registry.register('web+browlet', url, document).backing;
    expect(registry.getState('web+browlet', url)).toBe('accepted');
    expect(consent).toHaveBeenCalledTimes(4);
  });

  it('does not recreate a removed handler when consent arrives later', async () => {
    const { registry, userAgent, document, consent, url } = prepared();
    const decision = userAgent.HostPromise.withResolvers(internalType<boolean>());
    consent.mockReturnValue(decision.promise);
    const registration = registry.register('web+browlet', url, document);
    registry.unregister('web+browlet', url);
    expect(registry.getState('web+browlet', url)).toBeNull();
    decision.resolve(true);
    await registration.backing;
    expect(registry.getState('web+browlet', url)).toBeNull();
  });

  it.each([false, true])('does not overwrite a newer request when an old consent decision fails=%s', async (fails) => {
    const { registry, userAgent, document, consent, url } = prepared();
    const first = userAgent.HostPromise.withResolvers(internalType<boolean>());
    const second = userAgent.HostPromise.withResolvers(internalType<boolean>());
    consent.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldRequest = registry.register('web+browlet', url, document);
    registry.unregister('web+browlet', url);
    const newRequest = registry.register('web+browlet', url, document);
    expect(newRequest).not.toBe(oldRequest);
    const failure = new Error('Earlier consent failed');
    if (fails) {
      first.reject(failure);
      await expect(oldRequest.backing).rejects.toBe(failure);
    } else {
      first.resolve(true);
      await oldRequest.backing;
    }
    expect(registry.getState('web+browlet', url)).toBe('pending');
    second.resolve(false);
    await newRequest.backing;
    expect(registry.getState('web+browlet', url)).toBe('declined');
  });

  it.each([false, true])('removes a failed request and permits retry when consent throws synchronously=%s', async (synchronous) => {
    const { registry, userAgent, document, consent, url } = prepared();
    const failure = new Error('Consent unavailable');
    consent.mockImplementationOnce(() => {
      if (synchronous) throw failure;
      return userAgent.HostPromise.reject(failure, internalType<boolean>());
    });
    await expect(registry.register('web+browlet', url, document).backing).rejects.toBe(failure);
    expect(registry.getState('web+browlet', url)).toBeNull();
    await registry.register('web+browlet', url, document).backing;
    expect(registry.getState('web+browlet', url)).toBe('accepted');
    expect(consent).toHaveBeenCalledTimes(2);
  });

  it('keeps host and automation dependencies explicit without recording a failed decision', async () => {
    const { registry, document, consent, verify, url } = prepared();
    consent.mockRestore();
    await expect(registry.register('web+browlet', url, document).backing).rejects.toThrow('Protocol handler consent is not implemented');
    expect(registry.getState('web+browlet', url)).toBeNull();
    verify.mockRestore();
    document.protocolHandlerAutomationMode = 'autoAccept';
    await expect(registry.register('web+browlet', url, document).backing)
      .rejects.toThrow('Protocol handler automation verification is not implemented');
    expect(registry.getState('web+browlet', url)).toBeNull();
  });

  it('requires verified automation even when a previous decision exists', async () => {
    const { registry, document, consent, verify, url } = prepared();
    await registry.register('web+browlet', url, document).backing;
    document.protocolHandlerAutomationMode = 'autoReject';
    const failure = new Error('No controlling automation session');
    verify.mockImplementation(() => { throw failure; });
    await expect(registry.register('web+browlet', url, document).backing).rejects.toBe(failure);
    expect(registry.getState('web+browlet', url)).toBe('accepted');
    expect(consent).toHaveBeenCalledTimes(1);
  });

  it('retains the normalized template rather than a mutable caller URL record', async () => {
    const { registry, userAgent, document, consent, url } = prepared();
    const decision = userAgent.HostPromise.withResolvers(internalType<boolean>());
    consent.mockReturnValue(decision.promise);
    const registration = registry.register('web+browlet', url, document);
    url.query = 'changed=%s';
    decision.resolve(true);
    await registration.backing;
    expect(registry.getState('web+browlet', url)).toBeNull();
    expect(registry.getState('web+browlet', parseURL('https://protocol.test/handler?url=%s').url!)).toBe('accepted');
  });
});

describe('Protocol-handler browser ownership', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(async () => ({ first: await createFixture(), second: await createFixture() }));

  it('keeps decisions separate for independent UserAgents', async () => {
    const { first, second } = prepared();
    await first.registry.register('web+browlet', first.url, first.document).backing;
    expect(first.registry.getState('web+browlet', first.url)).toBe('accepted');
    expect(second.registry.getState('web+browlet', second.url)).toBeNull();
    second.userAgent.unregisterProtocolHandler('web+browlet', second.url, second.document);
    expect(first.registry.getState('web+browlet', first.url)).toBe('accepted');
    expect(second.consent).not.toHaveBeenCalled();
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '<!doctype html><title>Protocol decisions</title>' });
  await browser.navigate('https://protocol.test/page');
  const env = getRelevantRealm(browser.window).env;
  const document = env.window.document;
  const userAgent = env.userAgent;
  const registry = userAgent.protocolHandlers;
  const parallel: (() => void)[] = [];
  vi.spyOn(env, 'runInParallel').mockImplementation((steps) => { parallel.push(steps); });
  const consent = vi.spyOn(userAgent, 'requestProtocolHandlerConsent')
    .mockImplementation(() => userAgent.HostPromise.resolve(true, internalType<boolean>()));
  const verify = vi.spyOn(userAgent, 'verifyProtocolHandlerAutomation').mockImplementation(() => {});
  const url = parseURL('https://protocol.test/handler?url=%s').url!;
  return { browser, env, document, userAgent, registry, consent, verify, parallel, url };
}
