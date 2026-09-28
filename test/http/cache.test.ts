import { describe, expect, it } from 'vitest';

import {
  CacheControl, calculateCacheFreshness, canStoreResponse, evaluateCacheRequest,
  parseDeltaSeconds, parseVary, shouldInvalidateCache, type CacheHeaderValues, type CacheTiming,
} from '../../src/http/cache';

const received = Date.UTC(2026, 8, 7, 12);
const date = new Date(received).toUTCString();
const timing: CacheTiming = { requestTime: received, responseTime: received, now: received };
const minute: CacheHeaderValues = { date, cacheControl: 'max-age=60' };

describe('Cache-Control field parsing (RFC 9111 §5.2)', () => {
  it('preserves order and duplicates while folding directive names', () => {
    expect(CacheControl.parse('max-age=60, No-Cache, MAX-AGE="30", extension=Token')?.directives).toEqual([
      { name: 'max-age', value: '60' },
      { name: 'no-cache', value: null },
      { name: 'max-age', value: '30' },
      { name: 'extension', value: 'Token' },
    ]);
  });

  it('keeps quoted commas and unescapes quoted pairs, including obs-text', () => {
    expect(CacheControl.parse('private="Set-Cookie, X-User", x="a\\"b\\\\c\\\xff\t", empty=""')?.directives).toEqual([
      { name: 'private', value: 'Set-Cookie, X-User' },
      { name: 'x', value: 'a"b\\c\xff\t' },
      { name: 'empty', value: '' },
    ]);
  });

  it('accepts the HTTP token alphabet', () => {
    const token = '!#$%&\'*+-.^_`|~0123456789Az';
    expect(CacheControl.parse(`${token}=${token}`)?.directives).toEqual([
      { name: token.toLowerCase(), value: token },
    ]);
  });

  it.each(['', ' \t', ',, ,\t,'])('ignores empty list members in %j', (input) => {
    expect(CacheControl.parse(input)?.directives).toEqual([]);
  });

  it('accepts whitespace and empty members around directives', () => {
    expect(CacheControl.parse(' , max-age=60 \t, , no-store, ')?.directives).toEqual([
      { name: 'max-age', value: '60' }, { name: 'no-store', value: null },
    ]);
  });

  it('finds bare, valued, repeated, and extension directives by lowercase name', () => {
    const control = CacheControl.parse('NO-CACHE, max-age=0, max-age=60, extension=""')!;
    expect(control.has('no-cache')).toBe(true);
    expect(control.has('max-age')).toBe(true);
    expect(control.has('extension')).toBe(true);
    expect(control.has('no-store')).toBe(false);
  });

  it.each<[string, number | null | undefined]>([
    ['', undefined], ['max-age', null], ['max-age=""', null],
    ['max-age=0', 0], ['max-age="60"', 60], ['max-age=-1', null],
    ['max-age=60, MAX-AGE=60', null], ['max-age=60, max-age=30', null],
  ])('distinguishes absent, invalid, and valid seconds in %j', (input, expected) => {
    expect(CacheControl.parse(input)!.getDeltaSeconds('max-age')).toBe(expected);
  });

  it('applies a bare-directive meaning only when an argument is absent', () => {
    expect(CacheControl.parse('max-stale')!.getDeltaSeconds('max-stale', Infinity)).toBe(Infinity);
    expect(CacheControl.parse('max-stale=""')!.getDeltaSeconds('max-stale', Infinity)).toBeNull();
    expect(CacheControl.parse('max-stale=0')!.getDeltaSeconds('max-stale', Infinity)).toBe(0);
  });

  it.each([
    '=60', 'max-age=', 'max-age =60', 'max-age= 60', 'max-age=60 no-cache',
    'max-age=60; no-cache', 'x="unterminated', 'x="trailing\\',
    'x="closed"tail', 'x="a\rb"', 'x="a\nb"', 'x="\0"', 'x="\x7f"',
    'x="💩"', 'x="\\\x7f"', 'max-age=60\r\nno-store', '\u00a0max-age=60',
  ])('rejects malformed field syntax %j', (input) => {
    expect(CacheControl.parse(input)).toBeNull();
  });
});

describe('delta-seconds (RFC 9111 §1.2.2)', () => {
  it.each([
    ['0', 0], ['00060', 60], ['2147483648', 2147483648],
    ['4294967296', 4294967296],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ['9007199254740992', Number.MAX_SAFE_INTEGER],
    ['9'.repeat(400), Number.MAX_SAFE_INTEGER],
  ])('parses %j without wraparound', (input, expected) => {
    expect(parseDeltaSeconds(input)).toBe(expected);
  });

  it.each(['', '-1', '+1', '1.5', '1e2', 'Infinity', '1x', ' 1', '1 ', '1\n', '１'])('rejects %j', (input) => {
    expect(parseDeltaSeconds(input)).toBeNull();
  });
});

describe('Vary field syntax (RFC 9110 §12.5.5)', () => {
  it('normalizes field names while preserving their order and duplicates', () => {
    expect(parseVary('Accept, ACCEPT-LANGUAGE, accept')).toEqual(['accept', 'accept-language', 'accept']);
  });

  it('accepts surrounding HTTP whitespace and empty list members', () => {
    expect(parseVary(' , Accept \t, , X-Variant, ')).toEqual(['accept', 'x-variant']);
    expect(parseVary(' , \t, ')).toEqual([]);
  });

  it('preserves wildcard members for the cache policy to reject matching', () => {
    expect(parseVary('*')).toEqual(['*']);
    expect(parseVary('Accept, *, X-Test')).toEqual(['accept', '*', 'x-test']);
    expect(parseVary('X-*')).toEqual(['x-*']);
  });

  it.each(['"Accept"', 'Accept Language', 'Accept;X-Test', 'Accept=X-Test', 'Accept\n', '\u00a0Accept', 'X-💩'])(
    'rejects malformed field names %j', (input) => {
      expect(parseVary(input)).toBeNull();
    },
  );
});

describe('private HTTP cache storage policy (RFC 9111 §3)', () => {
  it.each([200, 203, 204, 300, 301, 308, 404, 405, 410, 414, 501])(
    'allows a complete GET response with heuristically cacheable status %i', (status) => {
      expect(canStoreResponse('GET', status, {})).toBe(true);
    },
  );

  it.each(['public', 'private', 'private="Set-Cookie, Authorization"', 'max-age=60'])(
    'allows explicitly cacheable responses with %j', (cacheControl) => {
      expect(canStoreResponse('GET', 302, { cacheControl })).toBe(true);
    },
  );

  it('allows HEAD storage without claiming its fields can satisfy a GET body', () => {
    expect(canStoreResponse('HEAD', 200, {})).toBe(true);
  });

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'CUSTOM', 'get'])(
    'leaves unsupported method %s unstored', (method) => {
      expect(canStoreResponse(method, 200, { cacheControl: 'public, max-age=60' })).toBe(false);
    },
  );

  it.each([0, 100, 103, 199, 206, 304, 600])('does not store status %i as a complete response', (status) => {
    expect(canStoreResponse('GET', status, { cacheControl: 'public, max-age=60' })).toBe(false);
  });

  it('requires explicit permission for non-heuristic status codes', () => {
    expect(canStoreResponse('GET', 302, {})).toBe(false);
    expect(canStoreResponse('GET', 500, {})).toBe(false);
    expect(canStoreResponse('GET', 500, { cacheControl: 'max-age=60' })).toBe(true);
    expect(canStoreResponse('GET', 302, { expires: new Date(received).toUTCString() })).toBe(true);
  });

  it('does not treat shared-cache directives or stale extensions as storage permission', () => {
    expect(canStoreResponse('GET', 302, { cacheControl: 's-maxage=60' })).toBe(false);
    expect(canStoreResponse('GET', 302, {
      cacheControl: 'stale-while-revalidate=30, stale-if-error=30',
    })).toBe(false);
    expect(canStoreResponse('GET', 200, { cacheControl: 'private, s-maxage=0' })).toBe(true);
  });

  it.each(['no-store', 'NO-STORE', 'private, no-store', 'public, no-store', 'no-store="ignored"'])(
    'honors response storage prohibition %j', (cacheControl) => {
      expect(canStoreResponse('GET', 200, { cacheControl })).toBe(false);
    },
  );

  it('honors request no-store independently of response permission', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'public' }, 'no-store')).toBe(false);
    expect(canStoreResponse('GET', 200, { cacheControl: 'max-age=60' }, 'private')).toBe(true);
  });

  it('allows storing responses that require validation, even without a validator', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'no-cache' })).toBe(true);
    expect(canStoreResponse('GET', 200, { cacheControl: 'no-cache="ETag"' }, 'no-cache')).toBe(true);
    expect(canStoreResponse('GET', 302, { expires: '0' })).toBe(true);
    expect(canStoreResponse('GET', 302, { cacheControl: 'max-age=invalid' })).toBe(true);
  });

  it('does not opt into must-understand storage before status-specific storage exists', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'must-understand, max-age=60' })).toBe(false);
    expect(canStoreResponse('GET', 471, { cacheControl: 'must-understand, public' })).toBe(false);
    expect(canStoreResponse('GET', 200, { cacheControl: 'must-understand, no-store' })).toBe(false);
  });

  it('ignores unknown well-formed directives', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'extension="a,b"' }, 'extension=42')).toBe(true);
  });

  it('declines malformed Cache-Control on either side', () => {
    expect(canStoreResponse('GET', 200, { cacheControl: 'public; no-store' })).toBe(false);
    expect(canStoreResponse('GET', 200, {}, 'no-store; max-age=60')).toBe(false);
  });

  it('leaves wildcard and malformed Vary responses unstored', () => {
    expect(canStoreResponse('GET', 200, { vary: '*' })).toBe(false);
    expect(canStoreResponse('GET', 200, { vary: 'Accept, *' })).toBe(false);
    expect(canStoreResponse('GET', 200, { vary: 'Accept; Accept-Language' })).toBe(false);
    expect(canStoreResponse('GET', 200, { vary: 'Accept, Accept-Language' })).toBe(true);
  });
});

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

describe('request restrictions on cache reuse (RFC 9111 §5.2.1)', () => {
  const fresh = calculateCacheFreshness({ cacheControl: 'max-age=60' }, 200, {
    ...timing, now: received + 20_000,
  });
  const stale = calculateCacheFreshness({ cacheControl: 'max-age=60' }, 200, {
    ...timing, now: received + 70_000,
  });

  it('permits a fresh response but not an unconditionally stale response', () => {
    expect(evaluateCacheRequest(fresh)).toEqual({ canReuse: true, onlyIfCached: false });
    expect(evaluateCacheRequest(stale).canReuse).toBe(false);
  });

  it('allows an existing response for request no-store, while prohibiting new storage', () => {
    expect(evaluateCacheRequest(fresh, 'no-store').canReuse).toBe(true);
    expect(canStoreResponse('GET', 200, {}, 'no-store')).toBe(false);
  });

  it('requires validation for request or response no-cache, regardless of freshness', () => {
    expect(evaluateCacheRequest(fresh, 'no-cache').canReuse).toBe(false);
    const response = calculateCacheFreshness({ cacheControl: 'max-age=60, no-cache' }, 200, timing);
    expect(evaluateCacheRequest(response).canReuse).toBe(false);
  });

  it('honors inclusive request max-age and min-fresh limits', () => {
    expect(evaluateCacheRequest(fresh, 'max-age=20').canReuse).toBe(true);
    expect(evaluateCacheRequest(fresh, 'max-age=19').canReuse).toBe(false);
    expect(evaluateCacheRequest(fresh, 'min-fresh=40').canReuse).toBe(true);
    expect(evaluateCacheRequest(fresh, 'min-fresh=41').canReuse).toBe(false);
    expect(evaluateCacheRequest(fresh, 'max-age=20, min-fresh=41').canReuse).toBe(false);
  });

  it('accepts quoted numeric directives from recipients', () => {
    expect(evaluateCacheRequest(fresh, 'MAX-AGE="20", MIN-FRESH="40"').canReuse).toBe(true);
  });

  it('permits max-stale up to and including its requested limit', () => {
    expect(evaluateCacheRequest(stale, 'max-stale=10').canReuse).toBe(true);
    expect(evaluateCacheRequest(stale, 'max-stale=9').canReuse).toBe(false);
    expect(evaluateCacheRequest(stale, 'max-stale').canReuse).toBe(true);
    expect(evaluateCacheRequest(stale, 'max-stale, max-age=69').canReuse).toBe(false);
    expect(evaluateCacheRequest(stale, 'max-stale, min-fresh=0').canReuse).toBe(false);
  });

  it('distinguishes newly expired from fresh at the lifetime boundary', () => {
    const expired = calculateCacheFreshness({ cacheControl: 'max-age=60' }, 200, {
      ...timing, now: received + 60_000,
    });
    expect(evaluateCacheRequest(expired).canReuse).toBe(false);
    expect(evaluateCacheRequest(expired, 'max-stale=0').canReuse).toBe(true);
  });

  it.each(['no-cache', 'must-revalidate'])(
    'does not let max-stale override response %s', (directive) => {
      const response = calculateCacheFreshness({ cacheControl: `max-age=60, ${directive}` }, 200, {
        ...timing, now: received + 70_000,
      });
      expect(evaluateCacheRequest(response, 'max-stale').canReuse).toBe(false);
    },
  );

  it.each([
    'max-age', 'min-fresh', 'max-age=-1', 'min-fresh=invalid', 'max-stale=-1',
    'max-age=20, max-age=20', 'min-fresh=1, min-fresh=2', 'max-stale, max-stale=10',
    'max-age=20; no-cache',
  ])('conservatively rejects reuse for invalid or duplicate constraints %j', (cacheControl) => {
    expect(evaluateCacheRequest(fresh, cacheControl).canReuse).toBe(false);
  });

  it('keeps only-if-cached visible on both cache hits and misses', () => {
    expect(evaluateCacheRequest(fresh, 'only-if-cached')).toEqual({ canReuse: true, onlyIfCached: true });
    expect(evaluateCacheRequest(stale, 'only-if-cached')).toEqual({ canReuse: false, onlyIfCached: true });
    expect(evaluateCacheRequest(fresh, 'only-if-cached, no-cache')).toEqual({
      canReuse: false, onlyIfCached: true,
    });
    expect(evaluateCacheRequest(fresh, 'only-if-cached, max-age=invalid').onlyIfCached).toBe(true);
  });

  it('does not turn response stale extensions into unconditional reuse', () => {
    const response = calculateCacheFreshness({
      cacheControl: 'max-age=60, stale-while-revalidate=30, stale-if-error=30',
    }, 200, { ...timing, now: received + 70_000 });
    expect(response.staleWhileRevalidate).toBe(true);
    expect(response.staleIfError).toBe(true);
    expect(evaluateCacheRequest(response).canReuse).toBe(false);
  });

  it('ignores unknown and response-only request directives', () => {
    expect(evaluateCacheRequest(fresh, 's-maxage=0, must-revalidate, extension="a,b"').canReuse).toBe(true);
  });
});

describe('cache invalidation trigger (RFC 9111 §4.4)', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'TRACE'])('does not invalidate for safe method %s', (method) => {
    expect(shouldInvalidateCache(method, 200)).toBe(false);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'CUSTOM'])(
    'invalidates for a non-error %s response, including unknown method safety', (method) => {
      expect(shouldInvalidateCache(method, 200)).toBe(true);
      expect(shouldInvalidateCache(method, 302)).toBe(true);
    },
  );

  it.each([0, 100, 103, 400, 404, 500])('does not invalidate after status %i', (status) => {
    expect(shouldInvalidateCache('POST', status)).toBe(false);
  });
});
