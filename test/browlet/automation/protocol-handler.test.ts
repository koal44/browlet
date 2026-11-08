import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JSONValue } from '../../../src/infra/index';
import { parseURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { WebDriverSession } from '../../../src/browlet/automation/index';
import type { CommandError } from '../../../src/browlet/automation/protocol';
import { BrowsingContext, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

describe('HTML Set RPH Registration Mode parameter validation', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const driver = new UserAgent().webDriver;
    const session = new WebDriverSession();
    const admission = vi.spyOn(driver, 'checkActiveSession').mockReturnValue({ type: 'success', data: null });
    const lookup = vi.spyOn(driver, 'getCurrentBrowsingContext');
    return { driver, session, admission, lookup };
  });

  it.each([
    ['null', null], ['boolean', true], ['number', 7], ['string', 'autoAccept'],
    ['array', []], ['array containing an object', [{ mode: 'autoAccept' }]],
  ] satisfies [string, JSONValue][])('rejects a %s body after session admission and before context lookup', (_label, parameters) => {
    const { driver, session, admission, lookup } = prepared();
    expect(driver.setRPHRegistrationMode(parameters, session)).toMatchObject({ type: 'error', error: 'invalid argument' });
    expect(admission).toHaveBeenCalledExactlyOnceWith(session);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(([
    null, false, 1, [], {}, '', 'autoaccept', 'AutoReject', 'NONE', 'autoAccept ',
  ] satisfies JSONValue[]).map((mode) => ({ mode })))('rejects invalid mode $mode without coercing it or looking up a context', ({ mode }) => {
    const { driver, session, lookup } = prepared();
    expect(driver.setRPHRegistrationMode({ mode }, session)).toMatchObject({ type: 'error', error: 'invalid argument' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a missing mode', () => {
    const { driver, session, lookup } = prepared();
    expect(driver.setRPHRegistrationMode({}, session)).toMatchObject({ type: 'error', error: 'invalid argument' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns a session-admission error before validating even a malformed body', () => {
    const { driver, session, admission, lookup } = prepared();
    const error: CommandError = { type: 'error', error: 'invalid session id', message: 'Session ended' };
    admission.mockReturnValue(error);
    expect(driver.setRPHRegistrationMode(null, session)).toBe(error);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('retains the missing session and context dependencies as separate implementation failures', () => {
    const { driver, session, admission, lookup } = prepared();
    admission.mockRestore();
    expect(() => driver.setRPHRegistrationMode({ mode: 'autoAccept' }, session))
      .toThrow('WebDriver active session admission is not implemented');
    expect(lookup).not.toHaveBeenCalled();
    vi.spyOn(driver, 'checkActiveSession').mockReturnValue({ type: 'success', data: null });
    expect(() => driver.setRPHRegistrationMode({ mode: 'autoAccept' }, session))
      .toThrow('WebDriver current browsing context lookup is not implemented');
  });
});

describe('HTML Set RPH Registration Mode Document integration', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(async () => {
    const browser = new Browlet({ route: () => '<!doctype html>' });
    await browser.navigate('https://protocol.test/first');
    const env = getRelevantRealm(browser.window).env;
    const document = env.window.document;
    const context = document.browsingContext!;
    const userAgent = env.userAgent;
    const driver = userAgent.webDriver;
    const session = new WebDriverSession();
    const admission = vi.spyOn(driver, 'checkActiveSession').mockReturnValue({ type: 'success', data: null });
    const lookup = vi.spyOn(driver, 'getCurrentBrowsingContext').mockReturnValue({ type: 'success', data: context });
    return { browser, document, context, userAgent, driver, session, admission, lookup };
  });

  it.each(['autoAccept', 'autoReject', 'none'] as const)('sets %s synchronously and returns success with null', (mode) => {
    const { document, driver, session, admission, lookup } = prepared();
    document.protocolHandlerAutomationMode = mode === 'autoAccept' ? 'autoReject' : 'autoAccept';
    const parameters: JSONValue = { mode, ignored: { nested: [null, 7, true] } };
    expect(driver.setRPHRegistrationMode(parameters, session)).toEqual({ type: 'success', data: null });
    expect(document.protocolHandlerAutomationMode).toBe(mode);
    expect(parameters).toEqual({ mode, ignored: { nested: [null, 7, true] } });
    expect(admission).toHaveBeenCalledExactlyOnceWith(session);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(session);
    expect(admission.mock.invocationCallOrder[0]).toBeLessThan(lookup.mock.invocationCallOrder[0]!);
  });

  it('leaves the existing mode unchanged when parameter validation or context lookup fails', () => {
    const { document, driver, session, lookup } = prepared();
    document.protocolHandlerAutomationMode = 'autoReject';
    expect(driver.setRPHRegistrationMode({ mode: 'bad' }, session)).toMatchObject({ type: 'error', error: 'invalid argument' });
    expect(lookup).not.toHaveBeenCalled();
    const error: CommandError = { type: 'error', error: 'no such window', message: 'Current context closed' };
    lookup.mockReturnValue(error);
    expect(driver.setRPHRegistrationMode({ mode: 'none' }, session)).toBe(error);
    expect(document.protocolHandlerAutomationMode).toBe('autoReject');
  });

  it('uses the context selected for the supplied session without changing another Document', () => {
    const { userAgent, document, context, driver, session, lookup } = prepared();
    const other = TopLevelTraversable.create(userAgent, null, '');
    const otherContext = other.activeBrowsingContext!;
    const otherDocument = other.activeDocument!;
    const otherSession = new WebDriverSession();
    lookup.mockImplementation((selected) => ({ type: 'success', data: selected === session ? context : otherContext }));
    expect(driver.setRPHRegistrationMode({ mode: 'autoAccept' }, session)).toEqual({ type: 'success', data: null });
    expect(otherDocument.protocolHandlerAutomationMode).toBe('none');
    expect(driver.setRPHRegistrationMode({ mode: 'autoReject' }, otherSession)).toEqual({ type: 'success', data: null });
    expect(document.protocolHandlerAutomationMode).toBe('autoAccept');
    expect(otherDocument.protocolHandlerAutomationMode).toBe('autoReject');
    expect(lookup).toHaveBeenLastCalledWith(otherSession);
  });

  it('uses the active Document at command time after navigation, without inheriting the previous mode', async () => {
    const { browser, document, driver, session, lookup } = prepared();
    expect(driver.setRPHRegistrationMode({ mode: 'autoAccept' }, session)).toEqual({ type: 'success', data: null });
    await browser.navigate('https://protocol.test/second');
    const replacement = getRelevantRealm(browser.window).env.window.document;
    expect(replacement).not.toBe(document);
    expect(replacement.protocolHandlerAutomationMode).toBe('none');
    lookup.mockReturnValue({ type: 'success', data: replacement.browsingContext! });
    expect(driver.setRPHRegistrationMode({ mode: 'autoReject' }, session)).toEqual({ type: 'success', data: null });
    expect(replacement.protocolHandlerAutomationMode).toBe('autoReject');
    expect(document.protocolHandlerAutomationMode).toBe('autoAccept');
  });

  it.each(['autoAccept', 'autoReject'] as const)('feeds %s into registration after its separate automation check', async (mode) => {
    const { document, userAgent, driver, session } = prepared();
    const verify = vi.spyOn(userAgent, 'verifyProtocolHandlerAutomation').mockImplementation(() => {});
    const consent = vi.spyOn(userAgent, 'requestProtocolHandlerConsent');
    expect(driver.setRPHRegistrationMode({ mode }, session)).toEqual({ type: 'success', data: null });
    const url = parseURL('https://protocol.test/handler?url=%s').url!;
    await userAgent.protocolHandlers.register('web+browlet', url, document).backing;
    expect(userAgent.protocolHandlers.getState('web+browlet', url)).toBe(mode === 'autoAccept' ? 'accepted' : 'declined');
    expect(verify).toHaveBeenCalledExactlyOnceWith(document);
    expect(consent).not.toHaveBeenCalled();
  });

  it('does not make setting a mode substitute for verified control during registration', async () => {
    const { document, userAgent, driver, session } = prepared();
    driver.setRPHRegistrationMode({ mode: 'autoAccept' }, session);
    const url = parseURL('https://protocol.test/handler?url=%s').url!;
    await expect(userAgent.protocolHandlers.register('web+browlet', url, document).backing)
      .rejects.toThrow('Protocol handler automation verification is not implemented');
    expect(userAgent.protocolHandlers.getState('web+browlet', url)).toBeNull();
  });

  it('reports an incomplete context owner without mutating the previous Document', () => {
    const { document, driver, session, lookup } = prepared();
    lookup.mockReturnValue({ type: 'success', data: new BrowsingContext() });
    expect(() => driver.setRPHRegistrationMode({ mode: 'autoAccept' }, session))
      .toThrow('WebDriver current browsing context has no active Document');
    expect(document.protocolHandlerAutomationMode).toBe('none');
  });
});
