import { describe, expect, it } from 'vitest';

import { Domlet } from '../../../src/domlet/domlet';
import { EventImpl } from '../../../src/domlet/events/event';
import { DocumentImpl } from '../../../src/domlet/nodes/document';

describe('Domlet', () => {
  it('binds DOM constructors to one realm host', () => {
    let timeStamp = 10;
    const domlet = new Domlet({
      exposure: 'Window',
      eventTimeStamp: () => ++timeStamp,
    });
    const { CustomEvent, Event, EventTarget } = domlet.bindings;
    const event = new Event('ready');
    const customEvent = new CustomEvent('answer', { detail: 42 });
    const eventTarget = new EventTarget();
    const document = domlet.parse();

    expect(event).toBeInstanceOf(Event);
    expect(event).not.toBeInstanceOf(EventImpl);
    expect(event.timeStamp).toBe(11);
    expect(customEvent).toBeInstanceOf(Event);
    expect(customEvent.timeStamp).toBe(12);
    expect(customEvent.detail).toBe(42);
    expect(eventTarget).toBeInstanceOf(EventTarget);
    expect(document).toBeInstanceOf(EventTarget);
  });

  it('materializes a distinct DOM interface family for each realm', () => {
    const first = new Domlet();
    const second = new Domlet();
    const document = first.parse('<main id="target"></main>');
    const element = document.getElementById('target')!;
    const createdDocument = new first.bindings.Document();
    const createdElement = document.createElement('aside');
    const createdText = document.createTextNode('content');

    expect(first.bindings.Event).not.toBe(second.bindings.Event);
    expect(first.bindings.CustomEvent).not.toBe(second.bindings.CustomEvent);
    expect(first.bindings.EventTarget).not.toBe(second.bindings.EventTarget);
    expect(first.bindings.Node).not.toBe(second.bindings.Node);
    expect(first.bindings.Document).not.toBe(second.bindings.Document);
    expect(document).toBeInstanceOf(first.bindings.Document);
    expect(document).toBeInstanceOf(first.bindings.Node);
    expect(document).toBeInstanceOf(first.bindings.EventTarget);
    expect(document).not.toBeInstanceOf(second.bindings.Document);
    expect(document).not.toBeInstanceOf(second.bindings.Node);
    expect(document).not.toBeInstanceOf(second.bindings.EventTarget);
    expect(element).toBeInstanceOf(first.bindings.HTMLElement);
    expect(element).toBeInstanceOf(first.bindings.Element);
    expect(element).toBeInstanceOf(first.bindings.Node);
    expect(createdDocument).toBeInstanceOf(first.bindings.Document);
    expect(createdElement).toBeInstanceOf(first.bindings.HTMLElement);
    expect(createdText).toBeInstanceOf(first.bindings.Text);
    expect(Object.getPrototypeOf(first.bindings.Document.prototype))
      .toBe(first.bindings.Node.prototype);
    expect(Object.getPrototypeOf(first.bindings.Node.prototype))
      .toBe(first.bindings.EventTarget.prototype);
  });

  it('exposes only described Web IDL members on DOM prototypes', () => {
    const { bindings } = new Domlet();

    expect(ownKeys(bindings.EventTarget.prototype)).toEqual([
      'addEventListener',
      'constructor',
      'dispatchEvent',
      'removeEventListener',
    ]);
    expect(ownKeys(bindings.Node.prototype)).toEqual([
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
    expect(ownKeys(bindings.Document.prototype)).toEqual([
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
    expect(ownKeys(bindings.Element.prototype)).toEqual([
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
    expect(ownKeys(bindings.HTMLElement.prototype)).toEqual([
      'constructor',
      'style',
    ]);
    expect(ownKeys(bindings.HTMLStyleElement.prototype)).toEqual([
      'constructor',
      'sheet',
    ]);
    expect(ownKeys(bindings.Text.prototype)).toEqual([
      'constructor',
      'data',
      'nextElementSibling',
      'previousElementSibling',
      'remove',
    ]);
    expect(ownKeys(bindings.Comment.prototype)).toEqual([
      'constructor',
      'data',
      'nextElementSibling',
      'previousElementSibling',
      'remove',
    ]);
    expect(ownKeys(bindings.DocumentType.prototype)).toEqual([
      'constructor',
      'name',
      'publicId',
      'remove',
      'systemId',
    ]);
  });

  it('implements described attributes through realm prototypes', () => {
    const domlet = new Domlet();
    const document = domlet.parse('<!doctype html><main></main>');
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
    const { bindings } = new Domlet();
    let internalHookWasCalled = false;
    const eventTarget = Reflect.construct(bindings.EventTarget, [{
      addingEventListener: () => { internalHookWasCalled = true; },
    }]) as EventTarget;
    const foreignDocument = new bindings.Document();
    const text = Reflect.construct(
      bindings.Text,
      ['content', foreignDocument],
    ) as Text;

    expect(() => { Reflect.apply(bindings.EventTarget, undefined, []); })
      .toThrow("use the 'new' operator");
    expect(() => { Reflect.construct(bindings.Node, []); })
      .toThrow('Illegal constructor');
    expect(() => { Reflect.construct(bindings.Element, []); })
      .toThrow('Illegal constructor');
    expect(Reflect.construct(bindings.EventTarget, []))
      .toBeInstanceOf(bindings.EventTarget);
    eventTarget.addEventListener('test', () => {});
    expect(internalHookWasCalled).toBe(false);
    expect(text.ownerDocument).toBeNull();
    expect(new bindings.Text().data).toBe('');
    expect(new bindings.Comment().data).toBe('');
  });

  it('filters exposed constructors for the host global', () => {
    const domlet = new Domlet({
      exposure: 'Worker',
      eventTimeStamp: () => 0,
    });

    expect([...domlet.bindings.exposed.keys()]).toEqual([
      'Event',
      'CustomEvent',
      'EventTarget',
    ]);
  });

  it('lazily associates one CSS engine with its document', () => {
    const document = new Domlet().parse('<main id="target"></main>');
    const cssEngine = DocumentImpl.getCSSEngine(document);

    expect(DocumentImpl.getCSSEngine(document)).toBe(cssEngine);
    expect(cssEngine.snapshot.document).toBe(document);
    expect(cssEngine.snapshot.root).toBe(document.documentElement);
    expect(cssEngine.snapshot.isQuirksMode).toBe(true);
    expect(cssEngine.version).toBe('stylelet-__VERSION__');
    expect(document.documentElement.localName).toBe('html');
    expect(document.getElementById('target')?.localName).toBe('main');
  });
});

function ownKeys(prototype: object): PropertyKey[] {
  return Reflect.ownKeys(prototype)
    .filter((key) => key !== Symbol.toStringTag)
    .sort((left, right) => String(left).localeCompare(String(right)));
}
