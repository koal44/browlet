import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';
import type { HTMLIFrameElementImpl, HTMLObjectElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import type { HTMLFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/legacy/frame';
import type { HTMLCollection } from '../../../../src/browlet/platform';
import { createOpaqueOrigin, parseURL, type TupleOrigin } from '../../../../src/url/index';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

describe('Window named access', () => {
  it.each(['embed', 'form', 'img', 'object'])('exposes %s by name and counts a matching ID only once', (tag) => {
    const browser = new Browlet({ route: () => '' });
    const element = browser.document.createElement(tag);
    element.setAttribute('name', 'namedElement');
    browser.document.body!.appendChild(element);

    expect(Reflect.get(browser.window, 'namedElement')).toBe(element);
    element.id = 'namedElement';
    expect(Reflect.get(browser.window, 'namedElement')).toBe(element);
    expect(Reflect.has(browser.window, 'namedelement')).toBe(false);
  });

  it('accepts IDs on all elements but limits names to the four HTML element kinds', () => {
    const browser = new Browlet({ route: () => '' });
    for (const tag of ['a', 'div', 'input', 'iframe', 'frame']) {
      const element = browser.document.createElement(tag);
      element.setAttribute('name', `${tag}Name`);
      element.id = `${tag}ID`;
      browser.document.body!.appendChild(element);
      expect(Reflect.has(browser.window, `${tag}Name`)).toBe(false);
      expect(Reflect.get(browser.window, `${tag}ID`)).toBe(element);
    }
    const foreign = browser.document.createElementNS('urn:example', 'form');
    foreign.setAttribute('name', 'foreignName');
    foreign.setAttribute('id', 'foreignID');
    browser.document.body!.appendChild(foreign);
    expect(Reflect.has(browser.window, 'foreignName')).toBe(false);
    expect(Reflect.get(browser.window, 'foreignID')).toBe(foreign);

    const empty = browser.document.createElement('form');
    empty.id = '';
    empty.setAttribute('name', '');
    empty.setAttributeNS('urn:example', 'x:name', 'namespacedName');
    empty.setAttributeNS('urn:example', 'x:id', 'namespacedID');
    browser.document.body!.appendChild(empty);
    for (const name of ['', 'namespacedName', 'namespacedID']) {
      expect(Reflect.has(browser.window, name)).toBe(false);
    }
  });

  it('does not apply Document named access exposure restrictions to object and embed', () => {
    const browser = new Browlet({ route: () => '' });
    const outer = browser.document.createElement('object');
    const inner = browser.document.createElement('object');
    const embed = browser.document.createElement('embed');
    inner.setAttribute('name', 'innerObject');
    embed.setAttribute('name', 'innerEmbed');
    outer.appendChild(inner);
    outer.appendChild(embed);
    browser.document.body!.appendChild(outer);

    expect(Reflect.get(browser.window, 'innerObject')).toBe(inner);
    expect(Reflect.get(browser.window, 'innerEmbed')).toBe(embed);
  });

  it('returns a live HTMLCollection when more than one element matches', () => {
    const browser = new Browlet({ route: () => '' });
    const first = browser.document.createElement('div');
    const second = browser.document.createElement('span');
    first.id = second.id = 'matches';
    browser.document.body!.appendChild(first);
    browser.document.body!.appendChild(second);

    const collection = Reflect.get(browser.window, 'matches') as HTMLCollection;
    expect(collection).toBeInstanceOf(browser.window.HTMLCollection);
    expect(Array.from(collection)).toEqual([first, second]);
    second.remove();
    expect(Array.from(collection)).toEqual([first]);
    expect(Reflect.get(browser.window, 'matches')).toBe(first);
    browser.document.body!.appendChild(second);
    expect(Reflect.get(browser.window, 'matches')).toBe(collection);
    first.id = 'changed';
    expect(Array.from(collection)).toEqual([second]);
    second.id = '';
    expect(collection.length).toBe(0);
    expect(Reflect.has(browser.window, 'matches')).toBe(false);
    first.id = second.id = 'matches';
    browser.document.body!.appendChild(first);
    expect(Reflect.get(browser.window, 'matches')).toBe(collection);
    expect(Array.from(collection)).toEqual([second, first]);
  });

  it('combines name and ID matches in one collection and observes name changes', () => {
    const browser = new Browlet({ route: () => '' });
    const form = browser.document.createElement('form');
    const div = browser.document.createElement('div');
    form.setAttribute('name', 'mixed');
    div.id = 'mixed';
    browser.document.body!.appendChild(form);
    browser.document.body!.appendChild(div);

    const collection = Reflect.get(browser.window, 'mixed') as HTMLCollection;
    expect(Array.from(collection)).toEqual([form, div]);
    form.setAttribute('name', 'renamed');
    expect(Array.from(collection)).toEqual([div]);
    expect(Reflect.get(browser.window, 'mixed')).toBe(div);
    expect(Reflect.get(browser.window, 'renamed')).toBe(form);
  });

  it('excludes shadow trees, separate document fragments, and detached elements', () => {
    const browser = new Browlet({ route: () => '' });
    const host = browser.document.createElement('div');
    browser.document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowForm = browser.document.createElement('form');
    shadowForm.setAttribute('name', 'shadowName');
    shadow.appendChild(shadowForm);
    const fragment = browser.document.createDocumentFragment();
    const fragmented = browser.document.createElement('div');
    fragmented.id = 'fragmentID';
    fragment.appendChild(fragmented);
    const detached = browser.document.createElement('form');
    detached.setAttribute('name', 'detachedName');

    for (const name of ['shadowName', 'fragmentID', 'detachedName']) {
      expect(Reflect.has(browser.window, name)).toBe(false);
    }
    host.appendChild(shadowForm);
    expect(Reflect.get(browser.window, 'shadowName')).toBe(shadowForm);
  });

  it('orders supported names by contributing element and ignores later duplicates', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).windowImplementation;
    const document = window.document;
    const first = document.createElement('div');
    first.id = 'first';
    const child = createChild(document, 'iframe', 'childName');
    const form = document.createElement('form');
    form.setAttribute('name', 'formName');
    const duplicate = document.createElement('img');
    duplicate.setAttribute('name', 'first');
    document.body!.append(first, child.container, form, duplicate);

    expect([...window.getSupportedPropertyNames()]).toEqual(['first', 'childName', 'formName']);
    document.body!.appendChild(first);
    expect([...window.getSupportedPropertyNames()]).toEqual(['childName', 'formName', 'first']);
  });

  it.each(['iframe', 'object', 'frame'] as const)('returns the %s child proxy ahead of matching elements', (tag) => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const element = document.createElement('div');
    element.id = 'childName';
    const child = createChild(document, tag, 'childName');
    child.container.setAttribute('name', 'containerName');
    const second = createChild(document, tag, 'childName');
    document.body!.append(element, child.container, second.container);

    expect(Reflect.get(browser.window, 'childName')).toBe(child.navigable.activeWindowProxy.platform);
    expect(Reflect.get(browser.window, 'containerName')).toBe(tag === 'object' ? project(child.container) : undefined);
    document.body!.appendChild(child.container);
    expect(Reflect.get(browser.window, 'childName')).toBe(second.navigable.activeWindowProxy.platform);
    second.container.contentNavigable = null;
    expect(Reflect.get(browser.window, 'childName')).toBe(child.navigable.activeWindowProxy.platform);
    child.container.contentNavigable = null;
    expect(Reflect.get(browser.window, 'childName')).toBe(project(element));
  });

  it('rechecks target names and origins without requiring a DOM mutation', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document, 'iframe', 'before');
    document.body!.appendChild(child.container);
    const proxy = child.navigable.activeWindowProxy.platform;
    expect(Reflect.get(browser.window, 'before')).toBe(proxy);
    proxy.name = 'after';
    expect(Reflect.has(browser.window, 'before')).toBe(false);
    expect(Reflect.get(browser.window, 'after')).toBe(proxy);
    child.document.origin = createOpaqueOrigin();
    expect(Reflect.has(browser.window, 'after')).toBe(false);
    child.document.origin = document.origin;
    expect(Reflect.get(browser.window, 'after')).toBe(proxy);
    proxy.name = '';
    expect(Reflect.has(browser.window, 'after')).toBe(false);
    expect(Reflect.has(browser.window, '')).toBe(false);
  });

  it('deduplicates child target names before origin filtering, even with a matching container name', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const first = createChild(document, 'iframe', 'spices');
    first.document.origin = createOpaqueOrigin();
    first.container.setAttribute('name', 'spices');
    const second = createChild(document, 'iframe', 'spices');
    document.body!.append(first.container, second.container);

    // HTML's result; Blink/Gecko sources additionally allow matching container names.
    expect(Reflect.has(browser.window, 'spices')).toBe(false);
    expect(Reflect.get(browser.window, 'spices')).toBeUndefined();
    document.body!.appendChild(first.container);
    expect(Reflect.get(browser.window, 'spices')).toBe(second.navigable.activeWindowProxy.platform);
    document.body!.removeChild(second.container);
    expect(Reflect.has(browser.window, 'spices')).toBe(false);
  });

  it('requires same origin rather than relaxed same-origin-domain', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const origin: TupleOrigin = {
      kind: 'tuple', scheme: 'https', host: { kind: 'domain', value: 'a.example.test' },
      port: null, domain: { kind: 'domain', value: 'example.test' },
    };
    document.origin = origin;
    const child = createChild(document, 'iframe', 'relaxedChild');
    child.document.origin = { ...origin, host: { kind: 'domain', value: 'b.example.test' } };
    document.body!.appendChild(child.container);
    expect(Reflect.has(browser.window, 'relaxedChild')).toBe(false);
    child.document.origin = { ...origin, domain: null };
    expect(Reflect.get(browser.window, 'relaxedChild')).toBe(child.navigable.activeWindowProxy.platform);
  });

  it('selects a cross-origin child when an element independently makes its target name supported', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document, 'iframe', 'indirect');
    child.document.origin = createOpaqueOrigin();
    document.body!.appendChild(child.container);
    expect(Reflect.has(browser.window, 'indirect')).toBe(false);
    const element = document.createElement('div');
    element.id = 'indirect';
    document.body!.prepend(element);

    expect(Reflect.get(browser.window, 'indirect')).toBe(child.navigable.activeWindowProxy.platform);
    element.remove();
    expect(Reflect.has(browser.window, 'indirect')).toBe(false);
  });

  it('excludes child Documents and shadow child navigables, and drops children of an inactive Document', () => {
    const browser = new Browlet({ route: () => '' });
    const window = browser.window;
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document, 'iframe', 'childName');
    document.body!.appendChild(child.container);
    const nested = child.document.createElement('div');
    nested.id = 'nestedID';
    child.document.body!.appendChild(nested);
    const host = browser.document.createElement('div');
    browser.document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowChild = createChild(document, 'iframe', 'shadowChild');
    unwrap<ShadowRootImpl>(shadow).appendChild(shadowChild.container);
    child.container.id = 'containerID';

    expect(Reflect.has(browser.window, 'nestedID')).toBe(false);
    expect(Reflect.has(browser.window, 'shadowChild')).toBe(false);
    expect(Reflect.has(browser.window, 'childName')).toBe(true);
    document.browsingContext = null;
    expect(Reflect.has(window, 'childName')).toBe(false);
    expect(Reflect.get(window, 'containerID')).toBe(project(child.container));
  });

  it('uses the existing named-properties prototype layer, below real members and author properties', () => {
    const browser = new Browlet({ route: () => '' });
    const element = browser.document.createElement('form');
    element.setAttribute('name', 'namedForm');
    browser.document.body!.appendChild(element);
    const prototype = browser.window.Window.prototype;
    const namedProperties = Reflect.getPrototypeOf(prototype)!;

    expect(Reflect.getOwnPropertyDescriptor(browser.window, 'namedForm')).toBeUndefined();
    expect(Reflect.getOwnPropertyDescriptor(namedProperties, 'namedForm')).toEqual({
      value: element, writable: true, enumerable: false, configurable: true,
    });
    expect(Reflect.ownKeys(namedProperties)).not.toContain('namedForm');
    Reflect.set(browser.window, 'namedForm', 'author');
    expect(Reflect.get(browser.window, 'namedForm')).toBe('author');
    Reflect.deleteProperty(browser.window, 'namedForm');
    expect(Reflect.get(browser.window, 'namedForm')).toBe(element);
    Reflect.defineProperty(prototype, 'namedForm', { value: 'prototype', configurable: true });
    expect(Reflect.get(browser.window, 'namedForm')).toBe('prototype');
    expect(Reflect.getOwnPropertyDescriptor(namedProperties, 'namedForm')).toBeUndefined();
    Reflect.deleteProperty(prototype, 'namedForm');
    element.setAttribute('name', 'document');
    expect(browser.window.document).toBe(browser.document);
    element.setAttribute('name', 'addEventListener');
    expect(typeof browser.window.addEventListener).toBe('function');
  });

  it('projects named elements through author evaluation in their owning realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('form');
      element.setAttribute('name', 'evaluatedForm');
      document.body.appendChild(element);
      return Reflect.get(window, 'evaluatedForm') === element && element instanceof HTMLFormElement;
    })).toBe(true);
  });

  it('keeps retained collections on their original Document when the initial Window is reused', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).windowImplementation;
    const original = window.document;
    for (let index = 0; index < 2; index++) {
      const element = original.createElement('div');
      element.id = 'retained';
      original.body!.appendChild(element);
    }
    const oldCollection = Reflect.get(browser.window, 'retained') as HTMLCollection;
    const navigable = window.navigable!;
    const params = navigable.createNavigationParamsFromSource(parseURL('about:blank?replacement').url!);
    params.origin = original.origin;
    const replacement = navigable.createAndInitializeDocument('html', 'text/html', params);
    expect(replacement.getRelevantGlobalObject()).toBe(window);
    const root = replacement.createElement('html');
    replacement.appendChild(root);
    for (let index = 0; index < 2; index++) {
      const element = replacement.createElement('div');
      element.id = 'retained';
      root.appendChild(element);
    }

    const newCollection = Reflect.get(browser.window, 'retained') as HTMLCollection;
    expect(newCollection).not.toBe(oldCollection);
    expect(newCollection.length).toBe(2);
    expect(newCollection.item(0)!.ownerDocument).toBe(project(replacement));
    original.body!.removeChild(original.body!.firstChild!);
    expect(oldCollection.length).toBe(1);
    expect(oldCollection.item(0)!.ownerDocument).toBe(project(original));
    expect(newCollection.length).toBe(2);
  });
});

function createChild(document: DocumentImpl, tag: 'iframe' | 'object' | 'frame', name: string) {
  const container = document.createElement(tag) as HTMLIFrameElementImpl | HTMLObjectElementImpl | HTMLFrameElementImpl;
  const [, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
  childDocument.origin = document.origin;
  const state = createDocumentState(childDocument);
  state.navigableTargetName = name;
  const navigable = new Navigable(state, document.getNodeNavigable());
  // Child creation is unfinished; connect real implementations at the retained association.
  container.contentNavigable = navigable;
  return { container, navigable, document: childDocument };
}
