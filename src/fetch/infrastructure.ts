import type { FetchGroup } from './group';
import type { ConnectionPool } from './http/connections';
import type { HTTPCachePartitions } from './http/cache/partitions';
import type { FetchIntegrityPolicy } from './integrity';
import type { CookieStore } from '../http/index';
import type { BlobImpl } from '../file/index';
import type { JSEnvironment } from '../js-engine/index';
import type { StorageEnvironment, StorageUserAgent } from '../storage/index';
import type { BlobURLEntry, Host, Origin, URLParseResult, URLRecord } from '../url/index';
import { defineCapability, type BindingContext, type InterfaceDefinition } from '../web-idl/index';
import { InternalError } from '../infra/internal-error';

/** https://fetch.spec.whatwg.org/#is-offline */
export function isOffline(env: FetchEnvironment): boolean {
  return env.userAgent.assumeNoInternetConnectivity ||
    env.userAgent.webDriverBiDiNetworkIsOffline(env);
}

/** The HTML environment settings object, exposing only what Fetch currently uses. */
export interface FetchEnvironment extends FetchEnvironmentRecord, JSEnvironment {
  /** Current base URL used to resolve relative URLs supplied through Fetch APIs. */
  apiBaseURL: URLRecord;
  /** Parse a URL using this environment's browser and Blob URL store. */
  parseURL(input: string, base?: URLRecord | null, encoding?: string): URLParseResult;
  /** Client origin used by Fetch's origin and policy checks. */
  origin: Origin;
  /** Whether the client has cross-site ancestry or cannot establish a same-site ancestor context. */
  hasCrossSiteAncestor: boolean;
  /** Whether this client's origin or a Window ancestor prohibits mixed content. */
  prohibitsMixedSecurityContexts(): boolean;
  /** Upgrade policy and navigation targets inherited or enabled for this client. */
  insecureRequestsPolicy: FetchInsecureRequestsPolicy;
  /** Source URL selected by the client's global, or null when disclosure is prohibited. */
  getReferrerSource(): URLRecord | null;
  /** Document or worker URL for reports, or null for a global outside those categories. */
  getReportingSource(): URLRecord | null;
  /** Traversable belonging to this client's Window, or null when no Window navigable exists. */
  getTraversableForUserPrompts(): FetchPromptTarget | null;
  /** Requests tracked for this environment's lifetime. */
  fetchGroup: FetchGroup;
  /** Client's live policy container, exposing the policies currently consumed by Fetch. */
  policyContainer: FetchPolicyContainer;
  /** Submit a policy report for this client, retaining each field's JSON value type. */
  queueReport(type: string, endpoint: string, body: Record<string, string | boolean>): void;
}

/** An opaque reference to the HTML traversable selected for user prompts. */
export type FetchPromptTarget = {
  [fetchPromptTargetBrand]: true;
};

/** Type-only marker declared by HTML traversables; it has no runtime value. */
export declare const fetchPromptTargetBrand: unique symbol;

/** Upgrade Insecure Requests state supplied by the client's environment. */
export interface FetchInsecureRequestsPolicy {
  /** Whether the client upgrades insecure subresource and nested navigation requests. */
  upgrade: boolean;
  /** Whether this top-level navigation matches an opted-in host and port. */
  shouldUpgradeNavigation(url: URLRecord): boolean;
}

/** HTML's policy container, exposing the policies currently consumed by Fetch. */
export type FetchPolicyContainer = {
  /** Cross-origin embedder policy applied by the client. */
  embedderPolicy: {
    /** Enforced COEP mode, including credentialless restrictions on no-cors requests. */
    value: FetchEmbedderPolicyValue;
    /** Endpoint name for violations of the enforced policy. */
    reportingEndpoint: string;
    /** COEP mode checked for reporting without blocking responses. */
    reportOnlyValue: FetchEmbedderPolicyValue;
    /** Endpoint name for violations of the report-only policy. */
    reportOnlyReportingEndpoint: string;
  };
  /** Default referrer disclosure policy inherited by requests. */
  referrerPolicy: ReferrerPolicy;
  /** Enforced integrity requirements for outgoing requests. */
  integrityPolicy: FetchIntegrityPolicy;
  /** Integrity requirements checked for reporting without blocking requests. */
  reportOnlyIntegrityPolicy: FetchIntegrityPolicy;
  /** Copy the HTML-owned policy state for an independently populated request. */
  clone(): FetchPolicyContainer;
};

// https://html.spec.whatwg.org/multipage/browsers.html#embedder-policy-value
export type FetchEmbedderPolicyValue = 'unsafe-none' | 'require-corp' | 'credentialless';

// https://w3c.github.io/webappsec-referrer-policy/#referrer-policies
export type ReferrerPolicy = '' | 'no-referrer' | 'no-referrer-when-downgrade' | 'same-origin' |
  'origin' | 'strict-origin' | 'origin-when-cross-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';

/** The HTML environment, including reserved clients that do not yet have a realm. */
export interface FetchEnvironmentRecord extends StorageEnvironment {
  /** Shared user agent owning this environment's networking state. */
  userAgent: FetchUserAgent;
  /** Top-level origin used for network partitioning, or null when it must be derived. */
  topLevelOrigin: Origin | null;
  /** Top-level creation URL used to derive an unavailable top-level origin, or null. */
  topLevelCreationURL: URLRecord | null;
}

export interface FetchUserAgent extends StorageUserAgent {
  /** Default identification header value before an environment-specific override. */
  defaultUserAgentValue: string;
  /** Browser-wide assumption of no internet access, separate from per-client emulation. */
  assumeNoInternetConnectivity: boolean;
  /** Whether WebDriver BiDi emulates an offline network for the given environment. */
  webDriverBiDiNetworkIsOffline(env: FetchEnvironment): boolean;
  /** Identification override for the given environment, or null when BiDi supplies none. */
  webDriverBiDiEmulatedUserAgent(env: FetchEnvironment): string | null;
  /** Shared reusable connections, isolated by network partition, origin, and credentials. */
  connectionPool: ConnectionPool;
  /** Shared logical HTTP caches, separated by network partition key. */
  httpCachePartitions: HTTPCachePartitions;
  /** Cookie state shared by requests belonging to this user agent. */
  cookieStore: CookieStore;
  /** Enables sending and accepting cookies without deleting the store when disabled. */
  cookiesEnabled: boolean;
  /** Browser-owned transport-security state shared by this user agent's requests. */
  hstsStore: {
    /** Whether a URL host has an unexpired exact or inherited HTTPS requirement. */
    requiresHTTPS(host: Host | null): boolean;
  };
  /** Applies this user agent's trust policy to a URL, including loopback and configured origins. */
  isURLPotentiallyTrustworthy(url: URLRecord): boolean;
  /** Create HTML's default policy container for a request without a client. */
  createPolicyContainer(): FetchPolicyContainer;
  /** Browser URL parsing, including capture of the current Blob URL registration. */
  parseURL(input: string, base?: URLRecord | null, encoding?: string): URLParseResult;
  /** Acquire an already-captured File API entry with the caller-selected access context. */
  obtainBlobObject(
    entry: BlobURLEntry | null,
    env: StorageEnvironment | 'top-level-navigation' | 'top-level-self-fetch',
  ): BlobImpl | null;
}

/** Fetch §2, serialize an integer as its shortest decimal representation. */
export function serializeInteger(integer: number | bigint): string {
  return BigInt(integer).toString();
}

/** Binding integration: HTML supplies the relevant browser environment and its execution facilities. */
export const fetchEnvironment =
  defineCapability<(context: BindingContext) => FetchEnvironment>('Fetch environment');

export function getFetchEnvironment(
  context: BindingContext, definition: InterfaceDefinition<never>,
): FetchEnvironment {
  const getEnvironment = context.getCapability(definition, fetchEnvironment);
  if (!getEnvironment) throw new InternalError('Fetch API requires HTML environment settings');
  return getEnvironment(context);
}
