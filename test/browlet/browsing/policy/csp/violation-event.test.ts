import { describe, expect, it } from 'vitest';
import { createCSPWindow } from './fixture';

describe('SecurityPolicyViolationEvent', () => {
  it('constructs an Event with CSP defaults in the owning realm', () => {
    const { window } = createCSPWindow();
    const event = new window.SecurityPolicyViolationEvent('securitypolicyviolation');
    expect(event).toBeInstanceOf(window.Event);
    expect(event).toBeInstanceOf(window.SecurityPolicyViolationEvent);
    expect(event.type).toBe('securitypolicyviolation');
    expect(event.isTrusted).toBe(false);
    expect(event.bubbles).toBe(false);
    expect(event.composed).toBe(false);
    expect(event.documentURI).toBe('');
    expect(event.blockedURI).toBe('');
    expect(event.sourceFile).toBe('');
    expect(event.disposition).toBe('enforce');
    expect(event.statusCode).toBe(0);
    expect(event.lineNumber).toBe(0);
    expect(event.columnNumber).toBe(0);
  });

  it('applies dictionary conversion, including USVString, enum, and integer rules', () => {
    const { window } = createCSPWindow();
    const event = new window.SecurityPolicyViolationEvent('test', {
      documentURI: 'https://example.test/\uD800', blockedURI: 'inline',
      effectiveDirective: 'script-src-elem', violatedDirective: 'author-supplied',
      originalPolicy: "default-src 'none'", disposition: 'report',
      statusCode: 65537, lineNumber: 4.8, columnNumber: 2,
      bubbles: true, cancelable: true, composed: true,
    });
    expect(event.documentURI).toBe('https://example.test/\uFFFD');
    expect(event.effectiveDirective).toBe('script-src-elem');
    expect(event.violatedDirective).toBe('author-supplied');
    expect(event.originalPolicy).toBe("default-src 'none'");
    expect(event.disposition).toBe('report');
    expect(event.statusCode).toBe(1);
    expect(event.lineNumber).toBe(4);
    expect(event.columnNumber).toBe(2);
    expect(event.bubbles && event.cancelable && event.composed).toBe(true);
    expect(() => { Reflect.construct(window.SecurityPolicyViolationEvent, ['test', { disposition: 'invalid' }]); })
      .toThrow(window.TypeError);
  });

  it('keeps attributes read-only and validates getter receivers', () => {
    const { window } = createCSPWindow();
    const event = new window.SecurityPolicyViolationEvent('test', { blockedURI: 'eval' });
    expect(Reflect.set(event, 'blockedURI', 'changed')).toBe(false);
    expect(event.blockedURI).toBe('eval');
    const descriptor = Object.getOwnPropertyDescriptor(window.SecurityPolicyViolationEvent.prototype, 'blockedURI')!;
    expect(() => { descriptor.get!.call({}); }).toThrow(window.TypeError);
  });
});
