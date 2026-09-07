import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

/*
 * High Resolution Time sections 1.2 and 3–8, together with the corresponding
 * Web Platform Tests and browser tests, describe these observable contracts.
 * Keep this coverage at the public Window boundary: the clock representation,
 * epoch correlation, and coarsening strategy remain implementation choices.
 *
 * https://w3c.github.io/hr-time/
 * https://github.com/web-platform-tests/wpt/tree/master/hr-time
 */
describe('Performance', () => {
  it('exposes one stable Performance EventTarget on Window', () => {
    const { window } = createBrowlet();
    const performance = requirePerformance(window);
    const EventTargetConstructor = requireInterface<EventTarget>(
      window,
      'EventTarget',
    );

    expect(window.performance).toBe(performance);
    expect(performance).toBeInstanceOf(EventTargetConstructor);
  });

  it('installs a realm-specific nonconstructible interface', () => {
    const first = createBrowlet();
    const second = createBrowlet();
    const FirstPerformance = requireInterface<Performance>(
      first.window,
      'Performance',
    );
    const SecondPerformance = requireInterface<Performance>(
      second.window,
      'Performance',
    );
    const TypeErrorConstructor = Reflect.get(first.window, 'TypeError') as
      typeof TypeError;

    expect(first.window.performance).toBeInstanceOf(FirstPerformance);
    expect(first.window.performance).not.toBeInstanceOf(SecondPerformance);
    expect(FirstPerformance).not.toBe(SecondPerformance);
    expect(() => {
      Reflect.construct(FirstPerformance, []);
    }).toThrow(TypeErrorConstructor);
  });

  it('reports a nonnegative monotonically increasing relative time', () => {
    const performance = requirePerformance(createBrowlet().window);
    const first = performance.now();
    const second = performance.now();

    expect(Number.isFinite(first)).toBe(true);
    expect(Number.isFinite(second)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it('coarsens nonisolated observations to at least 100 microseconds', () => {
    const performance = requirePerformance(createBrowlet().window);
    const times = [performance.now()];

    for (let index = 0; index < 100_000; ++index) {
      const time = performance.now();
      times.push(time);
      if (time !== times[0]) break;
    }

    expect(times.at(-1)).not.toBe(times[0]);
    for (let index = 1; index < times.length; ++index) {
      const differenceInMicroseconds = (times[index]! - times[index - 1]!) *
        1_000;

      expect(
        differenceInMicroseconds === 0 ||
        differenceInMicroseconds >= 100 - 1e-6,
      ).toBe(true);
    }
  });

  it(
    'correlates relative time with an epoch-comparable time origin',
    () => {
      const performance = requirePerformance(createBrowlet().window);
      const timeOrigin = performance.timeOrigin;
      const wallTimeBefore = Date.now();
      const epochTime = timeOrigin + performance.now();
      const wallTimeAfter = Date.now();

      expect(Number.isFinite(timeOrigin)).toBe(true);
      expect(timeOrigin).toBeGreaterThan(0);
      expect(performance.timeOrigin).toBe(timeOrigin);
      expect(epochTime).toBeGreaterThanOrEqual(wallTimeBefore - 30);
      expect(epochTime).toBeLessThanOrEqual(wallTimeAfter + 30);
    },
  );

  it('measures elapsed time independently of the wall-clock base', async () => {
    const { window } = createBrowlet();
    const performance = requirePerformance(window);
    const wallTimeBefore = Date.now();
    const relativeTimeBefore = performance.now();

    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));

    const relativeDuration = performance.now() - relativeTimeBefore;
    const wallDuration = Date.now() - wallTimeBefore;

    expect(relativeDuration).toBeGreaterThanOrEqual(0);
    expect(Math.abs(relativeDuration - wallDuration)).toBeLessThanOrEqual(30);
  });

  it('serializes the default Web IDL JSON surface', () => {
    const performance = requirePerformance(createBrowlet().window);

    expect(performance.toJSON()).toEqual({
      timeOrigin: performance.timeOrigin,
    });
  });

  it('timestamps Events relative to the same Window time origin', () => {
    const { window } = createBrowlet();
    const performance = requirePerformance(window);
    const EventConstructor = requireInterface<Event>(window, 'Event');
    const before = performance.now();
    const event = Reflect.construct(EventConstructor, ['test']) as Event;
    const after = performance.now();

    expect(event.timeStamp).toBeGreaterThanOrEqual(before);
    expect(event.timeStamp).toBeLessThanOrEqual(after);
  });

  it('allows Window performance to be replaced', () => {
    const { window } = createBrowlet();
    const original = requirePerformance(window);
    const replacement = Object.freeze({ replacement: true });

    expect(Reflect.set(window, 'performance', replacement)).toBe(true);
    expect(window.performance).toBe(replacement);
    expect(window.performance).not.toBe(original);
    expect(Object.hasOwn(window, 'performance')).toBe(true);
  });

  it('uses a new Performance object and time origin in a new Window realm', async () => {
    const browlet = createBrowlet();
    const windowProxy = browlet.window;
    const initialPerformance = requirePerformance(windowProxy);
    const initialEpochTime = initialPerformance.timeOrigin +
      initialPerformance.now();

    await browlet.navigate('https://example.test/');

    const navigatedPerformance = requirePerformance(windowProxy);
    const navigatedEpochTime = navigatedPerformance.timeOrigin +
      navigatedPerformance.now();

    expect(browlet.window).toBe(windowProxy);
    expect(navigatedPerformance).not.toBe(initialPerformance);
    expect(navigatedEpochTime).toBeGreaterThanOrEqual(initialEpochTime);
  });
});

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}

function requirePerformance(window: WindowProxy): Performance {
  const performance = Reflect.get(window, 'performance') as unknown;

  expect(performance).toBeDefined();
  expect(typeof performance).toBe('object');
  return performance as Performance;
}

function requireInterface<T extends object>(
  window: WindowProxy,
  name: string,
): InterfaceConstructor<T> {
  const constructor = Reflect.get(window, name) as unknown;

  expect(typeof constructor).toBe('function');
  return constructor as InterfaceConstructor<T>;
}

type InterfaceConstructor<T extends object> = CallableFunction & {
  readonly prototype: T;
};
