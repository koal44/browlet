/**
 * Fetch §2, is offline. The host supplies the two offline-state values instead
 * of the settings object, keeping HTML and BiDi state outside Fetch.
 */
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
