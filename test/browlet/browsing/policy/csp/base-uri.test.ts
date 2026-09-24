import { describe, expect, it } from 'vitest';
import { createOpaqueOrigin } from '../../../../../src/url/origin';
import { createCSPWindow } from './fixture';

describe('CSP base-uri', () => {
  it('rejects a disallowed base and restores the document fallback URL', () => {
    const { window, scope, runTask } = createCSPWindow("base-uri 'self'; report-to base");
    const base = window.document.createElement('base');
    base.href = 'https://other.test/';
    window.document.appendChild(base);
    expect(window.document.baseURI).toBe('https://protected.test/page#section');
    runTask();
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ effectiveDirective: 'base-uri', blockedURL: 'inline' });
    base.href = '/allowed/';
    expect(window.document.baseURI).toBe('https://protected.test/allowed/');
  });

  it('monitors a disallowed base without preventing it', () => {
    const { window, scope, runTask } = createCSPWindow("base-uri 'none'; report-to base", 'report');
    const base = window.document.createElement('base');
    base.href = 'https://other.test/';
    window.document.appendChild(base);
    expect(window.document.baseURI).toBe('https://other.test/');
    runTask();
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'report', effectiveDirective: 'base-uri' });
  });

  it('does not use default-src as a base-uri fallback', () => {
    const { window } = createCSPWindow("default-src 'none'");
    const base = window.document.createElement('base');
    base.href = 'https://other.test/';
    window.document.appendChild(base);
    expect(window.document.baseURI).toBe('https://other.test/');
  });

  it('uses the inherited self origin even for a document sandboxed to an opaque origin', () => {
    const { document, window } = createCSPWindow("base-uri 'self'");
    document.origin = createOpaqueOrigin();
    const base = window.document.createElement('base');
    base.href = '/allowed/';
    window.document.appendChild(base);
    expect(window.document.baseURI).toBe('https://protected.test/allowed/');
  });

  it('does not generate a CSP report for a URL already rejected by HTML', () => {
    const { window, scope, runTask } = createCSPWindow("base-uri 'none'; report-to base");
    const base = window.document.createElement('base');
    base.href = 'javascript:alert(1)';
    window.document.appendChild(base);
    expect(window.document.baseURI).toBe('https://protected.test/page#section');
    expect(runTask()).toBe(false);
    expect(scope.reports).toHaveLength(0);
  });
});
