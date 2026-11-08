import type { JSMessagePortHandle, JSThreadProtocol } from '../../../js-engine/index';
import type { URLRecord, Origin } from '../../../url/index';
import type { HTTPStatus } from '../../../http/index';
import type { Destination, ReferrerPolicy, RequestCredentials, ResponseType } from '../../../fetch/index';

import type { ErrorInformation } from '../../dom/events/index';
import type { PolicyContainerSnapshot } from '../../browsing/policy/index';
import type { CreatorEnvironmentSnapshot } from '../../environment/index';
import type { WorkerOptions, WorkerOwnerState } from '../../workers/index';

import type { WorkerUserAgentInit } from './user-agent';

/** Both endpoints share this trusted host protocol; receivers exhaustively handle its message kinds. */
export interface WorkerThreadProtocol extends JSThreadProtocol {
  startup: WorkerThreadStartup;
  toThread: WorkerThreadInput;
  fromThread: WorkerThreadMessage;
}

/** Initial classic/module script selection, captured before creating the isolate. */
export interface WorkerScriptInit extends WorkerOptions {
  /** Keep its cached Blob registration on the creator side until the root fetch consumes it. */
  url: URLRecord;
  /** Shared-worker option; absent for dedicated startup and false by default. */
  extendedLifetime?: boolean;
}

/** Cloneable script selection and the identity of its creator-side reserved Fetch client. */
export interface WorkerScriptStartup extends WorkerScriptInit {
  /** Worker origin selected once by the outside reservation, rather than recreated in each isolate. */
  origin: Origin;
  /** Must become the inside WorkerEnvironment ID, distinct from its creator's ID. */
  environmentId: string;
  /** Normalized before transport, including false for a dedicated worker. */
  extendedLifetime: boolean;
}

/** Data cloned into the new isolate before any Browlet realm or global exists. */
export interface WorkerThreadStartup {
  /** Dedicated service endpoint selecting the original browser's shared stores. */
  userAgent: WorkerUserAgentInit;
  /** Agent kind selected by the outside startup owner. */
  kind: 'dedicated' | 'shared';
  /** Internal startup payload copied from WorkerThreadInit. */
  data: unknown;
  /** Portable creator values needed to compose the inside environment. */
  creatorEnvSnapshot: CreatorEnvironmentSnapshot;
  /** Initial script selection; its URL has no live Blob registration. */
  script: WorkerScriptStartup;
  /** Original Document activity for dedicated startup; its live identity stays with the creator. */
  ownerState: WorkerOwnerState;
}

/** Private acknowledgement and outbound data; never HTML MessageEvents. */
type WorkerThreadMessage =
  { type: 'ready'; } |
  { type: 'message'; data: unknown; } |
  { type: 'error'; errorInfo: ErrorInformation; } |
  { type: 'fetch-script'; } |
  { type: 'fetch-module'; id: number; request: WorkerModuleScriptFetch; } |
  { type: 'script-fetch-failed'; };

/** Cloneable subset consumed by worker script processing; timing and network resources stay with Fetch. */
export interface ScriptResponseSnapshot {
  type: ResponseType;
  aborted: boolean;
  urlList: URLRecord[];
  status: HTTPStatus;
  statusMessage: string;
  headers: [string, string][];
  /** Preserve the distinction between an absent body and a failed body read across transport. */
  bodyBytes: Uint8Array | null | 'failure';
}

/** Root responses also carry policies selected before the inside worker can parse any script. */
export interface WorkerScriptResponseSnapshot extends ScriptResponseSnapshot {
  /** Worker policies selected while the response's live owner and Blob registration are available. */
  policyContainer: PolicyContainerSnapshot | null;
  /** Creator-side COEP check, after queuing any creator-owned violation reports. */
  embedderPolicyAllowed: boolean;
  /** Creator isolation constrains the dedicated worker's capability after response initialization. */
  outsideCrossOriginIsolatedCapability: boolean;
}

/** Cloneable inputs for a dependency of the initial worker module graph, not general worker Fetch. */
export interface WorkerModuleScriptRequest {
  /** Resolved URL without a cached Blob registration; the creator owns that lookup. */
  url: URLRecord;
  /** The referring module's final URL, or the script-fetch algorithm's explicit referrer sentinel. */
  referrer: URLRecord | 'client' | 'no-referrer';
  /** Module-kind destination selected by the script loader. */
  destination: Destination;
  /** Inherited from the Worker constructor's module credentials option. */
  credentials: RequestCredentials;
  /** Inherited from the referring module's response. */
  referrerPolicy: ReferrerPolicy;
  /** Descendant integrity metadata selected by the script loader. */
  integrityMetadata: string;
  // Other initial-worker graph options retain HTML's defaults: empty nonce,
  // not parser-inserted, not render-blocking, and automatic fetch priority.
}

/** Wire request referring to a registration already captured through this worker's service connection. */
export interface WorkerModuleScriptFetch extends WorkerModuleScriptRequest {
  /** Null preserves an unsuccessful earlier lookup, even if the URL is registered before Fetch runs. */
  blobEntryId: number | null;
}

/** Private creator-to-worker messages, distinguished before choosing the receiving task source. */
type WorkerThreadInput = { type: 'message'; data: unknown; } |
  { type: 'owner-removed'; } |
  { type: 'owner-activity'; fullyActive: boolean; } |
  { type: 'connect-port'; handle: JSMessagePortHandle; } |
  { type: 'script-response'; snapshot: WorkerScriptResponseSnapshot; } |
  { type: 'module-response'; id: number; snapshot: ScriptResponseSnapshot; };
