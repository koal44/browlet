/** https://fetch.spec.whatwg.org/#is-offline */
export function isOffline(environment: FetchClientSettings): boolean {
  return environment.userAgent.assumeNoInternetConnectivity ||
    environment.webDriverBiDiNetworkIsOffline();
}

/** The HTML environment settings object, exposing only what Fetch currently uses. */
export type FetchClientSettings = {
  userAgent: FetchUserAgent;
  webDriverBiDiNetworkIsOffline(): boolean;
  policyContainer: {
    embedderPolicy: {
      value: 'unsafe-none' | 'require-corp' | 'credentialless';
    };
  };
};

export type FetchUserAgent = {
  assumeNoInternetConnectivity: boolean;
};

/** Fetch §2, serialize an integer as its shortest decimal representation. */
export function serializeInteger(integer: number | bigint): string {
  return BigInt(integer).toString();
}
