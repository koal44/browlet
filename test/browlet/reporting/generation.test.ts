import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { generateReport } from '../../../src/browlet/reporting/report';
import { FetchRequest } from '../../../src/fetch/request';
import { serializeURL } from '../../../src/url/url';

describe('Reporting record generation', () => {
  it('retains producer data and sanitizes the creation URL without changing the environment', async () => {
    const browlet = new Browlet({ route: () => '', userAgent: 'Configured/1.0' });
    const source = 'https://user:password@example.test/page?query#fragment';
    await browlet.navigate(source);
    const environment = getRelevantRealm(browlet.window).environment;
    const body = { message: 'test', reportOnly: true };
    const before = Date.now();
    const report = generateReport(body, 'test', 'endpoint', environment);
    expect(report).toMatchObject({
      body, type: 'test', destination: 'endpoint', attempts: 0,
      userAgent: 'Configured/1.0', url: 'https://example.test/page?query',
    });
    expect(report.body).toBe(body);
    expect(report.timestamp).toBeGreaterThanOrEqual(before);
    expect(report.timestamp).toBeLessThanOrEqual(Date.now());
    expect(serializeURL(environment.creationURL)).toBe(source);
  });

  it('captures the same effective identification value used for a missing request header', () => {
    const browlet = new Browlet({ route: () => '', userAgent: 'Configured/1.0' });
    const environment = getRelevantRealm(browlet.window).environment;
    const override = vi.spyOn(environment, 'webDriverBiDiEmulatedUserAgent').mockReturnValue('Emulated/1.0');
    const request = new FetchRequest(environment.creationURL, environment, environment.userAgent);
    request.appendUserAgentHeader();
    const report = generateReport(null, 'test', 'endpoint', environment);
    expect(report.userAgent).toBe('Emulated/1.0');
    expect(report.userAgent).toBe(request.headerList.get('User-Agent'));

    environment.userAgent.defaultUserAgentValue = 'Configured/2.0';
    override.mockReturnValue(null);
    expect(generateReport(null, 'test', 'endpoint', environment).userAgent).toBe('Configured/2.0');
    expect(report.userAgent).toBe('Emulated/1.0');
    expect(request.headerList.get('User-Agent')).toBe('Emulated/1.0');
  });

  it('keeps a per-request header override separate from the report\'s environment identity', () => {
    const browlet = new Browlet({ route: () => '', userAgent: 'Environment/1.0' });
    const environment = getRelevantRealm(browlet.window).environment;
    const request = new FetchRequest(environment.creationURL, environment, environment.userAgent);
    request.headerList.append('User-Agent', 'RequestOnly/1.0');
    request.appendUserAgentHeader();
    expect(request.headerList.get('User-Agent')).toBe('RequestOnly/1.0');
    expect(generateReport(null, 'test', 'endpoint', environment).userAgent).toBe('Environment/1.0');
  });
});
