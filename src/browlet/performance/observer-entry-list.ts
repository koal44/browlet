import { arg, defineInterface, idlType, impl, op, reference } from '../../web-idl/core/index';

import type { BrowletEnvironment } from '../environment/index';

import { PerformanceEntryBuffer, type PerformanceEntryImpl } from './timeline';

/** A delivered observer batch, independent of subsequent changes to its observer. */
// https://w3c.github.io/performance-timeline/#performanceobserverentrylist-interface
export class PerformanceObserverEntryListImpl {
  /** Environment owning the batch's platform object and query results. */
  env: BrowletEnvironment;
  /** The batch transferred by observer delivery; queries leave its order intact. */
  #entries: PerformanceEntryImpl[];

  constructor(entries: PerformanceEntryImpl[], env: BrowletEnvironment) {
    this.env = env;
    this.#entries = entries;
  }

  /** Return a fresh chronological view, including observer-only entry types. */
  // https://w3c.github.io/performance-timeline/#performanceobserverentrylist-getentries-method
  getEntries(): PerformanceEntryImpl[] {
    return PerformanceEntryBuffer.filterByNameAndType(this.#entries, null, null);
  }

  /** Return entries with exactly the converted type. */
  // https://w3c.github.io/performance-timeline/#performanceobserverentrylist-getentriesbytype-method
  getEntriesByType(type: string): PerformanceEntryImpl[] {
    return PerformanceEntryBuffer.filterByNameAndType(this.#entries, null, type);
  }

  /** Return entries with exactly the converted name and optional type. */
  // https://w3c.github.io/performance-timeline/#performanceobserverentrylist-getentriesbyname-method
  getEntriesByName(name: string, type?: string): PerformanceEntryImpl[] {
    return PerformanceEntryBuffer.filterByNameAndType(this.#entries, name, type ?? null);
  }
}

/*
 * [Exposed=(Window,Worker)]
 * interface PerformanceObserverEntryList {
 *   PerformanceEntryList getEntries();
 *   PerformanceEntryList getEntriesByType(DOMString type);
 *   PerformanceEntryList getEntriesByName(DOMString name, optional DOMString type);
 * };
 */
// SPEC_CLASH(performance-query-result-realm): The approved receiver-realm result convention also applies to observer-list queries; Chromium/WebKit agree and Firefox uses the borrowed method's realm.
export const performanceObserverEntryListIDL = defineInterface({
  name: 'PerformanceObserverEntryList', exposed: ['Window', 'Worker'], implementation: impl(PerformanceObserverEntryListImpl),
  members: [
    op('getEntries', reference('PerformanceEntryList')),
    op('getEntriesByType', reference('PerformanceEntryList'), [arg('type', idlType.DOMString)]),
    op('getEntriesByName', reference('PerformanceEntryList'), [
      arg('name', idlType.DOMString), arg('type', idlType.DOMString, { optional: true }),
    ]),
  ],
});
