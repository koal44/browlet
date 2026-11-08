import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { fetch, FetchRequest } from '../../../src/fetch/index';
import { parseURL } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

describe('HTML NavigatorLanguage', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const userAgent = createManualUserAgent();
    const traversable = TopLevelTraversable.create(userAgent, null, '');
    const window = traversable.activeWindow!;
    const env = window.env;
    const platform = env.realm.windowProxy.platform;
    return { userAgent, window, env, platform, loop: env.responsibleEventLoop };
  });

  it('exposes a stable frozen list in the Navigator realm and the same preferred language', () => {
    const { platform, env, userAgent } = prepared();
    expect(platform.navigator.language).toBe('en-US');
    const languages = platform.navigator.languages;
    expect(languages).toEqual(['en-US']);
    expect(platform.navigator.languages).toBe(languages);
    expect(Object.isFrozen(languages)).toBe(true);
    expect(Object.getPrototypeOf(languages)).toBe(env.realm.Array.prototype);
    expect(Reflect.set(languages, '0', 'fr')).toBe(false);
    expect(Reflect.has(platform, 'NavigatorLanguage')).toBe(false);
    expect(userAgent.defaultAcceptLanguage).toBe('en-US');
  });

  it('uses ordinary readonly prototype attributes and checked receivers', () => {
    const { platform, env } = prepared();
    for (const name of ['language', 'languages']) {
      const descriptor = Object.getOwnPropertyDescriptor(platform.Navigator.prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      expect(Object.hasOwn(platform.navigator, name)).toBe(false);
      expect(Reflect.set(platform.navigator, name, 'author value')).toBe(false);
      expect(() => { descriptor.get!.call({}); }).toThrow(env.realm.TypeError);
      expect(() => { descriptor.get!.call(null); }).toThrow(env.realm.TypeError);
    }
  });

  it('publishes copied preferences at the DOM task before a trusted languagechange event', () => {
    const { userAgent, window, platform, loop } = prepared();
    const previous = platform.navigator.languages;
    const tags: [string, ...string[]] = ['fr-CA', 'en-US'];
    const events: unknown[] = [];
    platform.onlanguagechange = (event) => {
      events.push({
        language: platform.navigator.language, languages: [...platform.navigator.languages],
        trusted: event.isTrusted, bubbles: event.bubbles, cancelable: event.cancelable, composed: event.composed,
        target: event.target === platform, currentTarget: event.currentTarget === platform,
        type: event.type, source: loop.currentlyRunningTask?.source,
      });
    };
    userAgent.setPreferredLanguages(tags, [window.navigator]);
    tags[0] = 'de';
    expect(platform.navigator.languages).toBe(previous);
    expect(platform.navigator.language).toBe('en-US');
    expect(userAgent.defaultAcceptLanguage).toBe('fr-CA,en-US');
    expect(events).toEqual([]);
    expect(loop.runTaskTurn()).toBe(true);
    expect(events).toEqual([{
      language: 'fr-CA', languages: ['fr-CA', 'en-US'], trusted: true, bubbles: false,
      cancelable: false, composed: false, target: true, currentTarget: true,
      type: 'languagechange', source: domManipulationTaskSource,
    }]);
    expect(platform.navigator.languages).not.toBe(previous);
    expect(platform.navigator.languages).toBe(platform.navigator.languages);
    expect(previous).toEqual(['en-US']);
  });

  it('also delays the new value when neither language getter was previously used', () => {
    const { userAgent, window, platform, loop } = prepared();
    userAgent.setPreferredLanguages(['ja'], [window.navigator]);
    expect(platform.navigator.language).toBe('en-US');
    expect(loop.runTaskTurn()).toBe(true);
    expect(platform.navigator.languages).toEqual(['ja']);
  });

  it('preserves identity for equal values and replaces it for reordered values', () => {
    const { userAgent, window, platform, loop } = prepared();
    const listener = vi.fn();
    platform.onlanguagechange = listener;
    userAgent.setPreferredLanguages(['fr', 'en'], [window.navigator]);
    loop.runTaskTurn();
    const previous = platform.navigator.languages;
    userAgent.setPreferredLanguages(['fr', 'en'], [window.navigator]);
    loop.runTaskTurn();
    expect(platform.navigator.languages).toBe(previous);
    expect(listener).toHaveBeenCalledTimes(1);
    userAgent.setPreferredLanguages(['en', 'fr'], [window.navigator]);
    loop.runTaskTurn();
    expect(platform.navigator.languages).toEqual(['en', 'fr']);
    expect(platform.navigator.languages).not.toBe(previous);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('delivers successive snapshots in order even if the producer changes again before either task', () => {
    const { userAgent, window, platform, loop } = prepared();
    const languages: string[] = [];
    platform.onlanguagechange = () => { languages.push(platform.navigator.language); };
    userAgent.setPreferredLanguages(['fr'], [window.navigator]);
    userAgent.setPreferredLanguages(['de'], [window.navigator]);
    expect(platform.navigator.language).toBe('en-US');
    loop.runTaskTurn();
    expect(languages).toEqual(['fr']);
    loop.runTaskTurn();
    expect(languages).toEqual(['fr', 'de']);
  });

  it('defers changes requested inside a languagechange listener to a later task', () => {
    const { userAgent, window, platform, loop } = prepared();
    const languages: string[] = [];
    platform.onlanguagechange = () => {
      const language = platform.navigator.language;
      languages.push(language);
      if (language === 'fr') {
        userAgent.setPreferredLanguages(['de'], [window.navigator]);
        expect(platform.navigator.language).toBe('fr');
      }
    };
    userAgent.setPreferredLanguages(['fr'], [window.navigator]);
    loop.runTaskTurn();
    expect(languages).toEqual(['fr']);
    loop.runTaskTurn();
    expect(languages).toEqual(['fr', 'de']);
  });

  it('uses the environment override initially and keeps it through ordinary preference changes', () => {
    const { userAgent, window, platform, loop, env } = prepared();
    vi.spyOn(userAgent, 'webDriverBiDiEmulatedLanguage').mockImplementation((queriedEnv) => {
      expect(queriedEnv).toBe(env);
      return 'es-MX';
    });
    const previous = platform.navigator.languages;
    expect(previous).toEqual(['es-MX']);
    const listener = vi.fn();
    platform.onlanguagechange = listener;
    userAgent.setPreferredLanguages(['fr', 'en'], [window.navigator]);
    loop.runTaskTurn();
    expect(platform.navigator.language).toBe('es-MX');
    expect(platform.navigator.languages).toBe(previous);
    expect(listener).not.toHaveBeenCalled();
    expect(userAgent.defaultAcceptLanguage).toBe('fr,en');
  });

  it('publishes emulation changes and removal through the same task boundary', () => {
    const { userAgent, window, platform, loop } = prepared();
    const selector = vi.spyOn(userAgent, 'webDriverBiDiEmulatedLanguage').mockReturnValue(null);
    const previous = platform.navigator.languages;
    window.navigator.queueLanguageChange(['en-US'], true);
    selector.mockReturnValue('en-US');
    expect(platform.navigator.languages).toBe(previous);
    loop.runTaskTurn();
    expect(platform.navigator.languages).toEqual(['en-US']);
    expect(platform.navigator.languages).not.toBe(previous);
    userAgent.setPreferredLanguages(['fr'], [window.navigator]);
    loop.runTaskTurn();
    window.navigator.queueLanguageChange(userAgent.preferredLanguages, true);
    selector.mockReturnValue(null);
    expect(platform.navigator.language).toBe('en-US');
    loop.runTaskTurn();
    expect(platform.navigator.language).toBe('fr');
  });

  it('leaves a discarded Document task without publishing its new snapshot', () => {
    const { userAgent, window, platform, loop } = prepared();
    const previous = platform.navigator.languages;
    const listener = vi.fn();
    platform.onlanguagechange = listener;
    userAgent.setPreferredLanguages(['fr'], [window.navigator]);
    const task = [...loop.getTaskQueue(domManipulationTaskSource)][0]!;
    expect(task.document).toBe(window.document);
    loop.removeTasksForDocument(window.document);
    expect(loop.runTaskTurn()).toBe(false);
    expect(platform.navigator.languages).toBe(previous);
    expect(listener).not.toHaveBeenCalled();
  });

  it('holds preference updates while its Document is inactive', () => {
    const { userAgent, window, platform, loop } = prepared();
    const active = vi.spyOn(window.document, 'isFullyActive').mockReturnValue(false);
    userAgent.setPreferredLanguages(['fr'], [window.navigator]);
    expect(loop.runTaskTurn()).toBe(false);
    expect(platform.navigator.language).toBe('en-US');
    active.mockRestore();
    expect(loop.runTaskTurn()).toBe(true);
    expect(platform.navigator.language).toBe('fr');
  });
});

describe('Navigator language ownership', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const userAgent = createManualUserAgent();
    userAgent.setPreferredLanguages(['fr-CA', 'i-klingon', 'x-browlet'], []);
    const first = TopLevelTraversable.create(userAgent, null, '').activeWindow!;
    const second = TopLevelTraversable.create(userAgent, null, '').activeWindow!;
    return { userAgent, first, second };
  });

  it('uses configured valid tags without ICU canonicalization, fallback expansion, or reordering', () => {
    const { userAgent, first } = prepared();
    const navigator = first.env.realm.windowProxy.platform.navigator;
    expect(navigator.language).toBe('fr-CA');
    expect(navigator.languages).toEqual(['fr-CA', 'i-klingon', 'x-browlet']);
    expect(userAgent.defaultAcceptLanguage).toBe('fr-CA,i-klingon,x-browlet');
    expect(Object.isFrozen(userAgent.preferredLanguages)).toBe(true);
  });

  it('preserves the receiver realm and identity when borrowing a getter', () => {
    const { first, second } = prepared();
    const one = first.env.realm.windowProxy.platform;
    const two = second.env.realm.windowProxy.platform;
    const descriptor = Object.getOwnPropertyDescriptor(two.Navigator.prototype, 'languages')!;
    const getter = () => descriptor.get!.call(one.navigator) as readonly string[];
    const result = getter();
    expect(result).toBe(one.navigator.languages);
    expect(Object.getPrototypeOf(result)).toBe(first.env.realm.Array.prototype);
    expect(result).not.toBe(two.navigator.languages);
    expect(() => { descriptor.get!.call({}); }).toThrow(second.env.realm.TypeError);
  });

  it('queues the explicit recipients independently on their respective event loops', () => {
    const { userAgent, first, second } = prepared();
    userAgent.setPreferredLanguages(['ja'], [first.navigator, second.navigator]);
    expect(first.env.responsibleEventLoop).not.toBe(second.env.responsibleEventLoop);
    first.env.responsibleEventLoop.runTaskTurn();
    expect(first.navigator.language).toBe('ja');
    expect(second.navigator.language).toBe('fr-CA');
    second.env.responsibleEventLoop.runTaskTurn();
    expect(second.navigator.language).toBe('ja');
  });
});

describe.each([false, true])('WorkerNavigator language preferences, shared: %s', (shared) => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const userAgent = createManualUserAgent();
    const window = TopLevelTraversable.create(userAgent, null, '').activeWindow!;
    const agent = userAgent.obtainDedicatedOrSharedWorkerAgent(window.env, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) {
      throw new Error('Expected a dedicated or shared worker agent');
    }
    const env = createWorkerEnvironment({
      agent, outsideEnv: window.env, url: parseURL('https://navigator.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'language', credentials: 'same-origin', extendedLifetime: shared,
    });
    const scope = env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;
    return { userAgent, window, env, scope, navigator: agent.globalScope!.navigator, loop: env.responsibleEventLoop };
  });

  it('owns a frozen list and delivers a worker-global event on the worker loop', () => {
    const { userAgent, window, navigator, env, scope, loop } = prepared();
    expect(scope.navigator.languages).toEqual(['en-US']);
    expect(scope.navigator.languages).toBe(scope.navigator.languages);
    expect(Object.isFrozen(scope.navigator.languages)).toBe(true);
    expect(Object.getPrototypeOf(scope.navigator.languages)).toBe(env.realm.Array.prototype);
    const events: unknown[] = [];
    scope.onlanguagechange = (event) => { events.push({ language: scope.navigator.language, target: event.target === scope, trusted: event.isTrusted }); };
    userAgent.setPreferredLanguages(['de', 'en'], [window.navigator, navigator]);
    expect(scope.navigator.language).toBe('en-US');
    loop.runTaskTurn();
    expect(events).toEqual([{ language: 'de', target: true, trusted: true }]);
    expect(window.navigator.language).toBe('en-US');
    window.env.responsibleEventLoop.runTaskTurn();
    expect(window.navigator.language).toBe('de');
  });

  it('selects the worker environment override independently from its creator', () => {
    const { userAgent, window, env, scope } = prepared();
    vi.spyOn(userAgent, 'webDriverBiDiEmulatedLanguage').mockImplementation((queriedEnv) => queriedEnv === env ? 'ja' : 'fr');
    expect(scope.navigator.language).toBe('ja');
    expect(scope.navigator.languages).toEqual(['ja']);
    expect(window.navigator.language).toBe('fr');
  });
});

describe('Navigator and Fetch language preferences', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    return { browser, env, userAgent: env.userAgent };
  });

  it('shares the ordered default list while preserving request headers and scoped overrides', async () => {
    const { env, userAgent } = prepared();
    userAgent.setPreferredLanguages(['fr-CA', 'en'], [env.window.navigator]);
    const selector = vi.spyOn(userAgent, 'webDriverBiDiEmulatedLanguage').mockReturnValue(null);
    for (const [override, explicit, expected] of [
      [null, null, 'fr-CA,en'], ['ja', null, 'ja'], ['ja', 'es', 'es'],
    ] as const) {
      selector.mockReturnValue(override);
      const request = new FetchRequest(parseURL('https://navigator.test/blocked').url!, env);
      request.client = env;
      request.localURLsOnly = true;
      if (explicit !== null) request.headerList.append('Accept-Language', explicit);
      const finished = Promise.withResolvers<void>();
      fetch(request, { processResponseEndOfBody: () => { finished.resolve(); } }, env);
      expect(request.headerList.get('Accept-Language')).toBe(expected);
      await finished.promise;
    }
  });
});
