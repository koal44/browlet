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
    const env = getRelevantRealm(browlet.window).env;
    const body = { message: 'test', reportOnly: true };
    const before = Date.now();
    const report = env.generateReport(body, 'test', 'endpoint');
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
    expect(serializeURL(env.creationURL)).toBe(source);
  });

  it('retains an origin even when URL sanitization leaves only a scheme name', () => {
    const browlet = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browlet.window).env;
    const report = env.generateReport(null, 'test', 'endpoint');
    expect(report.body).toBeNull();
    expect(report.url).toBe('about');
    expect(report.origin.kind).toBe('opaque');
    expect(serializeOrigin(report.origin)).toBe('null');
  });

  it('captures the same effective identification value used for a missing request header', () => {
    const browlet = new Browlet({ route: () => '', userAgent: 'Configured/1.0' });
    const env = getRelevantRealm(browlet.window).env;
    const override = vi.spyOn(env.userAgent, 'webDriverBiDiEmulatedUserAgent').mockReturnValue('Emulated/1.0');
    const request = new FetchRequest(env.creationURL, env, env.userAgent);
    request.appendUserAgentHeader();
    const report = env.generateReport(null, 'test', 'endpoint');
    expect(report.userAgent).toBe('Emulated/1.0');
    expect(report.userAgent).toBe(request.headerList.get('User-Agent'));

    env.userAgent.defaultUserAgentValue = 'Configured/2.0';
    override.mockReturnValue(null);
    expect(env.generateReport(null, 'test', 'endpoint').userAgent).toBe('Configured/2.0');
    expect(report.userAgent).toBe('Emulated/1.0');
    expect(request.headerList.get('User-Agent')).toBe('Emulated/1.0');
  });

  it('keeps a per-request header override separate from the report\'s environment identity', () => {
    const browlet = new Browlet({ route: () => '', userAgent: 'Environment/1.0' });
    const env = getRelevantRealm(browlet.window).env;
    const request = new FetchRequest(env.creationURL, env, env.userAgent);
    request.headerList.append('User-Agent', 'RequestOnly/1.0');
    request.appendUserAgentHeader();
    expect(request.headerList.get('User-Agent')).toBe('RequestOnly/1.0');
    expect(env.generateReport(null, 'test', 'endpoint').userAgent).toBe('Environment/1.0');
  });
});
