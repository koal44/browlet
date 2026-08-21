import { describe, expect, it } from 'vitest';

import { BrowletBindings } from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import { Realm } from '../../../src/browlet/realm';

describe('Browlet DOM binding', () => {
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
      'childElementCount',
      'children',
      'compatMode',
      'constructor',
      'contentType',
      'createComment',
      'createElement',
      'createElementNS',
      'createTextNode',
      'doctype',
      'documentElement',
      'firstElementChild',
      'getElementById',
      'getElementsByClassName',
      'getElementsByTagName',
      'getElementsByTagNameNS',
      'head',
      'lastElementChild',
      'styleSheets',
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
  });

  it('implements attributes through the realm prototypes', async () => {
    const browlet = new Browlet({
      route: () => '<!doctype html><main></main>',
    });
    await browlet.navigate('https://example.test/');
    const document = browlet.document;
    const element = document.documentElement;
    const text = document.createTextNode('content');
    const comment = document.createComment('note');
    element.setAttribute('id', 'target');
    const attribute = element.attributes[0];

    expect(Object.keys(document)).toEqual([]);
    expect(Object.keys(element)).toEqual([]);
    expect(Object.keys(text)).toEqual([]);
    expect(Object.keys(comment)).toEqual([]);
    expect(Object.keys(attribute)).toEqual([]);
    expect(Object.keys(document.doctype!)).toEqual([]);
    expect(Reflect.set(document, 'nodeType', 0)).toBe(false);
    expect(Reflect.set(element, 'attributes', null)).toBe(false);
    expect(Reflect.set(attribute, 'localName', 'changed')).toBe(false);
    expect(Reflect.set(document.doctype!, 'name', 'changed')).toBe(false);
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
    expect((Reflect.construct(Text_, []) as Text).data).toBe('');
    expect((Reflect.construct(Comment_, []) as Comment).data).toBe('');
  });

  it('filters DOM constructors for the host exposure set', () => {
    const realm = new Realm({ exposure: 'Worker' });
    const bindings = new BrowletBindings(realm);

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
