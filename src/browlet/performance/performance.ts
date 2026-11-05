import { InternalError } from '../../infra/index';
import { randomInteger } from '../../js-engine/index';
import {
  defineInterface, idlType, impl, op, reference, roAttr, xattr,
} from '../../web-idl/core/index';

import type { EnvironmentTiming, DOMHighResTimeStamp } from '../timing/index';
import { EventTargetImpl } from '../dom/events/index';
import type { BrowletEnvironment } from '../environment/index';

import { PerformanceEntryBuffer, type PerformanceEntryImpl, type PerformanceEntryType } from './timeline';
import type { PerformanceObserverImpl, PerformanceObserverCallbackOptions } from './observer';
import { PerformanceObserverEntryListImpl } from './observer-entry-list';

/** Exposes this global's coarsened timestamps and retained performance entries. */
// https://w3c.github.io/hr-time/#the-performance-interface
export class PerformanceImpl extends EventTargetImpl {
  /** Browser environment owning this global's performance facilities. */
  declare env: BrowletEnvironment;
  /** This global's observers in registration order, retained until disconnect(). */
  // Each observer belongs to one global and owns its options list directly.
  registeredObservers = new Set<PerformanceObserverImpl>();
  /** Implemented producers for this global; Binding projects the retained list as a frozen array. */
  // TODO(Performance Timeline §4.5): Populate from real producers only after their queueing/delivery paths exist.
  supportedEntryTypes: PerformanceEntryType[] = [];
  /** Current Window timing association, retained with this global; zero outside Window. */
  // https://wicg.github.io/soft-navigations/#navigation-id
  // TODO(Soft Navigations §§2.1, 5): Detect soft navigations and advance this ID at their emission.
  // Do not advance it for every URL update or timing entry; those are not equivalent operations.
  currentNavigationId: number;
  /** Environment-owned clock conversion and precision policy. */
  #timing: EnvironmentTiming;
  /** This global's buffers, keyed by entry type and allocated on first internal use. */
  #entryBufferMap = new Map<string, PerformanceEntryBuffer>();
  /** Whether this global already has a pending observer-delivery task. */
  #observerTaskQueued = false;

  constructor(timing: EnvironmentTiming, env: BrowletEnvironment) {
    super(env);
    this.#timing = timing;
    // Each Window gets an independent initial value, without waiting for a completed navigation entry.
    this.currentNavigationId = env.isWindow ? randomInteger(100, 10001) : 0;
  }

  /** Environment time origin expressed relative to the Unix epoch. */
  // https://w3c.github.io/hr-time/#dom-performance-timeorigin
  get timeOrigin(): DOMHighResTimeStamp {
    return this.#timing.getTimeOriginTimestamp().toTimestamp();
  }

  /** Elapsed high-resolution time since this environment's origin. */
  // https://w3c.github.io/hr-time/#dom-performance-now
  now(): DOMHighResTimeStamp {
    return this.#timing.currentHighResolutionTime().toTimestamp();
  }

  /** Return the entries whose registry metadata permits synchronous timeline access. */
  // https://w3c.github.io/performance-timeline/#getentries-method
  getEntries(): PerformanceEntryImpl[] {
    return this.filterBufferMapByNameAndType(null, null);
  }

  /** Return this global's visible entries with exactly the requested type. */
  // https://w3c.github.io/performance-timeline/#getentriesbytype-method
  getEntriesByType(type: string): PerformanceEntryImpl[] {
    return this.filterBufferMapByNameAndType(null, type);
  }

  /** Return matching entries; an omitted type includes every visible family. */
  // https://w3c.github.io/performance-timeline/#getentriesbyname-method
  getEntriesByName(name: string, type?: string): PerformanceEntryImpl[] {
    return this.filterBufferMapByNameAndType(name, type ?? null);
  }

  /** Get or create this global's buffer and metadata for an entry type. */
  // https://w3c.github.io/performance-timeline/#relevant-performance-entry-tuple
  // The global's retained Performance owns the map; first internal access initializes an empty tuple.
  getEntryBuffer(type: PerformanceEntryType): PerformanceEntryBuffer {
    let buffer = this.#entryBufferMap.get(type);
    if (buffer === undefined) {
      buffer = new PerformanceEntryBuffer(type);
      this.#entryBufferMap.set(type, buffer);
    }
    return buffer;
  }

  /** Queue a completed entry for timeline storage and observer notification. */
  // https://w3c.github.io/performance-timeline/#dfn-queue-a-performanceentry
  queueEntry(entry: PerformanceEntryImpl): void {
    if (entry.env !== this.env) throw new InternalError('Cannot queue a performance entry owned by another global');
    // SPEC_CLASH(performance-entry-navigation-id): Use Soft Navigations §2.3 instead of Timeline's obsolete most-recent-entry link/null Worker ID. Preserve producer-captured IDs; unassigned entries use this global's current ID (zero outside Window).
    if (entry.navigationId === 0) entry.navigationId = this.currentNavigationId;
    const interestedObservers = new Set<PerformanceObserverImpl>();
    const { entryType } = entry;
    for (const observer of this.registeredObservers) {
      const options = observer.optionsList.find((options) =>
        options.type === entryType || options.entryTypes?.includes(entryType),
      );
      if (options !== undefined && entry.shouldAdd(options)) interestedObservers.add(observer);
    }
    for (const observer of interestedObservers) observer.observerBuffer.push(entry);
    const buffer = this.getEntryBuffer(entryType);
    // Admission precedes capacity: entries ineligible for storage must not count as dropped.
    if (entry.shouldAdd() && !buffer.isFull()) buffer.entries.push(entry);
    this.queueObserverTask();
  }

  /** Coalesce this global's notifications, draining each batch before its author callback. */
  // https://w3c.github.io/performance-timeline/#queue-the-performanceobserver-task
  queueObserverTask(): void {
    if (this.#observerTaskQueued) return;
    this.#observerTaskQueued = true;
    this.env.queueTask('performance-timeline', () => {
      this.#observerTaskQueued = false;
      const observers = [...this.registeredObservers];
      for (const observer of observers) {
        const entries = observer.takeRecords();
        // The inner empty-batch return applies to this observer; all three browsers continue notifying others.
        if (entries.length === 0) continue;
        // SPEC_GAP(performance-observer-list-realm): The allocation has no explicit realm. Keep the observer's owner, as Firefox/WebKit do; Chromium allocates in the callback's realm.
        const entryList = new PerformanceObserverEntryListImpl(entries, observer.env);
        // SPEC_CLASH(performance-observer-callback-options): Supply the specified third argument, as Chromium does. Firefox/WebKit omit it.
        const callbackOptions: PerformanceObserverCallbackOptions = {};
        if (observer.requiresDroppedEntries) {
          const types = new Set<string>();
          for (const options of observer.optionsList) {
            if (options.type !== undefined) types.add(options.type);
            if (options.entryTypes !== undefined) {
              for (const type of options.entryTypes) types.add(type);
            }
          }
          callbackOptions.droppedEntriesCount = 0;
          // SPEC_GAP(performance-observer-duplicate-counts): Count each observed type once, as Chromium does; the prose does not say whether repeated names duplicate the count.
          for (const type of types) {
            // A lazily unallocated buffer has never dropped an entry.
            callbackOptions.droppedEntriesCount += this.#entryBufferMap.get(type)?.droppedEntriesCount ?? 0;
          }
          observer.requiresDroppedEntries = false;
        }
        observer.callback.call(observer, entryList, observer, callbackOptions);
      }
    }, { discardSteps: () => { this.#observerTaskQueued = false; } });
  }

  /** Return fresh sorted results without exposing or reordering a retained buffer. */
  // https://w3c.github.io/performance-timeline/#dfn-filter-buffer-map-by-name-and-type
  private filterBufferMapByNameAndType(name: string | null, type: string | null): PerformanceEntryImpl[] {
    const result: PerformanceEntryImpl[] = [];
    if (type !== null) {
      const buffer = this.#entryBufferMap.get(type);
      // SPEC_GAP(performance-timeline-unknown-type): The algorithm dereferences an absent map tuple. All three browsers return an empty list for unknown types; do likewise for unknown or unpopulated types.
      if (buffer === undefined || !buffer.availableFromTimeline) return result;
      PerformanceEntryBuffer.appendMatchingEntries(buffer.entries, name, type, result);
    } else {
      for (const buffer of this.#entryBufferMap.values()) {
        if (!buffer.availableFromTimeline) continue;
        PerformanceEntryBuffer.appendMatchingEntries(buffer.entries, name, null, result);
      }
    }
    // Collect directly and sort once; the specification's per-buffer sorts are redundant here.
    return result.sort((a, b) => a.startTime - b.startTime);
  }
}

/*
 * [Exposed=(Window,Worker)]
 * interface Performance : EventTarget {
 *   DOMHighResTimeStamp now();
 *   readonly attribute DOMHighResTimeStamp timeOrigin;
 *   [Default] object toJSON();
 * };
 */
export const performanceIDL = defineInterface({
  name: 'Performance',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker'],
  implementation: impl(PerformanceImpl),
  members: [
    op('now', reference('DOMHighResTimeStamp')),
    roAttr('timeOrigin', reference('DOMHighResTimeStamp')),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});
