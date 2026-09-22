import {
  arg, onError, defineInterfaceMixin, definePartialInterfaceMixin, defineTypedef,
  emptyDictionary, idlType, integer, op, reference, roAttr, union, xattr,
} from '../../web-idl/index';
import { PerformanceImpl } from '../performance/performance';
import { ReportingEndpoint } from '../reporting/endpoint';
import { generateReport, type Report } from '../reporting/report';
import type { ReportingObserverImpl } from '../reporting/observer';
import type { FetchResponse } from '../../fetch/index';
import type { DocumentImpl } from '../dom/nodes/document';
import type { Environment } from './environment';
import { GlobalTimers, timerTaskSource, type TimerAction } from './timers';
import { structuredSerializeOptionsIDL } from './structured-data/web-idl';
import { createTaskSource } from './event-loop';
import type { QueuedTaskHandle } from './tasks';

/*
 * typedef (DOMString or Function or TrustedScript) TimerHandler;
 *
 * interface mixin WindowOrWorkerGlobalScope {
 *   [Replaceable] readonly attribute USVString origin;
 *   readonly attribute boolean isSecureContext;
 *   readonly attribute boolean crossOriginIsolated;
 *
 *   undefined reportError(any e);
 *
 *   DOMString btoa(DOMString data);
 *   ByteString atob(DOMString data);
 *
 *   long setTimeout(TimerHandler handler, optional long timeout = 0,
 *     any... arguments);
 *   undefined clearTimeout(optional long id = 0);
 *   long setInterval(TimerHandler handler, optional long timeout = 0,
 *     any... arguments);
 *   undefined clearInterval(optional long id = 0);
 *
 *   undefined queueMicrotask(VoidFunction callback);
 *
 *   Promise<ImageBitmap> createImageBitmap(ImageBitmapSource image,
 *     optional ImageBitmapOptions options = {});
 *   Promise<ImageBitmap> createImageBitmap(ImageBitmapSource image,
 *     long sx, long sy, long sw, long sh,
 *     optional ImageBitmapOptions options = {});
 *
 *   any structuredClone(any value,
 *     optional StructuredSerializeOptions options = {});
 * };
 *
 * High Resolution Time:
 *
 * partial interface mixin WindowOrWorkerGlobalScope {
 *   [Replaceable] readonly attribute Performance performance;
 * };
 */
export class WindowOrWorkerGlobalScopeMixin {
  timers: GlobalTimers;
  /** Named Reporting destinations configured by this global's resource response. */
  reportingEndpoints: ReportingEndpoint[] = [];
  /** Reports awaiting delivery for this global, independent of other globals. */
  reports: Report[] = [];
  /** Observers currently registered with this global, in registration order. */
  reportingObservers = new Set<ReportingObserverImpl>();
  /** Recent reports for buffered observation, limited to 100 entries per type. */
  reportBuffer: Report[] = [];
  #environment: Environment;
  #performance: PerformanceImpl;

  constructor(environment: Environment) {
    this.#environment = environment;
    this.#performance = new PerformanceImpl(environment.timing);
    const { realm } = environment;
    this.timers = new GlobalTimers({
      eventLoop: environment.responsibleEventLoop,
      queueTask: (steps, options) => realm.queueGlobalTask(timerTaskSource, steps, options),
      time: environment.timing,
    });
  }

  /** https://html.spec.whatwg.org/multipage/webappapis.html#dom-issecurecontext */
  get isSecureContext(): boolean {
    return this.#environment.isSecureContext;
  }

  get performance(): PerformanceImpl {
    return this.#performance;
  }

  setTimeout(
    action: TimerAction,
    timeout: number,
    argumentsList: unknown[],
  ): number {
    return this.timers.setTimeout(action, timeout, argumentsList);
  }

  setInterval(
    action: TimerAction,
    timeout: number,
    argumentsList: unknown[],
  ): number {
    return this.timers.setInterval(action, timeout, argumentsList);
  }

  clearTimer(id: number): void {
    this.timers.clearTimer(id);
  }

  queueMicrotask(callback: VoidFunction): void {
    this.#environment.responsibleEventLoop.queueMicrotask(() => { callback(); });
  }

  structuredClone(
    value: unknown,
    options: StructuredSerializeOptions = { transfer: [] },
  ): unknown {
    return this.#environment.exec.clone(value, options.transfer);
  }

  /** Replace this global's Reporting endpoint list using its resource response. */
  // https://w3c.github.io/reporting/#initialize-a-globals-endpoint-list
  initializeReportingEndpoints(response: FetchResponse): void {
    this.reportingEndpoints = ReportingEndpoint.parse(response, this.#environment.userAgent);
  }

  /** Generate a report for local observation and, when enabled, later network delivery. */
  // https://w3c.github.io/reporting/#generate-report
  queueReport(type: string, destination: string, body: unknown): void {
    const report = generateReport(body, type, destination, this.#environment);
    this.notifyReportingObservers(report);
    if (this.#environment.userAgent.reportDeliveryEnabled) this.reports.push(report);
    else this.reports.length = 0;
  }

  /** Publish a report locally and retain the most recent 100 reports of its type. */
  // https://w3c.github.io/reporting/#notify-observers
  notifyReportingObservers(report: Report): void {
    for (const observer of this.reportingObservers) observer.queueReport(report);
    this.reportBuffer.push(report);
    let count = 0;
    for (const bufferedReport of this.reportBuffer) {
      if (bufferedReport.type === report.type) count++;
    }
    if (count > 100) {
      const index = this.reportBuffer.findIndex((bufferedReport) => bufferedReport.type === report.type);
      this.reportBuffer.splice(index, 1);
    }
  }

  /** Queue observer work on the HTML event loop owning this global. */
  queueReportingTask(steps: () => void): QueuedTaskHandle {
    return this.#environment.realm.queueGlobalTask(reportingTaskSource, steps);
  }

  // -- Internal ---------------------------------------------------------

  setAssociatedDocument(document: DocumentImpl): void {
    this.timers.setAssociatedDocument(document);
  }
}

// Reporting leaves the task source unnamed; WebKit likewise gives it a distinct source.
export const reportingTaskSource = createTaskSource('reporting');

// -- Web IDL ------------------------------------------------------------

/*
 * TrustedScript is the third arm of this typedef. Add it when Browlet owns
 * the Trusted Types interface and the timer string-compilation branch.
 */
export const timerHandlerIDL = defineTypedef({
  name: 'TimerHandler',
  type: union(idlType.DOMString, reference('Function')),
});

export const windowOrWorkerGlobalScopeIDL = defineInterfaceMixin({
  name: 'WindowOrWorkerGlobalScope',
  members: [
    roAttr('isSecureContext', idlType.boolean),
    op('setTimeout', idlType.long, [
      arg('handler', reference('TimerHandler'), onError('report')),
      arg('timeout', idlType.long, { default: integer(0), optional: true }),
      arg('arguments', idlType.any, { variadic: true }),
    ]),
    op('clearTimeout', idlType.undefined, [
      arg('id', idlType.long, { default: integer(0), optional: true }),
    ]),
    op('setInterval', idlType.long, [
      arg('handler', reference('TimerHandler'), onError('report')),
      arg('timeout', idlType.long, { default: integer(0), optional: true }),
      arg('arguments', idlType.any, { variadic: true }),
    ]),
    op('clearInterval', idlType.undefined, [
      arg('id', idlType.long, { default: integer(0), optional: true }),
    ]),
    op(
      'queueMicrotask',
      idlType.undefined,
      [arg('callback', reference('VoidFunction'), onError('report'))],
    ),
    // HTML §2.7.10 contributes the structured-cloning API to this mixin.
    op('structuredClone', idlType.any, [
      arg('value', idlType.any),
      arg('options', reference(structuredSerializeOptionsIDL.name), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
  ],
});

export const highResolutionTimeWindowOrWorkerGlobalScopeIDL =
  definePartialInterfaceMixin({
    name: windowOrWorkerGlobalScopeIDL.name,
    members: [roAttr(
      'performance',
      reference('Performance'),
      xattr('Replaceable'),
    )],
  });
