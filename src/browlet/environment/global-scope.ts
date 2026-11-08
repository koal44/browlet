import {
  forgivingBase64Decode, forgivingBase64Encode, internalType, type InternalPromise, type InternalPromiseWithResolvers,
} from '../../infra/index';
import { isomorphicDecode, type JSFunction } from '../../js-engine/index';
import {
  arg, onError, defineInterfaceMixin, definePartialInterfaceMixin, defineTypedef,
  DOMExceptionImpl, DOMExceptionNames,
  emptyDictionary, idlType, integer, op, reference, roAttr, tsType, union, xattr, type VoidFunction,
} from '../../web-idl/core/index';
import { areSameOriginDomain, serializeOrigin, type Origin } from '../../url/index';
import { maximumResourceHeaderLength, parseMIMEType, sniffMIMETypeInImageContext } from '../../mime/index';
import { BlobImpl } from '../../file/index';
import { BitmapData, ImageBitmapImpl, type ImageDataImpl, type ImageBitmapCrop, type ImageBitmapOptions } from '../../graphics/index';
import { fetchForGlobal, type FetchRequestInfo, type FetchRequestInit, type FetchResponse, type ResponseImpl } from '../../fetch/index';

import { GlobalTimers, type TimerAction } from '../scripting/index';
import { ReportingEndpoint, type ReportImpl, type ReportingObserverImpl } from '../reporting/index';
import { TrustedTypePolicyFactoryImpl } from '../browsing/policy/trusted-types/index';
import type { DocumentImpl } from '../dom/nodes/index';
import { PerformanceImpl } from '../performance/index';
import type { BroadcastChannelImpl, EventSourceImpl, MessagePortImpl } from '../communication/index';
import type { StructuredSerializeOptions } from '../scripting/structured-data/index';
import type { PermissionStatusImpl } from '../integration/permissions/index';

import type { BrowletEnvironment } from './environment';

/** Owns timers, performance, reporting, and resource lifetimes for one global. */
// https://html.spec.whatwg.org/multipage/webappapis.html#windoworworkerglobalscope
export class WindowOrWorkerGlobalScopeMixin {
  /** Timer handles and scheduling state retained by this global. */
  timers: GlobalTimers;
  /** Entangled ports retained for messaging and permanent document cleanup. */
  messagePorts = new Set<MessagePortImpl>();
  /** Open broadcast channels with message or messageerror listeners. */
  broadcastChannels = new Set<BroadcastChannelImpl>();
  /** PermissionStatus objects with at least one change listener, retained for this global's lifetime. */
  permissionStatuses = new Set<PermissionStatusImpl>();
  /** WebSockets registered for cleanup in this global. */
  // PROVISIONAL: WebSocket creation and registration are not implemented.
  webSockets: { makeDisappear(): void; }[] = [];
  /** WebTransports registered for cleanup in this global. */
  // PROVISIONAL: WebTransport creation and registration are not implemented.
  webTransports: { cleanup(): void; }[] = [];
  /** Active EventSources, retained until close or permanent Document/worker cleanup. */
  eventSources = new Set<EventSourceImpl>();
  /** Named Reporting destinations configured by this global's resource response. */
  reportingEndpoints: ReportingEndpoint[] = [];
  /** Reports awaiting delivery for this global, independent of other globals. */
  reports: ReportImpl[] = [];
  /** Observers currently registered with this global, in registration order. */
  reportingObservers = new Set<ReportingObserverImpl>();
  /** Recent reports for buffered observation, limited to 100 entries per type. */
  reportBuffer: ReportImpl[] = [];
  /** Environment shared by this global's browser facilities. */
  env: BrowletEnvironment;
  /** Stable Performance implementation sharing this environment's time origin. */
  performance: PerformanceImpl;
  /** Policy state and empty trusted values belonging exclusively to this global. */
  trustedTypes: TrustedTypePolicyFactoryImpl;

  constructor(env: BrowletEnvironment) {
    this.env = env;
    this.performance = new PerformanceImpl(env);
    this.trustedTypes = new TrustedTypePolicyFactoryImpl(env);
    this.timers = new GlobalTimers({
      eventLoop: env.responsibleEventLoop,
      host: env.timerHost,
      queueTask: (steps, options) => env.queueTask('timer', steps, options),
      time: env,
    });
  }

  /** Serialized origin of this global's settings, independent of author replacement. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#dom-origin
  get origin(): string {
    return serializeOrigin(this.env.origin);
  }

  /** Security classification of this global's environment. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#dom-issecurecontext
  get isSecureContext(): boolean {
    return this.env.isSecureContext;
  }

  // https://html.spec.whatwg.org/multipage/webappapis.html#dom-crossoriginisolated
  get crossOriginIsolated(): boolean {
    return this.env.crossOriginIsolatedCapability;
  }

  // https://html.spec.whatwg.org/multipage/webappapis.html#windoworworkerglobalscope
  extractOrigin(entryEnv: BrowletEnvironment): Origin | null {
    return areSameOriginDomain(this.env.origin, entryEnv.origin) ? this.env.origin : null;
  }

  /** Encode a binary string whose code points each represent one byte. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#dom-btoa
  btoa(data: string): string {
    const bytes = new Uint8Array(data.length);
    for (let index = 0; index < data.length; index++) {
      const value = data.charCodeAt(index);
      if (value > 0xff) {
        throw new DOMExceptionImpl('The string contains a character outside U+0000–U+00FF', DOMExceptionNames.invalidCharacter);
      }
      bytes[index] = value;
    }
    return forgivingBase64Encode(bytes);
  }

  /** Decode forgiving Base64 into a string with one code point per byte. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#dom-atob
  atob(data: string): string {
    const bytes = forgivingBase64Decode(data);
    if (bytes === null) throw new DOMExceptionImpl('The string is not valid Base64', DOMExceptionNames.invalidCharacter);
    return isomorphicDecode(bytes);
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

  /** Queue a converted callback with no arguments; Binding reports its exceptions. */
  // https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-queuemicrotask
  queueMicrotask(callback: VoidFunction): void {
    // Preserve this global's Document if the microtask later spins into a task.
    this.env.realm.queueMicrotask(() => { callback(); });
  }

  /**
   * Snapshot an in-memory source now, or read a Blob in parallel; deliver through this global's bitmap task.
   * The optional crop record carries the second overload's four converted longs.
   * Internal only until the complete ImageBitmapSource union and its remaining owners are connected.
   */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap
  createImageBitmap(
    image: ImageDataImpl | ImageBitmapImpl | BlobImpl, options: ImageBitmapOptions, crop?: ImageBitmapCrop,
  ): InternalPromise<ImageBitmapImpl> {
    const env = this.env;
    const result = env.InternalPromise.withResolvers(reference(ImageBitmapImpl));
    try {
      if (BlobImpl.is(image)) {
        BitmapData.validateDimensions(options, crop, env);
        this.#createImageBitmapFromBlob(image, options, crop, result);
        return result.promise;
      }
      // Preparation validates crop/resize dimensions before accessing the source's live pixels.
      const bitmap = ImageBitmapImpl.create(BitmapData.create(image, options, crop, env), env);
      // SPEC_CLASH(imagebitmap-task-delivery): Follow HTML/Chromium/Firefox's queued fulfillment; WebKit fulfills in-memory reads immediately.
      env.queueTask('bitmap', () => { result.resolve(bitmap); });
    } catch (error) {
      // HTML returns an already rejected Promise for invalid in-memory sources or dimensions.
      result.reject(error);
    }
    return result.promise;
  }

  structuredClone(
    value: unknown,
    options: StructuredSerializeOptions = { transfer: [] },
  ): unknown {
    return this.env.clone(value, options.transfer);
  }

  /** Fetch's addition to the WindowOrWorkerGlobalScope mixin. */
  fetch(input: FetchRequestInfo, init: FetchRequestInit): InternalPromise<ResponseImpl> {
    return fetchForGlobal(input, init, this.env);
  }

  /** Replace this global's Reporting endpoint list using its resource response. */
  // https://w3c.github.io/reporting/#initialize-a-globals-endpoint-list
  initializeReportingEndpoints(response: FetchResponse): void {
    this.reportingEndpoints = ReportingEndpoint.parse(response, this.env.userAgent);
  }

  /** Generate a report for local observation and, when enabled, later network delivery. */
  // https://w3c.github.io/reporting/#generate-report
  queueReport(type: string, destination: string, body: unknown): void {
    const report = this.env.generateReport(body, type, destination);
    this.notifyReportingObservers(report);
    if (this.env.userAgent.reportDeliveryEnabled) this.reports.push(report);
    else this.reports.length = 0;
  }

  /** Generate an observable test report; WebDriver owns protocol validation and prompt handling. */
  // https://w3c.github.io/reporting/#generate-test-report-command
  generateTestReport(message: string, group = 'default'): void {
    this.queueReport('test', group, { message });
  }

  /** Publish a report locally and retain the most recent 100 reports of its type. */
  // https://w3c.github.io/reporting/#notify-observers
  notifyReportingObservers(report: ReportImpl): void {
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

  /** Release global report state and registered observer batches during destruction. */
  // HTML removes this document's queued callback tasks before this cleanup.
  // The lifecycle owner hands off outbound data before calling this method.
  clearReportingState(): void {
    for (const observer of this.reportingObservers) observer.takeRecords();
    this.reportingObservers.clear();
    // An outbound task may still own the old configuration after this global retires.
    this.reportingEndpoints = [];
    this.reports.length = 0;
    this.reportBuffer.length = 0;
  }

  /** Transfer outbound data to the browser before this global releases its local state. */
  handoffReports(): void {
    this.retireReports();
    this.env.userAgent.sendReports(this.reports, this.reportingEndpoints);
    this.reports.length = 0;
  }

  /** Remove expired reports from delivery queues, replay buffers, and pending observer batches. */
  // https://w3c.github.io/reporting/#gc
  retireReports(): void {
    const { userAgent } = this.env;
    const cutoff = Date.now() - userAgent.maxReportAge;
    this.reports = this.reports.filter((report) => report.timestamp >= cutoff);
    this.reportBuffer = this.reportBuffer.filter((report) => report.timestamp >= cutoff);
    for (const observer of this.reportingObservers) observer.discardReportsBefore(cutoff);
    for (let index = this.reportingEndpoints.length - 1; index >= 0; index--) {
      if (this.reportingEndpoints[index]!.failures > userAgent.maxReportingEndpointFailures) {
        this.reportingEndpoints.splice(index, 1);
      }
    }
  }

  setAssociatedDocument(document: DocumentImpl): void {
    this.timers.setAssociatedDocument(document);
  }

  /** Read retained Blob bytes without involving its source global's file-reading task queue. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap
  #createImageBitmapFromBlob(
    image: BlobImpl, options: ImageBitmapOptions, crop: ImageBitmapCrop | undefined,
    result: InternalPromiseWithResolvers<ImageBitmapImpl>,
  ): void {
    const env = this.env;
    const data = image.data;
    const suppliedType = parseMIMEType(image.type) ?? undefined;
    const capturedOptions = { ...options };
    const capturedCrop = crop === undefined ? undefined : { ...crop };
    const reject = (error: unknown): void => { env.queueTask('bitmap', () => { result.reject(error); }); };
    const readFailed = (): void => {
      reject(new DOMExceptionImpl('The Blob could not be read as an image', DOMExceptionNames.invalidState));
    };
    env.runInParallel(() => {
      try {
        const P = env.userAgent.HostPromise;
        // BlobData.read() returns a typed host Promise; this only selects host continuation ownership.
        P.fromNative(data.read(), (bytes) => bytes as Uint8Array, internalType<Uint8Array>()).observe((bytes) => {
          try {
            const mimeType = sniffMIMETypeInImageContext(suppliedType, bytes.subarray(0, maximumResourceHeaderLength));
            const pixels = BitmapData.decode(bytes, mimeType, capturedOptions, capturedCrop, env);
            const bitmap = ImageBitmapImpl.create(pixels, env);
            env.queueTask('bitmap', () => { result.resolve(bitmap); });
          } catch (error) { reject(error); }
        }, readFailed);
      } catch { readFailed(); }
    });
  }
}

/** Converted timer callback or source text. */
export type TimerHandler = string | JSFunction;

// TrustedScript awaits the Trusted Types interface and timer string compilation.
/*
 * typedef (DOMString or Function or TrustedScript) TimerHandler;
 */
export const timerHandlerIDL = defineTypedef({
  name: 'TimerHandler',
  type: union(idlType.DOMString, reference('Function')),
});

/*
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
 *   TODO: The mixin implements in-memory creation, Blob reads, and bitmap-task settlement.
 *   Encoded-image decoding/formatting remains an explicit BitmapData.decode dependency.
 *   Author exposure still needs the complete ImageBitmapSource union, overload
 *   conversion, and source adapters (see ../graphics/ROADMAP.md).
 *   Promise<ImageBitmap> createImageBitmap(ImageBitmapSource image,
 *     optional ImageBitmapOptions options = {});
 *   Promise<ImageBitmap> createImageBitmap(ImageBitmapSource image,
 *     long sx, long sy, long sw, long sh,
 *     optional ImageBitmapOptions options = {});
 *
 *   any structuredClone(any value,
 *     optional StructuredSerializeOptions options = {});
 * };
 */
export const windowOrWorkerGlobalScopeIDL = defineInterfaceMixin({
  name: 'WindowOrWorkerGlobalScope',
  members: [
    roAttr('origin', idlType.USVString, xattr('Replaceable')),
    roAttr('isSecureContext', idlType.boolean),
    roAttr('crossOriginIsolated', idlType.boolean),
    op('reportError', idlType.undefined, [arg('e', idlType.any)]),
    op('btoa', idlType.DOMString, [arg('data', idlType.DOMString)]),
    op('atob', idlType.ByteString, [arg('data', idlType.DOMString)]),
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
    op('queueMicrotask', idlType.undefined,
      [arg('callback', reference('VoidFunction'), onError('report'))],
    ),
    // https://html.spec.whatwg.org/multipage/structured-data.html#dom-structuredclone
    op('structuredClone', tsType(idlType.any, 'T'),
      [
        arg('value', tsType(idlType.any, 'T')),
        arg('options', reference('StructuredSerializeOptions'), {
          default: emptyDictionary,
          optional: true,
        }),
      ],
      { typeParameters: [{ name: 'T', default: 'any' }] },
    ),
  ],
});

// High Resolution Time: https://w3c.github.io/hr-time/#extensions-to-windoworworkerglobalscope
/*
 * partial interface mixin WindowOrWorkerGlobalScope {
 *   [Replaceable] readonly attribute Performance performance;
 * };
 */
export const highResolutionTimeWindowOrWorkerGlobalScopeIDL =
  definePartialInterfaceMixin({
    name: windowOrWorkerGlobalScopeIDL.name,
    members: [roAttr('performance', reference('Performance'), xattr('Replaceable'))],
  });

// Trusted Types: https://w3c.github.io/trusted-types/dist/spec/#extensions-to-the-windoworworkerglobalscope-interface
/*
 * partial interface mixin WindowOrWorkerGlobalScope {
 *   readonly attribute TrustedTypePolicyFactory trustedTypes;
 * };
 */
export const trustedTypesWindowOrWorkerGlobalScopeIDL = definePartialInterfaceMixin({
  name: windowOrWorkerGlobalScopeIDL.name,
  members: [roAttr('trustedTypes', reference(TrustedTypePolicyFactoryImpl))],
});
