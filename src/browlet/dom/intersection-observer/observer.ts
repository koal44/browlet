import type { BoxSides, CanonicalLengthPercentageLiteral } from '../../../stylelet/index';

import type { DocumentImpl, ElementImpl } from '../nodes/index';
import type { BrowletEnvironment } from '../../environment';

/** Internal observer state; rendering updates and author-facing bindings remain provisional. */
// https://w3c.github.io/IntersectionObserver/#intersection-observer-interface
export class IntersectionObserverImpl {
  /** Environment owning this observer and its eventual notifications. */
  env: BrowletEnvironment;
  /** Captured internal construction inputs, with parsed margins and provisional threshold normalization. */
  options: IntersectionObserverOptions;
  /** Internal callback; future Web IDL bindings must adapt and report author callback failures. */
  #callback: IntersectionObserverCallback;
  /** Targets retained in observation order until unobserve() or disconnect(). */
  #observationTargets = new Set<ElementImpl>();
  /** Undelivered entries; observing alone never fabricates an intersection. */
  #queuedEntries: IntersectionObserverEntryImpl[] = [];

  // https://w3c.github.io/IntersectionObserver/#initialize-new-intersection-observer
  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverOptions, env: BrowletEnvironment) {
    this.env = env;
    this.#callback = callback;
    this.options = {
      ...options,
      rootMargin: copyMargin(options.rootMargin),
      scrollMargin: copyMargin(options.scrollMargin),
      threshold: typeof options.threshold === 'number' ? options.threshold : options.threshold.slice(),
    };
    // PROVISIONAL: validate and sort thresholds and normalize visibility delay.
    // The future author constructor must parse margin strings before using these internal options.
  }

  /** Register a target once, preserving an existing registration's intersection history. */
  // https://w3c.github.io/IntersectionObserver/#observe-target-element
  observe(target: ElementImpl): void {
    if (this.#observationTargets.has(target)) return;
    target.registeredIntersectionObservers.push({
      observer: this,
      previousThresholdIndex: -1,
      previousIsIntersecting: false,
      previousIsVisible: false,
    });
    this.#observationTargets.add(target);
    // TODO(Intersection Observer): rendering must process pending initial targets and compute entries.
  }

  /** Remove this observer's registration without discarding entries already queued. */
  // https://w3c.github.io/IntersectionObserver/#unobserve-target-element
  unobserve(target: ElementImpl): void {
    const registrations = target.registeredIntersectionObservers;
    const index = registrations.findIndex((registration) => registration.observer === this);
    if (index !== -1) registrations.splice(index, 1);
    this.#observationTargets.delete(target);
  }

  /** Stop observing every target, retaining any queued entries. */
  // https://w3c.github.io/IntersectionObserver/#dom-intersectionobserver-disconnect
  disconnect(): void {
    for (const target of this.#observationTargets) this.unobserve(target);
  }

  /** Drain the pending entry list without changing observation registrations. */
  // https://w3c.github.io/IntersectionObserver/#dom-intersectionobserver-takerecords
  takeRecords(): IntersectionObserverEntryImpl[] {
    const entries = this.#queuedEntries;
    this.#queuedEntries = [];
    return entries;
  }

  /** Retain an entry supplied by the intersection computation. Does not schedule delivery yet. */
  // https://w3c.github.io/IntersectionObserver/#queue-intersection-observer-entry
  enqueueEntry(entry: IntersectionObserverEntryImpl): void {
    this.#queuedEntries.push(entry);
    // PROVISIONAL: the Document's coalesced IntersectionObserver task must invoke notification.
  }

  /** Deliver this observer's pending batch, clearing it before invoking the internal callback. */
  // Per-observer steps of https://w3c.github.io/IntersectionObserver/#notify-intersection-observers-algo
  notify(): void {
    const entries = this.takeRecords();
    if (entries.length) this.#callback.call(this, entries, this);
  }
}

/** Internal construction inputs; callers supply parsed margins and all other dictionary defaults. */
// https://w3c.github.io/IntersectionObserver/#dictdef-intersectionobserverinit
export type IntersectionObserverOptions = {
  root: ElementImpl | DocumentImpl | null;
  rootMargin: IntersectionObserverMargin;
  scrollMargin: IntersectionObserverMargin;
  threshold: number | number[];
  delay: number;
  trackVisibility: boolean;
};

/** Four parsed sides, in CSS order; lengths are pixels and percentages retain their reference dependency. */
// https://w3c.github.io/IntersectionObserver/#parse-a-margin
export type IntersectionObserverMargin = BoxSides<CanonicalLengthPercentageLiteral>;

/** Callback receiving implementation entries and the observer that owns them. */
// https://w3c.github.io/IntersectionObserver/#callbackdef-intersectionobservercallback
export type IntersectionObserverCallback = (
  this: IntersectionObserverImpl, entries: IntersectionObserverEntryImpl[], observer: IntersectionObserverImpl,
) => void;

/** A target's association with one observer and its previous intersection state. */
// https://w3c.github.io/IntersectionObserver/#intersectionobserverregistration
export type IntersectionObserverRegistration = {
  observer: IntersectionObserverImpl;
  previousThresholdIndex: number;
  previousIsIntersecting: boolean;
  previousIsVisible: boolean;
  // TODO(Intersection Observer): initialize and update lastUpdateTime when delay processing is implemented.
};

/** Provisional entry fields consumed by HTML lazy loading; no entry is produced from DOM shape. */
// https://w3c.github.io/IntersectionObserver/#intersection-observer-entry
// SPEC_MISMATCH: IntersectionObserverEntry
export type IntersectionObserverEntryImpl = {
  target: ElementImpl;
  isIntersecting: boolean;
  // TODO(Intersection Observer): time, rootBounds, boundingClientRect, intersectionRect, isVisible,
  // and intersectionRatio require the entry implementation and Geometry Interfaces integration.
};

/** Capture each side so later changes to caller-owned values cannot retune an existing observer. */
function copyMargin(margin: IntersectionObserverMargin): IntersectionObserverMargin {
  return [{ ...margin[0] }, { ...margin[1] }, { ...margin[2] }, { ...margin[3] }];
}
