import { describe, expect, it } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { PerformanceResourceTimingImpl } from '../../../src/browlet/performance/index';
import type { PerformanceResourceTiming, Window } from '../../../src/browlet/platform';
import { FetchHeaders } from '../../../src/fetch/headers';
import { FetchTimingInfo, ResponseBodyInfo } from '../../../src/fetch/timing';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';

describe('Server Timing metrics', () => {
  it('projects a metric interface independent of PerformanceEntry without an author constructor', () => {
    const { entry, window, env } = fixture(['db;dur=2.5;desc=database']);
    const metric = entry.serverTiming[0]!;
    expect(metric).toBeInstanceOf(window.PerformanceServerTiming);
    expect(metric).not.toBeInstanceOf(window.PerformanceEntry);
    expect(Object.prototype.toString.call(metric)).toBe('[object PerformanceServerTiming]');
    expect(() => Reflect.construct(window.PerformanceServerTiming, [])).toThrow(window.TypeError);
    expect(Reflect.set(metric, 'duration', 10)).toBe(false);
    expect(getRelevantRealm(metric)).toBe(env.realm);
    expect(metric.toJSON()).toEqual({ name: 'db', duration: 2.5, description: 'database' });
    expect(Object.keys(metric.toJSON())).toEqual(['name', 'duration', 'description']);
    expect('startTime' in metric).toBe(false);
    expect('entryType' in metric).toBe(false);
  });

  it('retains every repeated metric and physical header line', () => {
    const { entry } = fixture(['miss, db;dur=53, app;dur=47.2', 'db;dur=4;desc="Cache Read"']);
    expect(entry.serverTiming.map((metric) => metric.toJSON())).toEqual([
      { name: 'miss', duration: 0, description: '' },
      { name: 'db', duration: 53, description: '' },
      { name: 'app', duration: 47.2, description: '' },
      { name: 'db', duration: 4, description: 'Cache Read' },
    ]);
    expect(entry.serverTiming[1]).not.toBe(entry.serverTiming[3]);
  });

  it.each([
    ['db;dur=1;dur=2;desc=first;desc=second', 1, 'first'],
    ['DB;DUR=2;DESC=Upper;dur=3;desc=lower', 2, 'Upper'],
    ['db;dur;dur=2;desc;desc=later', 0, ''],
    ['db;dur=invalid;dur=2;desc=;desc=later', 0, ''],
    ['db;x="a,b;c";dur=2;desc=okay', 2, 'okay'],
    ['db;dur=" 2.5 ";desc="a\\"b\\\\c"', 2.5, 'a"b\\c'],
    ['db garbage;dur=3', 3, ''],
    ['db;desc=hello world;dur=3', 3, 'hello'],
    ['db;;dur=3', 3, ''],
    ['db;=ignored;dur=3', 3, ''],
    ['db;desc="a,b;c', 0, ''],
    ['db;desc="escaped\\"', 0, ''],
    ['db;desc="";desc=later', 0, ''],
    ['db;desc="caf\u00e9";dur=2', 2, 'café'],
    [' \tdb \t; DUR \t= \t2.5 \t; DESC = text ', 2.5, 'text'],
  ] as const)('parses %s', (header, duration, description) => {
    const { entry } = fixture([header]);
    expect(entry.serverTiming).toHaveLength(1);
    expect(entry.serverTiming[0]!.toJSON()).toEqual({
      name: header.trimStart().startsWith('DB') ? 'DB' : 'db', duration, description,
    });
  });

  it.each(['"bad";dur=1', ';dur=1', '', ' \t '])('skips an invalid metric %j without losing the following field', (invalid) => {
    const { entry } = fixture([`${invalid}, good;dur=2`]);
    expect(entry.serverTiming.map((metric) => metric.toJSON())).toEqual([{ name: 'good', duration: 2, description: '' }]);
  });

  it.each([
    ['-2', -2], ['-0', 0], ['+2', 2], ['.5', 0.5], ['1.', 1], ['1e2', 100],
    ['1e', 1], ['12x', 12], ['NaN', 0], ['Infinity', 0], ['1e400', 0], ['-1e400', 0],
    ['1e-400', 0], ['0x10', 0], ['', 0], ['0.0000123', 0.0000123],
  ] as const)('uses HTML numeric parsing for dur=%s', (text, duration) => {
    const { entry } = fixture([`db;dur=${text}`]);
    // toBe distinguishes negative zero, and verifies that supplied values are not clock-coarsened.
    expect(entry.serverTiming[0]!.duration).toBe(duration);
  });

  it('retains frozen snapshots and metric identities in the receiver realm', () => {
    const first = fixture(['db;dur=2']);
    const second = fixture([]);
    const list = first.entry.serverTiming;
    expect(list).toBe(first.entry.serverTiming);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.getPrototypeOf(list)).toBe(first.window.Array.prototype);
    expect(Reflect.set(list, '0', {})).toBe(false);
    expect(second.entry.serverTiming).toBe(second.entry.serverTiming);
    expect(Object.isFrozen(second.entry.serverTiming)).toBe(true);
    expect(second.entry.serverTiming).not.toBe(list);

    const borrowed = Reflect.get(second.window.PerformanceResourceTiming.prototype, 'serverTiming', first.entry);
    expect(borrowed).toBe(list);
    expect(Object.getPrototypeOf(borrowed[0])).toBe(first.window.PerformanceServerTiming.prototype);
    expect(() => Reflect.get(second.window.PerformanceResourceTiming.prototype, 'serverTiming', {})).toThrow(second.window.TypeError);
    expect(() => Reflect.get(second.window.PerformanceServerTiming.prototype, 'duration', {})).toThrow(second.window.TypeError);

    const json = second.window.PerformanceResourceTiming.prototype.toJSON.call(first.entry) as { serverTiming: unknown; };
    expect(Object.getPrototypeOf(json)).toBe(second.window.Object.prototype);
    expect(json.serverTiming).toBe(list);
    const metricJSON = second.window.PerformanceServerTiming.prototype.toJSON.call(list[0]!) as object;
    expect(Object.getPrototypeOf(metricJSON)).toBe(second.window.Object.prototype);
    expect(metricJSON).toEqual({ name: 'db', duration: 2, description: '' });
    const serialized = JSON.parse(JSON.stringify(first.entry)) as { serverTiming: unknown; };
    expect(serialized.serverTiming).toEqual([metricJSON]);
  });

  it('uses the filtered header list independently of body-size visibility', () => {
    const { env, timing } = fixture(['db;dur=2']);
    const makeEntry = (input: FetchTimingInfo) => getBindingContext(env.realm).project(PerformanceResourceTimingImpl,
      new PerformanceResourceTimingImpl('fetch', 'https://foreign.test/', input, '', new ResponseBodyInfo(), 0, '', false, input.serverTimingHeaders, env),
    ) as PerformanceResourceTiming;
    expect(makeEntry(timing).serverTiming).toHaveLength(1);
    expect(makeEntry(timing.createOpaque()).serverTiming).toEqual([]);
  });
});

function fixture(fields: string[]) {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const env = navigable.activeDocument!.env;
  const window = env.realm.globalObject as Window & typeof globalThis;
  const timing = new FetchTimingInfo();
  timing.serverTimingHeaders = new FetchHeaders(fields.map((value) => ['Server-Timing', value])).getDecodeAndSplit('Server-Timing') ?? [];
  const implementation = new PerformanceResourceTimingImpl(
    'fetch', 'https://example.test/resource', timing, '', new ResponseBodyInfo(), 200, '', true, timing.serverTimingHeaders, env,
  );
  const entry = getBindingContext(env.realm).project(PerformanceResourceTimingImpl, implementation) as PerformanceResourceTiming;
  return { env, window, timing, entry };
}
