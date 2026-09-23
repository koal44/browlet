import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { ReportImpl } from '../../../src/browlet/reporting/report';
import { TestReportBodyImpl } from '../../../src/browlet/reporting/test-report';
import { FetchRequest } from '../../../src/fetch/request';
import { serializeURL } from '../../../src/url/url';
import { serializeOrigin } from '../../../src/url/origin';

describe('Report generation', () => {
  it('retains producer data and sanitizes the creation URL without changing the environment', async () => {
    const browlet = new Browlet({ route: () => '', userAgent: 'Configured/1.0' });
    const source = 'https://user:password@example.test/page?query#fragment';
    await browlet.navigate(source);
    const environment = getRelevantRealm(browlet.window).environment;
    const body = { message: 'test', reportOnly: true };
    const before = Date.now();
    const report = environment.generateReport(body, 'test', 'endpoint');
    expect(report).toBeInstanceOf(ReportImpl);
    expect(report).toMatchObject({
      data: body, type: 'test', destination: 'endpoint', attempts: 0,
      userAgent: 'Configured/1.0', url: 'https://example.test/page?query',
    });
    expect(report.data).toBe(body);
    expect(report.body).toBeInstanceOf(TestReportBodyImpl);
    expect(report.body).toMatchObject({ message: 'test' });
    expect(serializeOrigin(report.origin)).toBe('https://example.test');
    expect(report.timestamp).toBeGreaterThanOrEqual(before);
    expect(report.timestamp).toBeLessThanOrEqual(Date.now());
    expect(serializeURL(environment.creationURL)).toBe(source);
  });

  it('retains an origin even when URL sanitization leaves only a scheme name', () => {
    const browlet = new Browlet({ route: () => '' });
    const environment = getRelevantRealm(browlet.window).environment;
    const report = environment.generateReport(null, 'test', 'endpoint');
    expect(report.body).toBeNull();
    expect(report.url).toBe('about');
    expect(report.origin.kind).toBe('opaque');
    expect(serializeOrigin(report.origin)).toBe('null');
  });

  it('captures the same effective identification value used for a missing request header', () => {
    const browlet = new Browlet({ route: () => '', userAgent: 'Configured/1.0' });
    const environment = getRelevantRealm(browlet.window).environment;
    const override = vi.spyOn(environment.userAgent, 'webDriverBiDiEmulatedUserAgent').mockReturnValue('Emulated/1.0');
    const request = new FetchRequest(environment.creationURL, environment, environment.userAgent);
    request.appendUserAgentHeader();
    const report = environment.generateReport(null, 'test', 'endpoint');
    expect(report.userAgent).toBe('Emulated/1.0');
    expect(report.userAgent).toBe(request.headerList.get('User-Agent'));

    environment.userAgent.defaultUserAgentValue = 'Configured/2.0';
    override.mockReturnValue(null);
    expect(environment.generateReport(null, 'test', 'endpoint').userAgent).toBe('Configured/2.0');
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
    expect(environment.generateReport(null, 'test', 'endpoint').userAgent).toBe('Environment/1.0');
  });
});
