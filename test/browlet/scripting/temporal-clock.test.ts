import { afterEach, describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { JSRealm } from '../../../src/js-engine/realm';
import { Browlet } from '../../../src/browlet/browlet';
import { Moment, UnsafeMoment, wallClock } from '../../../src/browlet/timing/clock';
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
    vi.spyOn(firstEnv.timing, 'currentWallTime').mockReturnValue(new Moment(wallClock, 123));
    vi.spyOn(secondEnv.timing, 'currentWallTime').mockReturnValue(new Moment(wallClock, 456));
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
    vi.spyOn(oldEnv.timing, 'currentWallTime').mockReturnValue(new Moment(wallClock, 123));
    await browser.navigate('https://example.test/second');
    const newEnv = getRelevantRealm(browser.window).env;
    expect(newEnv).not.toBe(oldEnv);
    vi.spyOn(newEnv.timing, 'currentWallTime').mockReturnValue(new Moment(wallClock, 456));

    expect(await browser.evaluate(() => Temporal.Now.instant().epochNanoseconds)).toBe(456_000_000n);
    expect(oldTemporal.Now.instant().epochNanoseconds).toBe(123_000_000n);
  });

  it.each(['none', 'logical', 'concrete'] as const)('keeps %s isolation within the supported installation boundary', (mode) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    env.realm.agent.agentCluster!.crossOriginIsolationMode = mode;
    const install = vi.spyOn(JSRealm.prototype, 'setTemporalHostSystemUTCEpochNanosecondsCallback');
    // The sibling's Document is attached after host-hook installation. Concrete
    // isolation must not query the missing policy or install a fatal callback.
    const siblingEnv = getRelevantRealm(createSiblingWindow(browser)).env;

    if (mode === 'concrete') {
      expect(install).not.toHaveBeenCalled();
    } else {
      expect(install).toHaveBeenCalledOnce();
      expect(install.mock.contexts[0]).toBe(siblingEnv.realm);
    }
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
    // Supply the policy result at its existing boundary; Permissions Policy
    // evaluation itself remains unfinished and is not supplied by this fixture.
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
    vi.spyOn(env.timing, 'currentWallTime').mockReturnValue(new Moment(wallClock, milliseconds));

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
    vi.spyOn(env.timing, 'currentWallTime').mockReturnValue(new Moment(wallClock, milliseconds));

    expect(env.getSystemUTCEpochNanoseconds()).toBe(nanoseconds);
  });
});
