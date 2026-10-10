import { describe, expect, it } from 'vitest';
import { createTrustedTypesWindow } from './fixture';

describe('Trusted Types attribute ownership', () => {
  it('uses the new node document after adoption while retaining the Element and Attr identities', () => {
    const open = createTrustedTypesWindow('');
    const restricted = createTrustedTypesWindow();
    const element = open.window.document.createElement('iframe');
    element.setAttribute('srcdoc', 'original');
    const attribute = element.attributes[0]!;
    expect(restricted.window.document.adoptNode(element)).toBe(element);
    expect(attribute.ownerDocument).toBe(restricted.window.document);
    expect(() => element.setAttribute('srcdoc', 'blocked')).toThrow(open.window.TypeError);
    expect(() => { attribute.value = 'blocked'; }).toThrow(open.window.TypeError);
    restricted.window.trustedTypes.createPolicy('default', { createHTML: (value) => `restricted:${value}` });
    element.setAttribute('srcdoc', 'input');
    expect(element.attributes[0]).toBe(attribute);
    expect(attribute.value).toBe('restricted:input');
    open.window.document.adoptNode(element);
    attribute.value = 'open again';
    expect(attribute.value).toBe('open again');
    expect(attribute.ownerDocument).toBe(open.window.document);
  });

  it('keeps the selected global during a callback that adopts the element into another realm', () => {
    const source = createTrustedTypesWindow();
    const target = createTrustedTypesWindow();
    const element = source.window.document.createElement('iframe');
    source.window.trustedTypes.createPolicy('default', {
      createHTML: (value) => {
        target.window.document.adoptNode(element);
        return `source:${value}`;
      },
    });
    target.window.trustedTypes.createPolicy('default', { createHTML: (value) => `target:${value}` });
    element.setAttribute('srcdoc', 'input');
    const attribute = element.attributes[0]!;
    expect(attribute.value).toBe('source:input');
    expect(attribute.ownerDocument).toBe(target.window.document);
    element.setAttribute('srcdoc', 'next');
    expect(attribute.value).toBe('target:next');
    expect(element.attributes[0]).toBe(attribute);
  });

  it('reports to the initially selected global when a rejecting callback adopts the element', () => {
    const source = createTrustedTypesWindow();
    const target = createTrustedTypesWindow('');
    const element = source.window.document.createElement('iframe');
    source.window.trustedTypes.createPolicy('default', {
      createHTML: () => {
        target.window.document.adoptNode(element);
        return null;
      },
    });
    expect(() => element.setAttribute('srcdoc', 'input')).toThrow(source.window.TypeError);
    expect(element.ownerDocument).toBe(target.window.document);
    expect(element.hasAttributes()).toBe(false);
    expect(source.runTask()).toBe(true);
    expect(target.runTask()).toBe(false);
  });

  it('retains an inactive Document\'s relevant Window when a navigation changes the active Window', () => {
    const original = createTrustedTypesWindow();
    const other = createTrustedTypesWindow('');
    const element = original.window.document.createElement('iframe');
    // Switch the browsing context's proxy, leaving the old Document and its realm alive.
    original.realm.windowProxy.setAssociatedWindow(other.realm.globalObject);
    expect(original.document.getRelevantGlobalObject()).toBe(original.realm.windowImplementation);
    expect(() => other.window.Element.prototype.setAttribute.call(element, 'srcdoc', 'input')).toThrow(other.window.TypeError);
    original.scope.trustedTypes.createPolicy('default', { createHTML: (value) => `original:${value}` });
    element.setAttribute('srcdoc', 'input');
    expect(element.getAttribute('srcdoc')).toBe('original:input');
  });

  it('uses the relevant Window\'s current CSP, not a detached Document\'s own policy container', () => {
    const { window, env, document, runTask } = createTrustedTypesWindow();
    const detached = new window.Document();
    const element = detached.createElement('iframe');
    expect(() => element.setAttribute('srcdoc', 'blocked')).toThrow(window.TypeError);
    expect(runTask()).toBe(true);
    // Reuse the Window for a replacement Document, as initial about:blank navigation can do.
    const replacement = env.exec.createDocument();
    document.getRelevantGlobalObject()!.setAssociatedDocument(replacement);
    element.setAttribute('srcdoc', 'allowed');
    expect(element.getAttribute('srcdoc')).toBe('allowed');
    expect(element.ownerDocument).toBe(detached);
    expect(runTask()).toBe(false);
  });
});
