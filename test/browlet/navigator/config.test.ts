import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet, type BrowletConfig } from '../../../src/browlet/browlet';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { NavigatorImpl } from '../../../src/browlet/navigator/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import { fetch, FetchRequest } from '../../../src/fetch/index';
import { parseURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

describe('Browlet Navigator configuration', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('retains the language and platform defaults when options are omitted', () => {
    const browser = new Browlet({ route: () => '' });
    expect(browser.window.navigator.language).toBe('en-US');
    expect(browser.window.navigator.languages).toEqual(['en-US']);
    expect(browser.window.navigator.platform).toBe('Win32');
  });

  it('copies languages before the initial getter read, preserving spelling and order without a change task', () => {
    const queueChange = vi.spyOn(NavigatorImpl.prototype, 'queueLanguageChange');
    const languages = ['fr-CA', 'en-US', 'x-Browlet', 'i-klingon'];
    const browser = new Browlet({ route: () => '', languages, platform: 'MacIntel' });
    languages[0] = 'de';
    languages.push('ja');
    expect(browser.window.navigator.language).toBe('fr-CA');
    expect(browser.window.navigator.languages).toEqual(['fr-CA', 'en-US', 'x-Browlet', 'i-klingon']);
    expect(Object.isFrozen(browser.window.navigator.languages)).toBe(true);
    expect(browser.window.navigator.platform).toBe('MacIntel');
    expect(queueChange).not.toHaveBeenCalled();
  });

  it('accepts a readonly language list and an explicitly empty platform', () => {
    const languages = Object.freeze(['fr', 'en']);
    const browser = new Browlet({ route: () => '', languages, platform: '' });
    expect(browser.window.navigator.languages).toEqual(['fr', 'en']);
    expect(browser.window.navigator.platform).toBe('');
  });

  it.each([
    [], [''], ['*'], ['en_US'], ['fr,en'], ['en;q=0.5'], [' en'], ['en\r\n'], ['åå'],
  ].map((languages) => ({ languages })))('rejects empty lists or invalid configuration tag shape $languages', ({ languages }) => {
    expect(() => new Browlet({ route: () => '', languages })).toThrow(TypeError);
  });

  it.each([
    { languages: null }, { languages: 'en-US' }, { languages: [42] }, { languages: Array(1) }, { platform: null },
  ])('rejects malformed JavaScript configuration %j', (options) => {
    // Exercise the Node-facing JavaScript API with input outside its TypeScript contract.
    const config = { route: () => '', ...options } as unknown as BrowletConfig;
    expect(() => new Browlet(config)).toThrow(TypeError);
  });
});

describe('configured Navigator preferences across environments', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const browser = new Browlet({ route: () => '', languages: ['fr-CA', 'en'], platform: 'MacIntel' });
    return { browser, env: getRelevantRealm(browser.window).env };
  });

  it('retains configuration after navigation and keeps separate browsers independent', async () => {
    const { browser, env } = prepared();
    const previous = browser.window.navigator;
    await browser.navigate('https://navigator.test/page');
    expect(browser.window.navigator).not.toBe(previous);
    expect(getRelevantRealm(browser.window).env.userAgent).toBe(env.userAgent);
    expect(await browser.evaluate(() => ({
      language: navigator.language, languages: [...navigator.languages], platform: navigator.platform,
    }))).toEqual({ language: 'fr-CA', languages: ['fr-CA', 'en'], platform: 'MacIntel' });
    const other = new Browlet({ route: () => '', languages: ['ja'], platform: 'Linux x86_64' });
    expect(other.window.navigator.language).toBe('ja');
    expect(other.window.navigator.platform).toBe('Linux x86_64');
    expect(previous.language).toBe('fr-CA');
    expect(previous.platform).toBe('MacIntel');
  });

  it('uses the configured language list in the existing Fetch header path', async () => {
    const { env } = prepared();
    const request = new FetchRequest(parseURL('https://navigator.test/blocked').url!, env);
    request.client = env;
    request.localURLsOnly = true;
    const finished = Promise.withResolvers<void>();
    fetch(request, { processResponseEndOfBody: () => { finished.resolve(); } }, env);
    expect(request.headerList.get('Accept-Language')).toBe('fr-CA,en');
    await finished.promise;
  });

  it.each([false, true])('shares configuration with an internally composed worker, shared: %s', (shared) => {
    const { env: outsideEnv } = prepared();
    const agent = outsideEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) {
      throw new Error('Expected a dedicated or shared worker agent');
    }
    const env = createWorkerEnvironment({
      agent, outsideEnv, url: parseURL('https://navigator.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'configuration', credentials: 'same-origin', extendedLifetime: shared,
    });
    const scope = env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;
    expect(scope.navigator.language).toBe('fr-CA');
    expect(scope.navigator.languages).toEqual(['fr-CA', 'en']);
    expect(scope.navigator.platform).toBe('MacIntel');
  });
});
