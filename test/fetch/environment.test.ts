import { describe, expect, it, vi } from 'vitest';

import { isOffline } from '../../src/fetch/environment';
import { createClientEnvironment } from './client-fixture';

describe('Fetch offline state', () => {
  it.each([
    [false, false, false], [true, false, true],
    [false, true, true], [true, true, true],
  ])('combines user-agent %s and BiDi %s offline state', (userAgent, bidi, expected) => {
    const webDriverBiDiNetworkIsOffline = vi.fn(() => bidi);
    const client = createClientEnvironment();
    client.userAgent.assumeNoInternetConnectivity = userAgent;
    client.userAgent.webDriverBiDiNetworkIsOffline = webDriverBiDiNetworkIsOffline;
    expect(isOffline(client)).toBe(expected);
    expect(webDriverBiDiNetworkIsOffline).toHaveBeenCalledTimes(userAgent ? 0 : 1);
    if (!userAgent) expect(webDriverBiDiNetworkIsOffline).toHaveBeenCalledWith(client);
  });
});
