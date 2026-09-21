import type { FetchGroup } from './group';
import type { ConnectionPool } from './http/connections';
import type { HTTPCachePartitions } from './http/cache/partitions';
import type { CookieStore } from '../http/index';
import type { Origin, URLRecord } from '../url/index';
import { defineCapability, type BindingContext, type InterfaceDefinition } from '../web-idl/index';
import { InternalError } from '../infra/internal-error';

/** https://fetch.spec.whatwg.org/#is-offline */
export function isOffline(environment: FetchEnvironmentSettingsObject): boolean {
  return environment.userAgent.assumeNoInternetConnectivity ||
    environment.webDriverBiDiNetworkIsOffline();
}

/** The HTML environment settings object, exposing only what Fetch currently uses. */
export type FetchEnvironmentSettingsObject = FetchEnvironment & {
  /** Current base URL used to resolve relative URLs supplied through Fetch APIs. */
  apiBaseURL: URLRecord;
  /** Client origin used by Fetch's origin and policy checks. */
  origin: Origin;
  /** Whether the client has cross-site ancestry or cannot establish a same-site ancestor context. */
  hasCrossSiteAncestor: boolean;
  /** Source URL selected by the client's global, or null when disclosure is prohibited. */
  getReferrerSource(): URLRecord | null;
  /** Requests tracked for this environment's lifetime. */
  fetchGroup: FetchGroup;
  /** Whether WebDriver BiDi emulates an offline network for this environment. */
  webDriverBiDiNetworkIsOffline(): boolean;
  /** Client's live policy container, exposing the policies currently consumed by Fetch. */
  policyContainer: FetchPolicyContainer;
  /** Submit a report for this client using the string-valued body fields produced by Fetch. */
  queueReport(type: string, endpoint: string, body: Record<string, string>): void;
};

/** Prompt destination, exposing what Request construction currently needs. */
// PROVISIONAL: reconcile the constructor's environment-origin check with HTML's traversable target.
export type FetchPromptTarget = {
  /** Origin used by the constructor's same-origin copy check. */
  origin: Origin;
};

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
};

// https://html.spec.whatwg.org/multipage/browsers.html#embedder-policy-value
export type FetchEmbedderPolicyValue = 'unsafe-none' | 'require-corp' | 'credentialless';

// https://w3c.github.io/webappsec-referrer-policy/#referrer-policies
export type ReferrerPolicy = '' | 'no-referrer' | 'no-referrer-when-downgrade' | 'same-origin' |
  'origin' | 'strict-origin' | 'origin-when-cross-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';

/** The HTML environment, including reserved clients that do not yet have a realm. */
export type FetchEnvironment = {
  /** Shared user agent owning this environment's networking state. */
  userAgent: FetchUserAgent;
  /** Top-level origin used for network partitioning, or null when it must be derived. */
  topLevelOrigin: Origin | null;
  /** Top-level creation URL used to derive an unavailable top-level origin, or null. */
  topLevelCreationURL: URLRecord | null;
};

export type FetchUserAgent = {
  /** Browser-wide assumption of no internet access, separate from per-client emulation. */
  assumeNoInternetConnectivity: boolean;
  /** Shared reusable connections, isolated by network partition, origin, and credentials. */
  connectionPool: ConnectionPool;
  /** Shared logical HTTP caches, separated by network partition key. */
  httpCachePartitions: HTTPCachePartitions;
  /** Cookie state shared by requests belonging to this user agent. */
  cookieStore: CookieStore;
  /** Enables sending and accepting cookies without deleting the store when disabled. */
  cookiesEnabled: boolean;
  /** Applies this user agent's trust policy to a URL, including loopback and configured origins. */
  isURLPotentiallyTrustworthy(url: URLRecord): boolean;
};

/** Fetch §2, serialize an integer as its shortest decimal representation. */
export function serializeInteger(integer: number | bigint): string {
  return BigInt(integer).toString();
}

/** Binding integration: HTML supplies the relevant settings object for Fetch APIs. */
export const fetchEnvironmentSettingsObject =
  defineCapability<(context: BindingContext) => FetchEnvironmentSettingsObject>('Fetch environment settings object');

export function getFetchEnvironmentSettingsObject(
  context: BindingContext, definition: InterfaceDefinition<never>,
): FetchEnvironmentSettingsObject {
  const getSettings = context.getCapability(definition, fetchEnvironmentSettingsObject);
  if (!getSettings) throw new InternalError('Fetch API requires HTML environment settings');
  return getSettings(context);
}
