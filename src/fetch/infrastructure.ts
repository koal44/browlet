import type { FetchGroup } from './group';
import type { ConnectionPool } from './http/connections';
import type { HTTPCachePartitions } from './http/cache/partitions';
import type { FetchIntegrityPolicy } from './integrity';
import type { CookieStore } from '../http/index';
import type { RealmExecution } from '../js-engine/index';
import type { Host, Origin, URLRecord } from '../url/index';
import { defineCapability, type BindingContext, type InterfaceDefinition } from '../web-idl/index';
import { InternalError } from '../infra/internal-error';

/** https://fetch.spec.whatwg.org/#is-offline */
export function isOffline(environment: FetchEnvironment): boolean {
  return environment.userAgent.assumeNoInternetConnectivity ||
    environment.userAgent.webDriverBiDiNetworkIsOffline(environment);
}

/** The HTML environment settings object, exposing only what Fetch currently uses. */
export type FetchEnvironment = FetchEnvironmentRecord & {
  /** Current base URL used to resolve relative URLs supplied through Fetch APIs. */
  apiBaseURL: URLRecord;
  /** Client origin used by Fetch's origin and policy checks. */
  origin: Origin;
  /** Whether the client has cross-site ancestry or cannot establish a same-site ancestor context. */
  hasCrossSiteAncestor: boolean;
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
};

/** An opaque reference to the HTML traversable selected for user prompts. */
export type FetchPromptTarget = {
  [fetchPromptTargetBrand]: true;
};

/** Type-only marker declared by HTML traversables; it has no runtime value. */
export declare const fetchPromptTargetBrand: unique symbol;

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
export type FetchEnvironmentRecord = {
  /** Shared user agent owning this environment's networking state. */
  userAgent: FetchUserAgent;
  /** Top-level origin used for network partitioning, or null when it must be derived. */
  topLevelOrigin: Origin | null;
  /** Top-level creation URL used to derive an unavailable top-level origin, or null. */
  topLevelCreationURL: URLRecord | null;
};

export type FetchUserAgent = {
  /** Default identification header value before an environment-specific override. */
  defaultUserAgentValue: string;
  /** Browser-wide assumption of no internet access, separate from per-client emulation. */
  assumeNoInternetConnectivity: boolean;
  /** Whether WebDriver BiDi emulates an offline network for the given environment. */
  webDriverBiDiNetworkIsOffline(environment: FetchEnvironment): boolean;
  /** Identification override for the given environment, or null when BiDi supplies none. */
  webDriverBiDiEmulatedUserAgent(environment: FetchEnvironment): string | null;
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
};

/** Fetch §2, serialize an integer as its shortest decimal representation. */
export function serializeInteger(integer: number | bigint): string {
  return BigInt(integer).toString();
}

/** Binding integration: HTML supplies the relevant browser environment and its execution facilities. */
export const fetchEnvironment =
  defineCapability<(context: BindingContext) => FetchEnvironment & { exec: RealmExecution; }>('Fetch environment');

export function getFetchEnvironment(
  context: BindingContext, definition: InterfaceDefinition<never>,
): FetchEnvironment & { exec: RealmExecution; } {
  const getSettings = context.getCapability(definition, fetchEnvironment);
  if (!getSettings) throw new InternalError('Fetch API requires HTML environment settings');
  return getSettings(context);
}
