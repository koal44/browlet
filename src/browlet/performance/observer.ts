import { TypeError } from '../../infra/index';
import {
  arg, atArg, ctor, defineCallbackFunction, defineDictionary, defineInterface, dictMember,
  DOMExceptionImpl, emptyDictionary, frozenArray, idlType, impl, onError, op, reference, roAttr, sequence,
} from '../../web-idl/core/index';

import type { BrowletEnvironment } from '../environment/index';

import type { PerformanceImpl } from './performance';
import type { PerformanceEntryImpl } from './timeline';
import type { PerformanceObserverEntryListImpl } from './observer-entry-list';

/** One observer's lifetime mode, registration, and pending performance records. */
// https://w3c.github.io/performance-timeline/#the-performanceobserver-interface
export class PerformanceObserverImpl {
  /** Environment owning this observer and its public results. */
  env: BrowletEnvironment;
  /** Converted callback; Binding owns argument projection and exception reporting. */
  callback: PerformanceObserverCallback;
  /** Supported subscriptions supplied by observe(); empty before registration and after disconnect(). */
  optionsList: PerformanceObserverInit[] = [];
  /** Entries waiting for callback delivery or takeRecords(), in queueing order. */
  observerBuffer: PerformanceEntryImpl[] = [];
  /** Whether the next nonempty delivery includes dropped-entry counts. */
  requiresDroppedEntries = false;
  /** The global's retained owner, independent of a replaced public performance property. */
  #performance: PerformanceImpl;
  /** Observation form chosen by the first valid options dictionary, even if no types are supported. */
  #observerType?: PerformanceObserverType;

  constructor(callback: PerformanceObserverCallback, env: BrowletEnvironment) {
    this.env = env;
    this.callback = callback;
    this.#performance = env.getWindowOrWorkerGlobalScopeMixin().performance;
  }

  /** Register supported types, replacing a multiple-type subscription or merging single-type options. */
  // https://w3c.github.io/performance-timeline/#observe-method
  observe(options: PerformanceObserverInit): void {
    const { entryTypes, type } = options;
    if (entryTypes === undefined && type === undefined) {
      throw new TypeError('PerformanceObserver requires entryTypes or type');
    }
    // SPEC_CLASH(performance-observer-mixed-options): Follow the specified TypeError even for buffered:false. All three browsers ignore buffered with entryTypes; upstream PR #164 explicitly calls for this correction.
    if (entryTypes !== undefined && (type !== undefined || options.buffered !== undefined)) {
      throw new TypeError('PerformanceObserver entryTypes cannot be combined with other options');
    }
    const observerType = entryTypes === undefined ? 'single' : 'multiple';
    if (this.#observerType === undefined) this.#observerType = observerType;
    if (this.#observerType !== observerType) {
      throw new DOMExceptionImpl('PerformanceObserver observation mode cannot change', 'InvalidModificationError');
    }
    this.requiresDroppedEntries = true;
    if (entryTypes !== undefined) {
      const supported = this.#performance.supportedEntryTypes;
      options.entryTypes = entryTypes.filter((type) => supported.some((item) => item === type));
      // TODO(Performance Timeline §4.2): Notify developers when unsupported types are removed or registration is empty.
      // SPEC_CLASH(performance-observer-empty-types): Follow observe() and all three browsers by returning for an empty list; the dictionary prose instead says it MUST NOT be empty.
      if (options.entryTypes.length === 0) return;
      this.optionsList = [options];
      this.#performance.registeredObservers.add(this);
      return;
    }
    const supportedType = this.#performance.supportedEntryTypes.find((item) => item === type);
    if (supportedType === undefined) {
      // TODO(Performance Timeline §4.2): Notify developers that the requested type is unsupported.
      return;
    }
    const index = this.optionsList.findIndex((item) => item.type === type);
    if (index === -1) this.optionsList.push(options);
    else this.optionsList[index] = options;
    this.#performance.registeredObservers.add(this);
    if (options.buffered) {
      // SPEC_CLASH(performance-observer-buffered-order): Follow Performance Timeline by appending the retained buffer in order. Browsers sort each replay; Chromium/WebKit also merge repeated replays chronologically. Queries still sort their result.
      for (const entry of this.#performance.getEntryBuffer(supportedType).entries) {
        if (entry.shouldAdd(options)) this.observerBuffer.push(entry);
      }
      this.#performance.queueObserverTask();
    }
  }

  /** Unregister and discard pending records without resetting the lifetime observation mode. */
  // https://w3c.github.io/performance-timeline/#disconnect-method
  disconnect(): void {
    this.#performance.registeredObservers.delete(this);
    this.observerBuffer = [];
    this.optionsList.length = 0;
    // SPEC_CLASH(performance-observer-mode): Preserve the mode after unsupported requests and disconnect(), as the specification and Chromium/Firefox do; WebKit gates its check on a live registration.
    // SPEC_CLASH(performance-observer-disconnect-records): Keep the specified clearing of pending records, as Chromium/WebKit do. Gecko's Disconnect clears options but retains pending entries, duplicating them on buffered re-observation.
  }

  /** Drain this observer's pending records without sorting or unregistering it. */
  // https://w3c.github.io/performance-timeline/#takerecords-method
  takeRecords(): PerformanceEntryImpl[] {
    const records = this.observerBuffer;
    this.observerBuffer = [];
    return records;
  }
}

/** Observation form retained for the observer's lifetime once selected. */
export type PerformanceObserverType = 'single' | 'multiple';

/** Converted dictionary; observe() filters unsupported names before retaining it. */
export type PerformanceObserverInit = {
  entryTypes?: string[];
  type?: string;
  buffered?: boolean;
};

/** Optional delivery metadata, populated by the shared observer task. */
export type PerformanceObserverCallbackOptions = {
  droppedEntriesCount?: number;
};

/** Implementation-facing invocation of the converted callback. */
export type PerformanceObserverCallback = (
  this: PerformanceObserverImpl, entries: PerformanceObserverEntryListImpl,
  observer: PerformanceObserverImpl, options?: PerformanceObserverCallbackOptions,
) => void;

/*
 * [Exposed=(Window,Worker)]
 * interface PerformanceObserver {
 *   constructor(PerformanceObserverCallback callback);
 *   undefined observe(optional PerformanceObserverInit options = {});
 *   undefined disconnect();
 *   PerformanceEntryList takeRecords();
 *   [SameObject] static readonly attribute FrozenArray<DOMString> supportedEntryTypes;
 * };
 */
export const performanceObserverIDL = defineInterface<BrowletEnvironment>({
  name: 'PerformanceObserver', exposed: ['Window', 'Worker'], implementation: impl(PerformanceObserverImpl),
  members: [
    ctor(
      [arg('callback', reference('PerformanceObserverCallback'), onError('report'))],
      { constructWith: [atArg(1, (env) => env)] },
    ),
    op('observe', idlType.undefined, [
      arg('options', reference('PerformanceObserverInit'), { optional: true, default: emptyDictionary }),
    ]),
    op('disconnect', idlType.undefined),
    // SPEC_CLASH(performance-query-result-realm): Keep the approved receiver-realm result arrays for takeRecords() too; Chromium/WebKit agree, while Firefox allocates in the borrowed method's realm.
    op('takeRecords', reference('PerformanceEntryList')),
    // SPEC_CLASH(performance-observer-supported-types): Keep the specified per-global frozen value. Firefox returns fresh mutable arrays; WebKit returns fresh frozen arrays. Issue #212 identifies SameObject as invalid here, so ordinary FrozenArray projection supplies identity without that annotation.
    roAttr('supportedEntryTypes', frozenArray(idlType.DOMString), {
      static: true,
      overrideGet: ({ callee }) => callee.getWindowOrWorkerGlobalScopeMixin().performance.supportedEntryTypes,
    }),
  ],
});

/*
 * callback PerformanceObserverCallback = undefined (PerformanceObserverEntryList entries,
 *   PerformanceObserver observer, optional PerformanceObserverCallbackOptions options = {});
 */
export const performanceObserverCallbackIDL = defineCallbackFunction({
  name: 'PerformanceObserverCallback', returns: idlType.undefined,
  arguments: [
    arg('entries', reference('PerformanceObserverEntryList')),
    arg('observer', reference('PerformanceObserver')),
    arg('options', reference('PerformanceObserverCallbackOptions'), { optional: true, default: emptyDictionary }),
  ],
});

/*
 * dictionary PerformanceObserverInit {
 *   sequence<DOMString> entryTypes;
 *   DOMString type;
 *   boolean buffered;
 * };
 */
export const performanceObserverInitIDL = defineDictionary({
  name: 'PerformanceObserverInit',
  members: [
    dictMember('entryTypes', sequence(idlType.DOMString)), dictMember('type', idlType.DOMString),
    dictMember('buffered', idlType.boolean),
  ],
});

/*
 * dictionary PerformanceObserverCallbackOptions {
 *   unsigned long long droppedEntriesCount;
 * };
 */
export const performanceObserverCallbackOptionsIDL = defineDictionary({
  name: 'PerformanceObserverCallbackOptions', members: [dictMember('droppedEntriesCount', idlType.unsignedLongLong)],
});
