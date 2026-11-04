import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { SecurityPolicyViolationEvent } from '../../../../../src/browlet/platform';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { FetchRequest } from '../../../../../src/fetch/index';
import { parseURL, serializeURL } from '../../../../../src/url/index';
import { createTrustedTypesWindow } from './fixture';

describe('Trusted Types navigation checks', () => {
  it('uses the encoded source and sink arguments, then reparses the converted callback result', () => {
    const { window, env, document, request, runTask } = fixture();
    const calls: unknown[][] = [];
    window.trustedTypes.createPolicy('default', {
      createScript: (...args) => {
        calls.push(args);
        return { toString: () => 'void("new%20value")' } as unknown as string;
      },
    });
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(calls).toEqual([['void("original%20value")', 'TrustedScript', 'Location href']]);
    expect(serializeURL(request.url)).toBe('javascript:void("new%20value")');
    expect(request.currentURL).toBe(request.url);
    expect(runTask()).toBe(false);
  });

  it.each(['enforce', 'report'] as const)('invokes the default callback once across multiple %s and enforcing policies', (disposition) => {
    const { window, env, document, request, runTask } = fixture(disposition);
    const list = document.policyContainer.cspList!;
    list.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    let calls = 0;
    window.trustedTypes.createPolicy('default', { createScript: (input) => { calls++; return `${input};`; } });
    expect(list.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(calls).toBe(1);
    expect(serializeURL(request.url)).toBe('javascript:void("original%20value");');
    expect(runTask()).toBe(false);
  });

  it.each(['missing-policy', 'missing-callback', 'null', 'undefined', 'throw', 'stringify-throw', 'invalid-url'] as const)(
    'reports %s for each requiring policy without throwing out of the navigation check', (failure) => {
      const { window, env, document, request, runTask } = fixture('report');
      const list = document.policyContainer.cspList!;
      list.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
      let calls = 0;
      if (failure !== 'missing-policy') { window.trustedTypes.createPolicy('default', failure === 'missing-callback' ? {} : {
        createScript: () => {
          calls++;
          if (failure === 'throw') throw new Error('author failure');
          if (failure === 'stringify-throw') return { toString() { throw new Error('conversion failure'); } } as unknown as string;
          if (failure === 'invalid-url') return '//test:test/';
          return (failure === 'undefined' ? undefined : null) as null;
        },
      }); }
      const events: SecurityPolicyViolationEvent[] = [];
      window.document.addEventListener('securitypolicyviolation', (event) => events.push(event as SecurityPolicyViolationEvent));
      expect(list.isNavigationRequestBlocked(request, 'other', env)).toBe(true);
      expect(calls).toBe(failure === 'missing-policy' || failure === 'missing-callback' ? 0 : 1);
      expect(serializeURL(request.url)).toBe('javascript:void("original%20value")');
      expect(runTask()).toBe(true);
      expect(runTask()).toBe(true);
      expect(runTask()).toBe(false);
      expect(events.map((event) => [event.effectiveDirective, event.blockedURI, event.disposition, event.sample])).toEqual([
        ['require-trusted-types-for', 'trusted-types-sink', 'report', 'Location href|void("original%20value")'],
        ['require-trusted-types-for', 'trusted-types-sink', 'enforce', 'Location href|void("original%20value")'],
      ]);
    },
  );

  it('allows a report-only callback failure to continue to inline policy reporting', () => {
    const { window, env, document, request, runTask } = fixture('report');
    document.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("script-src 'none'", 'header', 'report'));
    window.trustedTypes.createPolicy('default', { createScript: () => { throw new Error('rejected'); } });
    const directives: string[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => {
      directives.push((event as SecurityPolicyViolationEvent).effectiveDirective);
    });
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(directives).toEqual(['require-trusted-types-for', 'script-src-elem']);
  });

  it('limits the failure sample to 40 source code units after the sink prefix', () => {
    const { window, env, document, request, runTask } = fixture();
    request.urlList = [parseURL(`javascript:${'x'.repeat(60)}`).url!];
    const samples: string[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => samples.push((event as SecurityPolicyViolationEvent).sample));
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(true);
    expect(runTask()).toBe(true);
    expect(samples).toEqual([`Location href|${'x'.repeat(40)}`]);
  });

  it('accepts an empty converted source', () => {
    const { window, env, document, request, runTask } = fixture();
    window.trustedTypes.createPolicy('default', { createScript: () => '' });
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(serializeURL(request.url)).toBe('javascript:');
    expect(runTask()).toBe(false);
  });

  it.each(['require-trusted-types-for', "require-trusted-types-for 'style'", 'trusted-types default'])(
    'does not invoke the default policy for %s', (policy) => {
      const { window, env, document, request, runTask } = fixture();
      window.trustedTypes.createPolicy('default', { createScript: () => { throw new Error('must not run'); } });
      document.policyContainer.cspList!.policies = [ContentSecurityPolicy.parse(policy, 'header', 'enforce')];
      expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
      expect(runTask()).toBe(false);
    },
  );

  it('does not run the javascript: pre-navigation check for a network URL', () => {
    const { window, env, document, request, runTask } = fixture();
    request.urlList = [parseURL('https://example.test/').url!];
    window.trustedTypes.createPolicy('default', { createScript: () => { throw new Error('must not run'); } });
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(runTask()).toBe(false);
  });

  it('checks the rewritten URL against inline hashes after the default callback', () => {
    const { window, env, document, request, runTask } = fixture();
    const converted = 'javascript:void("rewritten%20source")';
    const hash = createHash('sha256').update(converted).digest('base64');
    document.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse(
      `script-src 'unsafe-hashes' 'sha256-${hash}'`, 'header', 'enforce',
    ));
    window.trustedTypes.createPolicy('default', { createScript: () => converted.slice(11) });
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(serializeURL(request.url)).toBe(converted);
    expect(runTask()).toBe(false);
  });

  it('still invokes the pre-navigation callback after an earlier form-action denial', () => {
    const { window, env, document, request, runTask } = fixture();
    document.policyContainer.cspList!.policies.unshift(ContentSecurityPolicy.parse("form-action 'none'", 'header', 'enforce'));
    let calls = 0;
    window.trustedTypes.createPolicy('default', { createScript: () => { calls++; return 'void(0)'; } });
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'form-submission', env)).toBe(true);
    expect(calls).toBe(1);
    expect(serializeURL(request.url)).toBe('javascript:void(0)');
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
  });

  it('uses the captured policies and source factory even when the request allocation belongs to another Window', () => {
    const source = fixture();
    const target = fixture();
    const list = source.document.policyContainer.cspList!.clone();
    const request = new FetchRequest(source.request.url, target.env);
    request.client = source.env;
    source.window.trustedTypes.createPolicy('default', {
      createScript: (value) => {
        source.document.policyContainer.cspList!.policies = [];
        return value;
      },
    });
    target.window.trustedTypes.createPolicy('default', { createScript: () => { throw new Error('wrong owner'); } });
    expect(list.isNavigationRequestBlocked(request, 'other', source.env)).toBe(false);
    expect(list.policies).toHaveLength(1);
    expect(source.runTask()).toBe(false);
    expect(target.runTask()).toBe(false);
  });
});

function fixture(disposition: 'enforce' | 'report' = 'enforce') {
  const value = createTrustedTypesWindow(undefined, disposition);
  value.request.urlList = [parseURL('javascript:void("original%20value")').url!];
  return value;
}
