import { InternalError } from '../../../infra/index';
import { copyURL, type URLRecord } from '../../../url/index';
import { FetchResponse, isFilteredResponse, type FetchGroup, type FetchEnvironment, type FetchRequest } from '../../../fetch/index';

import { ContentSecurityPolicy, type ContentSecurityPolicySnapshot } from '../../browsing/policy/csp/index';
import { InsecureRequestsPolicy, PolicyContainer } from '../../browsing/policy/index';
import { WorkerEnvironmentBase, type BrowletEnvironment } from '../../environment/index';

import type { ScriptResponseSnapshot, WorkerScriptFetchClient } from './protocol';

/**
 * Browser-side Fetch execution for an isolated worker's script requests.
 * Client identity and policy come from the worker. Internal bytes/streams use
 * the browser sandbox. This adapter has a local execution realm, not the remote
 * author realm; compilation and public objects remain inside the worker.
 * Completion uses a parallel queue, independently of either author's event loop.
 */
export class WorkerScriptFetchEnvironment extends WorkerEnvironmentBase implements FetchEnvironment {
  /** Violations travel back with the response and are reported by the actual worker environment. */
  violations: ContentSecurityPolicySnapshot[] = [];
  /** Shared with other requests for this worker, including background revalidations. */
  fetchGroup: FetchGroup;
  /** Worker response initialization supplies the active upgrade policy. */
  insecureRequestsPolicy = new InsecureRequestsPolicy();
  apiBaseURL: URLRecord;
  hasCrossSiteAncestor: boolean;
  crossOriginIsolatedCapability: boolean;
  isWindow = false;
  isServiceWorker = false;
  isTopLevelWindow = false;
  /** Private allocation/task owner in this isolate; never a Window or the remote worker global. */
  #sandbox: BrowletEnvironment;

  /** Retain the established identity while copying the worker's current Fetch-facing values. */
  constructor(snapshot: WorkerScriptFetchClient, fetchGroup: FetchGroup, env: WorkerEnvironmentBase) {
    super(env, env.origin);
    this.#sandbox = env.userAgent.sandbox;
    this.fetchGroup = fetchGroup;
    this.apiBaseURL = snapshot.apiBaseURL;
    this.policyContainer = PolicyContainer.fromSnapshot(snapshot.policyContainer);
    this.hasCrossSiteAncestor = snapshot.hasCrossSiteAncestor;
    this.crossOriginIsolatedCapability = snapshot.crossOriginIsolatedCapability;
    if (snapshot.upgradeInsecureRequests) this.insecureRequestsPolicy.enableFor(this.apiBaseURL);
  }

  /** Allocate only private Fetch/Streams objects in the local browser sandbox. */
  get realm() { return this.#sandbox.realm; }
  get InternalPromise() { return this.#sandbox.InternalPromise; }
  get DOMException() { return this.#sandbox.DOMException; }
  get nativeLineEnding() { return this.#sandbox.nativeLineEnding; }
  get runInParallel() { return this.#sandbox.runInParallel; }

  /** Forward execution facilities with their original receiver and owner. */
  get queueTask() { return this.#sandbox.queueTask.bind(this.#sandbox); }
  get queueGlobalFetchTask() { return this.#sandbox.queueGlobalFetchTask.bind(this.#sandbox); }
  get createAbortController() { return this.#sandbox.createAbortController; }
  get createDependentAbortSignal() { return this.#sandbox.createDependentAbortSignal; }
  get clone() { return this.#sandbox.clone; }
  get serialize() { return this.#sandbox.serialize; }
  get deserialize() { return this.#sandbox.deserialize; }
  get parseJSONBytes() { return this.#sandbox.parseJSONBytes.bind(this.#sandbox); }
  get serializeJavaScriptValueToJSONBytes() { return this.#sandbox.serializeJavaScriptValueToJSONBytes.bind(this.#sandbox); }

  /** Resolve through the browser's shared Blob registry. */
  parseURL(input: string, base: URLRecord | null = null, encoding = 'UTF-8'): URLRecord | null {
    return this.userAgent.parseURL(input, base, encoding);
  }

  /** Retain policy data, never call into the blocked isolate from Fetch. */
  reportCSPViolation(policy: unknown, _request: FetchRequest): void {
    if (!(policy instanceof ContentSecurityPolicy)) throw new InternalError('Expected a Content Security Policy');
    this.violations.push(policy.toSnapshot());
  }

  /** Worker referrers and report sources use the root script's final URL. */
  getReferrerSource(): URLRecord { return this.creationURL; }
  getReportingSource(): URLRecord { return this.apiBaseURL; }

  /** Mixed-content checks use the worker's origin, including an inherited opaque identity. */
  prohibitsMixedSecurityContexts(): boolean { return this.userAgent.isOriginPotentiallyTrustworthy(this.origin); }

  /** These operations only apply to Window clients. */
  isPolicyFeatureEnabled(): boolean { return false; }
  consumePreloadedResource(): boolean { return false; }
  getTraversableForUserPrompts(): null { return null; }

  /** Resource timing belongs to the remote worker, never the browser sandbox's Performance object. */
  markResourceTiming(): void {
    // TODO(HTML workers): Transport timing entries to the remote Performance owner.
    // Parallel-queue imports do not auto-report timing; background cache revalidation
    // can also reach this path and must not publish entries on the sandbox instead.
  }

  /** TODO(HTML workers): Connect the worker's Reporting service independently of this byte reply. */
  queueReport(): never { throw new InternalError('Worker report transport is not connected'); }
}

/** Capture consumed metadata and bytes, retaining taint separately from the underlying response. */
export function captureScriptResponse(response: FetchResponse, bodyBytes: Uint8Array | null | 'failure'): ScriptResponseSnapshot {
  const underlying = isFilteredResponse(response) ? response.internalResponse : response;
  return {
    type: response.type,
    aborted: response.aborted,
    urlList: underlying.urlList.map((url) => { const copy = copyURL(url); copy.blobURLEntry = null; return copy; }),
    status: underlying.status,
    statusMessage: underlying.statusMessage,
    headers: underlying.headerList.list,
    bodyBytes,
  };
}

/** Rebuild the response view, keeping unsafe metadata private beneath any filtered response. */
export function restoreScriptResponse(snapshot: ScriptResponseSnapshot): FetchResponse {
  const response = new FetchResponse();
  response.aborted = snapshot.aborted;
  response.urlList = snapshot.urlList;
  response.status = snapshot.status;
  response.statusMessage = snapshot.statusMessage;
  response.headerList.list = snapshot.headers;
  if (snapshot.type === 'default' || snapshot.type === 'error') {
    response.type = snapshot.type;
    return response;
  }
  return response.filter(snapshot.type);
}
