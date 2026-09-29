import {
  arg, atArg, ctor, defineCallbackFunction, defineDictionary, defineInterface, defineTypedef,
  dictMember, emptyDictionary, idlType, impl, onError, op, reference, sequence,
} from '../../web-idl/index';
import type { BrowletEnvironment, Environment } from '../scripting/environment';
import type { WindowOrWorkerGlobalScopeMixin } from '../scripting/global-scope';
import type { ReportImpl } from './report';

/** An observer's registration, type filter, and pending callback batch. */
// https://w3c.github.io/reporting/#interface-reporting-observer
export class ReportingObserverImpl {
  /** Converted callback, including Web IDL argument projection and exception reporting. */
  #callback: ReportingObserverCallback;
  /** Types selected at construction; absent or empty means every observable type. */
  #types: string[] | undefined;
  /** Whether the first observe() call should replay the global's report buffer. */
  #buffered: boolean;
  /** Reports waiting for this observer's callback or takeRecords(). */
  #reports: ReportImpl[] = [];
  /** Actual global-scope mixin owning registration, buffering, and task delivery. */
  #global: WindowOrWorkerGlobalScopeMixin;

  constructor(
    callback: ReportingObserverCallback, options: ReportingObserverOptions,
    env: Environment,
  ) {
    this.#callback = callback;
    this.#types = options.types;
    this.#buffered = options.buffered;
    this.#global = env.getWindowOrWorkerGlobalScopeMixin();
  }

  /** Register this observer, replaying buffered reports at most once. */
  // https://w3c.github.io/reporting/#dom-reportingobserver-observe
  observe(): void {
    this.#global.retireReports();
    this.#global.reportingObservers.add(this);
    if (!this.#buffered) return;
    this.#buffered = false;
    // Blink, Gecko, and WebKit replay synchronously; only callback delivery is a task.
    for (const report of this.#global.reportBuffer) {
      this.queueReport(report);
    }
  }

  /** Stop accepting new reports without emptying this observer's pending batch. */
  // https://w3c.github.io/reporting/#dom-reportingobserver-disconnect
  disconnect(): void {
    this.#global.reportingObservers.delete(this);
  }

  /** Drain the pending batch, independently of registration and the global buffer. */
  // https://w3c.github.io/reporting/#dom-reportingobserver-takerecords
  takeRecords(): ReportImpl[] {
    // Disconnected observers are not retained by the global's registration set.
    // Apply the same age limit when their pending records are consumed later.
    this.discardReportsBefore(Date.now() - this.#global.env.userAgent.maxReportAge);
    const reports = this.#reports;
    this.#reports = [];
    return reports;
  }

  /** Add an observable report matching the type filter and schedule batch delivery. */
  // https://w3c.github.io/reporting/#add-report
  queueReport(report: ReportImpl): void {
    if (!visibleReportTypes.has(report.type)) return;
    if (this.#types?.length && !this.#types.includes(report.type)) return;
    this.#reports.push(report);
    if (this.#reports.length !== 1) return;
    const observers = [...this.#global.reportingObservers];
    this.#global.env.exec.queueTask('report', () => {
      for (const observer of observers) observer.#invokeCallback();
    });
  }

  /** Remove expired pending records without changing this observer's registration. */
  discardReportsBefore(cutoff: number): void {
    this.#reports = this.#reports.filter((report) => report.timestamp >= cutoff);
  }

  /** Deliver a nonempty batch, clearing it before invoking author code. */
  // https://w3c.github.io/reporting/#invoke-observers
  #invokeCallback(): void {
    const reports = this.takeRecords();
    if (reports.length === 0) return;
    this.#callback.call(this, reports, this);
  }
}

/** Values after ReportingObserverOptions dictionary conversion and defaulting. */
export type ReportingObserverOptions = {
  types?: string[];
  buffered: boolean;
};

/** Implementation-facing invocation of the converted ReportingObserverCallback. */
export type ReportingObserverCallback = (
  this: ReportingObserverImpl, reports: ReportImpl[], observer: ReportingObserverImpl,
) => void;

// HTML, SRI, and CSP expose their violation reports; Reporting exposes test reports.
// Other report types remain invisible until their definitions and body interfaces are integrated.
const visibleReportTypes = new Set(['coep', 'integrity-violation', 'csp-violation', 'test']);

/*
 * [Exposed=(Window,Worker)]
 * interface ReportingObserver {
 *   constructor(ReportingObserverCallback callback, optional ReportingObserverOptions options = {});
 *   undefined observe();
 *   undefined disconnect();
 *   ReportList takeRecords();
 * };
 * callback ReportingObserverCallback = undefined (sequence<Report> reports, ReportingObserver observer);
 * dictionary ReportingObserverOptions {
 *   sequence<DOMString> types;
 *   boolean buffered = false;
 * };
 * typedef sequence<Report> ReportList;
 */
export const reportingObserverIDL = defineInterface<BrowletEnvironment>({
  name: 'ReportingObserver',
  exposed: ['Window', 'Worker'],
  implementation: impl(ReportingObserverImpl),
  members: [
    ctor(
      [
        arg('callback', reference('ReportingObserverCallback'), onError('report')),
        arg('options', reference('ReportingObserverOptions'), { optional: true, default: emptyDictionary }),
      ],
      { constructWith: [atArg(2, (ctx) => ctx.realm.env)] },
    ),
    op('observe', idlType.undefined),
    op('disconnect', idlType.undefined),
    op('takeRecords', reference('ReportList')),
  ],
});

export const reportingObserverCallbackIDL = defineCallbackFunction({
  name: 'ReportingObserverCallback',
  returns: idlType.undefined,
  arguments: [arg('reports', sequence(reference('Report'))), arg('observer', reference('ReportingObserver'))],
});

export const reportingObserverOptionsIDL = defineDictionary({
  name: 'ReportingObserverOptions',
  members: [
    dictMember('types', sequence(idlType.DOMString)),
    dictMember('buffered', idlType.boolean, { default: false }),
  ],
});

export const reportListIDL = defineTypedef({ name: 'ReportList', type: sequence(reference('Report')) });
