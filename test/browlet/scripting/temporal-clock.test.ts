import { afterEach, describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { JSRealm } from '../../../src/js-engine/realm';
import { Browlet } from '../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { FetchResponse } from '../../../src/fetch/response';
import { parseURL } from '../../../src/url/index';
import { Moment, UnsafeMoment, wallClock } from '../../../src/timing/clock';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

afterEach(() => vi.restoreAllMocks());

describe('HTML Temporal clock integration', () => {
  // The native Temporal API is disabled by default on Node 24; this ownership
  // requirement otherwise applies with or without the clock addon.
  itPassesWith('v26+')('keeps Date conversions in the page realm after host inspection', async () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    const date = Reflect.get(browser.window, 'Date') as DateConstructor;
    const descriptor = Reflect.getOwnPropertyDescriptor(date.prototype, 'toTemporalInstant')!;

    expect(await browser.evaluate(() => new Date(0).toTemporalInstant() instanceof Temporal.Instant)).toBe(true);
    expect(Object.getPrototypeOf(descriptor.value)).toBe(realm.functionPrototype);
  });

  // The existing approved native-setter limitation also applies to these HTML
  // calls: only custom/compat can install the clock; stock and official addon
  // bases still execute these assertions as expected failures.
  itPassesWith('temporalClock')('connects native Temporal.Now to the environment\'s live, coarsened wall clock', async () => {
    const browser = new Browlet({ route: () => '' });
    const clock = vi.spyOn(wallClock, 'unsafeCurrentTime');
    clock.mockReturnValue(new UnsafeMoment(wallClock, 12.345_678));
    const realm = getRelevantRealm(browser.window);
    const temporal = Reflect.get(browser.window, 'Temporal') as typeof Temporal;
    expect(Object.getPrototypeOf(temporal.Now.instant)).toBe(realm.functionPrototype);

    expect(await browser.evaluate(() => Temporal.Now.instant().epochNanoseconds)).toBe(12_300_000n);
    clock.mockReturnValue(new UnsafeMoment(wallClock, 23.456_789));
    expect(await browser.evaluate(() => Temporal.Now.instant().epochNanoseconds)).toBe(23_400_000n);
  });

  itPassesWith('temporalClock')('uses the native method\'s realm when borrowed by another Window', () => {
    const first = new Browlet({ route: () => '' });
    const second = createSiblingWindow(first);
    const firstEnv = getRelevantRealm(first.window).env;
    const secondEnv = getRelevantRealm(second).env;
    vi.spyOn(firstEnv, 'currentWallTime').mockReturnValue(new Moment(wallClock, 123));
    vi.spyOn(secondEnv, 'currentWallTime').mockReturnValue(new Moment(wallClock, 456));
    const firstTemporal = Reflect.get(first.window, 'Temporal') as typeof Temporal;
    const secondTemporal = Reflect.get(second, 'Temporal') as typeof Temporal;

    expect(firstTemporal.Now.instant.call(secondTemporal.Now).epochNanoseconds).toBe(123_000_000n);
    expect(secondTemporal.Now.instant.call(firstTemporal.Now).epochNanoseconds).toBe(456_000_000n);
  });

  itPassesWith('temporalClock')('keeps the old clock on retained methods after navigation', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const oldEnv = getRelevantRealm(browser.window).env;
    const oldTemporal = Reflect.get(browser.window, 'Temporal') as typeof Temporal;
    vi.spyOn(oldEnv, 'currentWallTime').mockReturnValue(new Moment(wallClock, 123));
    await browser.navigate('https://example.test/second');
    const newEnv = getRelevantRealm(browser.window).env;
    expect(newEnv).not.toBe(oldEnv);
    vi.spyOn(newEnv, 'currentWallTime').mockReturnValue(new Moment(wallClock, 456));

    expect(await browser.evaluate(() => Temporal.Now.instant().epochNanoseconds)).toBe(456_000_000n);
    expect(oldTemporal.Now.instant().epochNanoseconds).toBe(123_000_000n);
  });

  it.each(['none', 'logical', 'concrete'] as const)('installs the %s clock before attaching its Document', (mode) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    env.realm.agent.agentCluster!.crossOriginIsolationMode = mode;
    const install = vi.spyOn(JSRealm.prototype, 'setTemporalHostSystemUTCEpochNanosecondsCallback');
    // Registration must not query the Document before the caller attaches it.
    const siblingEnv = getRelevantRealm(createSiblingWindow(browser)).env;

    expect(install).toHaveBeenCalledOnce();
    expect(install.mock.contexts[0]).toBe(siblingEnv.realm);
  });

  itPassesWith('temporalClock').each([
    ['allowed', undefined, undefined, 12_345_000n, null],
    ['denied', 'cross-origin-isolated=()', undefined, 12_300_000n, 'enforce'],
    ['report-only', undefined, 'cross-origin-isolated=()', 12_345_000n, 'report'],
  ] as const)('uses the response policy for a concretely isolated %s clock', (_name, enforced, reportOnly, expected, disposition) => {
    const { window } = createIsolatedWindow(enforced, reportOnly);
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    vi.spyOn(wallClock, 'unsafeCurrentTime').mockReturnValue(new UnsafeMoment(wallClock, 12.345_678));
    const temporal = Reflect.get(window, 'Temporal') as typeof Temporal;

    expect(temporal.Now.instant().epochNanoseconds).toBe(expected);
    const reports = observer.takeRecords();
    if (disposition === null) {
      expect(reports).toEqual([]);
    } else {
      expect(reports).toHaveLength(1);
      expect(reports[0]!.body!.toJSON()).toMatchObject({ featureId: 'cross-origin-isolated', disposition });
    }
  });

  itPassesWith('temporalClock')('rechecks activity for retained concrete clocks after navigation and detachment', () => {
    const { document, traversable, window } = createIsolatedWindow();
    const oldTemporal = Reflect.get(window, 'Temporal') as typeof Temporal;
    vi.spyOn(wallClock, 'unsafeCurrentTime').mockReturnValue(new UnsafeMoment(wallClock, 12.345_678));
    expect(oldTemporal.Now.instant().epochNanoseconds).toBe(12_345_000n);

    const response = new FetchResponse();
    response.urlList.push(parseURL('https://clock.test/replacement').url!);
    const params = traversable.createNavigationParams(response);
    const replacement = traversable.createAndInitializeDocument('html', 'text/html', params);
    traversable.finalizeCrossDocumentNavigation('push', 'browser UI', traversable.createHistoryEntry(replacement, params));
    const newTemporal = Reflect.get(traversable.activeWindowProxy.platform, 'Temporal') as typeof Temporal;

    expect(replacement.env).not.toBe(document.env);
    expect(document.isFullyActive()).toBe(false);
    expect(newTemporal.Now.instant().epochNanoseconds).toBe(12_345_000n);
    expect(oldTemporal.Now.instant.call(newTemporal.Now).epochNanoseconds).toBe(12_300_000n);
    replacement.browsingContext = null;
    expect(newTemporal.Now.instant().epochNanoseconds).toBe(12_300_000n);
  });
});

describe('HTML HostSystemUTCEpochNanoseconds calculation', () => {
  it('reads and coarsens the owning environment\'s live wall clock', () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const clock = vi.spyOn(wallClock, 'unsafeCurrentTime');
    clock.mockReturnValue(new UnsafeMoment(wallClock, 12.345_678));

    expect(env.getSystemUTCEpochNanoseconds()).toBe(12_300_000n);
    clock.mockReturnValue(new UnsafeMoment(wallClock, 23.456_789));
    expect(env.getSystemUTCEpochNanoseconds()).toBe(23_400_000n);
  });

  it('uses the environment\'s isolation capability when selecting precision', () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(wallClock, 'unsafeCurrentTime').mockReturnValue(new UnsafeMoment(wallClock, 12.345_678));
    // Isolate the calculation here; integration tests above exercise the real policy.
    const isolated = vi.spyOn(env, 'crossOriginIsolatedCapability', 'get').mockReturnValue(true);

    expect(env.getSystemUTCEpochNanoseconds()).toBe(12_345_000n);
    isolated.mockReturnValue(false);
    expect(env.getSystemUTCEpochNanoseconds()).toBe(12_300_000n);
  });

  it.each([
    [0, 0n],
    [0.000_001_4, 1n],
    [0.000_001_6, 2n],
    [-0.000_001_4, -1n],
    [-0.000_001_6, -2n],
    [1_761_694_200_001, 1_761_694_200_001_000_000n],
    [-1_761_694_200_001, -1_761_694_200_001_000_000n],
  ])('converts coarsened %s milliseconds to %s nanoseconds', (milliseconds, nanoseconds) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(env, 'currentWallTime').mockReturnValue(new Moment(wallClock, milliseconds));

    expect(env.getSystemUTCEpochNanoseconds()).toBe(nanoseconds);
  });

  it.each([
    [-8_640_000_000_000_001, -8_640_000_000_000_000_000_000n],
    [-8_640_000_000_000_000, -8_640_000_000_000_000_000_000n],
    [8_640_000_000_000_000, 8_640_000_000_000_000_000_000n],
    [8_640_000_000_000_001, 8_640_000_000_000_000_000_000n],
  ])('clamps %s milliseconds to Temporal\'s Instant range', (milliseconds, nanoseconds) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    vi.spyOn(env, 'currentWallTime').mockReturnValue(new Moment(wallClock, milliseconds));

    expect(env.getSystemUTCEpochNanoseconds()).toBe(nanoseconds);
  });
});

/** Supply concrete isolation, then use the real response-policy and Document lifecycle. */
function createIsolatedWindow(enforced?: string, reportOnly?: string) {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  // Native AgentCluster isolation remains separate from this HTML clock integration.
  traversable.activeBrowsingContext!.group!.crossOriginIsolationMode = 'concrete';
  const response = new FetchResponse();
  response.urlList.push(parseURL('https://clock.test/page').url!);
  if (enforced !== undefined) response.headerList.append('Permissions-Policy', enforced);
  if (reportOnly !== undefined) response.headerList.append('Permissions-Policy-Report-Only', reportOnly);
  const params = traversable.createNavigationParams(response);
  const document = traversable.createAndInitializeDocument('html', 'text/html', params);
  traversable.finalizeCrossDocumentNavigation('push', 'browser UI', traversable.createHistoryEntry(document, params));
  expect(document.env.realm.agent.agentCluster!.crossOriginIsolationMode).toBe('concrete');
  return { document, traversable, window: traversable.activeWindowProxy.platform };
}
