import { describe, expect, it } from 'vitest';
import { createPolicyContainer } from '../../../../src/browlet/browsing/policy/container';
import { UserAgent } from '../../../../src/browlet/user-agent';

describe('Policy containers', () => {
  it('creates independent default policy state', () => {
    const first = createPolicyContainer();
    const second = new UserAgent().createPolicyContainer();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.cspList).not.toBe(second.cspList);
    expect(first.embedderPolicy).not.toBe(second.embedderPolicy);
    expect(first.integrityPolicy).not.toBe(second.integrityPolicy);
    expect(first.reportOnlyIntegrityPolicy).not.toBe(second.reportOnlyIntegrityPolicy);
  });

  it('copies enforced and reporting COEP fields and referrer policy', () => {
    const original = createPolicyContainer();
    original.embedderPolicy = {
      value: 'require-corp', reportingEndpoint: 'enforced',
      reportOnlyValue: 'credentialless', reportOnlyReportingEndpoint: 'reported',
    };
    original.referrerPolicy = 'no-referrer';
    const copy = original.clone();
    expect(copy).toEqual(original);
    expect(copy.embedderPolicy).not.toBe(original.embedderPolicy);
    expect(copy.cspList).not.toBe(original.cspList);
    expect(copy.integrityPolicy).not.toBe(original.integrityPolicy);
    expect(copy.reportOnlyIntegrityPolicy).not.toBe(original.reportOnlyIntegrityPolicy);
    original.embedderPolicy.reportingEndpoint = 'changed';
    original.referrerPolicy = 'unsafe-url';
    expect(copy.embedderPolicy.reportingEndpoint).toBe('enforced');
    expect(copy.referrerPolicy).toBe('no-referrer');
    copy.embedderPolicy.value = 'unsafe-none';
    expect(original.embedderPolicy.value).toBe('require-corp');
  });
});
