import { InternalError } from '../../infra/index';
import {
  arg, defineInterface, definePartialInterface, defineTypedef, idlType, impl, op,
  reference, roAttr, sequence, xattr,
} from '../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../timing/index';

import type { BrowletEnvironment } from '../environment/index';

import type { PerformanceObserverInit } from './observer';

/*
 * typedef sequence<PerformanceEntry> PerformanceEntryList;
 */
export const performanceEntryListIDL = defineTypedef({
  name: 'PerformanceEntryList', type: sequence(reference('PerformanceEntry')),
});

// This is Performance Timeline's contribution to High Resolution Time's Performance.
// SPEC_CLASH(performance-query-result-realm): Keep ordinary Binding's receiver-realm arrays, as Chromium/WebKit do; Firefox uses the borrowed method's realm.
/*
 * partial interface Performance {
 *   PerformanceEntryList getEntries();
 *   PerformanceEntryList getEntriesByType(DOMString type);
 *   PerformanceEntryList getEntriesByName(DOMString name, optional DOMString type);
 * };
 */
export const performanceTimelineIDL = definePartialInterface({
  name: 'Performance',
  members: [
    op('getEntries', reference('PerformanceEntryList')),
    op('getEntriesByType', reference('PerformanceEntryList'), [arg('type', idlType.DOMString)]),
    op('getEntriesByName', reference('PerformanceEntryList'), [
      arg('name', idlType.DOMString), arg('type', idlType.DOMString, { optional: true }),
    ]),
  ],
});

/** One global's entry buffer and registry metadata for one timing family. */
// https://w3c.github.io/performance-timeline/#performance-entry-buffer-map
export class PerformanceEntryBuffer {
  /** Retained implementations, in insertion order; querying never mutates this list. */
  entries: PerformanceEntryImpl[] = [];
  /** Current capacity; resource timing can update its own buffer limit. */
  maxBufferSize: number;
  /** Whether Performance's synchronous queries may expose this timing family. */
  availableFromTimeline: boolean;
  /** Entries refused by the primary buffer, including resource entries diverted for possible rescue. */
  droppedEntriesCount = 0;

  constructor(type: PerformanceEntryType) {
    const registration = entryTypes[type];
    this.maxBufferSize = registration.maxBufferSize;
    this.availableFromTimeline = registration.availableFromTimeline;
  }

  /** Return a fresh, chronological list with exact optional name/type filtering. */
  // https://w3c.github.io/performance-timeline/#dfn-filter-buffer-by-name-and-type
  static filterByNameAndType(
    entries: PerformanceEntryImpl[], name: string | null, type: string | null,
  ): PerformanceEntryImpl[] {
    const result: PerformanceEntryImpl[] = [];
    PerformanceEntryBuffer.appendMatchingEntries(entries, name, type, result);
    return result.sort((a, b) => a.startTime - b.startTime);
  }

  /** Append matches in stored order so a caller combining buffers can sort its final result once. */
  // Matching portion of https://w3c.github.io/performance-timeline/#dfn-filter-buffer-by-name-and-type
  static appendMatchingEntries(
    entries: PerformanceEntryImpl[], name: string | null, type: string | null, result: PerformanceEntryImpl[],
  ): void {
    const filterName = name !== null;
    const filterType = type !== null;
    for (const entry of entries) {
      if (filterName && entry.name !== name) continue;
      if (filterType && entry.entryType !== type) continue;
      result.push(entry);
    }
  }

  /** Check capacity and count one dropped entry when a caller has an eligible entry. */
  // https://w3c.github.io/performance-timeline/#dfn-determine-if-a-performance-entry-buffer-is-full
  isFull(): boolean {
    if (this.entries.length < this.maxBufferSize) return false;
    this.droppedEntriesCount++;
    return true;
  }
}

/** Shared entry state; each timing producer supplies already converted timestamps. */
// https://w3c.github.io/performance-timeline/#the-performanceentry-interface
export class PerformanceEntryImpl {
  /** Environment owning this entry's platform object. */
  env: BrowletEnvironment;
  /** Producer-supplied name, which need not be unique. */
  name: string;
  /** Registered timing family; knowing a type does not implement its producer. */
  entryType: PerformanceEntryType;
  /** First timestamp, relative to the entry's own time origin. */
  startTime: DOMHighResTimeStamp;
  /** Last timestamp; zero means the measurement has not ended. */
  endTime: DOMHighResTimeStamp;
  /** Producer-captured navigation association; queueing fills zero for Window entries. */
  // https://wicg.github.io/soft-navigations/#the-performanceentry-extension
  // TODO(Soft Navigations §6.2.2 / producer integration): Capture IDs when a producer exposes an
  // entry before queueing, or must retain an earlier navigation's attribution across asynchronous work.
  navigationId = 0;

  // https://w3c.github.io/performance-timeline/#initialize-a-performanceentry
  constructor(
    startTime: DOMHighResTimeStamp, entryType: PerformanceEntryType, name: string,
    endTime: DOMHighResTimeStamp = 0, env: BrowletEnvironment,
  ) {
    if (!Object.hasOwn(entryTypes, entryType)) throw new InternalError('Unregistered performance entry type');
    this.env = env;
    this.startTime = startTime;
    this.entryType = entryType;
    this.name = name;
    this.endTime = endTime;
  }

  // https://w3c.github.io/performance-timeline/#dom-performanceentry-duration
  get duration(): DOMHighResTimeStamp {
    return this.endTime === 0 ? 0 : this.endTime - this.startTime;
  }

  /** Whether this entry is eligible for the timeline or an observer's subscription. */
  // https://w3c.github.io/timing-entrytypes-registry/#dfn-should-add-entry
  shouldAdd(_options?: PerformanceObserverInit): boolean {
    if (this.entryType === 'event' || this.entryType === 'first-input') {
      // TODO(Event Timing, "should add PerformanceEventTiming"): Apply durationThreshold
      // and the separate global-buffer rules when the Event Timing producer exists.
      throw new InternalError('PerformanceEventTiming entry admission is not implemented');
    }
    // Every other current registry row specifies "Return true"; this does not implement its producer.
    return true;
  }
}

// This excerpt preserves the Timeline draft verbatim. Browlet omits id and supplies
// navigationId through the Soft Navigations partial below.
/*
 * [Exposed=(Window,Worker)]
 * interface PerformanceEntry {
 *   readonly attribute unsigned long long id;
 *   readonly attribute DOMString name;
 *   readonly attribute DOMString entryType;
 *   readonly attribute DOMHighResTimeStamp startTime;
 *   readonly attribute DOMHighResTimeStamp duration;
 *   readonly attribute unsigned long long navigationId;
 *   [Default] object toJSON();
 * };
 */
export const performanceEntryIDL = defineInterface({
  name: 'PerformanceEntry', exposed: ['Window', 'Worker'], implementation: impl(PerformanceEntryImpl),
  members: [
    // SPEC_CLASH(performance-entry-id): Omit the draft's numeric id, identified as incorrectly added in Timeline issue #218 and conflicting with Element Timing's string id. PR #219 proposes its removal.
    // roAttr('id', idlType.unsignedLongLong),
    roAttr('name', idlType.DOMString),
    roAttr('entryType', idlType.DOMString),
    roAttr('startTime', reference('DOMHighResTimeStamp')),
    roAttr('duration', reference('DOMHighResTimeStamp')),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

// This relocates the existing navigationId declaration without adding or changing its IDL shape.
// Keep Soft Navigations' contribution beside the primary interface until its producer has an owner.
// SPEC_CLASH(performance-entry-navigation-id): Follow the newer Soft Navigations extension; Timeline still declares this on the primary interface with conflicting initialization/queueing rules.
/*
 * [Exposed=(Window,Worker)]
 * partial interface PerformanceEntry {
 *     readonly attribute unsigned long long navigationId;
 * };
 */
export const performanceEntryNavigationIDL = definePartialInterface({
  name: 'PerformanceEntry',
  members: [roAttr('navigationId', idlType.unsignedLongLong)],
});

/** Registered names are distinct from the set of producers implemented by Browlet. */
export type PerformanceEntryType = keyof typeof entryTypes;

// https://w3c.github.io/timing-entrytypes-registry/#registry
// Registry metadata only: none of these rows advertises an implemented producer.
const entryTypes = {
  container: { availableFromTimeline: false, maxBufferSize: 150 },
  element: { availableFromTimeline: false, maxBufferSize: 150 },
  event: { availableFromTimeline: false, maxBufferSize: 150 },
  'first-input': { availableFromTimeline: true, maxBufferSize: 1 },
  'interaction-contentful-paint': { availableFromTimeline: false, maxBufferSize: 150 },
  'largest-contentful-paint': { availableFromTimeline: false, maxBufferSize: 150 },
  'layout-shift': { availableFromTimeline: false, maxBufferSize: 150 },
  longtask: { availableFromTimeline: false, maxBufferSize: 200 },
  'long-animation-frame': { availableFromTimeline: true, maxBufferSize: 200 },
  mark: { availableFromTimeline: true, maxBufferSize: Infinity },
  measure: { availableFromTimeline: true, maxBufferSize: Infinity },
  navigation: { availableFromTimeline: true, maxBufferSize: Infinity },
  paint: { availableFromTimeline: true, maxBufferSize: 2 },
  resource: { availableFromTimeline: true, maxBufferSize: 250 },
  'soft-navigation': { availableFromTimeline: true, maxBufferSize: 50 },
  'visibility-state': { availableFromTimeline: true, maxBufferSize: 50 },
};
