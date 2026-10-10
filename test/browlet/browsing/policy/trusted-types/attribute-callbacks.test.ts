import { describe, expect, it } from 'vitest';
import { createTrustedTypesWindow, attachments } from './fixture';

describe('Trusted Types attribute callback ordering', () => {
  it('finishes Web IDL conversion and name validation before calling the default policy', () => {
    const { window, runTask } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    const calls: string[] = [];
    window.trustedTypes.createPolicy('default', { createHTML: () => { calls.push('policy'); return ''; } });
    const value = { toString() { calls.push('value'); return 'input'; } } as unknown as string;
    expect(() => element.setAttribute('bad name', value)).toThrow(expect.objectContaining({ name: 'InvalidCharacterError' }));
    expect(() => element.setAttributeNS(null, 'prefix:srcdoc', value)).toThrow(expect.objectContaining({ name: 'NamespaceError' }));
    expect(calls).toEqual(['value', 'value']);
    expect(element.hasAttributes()).toBe(false);
    expect(runTask()).toBe(false);
  });

  it.each(['setAttribute', 'setAttributeNS'] as const)('%s looks up the current attribute after the callback replaces it', (method) => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    element.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
    const original = element.attributes[0]!;
    window.trustedTypes.createPolicy('default', {
      createHTML: (value) => {
        element.removeAttributeNode(original);
        element.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
        return `checked:${value}`;
      },
    });
    if (method === 'setAttribute') element.setAttribute('srcdoc', 'input');
    else element.setAttributeNS(null, 'srcdoc', 'input');
    expect(element.attributes).toHaveLength(1);
    expect(element.attributes[0]).not.toBe(original);
    expect(element.getAttribute('srcdoc')).toBe('checked:input');
    expect(original.value).toBe('');
    expect(original.ownerElement).toBeNull();
  });

  it.each(attachments)('%s checks the value before InUseAttributeError and the same-Attr early return', (_name, attach) => {
    const { window } = createTrustedTypesWindow();
    const first = window.document.createElement('iframe');
    const second = window.document.createElement('iframe');
    first.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
    const attribute = first.attributes[0]!;
    expect(() => attach(second, attribute)).toThrow(window.TypeError);
    expect(() => attach(first, attribute)).toThrow(window.TypeError);
    const calls: string[] = [];
    window.trustedTypes.createPolicy('default', { createHTML: (value) => { calls.push(value); return 'converted'; } });
    expect(() => attach(second, attribute)).toThrow(expect.objectContaining({ name: 'InUseAttributeError' }));
    expect(attach(first, attribute)).toBe(attribute);
    expect(attribute.value).toBe('');
    expect(attribute.ownerElement).toBe(first);
    expect(calls).toEqual(['', '']);
  });

  it.each(attachments)('%s permits a callback to detach the incoming Attr from its previous owner', (_name, attach) => {
    const { window } = createTrustedTypesWindow();
    const first = window.document.createElement('iframe');
    const second = window.document.createElement('iframe');
    first.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
    const attribute = first.attributes[0]!;
    window.trustedTypes.createPolicy('default', {
      createHTML: () => {
        first.removeAttributeNode(attribute);
        return 'converted';
      },
    });
    expect(attach(second, attribute)).toBeNull();
    expect(first.hasAttributes()).toBe(false);
    expect(second.attributes[0]).toBe(attribute);
    expect(attribute.value).toBe('converted');
  });

  it.each(attachments)('%s does not write its checked result if the callback attaches the Attr elsewhere', (_name, attach) => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    const other = window.document.createElement('div');
    const attribute = window.document.createAttribute('srcdoc');
    attribute.value = 'input';
    window.trustedTypes.createPolicy('default', {
      createHTML: () => {
        other.setAttributeNode(attribute);
        return 'converted';
      },
    });
    expect(() => attach(element, attribute)).toThrow(expect.objectContaining({ name: 'InUseAttributeError' }));
    expect(element.hasAttributes()).toBe(false);
    expect(attribute.ownerElement).toBe(other);
    expect(attribute.value).toBe('input');
  });

  it('stores the checked Attr.value on the detached Attr when the callback removes it', () => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    element.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
    const attribute = element.attributes[0]!;
    window.trustedTypes.createPolicy('default', {
      createHTML: (value) => {
        element.removeAttributeNode(attribute);
        return `checked:${value}`;
      },
    });
    attribute.value = 'input';
    expect(attribute.value).toBe('checked:input');
    expect(attribute.ownerElement).toBeNull();
    expect(element.hasAttributes()).toBe(false);
  });

  it('uses the current Attr owner for the final change after the callback moves it', () => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    const other = window.document.createElement('div');
    element.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
    const attribute = element.attributes[0]!;
    window.trustedTypes.createPolicy('default', {
      createHTML: (value) => {
        element.removeAttributeNode(attribute);
        other.setAttributeNode(attribute);
        return `checked:${value}`;
      },
    });
    attribute.value = 'input';
    expect(element.hasAttributes()).toBe(false);
    expect(attribute.ownerElement).toBe(other);
    expect(other.getAttribute('srcdoc')).toBe('checked:input');
  });
});
