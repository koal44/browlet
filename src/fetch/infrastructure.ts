import type { FetchGroup } from './group';
import type { ConnectionPool } from './http/connections';
import type { HTTPCachePartitions } from './http/cache/partitions';
import type { Origin } from '../url/origin';
import type { URLRecord } from '../url/url';
import { defineCapability, type BindingContext, type InterfaceDefinition } from '../web-idl/index';
import { InternalError } from '../infra/internal-error';

/** https://fetch.spec.whatwg.org/#is-offline */
export function isOffline(environment: FetchEnvironmentSettingsObject): boolean {
  return environment.userAgent.assumeNoInternetConnectivity ||
    environment.webDriverBiDiNetworkIsOffline();
}

/** The HTML environment settings object, exposing only what Fetch currently uses. */
export type FetchEnvironmentSettingsObject = FetchEnvironment & {
  apiBaseURL: URLRecord;
  origin: Origin;
  fetchGroup: FetchGroup;
  webDriverBiDiNetworkIsOffline(): boolean;
  policyContainer: {
    embedderPolicy: {
      value: 'unsafe-none' | 'require-corp' | 'credentialless';
    };
  };
};

/** The HTML environment, including reserved clients that do not yet have a realm. */
export type FetchEnvironment = {
  userAgent: FetchUserAgent;
  topLevelOrigin: Origin | null;
  topLevelCreationURL: URLRecord | null;
};

export type FetchUserAgent = {
  assumeNoInternetConnectivity: boolean;
  connectionPool: ConnectionPool;
  httpCachePartitions: HTTPCachePartitions;
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
