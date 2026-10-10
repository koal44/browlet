import { describe, expect, it } from 'vitest';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { createTrustedTypesWindow } from './fixture';

describe('Trusted Types default policies', () => {
  it('passes the input, expected type, and sink name to the appropriate callback', () => {
    const { window, runTask } = createTrustedTypesWindow();
    const calls: unknown[][] = [];
    const callback = (value: string, ...args: unknown[]) => { calls.push([value, ...args]); return `checked:${value}`; };
    window.trustedTypes.createPolicy('default', { createHTML: callback, createScript: callback, createScriptURL: callback });
    for (const [tag, name, expectedType, sink] of [
      ['iframe', 'srcdoc', 'TrustedHTML', 'HTMLIFrameElement srcdoc'],
      ['main', 'onclick', 'TrustedScript', 'Element onclick'],
      ['script', 'src', 'TrustedScriptURL', 'HTMLScriptElement src'],
    ]) {
      const element = window.document.createElement(tag!);
      element.setAttribute(name!, 'input');
      expect(element.getAttribute(name!)).toBe('checked:input');
      expect(calls.at(-1)).toEqual(['input', expectedType, sink]);
    }
    expect(calls).toHaveLength(3);
    expect(runTask()).toBe(false);
  });

  it('bypasses the default policy for matching trusted values and ordinary attributes', () => {
    const { window, runTask } = createTrustedTypesWindow();
    window.trustedTypes.createPolicy('default', { createHTML: () => { throw new Error('unexpected'); } });
    const element = window.document.createElement('iframe');
    element.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
    element.setAttribute('title', 'ordinary');
    expect(element.getAttribute('srcdoc')).toBe('');
    expect(element.getAttribute('title')).toBe('ordinary');
    expect(runTask()).toBe(false);
  });

  it.each(['enforce', 'report'] as const)('accepts an empty default result in %s mode without reporting', (disposition) => {
    const { window, runTask } = createTrustedTypesWindow(undefined, disposition);
    window.trustedTypes.createPolicy('default', { createHTML: () => '' });
    const element = window.document.createElement('iframe');
    element.setAttribute('srcdoc', 'input');
    expect(element.getAttribute('srcdoc')).toBe('');
    expect(runTask()).toBe(false);
  });

  it.each(['missing', 'null', 'undefined'] as const)('treats a %s default callback result as unsuccessful conversion', (kind) => {
    const { window, runTask } = createTrustedTypesWindow();
    const policy = window.trustedTypes.createPolicy('default', kind === 'missing' ? {} : {
      createHTML: () => (kind === 'null' ? null : undefined) as null,
    });
    if (kind !== 'missing') expect(String(policy.createHTML('explicit'))).toBe('');
    const element = window.document.createElement('iframe');
    expect(() => element.setAttribute('srcdoc', 'input')).toThrow(window.TypeError);
    expect(element.hasAttributes()).toBe(false);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
  });

  it.each(['enforce', 'report'] as const)('propagates callback exceptions in %s mode without reporting a type mismatch', (disposition) => {
    const { window, runTask } = createTrustedTypesWindow(undefined, disposition);
    const marker = new Error('author callback failure');
    const element = window.document.createElement('iframe');
    window.trustedTypes.createPolicy('default', {
      createHTML: () => {
        element.setAttribute('title', 'author side effect');
        throw marker;
      },
    });
    let caught: unknown;
    try { element.setAttribute('srcdoc', 'input'); } catch (error) { caught = error; }
    expect(caught).toBe(marker);
    expect(element.getAttributeNames()).toEqual(['title']);
    expect(runTask()).toBe(false);
  });

  it('propagates a callback result stringification failure without changing the attribute', () => {
    const { window, runTask } = createTrustedTypesWindow();
    const marker = new Error('author stringification failure');
    window.trustedTypes.createPolicy('default', { createHTML: () => ({ toString() { throw marker; } }) as unknown as string });
    const element = window.document.createElement('iframe');
    let caught: unknown;
    try { element.setAttribute('srcdoc', 'input'); } catch (error) { caught = error; }
    expect(caught).toBe(marker);
    expect(element.hasAttributes()).toBe(false);
    expect(runTask()).toBe(false);
  });

  it('uses the node document\'s policy with borrowed methods and foreign trusted values', () => {
    const restricted = createTrustedTypesWindow();
    const open = createTrustedTypesWindow('');
    const element = restricted.window.document.createElement('iframe');
    expect(() => open.window.Element.prototype.setAttribute.call(element, 'srcdoc', 'input')).toThrow(open.window.TypeError);
    const converted: unknown[][] = [];
    restricted.window.trustedTypes.createPolicy('default', { createHTML: (...args) => { converted.push(args); return 'restricted'; } });
    open.window.trustedTypes.createPolicy('default', { createHTML: () => { throw new Error('wrong owner'); } });
    open.window.Element.prototype.setAttribute.call(element, 'srcdoc', 'input');
    expect(element.getAttribute('srcdoc')).toBe('restricted');
    expect(converted).toEqual([['input', 'TrustedHTML', 'HTMLIFrameElement srcdoc']]);
    const trusted = open.window.trustedTypes.createPolicy('foreign', { createHTML: (value) => value }).createHTML('foreign');
    element.setAttribute('srcdoc', trusted);
    expect(element.getAttribute('srcdoc')).toBe('foreign');
    expect(converted).toHaveLength(1);
  });

  it('uses Web IDL callback conversion for scalar-value URL results', () => {
    const { window } = createTrustedTypesWindow();
    window.trustedTypes.createPolicy('default', { createScriptURL: () => '/\uD800.js' });
    const element = window.document.createElement('script');
    element.setAttribute('src', 'input');
    expect(element.getAttribute('src')).toBe('/\uFFFD.js');
  });

  it('rereads CSP after a default callback changes the applicable policies', () => {
    const { window, document, runTask } = createTrustedTypesWindow();
    window.trustedTypes.createPolicy('default', {
      createHTML: () => {
      // Policy state changes stand in for a reentrant navigation reusing this Window.
        document.policyContainer.cspList!.policies = [ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'report')];
        return null;
      },
    });
    const element = window.document.createElement('iframe');
    element.setAttribute('srcdoc', 'input');
    expect(element.getAttribute('srcdoc')).toBe('input');
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
  });
});
