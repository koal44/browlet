import { InternalError } from '../../infra/index';
import { randomInteger } from '../../js-engine/index';
import {
  defineInterface, idlType, impl, op, reference, roAttr, xattr,
} from '../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../timing/index';
import type { HTTPStatus } from '../../http/index';
import type { CacheUsage, FetchTimingInfo, ResponseBodyInfo } from '../../fetch/index';

import { EventTargetImpl } from '../dom/events/index';
import { EventHandlerMap, type EventHandlerCallback } from '../scripting/index';
import { NotRestoredReasonsImpl, type NotRestoredReasons } from '../browsing/navigation/diagnostics/index';
import type { DocumentImpl } from '../dom/nodes/index';
import type { BrowletEnvironment } from '../environment/index';

import { PerformanceEntryBuffer, type PerformanceEntryImpl, type PerformanceEntryType } from './timeline';
import type { PerformanceObserverImpl, PerformanceObserverCallbackOptions } from './observer';
import { PerformanceObserverEntryListImpl } from './observer-entry-list';
import { PerformanceResourceTimingImpl } from './resource';
import { PerformanceNavigationTimingImpl, type NavigationTimingInit } from './navigation';
import { PerformanceTimingImpl, PerformanceNavigationImpl } from './legacy-navigation';

/** Exposes this global's coarsened timestamps and retained performance entries. */
// https://w3c.github.io/hr-time/#the-performance-interface
export class PerformanceImpl extends EventTargetImpl {
  static #handlerDefinitions = new Map([['onresourcetimingbufferfull', 'resourcetimingbufferfull']]);

  /** Browser environment owning this global's performance facilities. */
  declare env: BrowletEnvironment;
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, PerformanceImpl.#handlerDefinitions);
  /** This global's observers in registration order, retained until disconnect(). */
  // Each observer belongs to one global and owns its options list directly.
  registeredObservers = new Set<PerformanceObserverImpl>();
  /** Implemented producers for this global; Binding projects the retained list as a frozen array. */
  // Add other types only after their producers and delivery paths exist.
  supportedEntryTypes: PerformanceEntryType[];
  /** Current Window timing association, retained with this global; zero outside Window. */
  // https://wicg.github.io/soft-navigations/#navigation-id
  // TODO(Soft Navigations §§2.1, 5): Detect soft navigations and advance this ID at their emission.
  // Do not advance it for every URL update or timing entry; those are not equivalent operations.
  currentNavigationId: number;
  /** This global's buffers, keyed by entry type and allocated on first internal use. */
  #entryBufferMap = new Map<string, PerformanceEntryBuffer>();
  /** Whether this global already has a pending observer-delivery task. */
  #observerTaskQueued = false;
  /** Resource entries awaiting space in the primary buffer, in insertion order. */
  #resourceTimingSecondaryBuffer: PerformanceResourceTimingImpl[] = [];
  /** Whether overflow processing is queued or running for this global. */
  #resourceTimingBufferFullEventPending = false;
  /** Window-only legacy view; it follows the associated Document when an initial Window is reused. */
  #timing?: PerformanceTimingImpl;
  /** Window-only legacy classification/count view, with the same lifetime as Performance. */
  #navigation?: PerformanceNavigationImpl;

  constructor(env: BrowletEnvironment) {
    super(env);
    this.supportedEntryTypes = env.isWindow ? ['navigation', 'resource'] : ['resource'];
    // Each Window gets an independent initial value, without waiting for a completed navigation entry.
    this.currentNavigationId = env.isWindow ? randomInteger(100, 10001) : 0;
  }

  /** Environment time origin expressed relative to the Unix epoch. */
  // https://w3c.github.io/hr-time/#dom-performance-timeorigin
  get timeOrigin(): DOMHighResTimeStamp {
    return this.env.getTimeOriginTimestamp().toTimestamp();
  }

  get timing(): PerformanceTimingImpl {
    const realm = this.env.realm;
    if (!realm.isWindow()) throw new InternalError('Legacy navigation timing requires a Window');
    return this.#timing ??= new PerformanceTimingImpl(realm.windowImplementation.env);
  }

  get navigation(): PerformanceNavigationImpl {
    const realm = this.env.realm;
    if (!realm.isWindow()) throw new InternalError('Legacy navigation information requires a Window');
    return this.#navigation ??= new PerformanceNavigationImpl(realm.windowImplementation.env);
  }

  get onresourcetimingbufferfull(): EventHandlerCallback | null {
    return this.eventHandlers.get('onresourcetimingbufferfull');
  }

  set onresourcetimingbufferfull(callback: EventHandlerCallback | null) {
    this.eventHandlers.set('onresourcetimingbufferfull', callback);
  }

  /** Elapsed high-resolution time since this environment's origin. */
  // https://w3c.github.io/hr-time/#dom-performance-now
  now(): DOMHighResTimeStamp {
    return this.env.currentHighResolutionTime().toTimestamp();
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

  /** Create an entry from Fetch's filtered measurements and deliver it through this global's timeline. */
  // https://w3c.github.io/resource-timing/#mark-resource-timing
  // This global's retained Performance owns creation; the final flag carries the approved transfer-size exposure decision.
  markResourceTiming(
    timingInfo: FetchTimingInfo, requestedURL: string, initiatorType: string, cacheMode: CacheUsage | '',
    bodyInfo: ResponseBodyInfo, responseStatus: HTTPStatus, deliveryType = '', allowTransferSize: boolean,
  ): void {
    const entry = new PerformanceResourceTimingImpl(
      initiatorType, requestedURL, timingInfo, cacheMode, bodyInfo, responseStatus, deliveryType,
      allowTransferSize, timingInfo.serverTimingHeaders, this.env,
    );
    this.queueEntry(entry);
    this.addResourceTimingEntry(entry);
  }

  /** Retain a Document's navigation entry immediately, without notifying observers. */
  // https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry
  // The existing init groups prepared response data and the Document's live timing records.
  // The flag distinguishes retained response data from available transport measurements;
  // history population supplies diagnostics while this Document is still inactive.
  createNavigationTimingEntry(
    document: DocumentImpl, inputs: NavigationTimingInit, allowTransferSize: boolean,
    reasons: NotRestoredReasons | null,
  ): PerformanceNavigationTimingImpl {
    // SPEC_GAP(navigation-timing-null-reasons): HTML's creation operation requires a record but Document diagnostics can be null. Retain null, otherwise construct in this entry's realm.
    const diagnostics = reasons === null ? null : new NotRestoredReasonsImpl(reasons, this.env);
    // TODO(Critical-CH): Supply the observed restart timestamp once navigation implements that producer.
    const entry = new PerformanceNavigationTimingImpl(document.URL, inputs, 0, diagnostics, allowTransferSize, this.env);
    this.getEntryBuffer('navigation').entries.push(entry);
    return entry;
  }

  /** Clear retained resource entries without changing the limit or pending observer records. */
  // https://w3c.github.io/resource-timing/#dom-performance-clearresourcetimings
  clearResourceTimings(): void {
    // The resource tuple's list length is the specified resource timing buffer current size.
    this.getEntryBuffer('resource').entries.length = 0;
  }

  /** Change the resource limit; lowering it does not evict already retained entries. */
  // https://w3c.github.io/resource-timing/#dom-performance-setresourcetimingbuffersize
  setResourceTimingBufferSize(maxSize: number): void {
    this.getEntryBuffer('resource').maxBufferSize = maxSize;
  }

  /** Check resource capacity without counting a dropped entry. */
  // https://w3c.github.io/resource-timing/#dfn-can-add-resource-timing-entry
  canAddResourceTimingEntry(): boolean {
    const buffer = this.getEntryBuffer('resource');
    return buffer.entries.length < buffer.maxBufferSize;
  }

  /** Insert a resource measurement using Resource Timing's overflow protocol. */
  // https://w3c.github.io/resource-timing/#dfn-add-a-PerformanceResourceTiming-entry
  addResourceTimingEntry(entry: PerformanceResourceTimingImpl): void {
    if (entry.env !== this.env) throw new InternalError('Cannot retain a resource entry owned by another global');
    const buffer = this.getEntryBuffer('resource');
    if (this.canAddResourceTimingEntry() && !this.#resourceTimingBufferFullEventPending) {
      buffer.entries.push(entry);
      return;
    }
    // SPEC_CLASH(resource-timing-secondary-drop-count): Count each diversion once, as Chromium does, even if later rescued. Timeline's capacity check alone misses entries diverted while an overflow task is pending.
    buffer.droppedEntriesCount++;
    if (!this.#resourceTimingBufferFullEventPending) {
      this.#resourceTimingBufferFullEventPending = true;
      this.env.queueTask('performance-timeline', {
        run: () => { this.fireResourceTimingBufferFull(); },
        discard: () => {
          this.#resourceTimingSecondaryBuffer.length = 0;
          this.#resourceTimingBufferFullEventPending = false;
        },
      });
    }
    this.#resourceTimingSecondaryBuffer.push(entry);
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

  /** Notify observers and buffer entries whose producer does not own insertion. */
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
    // SPEC_CLASH(resource-timing-double-insertion): Resource Timing's mark operation calls both queueEntry and addResourceTimingEntry. Retain resources only in the latter, matching browsers' single insertion.
    // SPEC_CLASH(resource-timing-overflow-observer-delivery): Queue observers before overflow handling, as the specification and Chromium/Firefox do; WebKit defers secondary entries until its full-buffer task.
    // SPEC_CLASH(navigation-timing-double-insertion): Navigation Timing inserts at creation, but Timeline inserts again at completion. Keep creation as the sole insertion point, matching all browsers.
    if (entryType !== 'resource' && entryType !== 'navigation') {
      const buffer = this.getEntryBuffer(entryType);
      // Admission precedes capacity: entries ineligible for storage must not count as dropped.
      if (entry.shouldAdd() && !buffer.isFull()) buffer.entries.push(entry);
    }
    this.queueObserverTask();
  }

  /** Coalesce this global's notifications, draining each batch before its author callback. */
  // https://w3c.github.io/performance-timeline/#queue-the-performanceobserver-task
  queueObserverTask(): void {
    if (this.#observerTaskQueued) return;
    this.#observerTaskQueued = true;
    this.env.queueTask('performance-timeline', {
      run: () => {
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
      },
      discard: () => { this.#observerTaskQueued = false; },
    });
  }

  /** Let handlers make room, preserving pending entry order and discarding excess on no progress. */
  // https://w3c.github.io/resource-timing/#dfn-fire-a-buffer-full-event
  private fireResourceTimingBufferFull(): void {
    const secondary = this.#resourceTimingSecondaryBuffer;
    const buffer = this.getEntryBuffer('resource');
    // Advance through the FIFO once instead of repeatedly shifting the array.
    let consumed = 0;
    try {
      while (consumed < secondary.length) {
        const excessBefore = secondary.length - consumed;
        if (!this.canAddResourceTimingEntry()) {
          // SPEC_CLASH(resource-timing-full-event-bubbles): Use DOM's trusted, non-bubbling, non-cancelable event, as Chromium/WebKit do; Firefox sets bubbles to true.
          this.fireEvent('resourcetimingbufferfull');
        }
        // https://w3c.github.io/resource-timing/#dfn-copy-secondary-buffer
        // Read capacity after callbacks, which may clear/resize the buffer or append more entries.
        while (consumed < secondary.length && buffer.entries.length < buffer.maxBufferSize) {
          buffer.entries.push(secondary[consumed++]!);
        }
        const excessAfter = secondary.length - consumed;
        if (excessBefore <= excessAfter) break;
      }
    } finally {
      secondary.length = 0;
      // SPEC_CLASH(resource-timing-full-event-rearm): Release the flag even after the specified no-progress abort, as Chromium/Firefox do and issue #231 supports; WebKit waits for a clear/resize.
      this.#resourceTimingBufferFullEventPending = false;
    }
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
