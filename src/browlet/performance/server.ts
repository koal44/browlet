import { TextCursor } from '../../infra/index';
import { defineInterface, definePartialInterface, frozenArray, idlType, impl, op, reference, roAttr, xattr } from '../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../timing/index';
import { collectHTTPTokenOrQuotedString, isHTTPTabOrSpace, isHTTPToken } from '../../http/index';

import { parseFloatingPointNumber } from '../html/microsyntaxes/index';
import type { BrowletEnvironment } from '../environment/index';

/** One server-supplied metric belonging to a resource entry, without a client-clock timestamp. */
// https://w3c.github.io/server-timing/#the-performanceservertiming-interface
export class PerformanceServerTimingImpl {
  env: BrowletEnvironment;
  name: string;
  #params = new Map<string, string>();

  constructor(name: string, env: BrowletEnvironment) {
    this.name = name;
    this.env = env;
  }

  /** Parse one metric from Fetch's already split header list; invalid names produce no metric. */
  // https://w3c.github.io/server-timing/#dfn-parse-a-server-timing-header-field
  static parse(field: string, env: BrowletEnvironment): PerformanceServerTimingImpl | null {
    const cursor = new TextCursor(field);
    cursor.consumeWhile(isHTTPTabOrSpace);
    const start = cursor.pos();
    cursor.consumeWhile(isHTTPToken);
    const name = cursor.slice(start);
    if (name === '') return null;

    const metric = new PerformanceServerTimingImpl(name, env);
    // SPEC_CLASH(server-timing-parsing): Follow the token grammar and first-parameter rule; the draft parser collects non-token names, crosses missing values, and never stores parameters.
    // Browser parameter names are case-insensitive. Ignore junk after tokens and recover at each
    // semicolon; malformed metrics cannot discard later Fetch-split metrics. See the roadmap evidence.
    while (!cursor.eof()) {
      cursor.consumeWhile((ch) => ch !== ';');
      if (!cursor.match(';')) break;
      cursor.consumeWhile(isHTTPTabOrSpace);
      const paramStart = cursor.pos();
      cursor.consumeWhile(isHTTPToken);
      const paramName = cursor.slice(paramStart).toLowerCase();
      if (paramName === '') continue;

      cursor.consumeWhile(isHTTPTabOrSpace);
      let value = '';
      if (cursor.match('=')) {
        cursor.consumeWhile(isHTTPTabOrSpace);
        // All three browsers discard unterminated quoted values; Fetch's permissive collector does not.
        value = collectHTTPTokenOrQuotedString(cursor) ?? '';
      }
      // Even an invalid or missing first value prevents a later duplicate from replacing it.
      if (!metric.#params.has(paramName)) metric.#params.set(paramName, value);
    }
    return metric;
  }

  // https://w3c.github.io/server-timing/#dom-performanceservertiming-duration
  get duration(): DOMHighResTimeStamp {
    const value = this.#params.get('dur');
    // SPEC_CLASH(server-timing-duration): Follow the specified HTML finite-prefix parser. Chromium/Firefox reject numeric suffixes; Chromium/WebKit expose overflowing Infinity; browsers preserve negative zero.
    return value === undefined ? 0 : parseFloatingPointNumber(value) ?? 0;
  }

  // https://w3c.github.io/server-timing/#dom-performanceservertiming-description
  get description(): string { return this.#params.get('desc') ?? ''; }
}

/*
 * [Exposed=(Window,Worker)]
 * interface PerformanceServerTiming {
 *   readonly attribute DOMString name;
 *   readonly attribute DOMHighResTimeStamp duration;
 *   readonly attribute DOMString description;
 *   [Default] object toJSON();
 * };
 */
export const performanceServerTimingIDL = defineInterface({
  name: 'PerformanceServerTiming', exposed: ['Window', 'Worker'], implementation: impl(PerformanceServerTimingImpl),
  members: [
    roAttr('name', idlType.DOMString),
    roAttr('duration', reference('DOMHighResTimeStamp')),
    roAttr('description', idlType.DOMString),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

/*
 * [Exposed=(Window,Worker)]
 * partial interface PerformanceResourceTiming {
 *   readonly attribute FrozenArray<PerformanceServerTiming> serverTiming;
 * };
 */
export const serverTimingResourceIDL = definePartialInterface({
  name: 'PerformanceResourceTiming',
  members: [roAttr('serverTiming', frozenArray(reference('PerformanceServerTiming')))],
});
