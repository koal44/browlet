import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { UserAgent } from '../../src/browlet/user-agent';
import { getEnvironmentDefaultUserAgent } from '../../src/fetch/headers';
import { createFetchWindow } from './fetch-fixture';

describe('User-Agent identification', () => {
  it('supplies a browser-shaped default identifying Browlet', () => {
    const browlet = new Browlet({ route: () => '' });
    const settings = getRelevantRealm(browlet.window).hostDefined!;
    expect(getEnvironmentDefaultUserAgent(settings)).toBe('Mozilla/5.0 (compatible; Browlet)');
  });

  it('retains host configuration across navigation and isolates independent user agents', async () => {
    const configured = new Browlet({ route: () => '', userAgent: 'Custom/1.0' });
    const other = new Browlet({ route: () => '', userAgent: 'Other/2.0' });
    const initialSettings = getRelevantRealm(configured.window).hostDefined!;
    expect(getEnvironmentDefaultUserAgent(initialSettings)).toBe('Custom/1.0');
    await configured.navigate('https://example.test/page');
    const navigatedSettings = getRelevantRealm(configured.window).hostDefined!;
    expect(navigatedSettings.userAgent).toBe(initialSettings.userAgent);
    expect(getEnvironmentDefaultUserAgent(navigatedSettings)).toBe('Custom/1.0');
    expect(getEnvironmentDefaultUserAgent(getRelevantRealm(other.window).hostDefined!)).toBe('Other/2.0');
  });

  it('shares the default while selecting emulation independently for each environment', () => {
    const userAgent = new UserAgent();
    userAgent.defaultUserAgentValue = 'Shared/1.0';
    const first = createFetchWindow(userAgent).realm.hostDefined!;
    const second = createFetchWindow(userAgent).realm.hostDefined!;
    const override = vi.spyOn(first, 'webDriverBiDiEmulatedUserAgent').mockReturnValue('Emulated/1.0');
    expect(getEnvironmentDefaultUserAgent(first)).toBe('Emulated/1.0');
    expect(getEnvironmentDefaultUserAgent(second)).toBe('Shared/1.0');
    userAgent.defaultUserAgentValue = 'Shared/2.0';
    expect(getEnvironmentDefaultUserAgent(first)).toBe('Emulated/1.0');
    expect(getEnvironmentDefaultUserAgent(second)).toBe('Shared/2.0');
    override.mockReturnValue('');
    expect(getEnvironmentDefaultUserAgent(first)).toBe('');
    override.mockReturnValue(null);
    expect(getEnvironmentDefaultUserAgent(first)).toBe('Shared/2.0');
  });

  it.each(['', 'Custom/\u00e9'])('preserves the configured byte-string value %j', (userAgent) => {
    const browlet = new Browlet({ route: () => '', userAgent });
    expect(getEnvironmentDefaultUserAgent(getRelevantRealm(browlet.window).hostDefined!)).toBe(userAgent);
  });

  it.each(['bad\rvalue', 'bad\nvalue', 'bad\0value', ' leading', 'trailing\t', 'Agent/\u0100'])(
    'rejects invalid header configuration %j at the host boundary', (userAgent) => {
      expect(() => new Browlet({ route: () => '', userAgent })).toThrow(TypeError);
    },
  );
});
