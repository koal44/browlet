import { describe, expect, it } from 'vitest';

import {
  calculateCacheFreshness, type CacheFields, type CacheTiming,
} from '../../../src/fetch/http/cache/freshness';

const received = Date.UTC(2026, 8, 7, 12);
const date = new Date(received).toUTCString();
const timing: CacheTiming = { requestTime: received, responseTime: received, now: received };
const minute: CacheFields = { date, cacheControl: 'max-age=60' };

describe('HTTP cache age (RFC 9111 §4.2.3)', () => {
  it('counts upstream Age, response delay, and residence time', () => {
    const result = calculateCacheFreshness({ ...minute, age: '50' }, 200, {
      requestTime: received - 2000, responseTime: received, now: received + 5000,
    });
    expect(result.currentAge).toBe(57);
    expect(result.freshnessLifetime).toBe(60);
    expect(result.fresh).toBe(true);
  });

  it('uses apparent age when it exceeds the corrected Age value', () => {
    const result = calculateCacheFreshness({
      ...minute, date: new Date(received - 30_000).toUTCString(), age: '5',
    }, 200, { requestTime: received - 2000, responseTime: received, now: received + 5000 });
    expect(result.currentAge).toBe(35);
  });

  it('does not let a server clock in the future produce negative age', () => {
    const result = calculateCacheFreshness({
      date: new Date(received + 86_400_000).toUTCString(),
    }, 200, { requestTime: received - 250, responseTime: received, now: received + 125 });
    expect(result.currentAge).toBe(0.375);
  });

  it.each([
    [undefined, 0], ['', 0], ['nonsense', 0], ['-5', 0], ['1.5', 0],
    [' \t10\t ', 10], ['10, 999', 10], ['invalid, 999', 0], ['0, 999', 0],
  ])('interprets Age %j as %j seconds', (age, expected) => {
    expect(calculateCacheFreshness({ age }, 200, timing).currentAge).toBe(expected);
  });

  it.each([undefined, 'invalid', '0'])('uses receipt time for Date %j', (date) => {
    const result = calculateCacheFreshness({ date }, 200, {
      requestTime: received - 1000, responseTime: received, now: received + 2000,
    });
    expect(result.currentAge).toBe(3);
  });

  it('saturates age arithmetic on overflow', () => {
    const result = calculateCacheFreshness({ age: '9'.repeat(400) }, 200, {
      requestTime: received - 1000, responseTime: received, now: received + 10_000,
    });
    expect(result.currentAge).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.fresh).toBe(false);
  });
});

describe('HTTP cache freshness lifetime (RFC 9111 §4.2.1)', () => {
  it.each(['max-age=60', 'MAX-AGE="60"', 'unknown="a,b", max-age=60'])('uses %j ahead of Expires', (cacheControl) => {
    const result = calculateCacheFreshness({ cacheControl, expires: 'invalid' }, 200, timing);
    expect(result.freshnessLifetime).toBe(60);
    expect(result.fresh).toBe(true);
  });

  it('ignores shared-cache s-maxage and proxy-revalidate', () => {
    const result = calculateCacheFreshness({
      cacheControl: 's-maxage=0, max-age=60, proxy-revalidate, stale-while-revalidate=30',
    }, 200, { ...timing, now: received + 70_000 });
    expect(result.freshnessLifetime).toBe(60);
    expect(result.staleWhileRevalidate).toBe(true);
  });

  it('subtracts Date from Expires, independently of the local clock', () => {
    const result = calculateCacheFreshness({
      date: new Date(received - 120_000).toUTCString(),
      expires: new Date(received - 30_000).toUTCString(),
    }, 200, timing);
    expect(result.freshnessLifetime).toBe(90);
    expect(result.currentAge).toBe(120);
    expect(result.fresh).toBe(false);
  });

  it('uses receipt time when Expires has no valid Date', () => {
    expect(calculateCacheFreshness({
      expires: new Date(received + 30_000).toUTCString(),
    }, 200, timing).freshnessLifetime).toBe(30);
  });

  it.each([
    { expires: '0' }, { expires: '' }, { expires: 'invalid' },
    { expires: `${date}, ${date}` },
    { cacheControl: 'max-age=-1' }, { cacheControl: 'max-age=1.5' },
    { cacheControl: 'max-age=60, max-age=60' }, { cacheControl: 'max-age' },
    { cacheControl: 'max-age="invalid"' }, { cacheControl: 'max-age=60; no-cache' },
  ])('requires validation for invalid/duplicate freshness fields %j', (fields) => {
    const result = calculateCacheFreshness({
      lastModified: new Date(received - 1_000_000).toUTCString(), ...fields,
    }, 200, timing);
    expect(result.freshnessLifetime).toBe(0);
    expect(result.fresh).toBe(false);
    expect(result.requiresValidation).toBe(true);
  });

  it('distinguishes chronological freshness from no-cache validation', () => {
    const result = calculateCacheFreshness({ cacheControl: 'max-age=60, no-cache' }, 200, timing);
    expect(result.fresh).toBe(true);
    expect(result.requiresValidation).toBe(true);
  });

  it('does not equate freshness with permission to store a no-store response', () => {
    const result = calculateCacheFreshness({ cacheControl: 'max-age=60, no-store' }, 200, timing);
    expect(result.freshnessLifetime).toBe(60);
    expect(result.fresh).toBe(true);
  });

  it('clamps past expiration to zero and treats the exact expiry as stale', () => {
    expect(calculateCacheFreshness({ expires: new Date(received - 1000).toUTCString() }, 200, timing)
      .freshnessLifetime).toBe(0);
    expect(calculateCacheFreshness(minute, 200, { ...timing, now: received + 59_999 }).fresh).toBe(true);
    expect(calculateCacheFreshness(minute, 200, { ...timing, now: received + 60_000 }).fresh).toBe(false);
  });
});

describe('Heuristic freshness (RFC 9111 §4.2.2)', () => {
  const lastModified = new Date(received - 100_000).toUTCString();

  it.each([200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501])('uses 10%% of time since Last-Modified for status %j', (status) => {
    expect(calculateCacheFreshness({ date, lastModified }, status, timing).freshnessLifetime).toBe(10);
  });

  it.each([201, 302, 303, 307, 400, 500])('does not infer freshness for status %j', (status) => {
    expect(calculateCacheFreshness({ date, lastModified }, status, timing).freshnessLifetime).toBe(0);
  });

  it.each(['public', 'private'])('permits a private cache to estimate an explicitly cacheable %j response', (cacheControl) => {
    expect(calculateCacheFreshness({ date, lastModified, cacheControl }, 302, timing).freshnessLifetime).toBe(10);
  });

  it.each([undefined, '', 'invalid', new Date(received + 1000).toUTCString()])('does not invent a positive lifetime for Last-Modified %j', (lastModified) => {
    expect(calculateCacheFreshness({ date, lastModified }, 200, timing).freshnessLifetime).toBe(0);
  });

  it('never replaces explicit expiration with a heuristic', () => {
    for (const fields of [{ cacheControl: 'max-age=0' }, { expires: date }]) {
      expect(calculateCacheFreshness({ date, lastModified, ...fields }, 200, timing).freshnessLifetime).toBe(0);
    }
  });
});

describe('Stale windows (RFC 5861)', () => {
  const fields = { cacheControl: 'max-age=60, stale-while-revalidate=30, stale-if-error=120' };

  it.each([
    [59, true, false, false], [60, false, true, true],
    [89.999, false, true, true], [90, false, false, true],
    [179.999, false, false, true], [180, false, false, false],
  ])('classifies age %j', (seconds, fresh, staleWhileRevalidate, staleIfError) => {
    expect(calculateCacheFreshness(fields, 200, { ...timing, now: received + seconds * 1000 }))
      .toMatchObject({ fresh, staleWhileRevalidate, staleIfError });
  });

  it.each(['no-cache', 'no-cache="X-Private"', 'must-revalidate', 'no-store'])('does not allow stale extensions to override %j', (restriction) => {
    expect(calculateCacheFreshness({ cacheControl: `${fields.cacheControl}, ${restriction}` }, 200, {
      ...timing, now: received + 70_000,
    })).toMatchObject({ staleWhileRevalidate: false, staleIfError: false });
  });

  it('must-revalidate permits fresh reuse but requires validation once stale', () => {
    const fields = { cacheControl: 'max-age=60, must-revalidate' };
    expect(calculateCacheFreshness(fields, 200, timing).requiresValidation).toBe(false);
    expect(calculateCacheFreshness(fields, 200, { ...timing, now: received + 60_000 }).requiresValidation)
      .toBe(true);
  });

  it.each([
    '', ', stale-while-revalidate=0, stale-if-error=0',
    ', stale-while-revalidate=-1, stale-if-error=oops',
    ', stale-while-revalidate=30, stale-while-revalidate=30, stale-if-error=120, stale-if-error=120',
  ])('does not infer a stale window from absent/invalid directives %j', (suffix) => {
    expect(calculateCacheFreshness({ cacheControl: 'max-age=60' + suffix }, 200, {
      ...timing, now: received + 60_000,
    })).toMatchObject({ fresh: false, staleWhileRevalidate: false, staleIfError: false });
  });

  it('preserves the supplied fields and timestamps', () => {
    const frozenFields = Object.freeze({ ...fields });
    const frozenTiming = Object.freeze({ ...timing });
    calculateCacheFreshness(frozenFields, 200, frozenTiming);
    expect(frozenFields).toEqual(fields);
    expect(frozenTiming).toEqual(timing);
  });
});
