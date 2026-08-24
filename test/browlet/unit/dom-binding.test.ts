import { describe, expect, it, vi } from 'vitest';

import {
  browletBindings, getRelevantRealm,
} from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import { Realm } from '../../../src/browlet/scripting/realm';

describe('Browlet DOM binding', () => {
  it('projects the Window global through its Web IDL interface', () => {
    const browlet = createBrowlet();
    const window = browlet.window;
    const Window_ = getConstructor(browlet, 'Window');
    const EventTarget_ = getConstructor(browlet, 'EventTarget');
    const Location_ = getConstructor(browlet, 'Location');

    expect(window).toBeInstanceOf(Window_);
    expect(window).toBeInstanceOf(EventTarget_);
    expect(Object.getPrototypeOf(window)).toBe(Window_.prototype);
    expect(ownKeys(Window_.prototype)).toEqual(['constructor']);
    expect(window.document).toBe(browlet.document);
    expect(window.location).toBeInstanceOf(Location_);
    expect(window.location.href).toBe('about:blank');
    expect(String(window.location)).toBe('about:blank');
    expect(window.window).toBe(window);
    expect(window.self).toBe(window);
    expect(Reflect.deleteProperty(window, 'document')).toBe(false);
    expect(Reflect.deleteProperty(window.location, 'href')).toBe(false);
    expect(() => { Reflect.construct(Window_, []); })
      .toThrow('Illegal constructor');

    expect(Reflect.set(window, 'self', 'replacement')).toBe(true);
    expect(Reflect.get(window, 'self')).toBe('replacement');
  });

  it.fails('reports Window unforgeable descriptors through WindowProxy', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      createBrowlet().window,
      'document',
    );

    expect(descriptor?.configurable).toBe(false);
  });

  it('resolves dynamic Window named properties through Web IDL', () => {
    const browlet = createBrowlet();
    const element = browlet.document.createElement('main');
    element.setAttribute('id', 'named');
    browlet.document.body!.appendChild(element);

    expect(Reflect.get(browlet.window, 'named')).toBe(element);

    element.remove();
    expect(Reflect.has(browlet.window, 'named')).toBe(false);
  });

  it('projects only described Web IDL members onto DOM prototypes', () => {
    const browlet = createBrowlet();

    expect(ownKeys(getPrototype(browlet, 'EventTarget'))).toEqual([
      'addEventListener',
      'constructor',
      'dispatchEvent',
      'removeEventListener',
    ]);
    expect(ownKeys(getPrototype(browlet, 'Node'))).toEqual([
      'appendChild',
      'baseURI',
      'compareDocumentPosition',
      'constructor',
      'contains',
      'firstChild',
      'getRootNode',
      'insertBefore',
      'isConnected',
      'lastChild',
      'nextSibling',
      'nodeType',
      'ownerDocument',
      'parentElement',
      'parentNode',
      'previousSibling',
    ]);
    expect(ownKeys(getPrototype(browlet, 'Document'))).toEqual([
      'adoptedStyleSheets',
      'body',
      'characterSet',
      'charset',
      'childElementCount',
      'children',
      'compatMode',
      'constructor',
      'contentType',
      'createAttribute',
      'createComment',
      'createElement',
      'createElementNS',
      'createTextNode',
      'customElementRegistry',
      'defaultView',
      'doctype',
      'documentElement',
      'documentURI',
      'firstElementChild',
      'getElementById',
      'getElementsByClassName',
      'getElementsByTagName',
      'getElementsByTagNameNS',
      'head',
      'inputEncoding',
      'lastElementChild',
      'styleSheets',
      'URL',
      'write',
    ]);
    expect(ownKeys(getPrototype(browlet, 'Element'))).toEqual([
      'attributes',
      'childElementCount',
      'children',
      'constructor',
      'firstElementChild',
      'getAttribute',
      'getAttributeNS',
      'getElementsByClassName',
      'getElementsByTagName',
      'getElementsByTagNameNS',
      'hasAttribute',
      'hasAttributeNS',
      'lastElementChild',
      'localName',
      'namespaceURI',
      'nextElementSibling',
      'previousElementSibling',
      'remove',
      'removeAttribute',
      'setAttribute',
    ]);
    expect(ownKeys(getPrototype(browlet, 'HTMLElement'))).toEqual([
      'constructor',
      'style',
    ]);
    expect(ownKeys(getPrototype(browlet, 'HTMLStyleElement'))).toEqual([
      'constructor',
      'sheet',
    ]);
    expect(ownKeys(getPrototype(browlet, 'CharacterData'))).toEqual([
      'constructor',
      'data',
      'nextElementSibling',
      'previousElementSibling',
      'remove',
    ]);
    expect(ownKeys(getPrototype(browlet, 'Text'))).toEqual(['constructor']);
    expect(ownKeys(getPrototype(browlet, 'Comment'))).toEqual(['constructor']);
    expect(ownKeys(getPrototype(browlet, 'DocumentType'))).toEqual([
      'constructor',
      'name',
      'publicId',
      'remove',
      'systemId',
    ]);
    expect(ownKeys(getPrototype(browlet, 'DocumentFragment'))).toEqual([
      'childElementCount',
      'children',
      'constructor',
      'firstElementChild',
      'lastElementChild',
    ]);
    expect(ownKeys(getPrototype(browlet, 'ShadowRoot'))).toEqual([
      'adoptedStyleSheets',
      'clonable',
      'constructor',
      'customElementRegistry',
      'delegatesFocus',
      'host',
      'mode',
      'serializable',
      'slotAssignment',
      'styleSheets',
    ]);
    expect(ownKeys(getPrototype(browlet, 'Attr'))).toEqual([
      'constructor',
      'localName',
      'name',
      'namespaceURI',
      'ownerElement',
      'prefix',
      'specified',
      'value',
    ]);
  });

  it('implements attributes through the realm prototypes', async () => {
    const browlet = new Browlet({
      route: () => '<!doctype html><main></main>',
    });
    await browlet.navigate('https://example.test/');
    const document = browlet.document;
    const element = document.documentElement!;
    const text = document.createTextNode('content');
    const comment = document.createComment('note');
    const detachedAttribute = document.createAttribute('DATA-detached');
    element.setAttribute('id', 'target');
    const attribute = element.attributes[0];

    expect(Object.keys(document)).toEqual([]);
    expect(Object.keys(element)).toEqual([]);
    expect(Object.keys(text)).toEqual([]);
    expect(Object.keys(comment)).toEqual([]);
    expect(Object.keys(detachedAttribute)).toEqual([]);
    expect(Object.keys(attribute)).toEqual([]);
    expect(Object.keys(document.doctype!)).toEqual([]);
    expect(attribute).toBeInstanceOf(Reflect.get(browlet.window, 'Attr'));
    expect(detachedAttribute).toBeInstanceOf(Reflect.get(browlet.window, 'Attr'));
    expect(detachedAttribute.ownerDocument).toBe(document);
    expect(detachedAttribute.ownerElement).toBeNull();
    expect(detachedAttribute.localName).toBe('data-detached');
    expect(detachedAttribute.value).toBe('');
    expect(() => document.createAttribute('bad name')).toThrowError(
      expect.objectContaining({ name: 'InvalidCharacterError' }),
    );
    expect(attribute).toBeInstanceOf(Reflect.get(browlet.window, 'Node'));
    expect(attribute.ownerDocument).toBe(document);
    expect(attribute.ownerElement).toBe(element);
    expect(attribute.specified).toBe(true);
    expect(Reflect.set(document, 'nodeType', 0)).toBe(false);
    expect(Reflect.set(element, 'attributes', null)).toBe(false);
    expect(Reflect.set(attribute, 'localName', 'changed')).toBe(false);
    expect(Reflect.set(document.doctype!, 'name', 'changed')).toBe(false);
    expect(document.URL).toBe('https://example.test/');
    expect(document.documentURI).toBe('https://example.test/');
    expect(document.characterSet).toBe('UTF-8');
    expect(document.contentType).toBe('text/html');
  });

  it('enforces each interface construction declaration', () => {
    const browlet = createBrowlet();
    const EventTarget_ = getConstructor(browlet, 'EventTarget');
    const Node_ = getConstructor(browlet, 'Node');
    const CharacterData_ = getConstructor(browlet, 'CharacterData');
    const Element_ = getConstructor(browlet, 'Element');
    const Document_ = getConstructor(browlet, 'Document');
    const Text_ = getConstructor(browlet, 'Text');
    const Comment_ = getConstructor(browlet, 'Comment');
    const DocumentFragment_ = getConstructor(browlet, 'DocumentFragment');
    const ShadowRoot_ = getConstructor(browlet, 'ShadowRoot');
    let internalHookWasCalled = false;
    const eventTarget = Reflect.construct(EventTarget_, [{
      addingEventListener: () => { internalHookWasCalled = true; },
    }]) as EventTarget;
    const foreignDocument = Reflect.construct(Document_, []) as Document;
    const text = Reflect.construct(
      Text_,
      ['content', foreignDocument],
    ) as Text;

    expect(() => { Reflect.apply(EventTarget_, undefined, []); })
      .toThrow("use the 'new' operator");
    expect(() => { Reflect.construct(Node_, []); })
      .toThrow('Illegal constructor');
    expect(() => { Reflect.construct(CharacterData_, []); })
      .toThrow('Illegal constructor');
    expect(() => { Reflect.construct(Element_, []); })
      .toThrow('Illegal constructor');
    expect(Reflect.construct(EventTarget_, []))
      .toBeInstanceOf(EventTarget_);
    eventTarget.addEventListener('test', () => {});
    expect(internalHookWasCalled).toBe(false);
    expect(text.ownerDocument).toBeNull();
    expect(foreignDocument.contentType).toBe('application/xml');
    expect((Reflect.construct(Text_, []) as Text).data).toBe('');
    expect((Reflect.construct(Comment_, []) as Comment).data).toBe('');
    const fragment = Reflect.construct(
      DocumentFragment_,
      [],
    ) as DocumentFragment;
    expect(fragment).toBeInstanceOf(DocumentFragment_);
    expect(fragment).toBeInstanceOf(Node_);
    expect(fragment.ownerDocument).toBe(browlet.document);
    expect(() => { Reflect.construct(ShadowRoot_, []); })
      .toThrow('Illegal constructor');
  });

  it('filters DOM constructors for the host exposure set', () => {
    const realm = new Realm({ globalNames: ['Worker'] });
    const bindings = browletBindings.register(realm);

    bindings.install(realm.global);

    expect(exposedNames(realm.global, [
      'DOMException',
      'QuotaExceededError',
      'Event',
      'CustomEvent',
      'EventTarget',
      'Node',
      'Document',
      'Element',
    ])).toEqual([
      'DOMException',
      'QuotaExceededError',
      'Event',
      'CustomEvent',
      'EventTarget',
    ]);
  });

  it('takes constructed event timestamps from the owning realm', () => {
    const realm = new Realm();
    vi.spyOn(realm, 'eventTimeStamp').mockReturnValue(123.5);
    const bindings = browletBindings.register(realm);
    bindings.install(realm.global);
    const Event_ = Reflect.get(realm.global, 'Event') as typeof Event;
    const CustomEvent_ = Reflect.get(
      realm.global,
      'CustomEvent',
    ) as typeof CustomEvent;

    expect(new Event_('ready').timeStamp).toBe(123.5);
    expect(new CustomEvent_('ready').timeStamp).toBe(123.5);
  });

  it('applies inherited event invocation to internally created nodes', () => {
    const browlet = createBrowlet();
    const Event_ = Reflect.get(browlet.window, 'Event') as typeof Event;
    const event = new Event_('ready');
    const text = browlet.document.createTextNode('content');
    let currentEvent: Event | undefined;

    text.addEventListener('ready', () => {
      currentEvent = browlet.window.event;
    });
    text.dispatchEvent(event);

    expect(currentEvent).toBe(event);
    expect(browlet.window.event).toBeUndefined();
  });

  it('applies inherited event invocation to the projected Window', () => {
    const browlet = createBrowlet();
    const Event_ = Reflect.get(browlet.window, 'Event') as typeof Event;
    const event = new Event_('ready');
    let currentEvent: Event | undefined;

    browlet.window.addEventListener('ready', () => {
      currentEvent = browlet.window.event;
    });
    browlet.window.dispatchEvent(event);

    expect(currentEvent).toBe(event);
    expect(browlet.window.event).toBeUndefined();
  });

  it('retains a platform object\'s relevant Realm after prototype mutation', () => {
    const browlet = createBrowlet();
    const EventTarget_ = getConstructor(browlet, 'EventTarget');
    const target = Reflect.construct(EventTarget_, []);
    const realm = getRelevantRealm(target);

    Reflect.setPrototypeOf(target, null);

    expect(getRelevantRealm(target)).toBe(realm);
  });
});

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}

function getConstructor(
  browlet: Browlet,
  name: string,
): InterfaceConstructor {
  const constructor: unknown = Reflect.get(browlet.window, name);
  if (typeof constructor !== 'function') {
    throw new Error(`${name} was not exposed`);
  }
  return constructor as InterfaceConstructor;
}

function getPrototype(browlet: Browlet, name: string): object {
  return Reflect.get(getConstructor(browlet, name), 'prototype');
}

function ownKeys(prototype: object): PropertyKey[] {
  return Reflect.ownKeys(prototype)
    .filter((key) => key !== Symbol.toStringTag)
    .sort((left, right) => String(left).localeCompare(String(right)));
}

function exposedNames(global: object, names: readonly string[]): string[] {
  return names.filter((name) => Reflect.has(global, name));
}

type InterfaceConstructor = {
  (...arguments_: unknown[]): unknown;
  new(...arguments_: unknown[]): object;
  readonly prototype: object;
};
