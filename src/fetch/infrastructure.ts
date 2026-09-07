/** Fetch §2, is offline, from the user agent and environment's offline state. */
export function isOffline(
  userAgentIsOffline: boolean,
  webDriverBiDiNetworkIsOffline: boolean,
): boolean {
  return userAgentIsOffline || webDriverBiDiNetworkIsOffline;
}

/** Fetch §2, serialize an integer as its shortest decimal representation. */
export function serializeInteger(integer: number | bigint): string {
  return BigInt(integer).toString();
}
