import { afterEach, describe, expect, it, vi } from 'vitest';

import * as jsEngine from '../../../src/js-engine/index';
import { FetchTimingInfo, ResponseBodyInfo } from '../../../src/fetch/timing';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { PerformanceNavigationTimingImpl } from '../../../src/browlet/performance/index';
import type { PerformanceNavigationTiming, Window } from '../../../src/browlet/platform';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('Navigation Timing confidence', () => {
  it('returns null before interactive without asking for measurements or consuming randomness', () => {
    const { entry, env } = fixture();
    const measurement = vi.spyOn(env.userAgent, 'getUnderlyingNavigationTimingConfidence').mockReturnValue('high');
    const random = vi.spyOn(jsEngine, 'randomInteger');
    expect(entry.confidence).toBeNull();
    expect(entry.toJSON()).toMatchObject({ confidence: null });
    expect(measurement).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it('keeps the explicit missing host assessment unavailable after interactive', () => {
    const { entry, implementation, env } = fixture();
    implementation.documentTimingInfo.domInteractiveTime = 1;
    const measurement = vi.spyOn(env.userAgent, 'getUnderlyingNavigationTimingConfidence');
    const random = vi.spyOn(jsEngine, 'randomInteger');
    expect(entry.confidence).toBeNull();
    expect(entry.toJSON()).toMatchObject({ confidence: null });
    expect(measurement).toHaveBeenCalledWith(implementation);
    expect(random).not.toHaveBeenCalled();
  });

  it.each([
    { underlying: 'high', coins: [1], expected: 'high' },
    { underlying: 'low', coins: [1], expected: 'low' },
    { underlying: 'high', coins: [0, 0], expected: 'high' },
    { underlying: 'low', coins: [0, 0], expected: 'high' },
    { underlying: 'high', coins: [0, 1], expected: 'low' },
    { underlying: 'low', coins: [0, 1], expected: 'low' },
  ] as const)('randomizes $underlying using $coins into $expected', ({ underlying, coins, expected }) => {
    const { entry, implementation, env } = fixture();
    implementation.documentTimingInfo.domInteractiveTime = 1;
    vi.spyOn(env.userAgent, 'getUnderlyingNavigationTimingConfidence').mockReturnValue(underlying);
    const random = vi.spyOn(jsEngine, 'randomInteger');
    for (const coin of coins) random.mockReturnValueOnce(coin);
    const confidence = entry.confidence!;
    expect(confidence.randomizedTriggerRate).toBe(0.5);
    expect(confidence.value).toBe(expected);
    expect(random).toHaveBeenCalledTimes(coins.length);
    for (const args of random.mock.calls) expect(args).toEqual([0, 2]);
  });

  it('retains one result across getters and JSON even when the underlying assessment changes', () => {
    const { entry, implementation, env } = fixture();
    implementation.documentTimingInfo.domInteractiveTime = 1;
    const measurement = vi.spyOn(env.userAgent, 'getUnderlyingNavigationTimingConfidence').mockReturnValue('high');
    const random = vi.spyOn(jsEngine, 'randomInteger').mockReturnValue(1);
    const confidence = entry.confidence!;
    measurement.mockReturnValue('low');
    expect(entry.confidence).toBe(confidence);
    expect(entry.toJSON()).toMatchObject({ confidence });
    const json = entry.toJSON() as { confidence: unknown; };
    expect(json.confidence).toBe(confidence);
    expect(JSON.parse(JSON.stringify(entry))).toMatchObject({
      confidence: { randomizedTriggerRate: 0.5, value: 'high' },
    });
    expect(measurement).toHaveBeenCalledOnce();
    expect(random).toHaveBeenCalledOnce();
  });

  it('allows a delayed real assessment without caching or randomizing the unavailable state', () => {
    const { entry, implementation, env } = fixture();
    implementation.documentTimingInfo.domInteractiveTime = 1;
    const measurement = vi.spyOn(env.userAgent, 'getUnderlyingNavigationTimingConfidence')
      .mockReturnValueOnce(null).mockReturnValue('low');
    const random = vi.spyOn(jsEngine, 'randomInteger').mockReturnValue(1);
    expect(entry.confidence).toBeNull();
    expect(random).not.toHaveBeenCalled();
    const confidence = entry.confidence!;
    expect(confidence.value).toBe('low');
    expect(entry.confidence).toBe(confidence);
    expect(measurement).toHaveBeenCalledTimes(2);
    expect(random).toHaveBeenCalledOnce();
  });

  it('projects the readonly confidence interface independently of PerformanceEntry', () => {
    const { entry, implementation, env, window } = fixture();
    implementation.documentTimingInfo.domInteractiveTime = 1;
    vi.spyOn(env.userAgent, 'getUnderlyingNavigationTimingConfidence').mockReturnValue('high');
    vi.spyOn(jsEngine, 'randomInteger').mockReturnValue(1);
    const confidence = entry.confidence!;
    expect(confidence).toBeInstanceOf(window.PerformanceTimingConfidence);
    expect(confidence).not.toBeInstanceOf(window.PerformanceEntry);
    expect(Object.prototype.toString.call(confidence)).toBe('[object PerformanceTimingConfidence]');
    const constructor: unknown = window.PerformanceTimingConfidence;
    if (typeof constructor !== 'function') throw new Error('Missing PerformanceTimingConfidence interface');
    expect(() => { Reflect.construct(constructor, []); }).toThrow(window.TypeError);
    expect(Reflect.set(confidence, 'value', 'low')).toBe(false);
    expect(Reflect.set(confidence, 'randomizedTriggerRate', 0)).toBe(false);
    expect(confidence.toJSON()).toEqual({ randomizedTriggerRate: 0.5, value: 'high' });
    expect(Object.keys(confidence.toJSON())).toEqual(['randomizedTriggerRate', 'value']);
    expect(getRelevantRealm(confidence)).toBe(env.realm);
  });

  it('keeps the receiver owner through borrowed getters and the method realm for default JSON', () => {
    const first = fixture();
    const second = fixture();
    first.implementation.documentTimingInfo.domInteractiveTime = 1;
    second.implementation.documentTimingInfo.domInteractiveTime = 1;
    const firstMeasurement = vi.spyOn(first.env.userAgent, 'getUnderlyingNavigationTimingConfidence').mockReturnValue('high');
    const secondMeasurement = vi.spyOn(second.env.userAgent, 'getUnderlyingNavigationTimingConfidence').mockReturnValue('low');
    vi.spyOn(jsEngine, 'randomInteger').mockReturnValue(1);
    const navigationPrototype = second.window.PerformanceNavigationTiming.prototype;
    const borrowed = Reflect.get(navigationPrototype, 'confidence', first.entry);
    expect(borrowed).toBe(first.entry.confidence);
    expect(borrowed).toBeInstanceOf(first.window.PerformanceTimingConfidence);
    expect(firstMeasurement).toHaveBeenCalledWith(first.implementation);
    expect(secondMeasurement).not.toHaveBeenCalled();
    const prototype = second.window.PerformanceTimingConfidence.prototype;
    expect(Reflect.get(prototype, 'value', borrowed)).toBe('high');
    const json = prototype.toJSON.call(borrowed);
    expect(Object.getPrototypeOf(json)).toBe(second.window.Object.prototype);
    expect(json).toEqual({ randomizedTriggerRate: 0.5, value: 'high' });
    expect(() => Reflect.get(prototype, 'value', {})).toThrow(second.window.TypeError);
    expect(second.entry.confidence!.value).toBe('low');
    expect(second.entry.confidence).not.toBe(borrowed);
  });
});

function fixture() {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = navigable.activeDocument!;
  const env = document.env;
  const implementation = new PerformanceNavigationTimingImpl('https://example.test/', {
    type: 'navigate', redirectCount: 0, fetchTimingInfo: new FetchTimingInfo(), bodyInfo: new ResponseBodyInfo(),
    documentTimingInfo: document.loadTimingInfo, previousDocumentUnloadTiming: document.previousDocumentUnloadTiming,
    serviceWorkerTimingInfo: null, cacheUsage: undefined, responseStatus: 200, contentType: '', serverTimingHeaders: [],
  }, 0, null, true, env);
  const entry = getBindingContext(env.realm).project(PerformanceNavigationTimingImpl, implementation) as PerformanceNavigationTiming;
  return { implementation, entry, env, window: env.realm.globalObject as Window & typeof globalThis };
}
